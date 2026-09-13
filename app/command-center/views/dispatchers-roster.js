// dispatchers-roster.js — the CC dispatcher ROSTER at scale (bl_disp_0313).
//
// Yaseen 13 Sep 2026: "at a time 1 million tak dispatcher ko manage kar sakay … premium, useful".
// The old paint() pulled every profile into the browser and filtered client-side. This module never
// holds more than the pages the operator has scrolled: search / stage filter / paging are all
// server-side (cc_dispatchers_page, keyset on created_at+user_id, 50 a page), and the numbers on
// top come from one cheap cc_dispatchers_stats() call, not from counting rows in memory.
//
// Contract with dispatchers.js (kept small on purpose): renderRoster(host, ctx) → { refresh, repaint }
//   ctx.open360(x)      opens the 360 drawer for a row (unchanged)
//   ctx.pill(status)    the existing stage pill
//   ctx.signals(x)      → array of extra pill nodes (RC to approve / unread / owed) from the live queue
//   ctx.onRows(rows)    hands the visible rows back so deep links + old code paths keep working
import { el, mount } from '../../shared/ui/dom.js';
import { fmtDate } from '../../shared/ui/components.js';
import { ccDispatchersPage, ccDispatchersStats } from '../../shared/api.js';
import { humanizeError } from '../../shared/errors.js';

const STAGES = [
  ['screening', 'Screening', '#d97706'], ['skills_test', 'Skills test', '#7c3aed'], ['trial', 'Trial', '#0883F7'],
  ['verified', 'Verified', '#059669'], ['active', 'Active', '#10223B'], ['applied', 'Applied', '#64748b'],
  ['suspended', 'Suspended', '#b45309'], ['rejected', 'Rejected', '#9f1239'],
];
const LABEL = Object.fromEntries(STAGES.map((s) => [s[0], s[1]]));
const COLOR = Object.fromEntries(STAGES.map((s) => [s[0], s[2]]));
const PAGE = 50;

let cssDone = false;
function css() {
  if (cssDone) return; cssDone = true;
  document.head.appendChild(el('style', null, `
.dr{--n:#10223B;--b:#0883F7;--o:#FC5305;--line:#e6ebf2;--mut:#64748b}
.dr-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:10px;margin-bottom:12px}
.dr-stat{position:relative;border:1px solid var(--line);border-radius:14px;padding:12px 14px;background:#fff;cursor:pointer;transition:transform .12s,box-shadow .12s;text-align:left}
.dr-stat:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(16,34,59,.08)}
.dr-stat.on{border-color:var(--b);box-shadow:0 0 0 3px rgba(8,131,247,.14)}
.dr-stat b{display:block;font-size:1.45rem;font-weight:900;color:var(--n);line-height:1.1;font-variant-numeric:tabular-nums}
.dr-stat span{display:block;font-size:.72rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--mut);margin-top:3px}
.dr-stat i{position:absolute;left:14px;right:14px;bottom:0;height:3px;border-radius:3px 3px 0 0}
.dr-funnel{display:flex;height:8px;border-radius:8px;overflow:hidden;background:#eef2f7;margin:0 0 14px}
.dr-funnel div{transition:width .3s}
.dr-bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:10px}
.dr-search{position:relative;flex:1;min-width:240px;max-width:420px}
.dr-search input{width:100%;padding:10px 12px 10px 38px;border:1px solid var(--line);border-radius:12px;font:inherit;background:#fff;outline:none}
.dr-search input:focus{border-color:var(--b);box-shadow:0 0 0 3px rgba(8,131,247,.14)}
.dr-search svg{position:absolute;left:12px;top:50%;transform:translateY(-50%);width:16px;height:16px;color:var(--mut)}
.dr-kbd{font:700 .68rem/1 ui-monospace,monospace;border:1px solid var(--line);border-radius:5px;padding:3px 5px;color:var(--mut);background:#f8fafc}
.dr-tbl{border:1px solid var(--line);border-radius:16px;overflow:hidden;background:#fff}
.dr-h,.dr-r{display:grid;grid-template-columns:28px minmax(220px,2fr) minmax(120px,1fr) 118px 96px minmax(160px,1.4fr) 92px;gap:12px;align-items:center;padding:0 14px}
.dr-h{height:38px;background:#f8fafc;border-bottom:1px solid var(--line);font-size:.7rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--mut)}
.dr-r{min-height:60px;border-bottom:1px solid #f1f4f8;cursor:pointer;transition:background .1s}
.dr-r:last-child{border-bottom:0}.dr-r:hover,.dr-r.cur{background:#f4f8ff}.dr-r.cur{box-shadow:inset 3px 0 0 var(--b)}
.dr-r.sel{background:#fff7f2}
.dr-av{width:36px;height:36px;border-radius:12px;display:grid;place-items:center;color:#fff;font-weight:900;font-size:.82rem;flex:none}
.dr-who{display:flex;gap:11px;align-items:center;min-width:0}
.dr-who b{display:block;font-weight:800;color:var(--n);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dr-who small{display:block;color:var(--mut);font-size:.8rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dr-m{color:var(--mut);font-size:.84rem}
.dr-score{display:inline-flex;align-items:center;gap:7px;font-weight:800;font-size:.84rem}
.dr-ring{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font-size:.6rem;font-weight:900;color:var(--n)}
.dr-ring i{width:19px;height:19px;border-radius:50%;background:#fff;display:grid;place-items:center;font-style:normal}
.dr-sig{display:flex;gap:5px;flex-wrap:wrap}.dr-sig .cc-pill{font-size:.7rem}
.dr-empty{padding:40px;text-align:center;color:var(--mut)}
.dr-more{display:flex;justify-content:center;padding:12px}
.dr-chk{width:16px;height:16px;accent-color:var(--o);cursor:pointer}
.dr-bulk{display:flex;gap:8px;align-items:center;padding:8px 14px;background:#fff7f2;border-bottom:1px solid #fed7aa;font-size:.84rem}
@media (max-width:900px){.dr-h{display:none}.dr-r{grid-template-columns:28px 1fr;row-gap:6px}.dr-r>*:nth-child(n+3){grid-column:2}}
`));
}

