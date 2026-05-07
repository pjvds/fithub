/**
 * MSW request handlers for browser-based development and testing.
 *
 * These handlers mock the API endpoints that are either:
 * a) Not yet implemented in the backend (e.g. /api/sync/history, /api/me)
 * b) Need deterministic responses for component testing
 *
 * Import these in vitest.setup.ts (test env) and browser.ts (browser dev env).
 */

import { http, HttpResponse } from "msw";
import type {
  AuthUser,
  ConnectionsResponse,
  SyncHistoryResponse,
  ManualSyncResponse,
  ActivitiesResponse,
  UserProfile,
  ExportRequestResponse,
} from "@fithub/core";

// ---------------------------------------------------------------------------
// Seed data
// ---------------------------------------------------------------------------

const MOCK_USER: AuthUser = {
  userId: "mock-user-001",
  email: "rider@fithub.space",
};

const MOCK_CONNECTIONS: ConnectionsResponse = {
  connections: [
    {
      id: "conn-strava-001",
      platform: "strava",
      status: "requires_reauth",
      connected_at: 1_690_000_000,
      last_synced_at: 1_730_000_000,
      last_error: "Token expired",
    },
  ],
};

const MOCK_SYNC_HISTORY: SyncHistoryResponse = {
  jobs: [
    {
      id: "job-001",
      platform: "strava",
      status: "success",
      started_at: 1_736_900_000,
      ended_at: 1_736_900_300,
      activities_synced: 3,
      error_message: null,
    },
    {
      id: "job-002",
      platform: "strava",
      status: "failed",
      started_at: 1_736_800_000,
      ended_at: 1_736_800_050,
      activities_synced: 0,
      error_message: "OAuth token expired",
    },
  ],
  next_cursor: null,
};

const MOCK_ACTIVITIES: ActivitiesResponse = {
  activities: [
    {
      id: "act-001",
      type: "cycling",
      started_at: 1_736_890_000,
      ended_at: 1_736_893_600,
      duration_s: 3600,
      distance_m: 40000,
      calories_kcal: 950,
      avg_heart_rate: 152,
      primary_source: "strava",
      dedup_group_id: null,
    },
    {
      id: "act-002",
      type: "running",
      started_at: 1_736_800_000,
      ended_at: 1_736_803_600,
      duration_s: 3600,
      distance_m: 10500,
      calories_kcal: 620,
      avg_heart_rate: 165,
      primary_source: "strava",
      dedup_group_id: null,
    },
  ],
  next_cursor: null,
};

const MOCK_PROFILE: UserProfile = {
  user_id: "mock-user-001",
  email: "rider@fithub.space",
  display_name: "Test Rider",
  created_at: 1_700_000_000,
  connections: MOCK_CONNECTIONS.connections,
};

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

export const handlers = [
  // Auth
  http.get("*/api/me", () => {
    return HttpResponse.json(MOCK_USER);
  }),

  // Connections
  http.get("*/api/connections", () => {
    return HttpResponse.json(MOCK_CONNECTIONS);
  }),

  http.delete("*/api/connections/:id", () => {
    return new HttpResponse(null, { status: 204 });
  }),

  // Sync
  http.get("*/api/sync/history", () => {
    return HttpResponse.json(MOCK_SYNC_HISTORY);
  }),

  http.post("*/api/sync/trigger", () => {
    const response: ManualSyncResponse = {
      job_id: `job-${Date.now()}`,
      platform: "strava",
      status: "pending",
      started_at: Math.floor(Date.now() / 1000),
    };
    return HttpResponse.json(response, { status: 202 });
  }),

  // Activities
  http.get("*/api/activities", () => {
    return HttpResponse.json(MOCK_ACTIVITIES);
  }),

  // User Profile & Settings
  http.get("*/api/user/profile", () => {
    return HttpResponse.json(MOCK_PROFILE);
  }),

  http.post("*/api/user/export", () => {
    const response: ExportRequestResponse = {
      accepted: true,
      message: "Export request received. You will receive an email when it is ready.",
    };
    return HttpResponse.json(response, { status: 202 });
  }),

  http.delete("*/api/user", () => {
    return new HttpResponse(null, { status: 204 });
  }),

  // Client-side error ingestion
  http.post("*/api/errors", () => {
    return new HttpResponse(null, { status: 204 });
  }),
];
