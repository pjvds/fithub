import { describe, it, expect, vi, beforeEach } from "vitest";
import { createApiClient, ApiClientError } from "./api-client.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeFetch(responses: Response[]): typeof globalThis.fetch {
  let callIndex = 0;
  return vi.fn().mockImplementation(() => {
    const resp = responses[callIndex++] ?? makeResponse(500, { code: "INTERNAL", message: "no more responses" });
    return Promise.resolve(resp);
  });
}

const CORRELATION_ID = "test-correlation-id";
const BASE_URL = "https://api.fithub.app";

// ---------------------------------------------------------------------------
// Success path
// ---------------------------------------------------------------------------

describe("createApiClient — success path", () => {
  it("GET /api/me returns AuthUser", async () => {
    const fetch = makeFetch([makeResponse(200, { userId: "user-1", email: "test@example.com" })]);
    const client = createApiClient({ baseUrl: BASE_URL, correlationId: CORRELATION_ID, fetch });

    const result = await client.getMe();

    expect(result).toEqual({ userId: "user-1", email: "test@example.com" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("forwards x-correlation-id header on all requests", async () => {
    const fetch = makeFetch([makeResponse(200, { connections: [] })]);
    const client = createApiClient({ baseUrl: BASE_URL, correlationId: CORRELATION_ID, fetch });

    await client.listConnections();

    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    const headers = init?.headers as Record<string, string>;
    expect(headers?.["x-correlation-id"]).toBe(CORRELATION_ID);
  });
});

// ---------------------------------------------------------------------------
// Retry on 5xx
// ---------------------------------------------------------------------------

describe("createApiClient — 5xx retry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("succeeds on 2nd attempt after a single 5xx", async () => {
    const successBody = { userId: "user-1", email: null };
    const fetch = makeFetch([
      makeResponse(503, { code: "EXTERNAL_5XX", message: "unavailable" }),
      makeResponse(200, successBody),
    ]);
    const client = createApiClient({ baseUrl: BASE_URL, correlationId: CORRELATION_ID, fetch });

    const promise = client.getMe();
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toEqual(successBody);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("throws ApiClientError after exhausting all retries", async () => {
    const fetch = makeFetch([
      makeResponse(500, { code: "INTERNAL", message: "error 1" }),
      makeResponse(500, { code: "INTERNAL", message: "error 2" }),
      makeResponse(500, { code: "INTERNAL", message: "error 3" }),
    ]);
    const client = createApiClient({ baseUrl: BASE_URL, correlationId: CORRELATION_ID, fetch });

    // Attach rejection handler BEFORE running timers to avoid unhandled rejection
    const assertion = expect(client.getMe()).rejects.toBeInstanceOf(ApiClientError);
    await vi.runAllTimersAsync();
    await assertion;
    expect(fetch).toHaveBeenCalledTimes(3); // initial + 2 retries
  });
});

// ---------------------------------------------------------------------------
// 401 → throws ApiClientError with AUTH code
// ---------------------------------------------------------------------------

describe("createApiClient — 4xx errors", () => {
  it("throws ApiClientError with AUTH_MISSING_TOKEN code on 401", async () => {
    const fetch = makeFetch([makeResponse(401, { code: "AUTH_MISSING_TOKEN", message: "not authenticated" })]);
    const client = createApiClient({ baseUrl: BASE_URL, correlationId: CORRELATION_ID, fetch });

    await expect(client.getMe()).rejects.toMatchObject({
      status: 401,
      code: "AUTH_MISSING_TOKEN",
    });
    // 401s must NOT be retried
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("throws ApiClientError with correct status on 404", async () => {
    const fetch = makeFetch([makeResponse(404, { code: "CONNECTION_NOT_FOUND", message: "not found" })]);
    const client = createApiClient({ baseUrl: BASE_URL, correlationId: CORRELATION_ID, fetch });

    await expect(client.deleteConnection("does-not-exist")).rejects.toMatchObject({
      status: 404,
      code: "CONNECTION_NOT_FOUND",
    });
  });

  it("forwards x-correlation-id on the retry attempt as well", async () => {
    const fetch = makeFetch([
      makeResponse(503, {}),
      makeResponse(200, { userId: "u", email: null }),
    ]);
    const client = createApiClient({ baseUrl: BASE_URL, correlationId: CORRELATION_ID, fetch });

    const promise = client.getMe();
    await vi.runAllTimersAsync();
    await promise;

    // Both calls should include the correlation ID header
    const calls = (fetch as ReturnType<typeof vi.fn>).mock.calls as [string, RequestInit][];
    for (const [, init] of calls) {
      expect((init?.headers as Record<string, string>)?.["x-correlation-id"]).toBe(CORRELATION_ID);
    }
  });
});

// ---------------------------------------------------------------------------
// ApiClientError.toApiError()
// ---------------------------------------------------------------------------

describe("ApiClientError.toApiError()", () => {
  it("returns an ApiError shaped object", () => {
    const err = new ApiClientError({ status: 403, code: "AUTH_INVALID_TOKEN", message: "forbidden" });
    expect(err.toApiError()).toEqual({ status: 403, code: "AUTH_INVALID_TOKEN", message: "forbidden" });
  });
});

// ---------------------------------------------------------------------------
// DELETE with body (non-204 response)
// ---------------------------------------------------------------------------

describe("createApiClient — DELETE with body", () => {
  it("returns parsed JSON when DELETE responds with 200 body", async () => {
    const fetch = makeFetch([makeResponse(200, { deleted: true })]);
    const client = createApiClient({ baseUrl: BASE_URL, correlationId: CORRELATION_ID, fetch });

    const result = await (client as unknown as { deleteAccount(): Promise<{ deleted: boolean }> }).deleteAccount();
    expect(result).toEqual({ deleted: true });
  });
});

// ---------------------------------------------------------------------------
// Endpoint coverage: getSyncHistory, listActivities, getUserProfile,
// requestExport, deleteAccount, reportError
// ---------------------------------------------------------------------------

describe("createApiClient — endpoint coverage", () => {
  it("getSyncHistory — no params (no query string)", async () => {
    const fetch = makeFetch([makeResponse(200, { jobs: [], cursor: null })]);
    const client = createApiClient({ baseUrl: BASE_URL, correlationId: CORRELATION_ID, fetch });

    await client.getSyncHistory();

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe(`${BASE_URL}/api/sync/history`);
  });

  it("getSyncHistory — with cursor and limit", async () => {
    const fetch = makeFetch([makeResponse(200, { jobs: [], cursor: null })]);
    const client = createApiClient({ baseUrl: BASE_URL, correlationId: CORRELATION_ID, fetch });

    await client.getSyncHistory({ cursor: "next-page", limit: 10 });

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toContain("cursor=next-page");
    expect(url).toContain("limit=10");
  });

  it("listActivities — no params", async () => {
    const fetch = makeFetch([makeResponse(200, { activities: [], cursor: null })]);
    const client = createApiClient({ baseUrl: BASE_URL, correlationId: CORRELATION_ID, fetch });

    await client.listActivities();

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe(`${BASE_URL}/api/activities`);
  });

  it("listActivities — with cursor, limit, and platform", async () => {
    const fetch = makeFetch([makeResponse(200, { activities: [], cursor: null })]);
    const client = createApiClient({ baseUrl: BASE_URL, correlationId: CORRELATION_ID, fetch });

    await client.listActivities({ cursor: "c1", limit: 20, platform: "zwift" });

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toContain("platform=zwift");
    expect(url).toContain("limit=20");
  });

  it("getUserProfile — calls GET /api/user/profile", async () => {
    const profile = { userId: "u1", displayName: "Test" };
    const fetch = makeFetch([makeResponse(200, profile)]);
    const client = createApiClient({ baseUrl: BASE_URL, correlationId: CORRELATION_ID, fetch });

    const result = await client.getUserProfile();

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string];
    expect(url).toBe(`${BASE_URL}/api/user/profile`);
    expect(result).toEqual(profile);
  });

  it("requestExport — calls POST /api/user/export", async () => {
    const resp = { exportId: "export-1" };
    const fetch = makeFetch([makeResponse(200, resp)]);
    const client = createApiClient({ baseUrl: BASE_URL, correlationId: CORRELATION_ID, fetch });

    const result = await client.requestExport();

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/api/user/export`);
    expect(init.method).toBe("POST");
    expect(result).toEqual(resp);
  });

  it("deleteAccount — calls DELETE /api/user and handles 204", async () => {
    const fetch = makeFetch([new Response(null, { status: 204 })]);
    const client = createApiClient({ baseUrl: BASE_URL, correlationId: CORRELATION_ID, fetch });

    const result = await client.deleteAccount();

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/api/user`);
    expect(init.method).toBe("DELETE");
    expect(result).toBeUndefined();
  });

  it("reportError — calls POST /api/errors with the error report", async () => {
    const fetch = makeFetch([makeResponse(200, {})]);
    const client = createApiClient({ baseUrl: BASE_URL, correlationId: CORRELATION_ID, fetch });

    await client.reportError({ message: "test error", url: "https://app.fithub.app/" });

    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${BASE_URL}/api/errors`);
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ message: "test error" });
  });
});
