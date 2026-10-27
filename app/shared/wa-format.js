// wa-format.js — WhatsApp text formatting for the CC composer (bl_wa_0571)
//   • htmlToWa(html)  — rich clipboard (Docs, Gmail, Claude, Word…) → WhatsApp markup
//   • mdToWa(text)    — Markdown typed or pasted as plain text → WhatsApp markup
//   • waRender(text)  — WhatsApp markup → DOM nodes (bold, italic, strike, mono, code, lists, quotes, links)
//   • wrapSelection(ta, mark) — B / I / S / mono toolbar + shortcuts
// WhatsApp syntax: *bold*  _italic_  ~strike~  ```mono```  `code`  "- " / "* " lists  "1. " lists  "> " quote.
// No innerHTML anywhere: pasted HTML is parsed with DOMParser (scripts never run) and rendering builds nodes.

const BLOCK = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'TABLE', 'TR', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'PRE', 'HR']);

// wrap inline content with a WhatsApp marker; markers must hug the text (no leading/trailing spaces inside)
function wrapMark(s, m) {
  if (!s || !s.trim()) return s;
  const lead = s.match(/^\s*/)[0], trail = s.match(/\s*$/)[0];
  const core = s.trim();
  if (core.startsWith(m) && core.endsWith(m) && core.length > 2 * m.length) return s; // already marked
  return lead + m + core + m + trail;
}

function styleFlags(node) {
  const st = (node.getAttribute && node.getAttribute('style')) || '';
  return {
    bold: /font-weight\s*:\s*(bold|[6-9]00)/i.test(st),
    italic: /font-style\s*:\s*italic/i.test(st),
    strike: /text-decoration[^;]*line-through/i.test(st),
  };
}

function walk(node, ctx) {
  if (node.nodeType === 3) return node.nodeValue.replace(/ /g, ' ').replace(/[ \t\r\n]+/g, ctx.pre ? '$&' : ' ');
  if (node.nodeType !== 1) return '';
  const tag = node.tagName;
  if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'HEAD' || tag === 'TITLE' || tag === 'META') return '';
  if (tag === 'BR') return '\n';
  if (tag === 'HR') return '\n';
  if (tag === 'IMG') return node.getAttribute('alt') || '';
  if (tag === 'PRE') { const t = node.textContent.replace(/\n+$/, ''); return '\n```' + t + '```\n'; }

  const kids = (c) => Array.from(node.childNodes).map((n) => walk(n, c)).join('');
  if (tag === 'UL' || tag === 'OL') {
    let i = 0; const depth = (ctx.depth || 0);
    const items = Array.from(node.children).filter((c) => c.tagName === 'LI').map((li) => {
      i += 1;
      const inner = Array.from(li.childNodes).map((n) => walk(n, Object.assign({}, ctx, { depth: depth + 1 }))).join('').replace(/^\s+|\s+$/g, '').replace(/\n{2,}/g, '\n');
      return '  '.repeat(depth) + (tag === 'OL' ? i + '. ' : '- ') + inner;
    });
    return '\n' + items.join('\n') + '\n';
  }
  let s = kids(ctx);
  const f = styleFlags(node);
  if (tag === 'CODE' && node.parentElement && node.parentElement.tagName !== 'PRE') s = wrapMark(s, '`');
  if (tag === 'B' || tag === 'STRONG' || f.bold) s = wrapMark(s, '*');
  if (tag === 'I' || tag === 'EM' || f.italic) s = wrapMark(s, '_');
  if (tag === 'S' || tag === 'DEL' || tag === 'STRIKE' || f.strike) s = wrapMark(s, '~');
  if (/^H[1-6]$/.test(tag)) s = wrapMark(s.replace(/\*/g, ''), '*');
  if (tag === 'A') {
    const href = node.getAttribute('href') || '';
    const txt = s.trim();
    if (/^https?:|^mailto:|^tel:/i.test(href)) {
      const clean = href.replace(/^mailto:|^tel:/i, '');
      s = !txt || txt === href || txt === clean || href.includes(txt) ? clean : txt + ' (' + clean + ')';
    }
  }
  if (tag === 'TD' || tag === 'TH') return s.trim() + ' · ';
  if (tag === 'LI') return '- ' + s.trim() + '\n';
  if (BLOCK.has(tag)) return '\n' + s.replace(/^\n+|\n+$/g, '') + '\n';
  return s;
}

