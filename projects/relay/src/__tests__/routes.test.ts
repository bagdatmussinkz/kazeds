/**
 * Relay HTTP routes — Fastify integration tests
 * Tests the actual route handlers with zod validation
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { sessionRoutes } from "../routes/sessions";
import { healthRoutes } from "../routes/health";
import { SessionStore } from "../services/session-store";

let app: ReturnType<typeof Fastify>;

beforeAll(async () => {
  app = Fastify();
  await app.register(cors);

  const store = new SessionStore();
  app.decorate("sessionStore", store);

  await app.register(sessionRoutes, { prefix: "/v1" });
  await app.register(healthRoutes);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

// Helper: inject request
function inject(method: string, url: string, payload?: unknown) {
  return app.inject({
    method: method as any,
    url,
    payload,
    headers: { "content-type": "application/json" },
  });
}

// ==================== Session Routes ====================

describe("POST /v1/sessions", () => {
  it("201 — creates session with valid input", async () => {
    const res = await inject("POST", "/v1/sessions", {
      origin: "https://egov.kz",
      operation: "auth",
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.session_id).toBeDefined();
    expect(body.challenge).toBeDefined();
    expect(body.qr_payload).toBeDefined();
    expect(body.expires_at).toBeDefined();
  });

  it("201 — sign operation with data", async () => {
    const res = await inject("POST", "/v1/sessions", {
      origin: "https://docs.gov.kz",
      operation: "sign",
      data: Buffer.from("contract").toString("base64"),
      reason: "Подписание договора",
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().qr_payload.data_hash).toBeDefined();
  });

  it("400 — missing origin", async () => {
    const res = await inject("POST", "/v1/sessions", { operation: "auth" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("Validation error");
  });

  it("400 — missing operation", async () => {
    const res = await inject("POST", "/v1/sessions", { origin: "https://test.kz" });
    expect(res.statusCode).toBe(400);
  });

  it("400 — invalid operation", async () => {
    const res = await inject("POST", "/v1/sessions", {
      origin: "https://test.kz",
      operation: "encrypt",
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 — origin is not a URL", async () => {
    const res = await inject("POST", "/v1/sessions", {
      origin: "not-a-url",
      operation: "auth",
    });
    expect(res.statusCode).toBe(400);
  });

  it("400 — empty body", async () => {
    const res = await inject("POST", "/v1/sessions", {});
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /v1/sessions/:id/status", () => {
  it("200 — returns pending status for new session", async () => {
    const create = await inject("POST", "/v1/sessions", {
      origin: "https://test.kz",
      operation: "auth",
    });
    const sessionId = create.json().session_id;

    const res = await inject("GET", `/v1/sessions/${sessionId}/status`);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("pending");
    expect(res.json().expires_in).toBeGreaterThan(0);
  });

  it("404 — non-existent session", async () => {
    const res = await inject("GET", "/v1/sessions/00000000-0000-0000-0000-000000000000/status");
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe("Not found");
  });
});

describe("POST /v1/sessions/:id/complete", () => {
  const validSig = {
    certificate: "MIIBcert...",
    signature: "MEQCIsig...",
    algorithm: "SHA256withRSA",
  };

  it("200 — completes pending session", async () => {
    const create = await inject("POST", "/v1/sessions", {
      origin: "https://test.kz",
      operation: "auth",
    });
    const sessionId = create.json().session_id;

    const res = await inject("POST", `/v1/sessions/${sessionId}/complete`, validSig);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("completed");
  });

  it("400 — missing certificate", async () => {
    const create = await inject("POST", "/v1/sessions", {
      origin: "https://test.kz",
      operation: "auth",
    });
    const sessionId = create.json().session_id;

    const res = await inject("POST", `/v1/sessions/${sessionId}/complete`, {
      signature: "sig",
      algorithm: "SHA256withRSA",
    });
    expect(res.statusCode).toBe(400);
  });

  it("200 — accepts any algorithm (GOST, ECDSA, etc)", async () => {
    const create = await inject("POST", "/v1/sessions", {
      origin: "https://test.kz",
      operation: "auth",
    });
    const sessionId = create.json().session_id;

    const res = await inject("POST", `/v1/sessions/${sessionId}/complete`, {
      certificate: "cert",
      signature: "sig",
      algorithm: "GOST34.10-2015/512",
    });
    expect(res.statusCode).toBe(200);
  });

  it("404 — non-existent session", async () => {
    const res = await inject("POST", "/v1/sessions/fake-id/complete", validSig);
    expect(res.statusCode).toBe(404);
  });

  it("409 — double complete", async () => {
    const create = await inject("POST", "/v1/sessions", {
      origin: "https://test.kz",
      operation: "auth",
    });
    const sessionId = create.json().session_id;

    await inject("POST", `/v1/sessions/${sessionId}/complete`, validSig);
    const res = await inject("POST", `/v1/sessions/${sessionId}/complete`, validSig);
    expect(res.statusCode).toBe(409);
  });
});

describe("DELETE /v1/sessions/:id", () => {
  it("200 — cancels pending session", async () => {
    const create = await inject("POST", "/v1/sessions", {
      origin: "https://test.kz",
      operation: "auth",
    });
    const sessionId = create.json().session_id;

    const res = await inject("DELETE", `/v1/sessions/${sessionId}`);
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("rejected");
  });

  it("404 — non-existent session", async () => {
    const res = await inject("DELETE", "/v1/sessions/fake-id");
    expect(res.statusCode).toBe(404);
  });

  it("409 — cancel already completed", async () => {
    const create = await inject("POST", "/v1/sessions", {
      origin: "https://test.kz",
      operation: "auth",
    });
    const sessionId = create.json().session_id;

    await inject("POST", `/v1/sessions/${sessionId}/complete`, {
      certificate: "c",
      signature: "s",
      algorithm: "SHA256withRSA",
    });

    const res = await inject("DELETE", `/v1/sessions/${sessionId}`);
    expect(res.statusCode).toBe(409);
  });
});

// ==================== Health Route ====================

describe("GET /health", () => {
  it("returns status ok with active sessions and uptime", async () => {
    const res = await inject("GET", "/health");
    expect(res.statusCode).toBe(200);

    const body = res.json();
    expect(body.status).toBe("ok");
    expect(typeof body.active_sessions).toBe("number");
    expect(typeof body.uptime).toBe("number");
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });

  it("active_sessions reflects real count", async () => {
    // Create 2 sessions
    await inject("POST", "/v1/sessions", { origin: "https://a.kz", operation: "auth" });
    await inject("POST", "/v1/sessions", { origin: "https://b.kz", operation: "auth" });

    const res = await inject("GET", "/health");
    expect(res.json().active_sessions).toBeGreaterThanOrEqual(2);
  });
});
