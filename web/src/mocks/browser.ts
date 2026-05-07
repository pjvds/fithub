/**
 * MSW browser worker — activates the Service Worker for development sessions.
 *
 * Usage:
 *   import { worker } from "@/mocks/browser";
 *   if (import.meta.env.PUBLIC_MSW_ENABLED === "true") {
 *     await worker.start({ onUnhandledRequest: "warn" });
 *   }
 *
 * This file is only loaded in the browser; never import it in server-side code.
 */
import { setupWorker } from "msw/browser";
import { handlers } from "./handlers.js";

export const worker = setupWorker(...handlers);
