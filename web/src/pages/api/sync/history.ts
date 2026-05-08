/**
 * GET /api/sync/history
 *
 * Proxies sync history requests to the API worker server-side so
 * client-side fetch stays on the same origin (required by CSP connect-src 'self').
 */
import type { APIRoute } from "astro";
import { API_BASE_URL } from "@/lib/env";

export const GET: APIRoute = async ({ request, cookies, locals }) => {
  const accessToken = cookies.get("access_token")?.value ?? "";
  const { search } = new URL(request.url);

  const res = await fetch(`${API_BASE_URL}/api/sync/history${search}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "x-correlation-id": locals.correlationId,
    },
  });

  const data = await res.text();
  return new Response(data, {
    status: res.status,
    headers: { "Content-Type": "application/json" },
  });
};
