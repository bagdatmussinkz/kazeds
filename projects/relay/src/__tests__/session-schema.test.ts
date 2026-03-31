import { describe, it, expect } from "vitest";
import { createSessionSchema, completeSessionSchema } from "../schemas/session.schema";

describe("createSessionSchema", () => {
  it("accepts valid auth request", () => {
    const result = createSessionSchema.safeParse({
      origin: "https://egov.kz",
      operation: "auth",
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid sign request with data", () => {
    const result = createSessionSchema.safeParse({
      origin: "https://docs.gov.kz",
      operation: "sign",
      data: "SGVsbG8=",
      reason: "Подписание договора",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.data).toBe("SGVsbG8=");
      expect(result.data.reason).toBe("Подписание договора");
    }
  });

  it("rejects missing origin", () => {
    const result = createSessionSchema.safeParse({ operation: "auth" });
    expect(result.success).toBe(false);
  });

  it("rejects missing operation", () => {
    const result = createSessionSchema.safeParse({ origin: "https://test.kz" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid operation type", () => {
    const result = createSessionSchema.safeParse({
      origin: "https://test.kz",
      operation: "unknown",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-URL origin", () => {
    const result = createSessionSchema.safeParse({
      origin: "not-a-url",
      operation: "auth",
    });
    expect(result.success).toBe(false);
  });

  it("data and reason are optional", () => {
    const result = createSessionSchema.safeParse({
      origin: "https://test.kz",
      operation: "sign",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.data).toBeUndefined();
      expect(result.data.reason).toBeUndefined();
    }
  });
});

describe("completeSessionSchema", () => {
  it("accepts valid RSA completion", () => {
    const result = completeSessionSchema.safeParse({
      certificate: "MIIBxjCCAW2gAwIBAgIU...",
      signature: "MEUCIQDfakeSignature...",
      algorithm: "SHA256withRSA",
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid ECDSA completion", () => {
    const result = completeSessionSchema.safeParse({
      certificate: "MIIBcert...",
      signature: "MEQCIG...",
      algorithm: "SHA256withECDSA",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing certificate", () => {
    const result = completeSessionSchema.safeParse({
      signature: "sig",
      algorithm: "SHA256withRSA",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty certificate", () => {
    const result = completeSessionSchema.safeParse({
      certificate: "",
      signature: "sig",
      algorithm: "SHA256withRSA",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing signature", () => {
    const result = completeSessionSchema.safeParse({
      certificate: "cert",
      algorithm: "SHA256withRSA",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty signature", () => {
    const result = completeSessionSchema.safeParse({
      certificate: "cert",
      signature: "",
      algorithm: "SHA256withRSA",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid algorithm", () => {
    const result = completeSessionSchema.safeParse({
      certificate: "cert",
      signature: "sig",
      algorithm: "MD5withRSA",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing algorithm", () => {
    const result = completeSessionSchema.safeParse({
      certificate: "cert",
      signature: "sig",
    });
    expect(result.success).toBe(false);
  });
});
