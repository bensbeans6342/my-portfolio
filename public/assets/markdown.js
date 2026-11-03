// A small Markdown renderer for blog posts. It escapes all text first and
// only ever creates a fixed set of tags, so post content can't inject
// scripts. Supports: # headings, paragraphs, **bold**, *italic*, `code`,
// ``` code blocks, [links](https://...), ![images](https://...),
// - bullet lists, 1. numbered lists, > quotes and --- dividers.
(function () {
  function esc(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function unesc(value) {
    return value
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, "&");
  }

  // Returns an attribute-safe URL, or "" if the link isn't allowed.
  function safeLink(escapedUrl, imageOnly) {
    const raw = unesc(escapedUrl).trim();
    if (!imageOnly && (raw.startsWith("#") || (raw.startsWith("/") && !raw.startsWith("//")))) {
      return esc(raw);
    }
    if (imageOnly && raw.startsWith("/") && !raw.startsWith("//")) return esc(raw);
    try {
      const url = new URL(raw);
      const allowed = imageOnly ? ["https:", "http:"] : ["https:", "http:", "mailto:"];
      return allowed.includes(url.protocol) ? esc(url.href) : "";
    } catch {
      return "";
    }
  }

  function inline(text) {
    const codes = [];
    let s = text.replace(/`([^`\n]+)`/g, (_, code) => {
      codes.push(code);
      return `\u0000${codes.length - 1}\u0000`;
    });
    s = esc(s);
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (_, alt, url) => {
      const src = safeLink(url, true);
      return src ? `<img src="${src}" alt="${alt}" loading="lazy">` : alt;
    });
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, label, url) => {
      const href = safeLink(url, false);
      return href ? `<a href="${href}" rel="noopener">${label}</a>` : label;
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*\w])\*([^*\s](?:[^*]*[^*\s])?)\*(?![*\w])/g, "$1<em>$2</em>");
    s = s.replace(/(^|[^_\w])_([^_\s](?:[^_]*[^_\s])?)_(?![_\w])/g, "$1<em>$2</em>");
    s = s.replace(/ {2,}\n/g, "<br>");
    s = s.replace(/\u0000(\d+)\u0000/g, (_, n) => `<code>${esc(codes[Number(n)])}</code>`);
    return s;
  }

  const BLOCK_START = /^(#{1,4}\s|```|>|\s*[-*+]\s+|\s*\d+[.)]\s+|(?:[-*_]\s*){3,}$)/;

  function render(source) {
    const lines = String(source || "").replace(/\r\n?/g, "\n").split("\n");
    const out = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];

      if (/^```/.test(line)) {
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
        i++; // closing fence
        out.push(`<pre><code>${esc(buf.join("\n"))}</code></pre>`);
        continue;
      }

      if (/^\s*$/.test(line)) {
        i++;
        continue;
      }

      const heading = line.match(/^(#{1,4})\s+(.*)$/);
      if (heading) {
        // "#" becomes <h2> because the post title is already the page's <h1>.
        const level = Math.min(heading[1].length + 1, 4);
        out.push(`<h${level}>${inline(heading[2].trim())}</h${level}>`);
        i++;
        continue;
      }

      if (/^(?:[-*_]\s*){3,}$/.test(line.trim())) {
        out.push("<hr>");
        i++;
        continue;
      }

      if (/^>\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ""));
        out.push(`<blockquote>${render(buf.join("\n"))}</blockquote>`);
        continue;
      }

      const ordered = /^\s*\d+[.)]\s+/.test(line);
      if (ordered || /^\s*[-*+]\s+/.test(line)) {
        const marker = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/;
        const items = [];
        while (i < lines.length && marker.test(lines[i])) {
          let text = lines[i++].replace(marker, "");
          while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !marker.test(lines[i])) {
            text += " " + lines[i++].trim();
          }
          items.push(`<li>${inline(text)}</li>`);
        }
        out.push(ordered ? `<ol>${items.join("")}</ol>` : `<ul>${items.join("")}</ul>`);
        continue;
      }

      const buf = [line];
      i++;
      while (i < lines.length && !/^\s*$/.test(lines[i]) && !BLOCK_START.test(lines[i])) {
        buf.push(lines[i++]);
      }
      out.push(`<p>${inline(buf.join("\n")).replace(/\n/g, " ")}</p>`);
    }

    return out.join("\n");
  }

  window.renderMarkdown = render;
})();
