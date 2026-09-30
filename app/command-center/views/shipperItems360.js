// shipperItems360.js — Shipper 360 → Two-lane verification → the A–G items (30 Sep 2026).
// Review layout: progress header, A–G section tiles, filter chips, one row per item (status, type, time) that opens to
// readable fields and a decision bar. Items waiting on staff open by default; everything else stays one line.
// Actions come in from shipperVerify360.js (verify / reject / docVerify) so the RPC calls and dialogs stay there.
import { el } from '../../shared/ui/dom.js';
import { pill } from './partner360-kit.js';
import { isOldPacket } from './shipperPlaybook360.js';

export const SECTIONS = [
  ['identity', 'A', 'Identity', 'Legal entity, address, signer, email & phone, call-back'],
  ['billing', 'B', 'Billing & credit', 'Payment terms, invoicing, AP contact, credit'],
  ['agreements', 'C', 'Agreements', 'Platform Terms and Shipper–Carrier Terms'],
  ['cargo', 'D', 'Cargo & liability', 'What ships, cover required, declared value, claims'],
  ['special', 'E', 'Special freight', 'Hazmat, food / sanitary, high value'],
  ['facilities', 'F', 'Locations', 'Docks carriers pick up from or deliver to'],
  ['acks', 'G', 'Acknowledgements', 'Driver safety, accurate declarations, carrier choice'],
];

const TYPE = { form: 'Form', upload: 'Document', staff: 'Staff check', system: 'Automatic', accept: 'Signature', ack: 'Acknowledgement', legacy: 'Legacy' };
const STAFF_HINT = {
  registry_check: 'Done on the State registry check card above.',
  independent_callback: 'Done with Independent call-back above — on a number you found yourself.',
};
const isDone = (s) => s === 'verified' || s === 'waived';
function statusOf(i) {
  if (i.status === 'verified') return ['green', '✓', 'Verified'];
  if (i.status === 'waived') return ['green', '✓', 'Waived'];
  if (i.status === 'submitted') return ['amber', '!', 'Awaiting review'];
  if (i.status === 'rejected') return ['red', '✕', 'Rejected — with shipper'];
  if (i.status === 'unavailable') return ['blue', 'i', 'Not available yet'];
  return i.type === 'staff' ? ['violet', '◆', 'Staff to do'] : ['gray', '○', 'With shipper'];
}
const bucket = (i) => i.status === 'submitted' ? 'review' : i.status === 'rejected' ? 'rejected' : isDone(i.status) ? 'done' : 'shipper';

// ---- field formatting ---------------------------------------------------------------------------------------------
const ACR = { ein: 'EIN', dba: 'DBA', duns: 'D-U-N-S', phmsa: 'PHMSA', ap: 'AP', po: 'PO', bol: 'BOL', pod: 'POD', id: 'ID', url: 'URL' };
const LABEL = {
  legal_name: 'Legal name', entity_type: 'Entity type', entity_number: 'State entity no.', state_of_formation: 'State of formation',
  mailing_same: 'Mailing address', invoice_email: 'Invoice email', required_docs: 'Docs with each invoice', trade_refs: 'Trade references',
  bank_ref: 'Bank reference', monthly_loads: 'Loads per month', years_in_business: 'Years in business', max_value: 'Max load value',
  typical_value: 'Typical load value', min_cargo: 'Min. cargo cover', min_auto_liability: 'Min. auto liability', min_cargo_cover: 'Min. cargo cover',
  body_sha256: 'Signed text (SHA-256)', temp_controlled: 'Temperature-controlled', food_grade: 'Food grade', phmsa_status: 'PHMSA registration',
  phmsa_number: 'PHMSA no.', emergency_phone: '24/7 emergency phone', emergency_contact: 'Emergency response', training_ack: 'Hazmat training confirmed',
  shipping_papers_ack: 'Shipping papers confirmed', tracking_ack: 'Live tracking required', written_ack: 'Written instructions to carrier',
  precool: 'Pre-cool required', prior_cargo: 'Prior-cargo restriction', other_commodity: 'Other commodity', policy: 'Declared value', terms: 'Payment terms',
};
const VAL = {
  llc: 'LLC', corp: 'Corporation', corporation: 'Corporation', inc: 'Inc.', sole_prop: 'Sole proprietor', sole_proprietor: 'Sole proprietor',
  partnership: 'Partnership', net_7: 'Net 7', net_15: 'Net 15', net_30: 'Net 30', net_45: 'Net 45', net_60: 'Net 60', quick_pay: 'Quick pay',
  full_value: 'Full value', dry_van: 'Dry van', not_required: 'Not required', none: 'None',
};
const cap = (s) => s ? s[0].toUpperCase() + s.slice(1) : s;
const humanKey = (k) => LABEL[k] || cap(k.split('_').map((w) => ACR[w] || w).join(' '));
const humanVal = (s) => VAL[s] || ACR[s] || (/^[a-z0-9]+(_[a-z0-9]+)+$/.test(s) ? cap(s.split('_').map((w) => ACR[w] || w).join(' ')) : s);
const MONEY = /value|cargo|cover|liability/;
const HIDE = new Set(['confirmed', 'text', 'accepted']);
const ADDR = ['street', 'city', 'state', 'zip'];

