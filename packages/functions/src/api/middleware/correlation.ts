import type { MiddlewareHandler } from "hono";

export interface CorrelationVariables {
  correlationId: string;
}

const HEADER = "x-correlation-id";

export function correlationMiddleware(): MiddlewareHandler<{ Variables: CorrelationVariables }> {
  return async (c, next) => {
    const incoming = c.req.header(HEADER) ?? c.req.header("x-request-id");
    const correlationId = incoming ?? crypto.randomUUID();
    c.set("correlationId", correlationId);
    c.header(HEADER, correlationId);
    await next();
  };
}
