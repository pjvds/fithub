import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { StravaSubscriptionManager } from "@fithub/core";

const config = { clientId: "test-id", clientSecret: "test-secret" };

describe("StravaSubscriptionManager", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("create", () => {
    it("returns subscription ID on success", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 42 }),
      });

      const mgr = new StravaSubscriptionManager(config);
      const id = await mgr.create("https://example.com/webhook", "verify-token");
      expect(id).toBe(42);
    });

    it("throws on non-OK response", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 400,
        text: () => Promise.resolve("Bad Request"),
      });

      const mgr = new StravaSubscriptionManager(config);
      await expect(
        mgr.create("https://example.com/webhook", "verify-token"),
      ).rejects.toThrow("400");
    });

    it("sends correct POST body", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: 10 }),
      });

      const mgr = new StravaSubscriptionManager(config);
      await mgr.create("https://example.com/webhook", "my-token");

      const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
      expect(url).toContain("/push_subscriptions");
      const body = JSON.parse(init.body as string);
      expect(body.callback_url).toBe("https://example.com/webhook");
      expect(body.verify_token).toBe("my-token");
      expect(body.client_id).toBe("test-id");
    });
  });

  describe("delete", () => {
    it("resolves without error on success", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true });

      const mgr = new StravaSubscriptionManager(config);
      await expect(mgr.delete(42)).resolves.toBeUndefined();
    });

    it("ignores 404 (already deleted)", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 404 });

      const mgr = new StravaSubscriptionManager(config);
      await expect(mgr.delete(42)).resolves.toBeUndefined();
    });

    it("throws on other non-OK responses", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Server Error"),
      });

      const mgr = new StravaSubscriptionManager(config);
      await expect(mgr.delete(42)).rejects.toThrow("500");
    });
  });

  describe("list", () => {
    it("returns array of subscriptions", async () => {
      const subs = [
        { id: 1, callbackUrl: "https://example.com/a", createdAt: "", updatedAt: "" },
        { id: 2, callbackUrl: "https://example.com/b", createdAt: "", updatedAt: "" },
      ];
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(subs),
      });

      const mgr = new StravaSubscriptionManager(config);
      const result = await mgr.list();
      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe(1);
    });

    it("throws on non-OK response", async () => {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve("Unauthorized"),
      });

      const mgr = new StravaSubscriptionManager(config);
      await expect(mgr.list()).rejects.toThrow("401");
    });
  });
});
