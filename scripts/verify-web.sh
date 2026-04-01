#!/bin/bash
# =============================================================
# KazEDS — Верификация подписи из Web App (ECDSA P-256 raw format)
# Использование: ./scripts/verify-web.sh <данные> <подпись_base64> <публичный_ключ_base64>
#
# Подпись и ключ берутся из ответа Relay (session complete payload).
# Web Crypto ECDSA возвращает raw формат (r||s, 64 байта),
# а не DER-encoded — этот скрипт конвертирует.
# =============================================================

set -e

if [ -z "$3" ]; then
  echo "Использование: ./scripts/verify-web.sh <данные> <подпись_base64> <pubkey_base64>"
  echo ""
  echo "Аргументы:"
  echo "  <данные>          Текст который был подписан"
  echo "  <подпись_base64>  Raw ECDSA подпись (r||s) из Web Crypto API"
  echo "  <pubkey_base64>   SPKI публичный ключ (base64) из Web App"
  echo ""
  echo "Пример:"
  echo "  # Получить данные из relay:"
  echo "  curl https://relay-sign.aitu.uz/v1/sessions/UUID/status"
  echo "  # certificate = pubkey, signature = подпись"
  exit 1
fi

DATA="$1"
SIG_B64="$2"
PUBKEY_B64="$3"

TMPDIR=$(mktemp -d)

echo "========================================"
echo "  KazEDS — Верификация (Web Crypto)"
echo "========================================"
echo ""
echo "Данные:     $DATA"
echo "Подпись:    ${SIG_B64:0:40}..."
echo "Ключ:       ${PUBKEY_B64:0:40}..."
echo ""

# 1. Save SPKI public key as PEM
echo "-----BEGIN PUBLIC KEY-----" > "$TMPDIR/pubkey.pem"
echo "$PUBKEY_B64" | fold -w 64 >> "$TMPDIR/pubkey.pem"
echo "-----END PUBLIC KEY-----" >> "$TMPDIR/pubkey.pem"

# 2. Decode raw signature (r||s, 64 bytes for P-256)
echo "$SIG_B64" | openssl base64 -d -A > "$TMPDIR/sig_raw.bin"
RAW_LEN=$(wc -c < "$TMPDIR/sig_raw.bin" | tr -d ' ')

# 3. Convert raw ECDSA (r||s) to DER format
# DER: 30 <len> 02 <rlen> <r> 02 <slen> <s>
python3 -c "
import sys, struct

with open('$TMPDIR/sig_raw.bin', 'rb') as f:
    raw = f.read()

half = len(raw) // 2
r = raw[:half]
s = raw[half:]

# Remove leading zeros but keep sign bit
def to_signed(b):
    # Strip leading zeros
    i = 0
    while i < len(b) - 1 and b[i] == 0:
        i += 1
    b = b[i:]
    # Add leading zero if high bit set (positive integer)
    if b[0] & 0x80:
        b = b'\x00' + b
    return b

r = to_signed(r)
s = to_signed(s)

r_tlv = b'\x02' + bytes([len(r)]) + r
s_tlv = b'\x02' + bytes([len(s)]) + s
seq = r_tlv + s_tlv
der = b'\x30' + bytes([len(seq)]) + seq

with open('$TMPDIR/sig_der.bin', 'wb') as f:
    f.write(der)
" 2>/dev/null

if [ ! -f "$TMPDIR/sig_der.bin" ]; then
  echo "Ошибка: не удалось конвертировать подпись в DER"
  rm -rf "$TMPDIR"
  exit 1
fi

# 4. Verify with OpenSSL
RESULT=$(echo -n "$DATA" | openssl dgst -sha256 -verify "$TMPDIR/pubkey.pem" -signature "$TMPDIR/sig_der.bin" 2>&1 || true)

rm -rf "$TMPDIR"

if echo "$RESULT" | grep -q "Verified OK"; then
  echo "Результат:  ПОДПИСЬ ВЕРНА"
  echo ""
  echo "  Документ \"$DATA\" подписан"
  echo "  алгоритмом ECDSA P-256 + SHA-256"
  echo "  (Web Crypto API raw format)"
  exit 0
else
  echo "Результат:  ПОДПИСЬ НЕВАЛИДНА"
  echo "  $RESULT"
  exit 1
fi
