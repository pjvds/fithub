/**
 * POST /api/sync/trigger
 *
 * Proxies manual sync trigger requests to the API worker server-side so
 * client-side fetch stays on the same origin (required by CSP connect-src 'self').
 */
import type { APIRoute } from "astro";
import { API_BASE_URL } from "@/lib/env";

export const POST: APIRoute = async ({ request, cookies, locals }) => {
  const accessToken = cookies.get("access_token")?.value ?? "";
  const body = await request.text();

  const res = await fetch(`${API_BASE_URL}/api/sync/trigger`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "x-correlation-id": locals.correlationId,
    },
    body,
  });

  const data = await res.text();
  return new Response(data, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
};
