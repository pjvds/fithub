import { describe, it, expect, vi, beforeEach } from "vitest";

// Hoist mock functions so they're available in vi.mock factories
const mockEmailSend = vi.hoisted(() => vi.fn());

// Must be hoisted above imports so the mock is in place when auth/index.ts is loaded
vi.mock("sst", () => ({
  Resource: new Proxy(
    {},
    {
      get(_: object, prop: string | symbol) {
        if (prop === "EMAIL_PROVIDER_KEY") return { value: "re_test_key" };
        throw new Error(
          `"${String(prop)}" is not linked in your sst.config.ts`,
        );
      },
    },
  ),
}));

vi.mock("resend", () => ({
  // Use a regular function (not arrow) so `new Resend(...)` works
  Resend: vi.fn(function (this: { emails: { send: typeof mockEmailSend } }) {
    this.emails = { send: mockEmailSend };
  }),
}));

// Import after mocks are registered
const { default: authWorker } = await import("../src/auth/index.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: async (key: string, type?: string) => {
      const raw = store.get(key) ?? null;
      if (raw === null) return null;
      return type === "json" ? JSON.parse(raw) : raw;
    },
    put: async (key: string, value: string) => {
      store.set(key, value);
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    list: async ({ prefix }: { prefix?: string } = {}) => ({
      keys: [...store.keys()]
        .filter((k) => !prefix || k.startsWith(prefix))
        .map((name) => ({ name, expiration: undefined, metadata: null })),
      list_complete: true,
      cursor: "",
      cacheStatus: null,
    }),
    getWithMetadata: async () => ({
      value: null,
      metadata: null,
      cacheStatus: null,
    }),
  } as unknown as KVNamespace;
}

function makeEnv() {
  return {
    AuthKv: makeKv(),
    // sendCode never touches the DB; success() does but those tests are out of scope
    FithubDb: {} as unknown as D1Database,
  };
}

type Env = ReturnType<typeof makeEnv>;

/** Extract all Set-Cookie values from a Response into a cookie header string. */
function extractCookies(res: Response): string {
  const all: string[] = [];
  res.headers.forEach((value, name) => {
    if (name.toLowerCase() === "set-cookie") {
      // Take only name=value, drop attributes (Path, HttpOnly, etc.)
      const nameValue = value.split(";")[0];
      if (nameValue) all.push(nameValue);
    }
  });
  return all.join("; ");
}

/** Drive the OAuth authorize flow up to the provider page, returning cookies. */
async function startAuthFlow(env: Env): Promise<string> {
  const authorizeUrl = new URL("https://auth.fithub.space/authorize");
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("client_id", "web");
  authorizeUrl.searchParams.set(
    "redirect_uri",
    "http://localhost:4321/auth/callback",
  );
  authorizeUrl.searchParams.set("state", "test-state");

  // Step 1: GET /authorize — stores OAuth params, redirects to /email/authorize
  const step1 = await authWorker.fetch(
    new Request(authorizeUrl.toString()),
    env as unknown as Parameters<typeof authWorker.fetch>[1],
  );
  const cookies1 = extractCookies(step1);
  const location1 = step1.headers.get("location") ?? "";
  expect(step1.status).toBe(302);
  expect(location1).toContain("/email/authorize");

  // Step 2: GET /email/authorize — sets provider state cookie, shows email form
  const providerPath = location1.startsWith("http")
    ? new URL(location1).pathname
    : location1;
  const step2 = await authWorker.fetch(
    new Request(`https://auth.fithub.space${providerPath}`, {
      headers: { cookie: cookies1 },
    }),
    env as unknown as Parameters<typeof authWorker.fetch>[1],
  );
  const cookies2 = [cookies1, extractCookies(step2)].filter(Boolean).join("; ");
  expect(step2.status).toBe(200);

  return cookies2;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("auth worker — sendCode", () => {
  let env: Env;

  beforeEach(() => {
    env = makeEnv();
    mockEmailSend.mockReset();
  });

  it("calls Resend with the correct API key and email on valid submission", async () => {
    mockEmailSend.mockResolvedValue({ data: { id: "email-1" }, error: null });

    const cookies = await startAuthFlow(env);

    const body = new URLSearchParams({ action: "request", email: "user@example.com" });
    const res = await authWorker.fetch(
      new Request("https://auth.fithub.space/email/authorize", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: cookies,
        },
        body: body.toString(),
      }),
      env as unknown as Parameters<typeof authWorker.fetch>[1],
    );

    // Resend must have been called exactly once
    expect(mockEmailSend).toHaveBeenCalledOnce();
    const call = mockEmailSend.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(call.to).toBe("user@example.com");
    expect(call.from).toMatch(/fithub\.space/);

    // Successful send → transition to code-entry state (200 or redirect)
    expect([200, 302]).toContain(res.status);
  });

  it("returns the email form with an error when Resend fails", async () => {
    mockEmailSend.mockResolvedValue({
      data: null,
      error: { name: "validation_error", message: "Invalid API key" },
    });

    const cookies = await startAuthFlow(env);

    const body = new URLSearchParams({ action: "request", email: "user@example.com" });
    const res = await authWorker.fetch(
      new Request("https://auth.fithub.space/email/authorize", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: cookies,
        },
        body: body.toString(),
      }),
      env as unknown as Parameters<typeof authWorker.fetch>[1],
    );

    // Should stay on the start page (not redirect away to landing page)
    const html = await res.text();
    expect(html).toContain("Sign in");
    expect(html).not.toContain("Enter your code");
    expect([200, 302]).toContain(res.status);
  });

  it("Resend is constructed with the API key from Resource.EMAIL_PROVIDER_KEY", async () => {
    const { Resend } = await import("resend");
    mockEmailSend.mockResolvedValue({ data: { id: "x" }, error: null });

    const cookies = await startAuthFlow(env);
    const body = new URLSearchParams({ action: "request", email: "user@example.com" });
    await authWorker.fetch(
      new Request("https://auth.fithub.space/email/authorize", {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie: cookies,
        },
        body: body.toString(),
      }),
      env as unknown as Parameters<typeof authWorker.fetch>[1],
    );

    // Resend constructor must receive the value from Resource, not an empty string
    expect(vi.mocked(Resend)).toHaveBeenCalledWith("re_test_key");
  });
});
