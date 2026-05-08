/**
 * Runtime environment variable access with mandatory presence checks.
 *
 * All variables here are required — if one is missing the worker will throw
 * immediately with a clear message instead of silently using a wrong URL and
 * producing a cryptic network error later.
 */

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const API_BASE_URL = requireEnv("API_BASE_URL", import.meta.env.API_BASE_URL);
export const AUTH_WORKER_URL = requireEnv("AUTH_WORKER_URL", import.meta.env.AUTH_WORKER_URL);
