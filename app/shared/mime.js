// mime.js — decode the raw RFC 2045/2047 payloads that land in app_private.mail_messages.
//
// WHY THIS EXISTS: the inbound forwarder stores the message body verbatim. What is actually in
// `body_text` for a forwarded mail looks like this:
//
//   --0000000000002c652a06578bf91c
//   Content-Type: text/plain; charset="UTF-8"
//
//     PHOENIX AZ -> LAS VEGAS NV, Dry van 30k lbs, $900 all in.
//   --0000000000002c652a06578bf91c
//   Content-Type: text/html; charset="UTF-8"
//   Content-Transfer-Encoding: quoted-printable
//
//   <div dir=3D"ltr">=C2=A0 PHOENIX AZ -&gt; LAS VEGAS NV ...
//   --0000000000002c652a06578bf91c--
//
// Rendering that as-is gives the reader boundary markers, `=3D` and `=C2=A0`. Subjects are worse:
// `=?UTF-8?Q?LoadBoot_Agent_=E2=80=94_sean?=`. Everything here is pure and DOM-free so it can be
// unit-tested in node (see tools/mime.test.mjs).
//
// Scope note: this is a *pragmatic* decoder for the shapes this mailbox actually receives, not a
// complete MIME implementation. Nested multipart/alternative inside multipart/mixed is handled by
// recursion; message/rfc822 attachments and non-UTF-8 multibyte charsets (Shift-JIS, GB2312) are
// not. Anything it cannot decode is returned unchanged rather than mangled — a readable-but-raw
// body beats a confidently wrong one.

const DEFAULT_CHARSET = 'utf-8';

// Charsets TextDecoder is required to support, plus the aliases seen in real freight mail.
const CHARSET_ALIASES = {
  'utf8': 'utf-8',
  'utf-8': 'utf-8',
  'us-ascii': 'utf-8',       // ASCII is a UTF-8 subset; decoding as UTF-8 is lossless
  'ascii': 'utf-8',
  'iso-8859-1': 'windows-1252',
  'latin1': 'windows-1252',
  'windows-1252': 'windows-1252',
  'cp1252': 'windows-1252',
};

function normalizeCharset(cs) {
  const key = String(cs || DEFAULT_CHARSET).trim().toLowerCase().replace(/^["']|["']$/g, '');
  return CHARSET_ALIASES[key] || key || DEFAULT_CHARSET;
}

function bytesToString(bytes, charset) {
  const cs = normalizeCharset(charset);
  try {
    return new TextDecoder(cs, { fatal: false }).decode(new Uint8Array(bytes));
  } catch (_) {
    // Unknown charset (or no TextDecoder): fall back to UTF-8, then to raw latin1.
    try { return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes)); }
    catch (_e) { return bytes.map(b => String.fromCharCode(b)).join(''); }
  }
}

/**
 * Quoted-printable (RFC 2045 §6.7).
 * Handles soft line breaks (`=` at end of line) and `=XX` byte escapes. Decodes to bytes first,
 * then through the charset, so multi-byte sequences like `=E2=80=94` become a real em dash
 * instead of three mojibake characters.
 */
export function decodeQuotedPrintable(input, charset) {
  if (typeof input !== 'string' || !input) return input || '';
  // Soft line breaks first: "=\r\n" / "=\n" join the physical lines.
  const joined = input.replace(/=(?:\r\n|\n|\r)/g, '');
  const bytes = [];
  for (let i = 0; i < joined.length; i++) {
    const ch = joined[i];
    if (ch === '=' && /^[0-9a-fA-F]{2}$/.test(joined.substr(i + 1, 2))) {
      bytes.push(parseInt(joined.substr(i + 1, 2), 16));
      i += 2;
    } else {
      // Re-encode the literal char to bytes so the charset pass sees a consistent stream.
      const code = ch.charCodeAt(0);
      if (code < 0x80) bytes.push(code);
      else for (const b of new TextEncoder().encode(ch)) bytes.push(b);
    }
  }
  return bytesToString(bytes, charset);
}

/** Base64 → string, tolerant of the whitespace real mailers wrap it in. */
export function decodeBase64(input, charset) {
  if (typeof input !== 'string' || !input) return input || '';
  const clean = input.replace(/[^A-Za-z0-9+/=]/g, '');
  if (!clean) return '';
  try {
    let bin;
    if (typeof atob === 'function') bin = atob(clean);
    else bin = Buffer.from(clean, 'base64').toString('binary'); // node, for the test harness
    const bytes = new Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytesToString(bytes, charset);
  } catch (_) {
    return input; // not valid base64 after all — show it rather than blanking the message
  }
}

