# =============================================================================
#  CANLIYA AKTARIM (promote):  npm run promote
#
#  Test ortaminda DOGRULANAN kodu canliya uygular.
#  - Once canli kodun tam yedegini alir (sunucuda)
#  - Sonra kodu kopyalar ve canliyi yeniden baslatir
#  - Saglik kontrolu basarisiz olursa OTOMATIK geri alir
# =============================================================================
param(
  [string]$SshKey = $env:BIONIC_SSH_KEY,
  [string]$SshHost = $env:BIONIC_SSH_HOST,
  [switch]$Yes
)
$ErrorActionPreference = 'Stop'
if (-not $SshKey) { $SshKey = Join-Path $env:USERPROFILE '.ssh\bionic_oracle' }
if (-not $SshHost) { $SshHost = 'ubuntu@130.61.231.148' }

if (-not $Yes) {
  Write-Host 'Bu islem CANLI siteyi (bionicmotorsiklet.com) guncelleyecek.' -ForegroundColor Yellow
  $a = Read-Host 'Onayliyor musunuz? (evet yazin)'
  if ($a -ne 'evet') { Write-Host 'Iptal edildi.'; exit 0 }
}

ssh -i $SshKey $SshHost 'bash /var/www/bionic-test/deploy/promote.sh --evet'
