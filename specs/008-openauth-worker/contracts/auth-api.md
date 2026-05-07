# Auth Worker API Contract

The auth worker exposes standard OAuth 2.0 / PKCE endpoints provided by OpenAuth.js `issuer()`. No custom endpoint code is required.

---

## Standard OAuth 2.0 Endpoints

All endpoints are served from `AUTH_WORKER_URL` (e.g., `https://auth.fithub.app` or the SST-generated URL).

### `GET /authorize`
Initiates the sign-in flow. CodeProvider displays the email entry form (CodeUI).

**Query params:**
| Param           | Required | Description                            |
|-----------------|----------|----------------------------------------|
| `response_type` | yes      | Must be `code`                        |
| `client_id`     | yes      | OpenAuth client identifier            |
| `redirect_uri`  | yes      | Where to send the callback            |
| `code_challenge`| yes      | PKCE code challenge (S256)            |
| `state`         | yes      | CSRF protection state                 |

**Response:** HTML page (CodeUI email form) or redirect.

---

### `POST /token`
Token exchange (authorization code → access + refresh tokens) and refresh.

**Request body (application/x-www-form-urlencoded):**
| Field           | grant_type=authorization_code | grant_type=refresh_token |
|-----------------|-------------------------------|--------------------------|
| `grant_type`    | `authorization_code`          | `refresh_token`         |
| `code`          | required                      | —                       |
| `redirect_uri`  | required                      | —                       |
| `code_verifier` | required (PKCE)               | —                       |
| `refresh_token` | —                             | required                |

**Response (200):**
```json
{
  "access_token": "...",
  "refresh_token": "...",
  "token_type": "Bearer",
  "expires_in": 86400
}
```

**Error (400/401):**
```json
{ "error": "invalid_grant", "error_description": "..." }
```

---

### `POST /invalidate`
Revokes a refresh token (sign-out).

**Request body:**
```json
{ "refresh_token": "..." }
```

**Response:** `200 OK`

---

### `GET /.well-known/oauth-authorization-server`
OAuth 2.0 server metadata (RFC 8414). Used by `client.createClient()` to discover all endpoints automatically.

**Response:**
```json
{
  "issuer": "https://auth.fithub.app",
  "authorization_endpoint": "https://auth.fithub.app/authorize",
  "token_endpoint": "https://auth.fithub.app/token",
  "jwks_uri": "https://auth.fithub.app/.well-known/jwks.json",
  "response_types_supported": ["code"],
  "code_challenge_methods_supported": ["S256"]
}
```

---

### `GET /.well-known/jwks.json`
Public JSON Web Keys for token signature verification. Cached by `client.verify()`.

**Response:**
```json
{
  "keys": [
    { "kty": "EC", "crv": "P-256", "use": "sig", "kid": "...", "x": "...", "y": "..." }
  ]
}
```

---

## Web Frontend Routes (Astro pages)

### `GET /auth/callback`
Exchanges the OpenAuth.js authorization code for tokens. Sets session cookies. Redirects to dashboard.

**Query params:** `code`, `state` (from OpenAuth.js redirect)

**Happy path:**
1. Call `client.exchange(redirectUri, currentUrl)` via auth service binding
2. Set `access_token` cookie (HttpOnly, Secure, SameSite=Strict, 24h)
3. Set `refresh_token` cookie (HttpOnly, Secure, SameSite=Strict, 30d, path=/auth)
4. Redirect to `/dashboard` (or `state.redirect_uri` if set)

**Error path:**
- Exchange fails → redirect to `/?error=auth_failed`

---

### `GET /auth/logout`
Signs out the current user.

**Steps:**
1. Read `refresh_token` cookie
2. Call `POST {AUTH_WORKER_URL}/invalidate` with refresh token
3. Clear `access_token` and `refresh_token` cookies
4. Redirect to `/`