const initials = (n) => { const p = String(n || '').trim().split(/\s+/).filter(Boolean).slice(0, 2); return p.length ? p.map((w) => w[0]).join('').toUpperCase() : '?'; };
const hue = (k) => { let h = 0; const s = String(k || ''); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 360; };
const ago = (iso) => { if (!iso) return '—'; const d = (Date.now() - new Date(iso).getTime()) / 864e5; if (d < 1) return 'today'; if (d < 2) return 'yesterday'; if (d < 30) return Math.floor(d) + 'd ago'; return fmtDate(iso); };
const num = (n) => Number(n || 0).toLocaleString('en-US');
const SEARCH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';

export function renderRoster(host, ctx) {
  css();
  const st = { q: '', stage: 'all', rows: [], more: false, loading: false, stats: null, cur: -1, sel: new Set(), seq: 0 };
  const statsBox = el('div'), funnel = el('div', { class: 'dr-funnel' }), tbl = el('div', { class: 'dr-tbl' }), count = el('span', { class: 'cc-sub' });
  const input = el('input', { placeholder: 'Search name, e-mail or country — press / to focus', value: '' });
  let tmr = null;
  input.oninput = () => { clearTimeout(tmr); tmr = setTimeout(() => { st.q = input.value.trim(); fetchFirst(); }, 260); };
  const stageSel = el('select', { class: 'lb-input', style: 'max-width:170px', onChange: (e) => { st.stage = e.target.value; fetchFirst(); } },
    [['all', 'All stages']].concat(STAGES.map((s) => [s[0], s[1]])).map(([v, l]) => el('option', { value: v }, l)));
  mount(host, el('div', { class: 'dr' }, [
    statsBox, funnel,
    el('div', { class: 'dr-bar' }, [
      el('div', { class: 'dr-search' }, [el('span', { html: SEARCH_ICON }), input]),
      stageSel, count,
      el('span', { class: 'cc-sub', style: 'margin-left:auto;display:flex;gap:6px;align-items:center' }, [el('span', { class: 'dr-kbd' }, '↑↓'), 'move', el('span', { class: 'dr-kbd' }, '↵'), 'open']),
    ]),
    tbl,
  ]));
  document.addEventListener('keydown', onKey);

  function onKey(e) {
    if (!document.body.contains(host)) { document.removeEventListener('keydown', onKey); return; }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName);
    if (e.key === '/' && !typing) { e.preventDefault(); input.focus(); return; }
    if (typing && document.activeElement !== input) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); st.cur = Math.max(0, Math.min(st.rows.length - 1, st.cur + (e.key === 'ArrowDown' ? 1 : -1))); paintRows(); const r = tbl.querySelector('.dr-r.cur'); if (r) r.scrollIntoView({ block: 'nearest' }); }
    else if (e.key === 'Enter' && st.cur >= 0 && st.rows[st.cur]) { e.preventDefault(); ctx.open360(st.rows[st.cur]); }
    else if (e.key === 'Escape' && document.activeElement === input) { input.value = ''; st.q = ''; input.blur(); fetchFirst(); }
  }

  // ------------------------------------------------------------------ data
  async function fetchStats() {
    const s = await ccDispatchersStats().catch(() => null);
    if (s && !s.error) { st.stats = s; paintStats(); }
  }
  async function fetchFirst() { st.rows = []; st.more = false; st.cur = -1; st.sel.clear(); await fetchPage(); }
  async function fetchPage() {
    if (st.loading) return; st.loading = true; const seq = ++st.seq;
    const last = st.rows[st.rows.length - 1];
    if (!st.rows.length) mount(tbl, el('div', { class: 'dr-empty' }, 'Loading…'));
    let r;
    try { r = await ccDispatchersPage({ q: st.q, status: st.stage, before: last ? last.applied_at : null, beforeId: last ? last.user_id : null, limit: PAGE }); }
    catch (e) { r = { error: humanizeError(e) }; }
    st.loading = false;
    if (seq !== st.seq) return;                       // a newer search superseded this one
    if (!r || r.error) { mount(tbl, el('div', { class: 'dr-empty' }, (r && r.error) || 'Could not load')); return; }
    st.rows = st.rows.concat(r.rows || []); st.more = !!r.has_more;
    if (ctx.onRows) ctx.onRows(st.rows);
    paintRows();
  }

  // ------------------------------------------------------------------ paint
  function paintStats() {
    const s = st.stats || {}; const by = s.by_status || {}; const total = Number(s.total || 0);
    const tile = (key, label, n, color, on) => el('button', { class: 'dr-stat' + (on ? ' on' : ''), onClick: () => { st.stage = key; stageSel.value = key; fetchFirst(); } },
      [el('b', null, num(n)), el('span', null, label), el('i', { style: 'background:' + color })]);
    mount(statsBox, el('div', { class: 'dr-stats' }, [
      tile('all', 'Dispatchers', total, 'var(--n)', st.stage === 'all'),
      tile('screening', 'Screening', by.screening, COLOR.screening, st.stage === 'screening'),
      tile('skills_test', 'Skills test', by.skills_test, COLOR.skills_test, st.stage === 'skills_test'),
      tile('trial', 'On trial', by.trial, COLOR.trial, st.stage === 'trial'),
      tile('active', 'Active', (Number(by.active || 0) + Number(by.verified || 0)), COLOR.verified, st.stage === 'active'),
      el('div', { class: 'dr-stat', style: 'cursor:default' }, [el('b', null, num(s.applied_7d)), el('span', null, 'Applied · 7 days'), el('i', { style: 'background:var(--o)' })]),
      el('div', { class: 'dr-stat', style: 'cursor:default' }, [el('b', { style: Number(s.tests_to_review) ? 'color:var(--o)' : '' }, num(s.tests_to_review)), el('span', null, 'Tests to review'), el('i', { style: 'background:var(--o)' })]),
    ]));
    mount(funnel, STAGES.filter((x) => by[x[0]]).map((x) => el('div', { title: x[1] + ' · ' + num(by[x[0]]), style: 'width:' + (100 * by[x[0]] / Math.max(1, total)) + '%;background:' + x[2] })));
  }

  function testCell(x) {
    const t = x.test; if (!t) return el('span', { class: 'dr-m' }, '—');
    if (t.status === 'scored' && t.score != null) {
      const pct = Math.round(100 * Number(t.score) / (Number(t.max) || 100)); const c = t.decision === 'pass' ? '#059669' : t.decision === 'fail' ? '#9f1239' : '#d97706';
      return el('span', { class: 'dr-score', title: (t.decision || 'scored') + (t.told ? ' · candidate told' : ' · NOT yet told') }, [
        el('span', { class: 'dr-ring', style: 'background:conic-gradient(' + c + ' ' + pct + '%,#e6ebf2 0)' }, el('i', null, String(t.score))),
        el('span', { style: 'color:' + c }, t.decision === 'pass' ? 'Pass' : t.decision === 'fail' ? 'Fail' : 'Scored'),
        t.told ? '' : el('span', { title: 'Not yet e-mailed', style: 'width:7px;height:7px;border-radius:50%;background:var(--o);display:inline-block' }),
      ]);
    }
    const m = { invited: ['Invited', '#64748b'], in_progress: ['Live now', '#0883F7'], submitted: ['To review', '#FC5305'], expired: ['Expired', '#9f1239'] }[t.status] || [t.status, '#64748b'];
    return el('span', { class: 'dr-score', style: 'color:' + m[1] }, m[0]);
  }

  function row(x, i) {
    const checked = st.sel.has(x.user_id);
    const chk = el('input', { type: 'checkbox', class: 'dr-chk', checked: checked ? '' : undefined,
      onClick: (e) => { e.stopPropagation(); if (e.target.checked) st.sel.add(x.user_id); else st.sel.delete(x.user_id); paintRows(); } });
    const sig = [];
    if (Number(x.open_rc)) sig.push(el('span', { class: 'cc-pill cc-pill-red' }, x.open_rc + ' RC to approve'));
    if (Number(x.moving)) sig.push(el('span', { class: 'cc-pill', style: 'background:#e8f2ff;color:#0b5cad' }, x.moving + ' moving'));
    if (Number(x.carriers)) sig.push(el('span', { class: 'cc-pill cc-pill-green' }, x.carriers + ' carrier' + (x.carriers > 1 ? 's' : '') + ' · ' + (x.active_trucks || 0) + ' trucks'));
    if (x.status === 'trial' && x.trial_end) { const d = Math.ceil((new Date(x.trial_end) - Date.now()) / 864e5); sig.push(el('span', { class: 'cc-pill cc-pill-amber' }, d >= 0 ? 'trial ends in ' + d + 'd' : 'trial overdue')); }
    try { (ctx.signals ? ctx.signals(x) : []).forEach((n) => n && sig.push(n)); } catch (_) {}
    return el('div', { class: 'dr-r' + (i === st.cur ? ' cur' : '') + (checked ? ' sel' : ''), onClick: () => { st.cur = i; ctx.open360(x); } }, [
      chk,
      el('div', { class: 'dr-who' }, [
        el('div', { class: 'dr-av', style: 'background:hsl(' + hue(x.user_id) + ' 55% 42%)' }, initials(x.name)),
        el('div', { style: 'min-width:0' }, [el('b', null, x.name || '(no name)'), el('small', null, x.email || '')]),
      ]),
      el('div', { class: 'dr-m' }, [el('div', { style: 'color:var(--n);font-weight:600' }, x.country || '—'), el('div', null, (x.years_exp || 0) + ' yrs exp' + (Number(x.commission_pct) > 0 ? ' · ' + x.commission_pct + '%' : ''))]),
      ctx.pill(x.status),
      testCell(x),
      el('div', { class: 'dr-sig' }, sig.length ? sig : el('span', { class: 'dr-m' }, '—')),
      el('div', { class: 'dr-m', title: fmtDate(x.applied_at) }, ago(x.applied_at)),
    ]);
  }

  function paintRows() {
    const kids = [];
    if (st.sel.size) kids.push(el('div', { class: 'dr-bulk' }, [
      el('b', null, st.sel.size + ' selected'),
      el('button', { class: 'lb-btn lb-btn-ghost', style: 'padding:4px 10px', onClick: () => { const em = st.rows.filter((r) => st.sel.has(r.user_id)).map((r) => r.email).filter(Boolean).join(', '); navigator.clipboard && navigator.clipboard.writeText(em); } }, 'Copy e-mails'),
      el('button', { class: 'lb-btn lb-btn-ghost', style: 'padding:4px 10px', onClick: () => { st.sel.clear(); paintRows(); } }, 'Clear'),
    ]));
    kids.push(el('div', { class: 'dr-h' }, [
      el('input', { type: 'checkbox', class: 'dr-chk', onClick: (e) => { if (e.target.checked) st.rows.forEach((r) => st.sel.add(r.user_id)); else st.sel.clear(); paintRows(); } }),
      'Dispatcher', 'Location · exp', 'Stage', 'Skills test', 'Signals', 'Applied']));
    if (!st.rows.length) kids.push(el('div', { class: 'dr-empty' }, st.q || st.stage !== 'all' ? 'No dispatchers match.' : 'No dispatchers yet.'));
    else st.rows.forEach((x, i) => kids.push(row(x, i)));
    if (st.more) {
      const btn = el('button', { class: 'lb-btn lb-btn-ghost', onClick: fetchPage }, st.loading ? 'Loading…' : 'Load ' + PAGE + ' more');
      kids.push(el('div', { class: 'dr-more' }, btn));
      if ('IntersectionObserver' in window) { const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); fetchPage(); } }); io.observe(btn); }
    }
    mount(tbl, kids);
    const shown = st.rows.length; const total = st.stats && (st.stage === 'all' ? st.stats.total : (st.stats.by_status || {})[st.stage]);
    count.textContent = st.q ? shown + (st.more ? '+' : '') + ' match' + (shown === 1 ? '' : 'es') : shown + (total != null ? ' of ' + num(total) : '') + ' shown';
  }

  fetchStats(); fetchFirst();
  return {
    refresh: () => { fetchStats(); return fetchFirst(); },  // after a decision / payout: first page + numbers again
    repaint: () => { paintStats(); paintRows(); },           // queue changed: re-derive the signal pills only
    rows: () => st.rows,
  };
}
