import { describe, it, expect } from "vitest";
import { createMockAdapter } from "../src/adapters/mock-adapter.js";

describe("MockAdapter", () => {
  it("returns fixture activities", async () => {
    const adapter = createMockAdapter();
    const acts = await adapter.fetchActivities("any-token");
    expect(acts.length).toBeGreaterThan(0);
    expect(acts[0]!.externalId).toBeDefined();
  });

  it("refreshes tokens with new values", async () => {
    const adapter = createMockAdapter();
    const r = await adapter.refreshToken("old-refresh");
    expect(r.accessToken).toMatch(/^mock-access-/);
    expect(r.expiresAt).toBeInstanceOf(Date);
  });

  it("refreshToken can be configured to fail", async () => {
    const adapter = createMockAdapter({ refreshShouldFail: true });
    await expect(adapter.refreshToken("x")).rejects.toThrow();
  });

  it("validates tokens", async () => {
    const adapter = createMockAdapter();
    expect(await adapter.validateToken("ok")).toBe(true);
    expect(await adapter.validateToken("invalid-bad")).toBe(false);
  });

  it("uses custom platform name and fixtures", async () => {
    const adapter = createMockAdapter({
      platform: "zwift",
      activities: [{ externalId: "z-1", rawJson: { id: "z-1" } }],
    });
    expect(adapter.platform).toBe("zwift");
    const acts = await adapter.fetchActivities("t");
    expect(acts).toHaveLength(1);
    expect(acts[0]!.externalId).toBe("z-1");
  });
});
