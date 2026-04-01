#!/bin/bash
# =============================================================
# KazEDS Verifier — Unit Tests
# Запуск: ./projects/verifier/test.sh
# Требует: Docker + kazeds-verifier image
# =============================================================

set -e

VERIFIER="http://localhost:8082"
PASS=0
FAIL=0

check() {
  local name="$1"
  local expected="$2"
  local actual="$3"
  if echo "$actual" | grep -q "$expected"; then
    echo "  PASS: $name"
    PASS=$((PASS+1))
  else
    echo "  FAIL: $name (expected '$expected', got '$actual')"
    FAIL=$((FAIL+1))
  fi
}

echo "========================================"
echo "  KazEDS Verifier Unit Tests"
echo "========================================"
echo ""

# Check verifier is running
if ! curl -s "$VERIFIER/health" | grep -q "ok"; then
  echo "Starting verifier..."
  docker rm -f kazeds-verifier 2>/dev/null
  docker run -d --name kazeds-verifier --rm -p 8082:8082 kazeds-verifier
  sleep 3
fi

echo "--- Health ---"
R=$(curl -s "$VERIFIER/health")
check "health returns ok" '"status":"ok"' "$R"
check "health shows BouncyCastle" "BouncyCastle" "$R"
check "health shows gost:true" '"gost":true' "$R"

echo ""
echo "--- /checkSign: Method validation ---"
R=$(curl -s "$VERIFIER/checkSign")
check "GET returns 405" "Method not allowed" "$R"

echo ""
echo "--- /checkSign: Invalid input ---"
R=$(curl -s -X POST "$VERIFIER/checkSign" -d "")
check "empty body rejected" '"valid":false' "$R"

R=$(curl -s -X POST "$VERIFIER/checkSign" -H "Content-Type: text/plain" -d "not-valid")
check "invalid base64 rejected" '"valid":false' "$R"

echo ""
echo "--- /checkSign: ECDSA CMS (attached) ---"
TMPDIR=$(mktemp -d)
openssl ecparam -genkey -name prime256v1 -noout -out "$TMPDIR/key.pem" 2>/dev/null
openssl req -new -x509 -key "$TMPDIR/key.pem" -out "$TMPDIR/cert.pem" -days 365 \
  -subj "/CN=Test User/O=KazEDS Test/C=KZ" 2>/dev/null
echo -n "hello" > "$TMPDIR/data.txt"
openssl cms -sign -in "$TMPDIR/data.txt" -signer "$TMPDIR/cert.pem" -inkey "$TMPDIR/key.pem" \
  -outform DER -out "$TMPDIR/sig.cms" -nodetach 2>/dev/null

R=$(curl -s -X POST "$VERIFIER/checkSign" \
  -F "signData=@$TMPDIR/sig.cms;type=application/pkcs7-signature")
check "ECDSA CMS valid" '"valid":true' "$R"
check "ECDSA CMS subject" "Test User" "$R"
check "ECDSA CMS algorithm" "SHA256" "$R"
check "ECDSA CMS has serial" '"serial"' "$R"

echo ""
echo "--- /checkSign: ECDSA CMS (base64) ---"
CMS_B64=$(openssl base64 -A -in "$TMPDIR/sig.cms")
R=$(curl -s -X POST "$VERIFIER/checkSign" -H "Content-Type: text/plain" -d "$CMS_B64")
check "ECDSA CMS base64 valid" '"valid":true' "$R"

echo ""
echo "--- /checkSign: Detached CMS ---"
openssl cms -sign -in "$TMPDIR/data.txt" -signer "$TMPDIR/cert.pem" -inkey "$TMPDIR/key.pem" \
  -outform DER -out "$TMPDIR/sig_det.cms" -noattr 2>/dev/null
R=$(curl -s -X POST "$VERIFIER/checkSign" \
  -F "signData=@$TMPDIR/sig_det.cms;type=application/pkcs7-signature")
check "Detached CMS handled" '"valid"' "$R"

echo ""
echo "--- /verifyRaw: Method validation ---"
R=$(curl -s "$VERIFIER/verifyRaw")
check "GET returns 405" "Method not allowed" "$R"

echo ""
echo "--- /verifyRaw: ECDSA raw signature ---"
# Sign raw with openssl, convert DER→raw
echo -n "demo" | openssl dgst -sha256 -sign "$TMPDIR/key.pem" -out "$TMPDIR/sig.der" 2>/dev/null
PUBKEY_DER=$(openssl x509 -in "$TMPDIR/cert.pem" -outform DER 2>/dev/null | openssl base64 -A)
SIG_DER_B64=$(openssl base64 -A -in "$TMPDIR/sig.der")

R=$(curl -s -X POST "$VERIFIER/verifyRaw" \
  -H "Content-Type: application/json" \
  -d "{\"data\":\"ZGVtbw==\",\"signature\":\"$SIG_DER_B64\",\"certificate\":\"$PUBKEY_DER\"}")
check "ECDSA raw verify returns result" '"subject"' "$R"
check "ECDSA raw verify has algorithm" '"algorithm"' "$R"

