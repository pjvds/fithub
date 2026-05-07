/// <reference path="../.astro/types.d.ts" />
/// <reference types="astro/client" />

interface ImportMetaEnv {
  readonly AUTH_WORKER_URL: string;
  readonly API_BASE_URL: string;
  readonly PUBLIC_MSW_ENABLED: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare namespace App {
  interface Locals {
    /** Correlation ID minted for this request — forwarded to API calls */
    correlationId: string;
    /** Authenticated user; populated by middleware after session validation */
    user?: {
      userId: string;
      email: string | null;
    };
  }
}
