import { defineMiddleware } from "astro:middleware";
import { getSession } from "@/lib/session";
import { randomUUID } from "node:crypto";

// Routes that are accessible without authentication
const PUBLIC_PATHS = new Set(["/", "/auth/callback", "/auth/logout", "/privacy", "/deleted"]);

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'", // Astro islands require inline scripts
  "style-src 'self' 'unsafe-inline'",  // Tailwind inlines critical CSS
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, locals, cookies, redirect } = context;

  // Mint a correlation ID for this request lifecycle
  locals.correlationId = randomUUID();

  const url = new URL(request.url);

  // Allow public paths through unconditionally
  if (PUBLIC_PATHS.has(url.pathname)) {
    const response = await next();
    response.headers.set("Content-Security-Policy", CSP);
    return response;
  }

  // Check for a valid session
  const session = getSession(cookies);

  if (!session) {
    const authWorkerUrl = import.meta.env.AUTH_WORKER_URL ?? "";
    const redirectUri = encodeURIComponent(request.url);
    return redirect(`${authWorkerUrl}/authorize?redirect_uri=${redirectUri}`, 302);
  }

  // Attach session to locals for downstream pages and layouts
  locals.user = session;

  const response = await next();
  response.headers.set("Content-Security-Policy", CSP);
  return response;
});
