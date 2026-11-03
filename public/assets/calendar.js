(function () {
  const { esc, api, fmtDate, fmtTime, safeUrl, parseDate, toISO, todayISO, config: S } = window.Site;

  document.getElementById("cal-intro").textContent = S.calendarIntro || "";

  const grid = document.getElementById("cal-grid");
  const monthTitle = document.getElementById("month-title");
  const statusEl = document.getElementById("cal-status");
  const today = todayISO();

  const params = new URLSearchParams(location.search);
  const requested = /^\d{4}-\d{2}-\d{2}$/.test(params.get("d") || "") ? params.get("d") : today;
  let selected = requested;
  let view = parseDate(requested);
  view.setDate(1);

  let byDate = new Map();
  let events = [];

  function timeRange(e) {
    if (!e.start_time) return "All day";
    return e.end_time ? `${fmtTime(e.start_time)} – ${fmtTime(e.end_time)}` : fmtTime(e.start_time);
  }

  function eventHtml(e, showDate) {
    const link = safeUrl(e.link);
    const when = showDate
      ? `${fmtDate(e.date, { weekday: "short", month: "short", day: "numeric" })}, ${timeRange(e)}`
      : timeRange(e);
    return `
      <div class="event-item">
        <div class="when">${esc(when)}${e.location ? `, ${esc(e.location)}` : ""}</div>
        <div class="what">${esc(e.title)}</div>
        ${e.description ? `<p>${esc(e.description)}</p>` : ""}
        ${link ? `<a href="${esc(link)}" target="_blank" rel="noopener">Details<span class="visually-hidden"> for ${esc(e.title)}</span></a>` : ""}
      </div>`;
  }

  function renderMonth() {
    const year = view.getFullYear();
    const month = view.getMonth();
    monthTitle.textContent = view.toLocaleDateString(undefined, { month: "long", year: "numeric" });

    const start = new Date(year, month, 1);
    start.setDate(1 - start.getDay()); // back up to Sunday
    const end = new Date(year, month + 1, 0);
    end.setDate(end.getDate() + (6 - end.getDay())); // forward to Saturday

    const dayNames = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(2026, 1, 1 + i); // Feb 1, 2026 is a Sunday
      dayNames.push(d.toLocaleDateString(undefined, { weekday: "short" }));
    }

    let html = dayNames.map((n) => `<div class="cal-dow" aria-hidden="true">${esc(n)}</div>`).join("");
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const iso = toISO(d);
      const dayEvents = byDate.get(iso) || [];
      const classes = ["cal-day"];
      if (d.getMonth() !== month) classes.push("outside");
      if (iso === today) classes.push("today");
      const label = `${d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}${
        dayEvents.length ? `, ${dayEvents.length} event${dayEvents.length > 1 ? "s" : ""}` : ""
      }`;
      const chips = dayEvents
        .slice(0, 3)
        .map((e) => `<span class="cal-chip">${esc(e.title)}</span>`)
        .join("");
      const more = dayEvents.length > 3 ? `<span class="cal-chip">+${dayEvents.length - 3} more</span>` : "";
      html += `
        <button type="button" class="${classes.join(" ")}" data-date="${iso}"
                aria-pressed="${iso === selected}" aria-label="${esc(label)}">
          <span class="cal-num" aria-hidden="true">${d.getDate()}</span>
          ${chips}${more}
          ${dayEvents.length ? '<span class="cal-dot" aria-hidden="true"></span>' : ""}
        </button>`;
    }
    grid.innerHTML = html;
  }

  function renderDay() {
    document.getElementById("day-title").textContent = fmtDate(selected, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    const dayEvents = byDate.get(selected) || [];
    document.getElementById("day-events").innerHTML = dayEvents.length
      ? dayEvents.map((e) => eventHtml(e, false)).join("")
      : `<p class="empty">Nothing scheduled.</p>`;
  }

  function renderUpcoming() {
    const upcoming = events.filter((e) => e.date >= today).slice(0, 6);
    document.getElementById("upcoming-events").innerHTML = upcoming.length
      ? upcoming.map((e) => eventHtml(e, true)).join("")
      : `<p class="empty">Nothing coming up yet.</p>`;
  }

  function renderAll() {
    renderMonth();
    renderDay();
    renderUpcoming();
  }

  grid.addEventListener("click", (event) => {
    const cell = event.target.closest("button[data-date]");
    if (!cell) return;
    selected = cell.dataset.date;
    const picked = parseDate(selected);
    if (picked.getMonth() !== view.getMonth() || picked.getFullYear() !== view.getFullYear()) {
      view = new Date(picked.getFullYear(), picked.getMonth(), 1);
    }
    renderMonth();
    renderDay();
    const again = grid.querySelector(`button[data-date="${selected}"]`);
    if (again) again.focus();
  });

  document.getElementById("prev").addEventListener("click", () => {
    view = new Date(view.getFullYear(), view.getMonth() - 1, 1);
    renderMonth();
  });
  document.getElementById("next").addEventListener("click", () => {
    view = new Date(view.getFullYear(), view.getMonth() + 1, 1);
    renderMonth();
  });
  document.getElementById("today").addEventListener("click", () => {
    selected = today;
    view = parseDate(today);
    view.setDate(1);
    renderAll();
  });

  renderAll();

  api("/api/events")
    .then((data) => {
      events = data.events || [];
      byDate = new Map();
      for (const e of events) {
        if (!byDate.has(e.date)) byDate.set(e.date, []);
        byDate.get(e.date).push(e);
      }
      renderAll();
    })
    .catch((err) => {
      statusEl.hidden = false;
      statusEl.className = "notice error";
      statusEl.textContent = err.message;
    });
})();
