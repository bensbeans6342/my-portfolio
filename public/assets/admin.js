// Admin dashboard. Every request goes to /admin/api/..., which the Worker
// only answers after confirming your Cloudflare Access sign-in.
(function () {
  const $ = (id) => document.getElementById(id);

  // ------------------------------------------------------------- helpers
  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function pad(n) {
    return String(n).padStart(2, "0");
  }
  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function fmtDate(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }
  function fmtTime(hhmm) {
    if (!hhmm) return "";
    const [h, m] = hhmm.split(":").map(Number);
    return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  function fmtDateTime(sqlUtc) {
    if (!sqlUtc) return "";
    const d = new Date(sqlUtc.replace(" ", "T") + "Z");
    return d.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
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
  function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
  }

  let toastTimer;
  function toast(text) {
    const el = $("toast");
    el.textContent = text;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (el.hidden = true), 2600);
  }

  function showSignInBanner() {
    const banner = $("banner");
    banner.innerHTML = `Your admin sign-in has expired. <a href="">Reload the page</a> to sign in again.`;
    banner.hidden = false;
  }

  async function adminApi(path, options = {}) {
    let res;
    try {
      res = await fetch(path, {
        ...options,
        redirect: "manual",
        credentials: "same-origin",
        headers: { accept: "application/json", "content-type": "application/json" },
      });
    } catch {
      throw new Error("Couldn't reach the server. Check your connection and try again.");
    }
    if (res.type === "opaqueredirect" || res.status === 401) {
      showSignInBanner();
      throw new Error("Your sign-in has expired. Reload the page to sign in again.");
    }
    let data = {};
    try {
      data = await res.json();
    } catch {
      /* not JSON */
    }
    if (!res.ok) throw new Error(data.error || `The server returned an error (${res.status}).`);
    return data;
  }

  // --------------------------------------------------- what can be edited
  const RESOURCES = {
    achievements: {
      title: "Achievements",
      singular: "achievement",
      empty: "No achievements yet. Add your first one.",
      fields: [
        { name: "title", label: "Title", type: "text", required: true, max: 200, placeholder: "Dean's List, Fall 2025" },
        {
          row: [
            { name: "date", label: "Date", type: "date" },
            { name: "category", label: "Category", type: "text", max: 60, placeholder: "Award, Research, Leadership", suggest: true },
          ],
        },
        { name: "description", label: "Description", type: "textarea", rows: 4, max: 2000 },
        { name: "link", label: "Link", type: "url", placeholder: "https://", hint: "Optional. A project page, article or certificate." },
        { name: "featured", label: "Highlight this on the home page", type: "checkbox" },
      ],
      defaults: () => ({ date: todayISO() }),
      itemTitle: (r) => r.title,
      itemMeta: (r) => [fmtDate(r.date), r.category, r.featured ? "Highlighted" : ""].filter(Boolean).join(", "),
    },
    posts: {
      title: "Blog posts",
      singular: "post",
      empty: "No posts yet. Write your first one.",
      fields: [
        { name: "title", label: "Title", type: "text", required: true, max: 200 },
        {
          row: [
            { name: "date", label: "Date", type: "date", required: true },
            { name: "slug", label: "Web address", type: "text", max: 80, hint: "Filled in from the title. Letters, numbers and dashes." },
          ],
        },
        { name: "summary", label: "Summary", type: "textarea", rows: 2, max: 400, hint: "One or two sentences shown in the list of posts." },
        { name: "body", label: "Post", type: "markdown", rows: 18, required: true, max: 100000 },
        { name: "published", label: "Published (uncheck to keep it as a private draft)", type: "checkbox" },
      ],
      defaults: () => ({ date: todayISO(), published: 1 }),
      itemTitle: (r) => r.title,
      itemMeta: (r) => [fmtDate(r.date), r.published ? "" : "Draft"].filter(Boolean).join(", "),
    },
    events: {
      title: "Calendar",
      singular: "event",
      empty: "No events yet. Add one to fill your calendar.",
      fields: [
        { name: "title", label: "Event", type: "text", required: true, max: 200, placeholder: "ACM regional programming contest" },
        {
          row: [
            { name: "date", label: "Date", type: "date", required: true },
            { name: "location", label: "Location", type: "text", max: 200 },
          ],
        },
        {
          row: [
            { name: "start_time", label: "Starts", type: "time", hint: "Leave both times empty for an all-day event." },
            { name: "end_time", label: "Ends", type: "time" },
          ],
        },
        { name: "description", label: "Description", type: "textarea", rows: 3, max: 2000 },
        { name: "link", label: "Link", type: "url", placeholder: "https://", hint: "Optional. RSVP form, event page or slides." },
      ],
      defaults: () => ({ date: todayISO() }),
      itemTitle: (r) => r.title,
      itemMeta: (r) => [fmtDate(r.date), r.start_time ? fmtTime(r.start_time) : "All day", r.location].filter(Boolean).join(", "),
      sort: (items) => {
        const today = todayISO();
        const upcoming = items.filter((e) => e.date >= today);
        const past = items.filter((e) => e.date < today).reverse();
        return [...upcoming, ...past];
      },
    },
    messages: {
      title: "Messages",
      singular: "message",
      empty: "No messages yet. They arrive here from your contact form.",
      readOnly: true,
      itemTitle: (r) => r.name,
      itemMeta: (r) => `${fmtDateTime(r.created_at)}, ${r.email}`,
    },
  };

  function flatFields(def) {
    return (def.fields || []).flatMap((f) => (f.row ? f.row : [f]));
  }

  // ---------------------------------------------------------------- state
  const state = {
    tab: "achievements",
    items: { achievements: [], posts: [], events: [], messages: [] },
    selected: null, // an id, "new", or null
    dirty: false,
    slugTouched: false,
    me: null,
  };
  const SIGNIN = "signin";

  function currentItems() {
    const def = RESOURCES[state.tab];
    const items = state.items[state.tab];
    return def.sort ? def.sort(items) : items;
  }

  function confirmDiscard() {
    if (!state.dirty) return true;
    if (!confirm("You have unsaved changes. Discard them?")) return false;
    state.dirty = false;
    return true;
  }

  function updateUnread() {
    const count = state.items.messages.filter((m) => !m.is_read).length;
    const badge = $("unread");
    badge.textContent = count;
    badge.hidden = count === 0;
    badge.setAttribute("aria-label", `${count} unread`);
  }

  // ----------------------------------------------------------- rendering
  function renderTabs() {
    document.querySelectorAll(".tab").forEach((tab) => {
      const active = tab.dataset.tab === state.tab;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    $("panel").setAttribute("aria-labelledby", `tab-${state.tab}`);
  }

  function renderList() {
    if (state.tab === SIGNIN) return;
    const def = RESOURCES[state.tab];
    $("list-title").textContent = def.title;
    const newBtn = $("new-btn");
    newBtn.hidden = !!def.readOnly;
    newBtn.textContent = `New ${def.singular}`;

    const items = currentItems();
    $("item-list").innerHTML = items.length
      ? items
          .map((item) => {
            const unread = state.tab === "messages" && !item.is_read;
            return `
            <li class="${unread ? "unread" : ""}">
              <button type="button" data-id="${item.id}" aria-current="${String(item.id) === String(state.selected)}">
                <span class="t">${esc(def.itemTitle(item))}</span>
                <span class="m">${esc(def.itemMeta(item))}</span>
              </button>
            </li>`;
          })
          .join("")
      : `<li class="empty muted">${esc(def.empty)}</li>`;
  }

  function renderPlaceholder() {
    const def = RESOURCES[state.tab];
    $("editor").innerHTML = def.readOnly
      ? `<p class="placeholder">Pick a message on the left to read it.</p>`
      : `<p class="placeholder">Pick an item on the left to edit it, or create a new ${esc(def.singular)}.</p>`;
  }

  function suggestions(fieldName) {
    return [...new Set(state.items[state.tab].map((i) => i[fieldName]).filter(Boolean))].sort();
  }

  function fieldHtml(f, value) {
    const id = `f-${f.name}`;
    const v = value == null ? "" : value;
    const required = f.required ? " required" : "";
    const max = f.max ? ` maxlength="${f.max}"` : "";
    const placeholder = f.placeholder ? ` placeholder="${esc(f.placeholder)}"` : "";
    const hint = f.hint ? `<span class="hint" id="${id}-hint">${esc(f.hint)}</span>` : "";
    const described = f.hint ? ` aria-describedby="${id}-hint"` : "";

    if (f.type === "checkbox") {
      return `<label class="check"><input type="checkbox" id="${id}" name="${f.name}"${v ? " checked" : ""}> ${esc(f.label)}</label>`;
    }
    if (f.type === "textarea") {
      return `<div class="field"><label for="${id}">${esc(f.label)}</label>
        <textarea id="${id}" name="${f.name}" rows="${f.rows || 4}"${required}${max}${described}>${esc(v)}</textarea>${hint}</div>`;
    }
    if (f.type === "markdown") {
      return `<div class="field">
        <div class="list-head">
          <label for="${id}">${esc(f.label)}</label>
          <div class="md-switch" role="group" aria-label="Editor view">
            <button type="button" data-md="write" aria-pressed="true">Write</button>
            <button type="button" data-md="preview" aria-pressed="false">Preview</button>
          </div>
        </div>
        <textarea id="${id}" name="${f.name}" rows="${f.rows || 16}"${required}${max} aria-describedby="${id}-help">${esc(v)}</textarea>
        <div class="md-preview prose" id="${id}-preview" hidden></div>
        <span class="md-help" id="${id}-help">Formatting: <code># Heading</code> <code>**bold**</code> <code>*italic*</code>
          <code>[link text](https://...)</code> <code>- list item</code> <code>&gt; quote</code></span>
      </div>`;
    }
    const list = f.suggest ? ` list="${id}-list"` : "";
    const datalist = f.suggest
      ? `<datalist id="${id}-list">${suggestions(f.name).map((s) => `<option value="${esc(s)}">`).join("")}</datalist>`
      : "";
    return `<div class="field"><label for="${id}">${esc(f.label)}</label>
      <input type="${f.type}" id="${id}" name="${f.name}" value="${esc(v)}"${required}${max}${placeholder}${list}${described}>${datalist}${hint}</div>`;
  }

  function renderEditor(item, isNew) {
    const def = RESOURCES[state.tab];
    const values = isNew ? def.defaults() : item;
    state.dirty = false;
    state.slugTouched = !isNew;

    const fields = def.fields
      .map((f) =>
        f.row ? `<div class="row-2">${f.row.map((r) => fieldHtml(r, values[r.name])).join("")}</div>` : fieldHtml(f, values[f.name]),
      )
      .join("");

    const viewLink =
      state.tab === "posts" && !isNew && item.published
        ? `<a class="btn btn-quiet" href="/blog/?p=${encodeURIComponent(item.slug)}" target="_blank" rel="noopener">View post</a>`
        : "";

    $("editor").innerHTML = `
      <h2>${isNew ? `New ${esc(def.singular)}` : `Edit ${esc(def.singular)}`}</h2>
      <form id="edit-form" novalidate>
        ${fields}
        <div class="actions">
          <button class="btn" type="submit">${isNew ? `Create ${esc(def.singular)}` : "Save changes"}</button>
          ${viewLink}
          <span class="spacer"></span>
          ${isNew ? "" : `<button class="btn btn-danger" type="button" id="delete-btn">Delete</button>`}
        </div>
        <p class="form-error" id="form-error" role="alert" hidden></p>
      </form>`;

    const form = $("edit-form");
    form.addEventListener("submit", save);
    form.addEventListener("input", (event) => {
      state.dirty = true;
      if (state.tab !== "posts") return;
      if (event.target.name === "slug") state.slugTouched = true;
      if (event.target.name === "title" && !state.slugTouched) {
        form.elements.slug.value = slugify(event.target.value);
      }
    });
    const del = $("delete-btn");
    if (del) del.addEventListener("click", remove);
    setupMarkdownSwitch(form);
  }

  function setupMarkdownSwitch(form) {
    const switcher = form.querySelector(".md-switch");
    if (!switcher) return;
    const textarea = form.elements.body;
    const preview = $("f-body-preview");
    switcher.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-md]");
      if (!button) return;
      const showPreview = button.dataset.md === "preview";
      switcher.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
      if (showPreview) {
        preview.innerHTML = textarea.value.trim()
          ? window.renderMarkdown(textarea.value)
          : `<p class="muted">Nothing to preview yet.</p>`;
      }
      preview.hidden = !showPreview;
      textarea.hidden = showPreview;
    });
  }

  function renderMessage(message) {
    const replyTo = String(message.email).replace(/[^\w.@+-]/g, "");
    $("editor").innerHTML = `
      <h2>Message from ${esc(message.name)}</h2>
      <div class="message-meta">
        <span><strong>Email:</strong> <a href="mailto:${esc(replyTo)}">${esc(message.email)}</a></span>
        <span><strong>Received:</strong> ${esc(fmtDateTime(message.created_at))}</span>
      </div>
      <p class="message-body">${esc(message.body)}</p>
      <div class="actions">
        <a class="btn" href="mailto:${esc(replyTo)}?subject=${encodeURIComponent("Re: your message")}">Reply by email</a>
        <button class="btn btn-quiet" type="button" id="toggle-read">${message.is_read ? "Mark as unread" : "Mark as read"}</button>
        <span class="spacer"></span>
        <button class="btn btn-danger" type="button" id="delete-btn">Delete</button>
      </div>
      <p class="form-error" id="form-error" role="alert" hidden></p>`;
    $("delete-btn").addEventListener("click", remove);
    $("toggle-read").addEventListener("click", () => setRead(message, !message.is_read));
  }

  function showFormError(text) {
    const el = $("form-error");
    if (!el) return alert(text);
    el.textContent = text;
    el.hidden = false;
  }

  // -------------------------------------------------------------- actions
  function upsert(item) {
    const list = state.items[state.tab];
    const index = list.findIndex((i) => i.id === item.id);
    if (index >= 0) list[index] = item;
    else list.unshift(item);
  }

  async function save(event) {
    event.preventDefault();
    const def = RESOURCES[state.tab];
    const form = event.target;
    const data = {};
    for (const f of flatFields(def)) {
      const el = form.elements[f.name];
      data[f.name] = f.type === "checkbox" ? el.checked : el.value;
    }
    for (const f of flatFields(def)) {
      if (f.required && !String(data[f.name]).trim()) {
        showFormError(`${f.label} is required.`);
        form.elements[f.name].hidden = false;
        form.elements[f.name].focus();
        return;
      }
    }

    const isNew = state.selected === "new";
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const { item } = await adminApi(
        isNew ? `/admin/api/${state.tab}` : `/admin/api/${state.tab}/${state.selected}`,
        { method: isNew ? "POST" : "PUT", body: JSON.stringify(data) },
      );
      upsert(item);
      state.selected = item.id;
      renderList();
      renderEditor(item, false);
      toast(isNew ? `${capitalize(def.singular)} created` : "Changes saved");
    } catch (err) {
      showFormError(err.message);
      button.disabled = false;
    }
  }

  async function remove() {
    const def = RESOURCES[state.tab];
    if (!confirm(`Delete this ${def.singular}? This can't be undone.`)) return;
    try {
      await adminApi(`/admin/api/${state.tab}/${state.selected}`, { method: "DELETE" });
      state.items[state.tab] = state.items[state.tab].filter((i) => String(i.id) !== String(state.selected));
      state.selected = null;
      state.dirty = false;
      renderList();
      renderPlaceholder();
      if (state.tab === "messages") updateUnread();
      toast(`${capitalize(def.singular)} deleted`);
    } catch (err) {
      showFormError(err.message);
    }
  }

  async function setRead(message, isRead, quiet) {
    try {
      const { item } = await adminApi(`/admin/api/messages/${message.id}`, {
        method: "PUT",
        body: JSON.stringify({ is_read: isRead }),
      });
      upsert(item);
      updateUnread();
      renderList();
      if (String(state.selected) === String(item.id)) renderMessage(item);
      if (!quiet) toast(isRead ? "Marked as read" : "Marked as unread");
    } catch (err) {
      if (!quiet) showFormError(err.message);
    }
  }

  function openItem(id) {
    if (String(id) === String(state.selected)) return;
    if (!confirmDiscard()) return;
    const item = state.items[state.tab].find((i) => String(i.id) === String(id));
    if (!item) return;
    state.selected = item.id;
    renderList();
    if (state.tab === "messages") {
      renderMessage(item);
      if (!item.is_read) setRead(item, true, true);
    } else {
      renderEditor(item, false);
    }
    if (window.matchMedia("(max-width: 880px)").matches) {
      $("editor").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function openNew() {
    if (!confirmDiscard()) return;
    state.selected = "new";
    renderList();
    renderEditor(null, true);
    const first = $("edit-form").querySelector("input, textarea");
    if (first) first.focus();
  }

  function showTab() {
    renderTabs();
    const single = state.tab === SIGNIN;
    $("panel").classList.toggle("single", single);
    if (single) {
      renderSignin();
    } else {
      renderList();
      renderPlaceholder();
    }
  }

  function selectTab(tab) {
    if ((!RESOURCES[tab] && tab !== SIGNIN) || tab === state.tab) return;
    if (!confirmDiscard()) return;
    state.tab = tab;
    state.selected = null;
    history.replaceState(null, "", `#${tab}`);
    showTab();
  }

  // ------------------------------------------------- two-step sign-in tab
  const KEY_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

  function newSetupKey() {
    const bytes = crypto.getRandomValues(new Uint8Array(20)); // 160 random bits
    let bits = 0;
    let value = 0;
    let out = "";
    for (const b of bytes) {
      value = ((value << 8) | b) & 0xffff;
      bits += 8;
      while (bits >= 5) {
        out += KEY_ALPHABET[(value >>> (bits - 5)) & 31];
        bits -= 5;
      }
    }
    return out;
  }

  function pendingKey(create) {
    let key = "";
    try {
      key = sessionStorage.getItem("pendingSetupKey") || "";
    } catch {
      /* storage unavailable */
    }
    if (!key && create) {
      key = newSetupKey();
      try {
        sessionStorage.setItem("pendingSetupKey", key);
      } catch {
        /* storage unavailable: the key lives until you leave the page */
      }
    }
    return key;
  }

  function forgetPendingKey() {
    try {
      sessionStorage.removeItem("pendingSetupKey");
    } catch {
      /* storage unavailable */
    }
  }

  function grouped(key) {
    return key.match(/.{1,4}/g).join(" ");
  }

  function codeForm(id, buttonLabel) {
    return `
      <form class="code-form" id="${id}" novalidate>
        <div class="field">
          <label for="${id}-code">6-digit code from your app</label>
          <input type="text" id="${id}-code" inputmode="numeric" autocomplete="one-time-code" maxlength="7" required>
        </div>
        <button class="btn" type="submit">${buttonLabel}</button>
      </form>
      <p class="form-status" id="${id}-status" role="status" aria-live="polite"></p>`;
  }

  function setStatus(id, text, kind) {
    const el = $(`${id}-status`);
    el.textContent = text;
    el.className = `form-status ${kind || ""}`;
  }

  function renderSignin() {
    const editor = $("editor");
    const totp = state.me && state.me.totp;
    const lostPhone = `
      <h3>If you lose your phone</h3>
      <p>In Cloudflare, open <b>Workers &amp; Pages</b>, then your Worker, then
      <b>Settings &gt; Variables and Secrets</b>, and delete <code>TOTP_SECRET</code>. You can then sign in
      with just your password and set up two-step sign-in again here.</p>`;

    if (totp === "on") {
      forgetPendingKey();
      editor.innerHTML = `
        <div class="signin-panel">
          <h2>Two-step sign-in is on</h2>
          <p>Signing in needs your password and the 6-digit code from your authenticator app.
          Test a code to confirm the key saved in Cloudflare matches your app.</p>
          ${codeForm("test", "Test code")}
          ${lostPhone}
        </div>`;
      $("test").addEventListener("submit", async (event) => {
        event.preventDefault();
        setStatus("test", "Checking…");
        try {
          await adminApi("/admin/api/2fa/test", { method: "POST", body: JSON.stringify({ code: $("test-code").value }) });
          setStatus("test", "Code accepted. The key in Cloudflare matches your app.", "ok");
        } catch (err) {
          setStatus("test", err.message, "error");
        }
      });
      return;
    }

    const key = pendingKey(true);
    const uri = `otpauth://totp/${encodeURIComponent(`Portfolio admin:${location.hostname}`)}?secret=${key}&issuer=${encodeURIComponent("Portfolio admin")}`;
    let qr = "";
    try {
      qr = window.QR.svg(uri, "QR code for your setup key");
    } catch {
      qr = ""; // the typed key below always works
    }

    editor.innerHTML = `
      <div class="signin-panel">
        ${
          totp === "invalid"
            ? `<p class="form-error">The <code>TOTP_SECRET</code> saved in Cloudflare isn't a valid setup key, so new
               sign-ins are paused. Replace it with the key below (after step 2), or delete it.</p>`
            : ""
        }
        <h2>Turn on two-step sign-in</h2>
        <p>After this, signing in needs your password and a 6-digit code from an authenticator app on your
        phone, such as Google Authenticator, Microsoft Authenticator or 1Password.</p>
        <ol class="steps">
          <li>
            <h3>Add this key to your authenticator app</h3>
            <p>In the app, tap <b>+</b> and scan the code. Or choose <b>Enter a setup key</b>, type the key, and pick
            <b>Time based</b> if asked.</p>
            <div class="key-row">
              ${qr ? `<div class="qr">${qr}</div>` : ""}
              <div>
                <p class="key" id="setup-key">${esc(grouped(key))}</p>
                <div class="actions">
                  <button class="btn btn-quiet btn-small" type="button" id="copy-key">Copy key</button>
                  <button class="btn btn-quiet btn-small" type="button" id="new-key">Make a new key</button>
                </div>
                <p class="hint">Treat this key like a password: anyone who has it can make your codes.</p>
              </div>
            </div>
          </li>
          <li>
            <h3>Check that your app works</h3>
            ${codeForm("check", "Check code")}
          </li>
          <li class="step-save" id="step-save" hidden>
            <h3>Save the key in Cloudflare</h3>
            <p>Open <b>Workers &amp; Pages</b>, then your Worker, then <b>Settings &gt; Variables and Secrets</b>,
            and click <b>Add</b>. Set the type to <b>Secret</b>, the name to <code>TOTP_SECRET</code>, and paste the
            key as the value. Click <b>Deploy</b>, wait a minute, then reload this page and test a code before
            you sign out.</p>
            <div class="actions">
              <button class="btn btn-quiet btn-small" type="button" id="copy-key-2">Copy key</button>
              <button class="btn btn-small" type="button" id="reload">Reload after saving</button>
            </div>
          </li>
        </ol>
        ${lostPhone}
      </div>`;

    const copy = async () => {
      try {
        await navigator.clipboard.writeText(key);
        toast("Key copied");
      } catch {
        toast("Select the key and copy it by hand");
      }
    };
    $("copy-key").addEventListener("click", copy);
    $("copy-key-2").addEventListener("click", copy);
    $("new-key").addEventListener("click", () => {
      if (!confirm("Make a new key? Remove the old one from your app and add the new one.")) return;
      forgetPendingKey();
      renderSignin();
    });
    $("reload").addEventListener("click", () => location.reload());
    $("check").addEventListener("submit", async (event) => {
      event.preventDefault();
      setStatus("check", "Checking…");
      try {
        await adminApi("/admin/api/2fa/check", {
          method: "POST",
          body: JSON.stringify({ key, code: $("check-code").value }),
        });
        setStatus("check", "It works. Now save the key in Cloudflare.", "ok");
        $("step-save").hidden = false;
      } catch (err) {
        setStatus("check", err.message, "error");
      }
    });
  }

  function renderNotice() {
    const notice = $("notice");
    const me = state.me;
    if (!me || me.mode !== "password" || me.totp === "on") {
      notice.hidden = true;
      return;
    }
    notice.innerHTML =
      me.totp === "invalid"
        ? `The two-step sign-in key saved in Cloudflare isn't valid, so new sign-ins are paused. <a href="#signin" data-go="signin">Fix it</a>`
        : `Two-step sign-in is off. <a href="#signin" data-go="signin">Turn it on</a> so your password alone can't open the admin.`;
    notice.hidden = false;
  }

  // --------------------------------------------------------------- events
  document.querySelector(".tabs").addEventListener("click", (event) => {
    const tab = event.target.closest(".tab");
    if (tab) selectTab(tab.dataset.tab);
  });
  document.querySelector(".tabs").addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
    const tabs = [...document.querySelectorAll(".tab")].filter((t) => !t.hidden);
    const index = tabs.findIndex((t) => t.dataset.tab === state.tab);
    const next = tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    selectTab(next.dataset.tab);
    next.focus();
  });
  $("item-list").addEventListener("click", (event) => {
    const button = event.target.closest("button[data-id]");
    if (button) openItem(button.dataset.id);
  });
  $("new-btn").addEventListener("click", openNew);
  window.addEventListener("beforeunload", (event) => {
    if (state.dirty) {
      event.preventDefault();
      event.returnValue = "";
    }
  });

  $("notice").addEventListener("click", (event) => {
    const link = event.target.closest("[data-go]");
    if (!link) return;
    event.preventDefault();
    selectTab(link.dataset.go);
  });

  // ---------------------------------------------------------------- start
  const fromHash = location.hash.replace("#", "");
  if (RESOURCES[fromHash]) state.tab = fromHash;
  showTab();

  adminApi("/admin/api/me")
    .then((me) => {
      state.me = me;
      $("whoami").textContent = me.email ? `Signed in as ${me.email}` : "Signed in";
      $("tab-signin").hidden = me.mode !== "password";
      renderNotice();
      if (fromHash === SIGNIN && me.mode === "password") {
        state.tab = SIGNIN;
        showTab();
      }
    })
    .catch(() => {});

  Promise.all(
    Object.keys(RESOURCES).map((name) =>
      adminApi(`/admin/api/${name}`).then((data) => {
        state.items[name] = data.items || [];
      }),
    ),
  )
    .then(() => {
      updateUnread();
      renderList();
    })
    .catch((err) => {
      const banner = $("banner");
      if (banner.hidden) {
        banner.textContent = err.message;
        banner.hidden = false;
      }
    });
})();
