const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomBytes(n: number): Uint8Array {
  const buf = new Uint8Array(n);
  crypto.getRandomValues(buf);
  return buf;
}

function randomId(len: number): string {
  const bytes = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

export const ids = {
  tenant: () => `ten_${randomId(16)}`,
  template: () => `tmpl_${randomId(16)}`,
  job: () => `job_${randomId(16)}`,
  apiKey: () => `opx_${randomId(20)}`,
  user: () => `usr_${randomId(16)}`,
  session: () => `sess_${randomId(24)}`,
};

export const tokenBytes = randomBytes;

/** A high-entropy secret, base64url encoded (32 random bytes). */
export function generateSecret(): string {
  const b = randomBytes(32);
  let s = "";
  for (const byte of b) s += String.fromCharCode(byte);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
