// tools/mime.test.mjs — unit tests for app/shared/mime.js
//
// Run:  node tools/mime.test.mjs
//
// Every fixture below is a VERBATIM payload taken from production
// (app_private.mail_messages / app_private.email_loads on rwscphuhpjoudvljvmdk),
// not something invented to make the decoder look good.

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// node will not import ESM from a bare .js without package.json type:module — copy to .mjs.
const dir = mkdtempSync(join(tmpdir(), 'mimetest-'));
const shim = join(dir, 'mime.mjs');
writeFileSync(shim, readFileSync(new URL('../app/shared/mime.js', import.meta.url), 'utf8'));
const { decodeMessage, decodeSubject, previewOf, decodeQuotedPrintable } = await import(shim);

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log('  PASS  ' + name); }
  catch (e) { fail++; console.log('  FAIL  ' + name + '\n        ' + e.message); }
};

// ── Fixture 1: real forwarded multipart, quoted-printable HTML part ──────────────
const MULTIPART = '--0000000000002c652a06578bf91c\r\n'
  + 'Content-Type: text/plain; charset="UTF-8"\n\n'
  + '  PHOENIX AZ -> LAS VEGAS NV, Dry van 30k lbs, PU Mon 7/28, $900 all in.\r\n'
  + 'Yaseen | YS Freight | MC 771122\n\n'
  + '--0000000000002c652a06578bf91c\r\n'
  + 'Content-Type: text/html; charset="UTF-8"\r\n'
  + 'Content-Transfer-Encoding: quoted-printable\n\n'
  + '<div dir=3D"ltr">=C2=A0 PHOENIX AZ -&gt; LAS VEGAS NV, Dry van 30k lbs, PU =\r\n'
  + 'Mon 7/28, $900 all in. Yaseen | YS Freight | MC 771122=C2=A0=C2=A0</div>\n\n'
  + '--0000000000002c652a06578bf91c--\r\n';

t('multipart: boundary markers never reach the reader', () => {
  const d = decodeMessage({ body_text: MULTIPART });
  assert.equal(d.wasMime, true);
  assert.ok(!(d.html || '').includes('--0000000000002c652a'), 'html still has a boundary');
  assert.ok(!(d.text || '').includes('--0000000000002c652a'), 'text still has a boundary');
});

t('multipart: text/plain part is extracted intact', () => {
  const d = decodeMessage({ body_text: MULTIPART });
  assert.ok(d.text.includes('PHOENIX AZ -> LAS VEGAS NV'));
  assert.ok(d.text.includes('MC 771122'));
  assert.ok(!d.text.includes('Content-Type'), 'part headers leaked into the body');
});

t('multipart: quoted-printable html is decoded (=3D -> =, =C2=A0 -> nbsp)', () => {
  const d = decodeMessage({ body_text: MULTIPART });
  assert.ok(d.html.includes('<div dir="ltr">'), 'expected =3D to decode to "="');
  assert.ok(!d.html.includes('=3D'), '=3D survived');
  assert.ok(!d.html.includes('=C2=A0'), '=C2=A0 survived');
  assert.ok(d.html.includes(' '), 'expected a real non-breaking space');
});

t('multipart: soft line break rejoins the split word', () => {
  const d = decodeMessage({ body_text: MULTIPART });
  // "PU =\r\nMon" must become "PU Mon", not "PU =Mon" or "PU\nMon".
  assert.ok(d.html.includes('PU Mon 7/28'), 'soft line break not rejoined');
});

// ── Fixture 2: RFC 2047 'Q' subject, split across two adjacent encoded words ─────
t('subject: Q-encoded words join without a phantom space', () => {
  const raw = '[loads@ other] =?UTF-8?Q?LoadBoot_Agent_=E2=80=94_sean_suba=3A_ne?= =?UTF-8?Q?w_submission_to_review?=';
  assert.equal(decodeSubject(raw), '[loads@ other] LoadBoot Agent — sean suba: new submission to review');
});

// ── Fixture 3: RFC 2047 'B' subject (Payoneer, real) ────────────────────────────
t('subject: B-encoded words decode, curly apostrophe survives', () => {
  const raw = '=?utf-8?B?UmVtaW5kZXI6IGxldOKAmXMgZ2V0IHlvdSBzdGFydGVkIHdpdGgg?= =?utf-8?B?UGF5b25lZXI=?=';
  assert.equal(decodeSubject(raw), 'Reminder: let’s get you started with Payoneer');
});

t('subject: a plain subject passes through untouched', () => {
  const raw = '[loads@ other] [ACTION REQUIRED] [LoadBoot - org_V3bw5K3YRh4Ka2BV] Deprecated API usage detected: Legacy agent publish endpoints';
  assert.equal(decodeSubject(raw), raw);
});

