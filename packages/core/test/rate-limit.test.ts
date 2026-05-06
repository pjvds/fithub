import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { RateLimitBudget } from "@fithub/core";

describe("RateLimitBudget", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with the initial budget and is not exhausted", () => {
    const budget = new RateLimitBudget(10);
    expect(budget.isExhausted()).toBe(false);
    expect(budget.getRemaining()).toBe(10);
  });

  it("decrement reduces remaining count", () => {
    const budget = new RateLimitBudget(3);
    budget.decrement();
    expect(budget.getRemaining()).toBe(2);
    budget.decrement();
    budget.decrement();
    expect(budget.getRemaining()).toBe(0);
    expect(budget.isExhausted()).toBe(true);
  });

  it("remaining cannot go below zero", () => {
    const budget = new RateLimitBudget(1);
    budget.decrement();
    budget.decrement();
    expect(budget.getRemaining()).toBe(0);
  });

  it("consumeFromHeaders updates remaining from X-RateLimit-Remaining", () => {
    const budget = new RateLimitBudget(600);
    const headers = new Headers({ "X-RateLimit-Remaining": "42" });
    budget.consumeFromHeaders(headers);
    expect(budget.getRemaining()).toBe(42);
  });

  it("consumeFromHeaders sets resetAt from Retry-After", () => {
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    const budget = new RateLimitBudget(1);
    budget.decrement(); // exhaust

    const headers = new Headers({ "Retry-After": "60" });
    budget.consumeFromHeaders(headers);

    expect(budget.msUntilReset()).toBeGreaterThan(0);
  });

  it("msUntilReset returns 0 when no reset window is active", () => {
    const budget = new RateLimitBudget(10);
    expect(budget.msUntilReset()).toBe(0);
  });

  it("auto-resets remaining after resetAt window passes", () => {
    vi.setSystemTime(new Date("2024-01-01T00:00:00Z"));
    const budget = new RateLimitBudget(5);
    budget.decrement();
    budget.decrement();
    budget.decrement();
    budget.decrement();
    budget.decrement(); // exhausted

    const headers = new Headers({ "Retry-After": "60" });
    budget.consumeFromHeaders(headers);
    expect(budget.isExhausted()).toBe(true);

    // Advance past the reset window
    vi.advanceTimersByTime(61_000);
    expect(budget.isExhausted()).toBe(false);
    expect(budget.getRemaining()).toBe(5); // reset to initial
  });

  it("ignores non-numeric Retry-After header", () => {
    const budget = new RateLimitBudget(10);
    const headers = new Headers({ "Retry-After": "not-a-number" });
    budget.consumeFromHeaders(headers);
    expect(budget.msUntilReset()).toBe(0);
  });

  it("ignores non-numeric X-RateLimit-Remaining header", () => {
    const budget = new RateLimitBudget(10);
    const headers = new Headers({ "X-RateLimit-Remaining": "abc" });
    budget.consumeFromHeaders(headers);
    expect(budget.getRemaining()).toBe(10);
  });
});
