#!/bin/bash
# =============================================================
# KazEDS — Верификация подписи
#
# Использование:
#   ./scripts/verify.sh <данные> <подпись_base64> [публичный_ключ_base64]
#
#   ECDSA: 3 аргумента → verify-web.sh (OpenSSL)
#   ГОСТ:  2 аргумента → наш Verifier (Java BouncyCastle)
# =============================================================

set -e

VERIFIER_URL="${VERIFIER_URL:-http://localhost:8082}"

if [ -z "$2" ]; then
  echo "Использование: ./scripts/verify.sh <данные> <подпись> [pubkey]"
  echo ""
  echo "  ECDSA: ./scripts/verify.sh \"demo\" \"sig\" \"pubkey\""
  echo "  ГОСТ:  ./scripts/verify.sh \"demo\" \"cms_b64\""
  exit 1
fi

DATA="$1"
SIG_B64="$2"
PUBKEY_B64="${3:-}"

# ECDSA (SPKI key starts with MFk) → verify-web.sh
if [ -n "$PUBKEY_B64" ] && echo "$PUBKEY_B64" | grep -q "^MFk"; then
  exec ./scripts/verify-web.sh "$DATA" "$SIG_B64" "$PUBKEY_B64"
fi

# GOST (X.509 cert starts with MIIE) → Docker verifier /verifyRaw
if [ -n "$PUBKEY_B64" ] && echo "$PUBKEY_B64" | grep -q "^MII"; then
  echo "========================================"
  echo "  KazEDS — Верификация (Java ГОСТ)"
  echo "========================================"
  echo ""
  echo "Данные:    $DATA"
  echo "Подпись:   ${SIG_B64:0:40}..."
  echo "Сервер:    $VERIFIER_URL"
  echo ""

  DATA_B64=$(echo -n "$DATA" | openssl base64 -A)

  RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X POST "$VERIFIER_URL/verifyRaw" \
    -H "Content-Type: application/json" \
    -d "{\"data\":\"$DATA_B64\",\"signature\":\"$SIG_B64\",\"certificate\":\"$PUBKEY_B64\"}" \
    2>/dev/null || echo -e "\n000")

  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  if echo "$BODY" | grep -q '"valid":true'; then
    echo "Результат: ПОДПИСЬ ВЕРНА"
    echo ""
    echo "$BODY" | python3 -c "
import sys,json
d = json.load(sys.stdin)
print('  Субъект:    ', d.get('subject',''))
print('  Издатель:   ', d.get('issuer',''))
print('  Serial:      ', d.get('serial',''))
print('  Действует:   ', d.get('notBefore',''), '—', d.get('notAfter',''))
if d.get('note'): print('  Примечание:  ', d.get('note'))
" 2>/dev/null || echo "  $BODY"
    exit 0
  elif [ "$HTTP_CODE" = "000" ]; then
    echo "Verifier недоступен. Запустите Docker."
    exit 1
  else
    echo "Результат: ПОДПИСЬ НЕВАЛИДНА (HTTP $HTTP_CODE)"
    echo "  $BODY"
    exit 1
  fi
fi

# ГОСТ → наш Java Verifier
echo "========================================"
echo "  KazEDS — Верификация (Java ГОСТ)"
echo "========================================"
echo ""
echo "Данные:    $DATA"
echo "Подпись:   ${SIG_B64:0:40}..."
echo "Сервер:    $VERIFIER_URL"
echo ""

TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

echo -n "$SIG_B64" | base64 -d > "$TMPDIR/sig.bin" 2>/dev/null || \
  echo -n "$SIG_B64" | openssl base64 -d -A > "$TMPDIR/sig.bin" 2>/dev/null

RESPONSE=$(curl -s -w "\n%{http_code}" \
  -X POST "$VERIFIER_URL/checkSign" \
  -F "signData=@$TMPDIR/sig.bin;type=application/pkcs7-signature;filename=sig.cms" \
  2>/dev/null || echo -e "\n000")

HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY=$(echo "$RESPONSE" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  echo "Результат: ПОДПИСЬ ВЕРНА"
  echo ""
  echo "$BODY" | python3 -c "
import sys,json
d = json.load(sys.stdin)
print('  Субъект:    ', d.get('subject',''))
print('  Издатель:   ', d.get('issuer',''))
print('  Алгоритм:   ', d.get('algorithm',''))
print('  Serial:      ', d.get('serial',''))
print('  Действует:   ', d.get('notBefore',''), '—', d.get('notAfter',''))
" 2>/dev/null || echo "  $BODY"
  exit 0
elif [ "$HTTP_CODE" = "000" ]; then
  echo "Verifier недоступен."
  echo "Запустите: docker run -d --name kazeds-verifier -p 8082:8082 kazeds-verifier"
  exit 1
else
  echo "Результат: ПОДПИСЬ НЕВАЛИДНА (HTTP $HTTP_CODE)"
  echo "  $BODY"
  exit 1
fi
