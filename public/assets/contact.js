(function () {
  const { esc, api, safeUrl, config: S } = window.Site;

  function entryHtml(title, subtitle, dates, details) {
    return `
      <div class="resume-entry">
        <div class="role">${esc(title)}</div>
        <div class="dates">${esc(dates || "")}</div>
        ${subtitle ? `<div class="org">${esc(subtitle)}</div>` : ""}
        ${details ? `<p>${esc(details)}</p>` : ""}
      </div>`;
  }

  document.getElementById("education").innerHTML =
    (S.education || []).map((e) => entryHtml(e.school, e.degree, e.dates, e.details)).join("") ||
    `<p class="empty">Add your education in config.js.</p>`;

  document.getElementById("experience").innerHTML =
    (S.experience || []).map((e) => entryHtml(e.role, e.org, e.dates, e.details)).join("") ||
    `<p class="empty">Add your experience in config.js.</p>`;

  document.getElementById("skills").innerHTML = (S.skills || [])
    .map((skill) => `<li>${esc(skill)}</li>`)
    .join("");

  const resumeUrl = safeUrl(S.resumePdf);
  const resumeLink = document.getElementById("resume-link");
  if (resumeUrl) resumeLink.href = resumeUrl;
  else resumeLink.hidden = true;

  const lines = [];
  if (S.email) {
    lines.push(
      `<li><span class="label">Email</span><a href="mailto:${esc(S.email)}">${esc(S.email)}</a></li>`,
    );
  }
  for (const link of S.links || []) {
    const url = safeUrl(link.url);
    if (url) {
      const shown = url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
      lines.push(
        `<li><span class="label">${esc(link.label)}</span><a href="${esc(url)}" rel="noopener">${esc(shown)}</a></li>`,
      );
    }
  }
  if (S.location) lines.push(`<li><span class="label">Based in</span>${esc(S.location)}</li>`);
  document.getElementById("contact-lines").innerHTML = lines.join("");

  // ------------------------------------------------------------ the form
  const form = document.getElementById("contact-form");
  const status = document.getElementById("form-status");
  const button = form.querySelector('button[type="submit"]');

  function setStatus(text, kind) {
    status.textContent = text;
    status.className = `form-status ${kind || ""}`;
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form));

    if (!data.name.trim()) return setStatus("Add your name.", "error");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())) {
      return setStatus("Add a valid email address so I can reply.", "error");
    }
    if (data.message.trim().length < 10) {
      return setStatus("Write a slightly longer message (at least 10 characters).", "error");
    }

    button.disabled = true;
    setStatus("Sending…");
    try {
      await api("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(data),
      });
      form.reset();
      setStatus("Message sent. I'll reply by email.", "ok");
    } catch (err) {
      setStatus(err.message, "error");
    } finally {
      button.disabled = false;
    }
  });
})();
