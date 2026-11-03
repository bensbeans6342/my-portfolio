// 6-digit codes that change every 30 seconds (the TOTP standard, RFC 6238),
// the same kind Google Authenticator, Microsoft Authenticator, 1Password and
// most other authenticator apps show.

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;

// Accepts the key with spaces, dashes or lowercase, as people tend to paste it.
export function normalizeKey(raw) {
  return String(raw || "")
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/=+$/, "");
}

// At least 26 characters = 130 bits, above the standard's 128-bit minimum.
export function isValidKey(key) {
  return /^[A-Z2-7]{26,128}$/.test(key);
}

function base32Decode(key) {
  const out = [];
  let bits = 0;
  let value = 0;
  for (const ch of key) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >> bits) & 0xff);
      value &= (1 << bits) - 1;
    }
  }
  return new Uint8Array(out);
}

export async function hotp(keyBytes, counter, digits = 6) {
  const message = new Uint8Array(8);
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    message[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, message));
  const offset = mac[mac.length - 1] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, "0");
}

function sameCode(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function cleanCode(raw) {
  return String(raw || "").replace(/\s/g, "");
}

// Returns the time step the code belongs to, or null if it doesn't match.
// Accepts the current 30-second window and one on either side, so a phone
// clock that's a little off still works.
export async function matchCode(rawKey, rawCode, nowMs = Date.now()) {
  const key = normalizeKey(rawKey);
  const code = cleanCode(rawCode);
  if (!isValidKey(key) || !/^\d{6}$/.test(code)) return null;
  const bytes = base32Decode(key);
  const step = Math.floor(nowMs / 1000 / STEP_SECONDS);
  let matched = null;
  for (const offset of [-1, 0, 1]) {
    if (sameCode(await hotp(bytes, step + offset), code) && matched === null) matched = step + offset;
  }
  return matched;
}

export const _test = { base32Decode };