function chip(t, tone) { return el('span', { class: 'svi-chip' + (tone ? ' svi-' + tone : '') }, t); }
function valueNode(k, v) {
  if (v == null || v === '' || (Array.isArray(v) && !v.length)) return el('span', { class: 'svi-muted' }, '—');
  if (typeof v === 'boolean') return k === 'mailing_same' ? el('span', null, v ? 'Same as physical' : 'Different — see note') : chip(v ? 'Yes' : 'No', v ? 'green' : 'gray');
  if (typeof v === 'number') return el('span', { class: 'svi-num' }, MONEY.test(k) ? '$' + v.toLocaleString('en-US') : v.toLocaleString('en-US'));
  if (Array.isArray(v)) {
    if (v.every((x) => typeof x !== 'object')) return el('span', { class: 'svi-chips' }, v.map((x) => chip(humanVal(String(x)))));
    return el('div', { class: 'svi-refs' }, v.map((x) => el('div', { class: 'svi-ref' }, Object.values(x || {}).filter(Boolean).map((p, n) => n ? [el('span', { class: 'svi-dot' }, '·'), String(p)] : el('b', null, String(p))))));
  }
  if (typeof v === 'object') return el('span', { class: 'svi-mono' }, JSON.stringify(v));
  const s = String(v);
  if (/^[0-9a-f]{40,}$/i.test(s)) return el('span', { class: 'svi-mono', title: s }, s.slice(0, 12) + '…' + s.slice(-6));
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) return el('a', { class: 'svi-link', href: 'mailto:' + s }, s);
  if (/phone/.test(k) && /^\+?[\d\s().-]{10,}$/.test(s)) return el('a', { class: 'svi-link', href: 'tel:' + s.replace(/[^\d+]/g, '') }, s);
  return el('span', null, humanVal(s));
}
function fieldGrid(d) {
  if (!d || typeof d !== 'object') return null;
  const rows = [];
  if (ADDR.some((k) => d[k])) rows.push(['Address', el('span', null, [d.street, d.city, [d.state, d.zip].filter(Boolean).join(' ')].filter(Boolean).join(', '))]);
  Object.keys(d).filter((k) => !HIDE.has(k) && !ADDR.includes(k)).forEach((k) => rows.push([humanKey(k), valueNode(k, d[k])]));
  if (!rows.length) return null;
  return el('div', { class: 'svi-grid' }, rows.map(([k, v]) => el('div', { class: 'svi-f' }, [el('div', { class: 'svi-k' }, k), el('div', { class: 'svi-v' }, v)])));
}
function ackBlock(d) {
  if (!d || !d.text) return null;
  return el('div', { class: 'svi-quote' }, [el('div', null, d.text), d.accepted ? el('div', { class: 'svi-quote-by' }, '✓ Accepted by the shipper') : null]);
}
function warnBlock(d) {
  const c = d && Array.isArray(d.confirmed) ? d.confirmed.filter(Boolean) : [];
  if (!c.length) return null;
  return el('div', { class: 'svi-callout svi-amber' }, [el('b', null, '⚠ Kept after a warning'), ...c.map((x) => el('div', null, x))]);
}
const when = (t) => { if (!t) return null; const d = new Date(t); return isNaN(d) ? String(t).slice(0, 16) : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); };

