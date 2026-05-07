/**
 * ExportButton island — requests a data export via POST /api/user/export.
 * Stores a 24h cooldown in localStorage to prevent spam.
 */
import { useState, useEffect } from "react";
import { createApiClient } from "../lib/api-client";

interface Props {
  apiBaseUrl: string;
  correlationId: string;
}

const COOLDOWN_KEY = "fithub_export_requested_at";
const COOLDOWN_MS = 24 * 60 * 60 * 1000;

export default function ExportButton({ apiBaseUrl, correlationId }: Props) {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [cooledDown, setCooledDown] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(COOLDOWN_KEY);
    if (stored) {
      const elapsed = Date.now() - Number(stored);
      if (elapsed < COOLDOWN_MS) {
        setCooledDown(true);
        const remaining = COOLDOWN_MS - elapsed;
        const timer = setTimeout(() => setCooledDown(false), remaining);
        return () => clearTimeout(timer);
      }
    }
  }, []);

  const handleClick = async () => {
    if (status !== "idle" || cooledDown) return;
    setStatus("loading");

    const client = createApiClient({ baseUrl: apiBaseUrl, correlationId });
    try {
      await client.requestExport();
      localStorage.setItem(COOLDOWN_KEY, String(Date.now()));
      setStatus("success");
      setCooledDown(true);
    } catch {
      setStatus("error");
    }
  };

  const disabled = status !== "idle" || cooledDown;

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={disabled}
        className={[
          "inline-flex items-center rounded-lg px-4 py-2 text-sm font-medium transition-colors",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600",
          disabled
            ? "bg-gray-100 text-gray-400 cursor-not-allowed"
            : "bg-brand-600 text-white hover:bg-brand-700",
        ].join(" ")}
      >
        {status === "loading" ? "Requesting…" : "Request data export"}
      </button>

      {status === "success" && (
        <p className="text-sm text-green-700" role="status">
          ✓ You'll receive an email when your export is ready.
        </p>
      )}
      {status === "error" && (
        <p className="text-sm text-red-600" role="alert">
          Request failed. Please try again later.
        </p>
      )}
      {cooledDown && status !== "success" && (
        <p className="text-sm text-gray-500">Export already requested. You can request again in 24 hours.</p>
      )}
    </div>
  );
}
