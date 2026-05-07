import { describe, it, expect } from "vitest";
import { ErrorCode, LoggedError } from "../src/logging/error-codes.js";

describe("ErrorCode", () => {
  it("exports all expected codes as string literals", () => {
    expect(ErrorCode.AUTH_MISSING_TOKEN).toBe("AUTH_MISSING_TOKEN");
    expect(ErrorCode.AUTH_INVALID_TOKEN).toBe("AUTH_INVALID_TOKEN");
    expect(ErrorCode.OAUTH_REFRESH_FAILED).toBe("OAUTH_REFRESH_FAILED");
    expect(ErrorCode.INTERNAL).toBe("INTERNAL");
  });
});

describe("LoggedError", () => {
  it("is an instance of Error", () => {
    const err = new LoggedError(ErrorCode.AUTH_INVALID_TOKEN, "bad token");
    expect(err instanceof Error).toBe(true);
  });

  it("sets name to LoggedError", () => {
    const err = new LoggedError(ErrorCode.AUTH_EXPIRED_TOKEN, "expired");
    expect(err.name).toBe("LoggedError");
  });

  it("carries the error code", () => {
    const err = new LoggedError(ErrorCode.OAUTH_REFRESH_FAILED, "refresh failed");
    expect(err.code).toBe("OAUTH_REFRESH_FAILED");
  });

  it("carries the message", () => {
    const err = new LoggedError(ErrorCode.INTERNAL, "something blew up");
    expect(err.message).toBe("something blew up");
  });

  it("defaults fields to empty object when omitted", () => {
    const err = new LoggedError(ErrorCode.INTERNAL, "oops");
    expect(err.fields).toEqual({});
  });

  it("stores provided fields", () => {
    const fields = { userId: "u-123", platform: "strava" };
    const err = new LoggedError(ErrorCode.CONNECTION_NOT_FOUND, "not found", fields);
    expect(err.fields).toEqual(fields);
  });

  it("can be caught and narrowed via instanceof", () => {
    function throws() {
      throw new LoggedError(ErrorCode.RATE_LIMIT, "too many requests");
    }
    expect(throws).toThrow(LoggedError);
  });
});
