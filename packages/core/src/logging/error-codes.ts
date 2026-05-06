export const ErrorCode = {
  AUTH_MISSING_TOKEN: "AUTH_MISSING_TOKEN",
  AUTH_INVALID_TOKEN: "AUTH_INVALID_TOKEN",
  AUTH_EXPIRED_TOKEN: "AUTH_EXPIRED_TOKEN",
  AUTH_BAD_AUDIENCE: "AUTH_BAD_AUDIENCE",
  AUTH_BAD_ISSUER: "AUTH_BAD_ISSUER",
  OAUTH_REFRESH_FAILED: "OAUTH_REFRESH_FAILED",
  OAUTH_REVOKED: "OAUTH_REVOKED",
  WEBHOOK_BAD_SIGNATURE: "WEBHOOK_BAD_SIGNATURE",
  RATE_LIMIT: "RATE_LIMIT",
  EXTERNAL_5XX: "EXTERNAL_5XX",
  DB_WRITE_FAILED: "DB_WRITE_FAILED",
  QUEUE_PUBLISH_FAILED: "QUEUE_PUBLISH_FAILED",
  OUTBOX_RELAY_FAILED: "OUTBOX_RELAY_FAILED",
  IDEMPOTENCY_REPLAY: "IDEMPOTENCY_REPLAY",
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export class LoggedError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly fields: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "LoggedError";
  }
}
