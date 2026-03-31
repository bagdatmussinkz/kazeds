import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { sessionRoutes } from "./routes/sessions";
import { egovRoutes } from "./routes/egov";
import { healthRoutes } from "./routes/health";
import { SessionStore } from "./services/session-store";
import { EgovStore } from "./services/egov-store";

const PORT = parseInt(process.env.PORT || "3001", 10);
const HOST = process.env.HOST || "0.0.0.0";

async function main() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || "info",
    },
  });

  // CORS
  await app.register(cors, {
    origin: true, // Allow all origins (dev mode)
  });

  // Rate limiting
  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });

  // In-memory session store
  const sessionStore = new SessionStore();

  // In-memory eGov session store
  const egovStore = new EgovStore();

  // Decorate fastify instance with stores
  app.decorate("sessionStore", sessionStore);
  app.decorate("egovStore", egovStore);

  // Routes
  await app.register(sessionRoutes, { prefix: "/v1" });
  await app.register(egovRoutes, { prefix: "/v1" });
  await app.register(healthRoutes);

  // Start
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`KazEDS Cloud Relay running on http://${HOST}:${PORT}`);
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
