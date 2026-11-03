// Shared code for every public page: header, footer and small helpers.
(function () {
  const S = window.SITE || {};

  const NAV = [
    { href: "/", label: "Home" },
    { href: "/contact/", label: "Resume & contact" },
    { href: "/calendar/", label: "Calendar" },
    { href: "/blog/", label: "Blog" },
  ];

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Only allow normal web, email and site-relative links.
  function safeUrl(url) {
    const value = String(url || "").trim();
    if (!value) return "";
    if (value.startsWith("/") && !value.startsWith("//")) return value;
    try {
      const parsed = new URL(value);
      return ["http:", "https:", "mailto:"].includes(parsed.protocol) ? parsed.href : "";
    } catch {
      return "";
    }
  }

  function parseDate(iso) {
    const [y, m, d] = String(iso).split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }

  function fmtDate(iso, options) {
    if (!iso) return "";
    return parseDate(iso).toLocaleDateString(
      undefined,
      options || { year: "numeric", month: "short", day: "numeric" },
    );
  }

  function fmtTime(hhmm) {
    if (!hhmm) return "";
    const [h, m] = hhmm.split(":").map(Number);
    return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
    });
  }

  function toISO(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function todayISO() {
    return toISO(new Date());
  }

  async function api(path, options) {
    let res;
    try {
      res = await fetch(path, { headers: { accept: "application/json" }, ...options });
    } catch {
      throw new Error("Couldn't reach the server. Check your connection and reload the page.");
    }
    let data = {};
    try {
      data = await res.json();
    } catch {
      /* no JSON body */
    }
    if (!res.ok) throw new Error(data.error || `The server returned an error (${res.status}).`);
    return data;
  }

  function isCurrent(href) {
    const path = location.pathname;
    if (href === "/") return path === "/" || path === "/index.html";
    return path === href || path === href.slice(0, -1) || path.startsWith(href);
  }

  function renderChrome() {
    const header = document.getElementById("site-header");
    if (header) {
      header.innerHTML = `
        <div class="wrap">
          <a class="brand" href="/">${esc(S.name || "Home")}</a>
          <nav class="site-nav" aria-label="Main">
            <ul>
              ${NAV.map(
                (item) => `<li><a href="${item.href}"${
                  isCurrent(item.href) ? ' aria-current="page"' : ""
                }><span>${esc(item.label)}</span></a></li>`,
              ).join("")}
            </ul>
          </nav>
        </div>`;
    }

    const footer = document.getElementById("site-footer");
    if (footer) {
      const links = (S.links || [])
        .map((link) => ({ label: link.label, url: safeUrl(link.url) }))
        .filter((link) => link.url);
      if (S.email) links.unshift({ label: "Email", url: `mailto:${S.email}` });
      footer.innerHTML = `
        <div class="wrap">
          <span>© ${new Date().getFullYear()} ${esc(S.name || "")}</span>
          <ul>${links
            .map((link) => `<li><a href="${esc(link.url)}" rel="noopener">${esc(link.label)}</a></li>`)
            .join("")}</ul>
        </div>`;
    }

    const pageTitle = document.title;
    if (S.name) {
      document.title = pageTitle && pageTitle !== "Home" ? `${pageTitle} | ${S.name}` : S.name;
    }
    if (S.headline && !document.querySelector('meta[name="description"]')) {
      const meta = document.createElement("meta");
      meta.name = "description";
      meta.content = S.headline;
      document.head.appendChild(meta);
    }
  }

  window.Site = { config: S, esc, safeUrl, parseDate, fmtDate, fmtTime, toISO, todayISO, api };
  renderChrome();
})();
