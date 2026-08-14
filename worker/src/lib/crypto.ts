const enc = new TextEncoder();

const asBS = (b: Uint8Array): BufferSource => b as unknown as BufferSource;

function toHex(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function toB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const data = typeof input === "string" ? enc.encode(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", data.buffer as ArrayBuffer);
  return toHex(digest);
}

export async function hmacSha256(secret: Uint8Array, message: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", secret.buffer as ArrayBuffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return toHex(sig);
}

// ---- AES-GCM credential encryption -----------------------------------------
// Blob format: base64(iv).base64(tag).base64(ciphertext)

function importAesKey(keyB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", fromB64(keyB64).buffer as ArrayBuffer, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}

export async function aesGcmEncrypt(plaintext: string, keyB64: string, aad?: string): Promise<string> {
  const key = await importAesKey(keyB64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad ? asBS(enc.encode(aad)) : undefined },
    key,
    asBS(enc.encode(plaintext)),
  );
  const ctBytes = new Uint8Array(ct);
  const tag = ctBytes.slice(ctBytes.length - 16);
  const body = ctBytes.slice(0, ctBytes.length - 16);
  return `${toB64(iv)}.${toB64(tag)}.${toB64(body)}`;
}

export async function aesGcmDecrypt(blob: string, keyB64: string, aad?: string): Promise<string> {
  const [ivB64, tagB64, bodyB64] = blob.split(".");
  if (!ivB64 || !tagB64 || !bodyB64) throw new Error("malformed encrypted blob");
  const key = await importAesKey(keyB64);
  const iv = fromB64(ivB64);
  const full = new Uint8Array(iv.length + 16 + fromB64(bodyB64).length);
  full.set(fromB64(ivB64), 0);
  full.set(fromB64(tagB64), iv.length);
  full.set(fromB64(bodyB64), iv.length + 16);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: asBS(iv), additionalData: aad ? asBS(enc.encode(aad)) : undefined },
    key,
    full,
  );
  return new TextDecoder().decode(pt);
}

// ---- PBKDF2 password hashing -----------------------------------------------

const PBKDF2_ITERATIONS = 100_000;

export async function pbkdf2Hash(password: string, salt: Uint8Array = crypto.getRandomValues(new Uint8Array(16))): Promise<string> {
  const key = await crypto.subtle.importKey("raw", asBS(enc.encode(password)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: asBS(salt), iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    key,
    256,
  );
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toB64(salt)}$${toB64(new Uint8Array(bits))}`;
}

export async function pbkdf2Verify(password: string, stored: string): Promise<boolean> {
  const [scheme, itersStr, saltB64, hashB64] = stored.split("$");
  if (scheme !== "pbkdf2" || !itersStr || !saltB64 || !hashB64) return false;
  const computed = await pbkdf2Hash(password, fromB64(saltB64));
  const [, , , computedHash] = computed.split("$");
  return computedHash === hashB64;
}

// ---- misc -------------------------------------------------------------------

export const bytes = { toHex, fromHex, toB64, fromB64 };
export { sha256Hex as sha256, enc };
