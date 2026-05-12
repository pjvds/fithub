/**
 * E2E tests for the landing page (/) auth-redirect behaviour.
 *
 * These tests exist specifically to guard against the regression where
 * `index.astro` checked the wrong cookie name (`fithub_session`) and always
 * rendered the sign-in page — even for authenticated users.
 *
 * The tests verify only the first response from `/` (no redirect-following)
 * so they work without a live auth worker.
 */
import { test, expect } from "@playwright/test";

const COOKIE_DEFAULTS = {
  domain: "localhost",
  path: "/",
  httpOnly: true,
  secure: false,
  sameSite: "Lax" as const,
};

test.describe("Landing page (/) auth redirect", () => {
  test("renders sign-in page when no auth cookies are set", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/");

    await expect(page.getByRole("heading", { name: "FitHub" })).toBeVisible();
    await expect(page.getByRole("link", { name: /sign in/i })).toBeVisible();
  });

  test("redirects to /dashboard when access_token cookie is present", async ({ page }) => {
    await page.context().addCookies([
      {
        ...COOKIE_DEFAULTS,
        name: "access_token",
        value: "header.payload.signature", // any non-empty value triggers the redirect
      },
    ]);

    // Check the raw redirect without following it further
    const response = await page.request.get("/", { maxRedirects: 0 });
    expect(response.status()).toBe(302);
    expect(response.headers()["location"]).toBe("/dashboard");
  });

  test("redirects to /dashboard when only refresh_token cookie is present", async ({ page }) => {
    await page.context().addCookies([
      {
        ...COOKIE_DEFAULTS,
        name: "refresh_token",
        value: "some-refresh-token",
      },
    ]);

    const response = await page.request.get("/", { maxRedirects: 0 });
    expect(response.status()).toBe(302);
    expect(response.headers()["location"]).toBe("/dashboard");
  });

  test("does not redirect when only an unrelated cookie is present", async ({ page }) => {
    await page.context().clearCookies();
    await page.context().addCookies([
      {
        ...COOKIE_DEFAULTS,
        name: "other_cookie",
        value: "irrelevant",
      },
    ]);

    await page.goto("/");
    await expect(page.getByRole("link", { name: /sign in/i })).toBeVisible();
  });
});
