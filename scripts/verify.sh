#!/bin/bash
# =============================================================
# KazEDS — Верификация подписи
# Использование: ./scripts/verify.sh <данные> <подпись_base64> [сертификат.pem]
#
# Примеры:
#   ./scripts/verify.sh "demo" "MEUCIQ..." ./cert.pem
#   ./scripts/verify.sh "demo" "MEUCIQ..."
# =============================================================

set -e

if [ -z "$2" ]; then
  echo "Использование: ./scripts/verify.sh <данные> <подпись_base64> [сертификат.pem]"
  echo ""
  echo "Аргументы:"
  echo "  <данные>          Оригинальный текст, который был подписан"
  echo "  <подпись_base64>  Подпись в формате Base64"
  echo "  [сертификат.pem]  Сертификат подписанта (по умолчанию /tmp/kazeds-cert.pem)"
  echo ""
  echo "Примеры:"
  echo "  # Подписать и сразу верифицировать:"
  echo "  SIG=\$(./scripts/sign.sh \"demo\" | python3 -c \"import sys,json; print(json.load(sys.stdin)['signature'])\")"
  echo "  ./scripts/verify.sh \"demo\" \"\$SIG\""
  exit 1
fi

DATA="$1"
SIGNATURE="$2"
CERT_FILE="${3:-/tmp/kazeds-cert.pem}"

if [ ! -f "$CERT_FILE" ]; then
  echo "ОШИБКА: Сертификат не найден: $CERT_FILE"
  echo "Укажите путь к сертификату или сначала запустите ./scripts/sign.sh"
  exit 1
fi

echo "========================================"
echo "  KazEDS — Верификация подписи"
echo "========================================"
echo ""

# Certificate info
SUBJECT=$(openssl x509 -in "$CERT_FILE" -noout -subject -nameopt RFC2253 2>/dev/null | sed 's/subject=//')
ISSUER=$(openssl x509 -in "$CERT_FILE" -noout -issuer -nameopt RFC2253 2>/dev/null | sed 's/issuer=//')
NOT_BEFORE=$(openssl x509 -in "$CERT_FILE" -noout -startdate 2>/dev/null | sed 's/notBefore=//')
NOT_AFTER=$(openssl x509 -in "$CERT_FILE" -noout -enddate 2>/dev/null | sed 's/notAfter=//')
FINGERPRINT=$(openssl x509 -in "$CERT_FILE" -noout -fingerprint -sha256 2>/dev/null | sed 's/.*=//')

echo "Сертификат:"
echo "  Субъект:      $SUBJECT"
echo "  Издатель:     $ISSUER"
echo "  Действует:    $NOT_BEFORE — $NOT_AFTER"
echo "  Fingerprint:  $FINGERPRINT"
echo ""
echo "Данные:         $DATA"
echo "Подпись:        ${SIGNATURE:0:50}..."
echo ""

# Extract public key
PUBKEY=$(mktemp)
openssl x509 -in "$CERT_FILE" -pubkey -noout > "$PUBKEY" 2>/dev/null

# Decode signature
SIGBIN=$(mktemp)
echo "$SIGNATURE" | openssl base64 -d -A > "$SIGBIN" 2>/dev/null

# Verify
RESULT=$(echo -n "$DATA" | openssl dgst -sha256 -verify "$PUBKEY" -signature "$SIGBIN" 2>&1 || true)

rm -f "$PUBKEY" "$SIGBIN"

if echo "$RESULT" | grep -q "Verified OK"; then
  echo "Результат:      ПОДПИСЬ ВЕРНА"
  echo ""
  echo "  Документ \"$DATA\" подписан"
  echo "  на имя $SUBJECT"
  echo "  алгоритмом ECDSA P-256 + SHA-256"
  exit 0
else
  echo "Результат:      ПОДПИСЬ НЕВАЛИДНА"
  echo ""
  echo "  Данные не соответствуют подписи,"
  echo "  или подпись создана другим ключом."
  echo "  OpenSSL: $RESULT"
  exit 1
fi