/**
 * RFC 2047 encoded words in headers: `=?UTF-8?Q?...?=` / `=?utf-8?B?...?=`.
 * Adjacent encoded words separated only by whitespace are joined without the space, per §6.2 —
 * that is what turns `=?..?Q?ne?= =?..?Q?w_submission?=` into "new submission".
 */
export function decodeEncodedWords(input) {
  if (typeof input !== 'string' || !input) return input || '';
  if (input.indexOf('=?') === -1) return input;

  const token = /=\?([^?]+)\?([QqBb])\?([^?]*)\?=/g;
  const out = [];
  let last = 0, prevWasEncoded = false, m;

  while ((m = token.exec(input)) !== null) {
    const between = input.slice(last, m.index);
    // Whitespace between two encoded words is separator, not content.
    if (!(prevWasEncoded && /^\s*$/.test(between))) out.push(between);

    const [, charset, enc, payload] = m;
    out.push(enc.toUpperCase() === 'B'
      ? decodeBase64(payload, charset)
      // In 'Q' encoding underscore means space (§4.2) — decode it before the QP pass.
      : decodeQuotedPrintable(payload.replace(/_/g, ' '), charset));

    last = m.index + m[0].length;
    prevWasEncoded = true;
  }
  out.push(input.slice(last));
  return out.join('');
}

/** Subject line ready for display. */
export function decodeSubject(subject) {
  return decodeEncodedWords(String(subject || '')).replace(/\s+/g, ' ').trim();
}

function parseHeaderBlock(block) {
  const headers = {};
  // Unfold continuation lines (a leading space/tab continues the previous header).
  const unfolded = block.replace(/(?:\r\n|\n|\r)[ \t]+/g, ' ');
  for (const line of unfolded.split(/\r\n|\n|\r/)) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  return headers;
}

function paramFrom(headerValue, name) {
  if (!headerValue) return null;
  const m = new RegExp(name + '\\s*=\\s*("([^"]*)"|[^;\\s]+)', 'i').exec(headerValue);
  return m ? (m[2] !== undefined ? m[2] : m[1]) : null;
}

function splitHeadersAndBody(chunk) {
  const m = /\r\n\r\n|\n\n|\r\r/.exec(chunk);
  if (!m) return { headers: {}, body: chunk };
  return {
    headers: parseHeaderBlock(chunk.slice(0, m.index)),
    body: chunk.slice(m.index + m[0].length),
  };
}

function decodeBody(body, headers) {
  const cte = String(headers['content-transfer-encoding'] || '').trim().toLowerCase();
  const charset = paramFrom(headers['content-type'], 'charset') || DEFAULT_CHARSET;
  if (cte === 'quoted-printable') return decodeQuotedPrintable(body, charset);
  if (cte === 'base64') return decodeBase64(body, charset);
  return body;
}

