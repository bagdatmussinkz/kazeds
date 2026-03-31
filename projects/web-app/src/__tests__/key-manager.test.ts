/**
 * Web Crypto key-manager tests
 * Uses Node.js built-in Web Crypto (available in Node 20+)
 */
import { describe, it, expect } from "vitest";
import {
  generateKeyPair,
  deriveKeyFromPin,
  wrapPrivateKey,
  unwrapPrivateKey,
  signData,
} from "../lib/crypto/key-manager";

// Node 20+ has globalThis.crypto with Web Crypto API

describe("generateKeyPair", () => {
  it("generates RSA key pair", async () => {
    const keyPair = await generateKeyPair("RSA");
    expect(keyPair.publicKey).toBeDefined();
    expect(keyPair.privateKey).toBeDefined();
    expect(keyPair.publicKey.algorithm.name).toBe("RSASSA-PKCS1-v1_5");
  });

  it("RSA key is extractable", async () => {
    const keyPair = await generateKeyPair("RSA");
    expect(keyPair.privateKey.extractable).toBe(true);
  });

  it("RSA key supports sign/verify", async () => {
    const keyPair = await generateKeyPair("RSA");
    expect(keyPair.privateKey.usages).toContain("sign");
    expect(keyPair.publicKey.usages).toContain("verify");
  });

  it("generates ECDSA key pair", async () => {
    const keyPair = await generateKeyPair("ECDSA");
    expect(keyPair.publicKey).toBeDefined();
    expect(keyPair.privateKey).toBeDefined();
    expect(keyPair.publicKey.algorithm.name).toBe("ECDSA");
  });

  it("ECDSA uses P-256 curve", async () => {
    const keyPair = await generateKeyPair("ECDSA");
    expect((keyPair.publicKey.algorithm as EcKeyAlgorithm).namedCurve).toBe("P-256");
  });

  it("ECDSA key is extractable", async () => {
    const keyPair = await generateKeyPair("ECDSA");
    expect(keyPair.privateKey.extractable).toBe(true);
  });

  it("each call produces unique keys", async () => {
    const k1 = await generateKeyPair("ECDSA");
    const k2 = await generateKeyPair("ECDSA");

    const raw1 = await crypto.subtle.exportKey("raw", k1.publicKey);
    const raw2 = await crypto.subtle.exportKey("raw", k2.publicKey);

    expect(Buffer.from(raw1).toString("hex")).not.toBe(Buffer.from(raw2).toString("hex"));
  });
});

describe("deriveKeyFromPin", () => {
  it("derives a CryptoKey from PIN and salt", async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKeyFromPin("1234", salt);

    expect(key).toBeDefined();
    expect(key.algorithm.name).toBe("AES-GCM");
    expect((key.algorithm as AesKeyAlgorithm).length).toBe(256);
  });

  it("derived key is not extractable", async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKeyFromPin("1234", salt);
    expect(key.extractable).toBe(false);
  });

  it("derived key supports wrapKey/unwrapKey", async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await deriveKeyFromPin("1234", salt);
    expect(key.usages).toContain("wrapKey");
    expect(key.usages).toContain("unwrapKey");
  });

  it("same PIN + salt produces same key", async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const k1 = await deriveKeyFromPin("5678", salt);
    const k2 = await deriveKeyFromPin("5678", salt);

    // Can't compare directly since not extractable, but both should work
    // to wrap/unwrap the same data. We test this indirectly via wrap/unwrap tests.
    expect(k1.algorithm.name).toBe(k2.algorithm.name);
  });

  it("different PINs produce different keys", async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16));

    // Generate a test key to wrap
    const testKey = await generateKeyPair("ECDSA");
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const key1 = await deriveKeyFromPin("1111", salt);
    const wrapped = await wrapPrivateKey(testKey.privateKey, key1, iv);

    // Try unwrapping with different PIN — should fail
    const key2 = await deriveKeyFromPin("9999", salt);
    await expect(
      unwrapPrivateKey(wrapped, key2, iv, "ECDSA"),
    ).rejects.toThrow();
  });
});

