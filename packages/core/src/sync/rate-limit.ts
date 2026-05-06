/** Per-user, per-platform API call budget tracked from response headers. */
export class RateLimitBudget {
  private remaining: number;
  private resetAt: number | null = null;

  constructor(private readonly initial: number = 600) {
    this.remaining = initial;
  }

  /**
   * Update budget state from Cloudflare/platform rate-limit response headers.
   * Supports `X-RateLimit-Remaining` and `Retry-After` (seconds offset).
   */
  consumeFromHeaders(headers: Headers): void {
    const remaining = headers.get("X-RateLimit-Remaining");
    const retryAfter = headers.get("Retry-After");

    if (remaining !== null) {
      const parsed = parseInt(remaining, 10);
      if (!isNaN(parsed)) this.remaining = parsed;
    }

    if (retryAfter !== null) {
      const secs = parseInt(retryAfter, 10);
      if (!isNaN(secs)) this.resetAt = Date.now() + secs * 1000;
    }
  }

  /** Decrement remaining by 1 (call before each platform API request). */
  decrement(): void {
    this.remaining = Math.max(0, this.remaining - 1);
  }

  /** True when no calls remain and the reset window has not yet passed. */
  isExhausted(): boolean {
    if (this.resetAt !== null && Date.now() >= this.resetAt) {
      this.remaining = this.initial;
      this.resetAt = null;
    }
    return this.remaining <= 0;
  }

  /** Milliseconds until the rate-limit window resets. 0 if no active window. */
  msUntilReset(): number {
    if (this.resetAt === null) return 0;
    return Math.max(0, this.resetAt - Date.now());
  }

  /** Current remaining call count (useful for logging). */
  getRemaining(): number {
    return this.remaining;
  }
}
