import type { PlatformAdapter, RawActivity } from "./types.js";

export interface MockAdapterOptions {
  platform?: string;
  activities?: RawActivity[];
  refreshShouldFail?: boolean;
}

export function createMockAdapter(opts: MockAdapterOptions = {}): PlatformAdapter {
  const platform = opts.platform ?? "mock";
  const fixtures: RawActivity[] =
    opts.activities ??
    [
      {
        externalId: "mock-1",
        rawJson: { id: "mock-1", type: "ride", duration: 3600, distance: 30000 },
      },
      {
        externalId: "mock-2",
        rawJson: { id: "mock-2", type: "run", duration: 1800, distance: 5000 },
      },
    ];

  return {
    platform,
    async fetchActivities(_token: string, _since?: Date) {
      return fixtures;
    },
    async refreshToken(_refreshToken: string) {
      if (opts.refreshShouldFail) throw new Error("refresh_failed");
      return {
        accessToken: `mock-access-${Date.now()}`,
        refreshToken: `mock-refresh-${Date.now()}`,
        expiresAt: new Date(Date.now() + 3600_000),
      };
    },
    async validateToken(token: string) {
      return token.length > 0 && !token.startsWith("invalid");
    },
    async revokeToken(_token: string) {
      // no-op for mock
    },
  };
}