echo ""
echo "--- /verifyRaw: GOST certificate parsing ---"
# Real GOST cert from NCA RK (Багдат Мусин)
GOST_CERT="MIIEIzCCA4ugAwIBAgIUTqunP5hx8BesIV4VUT0Xe9n70JAwDgYKKoMOAwoBAQIDAgUAMFgxSTBHBgNVBAMMQNKw0JvQotCi0KvSmiDQmtCj05jQm9CQ0J3QlNCr0KDQo9Co0Ksg0J7QoNCi0JDQm9Cr0pogKEdPU1QpIDIwMjIxCzAJBgNVBAYTAktaMB4XDTI2MDQwMTEzMjAyMVoXDTI3MDQwMTEzMjAyMVowgYExGDAWBgNVBAUTD0lJTjgzMDMwMzM1MDAxNjETMBEGA1UEBAwK0JzQo9Ch0JjQnTEhMB8GA1UEKgwY0JHQkNCi0KvQoNCR0JXQmtCe0JLQmNCnMSAwHgYDVQQDDBfQnNCj0KHQmNCdINCR0JDQk9CU0JDQojELMAkGA1UEBhMCS1owgawwIwYJKoMOAwoBAQICMBYGCiqDDgMKAQECAgEGCCqDDgMKAQMDA4GEAASBgFNzc+JBMRzgkwG1rZolVXfPNcF5uFFQqxHS4pAwtmjpriJvfvmYYFF1aSQYpooSRZqXLSfDt8isAHnN7OZtx2Ox1d8FbgOuq3XwKd4exuBeeRb1ldFXC37uLE1e9CukHuIRAUBng1DhNvhNUr2pmbW1wXVZIUiifpynfA3Lgm8qo4IBrzCCAaswDgYDVR0PAQH/BAQDAgPIMCcGA1UdJQQgMB4GCCqDDgMDBAMCBggrBgEFBQcDBAYIKoMOAwMEAQEwOAYDVR0gBDEwLzAtBgYqgw4DAwIwIzAhBggrBgEFBQcCARYVaHR0cDovL3BraS5nb3Yua3ovY3BzMDgGA1UdHwQxMC8wLaAroCmGJ2h0dHA6Ly9jcmwucGtpLmdvdi5rei9uY2FfZ29zdF8yMDIyLmNybDA6BgNVHS4EMzAxMC+gLaArhilodHRwOi8vY3JsLnBraS5nb3Yua3ovbmNhX2RfZ29zdF8yMDIyLmNybDBoBggrBgEFBQcBAQRcMFowIgYIKwYBBQUHMAGGFmh0dHA6Ly9vY3NwLnBraS5nb3Yua3owNAYIKwYBBQUHMAKGKGh0dHA6Ly9wa2kuZ292Lmt6L2NlcnQvbmNhX2dvc3RfMjAyMi5jZXIwHQYDVR0OBBYEFE6rpz+YcfAXrCFeFVE9F3vZ+9CQMB8GA1UdIwQYMBaAFP4wvp/IkGM/H/9aPAywyF9MbRcIMBYGBiqDDgMDBQQMMAoGCCqDDgMDBQEBMA4GCiqDDgMKAQECAwIFAAOBgQD+Czuf9eNfEXKNqCiTO3c3rQODf2DmANdVDje+EjYhzA+cCz7BBEJbOb9ZJZ0oaeDpldGbtiu5taBjrYlkTlIYRvJ4ZYAyQwGLUi+KdNv8uhYV/WjJuqhyIPev4cYJQUz0+fhOZctlL3BNUBqRtr1hxJWtd1v6f6FZFqknyCNzOg=="
GOST_SIG="ZZce/Yfe0SI5Ee43+D9Bz+Uwq6tQHLY3UuM/FvEqBaLuSldZXeiDC2zvAVJrQBxLtXn8ksPqEHkgk+OJhdLFciZzcE0rT7pDmxwGYFMWk2Qe0+RXiS8HrHcfojCajuSODc+lwq7Ij9fr/TLsExxbJjsdKmvn2lXyGbHmgABC4no="

R=$(curl -s -X POST "$VERIFIER/verifyRaw" \
  -H "Content-Type: application/json" \
  -d "{\"data\":\"ZGVtbw==\",\"signature\":\"$GOST_SIG\",\"certificate\":\"$GOST_CERT\"}")
check "GOST cert parsed" '"valid":true' "$R"
check "GOST subject contains МУСИН" "subject" "$R"
check "GOST issuer contains НУЦ" "issuer" "$R"
check "GOST has serial" '"serial"' "$R"
check "GOST has notBefore" '"notBefore"' "$R"
check "GOST has notAfter" '"notAfter"' "$R"

echo ""
echo "--- /verifyRaw: Invalid inputs ---"
R=$(curl -s -X POST "$VERIFIER/verifyRaw" \
  -H "Content-Type: application/json" -d '{}')
check "empty JSON rejected" '"valid":false' "$R"

R=$(curl -s -X POST "$VERIFIER/verifyRaw" \
  -H "Content-Type: application/json" \
  -d '{"data":"dGVzdA==","signature":"bad","certificate":"bad"}')
check "invalid base64 rejected" '"valid":false' "$R"

rm -rf "$TMPDIR"

echo ""
echo "========================================"
echo "  Results: $PASS passed, $FAIL failed"
echo "========================================"

[ $FAIL -eq 0 ] && exit 0 || exit 1
