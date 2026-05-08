import { createClient } from "@openauthjs/openauth/client";
import { createSubjects } from "@openauthjs/openauth/subject";
import { object, string } from "valibot";

export type AuthClient = ReturnType<typeof createClient>;

export interface CreateAuthClientOptions {
  /** Optional issuer URL override (defaults to AUTH_WORKER_URL env var). */
  issuer?: string;
  /** Optional fetch override for server-side contexts (e.g. Cloudflare service binding). */
  fetch?: typeof globalThis.fetch;
}

/**
 * Token subjects shared with the auth worker and API worker.
 * Must match `packages/functions/src/shared/subjects.ts` exactly.
 */
export const subjects = createSubjects({
  user: object({
    id: string(),
  }),
});

/**
 * Factory that creates an OpenAuth.js client pointing at the FitHub auth worker.
 *
 * Usage (browser / build-time):
 *   const client = createAuthClient();
 *
 * Usage (Astro SSR with Cloudflare service binding):
 *   const authBinding = context.locals.runtime.env.Auth;
 *   const client = createAuthClient({ fetch: (input, init) => authBinding.fetch(input, init) });
 */
export function createAuthClient(opts?: CreateAuthClientOptions): AuthClient {
  const issuer = opts?.issuer ?? import.meta.env.AUTH_WORKER_URL;
  if (!issuer) throw new Error("Missing required environment variable: AUTH_WORKER_URL");
  return createClient({
    clientID: "web",
    issuer,
    ...(opts?.fetch ? { fetch: opts.fetch } : {}),
  });
}
