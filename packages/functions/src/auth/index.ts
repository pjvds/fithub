import { issuer } from "@openauthjs/openauth";
import { CodeProvider } from "@openauthjs/openauth/provider/code";
import { CloudflareStorage } from "@openauthjs/openauth/storage/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { Resend } from "resend";
import { Resource } from "sst";
import { users } from "@fithub/core";
import { subjects } from "../shared/subjects.js";
import { LogEvent } from "@fithub/core";

interface Env {
  AuthKv: KVNamespace;
  FithubDb: D1Database;
}

function buildIssuer(env: Env) {
  const db = drizzle(env.FithubDb);

  async function sendEmail(to: string, code: string): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resend = new Resend((Resource as any).EMAIL_PROVIDER_KEY.value);
    const { error } = await resend.emails.send({
      from: "FitHub <noreply@fithub.space>",
      to,
      subject: `Your FitHub code: ${code}`,
      html: `
        <p>Your FitHub verification code is:</p>
        <h2 style="letter-spacing:0.15em;font-family:monospace">${code}</h2>
        <p>This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
      `,
    });

    if (error) {
      console.error(JSON.stringify({ event: LogEvent.authMagicLinkSendFailed, error }));
      return false;
    }

    console.log(JSON.stringify({ event: LogEvent.authMagicLinkSent }));
    return true;
  }

  return issuer({
    subjects,
    storage: CloudflareStorage({ namespace: env.AuthKv as never }),

    allow: async ({ redirectURI }) => {
      const allowed = [
        "https://app.fithub.space/auth/callback",
        "http://localhost:4321/auth/callback",
      ];
      return allowed.includes(redirectURI);
    },

    providers: {
      email: CodeProvider({
        sendCode: async (claims, code) => {
          const ok = await sendEmail(claims.email as string, code);
          if (!ok) {
            return { type: "invalid_claim" as const, key: "email", value: claims.email as string };
          }
        },

        request: async (_req, state, _form, error) => {
          if (state.type === "start") {
            return new Response(
              magicStartHtml(error?.type === "invalid_claim" ? "Invalid email address." : undefined),
              { headers: { "content-type": "text/html; charset=utf-8" } },
            );
          }
          return new Response(
            magicCodeHtml(error?.type === "invalid_code" ? "Invalid code, please try again." : undefined),
            { headers: { "content-type": "text/html; charset=utf-8" } },
          );
        },
      }),
    },

    async success(ctx, value) {
      const v = value as unknown as { claims?: { email: string } };
      const email = (v.claims?.email ?? "").toLowerCase();

      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email))
        .get();

      if (existing) {
        console.log(JSON.stringify({ event: LogEvent.authSignin, userId: existing.id }));
        return ctx.subject("user", { id: existing.id });
      }

      const id = crypto.randomUUID();
      await db
        .insert(users)
        .values({ id, email, createdAt: new Date(), updatedAt: new Date() });

      console.log(JSON.stringify({ event: LogEvent.authSignup, userId: id }));
      return ctx.subject("user", { id });
    },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    return buildIssuer(env).fetch(req, env as Parameters<typeof fetch>[1]);
  },
} satisfies ExportedHandler<Env>;

// ─── HTML helpers ─────────────────────────────────────────────────────────────

const BASE_STYLE = `
  body{font-family:system-ui,sans-serif;max-width:400px;margin:4rem auto;padding:0 1rem;color:#111}
  h1{font-size:1.5rem;font-weight:700;margin-bottom:.5rem}
  p.subtitle{color:#6b7280;font-size:.875rem;margin-bottom:1.5rem}
  label{display:block;font-size:.875rem;font-weight:500;margin-bottom:.25rem}
  input[type=email],input[type=text]{
    width:100%;padding:.5rem .75rem;margin-bottom:1rem;border:1px solid #d1d5db;
    border-radius:.375rem;box-sizing:border-box;font-size:1rem}
  button[type=submit]{
    display:block;width:100%;padding:.625rem;background:#2563eb;color:#fff;border:none;
    border-radius:.375rem;cursor:pointer;font-size:1rem;font-weight:600;text-align:center}
  button[type=submit]:hover{background:#1d4ed8}
  .error{color:#dc2626;font-size:.875rem;margin-bottom:1rem;padding:.5rem .75rem;
    background:#fef2f2;border:1px solid #fecaca;border-radius:.375rem}
`;

function errorBanner(message: string): string {
  return `<p class="error">${message}</p>`;
}

function magicStartHtml(errorMessage?: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in — FitHub</title>
<style>${BASE_STYLE}</style>
</head>
<body>
<h1>Sign in to FitHub</h1>
<p class="subtitle">Enter your email and we'll send you a one-time code.</p>
${errorMessage ? errorBanner(errorMessage) : ""}
<form method="POST">
  <input type="hidden" name="action" value="request">
  <label for="email">Email address</label>
  <input id="email" name="email" type="email" required autofocus autocomplete="email">
  <button type="submit">Send code</button>
</form>
</body>
</html>`;
}

function magicCodeHtml(errorMessage?: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Enter code — FitHub</title>
<style>${BASE_STYLE} #code{letter-spacing:.2em;font-size:1.2rem;text-align:center}</style>
</head>
<body>
<h1>Enter your code</h1>
<p class="subtitle">We sent a 6-digit code to your email.</p>
${errorMessage ? errorBanner(errorMessage) : ""}
<form method="POST">
  <input type="hidden" name="action" value="verify">
  <label for="code">6-digit code</label>
  <input id="code" name="code" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autofocus>
  <button type="submit">Verify</button>
</form>
</body>
</html>`;
}
