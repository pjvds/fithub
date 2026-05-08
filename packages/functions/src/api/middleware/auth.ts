import type { MiddlewareHandler, Env as HonoEnv } from "hono";
import type { createClient } from "@openauthjs/openauth/client";
import { InvalidAccessTokenError } from "@openauthjs/openauth/error";
import { ErrorCode, LogEvent, type Logger } from "@fithub/core";
import { subjects } from "../../shared/subjects.js";

export interface AuthVariables {
  userId: string;
}

export function authMiddleware(opts: {
  client: ReturnType<typeof createClient>;
  issuer?: string;
}): MiddlewareHandler<HonoEnv & { Variables: AuthVariables & { logger?: Logger } }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (c: any, next) => {
    const log = c.get("logger") as Logger | undefined;
    const header = (c.req.header("authorization") ?? c.req.header("Authorization")) as string | undefined;
    if (!header || !header.toLowerCase().startsWith("bearer ")) {
      log?.warn(LogEvent.authTokenRejected, { code: ErrorCode.AUTH_MISSING_TOKEN, issuer: opts.issuer });
      return c.json({ error: "unauthenticated" }, 401);
    }
    const token = header.slice(7).trim();
    try {
      const result = await opts.client.verify(subjects, token);
      if (result.err) {
        const code = result.err instanceof InvalidAccessTokenError
          ? ErrorCode.AUTH_EXPIRED_TOKEN
          : ErrorCode.AUTH_INVALID_TOKEN;
        log?.warn(LogEvent.authTokenRejected, {
          code,
          issuer: opts.issuer,
          errorType: result.err.constructor?.name ?? "unknown",
          reason: result.err.message,
        });
        return c.json({ error: "unauthenticated" }, 401);
      }
      c.set("userId", result.subject.properties.id);
      log?.info(LogEvent.authTokenAccepted, { userId: result.subject.properties.id });
    } catch (err) {
      log?.warn(LogEvent.authTokenRejected, {
        code: ErrorCode.AUTH_INVALID_TOKEN,
        issuer: opts.issuer,
        errorType: (err as Error).constructor?.name ?? "unknown",
        reason: (err as Error).message,
        stack: (err as Error).stack?.split("\n").slice(0, 3).join(" | "),
      });
      return c.json({ error: "unauthenticated" }, 401);
    }
    await next();
  };
}
