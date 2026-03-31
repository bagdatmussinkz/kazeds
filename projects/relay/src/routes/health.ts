import type { FastifyInstance } from "fastify";

const startTime = Date.now();

export async function healthRoutes(app: FastifyInstance) {
  app.get("/health", async () => {
    return {
      status: "ok",
      active_sessions: app.sessionStore.getActiveCount(),
      uptime: Math.floor((Date.now() - startTime) / 1000),
    };
  });
}
