/**
 * Client-side error reporter (W031)
 * Hooks window.onerror and unhandledrejection → POST /api/errors
 * Strips PII: email, tokens, UUIDs from message strings.
 */

import { createApiClient } from "./api-client";

const PII_PATTERNS = [
  // emails
  /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
  // bearer tokens / JWTs (3-part base64url separated by dots)
  /[A-Za-z0-9\-_]{20,}\.[A-Za-z0-9\-_]{20,}\.[A-Za-z0-9\-_]{20,}/g,
  // UUIDs
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
];

function stripPii(value: string): string {
  let sanitized = value;
  for (const pattern of PII_PATTERNS) {
    sanitized = sanitized.replace(pattern, "[redacted]");
  }
  return sanitized;
}

interface ReporterOptions {
  apiBaseUrl: string;
  correlationId: string;
}

export function initErrorReporter({ apiBaseUrl, correlationId }: ReporterOptions): void {
  const client = createApiClient({ baseUrl: apiBaseUrl, correlationId });

  function sendReport(message: string, source?: string): void {
    const report = {
      message: stripPii(message),
      source: source ? stripPii(source) : undefined,
      url: stripPii(window.location.href),
      user_agent: navigator.userAgent,
    };
    // Fire-and-forget — don't await, don't surface errors to UI
    client.reportError(report).catch(() => {});
  }

  window.onerror = (_event, source, _lineno, _colno, error) => {
    sendReport(error?.message ?? String(_event), source);
    return false; // don't suppress default handling
  };

  window.addEventListener("unhandledrejection", (event) => {
    const msg = event.reason instanceof Error ? event.reason.message : String(event.reason);
    sendReport(`Unhandled rejection: ${msg}`);
  });
}
