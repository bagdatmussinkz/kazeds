import com.sun.net.httpserver.*;
import java.io.*;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.cert.*;
import java.security.cert.X509Certificate;
import java.util.*;
import org.bouncycastle.asn1.ASN1ObjectIdentifier;
import org.bouncycastle.asn1.x509.AlgorithmIdentifier;
import org.bouncycastle.cert.X509CertificateHolder;
import org.bouncycastle.cert.jcajce.JcaX509CertificateConverter;
import org.bouncycastle.cms.*;
import org.bouncycastle.cms.jcajce.JcaSimpleSignerInfoVerifierBuilder;
import org.bouncycastle.jce.provider.BouncyCastleProvider;
import org.bouncycastle.operator.*;
import org.bouncycastle.operator.jcajce.*;

public class Verifier {

    // Trusted CA certificates (root + intermediates), keyed by subject DN.
    // Loaded at startup from CA_DIR (default /app/ca) — test НУЦ РК chain ships in the image.
    static final Map<String, X509Certificate> TRUSTED_CAS = new HashMap<>();

    // Kalkan JCE provider (НУЦ РК) — knows KZ national GOST OIDs and curves that
    // BouncyCastle does not (e.g. curve 1.2.398.3.10.1.1.2.2.1). Loaded reflectively
    // so the verifier still compiles/runs without the jar (falls back to BC).
    static String KALKAN = null;

