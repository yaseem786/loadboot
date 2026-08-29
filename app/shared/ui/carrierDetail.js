// carrierDetail.js — 29 Aug 2026.
//
// carrier_dispatch_prefs carries two free-shaped columns that staff have been filling with
// real operating knowledge: `equipment_detail` (a jsonb bag) and `notes` (a dated log).
// Carrier 360 rendered both by flattening them — Object.keys(...).join(' · ') for the bag,
// and the raw string for the log — into two 150px cells of an auto-fit grid. On a carrier
// with eighteen keys that produced one unreadable paragraph ending "· interior height in: 97",
// and the operating facts a dispatcher actually needs (payload, liftgate, dock height, the
// deadline) were buried inside it.
//
// Written against ../ui/dom.js only, so the Command Center and the carrier portal render
// from ONE module and the carrier and the dispatcher read one version of the truth.
//
// opts.audience: 'staff'   — everything, including the internal wording of open questions.
//                'carrier' — the facts, with the gaps turned into a plain "we still need"
//                            list that never exposes staff commentary.
// opts.theme:    'light' (Command Center) | 'dark' (carrier portal, dark premium).
// opts.title:    null to omit the heading when the host page supplies its own.
import { el } from './dom.js';

/* Known keys get a real label and a unit. Anything unknown is humanised, so a key added
   later still renders sensibly instead of disappearing. */
export const EQ_LABELS = {
  unit: ['Truck', null],
  vin: ['VIN', null],
  gvwr: ['GVWR', null],
  ownership: ['Ownership', null],
  driver: ['Driver', null],
  driver_licence: ['Driver licence', null],
  payload_lbs: ['Max payload', 'lb'],
  interior_length: ['Interior length', null],
  interior_length_in: ['Interior length', 'in'],
  interior_width_in: ['Interior width', 'in'],
  interior_height_in: ['Interior height', 'in'],
  liftgate: ['Liftgate', null],
  dock_high: ['Dock high', null],
  pallet_jack: ['Pallet jack', null],
  ramp: ['Ramp', null],
  pickup_zip: ['Pickup ZIP', null],
  rental_term: ['Rental term', null],
  rental_return: ['Rental return', null],
  note: ['Note', null],
};

const OPEN_RE = /\b(unanswered|unconfirmed|unknown|tbd|to confirm|not confirmed|still to|pending)\b/i;
const LONG = 110;

const PAL = {
  light: {
    label: '#94a3b8', value: '#0f172a', title: '#0f172a', sub: '#64748b',
    blockBg: '#f8fafc', blockBorder: '#0883F7', rule: '#eef2f7',
    cardBg: '#f8fafc', cardBorder: '#e8edf3',
    warnBg: '#fffbeb', warnBorder: '#fde68a', warnHead: '#92400e', warnText: '#92400e', warnKey: '#78350f', warnDot: '#b45309',
    pill: {
      green: ['#065f46', '#d1fae5', '#a7f3d0'],
      amber: ['#92400e', '#fef3c7', '#fde68a'],
      gray:  ['#334155', '#f1f5f9', '#e2e8f0'],
    },
  },
  dark: {
    label: '#8ea2c3', value: '#eaf1fb', title: '#eaf1fb', sub: '#9fb0ca',
    blockBg: 'rgba(255,255,255,.04)', blockBorder: '#0883F7', rule: 'rgba(255,255,255,.08)',
    cardBg: 'rgba(255,255,255,.04)', cardBorder: 'rgba(255,255,255,.08)',
    warnBg: 'rgba(245,158,11,.12)', warnBorder: 'rgba(245,158,11,.35)', warnHead: '#fcd9a2', warnText: '#e8c48a', warnKey: '#fcd9a2', warnDot: '#fbbf24',
    pill: {
      green: ['#34d399', 'rgba(22,163,74,.16)', 'rgba(52,211,153,.35)'],
      amber: ['#fbbf24', 'rgba(217,119,6,.16)', 'rgba(251,191,36,.35)'],
      gray:  ['#cbd5e1', 'rgba(148,163,184,.12)', 'rgba(203,213,225,.25)'],
    },
  },
};
const palOf = (t) => PAL[t === 'dark' ? 'dark' : 'light'];

const labelFor = (k) => {
  const known = EQ_LABELS[k];
  if (known) return known[0];
  const s = String(k).replace(/_/g, ' ').replace(/\bin\b$/, '').replace(/\blbs\b/, 'lb').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const unitFor = (k) => (EQ_LABELS[k] ? EQ_LABELS[k][1] : (/_in$/.test(k) ? 'in' : /_lbs$/.test(k) ? 'lb' : /_miles$/.test(k) ? 'mi' : null));

function pill(P, txt, tone) {
  const c = P.pill[tone] || P.pill.gray;
  return el('span', { style: 'display:inline-block;padding:2px 9px;border-radius:99px;font-size:.76rem;font-weight:800;color:' + c[0] + ';background:' + c[1] + ';border:1px solid ' + c[2] }, txt);
}

function fieldBox(P, label, valueNode) {
  return el('div', null, [
    el('div', { style: 'font-size:.66rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:' + P.label }, label),
    el('div', { style: 'font-weight:700;margin-top:2px;font-size:.92rem;word-break:break-word;color:' + P.value }, valueNode),
  ]);
}

function head(P, title, subtitle, right) {
  if (title === null) return subtitle ? el('div', { style: 'margin:2px 0 10px;font-size:.82rem;color:' + P.sub }, subtitle) : null;
  return el('div', null, [
    el('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap' }, [
      el('h4', { class: 'cc-card-title', style: 'margin:0;font-size:1rem;font-weight:800;color:' + P.title }, title),
      right || null,
    ]),
    subtitle ? el('div', { style: 'margin:2px 0 10px;font-size:.82rem;color:' + P.sub }, subtitle) : null,
  ]);
}

