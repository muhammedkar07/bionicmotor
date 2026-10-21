#!/usr/bin/env bash
# =============================================================================
#  SMTP AYAR KURULUMU (Oracle Cloud Email Delivery veya Veridyen için)
#
#  Kullanım:
#     sudo bash scripts/mail-setup.sh                 → etkileşimli (soruları yanıtlayın)
#     sudo bash scripts/mail-setup.sh /var/www/bionic-test   → başka klasör için
#
#  Ne yapar?
#   1) Soruları sorar (şifre GÖRÜNMEZ şekilde alınır, komut geçmişine yazılmaz)
#   2) .env dosyasını YEDEKLER, SMTP_* satırlarını günceller
#   3) Bağlantıyı test eder (mail göndermeden: sunucu + kullanıcı + şifre doğrulaması)
# =============================================================================
set -eu

APP_DIR="${1:-${APP_DIR:-/var/www/bionic}}"
ENV_FILE="$APP_DIR/.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "HATA: $ENV_FILE bulunamadı."
  exit 1
fi

# Mevcut değerleri oku (varsa varsayılan olarak önerilir)
cur() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- || true; }

DEF_HOST="$(cur SMTP_HOST)";   DEF_HOST="${DEF_HOST:-smtp.email.eu-frankfurt-1.oci.oraclecloud.com}"
DEF_PORT="$(cur SMTP_PORT)";   DEF_PORT="${DEF_PORT:-587}"
DEF_SECURE="$(cur SMTP_SECURE)"; DEF_SECURE="${DEF_SECURE:-0}"
DEF_USER="$(cur SMTP_USER)"
DEF_FROM="$(cur SMTP_FROM)"
DEF_NAME="$(cur SMTP_FROM_NAME)"; DEF_NAME="${DEF_NAME:-Bionic Motor}"

ask() { # ask <etiket> <varsayılan>
  local label="$1" def="${2:-}" val=""
  if [ -n "$def" ]; then
    printf '  %s [%s]: ' "$label" "$def" >&2
  else
    printf '  %s: ' "$label" >&2
  fi
  read -r val
  [ -z "$val" ] && val="$def"
  printf '%s' "$val"
}

echo "=============================================================="
echo " SMTP kurulumu → $ENV_FILE"
echo "=============================================================="
echo ""

if [ -n "${SMTP_USER:-}" ] && [ -n "${SMTP_PASS:-}" ]; then
  HOST="${SMTP_HOST:-$DEF_HOST}"; PORT="${SMTP_PORT:-$DEF_PORT}"; SECURE="${SMTP_SECURE:-$DEF_SECURE}"
  USER_V="$SMTP_USER"; PASS_V="$SMTP_PASS"; FROM_V="${SMTP_FROM:-$DEF_FROM}"; NAME_V="${SMTP_FROM_NAME:-$DEF_NAME}"
  echo "  (değerler ortam değişkenlerinden alındı)"
else
  echo "Oracle Email Delivery bilgileri (Enter = önerilen değer):"
  HOST="$(ask 'SMTP sunucu (host)' "$DEF_HOST")"
  PORT="$(ask 'Port' "$DEF_PORT")"
  SECURE="$(ask 'SSL kullan (0 = 587/STARTTLS · 1 = 465/SSL)' "$DEF_SECURE")"
  echo ""
  echo "SMTP kimliği (Identity → Users → SMTP Credentials ekranındaki değerler):"
  USER_V="$(ask 'SMTP kullanıcı (ocid1.user...@ocid1.tenancy...)' "$DEF_USER")"
  if [ -n "${SMTP_PASS:-}" ]; then
    PASS_V="$SMTP_PASS"
  else
    printf '  SMTP şifre (yazarken görünmez): ' >&2
    read -rs PASS_V
    printf '\n' >&2
  fi
  echo ""
  echo "Gönderen bilgileri:"
  FROM_V="$(ask 'Gönderen adres (From)' "$DEF_FROM")"
  NAME_V="$(ask 'Gönderen adı' "$DEF_NAME")"
fi

# --- Doğrulama ---
fail() { echo ""; echo "HATA: $1"; exit 1; }
[ -n "$HOST" ] || fail "sunucu adresi boş olamaz."
[ -n "$USER_V" ] || fail "SMTP kullanıcı adı boş olamaz."
[ -n "$PASS_V" ] || fail "SMTP şifresi boş olamaz."
[ -n "$FROM_V" ] || fail "gönderen adres boş olamaz."
printf '%s' "$FROM_V" | grep -qE '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' || fail "gönderen adres geçerli bir e-posta değil: $FROM_V"
case "$SECURE" in 0|1) ;; *) fail "SSL değeri 1 veya 0 olmalı.";; esac
case "$PORT" in ''|*[!0-9]*) fail "port sayı olmalı.";; esac

# --- Yedekle ---
STAMP="$(date +%Y%m%d-%H%M%S)"
cp -a "$ENV_FILE" "$ENV_FILE.bak-$STAMP"
echo ""
echo "  yedek: $ENV_FILE.bak-$STAMP"

# --- Yaz (eski SMTP satırlarını temizle, yenisini ekle) ---
TMP="$(mktemp)"
grep -v -E '^SMTP_(HOST|PORT|SECURE|USER|PASS|FROM|FROM_NAME)=' "$ENV_FILE" > "$TMP" || true
{
  echo ""
  echo "# ---- E-posta (SMTP) · mail-setup.sh tarafından eklendi: $STAMP ----"
  echo "SMTP_HOST=$HOST"
  echo "SMTP_PORT=$PORT"
  echo "SMTP_SECURE=$SECURE"
  echo "SMTP_USER=$USER_V"
  echo "SMTP_PASS=$PASS_V"
  echo "SMTP_FROM=$FROM_V"
  echo "SMTP_FROM_NAME=$NAME_V"
} >> "$TMP"
cat "$TMP" > "$ENV_FILE"
rm -f "$TMP"
echo "  .env güncellendi ✅"

# --- Bağlantı testi ---
echo ""
echo "=============================================================="
echo " BAĞLANTI TESTİ"
echo "=============================================================="
cd "$APP_DIR"
node --env-file=.env scripts/mail-test.js || true

echo ""
echo "=============================================================="
echo " Sonraki adım:"
echo "   pm2 restart bionic"
echo "   node --env-file=.env scripts/mail-test.js sizin@adresiniz.com"
echo "=============================================================="