function tidy(s) {
  return s
    .replace(/ · \n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\*\s*\*/g, '')            // empty bold left by spacing
    .replace(/^\n+|\s+$/g, '');
}

export function htmlToWa(html) {
  try {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html');
    // Gmail / Docs wrap everything in a bold <b id="docs-internal…"> — unwrap it so the whole paste isn't bold
    doc.querySelectorAll('b[id^="docs-internal"]').forEach((b) => { b.replaceWith(...b.childNodes); });
    return tidy(walk(doc.body, {}));
  } catch (_) { return null; }
}

export function mdToWa(text) {
  let s = String(text || '').replace(/\r\n?/g, '\n');
  const fences = [];
  s = s.replace(/```[\s\S]*?```/g, (m) => { fences.push(m); return '\u0000' + (fences.length - 1) + '\u0000'; });
  s = s
    .replace(/^#{1,6}\s+(.+?)\s*#*$/gm, (_, h) => '*' + h.replace(/\*/g, '') + '*')     // headings → bold line
    .replace(/\*\*\*(.+?)\*\*\*/g, '*_$1_*')                                            // ***x*** → bold italic
    .replace(/\*\*(.+?)\*\*/g, '*$1*')                                                  // **x** → *x*
    .replace(/__(.+?)__/g, '*$1*')                                                      // __x__ → *x*
    .replace(/~~(.+?)~~/g, '~$1~')                                                      // ~~x~~ → ~x~
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|mailto:[^)\s]+)\)/g, (_, t, u) => { const c = u.replace(/^mailto:/, ''); return t === c || t === u ? c : t + ' (' + c + ')'; })
    .replace(/^(\s*)[*+•]\s+/gm, '$1- ')                                               // * item → - item
    .replace(/^>\s?/gm, '');                                                            // drop blockquote wrappers (drafts are quoted for display only)
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => fences[+i]);
  return s.replace(/\n{3,}/g, '\n\n');
}

// clipboard → WhatsApp text (prefers HTML so bold/italic/lists survive, falls back to Markdown in plain text)
export function clipboardToWa(dt) {
  if (!dt) return null;
  const html = dt.getData && dt.getData('text/html');
  const plain = dt.getData && dt.getData('text/plain');
  if (html && /<(b|strong|i|em|s|del|strike|li|h[1-6]|code|pre|a)\b|font-weight|font-style|line-through/i.test(html)) {
    const w = htmlToWa(html);
    if (w != null && w.trim()) return mdToWa(w);   // HTML may still carry literal **markdown**
  }
  return plain != null ? mdToWa(plain) : null;
}

// ---------- rendering (WhatsApp markup → nodes) ----------
const LINK_RE = /(https?:\/\/[^\s<>"]+|www\.[^\s<>"]+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/gi;
function linkify(text, mk) {
  const out = []; let last = 0; let m; LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(text))) {
    let tok = m[0]; let trail = '';
    while (/[).,;:!?]$/.test(tok)) { trail = tok.slice(-1) + trail; tok = tok.slice(0, -1); }
    if (m.index > last) out.push(text.slice(last, m.index));
    const href = /@/.test(tok) && !/^https?:/i.test(tok) ? 'mailto:' + tok : (/^https?:/i.test(tok) ? tok : 'https://' + tok);
    out.push(mk('a', { href, target: '_blank', rel: 'noopener noreferrer' }, [tok]));
    if (trail) out.push(trail);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
