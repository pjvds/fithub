/**
 * Integration tests for SyncNowButton island (W019).
 * Tests the React component directly against MSW handlers.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import SyncNowButton from "./SyncNowButton";
import { server } from "../../vitest.setup";
import { http, HttpResponse } from "msw";

const DEFAULT_PROPS = {
  platform: "strava" as const,
  apiBaseUrl: "https://api.fithub.app",
  correlationId: "test-cid",
};

describe("SyncNowButton", () => {
  it("renders idle state correctly", () => {
    render(<SyncNowButton {...DEFAULT_PROPS} />);
    expect(screen.getByRole("button", { name: /sync strava now/i })).toBeInTheDocument();
  });

  it("shows pending state while request is in flight", async () => {
    // Delay the MSW response so we can assert the pending state
    server.use(
      http.post("*/api/sync/trigger", async () => {
        await new Promise((r) => setTimeout(r, 50));
        return HttpResponse.json({ job_id: "j1", platform: "strava", status: "pending", started_at: 1 }, { status: 202 });
      }),
    );

    render(<SyncNowButton {...DEFAULT_PROPS} />);
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByText(/syncing/i)).toBeInTheDocument();
  });

  it("shows success state after a successful trigger", async () => {
    render(<SyncNowButton {...DEFAULT_PROPS} />);
    fireEvent.click(screen.getByRole("button"));
    expect(await screen.findByText(/sync started/i)).toBeInTheDocument();
  });

  it("shows error state when API returns 500", async () => {
    server.use(
      http.post("*/api/sync/trigger", () => {
        return HttpResponse.json({ code: "INTERNAL", message: "Server exploded" }, { status: 500 });
      }),
    );

    render(<SyncNowButton {...DEFAULT_PROPS} />);
    fireEvent.click(screen.getByRole("button"));
    // 2 retries with 500ms + 1500ms delays → wait up to 4s
    expect(await screen.findByText(/try again/i, {}, { timeout: 4000 })).toBeInTheDocument();
  });

  it("disables the button in pending state", async () => {
    server.use(
      http.post("*/api/sync/trigger", async () => {
        await new Promise((r) => setTimeout(r, 100));
        return HttpResponse.json({ job_id: "j1", platform: "strava", status: "pending", started_at: 1 }, { status: 202 });
      }),
    );

    render(<SyncNowButton {...DEFAULT_PROPS} />);
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    expect(btn).toBeDisabled();
  });
});
