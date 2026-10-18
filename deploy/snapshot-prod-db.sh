#!/usr/bin/env bash
# =============================================================================
#  CANLI -> TEST VERI KOPYASI (gercekci test icin)
#
#  Kullanim:  bash /var/www/bionic-test/deploy/snapshot-prod-db.sh --evet
#
#  Canli veritabaninin TUTARLI bir kopyasini (sqlite .backup) ve gorselleri
#  test ortamina alir. Boylece test ortami gercek verilerle denenebilir.
#
#  !! UYARI: Bu andan itibaren test ortaminda GERCEK musteri verisi bulunur (KVKK).
#            Isiniz bitince test ortamini temizleyin:  bash deploy/reset-test.sh
# =============================================================================
set -euo pipefail

PROD_DB=/var/lib/bionic/data/app.db
TEST_DB=/var/lib/bionic-test/data/app.db
PROD_UP=/var/lib/bionic/data/uploads
TEST_UP=/var/lib/bionic-test/data/uploads

if [ "${1:-}" != "--evet" ]; then
  echo "!! Canli musteri verisi test ortamina kopyalanacak (KVKK sorumlulugu sizde)."
  echo "   Onaylamak icin: bash $0 --evet"
  exit 1
fi

echo "=== 1/4) Test ortami durduruluyor ==="
pm2 stop bionic-test >/dev/null 2>&1 || true

echo "=== 2/4) Canli veritabani tutarli kopya (sqlite .backup) ==="
sqlite3 "$PROD_DB" ".backup '$TEST_DB'"
ls -la "$TEST_DB" | awk '{print "    "$5" bayt"}'

echo "=== 3/4) Gorseller ==="
rsync -a --delete "$PROD_UP/" "$TEST_UP/"
echo "    $(find "$TEST_UP" -type f | wc -l) dosya"

echo "=== 4/4) Test ortami baslatiliyor ==="
pm2 start bionic-test >/dev/null
sleep 4
printf "    test ortami -> "
curl -sS -o /dev/null -w "%{http_code}\n" --max-time 15 -H "Host: test.bionicmotorsiklet.com" http://127.0.0.1/

echo ""
echo "!! Bu andan itibaren TEST ortaminda GERCEK veri var."
echo "   Isiniz bitince:  bash /var/www/bionic-test/deploy/reset-test.sh --evet"
