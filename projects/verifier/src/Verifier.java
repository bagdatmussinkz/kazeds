import com.sun.net.httpserver.*;
import java.io.*;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.Security;
import java.security.cert.X509Certificate;
import java.util.*;
import org.bouncycastle.cert.X509CertificateHolder;
import org.bouncycastle.cert.jcajce.JcaX509CertificateConverter;
import org.bouncycastle.cms.*;
import org.bouncycastle.cms.jcajce.JcaSimpleSignerInfoVerifierBuilder;
import org.bouncycastle.jce.provider.BouncyCastleProvider;

public class Verifier {

    public static void main(String[] args) throws Exception {
        Security.addProvider(new BouncyCastleProvider());

        int port = Integer.parseInt(System.getenv().getOrDefault("PORT", "8082"));
        HttpServer server = HttpServer.create(new InetSocketAddress("0.0.0.0", port), 0);

        server.createContext("/health", ex -> {
            String json = "{\"status\":\"ok\",\"engine\":\"BouncyCastle\",\"gost\":true}";
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

                CMSSignedData signed;
                try {
                    signed = new CMSSignedData(cmsBytes);
                } catch (CMSException e) {
                    // Detached signature — try with empty content
                    signed = new CMSSignedData(new CMSProcessableByteArray(new byte[0]), cmsBytes);
                }
                var signers = signed.getSignerInfos().getSigners();
                var certStore = signed.getCertificates();

                for (SignerInformation signer : signers) {
                    @SuppressWarnings("unchecked")
                    Collection<X509CertificateHolder> certs = certStore.getMatches(signer.getSID());
                    for (X509CertificateHolder certHolder : certs) {
                        boolean valid = signer.verify(
                            new JcaSimpleSignerInfoVerifierBuilder()
                                .setProvider("BC")
                                .build(certHolder));

                        X509Certificate x509 = new JcaX509CertificateConverter()
                            .setProvider("BC")
                            .getCertificate(certHolder);

                        String subject = x509.getSubjectX500Principal().getName();
                        String issuer = x509.getIssuerX500Principal().getName();
                        String algorithm = x509.getSigAlgName();
                        String serial = x509.getSerialNumber().toString(16);
                        String notBefore = x509.getNotBefore().toInstant().toString();
                        String notAfter = x509.getNotAfter().toInstant().toString();

                        String json = String.format(
                            "{\"valid\":%s,\"subject\":\"%s\",\"issuer\":\"%s\"," +
                            "\"algorithm\":\"%s\",\"serial\":\"%s\"," +
                            "\"notBefore\":\"%s\",\"notAfter\":\"%s\"}",
                            valid, escape(subject), escape(issuer),
                            escape(algorithm), serial, notBefore, notAfter);

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

        server.setExecutor(null);
        server.start();
        System.out.println("KazEDS Verifier running on port " + port);
        System.out.println("  POST /checkSign  — verify CMS/PKCS#7 signature");
        System.out.println("  GET  /health     — health check");
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

    static String escape(String s) {
        if (s == null) return "";
        return s.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