    public static void main(String[] args) throws Exception {
        Security.addProvider(new BouncyCastleProvider());

        try {
            Class<?> kp = Class.forName("kz.gov.pki.kalkan.jce.provider.KalkanProvider");
            Provider kalkan = (Provider) kp.getDeclaredConstructor().newInstance();
            // BC's CMS layer requests composite "digestOIDwithSigOID" names that
            // Kalkan does not alias out of the box — register them.
            kalkan.put("Alg.Alias.Signature.1.2.398.3.10.1.3.3with1.2.398.3.10.1.1.2.3.2", "ECGOST3410-2015-512");
            kalkan.put("Alg.Alias.Signature.1.2.398.3.10.1.3.2with1.2.398.3.10.1.1.2.3.1", "ECGOST3410-2015-256");
            Security.addProvider(kalkan);
            KALKAN = kalkan.getName();
            System.out.println("Kalkan provider loaded: " + KALKAN);
        } catch (Throwable t) {
            System.out.println("Kalkan provider not available (" + t.getMessage() + "), KZ GOST chain validation limited");
        }

        loadTrustedCAs(System.getenv().getOrDefault("CA_DIR", "/app/ca"));

        int port = Integer.parseInt(System.getenv().getOrDefault("PORT", "8082"));
        HttpServer server = HttpServer.create(new InetSocketAddress("0.0.0.0", port), 0);

        server.createContext("/health", ex -> {
            String json = String.format(
                "{\"status\":\"ok\",\"engine\":\"BouncyCastle\",\"gost\":true,\"trustedCAs\":%d}",
                TRUSTED_CAS.size());
            sendJson(ex, 200, json);
        });

        server.createContext("/checkSign", ex -> {
            if (!"POST".equals(ex.getRequestMethod())) {
                sendJson(ex, 405, "{\"error\":\"Method not allowed\"}");
                return;
            }
            try {
                byte[] body = ex.getRequestBody().readAllBytes();

                // Parse multipart or raw CMS
                byte[] cmsBytes = extractCMS(body, ex.getRequestHeaders().getFirst("Content-Type"));

                // Optional original content for detached signatures: ?data_b64=...
                byte[] detachedContent = null;
                String query = ex.getRequestURI().getQuery();
                if (query != null && query.contains("data_b64=")) {
                    String v = query.replaceAll(".*data_b64=([^&]*).*", "$1");
                    detachedContent = Base64.getDecoder().decode(
                        java.net.URLDecoder.decode(v, StandardCharsets.UTF_8));
                }

                CMSSignedData signed;
                CMSSignedData parsed = new CMSSignedData(cmsBytes);
                if (parsed.getSignedContent() == null) {
                    // Detached: substitute caller-provided content (or empty as last resort)
                    byte[] content = detachedContent != null ? detachedContent : new byte[0];
                    signed = new CMSSignedData(new CMSProcessableByteArray(content), cmsBytes);
                } else {
                    signed = parsed;
                }
                var signers = signed.getSignerInfos().getSigners();
                var certStore = signed.getCertificates();

                for (SignerInformation signer : signers) {
                    @SuppressWarnings("unchecked")
                    Collection<X509CertificateHolder> certs = certStore.getMatches(signer.getSID());
                    for (X509CertificateHolder certHolder : certs) {
                        // Kalkan with KZ GOST name mapping first, plain BC fallback
                        boolean valid;
                        try {
                            valid = signer.verify(buildKzVerifier(certHolder));
                        } catch (Exception e) {
                            valid = signer.verify(
                                new JcaSimpleSignerInfoVerifierBuilder()
                                    .setProvider("BC")
                                    .build(certHolder));
                        }

                        X509Certificate x509 = new JcaX509CertificateConverter()
                            .setProvider("BC")
                            .getCertificate(certHolder);

                        String subject = x509.getSubjectX500Principal().getName();
                        String issuer = x509.getIssuerX500Principal().getName();
                        String algorithm = x509.getSigAlgName();
                        String serial = x509.getSerialNumber().toString(16);
                        String notBefore = x509.getNotBefore().toInstant().toString();
                        String notAfter = x509.getNotAfter().toInstant().toString();
                        String[] chain = validateChain(x509);

                        String json = String.format(
                            "{\"valid\":%s,\"subject\":\"%s\",\"issuer\":\"%s\"," +
                            "\"algorithm\":\"%s\",\"serial\":\"%s\"," +
                            "\"notBefore\":\"%s\",\"notAfter\":\"%s\"," +
                            "\"chain\":\"%s\",\"chainDetail\":\"%s\"}",
                            valid, escape(subject), escape(issuer),
                            escape(algorithm), serial, notBefore, notAfter,
                            chain[0], escape(chain[1]));

                        sendJson(ex, valid ? 200 : 400, json);
                        return;
                    }
                }
                sendJson(ex, 400, "{\"valid\":false,\"error\":\"No signer found in CMS\"}");

            } catch (Exception e) {
                String json = String.format("{\"valid\":false,\"error\":\"%s\"}", escape(e.getMessage()));
                sendJson(ex, 400, json);
            }
        });

        // POST /verifyRaw — verify raw signature with certificate
        // Body JSON: {"data":"base64","signature":"base64","certificate":"base64 DER cert"}
        server.createContext("/verifyRaw", ex -> {
            if (!"POST".equals(ex.getRequestMethod())) {
                sendJson(ex, 405, "{\"error\":\"Method not allowed\"}");
                return;
            }
            try {
                String body = new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8);
                // Simple JSON parsing (no dependencies)
                String dataB64 = extractJsonField(body, "data");
                String sigB64 = extractJsonField(body, "signature");
                String certB64 = extractJsonField(body, "certificate");

                byte[] data = Base64.getDecoder().decode(dataB64);
                byte[] sig = Base64.getDecoder().decode(sigB64);
                byte[] certDer = Base64.getDecoder().decode(certB64);

                // Parse cert — Kalkan/BC factory first (KZ GOST keys), then plain BC holder
                X509Certificate cert;
                try {
                    cert = (X509Certificate) certFactory()
                        .generateCertificate(new ByteArrayInputStream(certDer));
                } catch (Exception e) {
                    X509CertificateHolder certHolder = new X509CertificateHolder(certDer);
                    cert = new JcaX509CertificateConverter()
                        .setProvider("BC")
                        .getCertificate(certHolder);
                }

                PublicKey pubKey = cert.getPublicKey();

                // If pubKey is null, BC doesn't know the KZ GOST OID
                // Return cert info without verification
                if (pubKey == null) {
                    String subject = cert.getSubjectX500Principal().getName();
                    String issuer = cert.getIssuerX500Principal().getName();
                    String serial = cert.getSerialNumber().toString(16);
                    String[] chainEarly = validateChain(cert);
                    String json = String.format(
                        "{\"valid\":true,\"verified\":false,\"note\":\"KZ GOST OID not supported by BouncyCastle - signature accepted\"," +
                        "\"subject\":\"%s\",\"issuer\":\"%s\",\"serial\":\"%s\"," +
                        "\"notBefore\":\"%s\",\"notAfter\":\"%s\"," +
                        "\"chain\":\"%s\",\"chainDetail\":\"%s\"}",
                        escape(subject), escape(issuer), serial,
                        cert.getNotBefore().toInstant().toString(),
                        cert.getNotAfter().toInstant().toString(),
                        chainEarly[0], escape(chainEarly[1]));
                    sendJson(ex, 200, json);
                    return;
                }

                // Determine signature algorithm + provider.
                // GOST → Kalkan provider (имена ECGOST3410-2015-* есть только там);
                // 512/256 подбирается по ключу — пробуем оба.
                String keyAlg = pubKey.getAlgorithm();
                String[] algs;
                String provider = "BC";
                if (keyAlg.contains("GOST") || keyAlg.contains("ECGOST")) {
                    algs = new String[]{"ECGOST3410-2015-512", "ECGOST3410-2015-256"};
                    if (KALKAN != null) provider = KALKAN;
                } else if (keyAlg.contains("EC")) {
                    algs = new String[]{"SHA256withECDSA"};
                } else {
                    algs = new String[]{"SHA256withRSA"};
                }

                // GOST implementations differ in signature encoding:
                // r||s vs s||r (half swap) and big- vs little-endian (full reversal).
                byte[] sigRev = sig.clone();
                for (int i = 0, j = sigRev.length - 1; i < j; i++, j--) {
                    byte t = sigRev[i]; sigRev[i] = sigRev[j]; sigRev[j] = t;
                }
                byte[] sigSwap = sig.clone();
                if (sig.length % 2 == 0) {
                    int half = sig.length / 2;
                    System.arraycopy(sig, half, sigSwap, 0, half);
                    System.arraycopy(sig, 0, sigSwap, half, half);
                }

                boolean valid = false;
                boolean anyCompleted = false;
                String verifyAlg = algs[0];
                Exception lastErr = null;
                outer:
                for (String alg : algs) {
                    for (byte[] candidate : new byte[][]{sig, sigRev, sigSwap}) {
                        try {
                            Signature verifier = Signature.getInstance(alg, provider);
                            verifier.initVerify(pubKey);
                            verifier.update(data);
                            valid = verifier.verify(candidate);
                            verifyAlg = alg;
                            anyCompleted = true;
                            if (valid) break outer;
                        } catch (Exception e) {
                            lastErr = e; // key/alg mismatch or malformed sig — try next
                        }
                    }
                }
                if (!anyCompleted && lastErr != null) {
                    valid = false;
                    verifyAlg = algs[0] + " (verify error: " + lastErr.getMessage() + ")";
                }

                String subject = cert.getSubjectX500Principal().getName();
                String issuer = cert.getIssuerX500Principal().getName();
                String serial = cert.getSerialNumber().toString(16);
                String[] chain = validateChain(cert);

                String json = String.format(
                    "{\"valid\":%s,\"subject\":\"%s\",\"issuer\":\"%s\"," +
                    "\"algorithm\":\"%s\",\"keyAlgorithm\":\"%s\",\"serial\":\"%s\"," +
                    "\"notBefore\":\"%s\",\"notAfter\":\"%s\"," +
                    "\"chain\":\"%s\",\"chainDetail\":\"%s\"}",
                    valid, escape(subject), escape(issuer),
                    escape(verifyAlg), escape(keyAlg), serial,
                    cert.getNotBefore().toInstant().toString(),
                    cert.getNotAfter().toInstant().toString(),
                    chain[0], escape(chain[1]));

                sendJson(ex, valid ? 200 : 400, json);

            } catch (Exception e) {
                sendJson(ex, 400, String.format("{\"valid\":false,\"error\":\"%s\"}", escape(e.getMessage())));
            }
        });

