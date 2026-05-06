import { describe, expect, it, vi } from "vitest";
import { createLogger, ErrorCode, LogEvent, Logger } from "../src/logging/index.js";

function captureLine(level: "log" | "warn" | "error", fn: () => void): unknown {
  const spy = vi.spyOn(console, level).mockImplementation(() => {});
  fn();
  const calls = spy.mock.calls;
  spy.mockRestore();
  if (calls.length === 0) return null;
  return JSON.parse(calls[0]?.[0] as string);
}

describe("Logger", () => {
  it("emits JSON with required fields", () => {
    const log = createLogger({ service: "api", env: "test", correlationId: "c-1" });
    const entry = captureLine("log", () => log.info(LogEvent.apiRequestStarted, { path: "/health" })) as Record<
      string,
      unknown
    >;

    expect(entry).toMatchObject({
      level: "info",
      event: "api.request.started",
      service: "api",
      env: "test",
      correlationId: "c-1",
      path: "/health",
    });
    expect(typeof entry.ts).toBe("string");
    expect(new Date(entry.ts as string).toISOString()).toBe(entry.ts);
  });

  it("redacts deny-listed fields at any depth", () => {
    const log = createLogger({ service: "auth", env: "test" });
    const entry = captureLine("log", () =>
      log.info("test.redact", {
        token: "secret-1",
        nested: { accessToken: "secret-2", safe: "ok" },
        list: [{ password: "p" }],
      }),
    ) as Record<string, unknown>;

    expect(entry.token).toBe("[redacted]");
    expect((entry.nested as Record<string, unknown>).accessToken).toBe("[redacted]");
    expect((entry.nested as Record<string, unknown>).safe).toBe("ok");
    expect(((entry.list as unknown[])[0] as Record<string, unknown>).password).toBe("[redacted]");
  });

  it("routes error level to console.error and includes code", () => {
    const log = createLogger({ service: "api", env: "test" });
    const entry = captureLine("error", () =>
      log.error(LogEvent.apiRequestFailed, { code: ErrorCode.INTERNAL, err: new Error("boom") }),
    ) as Record<string, unknown>;

    expect(entry.level).toBe("error");
    expect(entry.code).toBe("INTERNAL");
    expect((entry.err as Record<string, unknown>).message).toBe("boom");
  });

  it("child loggers inherit and override context", () => {
    const root = createLogger({ service: "api", env: "test" });
    const child = root.child({ userId: "u-1", correlationId: "c-2" });
    expect(child).toBeInstanceOf(Logger);
    const entry = captureLine("log", () => child.info("scope.check")) as Record<string, unknown>;
    expect(entry.userId).toBe("u-1");
    expect(entry.correlationId).toBe("c-2");
  });
});
