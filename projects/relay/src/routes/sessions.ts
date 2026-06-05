import type { FastifyInstance } from "fastify";
import type { SessionStore } from "../services/session-store";
import { createSessionSchema, completeSessionSchema } from "../schemas/session.schema";

// Relay self-tracing: пишет lifecycle-события сессии в traceStore (если он
// зарегистрирован). Полные payloads включаются — буфер только в памяти.
function trace(app: FastifyInstance, session_id: string | undefined, msg: string, data?: unknown) {
  (app as any).traceStore?.add({
    session_id,
    source: "relay",
    level: "info",
    msg,
    data,
    ts: new Date().toISOString(),
  });
}

// Extend Fastify with session store
declare module "fastify" {
  interface FastifyInstance {
    sessionStore: SessionStore;
  }
}

export async function sessionRoutes(app: FastifyInstance) {
  // POST /v1/sessions — создание сессии
  app.post("/sessions", async (request, reply) => {
    const parsed = createSessionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation error", message: parsed.error.message });
    }

    const result = app.sessionStore.create(parsed.data);
    trace(app, result.session_id, "session created", { request: parsed.data, response: result });
    return reply.status(201).send(result);
  });

  // GET /v1/sessions/:id/payload — full session data for web app (called after QR scan)
  app.get("/sessions/:id/payload", async (request, reply) => {
    const { id } = request.params as { id: string };
    const payload = app.sessionStore.getPayload(id);

    if (!payload) {
      return reply.status(404).send({ error: "Not found", message: "Session not found" });
    }

    // Mark as scanned
    app.sessionStore.markScanned(id);
    trace(app, id, "payload fetched (scanned)", { payload });

    return reply.send(payload);
  });

  // GET /v1/sessions/:id/status — polling статуса
  app.get("/sessions/:id/status", async (request, reply) => {
    const { id } = request.params as { id: string };
    const status = app.sessionStore.getStatus(id);

    if (!status) {
      return reply.status(404).send({ error: "Not found", message: "Session not found" });
    }

    return reply.send(status);
  });

  // POST /v1/sessions/:id/complete — завершение (от Web App / iOS App)
  app.post("/sessions/:id/complete", async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = completeSessionSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation error", message: parsed.error.message });
    }

    const result = app.sessionStore.complete(id, parsed.data);
    trace(app, id, result.success ? "session completed" : "complete rejected", {
      result: parsed.data,
      outcome: result,
    });

    if (!result.success) {
      return reply.status(result.statusCode || 500).send({ error: result.error });
    }

    return reply.send({ status: "completed" });
  });

  // PATCH /v1/sessions/:id/egov — привязка deeplink парной egov-сессии
  app.patch("/sessions/:id/egov", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = request.body as { deeplink?: string };
    if (!body?.deeplink || !body.deeplink.startsWith("https://m.egov.kz/")) {
      return reply.status(400).send({ error: "Validation error", message: "deeplink (m.egov.kz) required" });
    }
    const ok = app.sessionStore.setEgovLink(id, body.deeplink);
    if (!ok) {
      return reply.status(404).send({ error: "Not found", message: "Session not found or not active" });
    }
    trace(app, id, "egov deeplink linked", { deeplink: body.deeplink });
    return reply.send({ status: "linked" });
  });

  // DELETE /v1/sessions/:id — отмена сессии
  app.delete("/sessions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = app.sessionStore.cancel(id);
    trace(app, id, "session cancelled", { outcome: result });

    if (!result.success) {
      return reply.status(result.statusCode || 500).send({ error: result.error });
    }

    return reply.send({ status: "rejected" });
  });
}
