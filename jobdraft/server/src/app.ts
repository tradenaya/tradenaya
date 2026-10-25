import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { config, features, missingFeatureMessages } from "./config/env.js";
import { accountRouter } from "./http/account-routes.js";
import { adminRouter } from "./http/admin-routes.js";
import { authRouter } from "./http/auth-routes.js";
import { errorHandler, requireAuth } from "./http/common.js";
import { gmailRouter } from "./http/gmail-routes.js";
import { automationRouter, profileRouter } from "./http/profile-routes.js";
import { runsRouter } from "./http/runs-routes.js";
import { testRouter } from "./http/test-routes.js";

export function createApp() {
  const app = express();
  // Behind nginx on the same machine; X-Forwarded-For is trusted only from localhost.
  app.set("trust proxy", "loopback");
  app.disable("x-powered-by");

  app.use(helmet());
  // Only CLIENT_URL gets CORS headers; any other origin gets none.
  const clientUrl = config().clientUrl;
  app.use(cors({ origin: (origin, cb) => cb(null, origin === clientUrl), credentials: true, methods: ["GET", "POST", "PUT", "PATCH", "DELETE"], maxAge: 600 }));
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());
  app.use(
    "/api",
    rateLimit({ windowMs: 60_000, limit: 300, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "Too many requests. Please slow down." } }),
  );

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });
  app.get("/api/status", requireAuth, (_req, res) => {
    res.json({ features: features(), notConfigured: missingFeatureMessages() });
  });

  app.use("/api/auth", authRouter());
  app.use("/api/profile", profileRouter());
  app.use("/api/automation", automationRouter());
  app.use("/api/gmail", gmailRouter());
  app.use("/api/account", accountRouter());
  app.use("/api/admin", adminRouter());
  // E2E-only helpers: never mounted outside NODE_ENV=test with MOCK_EXTERNAL=true.
  if (config().isTest && config().mockExternal) app.use("/api/__test", testRouter());
  app.use("/api", runsRouter());

  app.use((_req, res) => {
    res.status(404).json({ error: "Not found." });
  });
  app.use(errorHandler);
  return app;
}
