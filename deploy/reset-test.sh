#!/usr/bin/env bash
# =============================================================================
#  TEST ORTAMINI TEMIZLE — test veritabanini "temiz baslangic" (baseline) hâline
#  dondurur. Canliya DOKUNMAZ (PM2_APP=bionic-test).
#
#  Kullanim:  bash /var/www/bionic-test/deploy/reset-test.sh --evet
# =============================================================================
set -euo pipefail

cd /var/www/bionic-test
if [ "${1:-}" != "--evet" ]; then
  echo "!! Test ortaminin veritabani silinip temiz baseline'a donulecek."
  echo "   Onaylamak icin: bash $0 --evet"
  exit 1
fi

echo "=== test veritabani sifirlaniyor (PM2_APP=bionic-test) ==="
node --env-file=.env scripts/reset.js --evet
sleep 3
printf "test ortami -> "
curl -sS -o /dev/null -w "%{http_code}\n" --max-time 15 -H "Host: test.bionicmotorsiklet.com" http://127.0.0.1/

echo "=== canli (dokunulmadi) ==="
printf "canli -> "
curl -sS -o /dev/null -w "%{http_code}\n" --max-time 15 https://bionicmotorsiklet.com/
