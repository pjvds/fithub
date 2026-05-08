const VERSION = "v1";
const IV_BYTES = 12;

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (const byte of bytes) s += String.fromCharCode(byte);
  return btoa(s);
}

function b64decode(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importKey(keyB64: string): Promise<CryptoKey> {
  // Normalize: strip whitespace and convert base64url to standard base64
  const normalized = keyB64.trim().replace(/-/g, "+").replace(/_/g, "/");
  // Pad to a multiple of 4 if needed
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  const raw = b64decode(padded);
  if (raw.length < 16) {
    throw new Error(`TOKEN_MASTER_KEY must be at least 16 bytes when base64-decoded (got ${raw.length} bytes)`);
  }
  // Use HKDF to derive a 32-byte AES-256-GCM key from the raw key material.
  // This accepts any base64 key ≥ 16 bytes and is sound cryptographic practice.
  const hkdfKey = await crypto.subtle.importKey("raw", raw as BufferSource, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0),
      info: new TextEncoder().encode("fithub-token-vault-v1"),
    },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptToken(plaintext: string, masterKeyB64: string): Promise<string> {
  const key = await importKey(masterKeyB64);
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const data = new TextEncoder().encode(plaintext);
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, data as BufferSource),
  );
  return `${VERSION}:${b64encode(iv)}:${b64encode(ct)}`;
}

export async function decryptToken(ciphertext: string, masterKeyB64: string): Promise<string> {
  const parts = ciphertext.split(":");
  if (parts.length !== 3 || parts[0] !== VERSION) {
    throw new Error("Invalid ciphertext format");
  }
  const [, ivB64, ctB64] = parts;
  const key = await importKey(masterKeyB64);
  const iv = b64decode(ivB64!);
  const ct = b64decode(ctB64!);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, ct as BufferSource);
  return new TextDecoder().decode(pt);
}
