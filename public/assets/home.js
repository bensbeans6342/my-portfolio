(function () {
  const { esc, api, fmtDate, fmtTime, safeUrl, todayISO, config: S } = window.Site;

  document.getElementById("hero-name").textContent = S.name || "";
  document.getElementById("hero-headline").textContent = S.headline || "";
  document.getElementById("hero-bio").textContent = S.bio || "";

  // ---------------------------------------------------------- achievements
  const list = document.getElementById("ach-list");
  const filters = document.getElementById("ach-filters");
  const note = document.getElementById("ach-note");
  let all = [];
  let active = "All";
  let firstRender = true;

  function achievementHtml(a, featuredIndex) {
    const link = safeUrl(a.link);
    const title = a.featured ? `<span class="hl">${esc(a.title)}</span>` : esc(a.title);
    const date = a.date
      ? `<time datetime="${esc(a.date)}">${esc(fmtDate(a.date, { month: "long", year: "numeric" }))}</time>`
      : "";
    const tag = a.category ? `<span class="tag">${esc(a.category)}</span>` : "";
    return `
      <article class="achievement${a.featured ? " featured" : ""}" style="--i:${featuredIndex}">
        <h3>${title}</h3>
        ${date || tag ? `<div class="meta">${date}${tag}</div>` : ""}
        ${a.description ? `<p>${esc(a.description)}</p>` : ""}
        ${
          link
            ? `<a class="link" href="${esc(link)}" target="_blank" rel="noopener">Learn more<span class="visually-hidden"> about ${esc(a.title)}</span></a>`
            : ""
        }
      </article>`;
  }

  function renderAchievements() {
    const items = active === "All" ? all : all.filter((a) => a.category === active);
    if (!items.length) {
      list.innerHTML = `<p class="empty">Nothing here yet.</p>`;
      return;
    }
    const groups = new Map();
    for (const a of items) {
      const year = a.date ? a.date.slice(0, 4) : "Other";
      if (!groups.has(year)) groups.set(year, []);
      groups.get(year).push(a);
    }
    let featuredIndex = 0;
    list.innerHTML = [...groups]
      .map(
        ([year, entries]) => `
        <div class="year-group">
          <div class="year-label"><span>${esc(year)}</span></div>
          <div class="year-items">
            ${entries.map((a) => achievementHtml(a, a.featured ? featuredIndex++ : 0)).join("")}
          </div>
        </div>`,
      )
      .join("");
    if (!firstRender) list.classList.add("settled");
    firstRender = false;
  }

  function renderFilters() {
    const categories = [...new Set(all.map((a) => a.category).filter(Boolean))].sort();
    if (categories.length < 2) {
      filters.innerHTML = "";
      return;
    }
    filters.innerHTML = ["All", ...categories]
      .map(
        (c) =>
          `<button type="button" class="chip" data-cat="${esc(c)}" aria-pressed="${c === active}">${esc(c)}</button>`,
      )
      .join("");
  }

  filters.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-cat]");
    if (!button) return;
    active = button.dataset.cat;
    renderFilters();
    renderAchievements();
  });

  // ------------------------------------------------------ posts and events
  function renderPosts(posts) {
    const target = document.getElementById("recent-posts");
    if (!posts.length) {
      target.innerHTML = `<li class="empty">No posts yet.</li>`;
      return;
    }
    target.innerHTML = posts
      .slice(0, 3)
      .map(
        (p) => `
        <li>
          <a class="title" href="/blog/?p=${encodeURIComponent(p.slug)}">${esc(p.title)}</a>
          <div class="sub"><time datetime="${esc(p.date)}">${esc(fmtDate(p.date))}</time></div>
        </li>`,
      )
      .join("");
  }

  function renderEvents(events) {
    const target = document.getElementById("upcoming");
    if (!events.length) {
      target.innerHTML = `<li class="empty">Nothing scheduled right now.</li>`;
      return;
    }
    target.innerHTML = events
      .slice(0, 4)
      .map((e) => {
        const day = fmtDate(e.date, { weekday: "short", month: "short", day: "numeric" });
        const time = e.start_time ? ` at ${fmtTime(e.start_time)}` : "";
        const where = e.location ? `, ${e.location}` : "";
        return `
          <li>
            <a class="title" href="/calendar/?d=${esc(e.date)}">${esc(e.title)}</a>
            <div class="sub">${esc(day + time + where)}</div>
          </li>`;
      })
      .join("");
  }

  function showError(id, message, asListItem) {
    const target = document.getElementById(id);
    target.innerHTML = asListItem
      ? `<li class="notice error">${esc(message)}</li>`
      : `<p class="notice error">${esc(message)}</p>`;
  }

  Promise.allSettled([
    api("/api/achievements"),
    api("/api/posts"),
    api(`/api/events?from=${todayISO()}`),
  ]).then(([achievements, posts, events]) => {
    if (achievements.status === "fulfilled") {
      all = achievements.value.achievements || [];
      note.hidden = !all.some((a) => a.featured);
      renderFilters();
      renderAchievements();
    } else {
      showError("ach-list", achievements.reason.message);
    }

    if (posts.status === "fulfilled") renderPosts(posts.value.posts || []);
    else showError("recent-posts", posts.reason.message, true);

    if (events.status === "fulfilled") renderEvents(events.value.events || []);
    else showError("upcoming", events.reason.message, true);
  });
})();
