import { describe, it, expect } from "vitest";
import { formatDuration, formatDistance, formatRelativeTime, composeSourceBadges } from "./formatters.js";

// Fixed "now" = 2025-01-15T12:00:00Z in milliseconds
const NOW_MS = 1736942400_000;

// ---------------------------------------------------------------------------
// formatDuration
// ---------------------------------------------------------------------------

describe("formatDuration", () => {
  it.each([
    [0,    "0s"],
    [1,    "1s"],
    [59,   "59s"],
    [60,   "1m 0s"],
    [65,   "1m 5s"],
    [3600, "1h 0m"],
    [3661, "1h 1m"],
    [7323, "2h 2m"],
    [-5,   "0s"],  // negative guard
  ])("formatDuration(%i) → %s", (input, expected) => {
    expect(formatDuration(input)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// formatDistance
// ---------------------------------------------------------------------------

describe("formatDistance", () => {
  it.each([
    [0,      "0m"],
    [500,    "500m"],
    [999,    "999m"],
    [1000,   "1.0km"],
    [10500,  "10.5km"],
    [42195,  "42.2km"],
    [-10,    "0m"],  // negative guard
  ])("formatDistance(%i) → %s", (input, expected) => {
    expect(formatDistance(input)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// formatRelativeTime
// ---------------------------------------------------------------------------

describe("formatRelativeTime", () => {
  // Helper: convert seconds-before-NOW into epoch seconds
  const ago = (seconds: number) => Math.floor(NOW_MS / 1000) - seconds;

  it.each([
    // seconds ago
    [ago(0),           "just now"],
    [ago(30),          "just now"],
    [ago(59),          "just now"],
    // minutes
    [ago(60),          "1 minute ago"],
    [ago(120),         "2 minutes ago"],
    [ago(3599),        "59 minutes ago"],
    // hours
    [ago(3600),        "1 hour ago"],
    [ago(7200),        "2 hours ago"],
    [ago(86399),       "23 hours ago"],
    // days
    [ago(86400),       "1 day ago"],
    [ago(172800),      "2 days ago"],
    [ago(86400 * 29),  "29 days ago"],
    // months
    [ago(86400 * 30),  "1 month ago"],
    [ago(86400 * 60),  "2 months ago"],
    [ago(86400 * 364), "1 year ago"],   // 364d = 12 months → crosses year threshold
    // years
    [ago(86400 * 365), "1 year ago"],
    [ago(86400 * 730), "2 years ago"],
  ])("formatRelativeTime(%i) → %s", (epochSecs, expected) => {
    expect(formatRelativeTime(epochSecs, NOW_MS)).toBe(expected);
  });

  it("handles future timestamps gracefully", () => {
    const future = Math.floor(NOW_MS / 1000) + 3600;
    expect(formatRelativeTime(future, NOW_MS)).toBe("just now");
  });
});

// ---------------------------------------------------------------------------
// composeSourceBadges
// ---------------------------------------------------------------------------

describe("composeSourceBadges", () => {
  it.each([
    [["zwift"],                  ["Zwift"]],
    [["strava"],                 ["Strava"]],
    [["apple_health"],           ["Apple Health"]],
    [["zwift", "strava"],        ["Zwift", "Strava"]],
    [[],                         []],
    [["unknown_platform"],       ["Unknown_platform"]], // fallback title-case
  ] as [string[], string[]][])("composeSourceBadges(%j) → %j", (input, expected) => {
    expect(composeSourceBadges(input)).toEqual(expected);
  });
});