// inline: *b* _i_ ~s~ `code` — markers must touch non-space text, like WhatsApp
const INLINE_RE = /(^|[\s(\[{"'.,;:!?-])([*_~`])(?!\s)([^\n]*?[^\s])\2(?=$|[\s)\]}"'.,;:!?-])/;
function inline(text, mk) {
  const m = INLINE_RE.exec(text);
  if (!m) return linkify(text, mk);
  const start = m.index + m[1].length;
  const before = text.slice(0, start);
  const inner = m[3];
  const after = text.slice(start + inner.length + 2);
  const tag = { '*': 'strong', '_': 'em', '~': 's', '`': 'code' }[m[2]];
  const node = mk(tag, tag === 'code' ? { class: 'wa-code' } : null, tag === 'code' ? [inner] : inline(inner, mk));
  return inline(before, mk).concat([node], inline(after, mk));
}

function defaultMk(tag, attrs, kids) {
  const n = document.createElement(tag);
  if (attrs) for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
  (kids || []).forEach((c) => n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
  return n;
}

export function waRender(text, mk) {
  mk = mk || defaultMk;
  const s = String(text || '');
  const out = [];
  const parts = s.split(/```([\s\S]*?)```/);
  parts.forEach((part, idx) => {
    if (idx % 2 === 1) { out.push(mk('pre', { class: 'wa-pre' }, [part.replace(/^\n|\n$/g, '')])); return; }
    const lines = part.split('\n');
    lines.forEach((line, li) => {
      let m;
      if ((m = /^(\s*)[-*•]\s+(.*)$/.exec(line))) {
        out.push(mk('span', { class: 'wa-li', style: 'padding-left:' + (1.5 + (m[1].length / 2) * 1.2) + 'em' }, [mk('span', { class: 'wa-bul' }, ['•']), ...inline(m[2], mk)]));
      } else if ((m = /^(\s*)(\d{1,3})\.\s+(.*)$/.exec(line))) {
        out.push(mk('span', { class: 'wa-li', style: 'padding-left:' + (1.5 + (m[1].length / 2) * 1.2) + 'em' }, [mk('span', { class: 'wa-bul' }, [m[2] + '.']), ...inline(m[3], mk)]));
      } else if ((m = /^>\s?(.*)$/.exec(line))) {
        out.push(mk('span', { class: 'wa-quote' }, inline(m[1], mk)));
      } else {
        out.push(...inline(line, mk));
        if (li < lines.length - 1) out.push('\n');
      }
    });
  });
  return out;
}

export const WA_FORMAT_CSS = `
.wa-code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.92em;background:rgba(11,20,26,.07);border-radius:4px;padding:0 4px}
.wa-pre{display:block;margin:4px 0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;white-space:pre-wrap;background:rgba(11,20,26,.05);border-radius:6px;padding:6px 8px}
.wa-li{display:block;position:relative;white-space:pre-wrap}
.wa-bul{display:inline-block;width:1.5em;margin-left:-1.5em;opacity:.75;text-align:left}
.wa-quote{display:block;border-left:3px solid rgba(11,20,26,.25);padding-left:8px;margin:2px 0;opacity:.9;white-space:pre-wrap}
`;

// ---------- editing helpers ----------
export function wrapSelection(ta, mark) {
  const a = ta.selectionStart, b = ta.selectionEnd, v = ta.value;
  let sel = v.slice(a, b);
  // trim spaces out of the selection so the markers hug the words
  const lead = sel.match(/^\s*/)[0].length, trail = sel.match(/\s*$/)[0].length;
  const s0 = a + lead, s1 = b - trail;
  sel = v.slice(s0, s1);
  if (!sel) { ta.setRangeText(mark + mark, a, b, 'end'); ta.selectionStart = ta.selectionEnd = a + mark.length; return; }
  const wrapped = sel.startsWith(mark) && sel.endsWith(mark) && sel.length >= 2 * mark.length;
  const outer = v.slice(s0 - mark.length, s0) === mark && v.slice(s1, s1 + mark.length) === mark;
  if (wrapped) { ta.setRangeText(sel.slice(mark.length, sel.length - mark.length), s0, s1, 'select'); }
  else if (outer) { ta.setRangeText(sel, s0 - mark.length, s1 + mark.length, 'select'); }
  else { ta.setRangeText(sel.split('\n').map((l) => (l.trim() ? mark + l + mark : l)).join('\n'), s0, s1, 'select'); }
}
export function prefixLines(ta, kind) {
  const v = ta.value; let a = ta.selectionStart, b = ta.selectionEnd;
  a = v.lastIndexOf('\n', a - 1) + 1; const e = v.indexOf('\n', b); b = e < 0 ? v.length : e;
  const lines = v.slice(a, b).split('\n');
  const strip = (l) => l.replace(/^(\s*)(?:[-*•]|\d{1,3}\.|>)\s+/, '$1');
  const all = lines.every((l) => !l.trim() || (kind === 'ul' ? /^\s*[-*•]\s/.test(l) : kind === 'ol' ? /^\s*\d{1,3}\.\s/.test(l) : /^>\s?/.test(l)));
  let n = 0;
  const next = lines.map((l) => { if (!l.trim()) return l; const base = strip(l); if (all) return base; n += 1; return kind === 'ul' ? '- ' + base : kind === 'ol' ? n + '. ' + base : '> ' + base; });
  ta.setRangeText(next.join('\n'), a, b, 'select');
}
