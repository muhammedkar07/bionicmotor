# =============================================================================
#  Yerel kodu TEST (staging) ortamina yukler:  npm run push:test
#
#  node_modules GONDERILMEZ (sharp native modul; Windows surumu Linux'ta calismaz).
#  Canli siteye DOKUNMAZ - yalnizca test ortami guncellenir.
# =============================================================================
param(
  [string]$SshKey = $env:BIONIC_SSH_KEY,
  [string]$SshHost = $env:BIONIC_SSH_HOST
)
$ErrorActionPreference = 'Stop'
if (-not $SshKey) { $SshKey = Join-Path $env:USERPROFILE '.ssh\bionic_oracle' }
if (-not $SshHost) { $SshHost = 'ubuntu@130.61.231.148' }

$root = Split-Path -Parent $PSScriptRoot
$tgz = Join-Path $env:TEMP 'bionic-code.tgz'
if (Test-Path $tgz) { Remove-Item $tgz -Force }

Write-Host '== 1/4) Yerel kod paketleniyor (node_modules haric) ==' -ForegroundColor Cyan
Push-Location $root
try {
  tar -czf $tgz --exclude=node_modules --exclude=.git --exclude=.env --exclude=backups --exclude=logs --exclude='data/app.db*' .
} finally { Pop-Location }
if (-not (Test-Path $tgz)) { throw 'Paket olusturulamadi (tar bulunamadi?)' }
Write-Host ('   ' + [math]::Round((Get-Item $tgz).Length / 1MB, 2) + ' MB')

Write-Host '== 2/4) Sunucuya yukleniyor ==' -ForegroundColor Cyan
scp -i $SshKey $tgz "${SshHost}:/tmp/bionic-code.tgz"

Write-Host '== 3/4) Test ortamina aciliyor (.env ve node_modules korunur) ==' -ForegroundColor Cyan
ssh -i $SshKey $SshHost "set -e; rm -rf /tmp/bionic-push && mkdir -p /tmp/bionic-push && tar -xzf /tmp/bionic-code.tgz -C /tmp/bionic-push && rsync -a --delete --exclude '.env' --exclude 'node_modules' --exclude '/logs/' --exclude '*.log' /tmp/bionic-push/ /var/www/bionic-test/ && rm -rf /tmp/bionic-push /tmp/bionic-code.tgz && echo '   acildi'"

Write-Host '== 4/4) Test uygulamasi yeniden baslatiliyor ==' -ForegroundColor Cyan
ssh -i $SshKey $SshHost "pm2 restart bionic-test >/dev/null && sleep 4 && printf '   test ortami -> ' && curl -sS -o /dev/null -w '%{http_code}\n' --max-time 15 -H 'Host: test.bionicmotorsiklet.com' http://127.0.0.1/"

Write-Host ''
Write-Host 'TAMAM. Test adresi: https://test.bionicmotorsiklet.com' -ForegroundColor Green
