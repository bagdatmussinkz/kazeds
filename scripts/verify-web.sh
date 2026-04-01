#!/bin/bash
# =============================================================
# KazEDS — Верификация подписи из Web App (ECDSA P-256)
# Использование: ./scripts/verify-web.sh <данные> <подпись_base64> <pubkey_base64>
# =============================================================

set -e

if [ -z "$3" ]; then
  echo "Использование: ./scripts/verify-web.sh <данные> <подпись_base64> <pubkey_base64>"
  exit 1
fi

DATA="$1"
SIG_B64="$2"
PUBKEY_B64="$3"

TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

echo "========================================"
echo "  KazEDS — Верификация (Web Crypto)"
echo "========================================"
echo ""
echo "Данные:     $DATA"
echo "Подпись:    ${SIG_B64:0:40}..."
echo "Ключ:       ${PUBKEY_B64:0:40}..."
echo ""

# 1. Save SPKI public key as PEM
{
  echo "-----BEGIN PUBLIC KEY-----"
  echo "$PUBKEY_B64" | fold -w 64
  echo "-----END PUBLIC KEY-----"
} > "$TMPDIR/pubkey.pem"

# 2. Decode raw signature
echo -n "$SIG_B64" | openssl base64 -d -A > "$TMPDIR/sig_raw.bin"

# 3. Convert raw ECDSA (r||s, 64 bytes) to DER
python3 -c "
import sys
with open('$TMPDIR/sig_raw.bin', 'rb') as f:
    raw = f.read()
half = len(raw) // 2
r, s = raw[:half], raw[half:]
def enc(b):
    i = 0
    while i < len(b)-1 and b[i]==0: i+=1
    b = b[i:]
    if b[0]&0x80: b = b'\x00'+b
    return b'\x02'+bytes([len(b)])+b
body = enc(r)+enc(s)
der = b'\x30'+bytes([len(body)])+body
with open('$TMPDIR/sig_der.bin', 'wb') as f:
    f.write(der)
"

# 4. Verify
RESULT=$(echo -n "$DATA" | openssl dgst -sha256 -verify "$TMPDIR/pubkey.pem" -signature "$TMPDIR/sig_der.bin" 2>&1 || true)

if echo "$RESULT" | grep -q "Verified OK"; then
  echo "Результат:  ПОДПИСЬ ВЕРНА"
  echo ""
  echo "  Документ \"$DATA\" подписан"
  echo "  алгоритмом ECDSA P-256 + SHA-256"
  exit 0
else
  echo "Результат:  ПОДПИСЬ НЕВАЛИДНА"
  echo "  $RESULT"
  exit 1
fi
