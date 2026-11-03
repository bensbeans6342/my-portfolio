// Decides who may use /admin. Two ways to lock it:
//
//   1. Password (default, no payment method needed): add a Secret named
//      ADMIN_PASSWORD to your Worker in the Cloudflare dashboard. Add a
//      second Secret named TOTP_SECRET (the setup key shown in /admin) to
//      also require a 6-digit code from an authenticator app.
//   2. Cloudflare Access (optional): fill in ACCESS_TEAM_DOMAIN and
//      ACCESS_AUD in wrangler.jsonc. When both are set, Access is used and
//      the password is ignored.
//
// The password and setup key are never stored in the code or the database.
// Signing in creates a random session token; only a hash of it is kept in D1.

import { checkAccess, readCookie, teamUrlFrom } from "./access.js";
import { isValidKey, matchCode, normalizeKey } from "./totp.js";

export const MIN_PASSWORD_LENGTH = 12;
const SESSION_COOKIE = "__Host-admin_session";
const SESSION_SECONDS = 7 * 24 * 60 * 60; // stay signed in for 7 days
const MAX_FAILS_PER_VISITOR = 5; // wrong passwords per visitor per 15 minutes
const MAX_FAILS_TOTAL = 100; // wrong passwords from everyone per hour

export const ADMIN_HEADERS = {
  "cache-control": "no-store",
  "x-frame-options": "DENY",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "same-origin",
  "x-content-type-options": "nosniff",
};

function esc(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Compares two secrets without leaking how much of them matched.
async function sameSecret(a, b) {
  const [x, y] = await Promise.all([sha256Hex(a), sha256Hex(b)]);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

function randomToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Ties sessions to the current password, so changing ADMIN_PASSWORD in the
// dashboard signs everyone out.
function passwordTag(env) {
  return sha256Hex(`session|${env.ADMIN_PASSWORD}`).then((h) => h.slice(0, 16));
}

async function visitorHash(request) {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const day = new Date().toISOString().slice(0, 10);
  return sha256Hex(`login|${ip}|${day}`);
}

export function adminMode(env) {
  if (teamUrlFrom(env.ACCESS_TEAM_DOMAIN) && String(env.ACCESS_AUD || "").trim()) return "access";
  if (env.ADMIN_PASSWORD) return "password";
  return "none";
}

// "off" (no TOTP_SECRET), "on" (a valid key) or "invalid" (something else
// was pasted in).
export function totpState(env) {
  if (!env.TOTP_SECRET) return "off";
  return isValidKey(normalizeKey(env.TOTP_SECRET)) ? "on" : "invalid";
}

async function lastUsedStep(database) {
  const row = await database.prepare(`SELECT value FROM settings WHERE key = 'totp_last_step'`).first();
  return row ? Number(row.value) : -1;
}

// Returns { ok: true, mode, email? } or { ok: false, mode, reason }.
export async function checkAdmin(request, env, database) {
  const mode = adminMode(env);
  if (mode === "access") return { ...(await checkAccess(request, env)), mode };
  if (mode === "none") return { ok: false, mode, reason: "not-configured" };

  if (String(env.ADMIN_PASSWORD).length < MIN_PASSWORD_LENGTH) {
    return { ok: false, mode, reason: "weak-password" };
  }
  const token = readCookie(request, SESSION_COOKIE);
  if (!/^[0-9a-f]{64}$/.test(token)) return { ok: false, mode, reason: "no-session" };

  const row = await database
    .prepare(
      `SELECT pw_tag FROM sessions
        WHERE token_hash = ? AND expires_at > datetime('now')`,
    )
    .bind(await sha256Hex(token))
    .first();
  if (!row || row.pw_tag !== (await passwordTag(env))) {
    return { ok: false, mode, reason: "no-session" };
  }
  return { ok: true, mode };
}

export function loginPage({ error = "", status = 200, totp = false } = {}) {
  const codeField = totp
    ? `<div class="field">
        <label for="code">6-digit code</label>
        <input type="text" id="code" name="code" inputmode="numeric" pattern="[0-9 ]*"
               autocomplete="one-time-code" maxlength="7" required aria-describedby="code-hint">
        <span class="hint" id="code-hint">From your authenticator app. It changes every 30 seconds.</span>
      </div>`
    : "";
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Admin sign-in</title>
  <link rel="icon" href="/favicon.svg" type="image/svg+xml">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400..800&family=Newsreader:ital,opsz,wght@0,6..72,400..600;1,6..72,400&display=swap">
  <link rel="stylesheet" href="/assets/site.css">
  <link rel="stylesheet" href="/assets/admin.css">
</head>
<body>
  <main class="login-wrap">
    <h1 class="login-title">Admin sign-in</h1>
    <p class="muted">${
      totp
        ? "Enter your admin password and the code from your authenticator app."
        : "Enter the admin password you set in Cloudflare."
    }</p>
    <form method="post" action="/admin/login">
      <input class="visually-hidden" type="text" name="username" value="admin"
             autocomplete="username" tabindex="-1" aria-hidden="true" readonly>
      <div class="field">
        <label for="pw">Password</label>
        <input type="password" id="pw" name="password" autocomplete="current-password" required autofocus>
      </div>
      ${codeField}
      ${error ? `<p class="form-error" role="alert">${esc(error)}</p>` : ""}
      <button class="btn" type="submit">Sign in</button>
    </form>
    <p class="login-back"><a href="/">Back to the site</a></p>
  </main>
</body>
</html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", ...ADMIN_HEADERS },
  });
}

