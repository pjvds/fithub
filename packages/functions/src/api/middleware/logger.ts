import type { MiddlewareHandler } from "hono";
import { createLogger, type Logger } from "@fithub/core";

export interface LoggerVariables {
  logger: Logger;
}

export interface LoggerMiddlewareOptions {
  service: string;
  env: string;
}

export function loggerMiddleware(
  opts: LoggerMiddlewareOptions,
): MiddlewareHandler<{ Variables: LoggerVariables & { correlationId?: string; userId?: string } }> {
  return async (c, next) => {
    const correlationId = c.get("correlationId");
    const logger = createLogger({
      service: opts.service,
      env: opts.env,
      ...(correlationId !== undefined ? { correlationId } : {}),
    });
    c.set("logger", logger);
    await next();
  };
}
