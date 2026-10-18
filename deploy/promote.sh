#!/usr/bin/env bash
# =============================================================================
#  PROMOTE — test ortaminda DOĞRULANAN kodu canliya uygular.
#
#  Kullanim (sunucuda):   bash /var/www/bionic-test/deploy/promote.sh --evet
#
#  Ne yapar?
#    1) Canli kodun tam yedegini alir  -> /var/backups/bionic/code-<tarih>.tar.gz
#    2) Test kodunu canliya kopyalar   (rsync; .env ve veri HARIC)
#    3) Canliyi yeniden baslatir
#    4) Saglik kontrolu yapar; BASARISIZ olursa OTOMATIK GERI ALIR
#
#  Veritabani ve .env ASLA kopyalanmaz: canli veri korunur.
# =============================================================================
set -euo pipefail

SRC=/var/www/bionic-test
DST=/var/www/bionic
APP=bionic
HEALTH=https://bionicmotorsiklet.com/
STAMP=$(date +%Y%m%d-%H%M%S)
SNAP=/var/backups/bionic/code-$STAMP.tar.gz

if [ "${1:-}" != "--evet" ]; then
  echo "!! Bu komut CANLI siteyi degistirir."
  echo "   Onaylamak icin: bash $0 --evet"
  exit 1
fi

echo "=== 1/4) Canli kodun yedegi ==="
mkdir -p /var/backups/bionic
tar -czf "$SNAP" -C "$DST" \
  --exclude=node_modules --exclude=.env --exclude=data --exclude=logs .
echo "    $SNAP ($(du -h "$SNAP" | cut -f1))"

echo "=== 2/4) Test -> Canli (kod) ==="
rsync -a --delete \
  --exclude '.env' \
  --exclude '/data/' \
  --exclude '/logs/' \
  --exclude '*.log' \
  "$SRC/" "$DST/"
echo "    aktarildi"

echo "=== 3/4) Canli yeniden baslatiliyor ==="
pm2 restart "$APP" >/dev/null
sleep 6

echo "=== 4/4) Saglik kontrolu ==="
code=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 25 "$HEALTH" || echo 000)
echo "    $HEALTH -> $code"

if [ "$code" != "200" ]; then
  echo ""
  echo "!! SAGLIK KONTROLU BASARISIZ — otomatik geri aliniyor"
  tar -xzf "$SNAP" -C "$DST"
  pm2 restart "$APP" >/dev/null
  sleep 6
  code2=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 25 "$HEALTH" || echo 000)
  echo "    geri alma sonrasi -> $code2"
  echo "    Eski kod: $SNAP"
  exit 1
fi

echo ""
echo "=== TAMAM: test edilen kod canliya uygulandi ==="
echo "    Yedek (geri donmek isterseniz): $SNAP"
echo "    Geri donme:  tar -xzf $SNAP -C $DST && pm2 restart $APP"
