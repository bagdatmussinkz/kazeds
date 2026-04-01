#!/bin/bash
# =============================================================
# KazEDS — Верификация подписи
# Использование:
#   ./scripts/verify.sh <данные> <подпись_base64> [публичный_ключ_base64]
#
# Стратегия:
#   1. Если 3 аргумента и ключ SPKI → verify-web.sh (ECDSA, OpenSSL)
#   2. Если CMS формат → ezsigner.kz API (ГОСТ + RSA)
#   3. Если CMS + Docker → Java BouncyCastle (оффлайн)
# =============================================================

set -e

if [ -z "$2" ]; then
  echo "Использование: ./scripts/verify.sh <данные> <подпись_base64> [pubkey_base64]"
  echo ""
  echo "Примеры:"
  echo "  # ECDSA (Web Crypto):"
  echo "  ./scripts/verify.sh \"demo\" \"sig_b64\" \"pubkey_b64\""
  echo ""
  echo "  # ГОСТ (CMS через ezsigner.kz):"
  echo "  ./scripts/verify.sh \"demo\" \"cms_b64\""
  echo ""
  echo "  # ГОСТ (CMS через Java Docker):"
  echo "  VERIFY_MODE=java ./scripts/verify.sh \"demo\" \"cms_b64\""
  exit 1
fi

DATA="$1"
SIG_B64="$2"
PUBKEY_B64="${3:-}"

# ── ECDSA: delegate to verify-web.sh ──
if [ -n "$PUBKEY_B64" ]; then
  exec ./scripts/verify-web.sh "$DATA" "$SIG_B64" "$PUBKEY_B64"
fi

echo "========================================"
echo "  KazEDS — Верификация подписи"
echo "========================================"
echo ""
echo "Данные:    $DATA"
echo "Подпись:   ${SIG_B64:0:40}..."
echo ""

TMPDIR=$(mktemp -d)
trap "rm -rf $TMPDIR" EXIT

echo -n "$SIG_B64" | base64 -d > "$TMPDIR/sig.bin" 2>/dev/null || \
  echo -n "$SIG_B64" | openssl base64 -d -A > "$TMPDIR/sig.bin" 2>/dev/null

SIG_SIZE=$(wc -c < "$TMPDIR/sig.bin" | tr -d ' ')

# ── ezsigner.kz (онлайн, ГОСТ + RSA) ──
if [ "${VERIFY_MODE:-}" != "java" ]; then
  echo "Метод:     ezsigner.kz (НУЦ РК)"
  echo ""

  RESPONSE=$(curl -s -w "\n%{http_code}" \
    -X POST "https://ezsigner.kz/checkSign" \
    -F "signData=@$TMPDIR/sig.bin;type=application/pkcs7-signature;filename=sig.cms" \
    2>/dev/null || echo -e "\n000")

  HTTP_CODE=$(echo "$RESPONSE" | tail -1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  if [ "$HTTP_CODE" = "200" ]; then
    echo "Результат: ПОДПИСЬ ВЕРНА"
    echo ""
    echo "Ответ ezsigner.kz:"
    echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
    exit 0
  elif [ "$HTTP_CODE" = "000" ]; then
    echo "ezsigner.kz недоступен, попробуйте: VERIFY_MODE=java ./scripts/verify.sh ..."
    exit 1
  else
    echo "Результат: ОШИБКА (HTTP $HTTP_CODE)"
    echo "$BODY"
    exit 1
  fi
fi

# ── Java BouncyCastle (оффлайн, Docker) ──
echo "Метод:     Java BouncyCastle (Docker)"
echo ""

cat > "$TMPDIR/Verify.java" << 'JAVAEOF'
import java.nio.file.*;
import java.security.*;
import java.security.cert.X509Certificate;
import java.util.Collection;
import org.bouncycastle.cert.X509CertificateHolder;
import org.bouncycastle.cert.jcajce.JcaX509CertificateConverter;
import org.bouncycastle.cms.*;
import org.bouncycastle.cms.jcajce.JcaSimpleSignerInfoVerifierBuilder;
import org.bouncycastle.jce.provider.BouncyCastleProvider;

public class Verify {
    public static void main(String[] args) throws Exception {
        Security.addProvider(new BouncyCastleProvider());
        byte[] cmsBytes = Files.readAllBytes(Path.of("/data/sig.bin"));
        CMSSignedData signed = new CMSSignedData(cmsBytes);

        for (SignerInformation signer : signed.getSignerInfos().getSigners()) {
            Collection<X509CertificateHolder> certs =
                signed.getCertificates().getMatches(signer.getSID());
            for (X509CertificateHolder certHolder : certs) {
                boolean valid = signer.verify(
                    new JcaSimpleSignerInfoVerifierBuilder()
                        .setProvider("BC")
                        .build(certHolder));
                X509Certificate x509 = new JcaX509CertificateConverter()
                    .setProvider("BC")
                    .getCertificate(certHolder);
                if (valid) {
                    System.out.println("RESULT: VALID");
                    System.out.println("Subject: " + x509.getSubjectX500Principal());
                    System.out.println("Issuer: " + x509.getIssuerX500Principal());
                    System.out.println("Algorithm: " + x509.getSigAlgName());
                    System.out.println("Serial: " + x509.getSerialNumber().toString(16));
                    System.out.println("NotBefore: " + x509.getNotBefore());
                    System.out.println("NotAfter: " + x509.getNotAfter());
                } else {
                    System.out.println("RESULT: INVALID");
                }
                return;
            }
        }
        System.out.println("RESULT: NO_SIGNER_FOUND");
    }
}
JAVAEOF

# Run in Docker with BouncyCastle
RESULT=$(docker run --rm \
  -v "$TMPDIR:/data" -w /data \
  eclipse-temurin:21-jdk-alpine sh -c "
    # Download BouncyCastle
    wget -q -O /data/bcprov.jar https://repo1.maven.org/maven2/org/bouncycastle/bcprov-jdk18on/1.78.1/bcprov-jdk18on-1.78.1.jar
    wget -q -O /data/bcpkix.jar https://repo1.maven.org/maven2/org/bouncycastle/bcpkix-jdk18on/1.78.1/bcpkix-jdk18on-1.78.1.jar
    wget -q -O /data/bcutil.jar https://repo1.maven.org/maven2/org/bouncycastle/bcutil-jdk18on/1.78.1/bcutil-jdk18on-1.78.1.jar
    javac -cp '/data/bcprov.jar:/data/bcpkix.jar:/data/bcutil.jar' /data/Verify.java
    java -cp '/data:/data/bcprov.jar:/data/bcpkix.jar:/data/bcutil.jar' Verify
  " 2>&1)

echo "$RESULT"

if echo "$RESULT" | grep -q "RESULT: VALID"; then
  echo ""
  echo "Результат: ПОДПИСЬ ВЕРНА (Java BouncyCastle)"
  exit 0
else
  echo ""
  echo "Результат: ПОДПИСЬ НЕВАЛИДНА"
  exit 1
fi
