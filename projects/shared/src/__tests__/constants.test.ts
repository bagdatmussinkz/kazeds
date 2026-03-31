import { describe, it, expect } from "vitest";
import {
  RELAY_URL,
  RELAY_API_VERSION,
  RELAY_BASE_URL,
  SESSION_TTL_SECONDS,
  POLLING_INTERVAL_MS,
  POLLING_MAX_RETRIES,
  QR_PAYLOAD_VERSION,
  CHALLENGE_BYTES,
  PBKDF2_ITERATIONS,
  AES_KEY_LENGTH,
  RSA_KEY_SIZE,
  ECDSA_CURVE,
  NCALAYER_WS_URL,
  NCALAYER_WS_PORT,
  NCALAYER_STORAGE,
  JSONRPC_ERRORS,
  RATE_LIMIT,
} from "../constants";

describe("constants", () => {
  it("RELAY_BASE_URL is composed from RELAY_URL and version", () => {
    expect(RELAY_BASE_URL).toBe(`${RELAY_URL}/${RELAY_API_VERSION}`);
  });

  it("session TTL is 5 minutes", () => {
    expect(SESSION_TTL_SECONDS).toBe(300);
  });

  it("polling covers the full session TTL", () => {
    const totalPollingMs = POLLING_INTERVAL_MS * POLLING_MAX_RETRIES;
    expect(totalPollingMs).toBeGreaterThanOrEqual(SESSION_TTL_SECONDS * 1000);
  });

  it("QR payload version is 1", () => {
    expect(QR_PAYLOAD_VERSION).toBe(1);
  });

  it("crypto constants are secure", () => {
    expect(CHALLENGE_BYTES).toBeGreaterThanOrEqual(32);
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600_000);
    expect(AES_KEY_LENGTH).toBe(256);
    expect(RSA_KEY_SIZE).toBeGreaterThanOrEqual(2048);
    expect(ECDSA_CURVE).toBe("P-256");
  });

  it("NCALayer WebSocket config is correct", () => {
    expect(NCALAYER_WS_URL).toContain("127.0.0.1");
    expect(NCALAYER_WS_PORT).toBe(13579);
  });

  it("NCALayer storage types are defined", () => {
    expect(NCALAYER_STORAGE.PKCS12).toBe("PKCS12");
    expect(NCALAYER_STORAGE.KAZTOKEN).toBeDefined();
    expect(NCALAYER_STORAGE.IDCARD).toBeDefined();
  });

  it("JSON-RPC error codes follow spec", () => {
    expect(JSONRPC_ERRORS.PARSE_ERROR).toBe(-32700);
    expect(JSONRPC_ERRORS.INVALID_REQUEST).toBe(-32600);
    expect(JSONRPC_ERRORS.METHOD_NOT_FOUND).toBe(-32601);
    expect(JSONRPC_ERRORS.INTERNAL_ERROR).toBe(-32603);
  });

  it("rate limits are positive numbers", () => {
    expect(RATE_LIMIT.CREATE).toBeGreaterThan(0);
    expect(RATE_LIMIT.POLLING).toBeGreaterThan(0);
    expect(RATE_LIMIT.COMPLETE).toBeGreaterThan(0);
  });
});
