/**
 * Typed fetch wrapper for the FitHub API.
 *
 * Responsibilities:
 * - Injects `x-correlation-id` on every request
 * - Retries transient 5xx errors (max 2 retries, 500ms / 1500ms backoff)
 * - Normalises all non-2xx responses into a typed `ApiError`
 * - Returns typed response objects per endpoint
 *
 * Usage:
 *   const client = createApiClient({ baseUrl: "https://api.fithub.space", correlationId });
 *   const { connections } = await client.listConnections();
 */

import type {
  AuthUser,
  ConnectionsResponse,
  SyncHistoryResponse,
  ManualSyncResponse,
  ActivitiesResponse,
  UserProfile,
  ExportRequestResponse,
  ErrorReport,
  ApiError,
} from "@fithub/core";

const MAX_RETRIES = 2;
const RETRY_DELAYS_MS = [500, 1500] as const;

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(error: ApiError) {
    super(error.message);
    this.name = "ApiClientError";
    this.status = error.status;
    this.code = error.code;
  }

  toApiError(): ApiError {
    return { status: this.status, code: this.code, message: this.message };
  }
}

interface ApiClientOptions {
  baseUrl: string;
  correlationId: string;
  /** Optional custom fetch implementation (e.g. for testing) */
  fetch?: typeof globalThis.fetch;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithRetry(
  url: string,
  options: RequestInit,
  fetchFn: typeof globalThis.fetch,
): Promise<Response> {
  let lastError: ApiClientError | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_DELAYS_MS[attempt - 1] ?? 1500;
      await sleep(delay);
    }

    const response = await fetchFn(url, options);

    if (response.ok) return response;

    // Only retry on transient server errors (5xx)
    if (response.status >= 500 && attempt < MAX_RETRIES) {
      lastError = new ApiClientError({
        status: response.status,
        code: "EXTERNAL_5XX",
        message: `Server error ${response.status}`,
      });
      continue;
    }

    // For 4xx errors and exhausted retries, parse and throw
    let errorBody: { code?: string; message?: string; error?: string } = {};
    try {
      errorBody = (await response.json()) as typeof errorBody;
    } catch {
      // ignore parse error — use defaults below
    }

    throw new ApiClientError({
      status: response.status,
      code: errorBody.code ?? statusToCode(response.status),
      message: errorBody.message ?? errorBody.error ?? response.statusText,
    });
  }

  // Exhausted retries
  throw lastError ?? new ApiClientError({ status: 500, code: "INTERNAL", message: "Request failed" });
}

function statusToCode(status: number): string {
  if (status === 401) return "AUTH_MISSING_TOKEN";
  if (status === 403) return "AUTH_INVALID_TOKEN";
  if (status === 404) return "CONNECTION_NOT_FOUND";
  if (status === 429) return "RATE_LIMIT";
  return "INTERNAL";
}

export function createApiClient(options: ApiClientOptions) {
  const { baseUrl, correlationId, fetch: fetchFn = globalThis.fetch } = options;

  const baseHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    "x-correlation-id": correlationId,
  };

  async function get<T>(path: string): Promise<T> {
    const response = await fetchWithRetry(
      `${baseUrl}${path}`,
      { method: "GET", headers: baseHeaders, credentials: "include" },
      fetchFn,
    );
    return response.json() as Promise<T>;
  }

  async function post<T>(path: string, body?: unknown): Promise<T> {
    const response = await fetchWithRetry(
      `${baseUrl}${path}`,
      {
        method: "POST",
        headers: baseHeaders,
        credentials: "include",
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      },
      fetchFn,
    );
    return response.json() as Promise<T>;
  }

  async function del<T>(path: string): Promise<T> {
    const response = await fetchWithRetry(
      `${baseUrl}${path}`,
      { method: "DELETE", headers: baseHeaders, credentials: "include" },
      fetchFn,
    );
    // 204 No Content has no body — skip JSON parse
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  return {
    /** GET /api/me — verify session and get user identity */
    getMe(): Promise<AuthUser> {
      return get<AuthUser>("/api/me");
    },

    /** GET /api/connections — list all platform connections */
    listConnections(): Promise<ConnectionsResponse> {
      return get<ConnectionsResponse>("/api/connections");
    },

    /** DELETE /api/connections/:id — disconnect a platform */
    deleteConnection(id: string): Promise<void> {
      return del<void>(`/api/connections/${id}`);
    },

    /** GET /api/sync/history — paginated sync job history */
    getSyncHistory(params?: { cursor?: string; limit?: number }): Promise<SyncHistoryResponse> {
      const qs = new URLSearchParams();
      if (params?.cursor) qs.set("cursor", params.cursor);
      if (params?.limit) qs.set("limit", String(params.limit));
      const query = qs.toString() ? `?${qs.toString()}` : "";
      return get<SyncHistoryResponse>(`/api/sync/history${query}`);
    },

    /** POST /api/sync/trigger — manually trigger a sync for a platform */
    triggerSync(platform: "strava"): Promise<ManualSyncResponse> {
      return post<ManualSyncResponse>("/api/sync/trigger", { platform });
    },

    /** GET /api/activities — paginated activity history */
    listActivities(params?: {
      cursor?: string;
      limit?: number;
      platform?: string;
    }): Promise<ActivitiesResponse> {
      const qs = new URLSearchParams();
      if (params?.cursor) qs.set("cursor", params.cursor);
      if (params?.limit) qs.set("limit", String(params.limit));
      if (params?.platform) qs.set("platform", params.platform);
      const query = qs.toString() ? `?${qs.toString()}` : "";
      return get<ActivitiesResponse>(`/api/activities${query}`);
    },

    /** GET /api/user/profile — user profile for settings page */
    getUserProfile(): Promise<UserProfile> {
      return get<UserProfile>("/api/user/profile");
    },

    /** POST /api/user/export — request a data export */
    requestExport(): Promise<ExportRequestResponse> {
      return post<ExportRequestResponse>("/api/user/export");
    },

    /** DELETE /api/user — delete the authenticated user account */
    deleteAccount(): Promise<void> {
      return del<void>("/api/user");
    },

    /** POST /api/errors — report a client-side error */
    reportError(report: ErrorReport): Promise<void> {
      return post<void>("/api/errors", report);
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
