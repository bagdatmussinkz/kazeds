import type { FastifyInstance } from "fastify";
import type { EgovStore } from "../services/egov-store";
import { createEgovSessionSchema, putEgovDocumentsSchema } from "../schemas/egov.schema";
import { validateSignedDocuments } from "../services/signature-validator";

// eGov lifecycle tracing (best-effort, full payloads)
function trace(app: FastifyInstance, session_id: string, msg: string, data?: unknown) {
  (app as any).traceStore?.add({
    session_id,
    source: "relay",
    level: "info",
    msg,
    data,
    ts: new Date().toISOString(),
  });
}

// Extend Fastify with eGov store
declare module "fastify" {
  interface FastifyInstance {
    egovStore: EgovStore;
  }
}

function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

export async function egovRoutes(app: FastifyInstance) {
  // POST /v1/egov/sessions — create eGov signing session
  app.post("/egov/sessions", async (request, reply) => {
    const parsed = createEgovSessionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation error", message: parsed.error.message });
    }

    const result = app.egovStore.create(parsed.data);
    trace(app, result.session_id, "egov session created", { request: parsed.data, response: result });
    return reply.status(201).send({
      session_id: result.session_id,
      qr_content: result.qr_content,
      deeplink: result.deeplink,
      expires_at: result.expires_at,
    });
  });

  // GET /v1/egov/:id/mgovSign — API №1, returns meta + document URI
  app.get("/egov/:id/mgovSign", async (request, reply) => {
    const { id } = request.params as { id: string };
    const data = app.egovStore.getMgovSign(id);

    if (!data) {
      return reply.status(404).send({ error: "Not found", message: "Session not found or expired" });
    }

    trace(app, id, "egov mgovSign fetched (scanned by eGov Mobile)", { response: data });
    return reply.send(data);
  });

  // GET /v1/egov/:id/documents — API №2 GET, returns documents to sign
  app.get("/egov/:id/documents", async (request, reply) => {
    const { id } = request.params as { id: string };
    const token = extractBearerToken(request.headers.authorization);

    if (!token) {
      return reply.status(401).send({ error: "Unauthorized", message: "Bearer token required" });
    }

    const result = app.egovStore.getDocuments(id, token);

    if (result.error) {
      return reply.status(result.statusCode || 403).send({ error: result.error });
    }

    return reply.send(result.data);
  });

  // PUT /v1/egov/:id/documents — API №2 PUT, stores signed documents
  app.put("/egov/:id/documents", async (request, reply) => {
    const { id } = request.params as { id: string };
    const token = extractBearerToken(request.headers.authorization);

    if (!token) {
      return reply.status(401).send({ error: "Unauthorized", message: "Bearer token required" });
    }

    const parsed = putEgovDocumentsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation error", message: parsed.error.message });
    }

    // Сначала доступ/состояние сессии (401/404/409), затем подпись (403)
    const pre = app.egovStore.checkPutPreconditions(id, token);
    if (!pre.success) {
      return reply.status(pre.statusCode || 500).send({ error: pre.error });
    }

    // Шаг 8 спеки: валидация подписи. Невалидная подпись → 403.
    const validation = await validateSignedDocuments(parsed.data.signMethod, parsed.data.documentsToSign);
    trace(app, id, validation.valid ? "egov PUT signed documents" : "egov PUT rejected (invalid signature)", {
      signMethod: parsed.data.signMethod,
      validation,
      documents: parsed.data.documentsToSign,
    });
    if (!validation.valid) {
      return reply.status(403).send({ error: "Invalid signature", message: validation.reason });
    }

    const result = app.egovStore.putDocuments(id, token, parsed.data);

    if (!result.success) {
      return reply.status(result.statusCode || 500).send({ error: result.error });
    }

    // Спека: успех → 200 "success"
    return reply.send({ success: true, message: "success" });
  });

  // GET /v1/egov/:id/status — polling for the website
  app.get("/egov/:id/status", async (request, reply) => {
    const { id } = request.params as { id: string };
    const status = app.egovStore.getStatus(id);

    if (!status) {
      return reply.status(404).send({ error: "Not found", message: "Session not found" });
    }

    return reply.send(status);
  });
}
