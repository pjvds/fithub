import { describe, it, expect } from "vitest";
import { encryptToken, decryptToken } from "../src/crypto/token-vault.js";

function genKeyB64(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

describe("token-vault", () => {
  it("round-trips a plaintext token", async () => {
    const key = genKeyB64();
    const plaintext = "oauth_access_token_abc123";
    const ct = await encryptToken(plaintext, key);
    expect(ct.startsWith("v1:")).toBe(true);
    expect(ct).not.toContain(plaintext);
    const decrypted = await decryptToken(ct, key);
    expect(decrypted).toBe(plaintext);
  });

  it("produces different ciphertexts for the same plaintext (random IV)", async () => {
    const key = genKeyB64();
    const a = await encryptToken("secret", key);
    const b = await encryptToken("secret", key);
    expect(a).not.toBe(b);
  });

  it("rejects malformed ciphertext", async () => {
    const key = genKeyB64();
    await expect(decryptToken("not-valid", key)).rejects.toThrow();
  });

  it("rejects wrong-size key", async () => {
    await expect(encryptToken("x", btoa("short"))).rejects.toThrow();
  });
});
