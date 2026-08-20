// chatText.js — safe rich text for chat transcripts.
//
// The agent inbox was printing raw markup at staff: "We operate as <b>LoadBoot</b>,
// … reach us at <b>hello@loadboot.com</b>". el() inserts text nodes by design, so the
// bot's own formatting arrived as literal angle brackets and read like a broken script.
//
// Escape EVERYTHING first, then restore a small whitelist. Order matters: because the
// escape happens before the whitelist, anything not on the list — <script>, <img onerror>,
// a visitor pasting markup — stays inert text no matter who wrote the message.
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const ALLOWED = /&lt;(\/?)(b|strong|i|em|u|br)&gt;/gi;
const EMAIL = /\b([A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})\b/gi;
const URL = /\bhttps?:\/\/[^\s<]+/gi;
const PHONE = /(\+1\s?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})/g;

export function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ESC[c]);
}

export function richText(s) {
  let out = escapeHtml(s);
  out = out.replace(ALLOWED, (_m, slash, tag) => '<' + slash + tag.toLowerCase() + '>');
  out = out.replace(URL, (m) => '<a href="' + m + '" target="_blank" rel="noopener noreferrer">' + m + '</a>');
  out = out.replace(EMAIL, '<a href="mailto:$1">$1</a>');
  out = out.replace(PHONE, '<a href="tel:$1">$1</a>');
  return out;
}

// The widget's inline directives. Staff could not see any of them — the old view stripped
// them out entirely, so an agent had no idea what the bot had actually offered the visitor.
export function parseDirectives(body) {
  const raw = String(body == null ? '' : body);
  const chips = [];
  let askedFor = null;
  let callback = false;
  let note = false;

  let text = raw.replace(/\[\[chips:([^\]]*)\]\]/gi, (_m, inner) => {
    String(inner).split('|').forEach((pair) => {
      const label = String(pair).split('=')[0].trim();
      if (label) chips.push(label);
    });
    return '';
  });
  text = text.replace(/\[\[form:([^\]]*)\]\]/gi, (_m, fields) => {
    askedFor = String(fields).split(',').map((f) => f.trim()).filter(Boolean).join(' + ');
    return '';
  });
  text = text.replace(/\[\[callform\]\]/gi, () => { callback = true; return ''; });
  text = text.replace(/^\s*\[\[note\]\]\s*/i, () => { note = true; return ''; });

  return { text: text.trim(), chips, askedFor, callback, note };
}

export default { richText, escapeHtml, parseDirectives };
