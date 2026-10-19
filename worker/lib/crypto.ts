const encoder = new TextEncoder();

function asBytes(data: string | Uint8Array): Uint8Array {
  return typeof data === "string" ? encoder.encode(data) : data;
}

export function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]*$/i.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", asBytes(data)));
}

export function randomToken(byteLength = 32): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [usage]);
}

export async function hmacSha256Hex(secret: string, data: string | Uint8Array): Promise<string> {
  const key = await hmacKey(secret, "sign");
  return toHex(await crypto.subtle.sign("HMAC", key, asBytes(data)));
}

// crypto.subtle.verify compares in constant time, unlike comparing two hex strings.
export async function verifyHmacSha256Hex(
  secret: string,
  data: Uint8Array,
  signatureHex: string | null,
): Promise<boolean> {
  const signature = fromHex(signatureHex?.trim() ?? "");
  if (!signature || signature.byteLength !== 32) return false;
  const key = await hmacKey(secret, "verify");
  return crypto.subtle.verify("HMAC", key, signature, data);
}
