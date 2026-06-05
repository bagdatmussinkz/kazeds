/**
 * X.509 DER parser — NCALayer getKeyInfo field extraction
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { parseCertificate } from "../lib/x509.js";

const FIXTURES = join(__dirname, "../../../../test-fixtures/nuc-test-certs");

const ncaB64 = readFileSync(join(FIXTURES, "ca/nca_gost2022_test.cer")).toString("base64");
const rootB64 = readFileSync(join(FIXTURES, "ca/root_test_gost_2022.cer")).toString("base64");

describe("parseCertificate", () => {
  it("parses NCA intermediate GOST cert", () => {
    const info = parseCertificate(ncaB64);
    expect(info.subjectCn).toContain("ҰЛТТЫҚ КУӘЛАНДЫРУШЫ ОРТАЛЫҚ");
    expect(info.issuerCn).toContain("НЕГІЗГІ КУӘЛАНДЫРУШЫ ОРТАЛЫҚ");
    expect(info.subjectDn).toMatch(/^C=KZ,CN=|CN=.*,C=KZ/);
    expect(info.algorithm).toBe("ECGOST34310");
    expect(info.serialNumber).toBe("7ad24b1ba3a0c961fe1ca8503e6aa2bb450db8a3");
  });

  it("returns validity as epoch-ms strings (NCALayer format)", () => {
    const info = parseCertificate(ncaB64);
    expect(info.certNotBefore).toMatch(/^\d+$/);
    expect(info.certNotAfter).toMatch(/^\d+$/);
    expect(new Date(parseInt(info.certNotBefore)).getUTCFullYear()).toBe(2022);
    expect(new Date(parseInt(info.certNotAfter)).getUTCFullYear()).toBe(2032);
  });

  it("extracts key identifiers", () => {
    const info = parseCertificate(ncaB64);
    expect(info.keyId).toMatch(/^[0-9a-f]{40}$/);
    expect(info.authorityKeyIdentifier).toMatch(/^[0-9a-f]{40}$/);
  });

  it("produces a well-formed PEM", () => {
    const info = parseCertificate(rootB64);
    expect(info.pem).toMatch(/^-----BEGIN CERTIFICATE-----\n/);
    expect(info.pem).toMatch(/\n-----END CERTIFICATE-----\n$/);
    expect(info.pem.split("\n").every((l) => l.length <= 64 + 30)).toBe(true);
  });

  it("self-signed root: subject equals issuer", () => {
    const info = parseCertificate(rootB64);
    expect(info.subjectDn).toBe(info.issuerDn);
  });

  it("throws on garbage input", () => {
    expect(() => parseCertificate("aGVsbG8gd29ybGQ=")).toThrow();
  });
});
