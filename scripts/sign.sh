#!/bin/bash
# =============================================================
# KazEDS — Подписание данных
# Использование: ./scripts/sign.sh <данные> [ключ.pem]
#
# Примеры:
#   ./scripts/sign.sh "demo"
#   ./scripts/sign.sh "Hello World" ./my-key.pem
#   echo "contract text" | ./scripts/sign.sh -
# =============================================================

set -e

if [ -z "$1" ]; then
  echo "Использование: ./scripts/sign.sh <данные> [ключ.pem]"
  echo ""
  echo "Аргументы:"
  echo "  <данные>    Текст для подписи (или - для stdin)"
  echo "  [ключ.pem]  Приватный ключ ECDSA (по умолчанию генерируется)"
  echo ""
  echo "Примеры:"
  echo "  ./scripts/sign.sh \"demo\""
  echo "  ./scripts/sign.sh \"Hello\" ./keys/private.pem"
  exit 1
fi

# Read data
if [ "$1" = "-" ]; then
  DATA=$(cat)
else
  DATA="$1"
fi

KEY_FILE="${2:-}"

# Generate key if not provided
if [ -z "$KEY_FILE" ]; then
  KEY_FILE="/tmp/kazeds-key.pem"
  CERT_FILE="/tmp/kazeds-cert.pem"

  if [ ! -f "$KEY_FILE" ]; then
    echo "Генерация ключа ECDSA P-256..." >&2
    openssl ecparam -genkey -name prime256v1 -noout -out "$KEY_FILE" 2>/dev/null
    openssl req -new -x509 -key "$KEY_FILE" -out "$CERT_FILE" -days 365 \
      -subj "/CN=Bagdat Mussin/O=KazEDS Demo/C=KZ" 2>/dev/null
    echo "Ключ:        $KEY_FILE" >&2
    echo "Сертификат:  $CERT_FILE" >&2
  fi
else
  CERT_FILE="${KEY_FILE%.pem}-cert.pem"
fi

# Sign
SIGNATURE=$(echo -n "$DATA" | openssl dgst -sha256 -sign "$KEY_FILE" | openssl base64 -A)

# Certificate base64 DER
if [ -f "$CERT_FILE" ]; then
  CERT_B64=$(openssl x509 -in "$CERT_FILE" -outform DER | openssl base64 -A)
  SUBJECT=$(openssl x509 -in "$CERT_FILE" -noout -subject -nameopt RFC2253 2>/dev/null | sed 's/subject=//')
else
  CERT_B64=""
  SUBJECT=""
fi

# Output JSON
cat <<EOF
{
  "data": "$(echo -n "$DATA" | openssl base64 -A)",
  "data_text": "$DATA",
  "signature": "$SIGNATURE",
  "certificate": "$CERT_B64",
  "algorithm": "SHA256withECDSA",
  "subject": "$SUBJECT"
}
EOF
