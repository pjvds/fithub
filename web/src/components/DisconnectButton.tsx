/**
 * DisconnectButton — React island that shows a confirmation dialog before
 * disconnecting a platform. Uses a native HTML form POST so the action
 * still works even if JS fails to hydrate (progressive enhancement).
 *
 * Props:
 *   platform   — platform slug, e.g. "strava"
 *   platformLabel — human-readable name, e.g. "Strava"
 */
import { useState } from "react";

interface Props {
  platform: string;
  platformLabel: string;
}

export default function DisconnectButton({ platform, platformLabel }: Props) {
  const [showDialog, setShowDialog] = useState(false);
  const [deleteData, setDeleteData] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setShowDialog(true)}
        className="inline-flex items-center rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-gray-400 transition-colors"
      >
        Disconnect
      </button>

      {showDialog && (
        /* Backdrop */
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
          role="dialog"
          aria-modal="true"
          aria-labelledby="disconnect-dialog-title"
        >
          <div className="mx-4 w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <h3
              id="disconnect-dialog-title"
              className="text-base font-semibold text-gray-900"
            >
              Disconnect {platformLabel}?
            </h3>
            <p className="mt-2 text-sm text-gray-500">
              Your account will be unlinked. Activities already synced to FitHub
              can optionally be deleted.
            </p>

            <label className="mt-4 flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
              <input
                type="checkbox"
                checked={deleteData}
                onChange={(e) => setDeleteData(e.currentTarget.checked)}
                className="h-4 w-4 rounded border-gray-300 text-red-600 focus:ring-red-500"
              />
              Also delete my synced activities
            </label>

            <form
              method="POST"
              action={`/api/connections/${platform}/disconnect`}
              className="mt-6 flex justify-end gap-3"
            >
              <input
                type="hidden"
                name="delete_data"
                value={String(deleteData)}
              />
              <button
                type="button"
                onClick={() => setShowDialog(false)}
                className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 transition-colors"
              >
                Disconnect
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
