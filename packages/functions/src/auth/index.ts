import { issuer } from "@openauthjs/openauth";
import { CodeProvider } from "@openauthjs/openauth/provider/code";
import { CloudflareStorage } from "@openauthjs/openauth/storage/cloudflare";
import { drizzle } from "drizzle-orm/d1";
import { eq } from "drizzle-orm";
import { Resend } from "resend";
import { users } from "@fithub/core";
import { subjects } from "../shared/subjects.js";
import { LogEvent } from "@fithub/core";

interface Env {
  AuthKv: KVNamespace;
  FithubDb: D1Database;
  EMAIL_PROVIDER_KEY: string;
}

function buildIssuer(env: Env) {
  const db = drizzle(env.FithubDb);

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
          const resend = new Resend(env.EMAIL_PROVIDER_KEY);
          const { error } = await resend.emails.send({
            from: "FitHub <noreply@fithub.space>",
            to: claims.email as string,
            subject: `Your FitHub sign-in code: ${code}`,
            html: `
              <p>Your FitHub sign-in code is:</p>
              <h2 style="letter-spacing:0.15em;font-family:monospace">${code}</h2>
              <p>This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
            `,
          });

          if (error) {
            console.error(
              JSON.stringify({ event: LogEvent.authMagicLinkSendFailed, error }),
            );
            return { type: "invalid_claim" as const, key: "email", value: claims.email as string };
          }

          console.log(JSON.stringify({ event: LogEvent.authMagicLinkSent }));
        },

        request: async (_req, state, _form, error) => {
          if (state.type === "start") {
            return new Response(startHtml(error?.type === "invalid_claim" ? "Invalid email address." : undefined), {
              headers: { "content-type": "text/html; charset=utf-8" },
            });
          }
          return new Response(codeHtml(error?.type === "invalid_code" ? "Invalid code, please try again." : undefined), {
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        },
      }),
    },

    async success(ctx, value) {
      const email = (value as unknown as { claims: { email: string } }).claims.email.toLowerCase();

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

function startHtml(errorMessage?: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sign in — FitHub</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:400px;margin:4rem auto;padding:0 1rem}
  input{width:100%;padding:.5rem;margin:.25rem 0 1rem;border:1px solid #ccc;border-radius:4px;box-sizing:border-box}
  button{width:100%;padding:.6rem;background:#2563eb;color:#fff;border:none;border-radius:4px;cursor:pointer}
  .error{color:#dc2626;margin-bottom:1rem}
</style>
</head>
<body>
<h1>Sign in to FitHub</h1>
${errorMessage ? `<p class="error">${errorMessage}</p>` : ""}
<form method="POST">
  <input type="hidden" name="action" value="request">
  <label>Email address
    <input name="email" type="email" required autofocus>
  </label>
  <button type="submit">Send code</button>
</form>
</body>
</html>`;
}

function codeHtml(errorMessage?: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Enter code — FitHub</title>
<style>
  body{font-family:system-ui,sans-serif;max-width:400px;margin:4rem auto;padding:0 1rem}
  input{width:100%;padding:.5rem;margin:.25rem 0 1rem;border:1px solid #ccc;border-radius:4px;box-sizing:border-box;letter-spacing:.2em;font-size:1.2rem;text-align:center}
  button{width:100%;padding:.6rem;background:#2563eb;color:#fff;border:none;border-radius:4px;cursor:pointer}
  .error{color:#dc2626;margin-bottom:1rem}
</style>
</head>
<body>
<h1>Enter your code</h1>
<p>We sent a 6-digit code to your email.</p>
${errorMessage ? `<p class="error">${errorMessage}</p>` : ""}
<form method="POST">
  <input type="hidden" name="action" value="verify">
  <label>6-digit code
    <input name="code" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autofocus>
  </label>
  <button type="submit">Verify</button>
</form>
</body>
</html>`;
}
