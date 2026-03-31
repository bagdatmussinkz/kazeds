import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { sessionRoutes } from "./routes/sessions";
import { healthRoutes } from "./routes/health";
import { SessionStore } from "./services/session-store";

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
    origin: process.env.CORS_ORIGINS?.split(",") || [
      "http://localhost:3000",
      "http://demo.eds.aitu.uz",
      "http://app.eds.aitu.uz",
      "http://eds.aitu.uz",
    ],
  });

  // Rate limiting
  await app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });

  // In-memory session store
  const sessionStore = new SessionStore();

  // Decorate fastify instance with session store
  app.decorate("sessionStore", sessionStore);

  // Routes
  await app.register(sessionRoutes, { prefix: "/v1" });
  await app.register(healthRoutes);

  // Start
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`KazEDS Cloud Relay running on http://${HOST}:${PORT}`);
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