async function readLoginForm(request) {
  const type = request.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    const data = (await request.json().catch(() => ({}))) || {};
    return { password: String(data.password || ""), code: String(data.code || "") };
  }
  const form = await request.formData().catch(() => null);
  return form
    ? { password: String(form.get("password") || ""), code: String(form.get("code") || "") }
    : { password: "", code: "" };
}

// POST /admin/login
export async function handleLogin(request, env, database) {
  const totp = totpState(env);
  const page = (status, error) => loginPage({ status, error, totp: totp === "on" });

  if (String(env.ADMIN_PASSWORD).length < MIN_PASSWORD_LENGTH) {
    return page(
      403,
      `The admin password must be at least ${MIN_PASSWORD_LENGTH} characters. Change ADMIN_PASSWORD in Cloudflare first.`,
    );
  }
  if (totp === "invalid") {
    return page(
      403,
      "TOTP_SECRET in Cloudflare isn't a valid setup key. Delete it there to sign in with just your password, then set up two-step sign-in again.",
    );
  }

  const { password, code } = await readLoginForm(request);
  if (!password) return page(400, "Enter your password.");
  if (totp === "on" && !code.trim()) return page(400, "Enter the 6-digit code from your authenticator app.");

  const visitor = await visitorHash(request);
  await database.batch([
    database.prepare(`DELETE FROM login_attempts WHERE created_at < datetime('now', '-1 day')`),
    database.prepare(`DELETE FROM sessions WHERE expires_at < datetime('now')`),
  ]);

  const mine = await database
    .prepare(
      `SELECT COUNT(*) AS n FROM login_attempts
        WHERE ip_hash = ? AND ok = 0 AND created_at > datetime('now', '-15 minutes')`,
    )
    .bind(visitor)
    .first();
  if (mine && mine.n >= MAX_FAILS_PER_VISITOR) {
    return page(429, "Too many failed sign-ins. Wait 15 minutes, then try again.");
  }
  const everyone = await database
    .prepare(
      `SELECT COUNT(*) AS n FROM login_attempts
        WHERE ok = 0 AND created_at > datetime('now', '-1 hour')`,
    )
    .first();
  if (everyone && everyone.n >= MAX_FAILS_TOTAL) {
    return page(429, "Sign-in is paused after many failed attempts from around the internet. Try again in an hour.");
  }

  // Check both the password and the code before saying anything, so a wrong
  // answer never reveals which half was wrong.
  const passwordOk = await sameSecret(password, String(env.ADMIN_PASSWORD));
  let step = null;
  let codeOk = true;
  if (totp === "on") {
    step = await matchCode(env.TOTP_SECRET, code);
    codeOk = step !== null && step > (await lastUsedStep(database)); // each code works once
  }

  if (!passwordOk || !codeOk) {
    await database
      .prepare(`INSERT INTO login_attempts (ip_hash, ok) VALUES (?, 0)`)
      .bind(visitor)
      .run();
    const what = totp === "on" ? "That password or code" : "That password";
    const left = MAX_FAILS_PER_VISITOR - (Number(mine && mine.n) || 0) - 1;
    return page(
      401,
      left > 0
        ? `${what} isn't right. ${left} ${left === 1 ? "try" : "tries"} left before a 15-minute pause.`
        : `${what} isn't right. Wait 15 minutes, then try again.`,
    );
  }

  const token = randomToken();
  const writes = [];
  if (step !== null) {
    writes.push(
      database
        .prepare(
          `INSERT INTO settings (key, value) VALUES ('totp_last_step', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        )
        .bind(String(step)),
    );
  }
  await database.batch([
    ...writes,
    database
      .prepare(
        `INSERT INTO sessions (token_hash, pw_tag, expires_at)
         VALUES (?, ?, datetime('now', '+${SESSION_SECONDS} seconds'))`,
      )
      .bind(await sha256Hex(token), await passwordTag(env)),
    database.prepare(`INSERT INTO login_attempts (ip_hash, ok) VALUES (?, 1)`).bind(visitor),
    database.prepare(`DELETE FROM login_attempts WHERE ip_hash = ? AND ok = 0`).bind(visitor),
  ]);

  return new Response(null, {
    status: 303,
    headers: {
      ...ADMIN_HEADERS,
      location: "/admin/",
      "set-cookie": `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`,
    },
  });
}

// GET /admin/logout
export async function handleLogout(request, env, database) {
  if (adminMode(env) === "access") {
    return new Response(null, { status: 302, headers: { ...ADMIN_HEADERS, location: "/cdn-cgi/access/logout" } });
  }
  const token = readCookie(request, SESSION_COOKIE);
  if (database && /^[0-9a-f]{64}$/.test(token)) {
    await database.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(await sha256Hex(token)).run();
  }
  return new Response(null, {
    status: 303,
    headers: {
      ...ADMIN_HEADERS,
      location: "/admin/",
      "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`,
    },
  });
}
