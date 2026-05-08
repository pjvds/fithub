import { issuer } from "@openauthjs/openauth";
import { CodeProvider } from "@openauthjs/openauth/provider/code";
import { PasswordProvider } from "@openauthjs/openauth/provider/password";
import type {
  PasswordLoginError,
  PasswordRegisterError,
  PasswordRegisterState,
  PasswordChangeState,
  PasswordChangeError,
} from "@openauthjs/openauth/provider/password";
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

    select: async (_providers, req) => {
      const url = new URL(req.url);
      const passwordUrl = new URL(url);
      passwordUrl.searchParams.set("provider", "password");
      const emailUrl = new URL(url);
      emailUrl.searchParams.set("provider", "email");
      return new Response(selectHtml(passwordUrl.toString(), emailUrl.toString()), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },

    providers: {
      password: PasswordProvider({
        sendCode: async (email, code) => { await sendEmail(email, code); },

        validatePassword: (password) => {
          if (password.length < 8) return "Password must be at least 8 characters.";
          return undefined;
        },

        login: async (_req, _form, error) =>
          new Response(loginHtml(error), {
            headers: { "content-type": "text/html; charset=utf-8" },
          }),

        register: async (_req, state, _form, error) =>
          new Response(registerHtml(state, error), {
            headers: { "content-type": "text/html; charset=utf-8" },
          }),

        change: async (_req, state, _form, error) =>
          new Response(changeHtml(state, error), {
            headers: { "content-type": "text/html; charset=utf-8" },
          }),
      }),

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
      const v = value as unknown as { email?: string; claims?: { email: string } };
      const email = (v.email ?? v.claims?.email ?? "").toLowerCase();

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
  input[type=email],input[type=password],input[type=text]{
    width:100%;padding:.5rem .75rem;margin-bottom:1rem;border:1px solid #d1d5db;
    border-radius:.375rem;box-sizing:border-box;font-size:1rem}
  button[type=submit],.btn{
    display:block;width:100%;padding:.625rem;background:#2563eb;color:#fff;border:none;
    border-radius:.375rem;cursor:pointer;font-size:1rem;font-weight:600;text-align:center;
    text-decoration:none;box-sizing:border-box}
  button[type=submit]:hover,.btn:hover{background:#1d4ed8}
  .btn-ghost{background:#fff;color:#374151;border:1px solid #d1d5db}
  .btn-ghost:hover{background:#f9fafb}
  .error{color:#dc2626;font-size:.875rem;margin-bottom:1rem;padding:.5rem .75rem;
    background:#fef2f2;border:1px solid #fecaca;border-radius:.375rem}
  .link{font-size:.875rem;color:#2563eb;text-decoration:none}
  .link:hover{text-decoration:underline}
  .actions{margin-top:1rem;display:flex;flex-direction:column;gap:.5rem;align-items:center}
  .divider{display:flex;align-items:center;gap:.75rem;margin:1.25rem 0;color:#9ca3af;font-size:.875rem}
  .divider::before,.divider::after{content:"";flex:1;border-top:1px solid #e5e7eb}
  .stack{display:flex;flex-direction:column;gap:.75rem}
`;

type LoginError = PasswordLoginError | undefined;
type RegisterError = PasswordRegisterError | undefined;
type RegisterState = PasswordRegisterState;
type ChangeState = PasswordChangeState;
type ChangeError = PasswordChangeError | undefined;

function errorBanner(message: string): string {
  return `<p class="error">${message}</p>`;
}

function selectHtml(passwordUrl: string, emailUrl: string): string {
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
<p class="subtitle">Choose how you'd like to sign in.</p>
<div class="stack">
  <a class="btn" href="${passwordUrl}">Email &amp; password</a>
  <div class="divider">or</div>
  <a class="btn btn-ghost" href="${emailUrl}">Send me a magic link</a>
</div>
</body>
</html>`;
}

function loginHtml(error?: LoginError): string {
  const errorMsg = !error ? "" :
    error.type === "invalid_email" ? errorBanner("No account found for that email address.") :
    error.type === "invalid_password" ? errorBanner("Incorrect password. Please try again.") :
    errorBanner("Sign-in failed. Please try again.");

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
${errorMsg}
<form method="POST">
  <label for="email">Email address</label>
  <input id="email" name="email" type="email" required autofocus autocomplete="email">
  <label for="password">Password</label>
  <input id="password" name="password" type="password" required autocomplete="current-password">
  <button type="submit">Sign in</button>
</form>
<div class="actions">
  <a class="link" href="?provider=password&action=register">Create an account</a>
  <a class="link" href="?provider=password&action=change">Forgot password?</a>
  <a class="link" href="?provider=email">Use a magic link instead</a>
</div>
</body>
</html>`;
}

function registerHtml(state: RegisterState, error?: RegisterError): string {
  if (state.type === "code") {
    const errorMsg = !error ? "" :
      error.type === "invalid_code" ? errorBanner("Invalid code. Please check your email and try again.") :
      errorBanner("Verification failed. Please try again.");

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Verify email — FitHub</title>
<style>${BASE_STYLE} #code{letter-spacing:.2em;font-size:1.2rem;text-align:center}</style>
</head>
<body>
<h1>Verify your email</h1>
<p class="subtitle">We sent a 6-digit code to <strong>${state.email}</strong>.</p>
${errorMsg}
<form method="POST">
  <label for="code">6-digit code</label>
  <input id="code" name="code" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autofocus>
  <button type="submit">Verify</button>
</form>
</body>
</html>`;
  }

  // state.type === "start"
  const errorMsg = !error ? "" :
    error.type === "email_taken" ? errorBanner(`An account already exists. <a class="link" href="?provider=password">Sign in instead?</a>`) :
    error.type === "invalid_email" ? errorBanner("Please enter a valid email address.") :
    error.type === "invalid_password" ? errorBanner("Password must be at least 8 characters.") :
    error.type === "password_mismatch" ? errorBanner("Passwords do not match.") :
    errorBanner("Registration failed. Please try again.");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Create account — FitHub</title>
<style>${BASE_STYLE}</style>
</head>
<body>
<h1>Create your account</h1>
${errorMsg}
<form method="POST">
  <label for="email">Email address</label>
  <input id="email" name="email" type="email" required autofocus autocomplete="email">
  <label for="password">Password</label>
  <input id="password" name="password" type="password" required autocomplete="new-password" minlength="8">
  <label for="confirm">Confirm password</label>
  <input id="confirm" name="confirm" type="password" required autocomplete="new-password" minlength="8">
  <button type="submit">Create account</button>
</form>
<div class="actions">
  <a class="link" href="?provider=password">Already have an account? Sign in</a>
</div>
</body>
</html>`;
}

function changeHtml(state: ChangeState, error?: ChangeError): string {
  if (state.type === "code") {
    const errorMsg = error?.type === "invalid_code" ? errorBanner("Invalid code. Please try again.") : "";
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reset password — FitHub</title>
<style>${BASE_STYLE} #code{letter-spacing:.2em;font-size:1.2rem;text-align:center}</style>
</head>
<body>
<h1>Check your email</h1>
<p class="subtitle">We sent a 6-digit code to <strong>${state.email}</strong>.</p>
${errorMsg}
<form method="POST">
  <label for="code">6-digit code</label>
  <input id="code" name="code" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autofocus>
  <button type="submit">Continue</button>
</form>
</body>
</html>`;
  }

  if (state.type === "update") {
    const errorMsg = !error ? "" :
      error.type === "invalid_password" ? errorBanner("Password must be at least 8 characters.") :
      error.type === "password_mismatch" ? errorBanner("Passwords do not match.") :
      errorBanner("Failed to update password. Please try again.");

    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Set new password — FitHub</title>
<style>${BASE_STYLE}</style>
</head>
<body>
<h1>Set new password</h1>
${errorMsg}
<form method="POST">
  <label for="password">New password</label>
  <input id="password" name="password" type="password" required autofocus autocomplete="new-password" minlength="8">
  <label for="confirm">Confirm new password</label>
  <input id="confirm" name="confirm" type="password" required autocomplete="new-password" minlength="8">
  <button type="submit">Update password</button>
</form>
</body>
</html>`;
  }

  // state.type === "start"
  const errorMsg = error?.type === "invalid_email" ? errorBanner("No account found for that email address.") : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Reset password — FitHub</title>
<style>${BASE_STYLE}</style>
</head>
<body>
<h1>Reset your password</h1>
<p class="subtitle">Enter your email and we'll send you a verification code.</p>
${errorMsg}
<form method="POST">
  <label for="email">Email address</label>
  <input id="email" name="email" type="email" required autofocus autocomplete="email">
  <button type="submit">Send reset code</button>
</form>
<div class="actions">
  <a class="link" href="?provider=password">Back to sign in</a>
</div>
</body>
</html>`;
}

function magicStartHtml(errorMessage?: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Magic link — FitHub</title>
<style>${BASE_STYLE}</style>
</head>
<body>
<h1>Sign in with magic link</h1>
<p class="subtitle">Enter your email and we'll send you a one-time code.</p>
${errorMessage ? errorBanner(errorMessage) : ""}
<form method="POST">
  <label for="email">Email address</label>
  <input id="email" name="email" type="email" required autofocus autocomplete="email">
  <button type="submit">Send code</button>
</form>
<div class="actions">
  <a class="link" href="?provider=password">Use email &amp; password instead</a>
</div>
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
  <label for="code">6-digit code</label>
  <input id="code" name="code" type="text" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" required autofocus>
  <button type="submit">Verify</button>
</form>
</body>
</html>`;
}
