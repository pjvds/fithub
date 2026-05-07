/**
 * Stable API response types shared between the backend Workers and the web
 * frontend. These types mirror the shapes defined in
 * `.specify/specs/005-web-frontend/contracts/openapi.yaml`.
 *
 * All epoch timestamps are in **seconds** unless noted otherwise.
 * Camel-case property names are used internally; the API returns snake_case
 * which the api-client.ts wrapper converts (or keeps raw — consumers choose).
 */

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

/** Identity returned by GET /api/me — session validity check. */
export interface AuthUser {
  /** UUID of the authenticated user */
  userId: string;
  /** Primary email; may be null for Apple private-relay users */
  email: string | null;
}

/**
 * Session user decoded from the fithub_session cookie server-side.
 * Stored in `Astro.locals` after auth-gate middleware validates the session.
 */
export interface SessionUser {
  userId: string;
  email: string | null;
  /** Correlation ID attached to this request lifecycle */
  correlationId: string;
}

// ---------------------------------------------------------------------------
// Connections
// ---------------------------------------------------------------------------

export type Platform = "strava" | "apple_health";
export type ConnectionStatus = "active" | "requires_reauth" | "disconnected";

export interface Connection {
  id: string;
  platform: Platform;
  status: ConnectionStatus;
  /** Epoch seconds when the connection was established */
  connected_at: number;
  /** Epoch seconds of last successful sync; null if never synced */
  last_synced_at: number | null;
  /** Human-readable error message if the last sync failed */
  last_error: string | null;
}

export interface ConnectionsResponse {
  connections: Connection[];
}

// ---------------------------------------------------------------------------
// Sync History
// ---------------------------------------------------------------------------

export type SyncJobStatus = "pending" | "success" | "partial" | "failed";

export interface SyncJob {
  id: string;
  platform: "strava";
  status: SyncJobStatus;
  /** Epoch seconds when the job started */
  started_at: number;
  /** Epoch seconds when the job ended; null if still running */
  ended_at: number | null;
  /** Number of activities that were synced in this job */
  activities_synced: number;
  /** Human-readable error message; present only on partial/failed jobs */
  error_message: string | null;
}

export interface SyncHistoryResponse {
  jobs: SyncJob[];
  /** Opaque cursor for the next page; null if no more pages */
  next_cursor: string | null;
}

export interface ManualSyncResponse {
  /** UUID of the enqueued sync job */
  job_id: string;
  platform: "strava";
  status: "pending";
  /** Epoch seconds when the job was enqueued */
  started_at: number;
}

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------

export type ActivityType =
  | "running"
  | "cycling"
  | "swimming"
  | "hiking"
  | "walking"
  | "other";

export interface ActivitySource {
  platform: Platform;
  externalId: string;
}

/**
 * A deduplicated, canonical activity as returned by GET /api/activities.
 * The API-layer shape (snake_case, epoch seconds) — distinct from the DB-layer
 * `CanonicalActivity` interface in adapters/types.ts (camelCase, Dates).
 */
export interface CanonicalActivityView {
  id: string;
  type: ActivityType;
  /** Epoch seconds */
  started_at: number;
  /** Epoch seconds */
  ended_at: number;
  duration_s: number;
  distance_m: number | null;
  calories_kcal: number | null;
  avg_heart_rate: number | null;
  primary_source: Platform;
  /** Present when this activity belongs to a dedup group */
  dedup_group_id: string | null;
  /** All source platform records that map to this canonical activity */
  sources?: ActivitySource[];
}

export interface ActivitiesResponse {
  activities: CanonicalActivityView[];
  /** Opaque cursor for the next page; null if no more pages */
  next_cursor: string | null;
}

// ---------------------------------------------------------------------------
// User Profile & Settings
// ---------------------------------------------------------------------------

export interface UserProfile {
  user_id: string;
  email: string | null;
  display_name: string | null;
  /** Epoch seconds when the account was created */
  created_at: number;
  connections: Connection[];
}

export interface ExportRequestResponse {
  /** Whether the export request was accepted */
  accepted: boolean;
  message: string;
}

// ---------------------------------------------------------------------------
// Error Handling
// ---------------------------------------------------------------------------

/** Normalised API error produced by the api-client.ts fetch wrapper. */
export interface ApiError {
  /** HTTP status code */
  status: number;
  /** Typed error code from ErrorCode enum (or a raw string for unknown codes) */
  code: string;
  /** Human-readable error message */
  message: string;
}

/** Client-side error report sent to POST /api/errors */
export interface ErrorReport {
  /** Typed code from ErrorCode enum */
  code: string;
  message: string;
  /** Optional structured context (no PII, no tokens, no cookies) */
  context: Record<string, unknown> | null;
  /** Epoch milliseconds (client clock) */
  occurred_at: number;
  correlation_id: string | null;
}
