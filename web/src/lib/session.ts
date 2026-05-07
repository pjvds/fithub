/**
 * Session helpers for Astro server-side pages and middleware.
 *
 * The `fithub_session` cookie is an HttpOnly cookie set by the Auth Worker
 * after successful OAuth. Its value is a signed JWT with claims:
 *   { sub: userId, email?: string }
 *
 * For the web frontend, we do NOT re-validate the JWT signature (that is the
 * Auth Worker's responsibility). We only decode the payload to extract the
 * user identity needed by the middleware and page templates.
 *
 * If the cookie is missing or its payload is unparseable we return `null`,
 * which causes the middleware to redirect to the Auth Worker login flow.
 */

import type { AstroCookies } from "astro";
import type { SessionUser } from "@fithub/core";

export const SESSION_COOKIE = "fithub_session";

interface JwtPayload {
  sub?: string;
  email?: string | null;
}

/**
 * Decodes the session cookie (without signature verification — that is done
 * server-side by the Auth Worker) and returns a `SessionUser` or `null`.
 */
export function getSession(cookies: AstroCookies): Omit<SessionUser, "correlationId"> | null {
  const cookie = cookies.get(SESSION_COOKIE);
  if (!cookie?.value) return null;

  try {
    // A JWT has three dot-separated base64url segments; we decode the payload (index 1)
    const parts = cookie.value.split(".");
    if (parts.length !== 3) return null;

    const payload: JwtPayload = JSON.parse(atob(parts[1]!.replace(/-/g, "+").replace(/_/g, "/")));
    const userId = payload.sub;
    if (!userId) return null;

    return {
      userId,
      email: payload.email ?? null,
    };
  } catch {
    return null;
  }
}

/**
 * Returns the session user or throws an Astro redirect to the login flow.
 * Use in Astro page frontmatter to guard protected pages.
 *
 * @example
 * const user = requireSession(Astro.cookies, Astro.redirect);
 */
export function requireSession(
  cookies: AstroCookies,
  redirectFn: (url: string, status?: 301 | 302 | 303 | 307 | 308 | 300 | 304) => Response,
  authWorkerUrl = import.meta.env.AUTH_WORKER_URL ?? "",
  requestUrl?: string,
): Omit<SessionUser, "correlationId"> {
  const session = getSession(cookies);
  if (!session) {
    const redirectUri = requestUrl ? `?redirect_uri=${encodeURIComponent(requestUrl)}` : "";
    throw redirectFn(`${authWorkerUrl}/authorize${redirectUri}`, 302);
  }
  return session;
}
