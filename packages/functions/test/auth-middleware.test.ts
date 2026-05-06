import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { authMiddleware } from "../src/api/middleware/auth.js";

describe("authMiddleware", () => {
  const app = new Hono();
  app.use("/protected/*", authMiddleware({ jwksUrl: "https://example.invalid/jwks" }));
  app.get("/protected/me", (c) => c.json({ ok: true }));

  it("rejects requests without Authorization header", async () => {
    const res = await app.request("/protected/me");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthenticated");
  });

  it("rejects requests with non-Bearer scheme", async () => {
    const res = await app.request("/protected/me", {
      headers: { authorization: "Basic abc" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects malformed bearer tokens", async () => {
    const res = await app.request("/protected/me", {
      headers: { authorization: "Bearer not-a-jwt" },
    });
    expect(res.status).toBe(401);
  });
});
