// Checks the sign-in token that Cloudflare Access attaches to every request
// it lets through. Access does the real login (the emailed one-time code);
// this file makes sure a request really came through YOUR Access app before
// the Worker hands out admin data. No secrets live here: the team domain and
// AUD tag are public identifiers, and the signing keys are fetched from
// Cloudflare.

const KEY_CACHE_MS = 10 * 60 * 1000; // reuse Access's public keys for 10 minutes
const MIN_REFRESH_MS = 5 * 1000; // refetch at most every 5s when an unknown key shows up

let keyCache = { teamUrl: "", keys: [], fetchedAt: 0 };

// Accepts "myteam", "myteam.cloudflareaccess.com" or the full https:// URL.
export function teamUrlFrom(raw) {
  let value = String(raw || "").trim().replace(/\/+$/, "");
  if (!value) return "";
  value = value.replace(/^https?:\/\//i, "");
  if (!value.includes(".")) value = `${value}.cloudflareaccess.com`;
  return `https://${value.toLowerCase()}`;
}

export function readCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

function b64urlBytes(input) {
  let s = input.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlJson(input) {
  return JSON.parse(new TextDecoder().decode(b64urlBytes(input)));
}

export async function loadAccessKeys(teamUrl, forceRefresh = false) {
  const age = Date.now() - keyCache.fetchedAt;
  const sameTeam = keyCache.teamUrl === teamUrl;
  if (sameTeam && keyCache.keys.length) {
    if (!forceRefresh && age < KEY_CACHE_MS) return keyCache.keys;
    if (forceRefresh && age < MIN_REFRESH_MS) return keyCache.keys;
  }
  const res = await fetch(`${teamUrl}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`could not load Access signing keys (HTTP ${res.status})`);
  const body = await res.json();
  keyCache = {
    teamUrl,
    keys: Array.isArray(body.keys) ? body.keys : [],
    fetchedAt: Date.now(),
  };
  return keyCache.keys;
}

// Verifies an Access JWT: RS256 signature, issuer, audience and expiry.
// Throws with a short reason if anything is off; returns the claims if valid.
export async function verifyAccessJwt(token, teamUrl, aud, keyLoader = loadAccessKeys) {
  const parts = String(token).split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const [rawHeader, rawPayload, rawSignature] = parts;

  let header, payload;
  try {
    header = b64urlJson(rawHeader);
    payload = b64urlJson(rawPayload);
  } catch {
    throw new Error("unreadable token");
  }
  if (header.alg !== "RS256") throw new Error("unexpected signing algorithm");

  let keys = await keyLoader(teamUrl, false);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    keys = await keyLoader(teamUrl, true); // keys may have rotated
    jwk = keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) throw new Error("signing key not found");

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: "RSA", n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const signedPart = new TextEncoder().encode(`${rawHeader}.${rawPayload}`);
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlBytes(rawSignature),
    signedPart,
  );
  if (!valid) throw new Error("bad signature");

  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < now - 30) throw new Error("token expired");
  if (typeof payload.nbf === "number" && payload.nbf > now + 30) throw new Error("token not valid yet");
  if (payload.iss !== teamUrl) throw new Error("token from a different Access team");
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(aud)) throw new Error("token for a different Access application");

  return payload;
}

// Returns { ok: true, email } or { ok: false, reason } where reason is
// "not-configured", "no-token" or "bad-token".
export async function checkAccess(request, env) {
  const teamUrl = teamUrlFrom(env.ACCESS_TEAM_DOMAIN);
  const aud = String(env.ACCESS_AUD || "").trim();
  if (!teamUrl || !aud) return { ok: false, reason: "not-configured" };

  const token =
    request.headers.get("cf-access-jwt-assertion") || readCookie(request, "CF_Authorization");
  if (!token) return { ok: false, reason: "no-token" };

  try {
    const claims = await verifyAccessJwt(token, teamUrl, aud);
    return { ok: true, email: claims.email || claims.common_name || "signed in" };
  } catch (err) {
    console.warn(`Rejected Access token: ${err.message}`);
    return { ok: false, reason: "bad-token" };
  }
}
