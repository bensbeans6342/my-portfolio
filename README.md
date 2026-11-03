# My portfolio site

A personal achievements site with four public pages (Home, Resume & contact,
Calendar, Blog) and a private `/admin` dashboard, hosted free on Cloudflare
Workers.

`/admin` is locked with a password you set as a Secret named `ADMIN_PASSWORD`
in the Cloudflare dashboard (Workers & Pages > your Worker > Settings >
Variables and Secrets). It must be at least 12 characters. Five wrong tries
from one visitor pause sign-in for 15 minutes. The password never appears in
this repository.

Two-step sign-in: after signing in, open the admin's Sign-in tab. It makes a
random setup key (with a QR code) for your authenticator app. Once you save
that key as a second Secret named `TOTP_SECRET`, signing in needs your
password plus the app's 6-digit code. Lost your phone? Delete `TOTP_SECRET`
in Cloudflare to sign in with just the password, then set it up again.

Optionally, `/admin` can use Cloudflare Access instead: fill in
`ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` in `wrangler.jsonc`, and Access replaces
the password. (Cloudflare's Zero Trust signup asks for a payment method, even
on its free plan.)

## Where to change things

| What | Where |
| --- | --- |
| Name, bio, links, education, experience, skills | `public/config.js` (edit on GitHub) |
| Resume PDF | replace `public/resume.pdf` |
| Achievements, blog posts, calendar events, contact messages | your site's `/admin` |
| Admin password | Cloudflare dashboard, Secret `ADMIN_PASSWORD` |
| Two-step sign-in key | Cloudflare dashboard, Secret `TOTP_SECRET` (made in the admin's Sign-in tab) |
| Database ID (and optional Access settings) | `wrangler.jsonc` |

## Setup, in short (all in the browser)

1. Upload these files to a new GitHub repository.
2. Cloudflare > Storage & databases > D1 > create `portfolio-db`; paste its
   Database ID into `wrangler.jsonc`.
3. Cloudflare > Workers & Pages > Create application > Import a repository >
   pick this repo, project name `my-portfolio`, deploy.
4. Your Worker > Settings > Variables and Secrets > Add > type Secret, name
   `ADMIN_PASSWORD`, a passphrase of 12+ characters > Deploy. Visit `/admin`.
5. In the admin, open Sign-in, add the setup key to your authenticator app,
   check a code, then save the key as Secret `TOTP_SECRET` and Deploy.

The full step-by-step guide was shared alongside this code.

## Files

```
public/            the website (served as static files)
  config.js        your details
  index.html       home
  contact/         resume & contact
  calendar/        calendar
  blog/            blog list and posts
  admin/           admin dashboard (only served after signing in)
  assets/          styles and page scripts
src/
  worker.js        API for pages + admin, database setup, validation
  auth.js          admin sign-in: password, sessions, lockouts
  totp.js          6-digit authenticator codes (RFC 6238)
  access.js        optional: verifies Cloudflare Access sign-in tokens
wrangler.jsonc     Cloudflare settings
package.json       pins the deploy tool (wrangler) version
```

Nothing secret lives in this repository, so it can be public.
