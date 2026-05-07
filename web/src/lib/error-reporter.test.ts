import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { initErrorReporter } from "./error-reporter.js";

const BASE_URL = "https://api.fithub.space";
const CORRELATION_ID = "test-correlation";

function setupReporter(overrideFetch?: typeof globalThis.fetch) {
  const mockFetch = overrideFetch ?? vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", mockFetch);

  initErrorReporter({ apiBaseUrl: BASE_URL, correlationId: CORRELATION_ID });
  return mockFetch as ReturnType<typeof vi.fn>;
}

function capturedBody(mockFetch: ReturnType<typeof vi.fn>): unknown {
  const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
  return JSON.parse(init.body as string);
}

describe("initErrorReporter — window.onerror", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      onerror: null,
      addEventListener: vi.fn(),
      location: { href: "https://app.fithub.space/dashboard" },
    });
    vi.stubGlobal("navigator", { userAgent: "test-agent" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends an error report for window.onerror with an Error object", async () => {
    const mockFetch = setupReporter();

    const error = new Error("something went wrong");
    window.onerror!("message", "https://app.fithub.space/dashboard", 1, 1, error);

    await vi.runAllTimersAsync().catch(() => {});
    await Promise.resolve();

    expect(mockFetch).toHaveBeenCalledOnce();
    const body = capturedBody(mockFetch);
    expect(body).toMatchObject({
      message: "something went wrong",
      context: { source: "https://app.fithub.space/dashboard" },
    });
  });

  it("falls back to event string when no Error object is provided", async () => {
    const mockFetch = setupReporter();

    window.onerror!("Script error", undefined, 1, 1, undefined);

    await Promise.resolve();

    expect(mockFetch).toHaveBeenCalledOnce();
    const body = capturedBody(mockFetch);
    expect(body).toMatchObject({ message: "Script error" });
  });

  it("returns false (does not suppress default handling)", () => {
    setupReporter();
    const result = window.onerror!("err", "src", 1, 1, new Error("x"));
    expect(result).toBe(false);
  });
});

describe("initErrorReporter — unhandledrejection", () => {
  let addEventListenerSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    addEventListenerSpy = vi.fn();
    vi.stubGlobal("window", {
      onerror: null,
      addEventListener: addEventListenerSpy,
      location: { href: "https://app.fithub.space/" },
    });
    vi.stubGlobal("navigator", { userAgent: "test-agent" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("registers an unhandledrejection listener", () => {
    setupReporter();
    expect(addEventListenerSpy).toHaveBeenCalledWith("unhandledrejection", expect.any(Function));
  });

  it("sends a report for a rejected Error promise", async () => {
    const mockFetch = setupReporter();
    const [, listener] = addEventListenerSpy.mock.calls[0] as [string, (e: PromiseRejectionEvent) => void];

    listener({ reason: new Error("unhandled error") } as PromiseRejectionEvent);

    await Promise.resolve();

    expect(mockFetch).toHaveBeenCalledOnce();
    const body = capturedBody(mockFetch);
    expect((body as { message: string }).message).toContain("Unhandled rejection: unhandled error");
  });

  it("sends a report for a rejected string reason", async () => {
    const mockFetch = setupReporter();
    const [, listener] = addEventListenerSpy.mock.calls[0] as [string, (e: PromiseRejectionEvent) => void];

    listener({ reason: "network failure" } as unknown as PromiseRejectionEvent);

    await Promise.resolve();

    expect(mockFetch).toHaveBeenCalledOnce();
    const body = capturedBody(mockFetch);
    expect((body as { message: string }).message).toContain("network failure");
  });
});

describe("initErrorReporter — PII stripping", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {
      onerror: null,
      addEventListener: vi.fn(),
      location: { href: "https://app.fithub.space/" },
    });
    vi.stubGlobal("navigator", { userAgent: "test-agent" });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("redacts email addresses from error messages", async () => {
    const mockFetch = setupReporter();
    window.onerror!("Error for user@example.com", undefined, 1, 1, undefined);
    await Promise.resolve();

    const body = capturedBody(mockFetch) as { message: string };
    expect(body.message).not.toContain("user@example.com");
    expect(body.message).toContain("[redacted]");
  });

  it("redacts UUIDs from error messages", async () => {
    const mockFetch = setupReporter();
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    window.onerror!(`Failed for user ${uuid}`, undefined, 1, 1, undefined);
    await Promise.resolve();

    const body = capturedBody(mockFetch) as { message: string };
    expect(body.message).not.toContain(uuid);
    expect(body.message).toContain("[redacted]");
  });

  it("silently ignores fetch errors (fire-and-forget)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network error")),
    );
    initErrorReporter({ apiBaseUrl: BASE_URL, correlationId: CORRELATION_ID });

    expect(() => {
      window.onerror!("boom", undefined, 1, 1, new Error("boom"));
    }).not.toThrow();
  });
});
