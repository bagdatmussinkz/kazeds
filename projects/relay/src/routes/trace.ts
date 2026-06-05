import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { TraceStore } from "../services/trace-store";

declare module "fastify" {
  interface FastifyInstance {
    traceStore: TraceStore;
  }
}

const traceEventSchema = z.object({
  session_id: z.string().optional(),
  source: z.enum([
    "extension-sw",
    "extension-page",
    "widget",
    "web-app",
    "miniapp",
    "demo-site",
    "relay",
  ]),
  level: z.enum(["info", "warn", "error"]),
  msg: z.string().min(1).max(500),
  data: z.unknown().optional(),
  ts: z.string(),
});

const tracePostSchema = z.union([traceEventSchema, z.array(traceEventSchema).max(100)]);

export async function traceRoutes(app: FastifyInstance) {
  // POST /v1/trace — приём события или батча со всех компонентов
  app.post("/trace", async (request, reply) => {
    const parsed = tracePostSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: "Validation error", message: parsed.error.message });
    }
    const events = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
    const accepted = app.traceStore.addBatch(events);
    return reply.status(202).send({ accepted });
  });

  // GET /v1/trace?session_id=&source=&limit= — чтение
  app.get("/trace", async (request, reply) => {
    const { session_id, source, limit } = request.query as {
      session_id?: string;
      source?: string;
      limit?: string;
    };
    const events = app.traceStore.list({
      session_id,
      source,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
    return reply.send({ count: events.length, total: app.traceStore.size, events });
  });

  // DELETE /v1/trace — очистка буфера
  app.delete("/trace", async (_request, reply) => {
    app.traceStore.clear();
    return reply.send({ status: "cleared" });
  });
}
