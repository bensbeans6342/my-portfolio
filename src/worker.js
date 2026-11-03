// The backend for your portfolio site. It runs on Cloudflare Workers and:
//   - serves the pages in /public
//   - answers the public data API at /api/...
//   - answers the admin API at /admin/api/... (only after signing in; see auth.js)
//
// You shouldn't need to edit this file. Your name, bio and resume details
// live in public/config.js, and everything else is managed at /admin.

import {
  ADMIN_HEADERS,
  MIN_PASSWORD_LENGTH,
  adminMode,
  checkAdmin,
  handleLogin,
  handleLogout,
  loginPage,
  totpState,
} from "./auth.js";
import { isValidKey, matchCode, normalizeKey } from "./totp.js";

// ---------------------------------------------------------------------------
// Database tables (created automatically the first time the site runs)
// ---------------------------------------------------------------------------

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS achievements (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     title TEXT NOT NULL,
     description TEXT NOT NULL DEFAULT '',
     category TEXT NOT NULL DEFAULT '',
     date TEXT NOT NULL DEFAULT '',
     link TEXT NOT NULL DEFAULT '',
     featured INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE TABLE IF NOT EXISTS posts (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     slug TEXT NOT NULL UNIQUE,
     title TEXT NOT NULL,
     summary TEXT NOT NULL DEFAULT '',
     body TEXT NOT NULL DEFAULT '',
     date TEXT NOT NULL,
     published INTEGER NOT NULL DEFAULT 1,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE TABLE IF NOT EXISTS events (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     title TEXT NOT NULL,
     date TEXT NOT NULL,
     start_time TEXT NOT NULL DEFAULT '',
     end_time TEXT NOT NULL DEFAULT '',
     location TEXT NOT NULL DEFAULT '',
     description TEXT NOT NULL DEFAULT '',
     link TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE TABLE IF NOT EXISTS messages (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     name TEXT NOT NULL,
     email TEXT NOT NULL,
     body TEXT NOT NULL,
     ip_hash TEXT NOT NULL DEFAULT '',
     is_read INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token_hash TEXT PRIMARY KEY,
     pw_tag TEXT NOT NULL,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     expires_at TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS login_attempts (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     ip_hash TEXT NOT NULL,
     ok INTEGER NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL DEFAULT (datetime('now'))
   )`,
  `CREATE INDEX IF NOT EXISTS idx_login_attempts ON login_attempts (ip_hash, created_at)`,
  `CREATE TABLE IF NOT EXISTS settings (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS idx_posts_date ON posts (published, date)`,
  `CREATE INDEX IF NOT EXISTS idx_events_date ON events (date)`,
  `CREATE INDEX IF NOT EXISTS idx_messages_ip ON messages (ip_hash, created_at)`,
];

const schemaReady = new WeakMap(); // one setup run per database binding

async function ensureSchema(env) {
  const database = env.DB;
  if (!database) {
    throw new HttpError(
      500,
      "The database isn't connected. Check the d1_databases section of wrangler.jsonc.",
    );
  }
  if (!schemaReady.has(database)) {
    schemaReady.set(
      database,
      database.batch(SCHEMA.map((sql) => database.prepare(sql))).catch((err) => {
        schemaReady.delete(database);
        throw err;
      }),
    );
  }
  await schemaReady.get(database);
  return database;
}

// ---------------------------------------------------------------------------
// What the admin can edit, and the rules for each field
// ---------------------------------------------------------------------------

const RESOURCES = {
  achievements: {
    order: "featured DESC, date DESC, id DESC",
    columns: "*",
    fields: {
      title: { type: "text", max: 200, required: true },
      description: { type: "text", max: 2000 },
      category: { type: "text", max: 60 },
      date: { type: "date" },
      link: { type: "url" },
      featured: { type: "bool" },
    },
  },
  posts: {
    order: "date DESC, id DESC",
    columns: "*",
    fields: {
      title: { type: "text", max: 200, required: true },
      slug: { type: "slug", required: true },
      summary: { type: "text", max: 400 },
      body: { type: "text", max: 100000, required: true },
      date: { type: "date", required: true },
      published: { type: "bool" },
    },
  },
  events: {
    order: "date ASC, start_time ASC, id ASC",
    columns: "*",
    fields: {
      title: { type: "text", max: 200, required: true },
      date: { type: "date", required: true },
      start_time: { type: "time" },
      end_time: { type: "time" },
      location: { type: "text", max: 200 },
      description: { type: "text", max: 2000 },
      link: { type: "url" },
    },
  },
  messages: {
    order: "created_at DESC, id DESC",
    columns: "id, name, email, body, is_read, created_at",
    noCreate: true, // messages only come from the public contact form
    fields: {
      is_read: { type: "bool" },
    },
  },
};

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function labelFor(field) {
  const text = field.replace(/_/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function cleanField(field, rule, raw) {
  if (rule.type === "bool") {
    return raw === true || raw === 1 || raw === "1" || raw === "true" || raw === "on" ? 1 : 0;
  }
  const label = labelFor(field);
  let value = raw == null ? "" : String(raw).trim();

  switch (rule.type) {
    case "text":
      if (value.length > rule.max) {
        throw new HttpError(400, `${label} must be ${rule.max} characters or fewer.`);
      }
      break;
    case "date":
      if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)))) {
        throw new HttpError(400, `${label} must be a date like 2026-11-02.`);
      }
      break;
    case "time":
      if (value && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
        throw new HttpError(400, `${label} must be a time like 14:30.`);
      }
      break;
    case "url":
      if (value) {
        let parsed;
        try {
          parsed = new URL(value);
        } catch {
          throw new HttpError(400, `${label} must be a full web address starting with https://.`);
        }
        if (!["http:", "https:", "mailto:"].includes(parsed.protocol)) {
          throw new HttpError(400, `${label} must start with https://, http:// or mailto:.`);
        }
        value = parsed.toString();
        if (value.length > 500) throw new HttpError(400, `${label} is too long.`);
      }
      break;
    case "slug":
      value = slugify(value);
      break;
  }

  if (rule.required && !value) throw new HttpError(400, `${label} is required.`);
  return value;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

async function readJson(request) {
  const type = request.headers.get("content-type") || "";
  if (!type.includes("application/json")) {
    throw new HttpError(415, "Send the data as JSON.");
  }
  const text = await request.text();
  if (text.length > 250_000) throw new HttpError(413, "That's too much text to save at once.");
  try {
    const data = JSON.parse(text);
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    throw new HttpError(400, "The data sent wasn't valid JSON.");
  }
}

// Blocks other websites from submitting forms or admin changes on your behalf.
function assertSameOrigin(request, url) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== url.origin) {
    throw new HttpError(403, "This request came from another website, so it was blocked.");
  }
}

