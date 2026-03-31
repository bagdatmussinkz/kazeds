import type { FastifyInstance } from "fastify";
import type { EgovStore } from "../services/egov-store";
import { createEgovSessionSchema, putEgovDocumentsSchema } from "../schemas/egov.schema";

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
    return reply.status(201).send({
      session_id: result.session_id,
      qr_content: result.qr_content,
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

    const result = app.egovStore.putDocuments(id, token, parsed.data);

    if (!result.success) {
      return reply.status(result.statusCode || 500).send({ error: result.error });
    }

    return reply.send({ success: true });
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