// One line for a closed row, so a reviewer rarely has to open a done item ("Net 30", "Test AP Clerk · ap@…").
function summaryOf(i) {
  const d = i.data;
  if (!d || typeof d !== 'object') return null;
  if (i.type === 'accept') return d.version ? 'Signed v' + d.version : 'Signed';
  if (i.type === 'ack') return d.accepted ? 'Accepted' : null;
  if (ADDR.some((k) => d[k])) return [d.street, d.city, [d.state, d.zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const txt = (k, v) => typeof v === 'number' ? (MONEY.test(k) ? '$' + v.toLocaleString('en-US') : String(v))
    : Array.isArray(v) ? (v.every((x) => typeof x !== 'object') ? v.map((x) => humanVal(String(x))).join(', ') : v.length + ' ' + humanKey(k).toLowerCase())
    : typeof v === 'string' && !/^[0-9a-f]{40,}$/i.test(v) ? humanVal(v) : null;
  const parts = Object.keys(d).filter((k) => !HIDE.has(k)).map((k) => d[k] === '' || d[k] == null ? null : txt(k, d[k])).filter(Boolean).slice(0, 2);
  const out = parts.join(' · ');
  return out.length > 90 ? out.slice(0, 88) + '…' : out || null;
}

// ---- one item -----------------------------------------------------------------------------------------------------
function itemRow(i, act) {
  const [tone, icon, label] = statusOf(i);
  const opened = i.status === 'submitted' || i.status === 'rejected';
  const meta = [TYPE[i.type] || i.type, opened ? null : summaryOf(i), i.submitted_at ? 'submitted ' + when(i.submitted_at) : null, isDone(i.status) && i.reviewed_at ? 'reviewed ' + when(i.reviewed_at) : null].filter(Boolean).join(' · ');
  const canDecide = act.manage && ['form', 'upload'].includes(i.type) && i.status === 'submitted';
  const old = isOldPacket(i);
  const body = [
    i.key === 'legal_entity' && i.data ? el('div', { class: 'svi-hint' }, 'Compare with the state record on the State registry check card above.') : null,
    STAFF_HINT[i.key] && !isDone(i.status) ? el('div', { class: 'svi-hint' }, STAFF_HINT[i.key]) : null,
    i.type === 'ack' ? ackBlock(i.data) : fieldGrid(i.data),
    warnBlock(i.data),
    i.file_path ? el('div', { class: 'svi-file' }, [el('span', { class: 'svi-file-ico' }, 'PDF'), el('span', null, i.file_path.split('/').pop())]) : null,
    old ? el('div', { class: 'svi-callout svi-amber' }, [
      pill('amber', 'Old packet — answers not in the new form'),
      i.ref ? el('div', { class: 'svi-pre' }, i.ref) : el('div', null, 'No answer text on file.'),
      el('div', { class: 'svi-small' }, 'Submitted before the two-lane form (bl_ship_0491). It cannot be verified as-is — reject it so the shipper fills the new form.'),
    ]) : null,
    i.note ? el('div', { class: 'svi-callout svi-red' }, [el('b', null, 'Note to shipper: '), i.note]) : null,
    !i.data && !i.file_path && !old && !STAFF_HINT[i.key] ? el('div', { class: 'svi-muted svi-small' }, isDone(i.status) ? 'Confirmed automatically — nothing to read.' : 'Nothing submitted yet.') : null,
    canDecide ? el('div', { class: 'svi-decide' }, [
      el('span', { class: 'svi-decide-t' }, 'Your decision'),
      ['ein_letter', 'address_proof'].includes(i.key)
        ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: () => act.docVerify(i) }, 'Verify vs registry')
        : old ? null  // bl_ship_0504: nothing structured to verify — the server refuses it too; Reject asks for the new form
        : el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: () => act.verify(i) }, 'Verify'),
      el('button', { class: 'lb-btn lb-btn-sm svi-reject', onClick: () => act.reject(i) }, 'Reject'),
    ]) : null,
  ].filter(Boolean);
  return el('details', { class: 'svi-item', open: opened || null }, [
    el('summary', { class: 'svi-row' }, [
      el('span', { class: 'svi-ico svi-' + tone }, icon),
      el('span', { class: 'svi-main' }, [el('span', { class: 'svi-label' }, i.label), el('span', { class: 'svi-meta' }, meta)]),
      el('span', { class: 'svi-status svi-' + tone }, label),
      el('span', { class: 'svi-chev', 'aria-hidden': 'true' }, '›'),
    ]),
    el('div', { class: 'svi-body' }, body),
  ]);
}

