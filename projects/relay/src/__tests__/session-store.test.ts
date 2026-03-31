import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SessionStore } from "../services/session-store";

describe("SessionStore", () => {
  let store: SessionStore;

  beforeEach(() => {
    store = new SessionStore();
  });

  afterEach(() => {
    store.destroy();
  });

  describe("create", () => {
    it("creates a session with unique id and challenge", () => {
      const result = store.create({ origin: "https://example.kz", operation: "auth" });

      expect(result.session_id).toBeDefined();
      expect(result.challenge).toBeDefined();
      expect(result.expires_at).toBeDefined();
      expect(result.qr_payload).toBeDefined();
    });

    it("generates unique ids for each session", () => {
      const r1 = store.create({ origin: "https://a.kz", operation: "auth" });
      const r2 = store.create({ origin: "https://b.kz", operation: "auth" });

      expect(r1.session_id).not.toBe(r2.session_id);
      expect(r1.challenge).not.toBe(r2.challenge);
    });

    it("QR payload contains all required fields", () => {
      const result = store.create({ origin: "https://test.kz", operation: "sign" });
      const qr = result.qr_payload;

      expect(qr.version).toBe(1);
      expect(qr.session_id).toBe(result.session_id);
      expect(qr.challenge).toBe(result.challenge);
      expect(qr.origin).toBe("https://test.kz");
      expect(qr.operation).toBe("sign");
      expect(qr.callback_url).toContain(result.session_id);
      expect(qr.created_at).toBeDefined();
      expect(qr.expires_at).toBeDefined();
    });

    it("includes data_hash for sign operations with data", () => {
      const data = Buffer.from("test data").toString("base64");
      const result = store.create({ origin: "https://test.kz", operation: "sign", data });

      expect(result.qr_payload.data_hash).toBeDefined();
      expect(typeof result.qr_payload.data_hash).toBe("string");
    });

    it("increments active count", () => {
      expect(store.getActiveCount()).toBe(0);
      store.create({ origin: "https://a.kz", operation: "auth" });
      expect(store.getActiveCount()).toBe(1);
      store.create({ origin: "https://b.kz", operation: "auth" });
      expect(store.getActiveCount()).toBe(2);
    });
  });

  describe("getStatus", () => {
    it("returns null for non-existent session", () => {
      expect(store.getStatus("non-existent-id")).toBeNull();
    });

    it("returns pending status for new session", () => {
      const { session_id } = store.create({ origin: "https://a.kz", operation: "auth" });
      const status = store.getStatus(session_id);

      expect(status).not.toBeNull();
      expect(status!.status).toBe("pending");
      expect(status!.expires_in).toBeGreaterThan(0);
    });

    it("marks expired session when TTL exceeded", () => {
      const { session_id } = store.create({ origin: "https://a.kz", operation: "auth" });

      // Fast-forward time past TTL
      vi.useFakeTimers();
      vi.setSystemTime(new Date(Date.now() + 301_000));

      const status = store.getStatus(session_id);
      expect(status!.status).toBe("expired");

      vi.useRealTimers();
    });
  });

  describe("complete", () => {
    const mockResult = {
      certificate: "MIIB...",
      signature: "abc123",
      algorithm: "SHA256withRSA" as const,
    };

    it("completes a pending session", () => {
      const { session_id } = store.create({ origin: "https://a.kz", operation: "auth" });
      const result = store.complete(session_id, mockResult);

      expect(result.success).toBe(true);

      const status = store.getStatus(session_id);
      expect(status!.status).toBe("completed");
      expect(status!.result).toEqual(mockResult);
    });

    it("returns 404 for non-existent session", () => {
      const result = store.complete("fake-id", mockResult);
      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(404);
    });

    it("returns 409 for already completed session", () => {
      const { session_id } = store.create({ origin: "https://a.kz", operation: "auth" });
      store.complete(session_id, mockResult);

      const result = store.complete(session_id, mockResult);
      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(409);
    });

    it("returns 409 for expired session", () => {
      const { session_id } = store.create({ origin: "https://a.kz", operation: "auth" });

      vi.useFakeTimers();
      vi.setSystemTime(new Date(Date.now() + 301_000));

      const result = store.complete(session_id, mockResult);
      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(409);

      vi.useRealTimers();
    });
  });

  describe("cancel", () => {
    it("cancels a pending session", () => {
      const { session_id } = store.create({ origin: "https://a.kz", operation: "auth" });
      const result = store.cancel(session_id);

      expect(result.success).toBe(true);

      const status = store.getStatus(session_id);
      expect(status!.status).toBe("rejected");
    });

    it("returns 404 for non-existent session", () => {
      expect(store.cancel("fake").success).toBe(false);
      expect(store.cancel("fake").statusCode).toBe(404);
    });

    it("returns 409 for already cancelled session", () => {
      const { session_id } = store.create({ origin: "https://a.kz", operation: "auth" });
      store.cancel(session_id);

      const result = store.cancel(session_id);
      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(409);
    });

    it("decrements active count", () => {
      const { session_id } = store.create({ origin: "https://a.kz", operation: "auth" });
      expect(store.getActiveCount()).toBe(1);

      store.cancel(session_id);
      expect(store.getActiveCount()).toBe(0);
    });
  });
});
