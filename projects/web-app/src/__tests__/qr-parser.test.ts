import { describe, it, expect } from "vitest";
import { parseQRPayload, QRParseError } from "../lib/qr/parser";

function makeValidPayload(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 1,
    session_id: "test-session-id",
    challenge: "dGVzdC1jaGFsbGVuZ2U=",
    origin: "https://example.kz",
    operation: "auth",
    callback_url: "https://relay.example.kz/v1/sessions/test-session-id/complete",
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 300_000).toISOString(),
    ...overrides,
  });
}

describe("parseQRPayload", () => {
  it("parses a valid auth payload", () => {
    const result = parseQRPayload(makeValidPayload());

    expect(result.version).toBe(1);
    expect(result.session_id).toBe("test-session-id");
    expect(result.origin).toBe("https://example.kz");
    expect(result.operation).toBe("auth");
  });

  it("parses a valid sign payload", () => {
    const result = parseQRPayload(makeValidPayload({ operation: "sign" }));
    expect(result.operation).toBe("sign");
  });

  it("throws QRParseError on invalid JSON", () => {
    expect(() => parseQRPayload("not-json")).toThrow(QRParseError);
    expect(() => parseQRPayload("not-json")).toThrow("JSON");
  });

  it("throws on unsupported version", () => {
    expect(() => parseQRPayload(makeValidPayload({ version: 99 }))).toThrow("версия");
  });

  it("throws on missing session_id", () => {
    expect(() => parseQRPayload(makeValidPayload({ session_id: "" }))).toThrow("неполные");
  });

  it("throws on missing challenge", () => {
    expect(() => parseQRPayload(makeValidPayload({ challenge: "" }))).toThrow("неполные");
  });

  it("throws on missing origin", () => {
    expect(() => parseQRPayload(makeValidPayload({ origin: "" }))).toThrow("неполные");
  });

  it("throws on missing callback_url", () => {
    expect(() => parseQRPayload(makeValidPayload({ callback_url: "" }))).toThrow("неполные");
  });

  it("throws on non-HTTPS callback_url", () => {
    expect(() =>
      parseQRPayload(makeValidPayload({ callback_url: "http://relay.kazeds.kz/v1/sessions/x/complete" }))
    ).toThrow("HTTPS");
  });

  it("throws on expired QR code", () => {
    expect(() =>
      parseQRPayload(makeValidPayload({ expires_at: new Date(Date.now() - 1000).toISOString() }))
    ).toThrow("истёк");
  });

  it("throws on unknown operation type", () => {
    expect(() => parseQRPayload(makeValidPayload({ operation: "unknown" }))).toThrow("операции");
  });
});
