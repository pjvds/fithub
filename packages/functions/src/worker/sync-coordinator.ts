import type { DurableObjectState } from "@cloudflare/workers-types";

export interface ConnectionSyncState {
  cursor: string | null;
  lastSyncedAt: number | null;
  inFlightJobId: string | null;
  consecutiveFailures: number;
}

export interface SyncCoordinatorState {
  connections: Record<string, ConnectionSyncState>;
  schemaVersion: number;
}

const SCHEMA_VERSION = 1;

function defaultConnectionState(): ConnectionSyncState {
  return {
    cursor: null,
    lastSyncedAt: null,
    inFlightJobId: null,
    consecutiveFailures: 0,
  };
}

/** Cloudflare Durable Object that serialises per-user sync state. */
export class UserSyncCoordinator {
  private state: SyncCoordinatorState | null = null;

  constructor(
    private readonly ctx: DurableObjectState,
    _env: unknown,
  ) {}

  private async load(): Promise<SyncCoordinatorState> {
    if (this.state) return this.state;
    const stored = await this.ctx.storage.get<SyncCoordinatorState>("state");
    this.state = stored ?? {
      connections: {},
      schemaVersion: SCHEMA_VERSION,
    };
    return this.state;
  }

  private async save(state: SyncCoordinatorState): Promise<void> {
    this.state = state;
    await this.ctx.storage.put("state", state);
  }

  /**
   * Begin a sync for the given platform.
   * Returns `{ jobId }` on success or `{ error: "already_in_flight" }` if
   * another job is currently running for that platform.
   */
  async beginSync(
    platform: string,
    jobId: string,
  ): Promise<{ jobId: string } | { error: "already_in_flight" }> {
    const state = await this.load();
    const conn = state.connections[platform] ?? defaultConnectionState();

    if (conn.inFlightJobId !== null) {
      return { error: "already_in_flight" };
    }

    conn.inFlightJobId = jobId;
    state.connections[platform] = conn;
    await this.save(state);
    return { jobId };
  }

  /**
   * Mark a sync job complete.
   * Advances the cursor and records the lastSyncedAt timestamp.
   */
  async completeSync(
    platform: string,
    jobId: string,
    newCursor: string | null,
  ): Promise<void> {
    const state = await this.load();
    const conn = state.connections[platform];
    if (!conn || conn.inFlightJobId !== jobId) return;

    conn.inFlightJobId = null;
    conn.lastSyncedAt = Date.now();
    conn.consecutiveFailures = 0;
    if (newCursor !== null) conn.cursor = newCursor;
    state.connections[platform] = conn;
    await this.save(state);
  }

  /**
   * Record a sync job failure.
   * Clears the in-flight lock and increments the failure counter.
   */
  async failSync(platform: string, jobId: string): Promise<void> {
    const state = await this.load();
    const conn = state.connections[platform];
    if (!conn || conn.inFlightJobId !== jobId) return;

    conn.inFlightJobId = null;
    conn.consecutiveFailures += 1;
    state.connections[platform] = conn;
    await this.save(state);
  }

  /** Return the current activity cursor for the platform. */
  async getCursor(platform: string): Promise<string | null> {
    const state = await this.load();
    return state.connections[platform]?.cursor ?? null;
  }

  /** Expose state (used by worker for dispatch). */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const platform = url.searchParams.get("platform") ?? "unknown";

    if (request.method === "POST") {
      const body = (await request.json()) as {
        action: string;
        jobId?: string;
        cursor?: string | null;
      };

      switch (body.action) {
        case "beginSync": {
          const result = await this.beginSync(platform, body.jobId ?? "");
          return Response.json(result);
        }
        case "completeSync": {
          await this.completeSync(
            platform,
            body.jobId ?? "",
            body.cursor ?? null,
          );
          return Response.json({ ok: true });
        }
        case "failSync": {
          await this.failSync(platform, body.jobId ?? "");
          return Response.json({ ok: true });
        }
        case "getCursor": {
          const cursor = await this.getCursor(platform);
          return Response.json({ cursor });
        }
        default:
          return new Response("Unknown action", { status: 400 });
      }
    }

    return new Response("Method not allowed", { status: 405 });
  }
}
