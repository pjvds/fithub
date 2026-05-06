import type { ErrorCode } from "./error-codes.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogContext {
  service: string;
  env: string;
  correlationId?: string;
  userId?: string;
  connectionId?: string;
  platform?: string;
}

export type LogFields = Record<string, unknown>;

const REDACT_KEYS = new Set([
  "token",
  "accesstoken",
  "refreshtoken",
  "authorization",
  "password",
  "secret",
  "apikey",
  "rawjson",
  "rawpayload",
  "raw",
  "payload",
  "email",
  "name",
  "ip",
  "ipaddress",
]);

function redact(value: unknown, depth = 0): unknown {
  if (depth > 4 || value == null) return value;
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = REDACT_KEYS.has(k.toLowerCase()) ? "[redacted]" : redact(v, depth + 1);
    }
    return out;
  }
  return value;
}

export interface ErrorFields extends LogFields {
  code: ErrorCode;
  err?: unknown;
}

export class Logger {
  constructor(private readonly ctx: LogContext) {}

  child(extra: Partial<LogContext>): Logger {
    return new Logger({ ...this.ctx, ...extra });
  }

  private emit(level: LogLevel, event: string, fields: LogFields = {}): void {
    const entry = {
      ts: new Date().toISOString(),
      level,
      event,
      ...this.ctx,
      ...(redact(fields) as object),
    };
    const line = JSON.stringify(entry);
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  }

  debug(event: string, fields?: LogFields): void {
    this.emit("debug", event, fields);
  }
  info(event: string, fields?: LogFields): void {
    this.emit("info", event, fields);
  }
  warn(event: string, fields?: LogFields): void {
    this.emit("warn", event, fields);
  }
  error(event: string, fields: ErrorFields): void {
    this.emit("error", event, fields);
  }
}

export function createLogger(ctx: LogContext): Logger {
  return new Logger(ctx);
}
