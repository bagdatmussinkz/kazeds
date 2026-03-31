import type { FastifyInstance } from "fastify";
import type { SessionStore } from "../services/session-store";
import { createSessionSchema, completeSessionSchema } from "../schemas/session.schema";

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
    return reply.status(201).send(result);
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

    if (!result.success) {
      return reply.status(result.statusCode || 500).send({ error: result.error });
    }

    return reply.send({ status: "completed" });
  });

  // DELETE /v1/sessions/:id — отмена сессии
  app.delete("/sessions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const result = app.sessionStore.cancel(id);

    if (!result.success) {
      return reply.status(result.statusCode || 500).send({ error: result.error });
    }

    return reply.send({ status: "rejected" });
  });
}
