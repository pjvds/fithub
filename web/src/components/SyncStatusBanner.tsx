/**
 * SyncStatusBanner island — polls GET /api/sync/history every 60 seconds
 * while a sync is in progress, showing a visible status indicator.
 * Cleans up polling when component unmounts.
 */
import { useState, useEffect, useCallback } from "react";
import { createApiClient } from "../lib/api-client";
import type { SyncJob } from "@fithub/core";

interface Props {
  apiBaseUrl: string;
  correlationId: string;
}

const POLL_INTERVAL_MS = 60_000;

export default function SyncStatusBanner({ apiBaseUrl, correlationId }: Props) {
  const [activeJob, setActiveJob] = useState<SyncJob | null>(null);

  const pollStatus = useCallback(async () => {
    const client = createApiClient({ baseUrl: apiBaseUrl, correlationId });
    try {
      const { jobs } = await client.getSyncHistory({ limit: 5 });
      const inProgress = jobs.find((j) => j.status === "pending");
      setActiveJob(inProgress ?? null);
    } catch {
      // Silently ignore polling errors — don't surface a broken banner
    }
  }, [apiBaseUrl, correlationId]);

  useEffect(() => {
    pollStatus();
    const id = setInterval(pollStatus, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [pollStatus]);

  if (!activeJob) return null;

  return (
    <div
      className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 flex items-center gap-3"
      role="status"
      aria-live="polite"
    >
      <svg
        className="h-4 w-4 animate-spin text-amber-600 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
        />
      </svg>
      <p className="text-sm text-amber-800">
        Syncing{" "}
        <span className="font-medium capitalize">{activeJob.platform}</span>
        … This may take a moment.
      </p>
    </div>
  );
}