// ---- the panel ----------------------------------------------------------------------------------------------------
const FILTERS = [['all', 'All'], ['review', 'Needs review'], ['rejected', 'Rejected'], ['shipper', 'With shipper'], ['done', 'Done']];

export function itemsPanel(items, act) {
  injectCss();
  const list = (items || []).filter((i) => i.active);
  const bySec = {}; list.forEach((i) => { (bySec[i.section] = bySec[i.section] || []).push(i); });
  const secs = SECTIONS.filter(([k]) => bySec[k]);
  const shown = secs.flatMap(([k]) => bySec[k]);
  const n = { all: shown.length, review: 0, rejected: 0, shipper: 0, done: 0 };
  shown.forEach((i) => { n[bucket(i)]++; });
  const pct = (a, b) => Math.round(100 * a / Math.max(b, 1));
  let filter = n.review ? 'review' : 'all';

  const listHost = el('div', { class: 'svi-list' });
  const secNodes = {};
  const filterBar = el('div', { class: 'svi-filters', role: 'tablist' });
  const paintFilters = () => filterBar.replaceChildren(...FILTERS.map(([k, t]) => el('button', {
    class: 'svi-filter' + (filter === k ? ' on' : ''), role: 'tab', 'aria-selected': filter === k ? 'true' : 'false',
    onClick: () => { filter = k; paint(); },
  }, [t, el('span', { class: 'svi-count' }, String(n[k]))])));
  function paint() {
    paintFilters();
    const cards = secs.map(([k, letter, title, blurb]) => {
      const its = bySec[k]; const done = its.filter((i) => isDone(i.status)).length;
      const vis = its.filter((i) => filter === 'all' || bucket(i) === filter);
      if (!vis.length) return null;
      const node = el('section', { class: 'svi-sec' }, [
        el('div', { class: 'svi-sec-head' }, [
          el('span', { class: 'svi-letter' + (done === its.length ? ' ok' : '') }, letter),
          el('div', { class: 'svi-sec-t' }, [el('b', null, title), el('small', null, blurb)]),
          el('span', { class: 'svi-sec-n' }, done + ' / ' + its.length),
        ]),
        el('div', { class: 'svi-bar thin' }, el('i', { style: 'width:' + pct(done, its.length) + '%' })),
        ...vis.map((i) => itemRow(i, act)),
      ]);
      secNodes[k] = node;
      return node;
    }).filter(Boolean);
    listHost.replaceChildren(...(cards.length ? cards : [el('div', { class: 'svi-empty' }, filter === 'review' ? '✓ All caught up — nothing is waiting for your review.' : 'Nothing here.')]));
  }
  const tiles = el('div', { class: 'svi-tiles' }, secs.map(([k, letter, title]) => {
    const its = bySec[k]; const done = its.filter((i) => isDone(i.status)).length;
    const rev = its.filter((i) => i.status === 'submitted').length, rej = its.filter((i) => i.status === 'rejected').length;
    return el('button', { class: 'svi-tile' + (done === its.length ? ' ok' : ''), title: title, onClick: () => {
      filter = 'all'; paint();
      const s = secNodes[k]; if (s && s.scrollIntoView) s.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } }, [
      el('span', { class: 'svi-tile-top' }, [el('span', { class: 'svi-letter sm' + (done === its.length ? ' ok' : '') }, letter), rev ? el('span', { class: 'svi-flag svi-amber' }, rev + ' to review') : rej ? el('span', { class: 'svi-flag svi-red' }, rej + ' rejected') : null]),
      el('span', { class: 'svi-tile-t' }, title),
      el('span', { class: 'svi-tile-n' }, done + ' of ' + its.length + ' done'),
      el('span', { class: 'svi-bar thin' }, el('i', { style: 'width:' + pct(done, its.length) + '%' })),
    ]);
  }));
  paint();
  const done = n.done;
  return el('div', { class: 'svi' }, [
    el('div', { class: 'svi-head' }, [
      el('div', { class: 'svi-head-l' }, [
        el('div', { class: 'svi-eyebrow' }, 'Verification items · A–G'),
        el('div', { class: 'svi-title' }, [el('span', { class: 'svi-big' }, String(done)), ' of ' + n.all + ' complete']),
      ]),
      el('div', { class: 'svi-kpis' }, [
        el('div', { class: 'svi-kpi k-amber' + (n.review ? '' : ' zero') }, [el('b', null, String(n.review)), el('span', null, 'awaiting your review')]),
        el('div', { class: 'svi-kpi k-red' + (n.rejected ? '' : ' zero') }, [el('b', null, String(n.rejected)), el('span', null, 'rejected')]),
        el('div', { class: 'svi-kpi k-gray' }, [el('b', null, String(n.shipper)), el('span', null, 'with shipper / staff')]),
      ]),
    ]),
    el('div', { class: 'svi-bar' }, el('i', { style: 'width:' + pct(done, n.all) + '%' })),
    tiles, filterBar, listHost,
  ]);
}

