import { describe, it, expect } from "vitest";
import { scoreDedup } from "../src/dedup/scorer.js";

const BASE = {
  activityType: "ride",
  startedAt: new Date("2024-03-01T10:00:00Z"),
  durationSeconds: 3600,
  distanceMeters: 50000,
};

describe("scoreDedup", () => {
  it("returns 1.0 for identical activities", () => {
    const result = scoreDedup(BASE, BASE);
    expect(result.confidence).toBe(1.0);
    expect(result.breakdown).toEqual({ type: 30, time: 30, duration: 25, distance: 15 });
  });

  it("returns 0.0 for activities with nothing in common", () => {
    const other = {
      activityType: "run",
      startedAt: new Date("2024-03-01T12:00:00Z"), // 2h difference
      durationSeconds: 600,
      distanceMeters: 2000,
    };
    const result = scoreDedup(BASE, other);
    expect(result.confidence).toBe(0);
    expect(result.breakdown).toEqual({ type: 0, time: 0, duration: 0, distance: 0 });
  });

  it("awards type score for matching activityType", () => {
    const other = {
      activityType: "ride",
      startedAt: new Date("2024-03-01T12:00:00Z"), // out of time window
      durationSeconds: 600,
      distanceMeters: 2000,
    };
    const result = scoreDedup(BASE, other);
    expect(result.breakdown.type).toBe(30);
    expect(result.breakdown.time).toBe(0);
  });

  it("awards time score for startedAt within ±5 minutes", () => {
    const within5m = {
      ...BASE,
      activityType: "run", // different type
      startedAt: new Date("2024-03-01T10:04:59Z"),
    };
    const result = scoreDedup(BASE, within5m);
    expect(result.breakdown.time).toBe(30);
    expect(result.breakdown.type).toBe(0);
  });

  it("does not award time score for startedAt exactly at 5 minutes boundary + 1ms", () => {
    const just_outside = {
      ...BASE,
      startedAt: new Date(BASE.startedAt.getTime() + 5 * 60 * 1000 + 1),
    };
    const result = scoreDedup(BASE, just_outside);
    expect(result.breakdown.time).toBe(0);
  });

  it("awards duration score within ±10%", () => {
    const within10pct = { ...BASE, durationSeconds: 3960, distanceMeters: 99999 }; // +10% exactly
    const result = scoreDedup(BASE, within10pct);
    expect(result.breakdown.duration).toBe(25);
  });

  it("does not award duration score outside ±10%", () => {
    const outside = { ...BASE, durationSeconds: 4200 }; // ~14% off from max-denominator
    const result = scoreDedup(BASE, outside);
    expect(result.breakdown.duration).toBe(0);
  });

  it("awards distance score within ±5%", () => {
    const within5pct = { ...BASE, distanceMeters: 52500 }; // exactly +5%
    const result = scoreDedup(BASE, within5pct);
    expect(result.breakdown.distance).toBe(15);
  });

  it("does not award distance score outside ±5%", () => {
    const outside = { ...BASE, distanceMeters: 53000 }; // >5%
    const result = scoreDedup(BASE, outside);
    expect(result.breakdown.distance).toBe(0);
  });

  it("handles null duration and distance gracefully", () => {
    const noNumerics = { ...BASE, durationSeconds: null, distanceMeters: null };
    const result = scoreDedup(noNumerics, noNumerics);
    expect(result.breakdown.duration).toBe(0);
    expect(result.breakdown.distance).toBe(0);
    expect(result.breakdown.type).toBe(30);
    expect(result.breakdown.time).toBe(30);
  });

  it("handles numeric timestamps (unix ms) in startedAt", () => {
    const ts = { ...BASE, startedAt: BASE.startedAt.getTime() };
    const result = scoreDedup(ts, ts);
    expect(result.confidence).toBe(1.0);
  });
});