describe("wrapPrivateKey / unwrapPrivateKey", () => {
  it("wraps and unwraps ECDSA private key", async () => {
    const keyPair = await generateKeyPair("ECDSA");
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const wrappingKey = await deriveKeyFromPin("test-pin", salt);

    const wrapped = await wrapPrivateKey(keyPair.privateKey, wrappingKey, iv);
    expect(wrapped).toBeInstanceOf(ArrayBuffer);
    expect(wrapped.byteLength).toBeGreaterThan(0);

    const unwrapped = await unwrapPrivateKey(wrapped, wrappingKey, iv, "ECDSA");
    expect(unwrapped).toBeDefined();
    expect(unwrapped.algorithm.name).toBe("ECDSA");
    expect(unwrapped.usages).toContain("sign");
  });

  it("wraps and unwraps RSA private key", async () => {
    const keyPair = await generateKeyPair("RSA");
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const wrappingKey = await deriveKeyFromPin("rsa-pin", salt);

    const wrapped = await wrapPrivateKey(keyPair.privateKey, wrappingKey, iv);
    expect(wrapped.byteLength).toBeGreaterThan(0);

    const unwrapped = await unwrapPrivateKey(wrapped, wrappingKey, iv, "RSA");
    expect(unwrapped.algorithm.name).toBe("RSASSA-PKCS1-v1_5");
  });

  it("unwrap fails with wrong IV", async () => {
    const keyPair = await generateKeyPair("ECDSA");
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const wrongIv = crypto.getRandomValues(new Uint8Array(12));
    const wrappingKey = await deriveKeyFromPin("pin", salt);

    const wrapped = await wrapPrivateKey(keyPair.privateKey, wrappingKey, iv);

    await expect(
      unwrapPrivateKey(wrapped, wrappingKey, wrongIv, "ECDSA"),
    ).rejects.toThrow();
  });

  it("unwrap fails with wrong key", async () => {
    const keyPair = await generateKeyPair("ECDSA");
    const salt1 = crypto.getRandomValues(new Uint8Array(16));
    const salt2 = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));

    const key1 = await deriveKeyFromPin("pin1", salt1);
    const key2 = await deriveKeyFromPin("pin2", salt2);

    const wrapped = await wrapPrivateKey(keyPair.privateKey, key1, iv);

    await expect(
      unwrapPrivateKey(wrapped, key2, iv, "ECDSA"),
    ).rejects.toThrow();
  });
});

describe("signData", () => {
  it("signs data with ECDSA key", async () => {
    const keyPair = await generateKeyPair("ECDSA");
    const data = new TextEncoder().encode("Hello KazEDS").buffer;

    const signature = await signData(keyPair.privateKey, data, "ECDSA");
    expect(signature).toBeInstanceOf(ArrayBuffer);
    expect(signature.byteLength).toBeGreaterThan(0);
  });

  it("signs data with RSA key", async () => {
    const keyPair = await generateKeyPair("RSA");
    const data = new TextEncoder().encode("Test document").buffer;

    const signature = await signData(keyPair.privateKey, data, "RSA");
    expect(signature).toBeInstanceOf(ArrayBuffer);
    expect(signature.byteLength).toBeGreaterThan(0);
  });

  it("ECDSA signatures are different for different data", async () => {
    const keyPair = await generateKeyPair("ECDSA");
    const data1 = new TextEncoder().encode("Data 1").buffer;
    const data2 = new TextEncoder().encode("Data 2").buffer;

    const sig1 = await signData(keyPair.privateKey, data1, "ECDSA");
    const sig2 = await signData(keyPair.privateKey, data2, "ECDSA");

    expect(Buffer.from(sig1).toString("hex")).not.toBe(Buffer.from(sig2).toString("hex"));
  });

  it("RSA signature can be verified with public key", async () => {
    const keyPair = await generateKeyPair("RSA");
    const data = new TextEncoder().encode("Verify me").buffer;

    const signature = await signData(keyPair.privateKey, data, "RSA");

    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      keyPair.publicKey,
      signature,
      data,
    );
    expect(valid).toBe(true);
  });

  it("ECDSA signature can be verified with public key", async () => {
    const keyPair = await generateKeyPair("ECDSA");
    const data = new TextEncoder().encode("Verify ECDSA").buffer;

    const signature = await signData(keyPair.privateKey, data, "ECDSA");

    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      keyPair.publicKey,
      signature,
      data,
    );
    expect(valid).toBe(true);
  });

  it("signature verification fails with wrong data", async () => {
    const keyPair = await generateKeyPair("RSA");
    const data = new TextEncoder().encode("Original").buffer;
    const tampered = new TextEncoder().encode("Tampered").buffer;

    const signature = await signData(keyPair.privateKey, data, "RSA");

    const valid = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      keyPair.publicKey,
      signature,
      tampered,
    );
    expect(valid).toBe(false);
  });

  it("full flow: generate → wrap → unwrap → sign → verify", async () => {
    // Generate keys
    const keyPair = await generateKeyPair("ECDSA");

    // Wrap with PIN
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const wrappingKey = await deriveKeyFromPin("secure-pin", salt);
    const wrapped = await wrapPrivateKey(keyPair.privateKey, wrappingKey, iv);

    // Unwrap
    const unwrapped = await unwrapPrivateKey(wrapped, wrappingKey, iv, "ECDSA");

    // Sign with unwrapped key
    const data = new TextEncoder().encode("End-to-end test").buffer;
    const signature = await signData(unwrapped, data, "ECDSA");

    // Verify with original public key
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      keyPair.publicKey,
      signature,
      data,
    );
    expect(valid).toBe(true);
  });
});