/**
 * Render an equipment_detail bag as labelled fields plus an "open questions" panel.
 * @returns {HTMLElement|null} null when there is nothing to show
 */
export function equipmentDetailCard(detail, opts) {
  const o = opts || {};
  const P = palOf(o.theme);
  const forCarrier = o.audience === 'carrier';
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) return null;
  const keys = Object.keys(detail).filter((k) => detail[k] != null && detail[k] !== '');
  if (!keys.length) return null;

  const facts = [];   // short, settled values
  const blocks = [];  // long prose, full width
  const open = [];    // gaps someone still has to answer

  keys.forEach((k) => {
    const raw = detail[k];
    const label = labelFor(k);
    if (typeof raw === 'boolean') { facts.push(fieldBox(P, label, pill(P, raw ? 'Yes' : 'No', raw ? 'green' : 'gray'))); return; }
    if (typeof raw === 'number') {
      const u = unitFor(k);
      facts.push(fieldBox(P, label, Number(raw).toLocaleString() + (u ? ' ' + u : '')));
      return;
    }
    const s = String(raw).trim();
    if (OPEN_RE.test(s)) { open.push({ label: label, text: s }); return; }
    if (s.length > LONG || s.indexOf('\n') >= 0) { blocks.push({ label: label, text: s }); return; }
    const u = unitFor(k);
    facts.push(fieldBox(P, label, s + (u && /^[\d.,]+$/.test(s) ? ' ' + u : '')));
  });

  const kids = [
    head(P, o.title === undefined ? '🧰 Equipment & operating detail' : o.title, o.subtitle,
      open.length ? pill(P, open.length + ' open question' + (open.length === 1 ? '' : 's'), 'amber') : null),
    facts.length ? el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px 18px;margin-top:10px' }, facts) : null,
  ];

  blocks.forEach((b) => {
    kids.push(el('div', { style: 'margin-top:12px;border-left:3px solid ' + P.blockBorder + ';background:' + P.blockBg + ';border-radius:0 10px 10px 0;padding:9px 13px' }, [
      el('div', { style: 'font-size:.66rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:' + P.label }, b.label),
      el('div', { style: 'margin-top:3px;font-size:.88rem;line-height:1.55;white-space:pre-line;color:' + P.value }, b.text),
    ]));
  });

  if (open.length) {
    kids.push(el('div', { style: 'margin-top:14px;background:' + P.warnBg + ';border:1px solid ' + P.warnBorder + ';border-radius:12px;padding:11px 14px' }, [
      el('div', { style: 'font-weight:800;font-size:.86rem;color:' + P.warnHead },
        forCarrier ? 'We still need these from you' : 'Open questions — nobody has answered these yet'),
      el('div', { style: 'margin-top:7px;display:flex;flex-direction:column;gap:6px' }, open.map((q) => el('div', { style: 'display:flex;gap:9px;align-items:flex-start' }, [
        el('span', { style: 'font-weight:900;line-height:1.4;color:' + P.warnDot }, '•'),
        forCarrier
          ? el('div', { style: 'font-size:.86rem;font-weight:700;line-height:1.45;color:' + P.warnKey }, q.label)
          : el('div', { style: 'font-size:.85rem;line-height:1.45' }, [
              el('b', { style: 'color:' + P.warnKey }, q.label + ' — '),
              el('span', { style: 'color:' + P.warnText }, q.text),
            ]),
      ]))),
    ]));
  }
  return el('div', null, kids.filter(Boolean));
}

/**
 * Render a dated notes log as a timeline, newest first.
 * Lines shaped "YYYY-MM-DD: text" start a new entry; anything else continues the one above,
 * so an existing free-text note is never dropped just because it has no date.
 */
export function carrierNotesCard(notes, opts) {
  const o = opts || {};
  const P = palOf(o.theme);
  const raw = (notes == null ? '' : String(notes)).trim();
  if (!raw) return null;

  const entries = [];
  raw.split(/\r?\n/).forEach((line) => {
    const s = line.trim();
    if (!s) return;
    const m = /^(\d{4}-\d{2}-\d{2})\s*[:—-]\s*(.*)$/.exec(s);
    if (m) entries.push({ date: m[1], text: m[2] });
    else if (entries.length) entries[entries.length - 1].text += '\n' + s;
    else entries.push({ date: null, text: s });
  });
  entries.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));

  return el('div', null, [
    head(P, o.title === undefined ? '🗒 Dispatch notes' : o.title,
      o.subtitle === undefined ? (entries.length + ' entr' + (entries.length === 1 ? 'y' : 'ies') + ' · newest first') : o.subtitle, null),
    el('div', { style: 'display:flex;flex-direction:column;gap:9px' }, entries.map((e) => el('div', {
      style: 'display:flex;gap:12px;align-items:flex-start;border-radius:12px;padding:10px 13px;background:' + P.cardBg + ';border:1px solid ' + P.cardBorder,
    }, [
      el('div', { style: 'flex:none;min-width:88px' }, e.date
        ? pill(P, e.date, 'gray')
        : el('span', { style: 'font-size:.76rem;font-weight:700;color:' + P.label }, 'undated')),
      el('div', { style: 'font-size:.87rem;line-height:1.6;white-space:pre-line;min-width:0;color:' + P.value }, e.text),
    ]))),
  ].filter(Boolean));
}

export default { equipmentDetailCard, carrierNotesCard, EQ_LABELS };