// ---- styles (once; tokens follow the 360 theme so dark mode stays right) -------------------------------------------
let _css = false;
function injectCss() {
  if (_css) return; _css = true;
  try {
    if (typeof document === 'undefined' || !document.head) return;
    document.head.appendChild(el('style', { html: `
.svi{--svi-ink:var(--p360-ink,#10223B);--svi-muted:var(--p360-muted,#64748b);--svi-line:var(--p360-line,#e2e8f0);--svi-surface:var(--p360-surface,#fff);--svi-soft:var(--p360-soft,#f5f8fc);margin-top:14px;color:var(--svi-ink)}
.svi-head{display:flex;justify-content:space-between;align-items:flex-end;gap:14px;flex-wrap:wrap}
.svi-eyebrow{font-size:.66rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--svi-muted)}
.svi-title{font-size:1rem;font-weight:700;margin-top:2px;color:var(--svi-muted)}
.svi-big{font-size:1.7rem;font-weight:800;letter-spacing:-.02em;color:var(--svi-ink);margin-right:2px}
.svi-kpis{display:flex;gap:8px;flex-wrap:wrap}
.svi-kpi{display:flex;align-items:baseline;gap:6px;border:1px solid var(--svi-line);border-radius:12px;padding:7px 12px;background:var(--svi-surface);font-size:.78rem;color:var(--svi-muted)}
.svi-kpi b{font-size:1.1rem;font-weight:800}
.svi-kpi.k-amber b{color:#d97706}.svi-kpi.k-red b{color:#dc2626}.svi-kpi.k-gray b{color:var(--svi-ink)}
.svi-kpi.k-amber:not(.zero){border-color:rgba(217,119,6,.45);background:rgba(245,158,11,.08)}
.svi-kpi.k-red:not(.zero){border-color:rgba(220,38,38,.4);background:rgba(220,38,38,.06)}
.svi-kpi.zero b{color:var(--svi-muted)}
.svi-bar{height:8px;border-radius:99px;background:var(--svi-soft);border:1px solid var(--svi-line);overflow:hidden;margin-top:12px}
.svi-bar.thin{height:5px;border:0;margin-top:8px}
.svi-bar i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#0883F7,#16a34a);transition:width .3s ease}
.svi-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-top:14px}
.svi-tile{all:unset;box-sizing:border-box;cursor:pointer;display:flex;flex-direction:column;gap:3px;padding:11px 12px;border:1px solid var(--svi-line);border-radius:14px;background:var(--svi-surface);transition:border-color .15s,box-shadow .15s,transform .15s}
.svi-tile:hover{border-color:#0883F7;box-shadow:0 8px 22px -14px rgba(8,131,247,.55);transform:translateY(-1px)}
.svi-tile:focus-visible{outline:2px solid #0883F7;outline-offset:2px}
.svi-tile-top{display:flex;justify-content:space-between;align-items:center;gap:6px;min-height:26px}
.svi-tile-t{font-weight:800;font-size:.86rem;margin-top:4px}
.svi-tile-n{font-size:.74rem;color:var(--svi-muted)}
.svi-letter{width:34px;height:34px;border-radius:10px;flex:none;display:inline-flex;align-items:center;justify-content:center;font-weight:800;color:#fff;background:linear-gradient(135deg,#0b1b33,#1d3b66)}
.svi-letter.sm{width:26px;height:26px;border-radius:8px;font-size:.8rem}
.svi-letter.ok{background:linear-gradient(135deg,#16a34a,#0f7a37)}
.svi-flag{font-size:.66rem;font-weight:800;border-radius:99px;padding:2px 7px}
.svi-filters{display:flex;gap:6px;flex-wrap:wrap;margin-top:16px;padding-bottom:10px;border-bottom:1px solid var(--svi-line)}
.svi-filter{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:99px;border:1px solid var(--svi-line);font-size:.8rem;font-weight:700;color:var(--svi-muted);background:var(--svi-surface)}
.svi-filter:hover{color:var(--svi-ink);border-color:var(--svi-muted)}
.svi-filter:focus-visible{outline:2px solid #0883F7;outline-offset:2px}
.svi-filter.on{background:var(--svi-ink);border-color:var(--svi-ink);color:var(--svi-surface)}
.svi-count{font-size:.7rem;font-weight:800;padding:1px 7px;border-radius:99px;background:var(--svi-soft);color:var(--svi-muted)}
.svi-filter.on .svi-count{background:rgba(255,255,255,.2);color:inherit}
.svi-list{display:flex;flex-direction:column;gap:14px;margin-top:14px}
.svi-sec{border:1px solid var(--svi-line);border-radius:16px;background:var(--svi-surface);padding:14px 16px 6px;scroll-margin-top:80px;box-shadow:0 1px 2px rgba(15,23,42,.04)}
.svi-sec-head{display:flex;align-items:center;gap:12px}
.svi-sec-t{flex:1;min-width:0;display:flex;flex-direction:column}
.svi-sec-t b{font-size:.98rem;font-weight:800}
.svi-sec-t small{font-size:.76rem;color:var(--svi-muted)}
.svi-sec-n{font-size:.8rem;font-weight:800;color:var(--svi-muted);white-space:nowrap}
.svi-item{border-top:1px solid var(--svi-line)}
.svi-sec .svi-bar.thin + .svi-item{margin-top:10px}
.svi-row{list-style:none;display:flex;align-items:center;gap:12px;padding:12px 2px;cursor:pointer}
.svi-row::-webkit-details-marker{display:none}
.svi-row:hover .svi-label{color:#0883F7}
.svi-row:focus-visible{outline:2px solid #0883F7;outline-offset:2px;border-radius:8px}
.svi-ico{width:26px;height:26px;border-radius:50%;flex:none;display:inline-flex;align-items:center;justify-content:center;font-weight:800;font-size:.8rem}
.svi-main{flex:1;min-width:0;display:flex;flex-direction:column}
.svi-label{font-weight:700;font-size:.9rem;transition:color .15s}
.svi-meta{font-size:.74rem;color:var(--svi-muted);margin-top:1px}
.svi-status{font-size:.72rem;font-weight:800;border-radius:99px;padding:3px 10px;white-space:nowrap}
.svi-chev{color:var(--svi-muted);font-size:1.2rem;line-height:1;transition:transform .15s;width:12px;text-align:center}
.svi-item[open] .svi-chev{transform:rotate(90deg)}
.svi-body{padding:0 2px 14px 38px;display:flex;flex-direction:column;gap:10px}
.svi-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));border:1px solid var(--svi-line);border-radius:12px;overflow:hidden;background:var(--svi-surface)}
.svi-f{padding:9px 12px;min-width:0;box-shadow:1px 0 0 var(--svi-line),0 1px 0 var(--svi-line)}
.svi-k{font-size:.68rem;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--svi-muted)}
.svi-v{font-size:.86rem;margin-top:3px;word-break:break-word}
.svi-num{font-variant-numeric:tabular-nums;font-weight:700}
.svi-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.78rem}
.svi-link{color:#0883F7;text-decoration:none}.svi-link:hover{text-decoration:underline}
.svi-chips{display:inline-flex;flex-wrap:wrap;gap:4px}
.svi-chip{display:inline-block;font-size:.74rem;font-weight:700;border-radius:8px;padding:2px 8px;background:var(--svi-soft);border:1px solid var(--svi-line)}
.svi-refs{display:flex;flex-direction:column;gap:4px}
.svi-ref{font-size:.82rem}.svi-dot{margin:0 6px;color:var(--svi-muted)}
.svi-quote{border-left:3px solid #0883F7;background:var(--svi-soft);border-radius:0 10px 10px 0;padding:10px 14px;font-size:.84rem;line-height:1.55}
.svi-quote-by{margin-top:6px;font-size:.74rem;font-weight:800;color:#16a34a}
.svi-callout{border-radius:10px;padding:9px 12px;font-size:.82rem;line-height:1.5;display:flex;flex-direction:column;gap:4px}
.svi-pre{white-space:pre-wrap}
.svi-hint{font-size:.8rem;color:var(--svi-muted)}
.svi-small{font-size:.76rem}.svi-muted{color:var(--svi-muted)}
.svi-file{display:inline-flex;align-items:center;gap:8px;font-size:.82rem;border:1px solid var(--svi-line);border-radius:10px;padding:6px 10px;align-self:flex-start}
.svi-file-ico{font-size:.6rem;font-weight:800;color:#fff;background:#dc2626;border-radius:4px;padding:2px 4px}
.svi-decide{display:flex;align-items:center;gap:8px;flex-wrap:wrap;border-top:1px dashed var(--svi-line);padding-top:10px}
.svi-decide-t{font-size:.72rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--svi-muted);margin-right:auto}
.svi-reject{color:#b91c1c}
.svi-empty{border:1px dashed var(--svi-line);border-radius:14px;padding:22px;text-align:center;color:var(--svi-muted);font-weight:700}
.svi-green{background:rgba(22,163,74,.12);color:#15803d}
.svi-amber{background:rgba(245,158,11,.14);color:#b45309}
.svi-red{background:rgba(220,38,38,.1);color:#b91c1c}
.svi-blue{background:rgba(8,131,247,.1);color:#1d4ed8}
.svi-violet{background:rgba(124,58,237,.1);color:#6d28d9}
.svi-gray{background:var(--svi-soft);color:var(--svi-muted)}
.svi-callout.svi-amber,.svi-callout.svi-red{color:var(--svi-ink)}
.svi-callout.svi-amber{border:1px solid rgba(245,158,11,.4)}.svi-callout.svi-red{border:1px solid rgba(220,38,38,.35)}
@media(max-width:640px){.svi-body{padding-left:2px}.svi-status{display:none}.svi-grid{grid-template-columns:1fr}.svi-tiles{grid-template-columns:repeat(2,1fr)}.svi-decide-t{width:100%}.svi-decide .lb-btn{flex:1}}
` }));
  } catch (_) { /* no DOM (tests) */ }
}