async function sha256(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function withHeaders(response, headers) {
  const copy = new Response(response.body, response);
  for (const [key, value] of Object.entries(headers)) copy.headers.set(key, value);
  return copy;
}

function redirect(location) {
  return new Response(null, { status: 303, headers: { ...ADMIN_HEADERS, location } });
}

// ---------------------------------------------------------------------------
// Public API: /api/...
// ---------------------------------------------------------------------------

async function handlePublicApi(request, env, url) {
  const parts = url.pathname.slice("/api/".length).split("/").filter(Boolean);
  const [resource, item] = parts;
  const method = request.method;

  if (resource === "contact") {
    if (method !== "POST") throw new HttpError(405, "Use POST to send a message.");
    return handleContact(request, env, url);
  }

  if (method !== "GET") throw new HttpError(405, "This address is read-only.");
  const database = await ensureSchema(env);

  if (resource === "achievements" && !item) {
    const { results } = await database
      .prepare(
        `SELECT id, title, description, category, date, link, featured
           FROM achievements ORDER BY date DESC, id DESC`,
      )
      .all();
    return json({ achievements: results });
  }

  if (resource === "posts" && !item) {
    const { results } = await database
      .prepare(
        `SELECT slug, title, summary, date FROM posts
          WHERE published = 1 ORDER BY date DESC, id DESC`,
      )
      .all();
    return json({ posts: results });
  }

  if (resource === "posts" && item) {
    const post = await database
      .prepare(
        `SELECT slug, title, summary, body, date, updated_at FROM posts
          WHERE published = 1 AND slug = ?`,
      )
      .bind(item)
      .first();
    if (!post) throw new HttpError(404, "That post doesn't exist or isn't published.");
    return json({ post });
  }

  if (resource === "events" && !item) {
    const from = url.searchParams.get("from") || "0000-01-01";
    const to = url.searchParams.get("to") || "9999-12-31";
    const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (!isDate(from) || !isDate(to)) throw new HttpError(400, "Use dates like 2026-11-02.");
    const { results } = await database
      .prepare(
        `SELECT id, title, date, start_time, end_time, location, description, link
           FROM events WHERE date >= ? AND date <= ?
          ORDER BY date ASC, start_time ASC, id ASC`,
      )
      .bind(from, to)
      .all();
    return json({ events: results });
  }

  throw new HttpError(404, "There's nothing at this address.");
}

async function handleContact(request, env, url) {
  assertSameOrigin(request, url);
  const data = await readJson(request);

  // Bots tend to fill in every field, including this hidden one.
  if (data.website) return json({ ok: true }, 201);

  const name = String(data.name || "").trim().slice(0, 100);
  const email = String(data.email || "").trim().slice(0, 200);
  const body = String(data.message || "").trim();

  if (!name) throw new HttpError(400, "Add your name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "Add a valid email address so I can reply.");
  if (body.length < 10) throw new HttpError(400, "Write a slightly longer message (at least 10 characters).");
  if (body.length > 5000) throw new HttpError(400, "Keep your message under 5,000 characters.");

  const database = await ensureSchema(env);
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const day = new Date().toISOString().slice(0, 10);
  const ipHash = await sha256(`${ip}|${day}`); // hashed, never stored raw

  const perVisitor = await database
    .prepare(
      `SELECT COUNT(*) AS n FROM messages
        WHERE ip_hash = ? AND created_at > datetime('now', '-1 hour')`,
    )
    .bind(ipHash)
    .first();
  if (perVisitor && perVisitor.n >= 5) {
    throw new HttpError(429, "You've sent several messages already. Try again in an hour.");
  }

  const perDay = await database
    .prepare(`SELECT COUNT(*) AS n FROM messages WHERE created_at > datetime('now', '-1 day')`)
    .first();
  if (perDay && perDay.n >= 200) {
    throw new HttpError(429, "The contact form is busy right now. Try again tomorrow or use email.");
  }

  await database
    .prepare(`INSERT INTO messages (name, email, body, ip_hash) VALUES (?, ?, ?, ?)`)
    .bind(name, email, body, ipHash)
    .run();

  return json({ ok: true }, 201);
}

// ---------------------------------------------------------------------------
// Admin: /admin and /admin/api/... (sign-in required; see auth.js)
// ---------------------------------------------------------------------------

function adminBlockedPage(reason) {
  const titles = {
    "not-configured": "Admin isn't connected yet",
    "weak-password": "Admin password is too short",
    "bad-totp-secret": "Two-step sign-in key isn't valid",
  };
  const title = titles[reason] || "Sign-in required";
  const message =
    reason === "not-configured"
      ? `No admin password has been set, so the admin area stays locked. In Cloudflare, open
         <b>Workers &amp; Pages</b>, then your Worker, then <b>Settings &gt; Variables and Secrets</b>.
         Add a <b>Secret</b> named <code>ADMIN_PASSWORD</code> (at least ${MIN_PASSWORD_LENGTH}
         characters) and deploy. Then reload this page.`
      : reason === "weak-password"
        ? `<code>ADMIN_PASSWORD</code> must be at least ${MIN_PASSWORD_LENGTH} characters.
           Edit it in Cloudflare under <b>Settings &gt; Variables and Secrets</b>, deploy,
           then reload this page.`
      : reason === "bad-totp-secret"
        ? `The <code>TOTP_SECRET</code> saved in Cloudflare isn't a valid setup key, so sign-in is
           paused. In Cloudflare, open <b>Settings &gt; Variables and Secrets</b> and either paste the
           setup key again exactly, or delete <code>TOTP_SECRET</code> to sign in with just your
           password and set up two-step sign-in again. Deploy, then reload this page.`
        : reason === "bad-token"
          ? `Your sign-in couldn't be confirmed. If you just set this up, check that
             <code>ACCESS_TEAM_DOMAIN</code> and <code>ACCESS_AUD</code> in <code>wrangler.jsonc</code>
             match your Access application exactly, then reload this page.`
          : `This page only opens after signing in through Cloudflare Access. If you're the owner,
             check that your Access application covers this exact address and the path
             <code>admin*</code>.`;

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F4F6F1;color:#16233A;
    font:17px/1.55 system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px}
  main{max-width:34rem}
  h1{font-size:1.6rem;margin:0 0 .5rem}
  code{background:#E6EBE0;padding:.1em .35em;border-radius:4px;font-size:.92em}
  a{color:#1D5BD8}
  @media (prefers-color-scheme:dark){body{background:#121A26;color:#E8EDF3}code{background:#1F2B3C}a{color:#8EB1FF}}
</style></head>
<body><main><h1>${title}</h1><p>${message}</p><p><a href="/">Back to the site</a></p></main></body></html>`;

  return new Response(html, {
    status: 403,
    headers: { "content-type": "text/html; charset=utf-8", ...ADMIN_HEADERS },
  });
}

async function handleAdmin(request, env, url) {
  const path = url.pathname;
  const mode = adminMode(env);
  const isApi = path.startsWith("/admin/api/");
  const database = mode === "password" ? await ensureSchema(env) : null;

  if (path === "/admin/logout") {
    return handleLogout(request, env, database);
  }
  if (path === "/admin/login") {
    if (mode !== "password" || request.method !== "POST") return redirect("/admin/");
    assertSameOrigin(request, url);
    return handleLogin(request, env, database);
  }

  const auth = await checkAdmin(request, env, database);

  if (!auth.ok) {
    if (isApi) {
      return withHeaders(
        json({ error: "Your admin sign-in has expired. Reload the page to sign in again.", reason: auth.reason }, 401),
        ADMIN_HEADERS,
      );
    }
    if (auth.reason === "no-session") {
      const totp = totpState(env);
      if (totp === "invalid") return adminBlockedPage("bad-totp-secret");
      return loginPage({ totp: totp === "on" });
    }
    return adminBlockedPage(auth.reason);
  }

  if (!isApi) {
    const page = await env.ASSETS.fetch(request);
    return withHeaders(page, ADMIN_HEADERS);
  }

  if (request.method !== "GET") assertSameOrigin(request, url);
  const response = await handleAdminApi(request, env, url, auth);
  return withHeaders(response, ADMIN_HEADERS);
}

async function handleAdminApi(request, env, url, access) {
  const parts = url.pathname.slice("/admin/api/".length).split("/").filter(Boolean);
  const [resource, id] = parts;
  const method = request.method;

  if (resource === "me" && method === "GET") {
    return json({
      email: access.email || null,
      mode: access.mode,
      totp: access.mode === "password" ? totpState(env) : null,
    });
  }

  // Two-step sign-in setup (password mode only).
  if (resource === "2fa") {
    if (access.mode !== "password") throw new HttpError(404, "Two-step sign-in is handled by Cloudflare Access.");
    if (method !== "POST") throw new HttpError(405, "Use POST.");
    const input = await readJson(request);

    if (id === "check") {
      // Confirms an authenticator app was set up with a new key, before the
      // key is saved in Cloudflare. Nothing is stored.
      const key = normalizeKey(input.key);
      if (!isValidKey(key)) throw new HttpError(400, "That setup key isn't valid. Start over to get a new one.");
      if ((await matchCode(key, input.code)) === null) {
        throw new HttpError(
          400,
          "That code doesn't match. Check that the key in your app is exactly the one shown, and that your phone sets its clock automatically.",
        );
      }
      return json({ ok: true });
    }

    if (id === "test") {
      // Confirms the key saved in Cloudflare matches your app.
      const state = totpState(env);
      if (state === "off") throw new HttpError(400, "TOTP_SECRET isn't saved in Cloudflare yet, or the deploy hasn't finished.");
      if (state === "invalid") throw new HttpError(400, "The TOTP_SECRET saved in Cloudflare isn't a valid setup key.");
      if ((await matchCode(env.TOTP_SECRET, input.code)) === null) {
        throw new HttpError(
          400,
          "That code doesn't match the key saved in Cloudflare. Paste the setup key into TOTP_SECRET again, deploy, and test once more before signing out.",
        );
      }
      return json({ ok: true });
    }
    throw new HttpError(404, "Unknown admin address.");
  }

  const def = RESOURCES[resource];
  if (!def || parts.length > 2) throw new HttpError(404, "Unknown admin address.");
  if (id !== undefined && !/^\d+$/.test(id)) throw new HttpError(400, "Bad item number.");

  const database = await ensureSchema(env);

  try {
    if (!id && method === "GET") {
      const { results } = await database
        .prepare(`SELECT ${def.columns} FROM ${resource} ORDER BY ${def.order} LIMIT 2000`)
        .all();
      return json({ items: results });
    }

    if (!id && method === "POST") {
      if (def.noCreate) throw new HttpError(405, "These can't be created here.");
      const input = await readJson(request);
      if (resource === "posts" && !String(input.slug || "").trim()) input.slug = input.title;

      const values = {};
      for (const [field, rule] of Object.entries(def.fields)) {
        values[field] = cleanField(field, rule, input[field]);
      }
      const columns = Object.keys(values);
      const row = await database
        .prepare(
          `INSERT INTO ${resource} (${columns.join(", ")})
           VALUES (${columns.map(() => "?").join(", ")})
           RETURNING ${def.columns}`,
        )
        .bind(...columns.map((c) => values[c]))
        .first();
      return json({ item: row }, 201);
    }

    if (id && method === "PUT") {
      const input = await readJson(request);
      const sets = [];
      const binds = [];
      for (const [field, rule] of Object.entries(def.fields)) {
        if (field in input) {
          sets.push(`${field} = ?`);
          binds.push(cleanField(field, rule, input[field]));
        }
      }
      if (!sets.length) throw new HttpError(400, "Nothing to update.");
      if (resource === "posts") sets.push(`updated_at = datetime('now')`);

      const row = await database
        .prepare(`UPDATE ${resource} SET ${sets.join(", ")} WHERE id = ? RETURNING ${def.columns}`)
        .bind(...binds, Number(id))
        .first();
      if (!row) throw new HttpError(404, "That item no longer exists.");
      return json({ item: row });
    }

    if (id && method === "DELETE") {
      const result = await database
        .prepare(`DELETE FROM ${resource} WHERE id = ?`)
        .bind(Number(id))
        .run();
      if (!result.meta || result.meta.changes === 0) {
        throw new HttpError(404, "That item no longer exists.");
      }
      return json({ ok: true });
    }
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (String(err && err.message).includes("UNIQUE")) {
      throw new HttpError(409, "Another post already uses that web address (slug). Pick a different one.");
    }
    throw err;
  }

  throw new HttpError(405, "That action isn't supported here.");
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (path === "/admin" || path.startsWith("/admin/")) {
        return await handleAdmin(request, env, url);
      }
      if (path.startsWith("/api/")) {
        return await handlePublicApi(request, env, url);
      }
      return env.ASSETS.fetch(request);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err && err.stack ? err.stack : err);
      return json(
        { error: "Something went wrong on the server. Check your Worker's logs in Cloudflare." },
        500,
      );
    }
  },
};
