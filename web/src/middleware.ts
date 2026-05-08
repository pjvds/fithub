import { defineMiddleware } from "astro:middleware";
import { randomUUID } from "node:crypto";
import { createAuthClient } from "@/lib/auth-client";

// Routes that are accessible without authentication
const PUBLIC_PATHS = new Set(["/", "/auth/callback", "/auth/logout", "/privacy", "/deleted", "/favicon.ico"]);

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

const SESSION_COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
};

export const onRequest = defineMiddleware(async (context, next) => {
  const { request, locals, cookies, redirect } = context;

  locals.correlationId = randomUUID();

  const url = new URL(request.url);

  if (PUBLIC_PATHS.has(url.pathname)) {
    const response = await next();
    response.headers.set("Content-Security-Policy", CSP);
    return response;
  }

  const authWorkerUrl = import.meta.env.AUTH_WORKER_URL ?? "https://auth.fithub.space";
  const client = createAuthClient({ issuer: authWorkerUrl });

  let accessToken = cookies.get("access_token")?.value;
  const refreshToken = cookies.get("refresh_token")?.value;

  // If access token is absent but refresh token exists, try a silent refresh
  // before forcing the user back through the login flow.
  if (!accessToken && refreshToken) {
    const refreshed = await client.refresh(refreshToken);
    if (!refreshed.err && refreshed.tokens) {
      const secure = url.protocol === "https:";
      cookies.set("access_token", refreshed.tokens.access, {
        ...SESSION_COOKIE_OPTS,
        secure,
        maxAge: 15 * 60,
      });
      cookies.set("refresh_token", refreshed.tokens.refresh, {
        ...SESSION_COOKIE_OPTS,
        secure,
        maxAge: 30 * 24 * 60 * 60,
      });
      accessToken = refreshed.tokens.access;
    }
  }

  if (!accessToken) {
    const callbackUrl = new URL("/auth/callback", url).toString();
    return redirect(
      `${authWorkerUrl}/authorize?client_id=web&response_type=code&redirect_uri=${encodeURIComponent(callbackUrl)}&state=${encodeURIComponent(url.pathname + url.search)}`,
      302,
    );
  }

  const result = await client.verify(
    (await import("@/lib/auth-client")).subjects,
    accessToken,
    {
      ...(cookies.get("refresh_token")?.value ? { refresh: cookies.get("refresh_token")!.value } : {}),
      issuer: authWorkerUrl,
      audience: "web",
    },
  );

  if (result.err) {
    // Token invalid and refresh (if present) also failed — redirect to login
    cookies.delete("access_token", { path: "/" });
    cookies.delete("refresh_token", { path: "/" });
    const callbackUrl = new URL("/auth/callback", url).toString();
    return redirect(
      `${authWorkerUrl}/authorize?client_id=web&response_type=code&redirect_uri=${encodeURIComponent(callbackUrl)}&state=${encodeURIComponent(url.pathname + url.search)}`,
      302,
    );
  }

  // Silently rotate tokens if OpenAuth refreshed them
  if (result.tokens) {
    const secure = url.protocol === "https:";
    cookies.set("access_token", result.tokens.access, {
      ...SESSION_COOKIE_OPTS,
      secure,
      maxAge: 15 * 60,
    });
    if (result.tokens.refresh) {
      cookies.set("refresh_token", result.tokens.refresh, {
        ...SESSION_COOKIE_OPTS,
        secure,
        maxAge: 30 * 24 * 60 * 60,
      });
    }
  }

  locals.user = { userId: result.subject.properties.id, email: null };

  const response = await next();
  response.headers.set("Content-Security-Policy", CSP);
  return response;
});