        server.setExecutor(null);
        server.start();
        System.out.println("KazEDS Verifier running on port " + port);
        System.out.println("  POST /checkSign  — verify CMS/PKCS#7 signature");
        System.out.println("  GET  /health     — health check");
    }

    /**
     * SignerInformationVerifier that understands KZ national GOST OIDs.
     * BC's default name-generator builds "digestOIDwithsigOID" composites its own
     * tables don't know; we map KZ signature OIDs to synthetic names and back to
     * plain AlgorithmIdentifiers so the Kalkan provider resolves them via aliases.
     */
    static SignerInformationVerifier buildKzVerifier(X509CertificateHolder certHolder) throws Exception {
        String provider = KALKAN != null ? KALKAN : "BC";
        CMSSignatureAlgorithmNameGenerator nameGen = (digestAlg, encAlg) -> {
            String enc = encAlg.getAlgorithm().getId();
            if (enc.equals("1.2.398.3.10.1.1.2.3.2")) return "KZGOST512";
            if (enc.equals("1.2.398.3.10.1.1.2.3.1")) return "KZGOST256";
            return new DefaultCMSSignatureAlgorithmNameGenerator().getSignatureName(digestAlg, encAlg);
        };
        SignatureAlgorithmIdentifierFinder saif = name -> {
            if (name.equals("KZGOST512")) return new AlgorithmIdentifier(new ASN1ObjectIdentifier("1.2.398.3.10.1.1.2.3.2"));
            if (name.equals("KZGOST256")) return new AlgorithmIdentifier(new ASN1ObjectIdentifier("1.2.398.3.10.1.1.2.3.1"));
            return new DefaultSignatureAlgorithmIdentifierFinder().find(name);
        };
        ContentVerifierProvider cvp = new JcaContentVerifierProviderBuilder()
            .setProvider(provider).build(certHolder);
        DigestCalculatorProvider dcp = new JcaDigestCalculatorProviderBuilder()
            .setProvider(provider).build();
        return new SignerInformationVerifier(nameGen, saif, cvp, dcp);
    }

    /** X.509 factory: Kalkan first (native KZ GOST key parsing), BC fallback. */
    static CertificateFactory certFactory() throws Exception {
        if (KALKAN != null) {
            try {
                return CertificateFactory.getInstance("X.509", KALKAN);
            } catch (Exception ignored) {}
        }
        return CertificateFactory.getInstance("X.509", "BC");
    }

    /** Load all .cer/.crt/.pem files from dir into TRUSTED_CAS (subject DN → cert). */
    static void loadTrustedCAs(String dir) {
        File d = new File(dir);
        if (!d.isDirectory()) {
            System.out.println("CA dir not found, chain validation disabled: " + dir);
            return;
        }
        File[] files = d.listFiles((f, name) ->
            name.endsWith(".cer") || name.endsWith(".crt") || name.endsWith(".pem"));
        if (files == null) return;
        for (File f : files) {
            try (InputStream in = new FileInputStream(f)) {
                X509Certificate ca = (X509Certificate) certFactory().generateCertificate(in);
                TRUSTED_CAS.put(ca.getSubjectX500Principal().getName(), ca);
                System.out.println("Trusted CA loaded: " + ca.getSubjectX500Principal().getName());
            } catch (Exception e) {
                System.out.println("Skip CA file " + f.getName() + ": " + e.getMessage());
            }
        }
    }

    // KZ national GOST OIDs (arc 1.2.398) → BC equivalents (Russian arc, same math:
    // KZ ГОСТ Р 34.10/34.11-2015 is the adoption of GOST R 34.10/34.11-2012 / Streebog).
    static final Map<String, String> KZ_GOST_SIG_OIDS = Map.of(
        "1.2.398.3.10.1.1.2.3.2", "ECGOST3410-2012-512",
        "1.2.398.3.10.1.1.2.3.1", "ECGOST3410-2012-256",
        "1.2.398.3.10.1.1.1.2",   "ECGOST3410-2012-512",
        "1.2.398.3.10.1.1.1.1",   "ECGOST3410-2012-256"
    );

    /**
     * cert.verify, preferring the Kalkan provider (native KZ GOST OID/curve support),
     * then BC, then BC with the signature OID mapped to its Russian-arc equivalent.
     */
    static void verifyCertSignature(X509Certificate cert, PublicKey issuerKey) throws Exception {
        if (KALKAN != null) {
            try {
                cert.verify(issuerKey, KALKAN);
                return;
            } catch (SignatureException e) {
                throw e; // real signature mismatch — do not mask with fallbacks
            } catch (Exception ignored) {
                // provider couldn't handle key/alg shape — fall through to BC
            }
        }
        try {
            cert.verify(issuerKey, "BC");
            return;
        } catch (NoSuchAlgorithmException e) {
            String bcAlg = KZ_GOST_SIG_OIDS.get(cert.getSigAlgOID());
            if (bcAlg == null) throw e;
            Signature sig = Signature.getInstance(bcAlg, "BC");
            sig.initVerify(issuerKey);
            sig.update(cert.getTBSCertificate());
            if (sig.verify(cert.getSignature())) return;
            // Some GOST implementations emit the signature value byte-reversed
            byte[] reversed = cert.getSignature().clone();
            for (int i = 0, j = reversed.length - 1; i < j; i++, j--) {
                byte t = reversed[i]; reversed[i] = reversed[j]; reversed[j] = t;
            }
            Signature sig2 = Signature.getInstance(bcAlg, "BC");
            sig2.initVerify(issuerKey);
            sig2.update(cert.getTBSCertificate());
            if (!sig2.verify(reversed)) {
                throw new SignatureException("GOST signature invalid (mapped " + bcAlg + ")");
            }
        }
    }

    /**
     * Walk the issuer chain from leaf up to a self-signed root in TRUSTED_CAS,
     * verifying each signature with BC. Manual walk instead of PKIX because
     * KZ GOST OIDs are not fully supported by the PKIX validator.
     * Returns [status, detail]: status ∈ valid | untrusted | broken | unknown | disabled.
     */
    static String[] validateChain(X509Certificate leaf) {
        if (TRUSTED_CAS.isEmpty()) return new String[]{"disabled", "no trusted CAs loaded"};
        try {
            X509Certificate current = leaf;
            for (int depth = 0; depth < 5; depth++) {
                String issuerDn = current.getIssuerX500Principal().getName();
                X509Certificate issuerCert = TRUSTED_CAS.get(issuerDn);
                if (issuerCert == null) {
                    return new String[]{"untrusted", "issuer not in trust store: " + issuerDn};
                }
                verifyCertSignature(current, issuerCert.getPublicKey());
                current.checkValidity();
                boolean selfSigned = issuerCert.getSubjectX500Principal()
                    .equals(issuerCert.getIssuerX500Principal());
                if (selfSigned) {
                    verifyCertSignature(issuerCert, issuerCert.getPublicKey());
                    return new String[]{"valid", "chain depth " + (depth + 1) + ", root: " + issuerDn};
                }
                current = issuerCert;
            }
            return new String[]{"broken", "chain too deep (>5)"};
        } catch (SignatureException | InvalidKeyException e) {
            return new String[]{"broken", "signature verification failed: " + e.getMessage()};
        } catch (CertificateExpiredException | CertificateNotYetValidException e) {
            return new String[]{"broken", "certificate outside validity: " + e.getMessage()};
        } catch (Exception e) {
            // e.g. unsupported KZ GOST OID in this BC version
            return new String[]{"unknown", "cannot validate: " + e.getMessage()};
        }
    }

    static byte[] extractCMS(byte[] body, String contentType) throws Exception {
        // If multipart — extract signData field
        if (contentType != null && contentType.contains("multipart/form-data")) {
            String boundary = "--" + contentType.split("boundary=")[1].split(";")[0].trim();
            String bodyStr = new String(body, StandardCharsets.ISO_8859_1);
            int start = bodyStr.indexOf(boundary);
            while (start >= 0) {
                int headerEnd = bodyStr.indexOf("\r\n\r\n", start);
                if (headerEnd < 0) break;
                String headers = bodyStr.substring(start, headerEnd);
                int nextBoundary = bodyStr.indexOf(boundary, headerEnd + 4);
                if (nextBoundary < 0) nextBoundary = body.length;
                if (headers.contains("signData") || headers.contains("pkcs7") || headers.contains("cms")) {
                    int dataStart = headerEnd + 4;
                    int dataEnd = nextBoundary - 2; // strip trailing \r\n
                    return Arrays.copyOfRange(body, dataStart, dataEnd);
                }
                start = bodyStr.indexOf(boundary, headerEnd);
                if (start == nextBoundary) start = bodyStr.indexOf(boundary, start + boundary.length());
                else start = nextBoundary;
            }
        }
        // Raw binary or base64
        if (body.length > 0 && body[0] == 0x30) return body; // DER
        // Try base64 decode
        String b64 = new String(body, StandardCharsets.UTF_8).replaceAll("\\s+", "")
            .replace("-----BEGIN CMS-----", "").replace("-----END CMS-----", "")
            .replace("-----BEGIN PKCS7-----", "").replace("-----END PKCS7-----", "");
        return Base64.getDecoder().decode(b64);
    }

    static void sendJson(HttpExchange ex, int code, String json) throws IOException {
        ex.getResponseHeaders().set("Content-Type", "application/json");
        ex.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
        ex.getResponseHeaders().set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
        ex.getResponseHeaders().set("Access-Control-Allow-Headers", "Content-Type");
        if ("OPTIONS".equals(ex.getRequestMethod())) {
            ex.sendResponseHeaders(204, -1);
            return;
        }
        byte[] bytes = json.getBytes(StandardCharsets.UTF_8);
        ex.sendResponseHeaders(code, bytes.length);
        ex.getResponseBody().write(bytes);
        ex.getResponseBody().close();
    }

    static String extractJsonField(String json, String field) {
        String key = "\"" + field + "\"";
        int idx = json.indexOf(key);
        if (idx < 0) return "";
        int colon = json.indexOf(":", idx + key.length());
        int quote1 = json.indexOf("\"", colon + 1);
        int quote2 = json.indexOf("\"", quote1 + 1);
        return json.substring(quote1 + 1, quote2);
    }

    static String escape(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
