import type { MiddlewareHandler } from "hono";

interface Jwk {
  kid?: string;
  kty: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
  x?: string;
  y?: string;
  crv?: string;
}

interface Jwks {
  keys: Jwk[];
}

interface JwtPayload {
  sub: string;
  iss?: string;
  aud?: string | string[];
  exp?: number;
  iat?: number;
  [k: string]: unknown;
}

interface JwksCache {
  fetchedAt: number;
  jwks: Jwks;
}

const JWKS_TTL_MS = 5 * 60 * 1000;
let jwksCache: JwksCache | null = null;

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = (s + pad).replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlDecodeText(s: string): string {
  return new TextDecoder().decode(b64urlDecode(s));
}

async function fetchJwks(jwksUrl: string): Promise<Jwks> {
  const now = Date.now();
  if (jwksCache && now - jwksCache.fetchedAt < JWKS_TTL_MS) {
    return jwksCache.jwks;
  }
  const res = await fetch(jwksUrl);
  if (!res.ok) throw new Error(`jwks fetch failed: ${res.status}`);
  const jwks = (await res.json()) as Jwks;
  jwksCache = { fetchedAt: now, jwks };
  return jwks;
}

function selectKey(jwks: Jwks, kid: string | undefined): Jwk | undefined {
  if (kid) return jwks.keys.find((k) => k.kid === kid);
  return jwks.keys[0];
}

async function importJwk(jwk: Jwk): Promise<CryptoKey> {
  const algName = jwk.alg ?? (jwk.kty === "RSA" ? "RS256" : "ES256");
  const algo: RsaHashedImportParams | EcKeyImportParams =
    jwk.kty === "RSA"
      ? { name: "RSASSA-PKCS1-v1_5", hash: { name: algName.replace("RS", "SHA-") } }
      : { name: "ECDSA", namedCurve: jwk.crv ?? "P-256" };
  return crypto.subtle.importKey("jwk", jwk as JsonWebKey, algo, false, ["verify"]);
}

export interface VerifiedJwt {
  userId: string;
  payload: JwtPayload;
}

export async function verifyJwt(token: string, jwksUrl: string, opts?: { audience?: string; issuer?: string }): Promise<VerifiedJwt> {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed_jwt");
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  const header = JSON.parse(b64urlDecodeText(headerB64)) as { alg?: string; kid?: string };
  const payload = JSON.parse(b64urlDecodeText(payloadB64)) as JwtPayload;

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp !== undefined && now >= payload.exp) throw new Error("expired");
  if (opts?.audience && payload.aud !== opts.audience && !(Array.isArray(payload.aud) && payload.aud.includes(opts.audience))) {
    throw new Error("bad_audience");
  }
  if (opts?.issuer && payload.iss !== opts.issuer) throw new Error("bad_issuer");
  if (!payload.sub) throw new Error("missing_sub");

  const jwks = await fetchJwks(jwksUrl);
  const jwk = selectKey(jwks, header.kid);
  if (!jwk) throw new Error("no_matching_key");
  const key = await importJwk(jwk);

  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const sig = b64urlDecode(sigB64);
  const algoName = header.alg ?? "RS256";
  const verifyAlgo: AlgorithmIdentifier | EcdsaParams =
    algoName.startsWith("RS")
      ? { name: "RSASSA-PKCS1-v1_5" }
      : { name: "ECDSA", hash: { name: "SHA-256" } };
  const valid = await crypto.subtle.verify(verifyAlgo, key, sig as BufferSource, data as BufferSource);
  if (!valid) throw new Error("bad_signature");

  return { userId: payload.sub, payload };
}

export interface AuthVariables {
  userId: string;
  jwtPayload: JwtPayload;
}

export interface AuthMiddlewareOptions {
  jwksUrl: string;
  audience?: string;
  issuer?: string;
}

export function authMiddleware(opts: AuthMiddlewareOptions): MiddlewareHandler<{ Variables: AuthVariables }> {
  return async (c, next) => {
    const header = c.req.header("authorization") ?? c.req.header("Authorization");
    if (!header || !header.toLowerCase().startsWith("bearer ")) {
      return c.json({ error: "unauthenticated" }, 401);
    }
    const token = header.slice(7).trim();
    try {
      const verifyOpts: { audience?: string; issuer?: string } = {};
      if (opts.audience !== undefined) verifyOpts.audience = opts.audience;
      if (opts.issuer !== undefined) verifyOpts.issuer = opts.issuer;
      const { userId, payload } = await verifyJwt(token, opts.jwksUrl, verifyOpts);
      c.set("userId", userId);
      c.set("jwtPayload", payload);
    } catch (err) {
      console.warn("auth: token rejected", (err as Error).message);
      return c.json({ error: "unauthenticated" }, 401);
    }
    await next();
  };
}
