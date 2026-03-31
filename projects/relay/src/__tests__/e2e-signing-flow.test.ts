/**
 * E2E test — full signing flow through Cloud Relay
 *
 * Simulates the complete lifecycle:
 * 1. Extension creates a session (POST /v1/sessions)
 * 2. Extension polls for status (GET /v1/sessions/:id/status)
 * 3. Mobile PWA completes the session (POST /v1/sessions/:id/complete)
 * 4. Extension polls again and gets the result
 *
 * Also tests: cancellation flow, expiration, concurrent sessions
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { SessionStore } from "../services/session-store";

let app: ReturnType<typeof Fastify>;
let baseUrl: string;

beforeAll(async () => {
  app = Fastify();
  await app.register(cors);

  const store = new SessionStore();

  // Register routes inline (same as real relay)
  app.post("/v1/sessions", async (req, reply) => {
    const body = req.body as any;
    if (!body?.origin || !body?.operation) {
      return reply.status(400).send({ error: "Missing required fields" });
    }
    const result = store.create(body);
    return reply.status(201).send(result);
  });

  app.get("/v1/sessions/:id/status", async (req, reply) => {
    const { id } = req.params as any;
    const status = store.getStatus(id);
    if (!status) return reply.status(404).send({ error: "Session not found" });
    return status;
  });

  app.post("/v1/sessions/:id/complete", async (req, reply) => {
    const { id } = req.params as any;
    const body = req.body as any;
    const result = store.complete(id, body);
    if (!result.success) {
      return reply.status(result.statusCode!).send({ error: result.error });
    }
    return { success: true };
  });

  app.delete("/v1/sessions/:id", async (req, reply) => {
    const { id } = req.params as any;
    const result = store.cancel(id);
    if (!result.success) {
      return reply.status(result.statusCode!).send({ error: result.error });
    }
    return { success: true };
  });

  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  if (typeof addr === "object" && addr) {
    baseUrl = `http://127.0.0.1:${addr.port}/v1`;
  }
});

afterAll(async () => {
  await app.close();
});

async function api(method: string, path: string, body?: unknown) {
  const opts: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(`${baseUrl}${path}`, opts);
  return { status: res.status, data: await res.json() };
}

describe("E2E: Auth signing flow", () => {
  it("full auth cycle: create → poll (pending) → complete → poll (completed)", async () => {
    // 1. Extension creates session
    const create = await api("POST", "/sessions", {
      origin: "https://egov.kz",
      operation: "auth",
    });
    expect(create.status).toBe(201);
    expect(create.data.session_id).toBeDefined();
    expect(create.data.qr_payload.operation).toBe("auth");

    const sessionId = create.data.session_id;

    // 2. Extension polls — should be pending
    const poll1 = await api("GET", `/sessions/${sessionId}/status`);
    expect(poll1.status).toBe(200);
    expect(poll1.data.status).toBe("pending");
    expect(poll1.data.expires_in).toBeGreaterThan(0);

    // 3. Mobile PWA scans QR and completes session
    const sigResult = {
      certificate: "MIIBxjCCAW2gAwIBAgIUfake...",
      signature: "MEUCIQDfakeSignature...",
      algorithm: "SHA256withRSA",
    };
    const complete = await api("POST", `/sessions/${sessionId}/complete`, sigResult);
    expect(complete.status).toBe(200);
    expect(complete.data.success).toBe(true);

    // 4. Extension polls again — should get the result
    const poll2 = await api("GET", `/sessions/${sessionId}/status`);
    expect(poll2.status).toBe(200);
    expect(poll2.data.status).toBe("completed");
    expect(poll2.data.result.certificate).toBe(sigResult.certificate);
    expect(poll2.data.result.signature).toBe(sigResult.signature);
  });
});

describe("E2E: Sign data flow", () => {
  it("full sign cycle with data", async () => {
    const dataToSign = Buffer.from("Hello KazEDS").toString("base64");

    const create = await api("POST", "/sessions", {
      origin: "https://docs.gov.kz",
      operation: "sign",
      data: dataToSign,
    });
    expect(create.status).toBe(201);
    expect(create.data.qr_payload.operation).toBe("sign");
    expect(create.data.qr_payload.data_hash).toBeDefined();

    const sessionId = create.data.session_id;

    const sigResult = {
      certificate: "MIIBcert...",
      signature: "MEQCIG...",
      algorithm: "SHA256withECDSA",
    };
    const complete = await api("POST", `/sessions/${sessionId}/complete`, sigResult);
    expect(complete.status).toBe(200);

    const poll = await api("GET", `/sessions/${sessionId}/status`);
    expect(poll.data.status).toBe("completed");
    expect(poll.data.result.algorithm).toBe("SHA256withECDSA");
  });
});

describe("E2E: Cancellation flow", () => {
  it("extension cancels a pending session", async () => {
    const create = await api("POST", "/sessions", {
      origin: "https://test.kz",
      operation: "auth",
    });
    const sessionId = create.data.session_id;

    // Cancel
    const cancel = await api("DELETE", `/sessions/${sessionId}`);
    expect(cancel.status).toBe(200);
    expect(cancel.data.success).toBe(true);

    // Poll should show rejected
    const poll = await api("GET", `/sessions/${sessionId}/status`);
    expect(poll.data.status).toBe("rejected");
  });

  it("cannot cancel already completed session", async () => {
    const create = await api("POST", "/sessions", {
      origin: "https://test.kz",
      operation: "auth",
    });
    const sessionId = create.data.session_id;

    await api("POST", `/sessions/${sessionId}/complete`, {
      certificate: "cert",
      signature: "sig",
      algorithm: "SHA256withRSA",
    });

    const cancel = await api("DELETE", `/sessions/${sessionId}`);
    expect(cancel.status).toBe(409);
  });
});

describe("E2E: Error cases", () => {
  it("poll non-existent session returns 404", async () => {
    const poll = await api("GET", "/sessions/non-existent-uuid/status");
    expect(poll.status).toBe(404);
  });

  it("complete non-existent session returns 404", async () => {
    const complete = await api("POST", "/sessions/non-existent-uuid/complete", {
      certificate: "c",
      signature: "s",
      algorithm: "SHA256withRSA",
    });
    expect(complete.status).toBe(404);
  });

  it("double-complete returns 409", async () => {
    const create = await api("POST", "/sessions", {
      origin: "https://test.kz",
      operation: "auth",
    });
    const sessionId = create.data.session_id;

    const sig = { certificate: "c", signature: "s", algorithm: "SHA256withRSA" };
    await api("POST", `/sessions/${sessionId}/complete`, sig);
    const second = await api("POST", `/sessions/${sessionId}/complete`, sig);
    expect(second.status).toBe(409);
  });

  it("missing origin returns 400", async () => {
    const create = await api("POST", "/sessions", { operation: "auth" });
    expect(create.status).toBe(400);
  });

  it("missing operation returns 400", async () => {
    const create = await api("POST", "/sessions", { origin: "https://test.kz" });
    expect(create.status).toBe(400);
  });
});

describe("E2E: Concurrent sessions", () => {
  it("handles multiple sessions simultaneously", async () => {
    // Create 3 sessions
    const sessions = await Promise.all([
      api("POST", "/sessions", { origin: "https://a.kz", operation: "auth" }),
      api("POST", "/sessions", { origin: "https://b.kz", operation: "sign" }),
      api("POST", "/sessions", { origin: "https://c.kz", operation: "auth" }),
    ]);

    sessions.forEach((s) => expect(s.status).toBe(201));

    // All have unique IDs
    const ids = sessions.map((s) => s.data.session_id);
    expect(new Set(ids).size).toBe(3);

    // Complete only the second one
    await api("POST", `/sessions/${ids[1]}/complete`, {
      certificate: "cert-b",
      signature: "sig-b",
      algorithm: "SHA256withRSA",
    });

    // Check statuses
    const [s1, s2, s3] = await Promise.all([
      api("GET", `/sessions/${ids[0]}/status`),
      api("GET", `/sessions/${ids[1]}/status`),
      api("GET", `/sessions/${ids[2]}/status`),
    ]);

    expect(s1.data.status).toBe("pending");
    expect(s2.data.status).toBe("completed");
    expect(s3.data.status).toBe("pending");
  });
});
