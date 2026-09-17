/** Ported near-verbatim from public/index.html's inline script. Pure string -> string helpers. */

export function escapeHtml(s: string): string {
  return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] as string);
}

const CODE_PLACEHOLDER = "";

// Render a safe subset of markdown. Input is HTML-escaped first, so the only tags in the
// output are the fixed set introduced here -- no HTML from the model reaches the DOM.
export function renderInline(text: string): string {
  // Pull inline code out first, behind a placeholder delimited by a private-use character, so
  // ** / * / _ inside a code span are never mistaken for emphasis markers; restore it as <code> last.
  const codes: string[] = [];
  const open = new RegExp("`([^`]+)`", "g");
  text = text.replace(open, (_match, c: string) => `${CODE_PLACEHOLDER}${codes.push(c) - 1}${CODE_PLACEHOLDER}`);
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  text = text.replace(/(^|[^\w])_([^_\n]+)_/g, "$1<em>$2</em>");
  const close = new RegExp(`${CODE_PLACEHOLDER}(\\d+)${CODE_PLACEHOLDER}`, "g");
  text = text.replace(close, (_match, i: string) => `<code>${codes[Number(i)]}</code>`);
  return text;
}

export function renderMarkdown(md: string): string {
  const lines = escapeHtml(md).split("\n");
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  let para: string[] = [];
  const closeList = () => {
    if (list) {
      out.push(`</${list}>`);
      list = null;
    }
  };
  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${para.map(renderInline).join("<br>")}</p>`);
      para = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushPara();
      closeList();
      continue;
    }
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    const ul = /^[-*]\s+(.*)$/.exec(line);
    const ol = /^\d+\.\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      closeList();
      out.push(`<p><strong>${renderInline(h[1])}</strong></p>`);
    } else if (ul) {
      flushPara();
      if (list !== "ul") {
        closeList();
        out.push("<ul>");
        list = "ul";
      }
      out.push(`<li>${renderInline(ul[1])}</li>`);
    } else if (ol) {
      flushPara();
      if (list !== "ol") {
        closeList();
        out.push("<ol>");
        list = "ol";
      }
      out.push(`<li>${renderInline(ol[1])}</li>`);
    } else {
      closeList();
      para.push(line);
    }
  }
  flushPara();
  closeList();
  return out.join("");
}
