/**
 * UI formatting utilities for activity and sync data.
 *
 * All functions are pure (no side-effects, no I/O) so they can be snapshot-tested
 * and safely used in both server-rendered Astro pages and React islands.
 */

// ---------------------------------------------------------------------------
// Duration
// ---------------------------------------------------------------------------

/**
 * Formats a duration in seconds to a human-readable string.
 * Examples:
 *   formatDuration(65)    → "1m 5s"
 *   formatDuration(3600)  → "1h 0m"
 *   formatDuration(3661)  → "1h 1m"
 *   formatDuration(45)    → "45s"
 */
export function formatDuration(seconds: number): string {
  if (seconds < 0) return "0s";

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ---------------------------------------------------------------------------
// Distance
// ---------------------------------------------------------------------------

/**
 * Formats a distance in metres to a human-readable string.
 * Uses km for distances ≥ 1000m.
 * Examples:
 *   formatDistance(500)    → "500m"
 *   formatDistance(1000)   → "1.0km"
 *   formatDistance(10500)  → "10.5km"
 *   formatDistance(0)      → "0m"
 */
export function formatDistance(metres: number): string {
  if (metres < 0) return "0m";
  if (metres < 1000) return `${Math.round(metres)}m`;
  return `${(metres / 1000).toFixed(1)}km`;
}

// ---------------------------------------------------------------------------
// Relative Time
// ---------------------------------------------------------------------------

/**
 * Formats an epoch timestamp (seconds) as a human-readable relative string.
 * Examples:
 *   "just now"        — < 60s ago
 *   "5 minutes ago"   — < 1h ago
 *   "2 hours ago"     — < 24h ago
 *   "3 days ago"      — < 30d ago
 *   "2 months ago"    — < 1y ago
 *   "2 years ago"     — ≥ 1y ago
 *
 * @param epochSeconds - timestamp in epoch seconds
 * @param nowMs - current time in milliseconds (defaults to Date.now(); injectable for testing)
 */
export function formatRelativeTime(epochSeconds: number, nowMs: number = Date.now()): string {
  const diffSeconds = Math.floor((nowMs - epochSeconds * 1000) / 1000);

  if (diffSeconds < 0) return "just now";
  if (diffSeconds < 60) return "just now";

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return diffMinutes === 1 ? "1 minute ago" : `${diffMinutes} minutes ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) {
    return diffHours === 1 ? "1 hour ago" : `${diffHours} hours ago`;
  }

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) {
    return diffDays === 1 ? "1 day ago" : `${diffDays} days ago`;
  }

  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) {
    return diffMonths === 1 ? "1 month ago" : `${diffMonths} months ago`;
  }

  const diffYears = Math.floor(diffMonths / 12);
  return diffYears === 1 ? "1 year ago" : `${diffYears} years ago`;
}

// ---------------------------------------------------------------------------
// Source Badges
// ---------------------------------------------------------------------------

const PLATFORM_LABELS: Record<string, string> = {
  zwift: "Zwift",
  strava: "Strava",
  apple_health: "Apple Health",
};

/**
 * Returns display labels for source platform badges.
 * Unknown platforms are returned title-cased as a fallback.
 * Examples:
 *   composeSourceBadges(["zwift"])              → ["Zwift"]
 *   composeSourceBadges(["zwift", "strava"])    → ["Zwift", "Strava"]
 *   composeSourceBadges([])                    → []
 */
export function composeSourceBadges(sources: string[]): string[] {
  return sources.map((s) => {
    const label = PLATFORM_LABELS[s];
    if (label !== undefined) return label;
    return s.charAt(0).toUpperCase() + s.slice(1);
  });
}
