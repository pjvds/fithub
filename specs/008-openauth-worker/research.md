# Research: feat-008-openauth-worker

## SST Cloudflare Service Bindings

**Decision:** Use `transform.worker.serviceBindings` in SST v3 Cloudflare Worker declaration to add a Cloudflare service binding from the API worker to the auth worker.

**Rationale:** Service bindings route worker-to-worker calls within Cloudflare's network with zero-latency. Token verification happens on every authenticated API request (~100% of traffic), so the latency saving is significant.

**Pattern:**
```ts
const auth = new sst.cloudflare.Worker("Auth", {
  handler: "packages/functions/src/auth/index.ts",
  link: [authKv, db, emailProviderKey],
  url: true,
});

const api = new sst.cloudflare.Worker("Api", {
  handler: "packages/functions/src/api/index.ts",
  link: [...],
  transform: {
    worker: {
      serviceBindings: [{ name: "Auth", service: auth.name }],
    },
  },
});
```

The binding name `"Auth"` becomes `env.Auth` inside the API worker. The auth worker's Cloudflare name is accessible via `auth.name` (the SST resource name, which SST prefixes with the app/stage).

**Fallback (if `transform` is unavailable or unreliable):**
Omit the service binding entirely. Pass only the issuer URL:
```ts
const client = createClient({ issuer: env.OPENAUTH_ISSUER });
```
`client.verify()` will call the auth worker via HTTPS over the public internet — ~20-50ms per request instead of sub-millisecond. This is acceptable for v1 and can be optimised later.

**Alternatives Considered:**
- Wrangler-native service bindings in `wrangler.toml` — not applicable; SST manages deployment and generates wrangler config.
- Durable Objects / Queue-based inter-worker communication — wildly over-engineered for synchronous token verification.

---

## `@openauthjs/openauth` Version Pinning

**Decision:** Stay on `^0.4.0` (already installed in `packages/functions/package.json`). Add same range to `web/package.json`.

**Rationale:** The client package is the same version as the server package. Mismatches in OpenAuth.js versions between issuer and client can cause JWT format or endpoint incompatibilities.

---

## `sendCode` Email Integration (Resend)

**Decision:** Use Resend SDK (`resend` package) in the auth worker's `sendCode` callback.

**Pattern:**
```ts
sendCode: async (email, code) => {
  if (Resource.App.stage !== "production") {
    console.log(`[DEV] Magic link code for ${email}: ${code}`);
    return;
  }
  const resend = new Resend(Resource.EMAIL_PROVIDER_KEY.value);
  await resend.emails.send({
    from: "FitHub <noreply@fithub.app>",
    to: email,
    subject: "Your FitHub sign-in code",
    html: `<p>Your sign-in code: <strong>${code}</strong> (expires in 15 minutes)</p>`,
  });
},
```

Note: `email` must NOT be logged. Only log `auth.magiclink.sent` with `userId` (not available at `sendCode` time) or a hash.

---

## Token Cookie Strategy

**Decision:** Two separate HttpOnly cookies:
- `access_token` — short-lived (5-24h), used as Bearer token for API calls
- `refresh_token` — long-lived (30 days), used only to request new access tokens

**Pattern (in `/auth/callback.astro`):**
```ts
Astro.cookies.set("access_token", tokens.access, {
  httpOnly: true,
  secure: true,
  sameSite: "strict",
  path: "/",
  maxAge: 60 * 60 * 24,  // 1 day — shorter than token TTL; refresh handles extension
});
Astro.cookies.set("refresh_token", tokens.refresh, {
  httpOnly: true,
  secure: true,
  sameSite: "strict",
  path: "/auth",  // Scope to auth paths only
  maxAge: 60 * 60 * 24 * 30,
});
```

---

## `success` Callback User Resolution

**Decision:** In the `success` callback, use `value.claims.email` (CodeProvider sets `claims.email`, not `value.email`). Look up user in FithubDb by email; create if not found (first sign-in).

**Pattern:**
```ts
success: async (ctx, value) => {
  if (value.provider === "code") {
    const email = value.claims.email as string;
    let user = await db.query.users.findFirst({ where: eq(users.email, email) });
    if (!user) {
      const id = crypto.randomUUID();
      await db.insert(users).values({ id, email });
      user = { id, email };
    }
    return ctx.subject("user", { id: user.id });
  }
  throw new Error("Invalid provider");
},
```
