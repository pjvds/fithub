/**
 * ConfirmDeleteModal island — account deletion requires typing "DELETE" to confirm.
 */
import { useState } from "react";
import { createApiClient } from "../lib/api-client";

interface Props {
  apiBaseUrl: string;
  correlationId: string;
}

export default function ConfirmDeleteModal({ apiBaseUrl, correlationId }: Props) {
  const [open, setOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");

  const canDelete = confirmText === "DELETE";

  const handleDelete = async () => {
    if (!canDelete || status === "loading") return;
    setStatus("loading");

    const client = createApiClient({ baseUrl: apiBaseUrl, correlationId });
    try {
      await client.deleteAccount();
      // Redirect to deleted confirmation page (server clears the session cookie)
      window.location.href = "/deleted";
    } catch {
      setStatus("error");
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-500"
      >
        Delete account
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-modal-title"
        >
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl space-y-4">
            <h2 id="delete-modal-title" className="text-lg font-bold text-gray-900">
              Delete your account?
            </h2>
            <p className="text-sm text-gray-600">
              This action is <strong>permanent and irreversible</strong>. All your connections,
              sync history, and activity data will be deleted.
            </p>
            <p className="text-sm text-gray-600">
              To confirm, type <code className="rounded bg-gray-100 px-1">DELETE</code> below.
            </p>

            <input
              type="text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="Type DELETE to confirm"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
              aria-label="Confirm deletion"
            />

            {status === "error" && (
              <p className="text-sm text-red-600" role="alert">
                Deletion failed. Please try again.
              </p>
            )}

            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={() => { setOpen(false); setConfirmText(""); setStatus("idle"); }}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-700 border border-gray-300 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={!canDelete || status === "loading"}
                className={[
                  "rounded-lg px-4 py-2 text-sm font-medium transition-colors",
                  canDelete && status !== "loading"
                    ? "bg-red-600 text-white hover:bg-red-700"
                    : "bg-gray-100 text-gray-400 cursor-not-allowed",
                ].join(" ")}
              >
                {status === "loading" ? "Deleting…" : "Permanently delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
