/**
 * SyncNowButton — React island that triggers a manual sync for a platform.
 *
 * Shows spinner while pending, resolves to ✓ success or ✗ error inline.
 * Re-enables automatically after 30 s so the user can retry without a full reload.
 */
import { useState, useEffect, useCallback } from "react";
import { createApiClient, ApiClientError } from "../lib/api-client";
import type { ManualSyncResponse } from "@fithub/core";

interface Props {
  platform: "strava";
  apiBaseUrl: string;
  correlationId: string;
  accessToken?: string;
}

type ButtonState = "idle" | "pending" | "success" | "error";

export default function SyncNowButton({ platform, apiBaseUrl, correlationId, accessToken }: Props) {
  const [state, setState] = useState<ButtonState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Auto-reset to idle after 30 s to allow retry
  useEffect(() => {
    if (state !== "success" && state !== "error") return;
    const timer = setTimeout(() => setState("idle"), 30_000);
    return () => clearTimeout(timer);
  }, [state]);

  const handleClick = useCallback(async () => {
    if (state !== "idle") return;

    setState("pending");
    setErrorMessage(null);

    const client = createApiClient({ baseUrl: apiBaseUrl, correlationId, ...(accessToken ? { accessToken } : {}) });

    try {
      const result: ManualSyncResponse = await client.triggerSync(platform);
      void result; // consumed — job ID available if needed
      setState("success");
    } catch (err) {
      const message =
        err instanceof ApiClientError
          ? err.message
          : "Sync request failed. Please try again.";
      setErrorMessage(message);
      setState("error");
    }
  }, [state, apiBaseUrl, correlationId, platform, accessToken]);

  const platformLabel = "Strava";

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={state !== "idle"}
        onClick={handleClick}
        className={[
          "inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600",
          state === "idle"
            ? "bg-brand-600 text-white hover:bg-brand-700"
            : "bg-gray-100 text-gray-400 cursor-not-allowed",
        ].join(" ")}
        aria-busy={state === "pending"}
      >
        {state === "pending" && (
          <svg
            className="h-4 w-4 animate-spin"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
        )}
        {state === "idle" && `Sync ${platformLabel} now`}
        {state === "pending" && "Syncing…"}
        {state === "success" && "✓ Sync started"}
        {state === "error" && "✗ Try again"}
      </button>

      {state === "error" && errorMessage && (
        <p className="text-sm text-red-600" role="alert">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
