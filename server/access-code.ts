import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";

const COOKIE_NAME = "routing_access";
const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function expectedCookieValue(accessCode: string): string {
  return crypto.createHash("sha256").update(`routing-access:${accessCode}`).digest("hex");
}

function cookieMatches(accessCode: string, cookieValue: string | undefined): boolean {
  if (!cookieValue) return false;
  const expected = expectedCookieValue(accessCode);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(cookieValue));
  } catch {
    return false;
  }
}

function isExemptPath(path: string): boolean {
  return path === "/api/health";
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    if (key !== name) continue;
    return decodeURIComponent(trimmed.slice(eq + 1));
  }
  return undefined;
}

function accessGranted(req: Request, accessCode: string): boolean {
  return cookieMatches(accessCode, readCookie(req, COOKIE_NAME));
}

function setAccessCookie(res: Response, accessCode: string): void {
  const secure =
    process.env.COOKIE_SECURE === "true" ||
    (process.env.COOKIE_SECURE !== "false" && process.env.NODE_ENV === "production");
  const value = expectedCookieValue(accessCode);
  const maxAgeSec = Math.floor(COOKIE_MAX_AGE_MS / 1000);
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSec}`,
  ];
  if (secure) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

function loginPage(error?: string): string {
  const message = error ? `<p style="color:#b91c1c;margin:0 0 1rem">${escapeHtml(error)}</p>` : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Enter access code</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #f4f4f5; display: grid; place-items: center; min-height: 100vh; margin: 0; }
    form { background: #fff; padding: 2rem; border-radius: 8px; box-shadow: 0 1px 3px rgb(0 0 0 / 0.1); width: min(100%, 22rem); }
    h1 { font-size: 1.125rem; margin: 0 0 1rem; }
    label { display: block; font-size: 0.875rem; margin-bottom: 0.35rem; }
    input { width: 100%; box-sizing: border-box; padding: 0.5rem 0.65rem; border: 1px solid #d4d4d8; border-radius: 6px; }
    button { margin-top: 1rem; width: 100%; padding: 0.55rem; background: #18181b; color: #fff; border: none; border-radius: 6px; cursor: pointer; }
  </style>
</head>
<body>
  <form method="post" action="/">
    <h1>PA Wine Routing</h1>
    <p style="color:#52525b;font-size:0.875rem;margin:0 0 1rem">Enter the team access code to open the app.</p>
    ${message}
    <label for="code">Access code</label>
    <input id="code" name="code" type="password" autocomplete="current-password" required autofocus />
    <button type="submit">Continue</button>
  </form>
</body>
</html>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Gate the app behind ACCESS_CODE when that env var is set. */
export function accessCodeMiddleware(req: Request, res: Response, next: NextFunction): void {
  const accessCode = process.env.ACCESS_CODE?.trim();
  if (!accessCode) {
    next();
    return;
  }

  if (isExemptPath(req.path)) {
    next();
    return;
  }

  const queryCode = typeof req.query.code === "string" ? req.query.code : undefined;
  if (queryCode !== undefined) {
    if (queryCode === accessCode) {
      setAccessCookie(res, accessCode);
      res.redirect(302, "/");
      return;
    }
    if (req.method === "GET" && req.path === "/") {
      res.status(401).type("html").send(loginPage("Invalid access code in link."));
      return;
    }
  }

  if (req.method === "POST" && req.path === "/") {
    const bodyCode = typeof req.body?.code === "string" ? req.body.code : undefined;
    if (bodyCode === accessCode) {
      setAccessCookie(res, accessCode);
      res.redirect(302, "/");
      return;
    }
    res.status(401).type("html").send(loginPage("Invalid access code."));
    return;
  }

  if (accessGranted(req, accessCode)) {
    next();
    return;
  }

  if (req.path.startsWith("/api")) {
    res.status(401).json({ error: "Access code required" });
    return;
  }

  if (req.method === "GET" && !req.path.includes(".")) {
    res.status(401).type("html").send(loginPage());
    return;
  }

  res.status(401).type("html").send(loginPage());
}