/** Find the multipart boundary, from the header if present, else from the first `--xxx` line. */
function findBoundary(raw, headers) {
  const declared = paramFrom(headers && headers['content-type'], 'boundary');
  if (declared) return declared;
  // Forwarded bodies often arrive with the top-level headers already stripped.
  const m = /^--([A-Za-z0-9'()+_,\-./:=?]{8,200})\s*$/m.exec(raw);
  return m ? m[1] : null;
}

function collectParts(raw, boundary, depth, acc) {
  if (depth > 4) return acc;                       // guard against pathological nesting
  const marker = '--' + boundary;
  const chunks = raw.split(marker);
  for (let i = 1; i < chunks.length; i++) {        // chunks[0] is the preamble
    let chunk = chunks[i];
    if (/^--/.test(chunk)) break;                  // closing "--boundary--": we're done
    chunk = chunk.replace(/^(?:\r\n|\n|\r)/, '');
    const { headers, body } = splitHeadersAndBody(chunk);
    const ctype = String(headers['content-type'] || 'text/plain').toLowerCase();

    if (ctype.startsWith('multipart/')) {
      const inner = findBoundary(body, headers);
      if (inner) collectParts(body, inner, depth + 1, acc);
      continue;
    }
    const disposition = String(headers['content-disposition'] || '').toLowerCase();
    if (disposition.startsWith('attachment')) {
      acc.attachments.push({
        filename: paramFrom(headers['content-disposition'], 'filename') || paramFrom(ctype, 'name') || 'attachment',
        contentType: ctype.split(';')[0].trim(),
        approxBytes: body.replace(/\s/g, '').length,
      });
      continue;
    }
    const decoded = decodeBody(body, headers).replace(/(?:\r\n|\n|\r)+$/, '');
    if (ctype.startsWith('text/html')) acc.html.push(decoded);
    else if (ctype.startsWith('text/plain')) acc.text.push(decoded);
  }
  return acc;
}

/**
 * Turn a stored message into something displayable.
 *
 * @param {{body_text?: string, body_html?: string, subject?: string}} msg
 * @returns {{html: string|null, text: string|null, subject: string, attachments: Array, wasMime: boolean}}
 *          `html` is UNSANITIZED and must never be injected into the CC document — render it in a
 *          sandboxed iframe (see renderBodyFrame in views/mailbox.js).
 */
export function decodeMessage(msg) {
  const rawText = typeof msg?.body_text === 'string' ? msg.body_text : '';
  const storedHtml = typeof msg?.body_html === 'string' && msg.body_html.trim() ? msg.body_html : null;
  const subject = decodeSubject(msg?.subject);

  // A body we composed ourselves (drafts, sent replies) is already clean HTML.
  if (storedHtml && !rawText) {
    return { html: storedHtml, text: null, subject, attachments: [], wasMime: false };
  }

  const { headers, body } = splitHeadersAndBody(rawText);
  const looksLikeHeaders = Object.keys(headers).some(h => h.startsWith('content-'));
  const boundary = findBoundary(rawText, looksLikeHeaders ? headers : null);

  if (boundary) {
    const acc = collectParts(rawText, boundary, 0, { html: [], text: [], attachments: [] });
    if (acc.html.length || acc.text.length) {
      return {
        html: acc.html.length ? acc.html.join('\n<hr>\n') : null,
        text: acc.text.length ? acc.text.join('\n') : null,
        subject,
        attachments: acc.attachments,
        wasMime: true,
      };
    }
  }

  // Single part. Only run a transfer decode when the message actually declared one — otherwise a
  // plain body containing "=" (a rate table, a signature rule) would be corrupted.
  if (looksLikeHeaders) {
    const decoded = decodeBody(body, headers);
    const ctype = String(headers['content-type'] || '').toLowerCase();
    return ctype.startsWith('text/html')
      ? { html: decoded, text: null, subject, attachments: [], wasMime: true }
      : { html: storedHtml, text: decoded, subject, attachments: [], wasMime: true };
  }

  return { html: storedHtml, text: rawText, subject, attachments: [], wasMime: false };
}

/**
 * Strip MIME scaffolding from a TRUNCATED body.
 *
 * cc_mail_list's `preview` is left(body_text, 160) computed in SQL, which for a forwarded mail
 * slices straight through the boundary and part headers. There is not enough of the message left
 * to parse properly, so this drops the lines that are obviously scaffolding and undoes the
 * quoted-printable escapes that are safely decodable on their own.
 */
function stripMimeNoise(s) {
  const raw = String(s);
  // Decide on evidence, not on a guess: only treat the fragment as quoted-printable if it actually
  // declared it. Otherwise "PU=25" in a plain body would silently decode to "PU%".
  const declaredQP = /content-transfer-encoding\s*:\s*quoted-printable/i.test(raw);
  const charset = (/charset\s*=\s*"?([\w-]+)"?/i.exec(raw) || [])[1] || 'utf-8';
  const kept = raw.split(/\r\n|\n|\r/).filter(line => {
    const l = line.trim();
    if (!l) return false;
    if (/^--[A-Za-z0-9'()+_,\-./:=?]{8,200}-{0,2}$/.test(l)) return false;          // boundary
    if (/^(content-type|content-transfer-encoding|content-disposition|content-id|mime-version)\s*:/i.test(l)) return false;
    return true;
  }).join('\n');
  return declaredQP ? decodeQuotedPrintable(kept, charset) : kept;
}

/** One-line preview for the thread list: decoded, tag-free, whitespace-collapsed. */
export function previewOf(msg, max = 140) {
  const d = decodeMessage(msg);
  // Always run on previews: cc_mail_list's preview is a raw left(body_text,160) slice, so even a
  // "successfully parsed" fragment can still carry a boundary or a stray part header.
  let s = stripMimeNoise(d.text || '');
  if (!s && d.html) {
    s = d.html
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<[^>]+>/g, ' ');
  }
  s = s.replace(/&nbsp;|&zwnj;/gi, ' ')
       .replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"')
       .replace(/\s+/g, ' ')
       .trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

export default { decodeMessage, decodeSubject, decodeQuotedPrintable, decodeBase64, decodeEncodedWords, previewOf };
