import rateLimit from "express-rate-limit";
import type { Express, Request } from "express";

function clientIp(req: Request): string | undefined {
  return req.ip;
}

const standardHeaders = true;
const legacyHeaders = false;

/** Skip rate limits for Docker health probes on localhost. */
function isHealthProbe(req: Request): boolean {
  return req.path === "/api/health";
}

export function attachRateLimits(app: Express): void {
  const enabled = process.env.RATE_LIMIT_ENABLED !== "false";
  if (!enabled) return;

  const globalMax = Number(process.env.RATE_LIMIT_GLOBAL_MAX) || 300;
  const authMax = Number(process.env.RATE_LIMIT_AUTH_MAX) || 10;
  const expensiveMax = Number(process.env.RATE_LIMIT_EXPENSIVE_MAX) || 60;
  const uploadMax = Number(process.env.RATE_LIMIT_UPLOAD_MAX) || 5;

  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: globalMax,
      standardHeaders,
      legacyHeaders,
      keyGenerator: clientIp,
      skip: (req) => isHealthProbe(req),
      message: { error: "Too many requests. Try again later." },
    })
  );

  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: authMax,
      standardHeaders,
      legacyHeaders,
      keyGenerator: clientIp,
      skip: (req) => {
        if (req.path !== "/") return true;
        if (req.method === "POST") return false;
        if (req.method === "GET" && typeof req.query.code === "string") return false;
        return true;
      },
      message: { error: "Too many access attempts. Try again later." },
    })
  );

  const expensivePattern =
    /^\/api\/(routes\/[^/]+\/(build|geometry|reoptimize|apply-traffic)|customers\/regeocode)$/;

  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: expensiveMax,
      standardHeaders,
      legacyHeaders,
      keyGenerator: clientIp,
      skip: (req) => !expensivePattern.test(req.path),
      message: { error: "Too many routing requests. Slow down to avoid excessive map API usage." },
    })
  );

  app.use(
    rateLimit({
      windowMs: 60 * 60 * 1000,
      max: uploadMax,
      standardHeaders,
      legacyHeaders,
      keyGenerator: clientIp,
      skip: (req) => req.path !== "/api/customers/upload",
      message: { error: "Too many CSV uploads this hour." },
    })
  );
}
