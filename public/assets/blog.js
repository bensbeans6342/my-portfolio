(function () {
  const { esc, api, fmtDate, config: S } = window.Site;
  const slug = new URLSearchParams(location.search).get("p");

  async function showList() {
    const list = document.getElementById("post-list");
    try {
      const { posts } = await api("/api/posts");
      if (!posts.length) {
        list.innerHTML = `<li class="empty">No posts yet.</li>`;
        return;
      }
      list.innerHTML = posts
        .map(
          (p) => `
          <li>
            <time datetime="${esc(p.date)}">${esc(fmtDate(p.date))}</time>
            <div>
              <a href="/blog/?p=${encodeURIComponent(p.slug)}">${esc(p.title)}</a>
              ${p.summary ? `<p>${esc(p.summary)}</p>` : ""}
            </div>
          </li>`,
        )
        .join("");
    } catch (err) {
      list.innerHTML = `<li class="notice error">${esc(err.message)}</li>`;
    }
  }

  async function showPost() {
    document.getElementById("list-view").hidden = true;
    const view = document.getElementById("post-view");
    view.hidden = false;
    const title = document.getElementById("post-title");
    const body = document.getElementById("post-body");
    title.textContent = "Loading…";

    try {
      const { post } = await api(`/api/posts/${encodeURIComponent(slug)}`);
      title.textContent = post.title;
      document.title = S.name ? `${post.title} | ${S.name}` : post.title;
      const date = document.getElementById("post-date");
      date.innerHTML = `<time datetime="${esc(post.date)}">${esc(
        fmtDate(post.date, { year: "numeric", month: "long", day: "numeric" }),
      )}</time>`;
      body.innerHTML = window.renderMarkdown(post.body);
      if (post.summary) {
        const meta = document.createElement("meta");
        meta.name = "description";
        meta.content = post.summary;
        document.head.appendChild(meta);
      }
    } catch (err) {
      title.textContent = "Post not found";
      body.innerHTML = `<p>${esc(err.message)}</p><p><a href="/blog/">See all posts</a></p>`;
    }
  }

  if (slug) showPost();
  else showList();
})();
