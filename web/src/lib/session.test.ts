/**
 * Unit tests for session.ts helpers.
 * The Astro middleware itself is tested via integration (W035 E2E)
 * since it requires the full Astro request pipeline. Here we test the
 * session decoding and requireSession helpers in isolation.
 */
import { describe, it, expect, vi } from "vitest";
import { getSession, requireSession, SESSION_COOKIE } from "./session.js";
import type { AstroCookies } from "astro";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeCookies(value: string | null): AstroCookies {
  return {
    get: vi.fn().mockReturnValue(value !== null ? { value } : null),
  } as unknown as AstroCookies;
}

/** Creates a minimal JWT-shaped string with the given payload (no signature validation) */
function makeJwt(payload: Record<string, unknown>): string {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = btoa(JSON.stringify(payload)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const sig = "fake-signature";
  return `${header}.${body}.${sig}`;
}

// ---------------------------------------------------------------------------
// getSession
// ---------------------------------------------------------------------------

describe("getSession", () => {
  it("returns null when cookie is absent", () => {
    const cookies = makeCookies(null);
    expect(getSession(cookies)).toBeNull();
  });

  it("returns null when cookie value is empty string", () => {
    const cookies = makeCookies("");
    expect(getSession(cookies)).toBeNull();
  });

  it("returns null for a non-JWT value (missing dots)", () => {
    const cookies = makeCookies("not-a-jwt");
    expect(getSession(cookies)).toBeNull();
  });

  it("returns null when JWT payload has no sub claim", () => {
    const jwt = makeJwt({ email: "test@example.com" });
    const cookies = makeCookies(jwt);
    expect(getSession(cookies)).toBeNull();
  });

  it("decodes userId from sub claim", () => {
    const jwt = makeJwt({ sub: "user-abc", email: "rider@fithub.app" });
    const cookies = makeCookies(jwt);
    const session = getSession(cookies);
    expect(session).toMatchObject({ userId: "user-abc", email: "rider@fithub.app" });
  });

  it("sets email to null when claim is absent", () => {
    const jwt = makeJwt({ sub: "user-abc" });
    const cookies = makeCookies(jwt);
    const session = getSession(cookies);
    expect(session?.email).toBeNull();
  });

  it("reads from the correct cookie name", () => {
    const cookies = makeCookies(null);
    getSession(cookies);
    expect(cookies.get).toHaveBeenCalledWith(SESSION_COOKIE);
  });
});

// ---------------------------------------------------------------------------
// requireSession
// ---------------------------------------------------------------------------

describe("requireSession", () => {
  const AUTH_URL = "https://auth.fithub.app";
  const REQUEST_URL = "https://app.fithub.app/dashboard";

  it("returns session when cookie is valid", () => {
    const jwt = makeJwt({ sub: "user-1", email: "u@test.com" });
    const cookies = makeCookies(jwt);
    const redirectFn = vi.fn();

    const session = requireSession(cookies, redirectFn, AUTH_URL, REQUEST_URL);

    expect(session.userId).toBe("user-1");
    expect(redirectFn).not.toHaveBeenCalled();
  });

  it("throws a redirect response when session is missing", () => {
    const cookies = makeCookies(null);
    const mockRedirectResponse = new Response(null, { status: 302, headers: { location: "/" } });
    const redirectFn = vi.fn().mockReturnValue(mockRedirectResponse);

    expect(() => requireSession(cookies, redirectFn, AUTH_URL, REQUEST_URL)).toThrow();
    expect(redirectFn).toHaveBeenCalledOnce();
    const [url, status] = redirectFn.mock.calls[0] as [string, number];
    expect(status).toBe(302);
    expect(url).toContain("/authorize");
  });

  it("URL-encodes the redirect_uri parameter", () => {
    const cookies = makeCookies(null);
    const mockRedirectResponse = new Response(null, { status: 302 });
    const redirectFn = vi.fn().mockReturnValue(mockRedirectResponse);

    try {
      requireSession(cookies, redirectFn, AUTH_URL, "https://app.fithub.app/dashboard?tab=sync");
    } catch {
      // expected — redirect throws
    }

    const [url] = redirectFn.mock.calls[0] as [string];
    expect(url).toContain("redirect_uri=https%3A%2F%2Fapp.fithub.app%2Fdashboard%3Ftab%3Dsync");
  });

  it("does not include redirect_uri when requestUrl is omitted", () => {
    const cookies = makeCookies(null);
    const mockRedirectResponse = new Response(null, { status: 302 });
    const redirectFn = vi.fn().mockReturnValue(mockRedirectResponse);

    try {
      requireSession(cookies, redirectFn, AUTH_URL);
    } catch {
      // expected
    }

    const [url] = redirectFn.mock.calls[0] as [string];
    expect(url).toBe(`${AUTH_URL}/authorize`);
  });
});
