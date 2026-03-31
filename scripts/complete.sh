#!/bin/bash
# =============================================================
# KazEDS — Подписать и отправить на Relay (эмуляция телефона)
# Использование: ./scripts/complete.sh [session_id] [данные]
#
# Примеры:
#   ./scripts/complete.sh                          # авто session, данные "demo"
#   ./scripts/complete.sh abc-123-def "контракт"   # конкретная сессия
# =============================================================

set -e

RELAY="http://localhost:3001/v1"
DATA="${2:-demo}"

# Get session ID
if [ -n "$1" ]; then
  SESSION_ID="$1"
else
  SESSION_ID=$(docker logs kazeds-relay --since 30s 2>&1 | grep -o '[0-9a-f]\{8\}-[0-9a-f]\{4\}-[0-9a-f]\{4\}-[0-9a-f]\{4\}-[0-9a-f]\{12\}' | tail -1)
  if [ -z "$SESSION_ID" ]; then
    echo "Активная сессия не найдена. Нажмите 'Войти по ЭЦП' на demo.eds.aitu.uz"
    exit 1
  fi
fi

echo "Session:  $SESSION_ID"
echo "Данные:   $DATA"
echo ""

# Sign
SIGN_RESULT=$(./scripts/sign.sh "$DATA")
SIGNATURE=$(echo "$SIGN_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['signature'])")
CERTIFICATE=$(echo "$SIGN_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['certificate'])")
SUBJECT=$(echo "$SIGN_RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['subject'])")

echo "Подписант: $SUBJECT"
echo "Подпись:   ${SIGNATURE:0:40}..."
echo ""

# Send to relay
RESULT=$(curl -s -X POST "$RELAY/sessions/$SESSION_ID/complete" \
  -H "Content-Type: application/json" \
  -d "{
    \"certificate\": \"$CERTIFICATE\",
    \"signature\": \"$SIGNATURE\",
    \"algorithm\": \"SHA256withECDSA\"
  }")

echo "Relay:     $RESULT"
echo ""
echo "Верификация:"
echo "  ./scripts/verify.sh \"$DATA\" \"$SIGNATURE\""
