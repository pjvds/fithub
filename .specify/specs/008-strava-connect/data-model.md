# Data Model: Strava Platform Connection (008-strava-connect)

**Feature:** 008-strava-connect
**Date:** 2026-05-08
**Status:** Complete

---

## Overview

This feature introduces no new database entities or schema migrations. All persistent data is owned by the existing backend (`000-backend-foundation`). This document records the data shapes flowing through the new web frontend routes.

---

## Existing Entities (Read-Only in This Feature)

### `Connection` (from `@fithub/core`)

The canonical shape returned by `GET /api/connections` — consumed by `dashboard.astro` and `ConnectionCard.astro`:

```typescript
interface Connection {
  id: string;              // UUID — internal connection identifier
  platform: string;        // "strava" | "apple_health" | ...
  status: "active" | "requires_reauth" | "disconnected";
  scopes?: string;         // OAuth scopes granted
  expiresAt?: string;      // ISO-8601 token expiry
  createdAt: string;       // ISO-8601
  updatedAt: string;       // ISO-8601
  last_synced_at?: string; // ISO-8601 — displayed in ConnectionCard
  last_error?: string;     // User-facing error message (if any)
}
```

---

## New Web-Tier Data Flows

### Connect Initiation (POST `/api/connections/[platform]/connect`)

**Web → Backend request:**
```http
POST /api/connections/strava/oauth/initiate
Authorization: Bearer <access_token>
Content-Type: application/json
{}
```

**Backend → Web response:**
```json
{ "authUrl": "https://www.strava.com/oauth/authorize?client_id=...&redirect_uri=...&state=...&code_challenge=..." }
```

**Web action:** 302 redirect to `authUrl`.

---

### OAuth Callback (GET `/api/connections/[platform]/oauth/callback`)

**Strava → Web query params:**
```
?code=<authorization_code>&state=<state_token>
```

**On denial by user:**
```
?error=access_denied&error_description=...&state=<state_token>
```

**Web → Backend request:**
```http
POST /api/connections/strava/oauth/callback
Authorization: Bearer <access_token>
Content-Type: application/json

{ "code": "<authorization_code>", "state": "<state_token>" }
```

**Backend → Web response (success):**
```json
{ "connectionId": "<uuid>", "platform": "strava", "status": "active" }
```
Status: `201 Created`

**Backend → Web response (error):**
```json
{ "error": "invalid_or_expired_state", "code": "OAUTH_STATE_INVALID" }
```
Status: `400`

**Web action on success:** 302 redirect to `/dashboard?connected=strava`
**Web action on error:** 302 redirect to `/dashboard?error=<reason>`

---

### Disconnect (POST `/api/connections/[platform]/disconnect`)

**Web form payload** (from `DisconnectButton` dialog):
```
platform=strava&delete_data=true|false
```

**Web → Backend request:**
```http
POST /api/connections/strava/disconnect
Authorization: Bearer <access_token>
Content-Type: application/json

{ "delete_data": true }
```

**Backend → Web response (success):**
```json
{ "disconnected": true, "platform": "strava" }
```

**Web action on success:** 302 redirect to `/dashboard?disconnected=strava`
**Web action on error:** 302 redirect to `/dashboard?error=disconnect_failed`

---

## Flash Message State (URL Query Params)

These params are read by `dashboard.astro` server-side and rendered as banners:

| Param            | Value           | Displayed Message                                          |
|------------------|-----------------|------------------------------------------------------------|
| `connected`      | `strava`        | "Strava connected! Your activities will sync shortly."    |
| `disconnected`   | `strava`        | "Strava disconnected."                                     |
| `error`          | `access_denied` | "Connection cancelled. You can try again any time."       |
| `error`          | `expired_state` | "The connection attempt timed out. Please try again."     |
| `error`          | `connect_failed`| "Could not connect to Strava. Please try again."          |
| `error`          | `disconnect_failed` | "Could not disconnect Strava. Please try again."      |

---

## New SST Resources

No new SST resources are introduced by this feature. One existing resource must be configured:

| Resource            | Type       | Change                                                                 |
|---------------------|------------|------------------------------------------------------------------------|
| `REDIRECT_BASE_URL` | SST Secret | Must be set to the web frontend origin (e.g., `https://app.fithub.space`) |

---

## No Schema Migrations

The backend schema already has the `connections` table. No new columns, tables, or indexes are required.