// ── Fixture 4: the Retell notice — plain text, NO MIME headers ──────────────────
const PLAIN = 'Hi there,\n\nAction required: we detected continued usage of deprecated Retell API functionality in your account.\n\n'
  + 'Deprecation: Legacy agent publish endpoints\r\nMost recent call: Sep 2, 2026, 10:38 PM PDT\r\n'
  + 'Affected workspace ID: org_V3bw5K3YRh4Ka2BV\n\n- The Retell Team\r\n';

t('plain body is returned byte-for-byte, not "decoded"', () => {
  const d = decodeMessage({ body_text: PLAIN });
  assert.equal(d.wasMime, false);
  assert.equal(d.text, PLAIN);
  assert.equal(d.html, null);
});

t('a plain body containing "=" is NOT mangled by quoted-printable', () => {
  // Regression guard: rate tables and signature rules are full of '='.
  const body = 'Linehaul = $2,450\nFSC = $0.42/mi\n===========================\nTotal = $2,880';
  const d = decodeMessage({ body_text: body });
  assert.equal(d.text, body, 'a body with no CTE header must never be QP-decoded');
});

// ── Composed mail (drafts / sent replies) ──────────────────────────────────────
t('our own composed html passes through as html', () => {
  const d = decodeMessage({ body_html: '<p>Thanks — booked.</p>', body_text: null });
  assert.equal(d.html, '<p>Thanks — booked.</p>');
  assert.equal(d.wasMime, false);
});

// ── Preview ────────────────────────────────────────────────────────────────────
t('preview strips tags, entities and collapses whitespace', () => {
  const p = previewOf({ body_text: MULTIPART }, 60);
  assert.ok(!p.includes('<'), 'tags leaked into the preview');
  assert.ok(!p.includes('Content-Type'), 'headers leaked into the preview');
  assert.ok(p.startsWith('PHOENIX AZ -> LAS VEGAS NV'), 'unexpected preview: ' + p);
  assert.ok(p.length <= 60, 'preview exceeded max length');
});

t('preview of an html-only message is readable', () => {
  const p = previewOf({ body_html: '<style>a{color:red}</style><p>Rate&nbsp;confirmed &amp; booked</p>' }, 80);
  assert.equal(p, 'Rate confirmed & booked');
});

// ── Edge cases ─────────────────────────────────────────────────────────────────
t('empty / null input does not throw', () => {
  assert.doesNotThrow(() => decodeMessage({}));
  assert.doesNotThrow(() => decodeMessage({ body_text: '' }));
  assert.doesNotThrow(() => decodeSubject(null));
  assert.doesNotThrow(() => previewOf({}));
});

t('malformed base64 in an encoded word degrades instead of blanking', () => {
  const out = decodeSubject('=?utf-8?B?!!!!not-base64!!!!?= tail');
  assert.ok(out.includes('tail'), 'the rest of the subject was lost');
});

t('quoted-printable decodes a multi-byte em dash', () => {
  assert.equal(decodeQuotedPrintable('a =E2=80=94 b', 'utf-8'), 'a — b');
});

t('nesting guard: deeply nested multipart terminates', () => {
  let s = 'x';
  for (let i = 0; i < 12; i++) s = `--b${i}\nContent-Type: multipart/mixed; boundary="b${i + 1}"\n\n${s}\n--b${i}--\n`;
  assert.doesNotThrow(() => decodeMessage({ body_text: s }));
});

// ── Truncated previews: cc_mail_list slices left(body_text,160) mid-MIME ────────
t('preview of a truncated MIME slice hides boundaries and part headers', () => {
  const slice = MULTIPART.slice(0, 160);            // exactly what SQL stores in `preview`
  const p = previewOf({ body_text: slice }, 120);
  assert.ok(!p.includes('--00000000'), 'boundary leaked: ' + p);
  assert.ok(!/content-type/i.test(p), 'part header leaked: ' + p);
  assert.ok(p.includes('PHOENIX AZ'), 'lost the actual content: ' + p);
});

t('preview only quoted-printable-decodes when the fragment declared it', () => {
  // No CTE header anywhere -> "PU=25" must stay "PU=25", not become "PU%".
  const p = previewOf({ body_text: 'Dallas -> Memphis, PU=25 pallets, rate = $1,200' }, 120);
  assert.ok(p.includes('PU=25'), 'plain text was wrongly QP-decoded: ' + p);
  assert.ok(p.includes('rate = $1,200'), 'rate line mangled: ' + p);
});

t('preview does decode when the fragment declared quoted-printable', () => {
  const frag = 'Content-Type: text/plain; charset="UTF-8"\nContent-Transfer-Encoding: quoted-printable\n\nDallas =E2=80=94 Memphis';
  const p = previewOf({ body_text: frag }, 120);
  assert.ok(p.includes('Dallas — Memphis'), 'declared QP was not decoded: ' + p);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
