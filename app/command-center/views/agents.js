// lb-cdn-bump 2026-08-15: force fresh Netlify blob upload (corrupt-deploy recovery) — no code changes.
// agents.js — CC AGENTS module: every agent, full 360 — application + docs, chain,
// downline (levels 2–5), earnings, payouts, message thread, notify/email. Built for
// hundreds of agents: search + status filter + sortable summary table.
import { el, mount } from '../../shared/ui/dom.js';
import { icon } from '../../shared/ui/icons.js';

import { money, fmtDate, fmtDateTime, card, sectionHead, askReason, askConfirm } from '../../shared/ui/components.js';
import { ccAgentReferralActivity } from '../../shared/api.js';  // bl_agent_0406
import { ccAgentsList, ccAgent360, ccAgentDecide, ccAgentMsgs, ccAgentMsgSend, ccAgentNotifySend, ccAgentDocReview, referralPayoutDecide, referralPayoutQueue, agentSuspend, ccAgentPayoutVerify, ccAgentPayoutRequestDetails, ccAgentPayoutApproveMethod } from '../../shared/api.js';
import { signedDocumentUrl } from '../../shared/storage.js';
import { humanizeError, toast } from '../../shared/errors.js';

export function renderAgents(host) {
  // bl_agent_0402 — TRACK filter. Every agent-portal signup used to get a referral row, so this
  // list showed 131 "partners" of whom ~100 were dispatcher applicants who never chose the
  // program. Default = people who opted in (opted_in_at set). The rest stay one filter away.
  const state = { q: '', st: 'all', track: 'opted', rows: [], sort: 'joined', asc: false, need: false };
  // bl_agent_0405: sole partners vs dual-track (dispatcher + partner → listed under Dispatchers) vs dispatcher-only vs idle
  const trackOf = (x) => x.kind !== 'affiliate' ? 'codes' : (x.dispatcher_status || x.intent === 'both' || x.intent === 'dispatcher') ? (x.opted_in_at ? 'both' : 'disp') : (x.opted_in_at ? 'opted' : 'auto');
  const body = el('div');
  mount(host, el('div', { class: 'cc-view' }, [
    body,
  ]));
  load();

  async function load() {
    mount(body, el('div', { class: 'lb-state lb-loading' }, 'Loading agents…'));
    let rows; try { rows = await ccAgentsList(); } catch (e) { mount(body, el('div', { class: 'lb-state lb-error' }, humanizeError(e))); return; }
    state.rows = Array.isArray(rows) ? rows : [];
    paint();
  }

  // ═══════════════════════════════════════════════════════════════════════════════════════════
  // bl_agent_0406 — PREMIUM LIST. One glance answers: how big is the partner force, who is
  // earning, whose link is live, who owes a decision, and where the money sits (clearing →
  // payable → paid). Segmented tracks, KPI strip, dense table, mobile cards. Nothing hidden:
  // every field cc_agents_list returns is on the row or one click away in the 360.
  // ═══════════════════════════════════════════════════════════════════════════════════════════
  const TRACKS = [
    ['opted', 'Partners', 'Referral partners only — no dispatcher application'],
    ['both', 'Dispatcher + Partner', 'Also listed under Dispatchers (merged there)'],
    ['disp', 'Dispatcher only', 'Never chose the referral program — see Dispatchers'],
    ['auto', 'Idle signups', 'Signed up before 22 Sep 2026 and never picked a track — link OFF'],
    ['codes', 'Own codes', 'Carrier / broker referral codes (not partners)'],
    ['all', 'Everyone', ''],
  ];
  const TRACK_PILL = { opted: ['⚡ Partner', 'green'], both: ['⚡🧑‍✈️ Both', 'blue'], disp: ['🧑‍✈️ Dispatcher', 'blue'], auto: ['link off', ''], codes: ['own code', 'violet'] };
  const ST = { approved: ['Approved', 'green'], under_review: ['Under review', 'amber'], info_needed: ['Info needed', 'amber'], rejected: ['Rejected', 'red'], draft: ['Draft', 'violet'], 'no-profile': ['No profile', ''], suspended: ['Suspended', 'red'] };
  const stPill = (st) => { const m = ST[st] || [st || '—', '']; return el('span', { class: 'cc-pill' + (m[1] ? ' cc-pill-' + m[1] : '') }, m[0]); };
  const trackPill = (t) => { const m = TRACK_PILL[t]; return m ? el('span', { class: 'cc-pill' + (m[1] ? ' cc-pill-' + m[1] : ''), title: (TRACKS.find((z) => z[0] === t) || [])[2] || '' }, m[0]) : ''; };
  const initials = (s) => (String(s || '?').trim().split(/\s+/).map((w) => w[0]).join('').slice(0, 2) || '?').toUpperCase();
  const hue = (id) => { let h = 0; for (const c of String(id || '')) h = (h * 31 + c.charCodeAt(0)) % 360; return h; };
  const n = (v) => Number(v || 0);
  const csvEsc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
  let cssDone = false;
  function css() {
    if (cssDone) return; cssDone = true;
    document.head.appendChild(el('style', null, `
.rp{--ink:#0f172a;--mut:#64748b;--line:#e5e9f0;--soft:#f8fafc;--ok:#12803c;--warn:#b45309;--bad:#b91c1c;--b:var(--lb-blue,#0883F7);--o:var(--lb-orange,#FC5305);color:var(--ink)}
.rp-hdr{display:flex;justify-content:space-between;gap:12px;align-items:flex-end;flex-wrap:wrap;margin-bottom:12px}
.rp-hdr h2{margin:0;font-size:1.35rem;font-weight:800;letter-spacing:-.02em}.rp-hdr p{margin:3px 0 0;color:var(--mut);font-size:.86rem;max-width:720px}
.rp-act{display:flex;gap:8px;flex-wrap:wrap}
.rp-kpis{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;margin-bottom:14px}
.rp-kpi{background:#fff;border:1px solid var(--line);border-radius:13px;padding:13px 15px;min-width:0;cursor:pointer;transition:border-color .15s}
.rp-kpi:hover{border-color:#bfd6f5}.rp-kpi.on{border-color:var(--b);box-shadow:0 0 0 2px rgba(8,131,247,.14)}
.rp-kpi small{display:block;color:var(--mut);font-weight:600;font-size:11px;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rp-kpi b{display:block;font-size:24px;font-weight:800;letter-spacing:-.025em;margin-top:5px;font-variant-numeric:tabular-nums;line-height:1.1}
.rp-kpi i{display:block;font-style:normal;font-size:11.5px;font-weight:600;color:var(--mut);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.rp-kpi.money b{color:var(--ok)}.rp-kpi.hot{border-color:#fdba74;background:#fff8f3}.rp-kpi.hot b{color:var(--o)}
.rp-bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
.rp-tabs{display:flex;gap:2px;background:#e9edf3;padding:3px;border-radius:10px;flex-wrap:wrap}
.rp-tabs button{border:0;background:transparent;padding:7px 13px;border-radius:8px;font:inherit;font-weight:600;color:var(--mut);cursor:pointer;white-space:nowrap}
.rp-tabs button.on{background:#fff;color:var(--ink);box-shadow:0 1px 2px rgba(16,34,59,.12)}.rp-tabs button em{font-style:normal;font-weight:800;margin-left:5px;font-variant-numeric:tabular-nums}
.rp-hint{font-size:.8rem;color:var(--mut);background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:8px 12px;margin-bottom:12px}
.rp-card{background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden}
.rp-t{width:100%;border-collapse:collapse;font-size:.86rem}
.rp-t th{position:sticky;top:0;background:var(--soft);text-align:left;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--mut);font-weight:700;padding:10px 12px;border-bottom:1px solid var(--line);white-space:nowrap;cursor:pointer;user-select:none}
.rp-t th.num,.rp-t td.num{text-align:right;font-variant-numeric:tabular-nums}
.rp-t th.s::after{content:' ↓';color:var(--b)}.rp-t th.s.asc::after{content:' ↑'}
.rp-t td{padding:10px 12px;border-bottom:1px solid #f1f4f8;vertical-align:middle}.rp-t td .cc-pill{white-space:nowrap}.rp-t td.dt{white-space:nowrap}
.rp-t tr:last-child td{border-bottom:0}.rp-t tbody tr{cursor:pointer;transition:background .12s}.rp-t tbody tr:hover{background:#f6f9fe}
.rp-who{display:flex;gap:10px;align-items:center;min-width:0}
.rp-av{width:32px;height:32px;border-radius:10px;display:grid;place-items:center;color:#fff;font-weight:800;font-size:11px;flex:none}
.rp-who b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px}.rp-who small{display:block;color:var(--mut);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:220px}
.rp-code{font-family:ui-monospace,Menlo,monospace;font-size:.78rem;background:var(--soft);border:1px solid var(--line);border-radius:6px;padding:1px 6px;cursor:copy}
.rp-m{display:flex;flex-direction:column;align-items:flex-end;gap:2px;line-height:1.2}.rp-m b{color:var(--ok);font-variant-numeric:tabular-nums}.rp-m small{color:var(--mut);font-size:.74rem;white-space:nowrap}
.rp-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle}.rp-dot.on{background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.18)}.rp-dot.off{background:#cbd5e1}
.rp-need{display:inline-flex;align-items:center;gap:4px;background:#fff7ed;color:var(--warn);border:1px solid #fed7aa;border-radius:999px;padding:2px 9px;font-size:.74rem;font-weight:700;white-space:nowrap}
.rp-empty{padding:34px 20px;text-align:center;color:var(--mut)}.rp-empty b{display:block;color:var(--ink);font-size:1.05rem;margin-bottom:4px}
.rp-back{display:inline-flex;align-items:center;gap:6px;background:none;border:1px solid var(--line);border-radius:9px;padding:6px 12px;font:inherit;font-weight:700;color:var(--ink);cursor:pointer;margin-bottom:12px}
.rp-track{display:grid;grid-template-columns:repeat(5,1fr);gap:4px;margin:8px 0 6px}.rp-tk{height:5px;border-radius:99px;background:#e5e9f0}.rp-tk.on{background:linear-gradient(90deg,var(--b),#22c55e)}
.rp-org{border:1px solid var(--line);border-radius:12px;padding:12px 14px;margin-top:10px;background:#fff}
.rp-org-h{display:flex;gap:10px;align-items:center;flex-wrap:wrap;cursor:pointer}.rp-org-h b{font-size:.95rem}
.rp-why{font-size:.8rem;margin-top:6px;color:var(--warn)}.rp-why.ok{color:var(--ok)}
.rp-ev{display:grid;grid-template-columns:20px 1fr auto;gap:8px;padding:6px 0;border-bottom:1px solid #f1f4f8;font-size:.82rem;align-items:start}.rp-ev:last-child{border-bottom:0}
.rp-ev small{display:block;color:var(--mut);font-size:.72rem}.rp-ev b{color:var(--ok);white-space:nowrap;font-variant-numeric:tabular-nums}
.rp-more{background:none;border:0;color:var(--b);font-weight:700;cursor:pointer;font:inherit;padding:4px 0}
@media (max-width:1100px){.rp-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:760px){.rp-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.rp-t thead{display:none}.rp-t,.rp-t tbody,.rp-t tr,.rp-t td{display:block;width:100%}.rp-t tr{border-bottom:1px solid var(--line);padding:8px 4px}.rp-t td{padding:4px 8px;border:0}.rp-t td.num{text-align:left}.rp-m{align-items:flex-start}.rp-who b,.rp-who small{max-width:none}}
`));
  }

  function paint() {
    css();
    const q = state.q.toLowerCase();
    const inTrack = (x) => state.track === 'all' || trackOf(x) === state.track;
    const counts = {}; state.rows.forEach((x) => { const t = trackOf(x); counts[t] = (counts[t] || 0) + 1; }); counts.all = state.rows.length;
    let list = state.rows.filter((x) => inTrack(x) && (state.st === 'all' || x.status === state.st)
      && (!state.need || needs(x)) && (!q || ((x.name || '') + ' ' + (x.email || '') + ' ' + (x.code || '')).toLowerCase().includes(q)));
    const SORT = { name: (x) => (x.name || x.email || '').toLowerCase(), referred: (x) => n(x.referred), earned: (x) => n(x.earned), payable: (x) => n(x.payable), last: (x) => x.last_referral_at || '', joined: (x) => x.joined_at || '' };
    const sf = SORT[state.sort] || SORT.joined;
    list = list.slice().sort((a, b) => { const va = sf(a), vb = sf(b); const c = va < vb ? -1 : va > vb ? 1 : 0; return state.asc ? c : -c; });

    // KPI strip — over the partner force (opted + both), money over everyone with a row
    const force = state.rows.filter((x) => ['opted', 'both'].includes(trackOf(x)));
    const sum = (rows, k) => rows.reduce((a, x) => a + n(x[k]), 0);
    const needRows = state.rows.filter(needs);
    const kpi = (label, val, sub, cls, onClick, on) => el('div', { class: 'rp-kpi' + (cls ? ' ' + cls : '') + (on ? ' on' : ''), onClick }, [el('small', null, label), el('b', null, val), el('i', null, sub)]);
    const setTrack = (t) => { state.track = t; state.need = false; paint(); };
    const kpis = el('div', { class: 'rp-kpis' }, [
      kpi('Partner force', String(force.length), (counts.opted || 0) + ' partners · ' + (counts.both || 0) + ' also dispatch', '', () => setTrack('opted'), state.track === 'opted' && !state.need),
      kpi('Links live', String(force.filter((x) => x.opted_in_at).length), (counts.auto || 0) + ' idle signups, link off', '', () => setTrack('auto'), state.track === 'auto'),
      kpi('Referrals', String(sum(force, 'referred')), force.filter((x) => n(x.referred) > 0).length + ' partners have ≥1', '', () => { state.sort = 'referred'; state.asc = false; setTrack('opted'); }),
      kpi('Clearing', money(sum(state.rows, 'accrued')), '15-day window', 'money', () => { state.sort = 'earned'; state.asc = false; setTrack('all'); }),
      kpi('Payable now', money(sum(state.rows, 'payable')), sum(state.rows, 'paid') ? money(sum(state.rows, 'paid')) + ' paid to date' : 'nothing paid yet', 'money', () => { state.sort = 'payable'; state.asc = false; setTrack('all'); }),
      kpi('Needs you', String(needRows.length), needRows.length ? 'reviews + payout requests' : 'queue is clear', needRows.length ? 'hot' : '', () => { state.need = !state.need; state.track = 'all'; paint(); }, state.need),
    ]);

    const qIn = el('input', { class: 'lb-input', placeholder: '🔍 name / email / code', value: state.q, style: 'max-width:240px', onInput: (e) => { state.q = e.target.value; paint(); } });
    const stSel = el('select', { class: 'lb-input', style: 'max-width:170px', onChange: (e) => { state.st = e.target.value; paint(); } },
      [['all', 'All statuses'], ['under_review', 'Under review'], ['approved', 'Approved'], ['info_needed', 'Info needed'], ['rejected', 'Rejected'], ['draft', 'Draft']].map(([v, l]) => el('option', { value: v, selected: state.st === v }, l)));
    const tabs = el('div', { class: 'rp-tabs' }, TRACKS.map(([k, l, tip]) => el('button', { type: 'button', class: state.track === k && !state.need ? 'on' : '', title: tip, onClick: () => setTrack(k) }, [document.createTextNode(l), el('em', null, String(counts[k] || 0))])));
    const exportBtn = el('button', { class: 'lb-btn lb-btn-sm lb-btn-secondary', onClick: () => {
      const H = ['name', 'email', 'code', 'track', 'status', 'country', 'joined_at', 'opted_in_at', 'dispatcher_status', 'referred', 'downline', 'last_referral_at', 'earned', 'accrued', 'payable', 'paid', 'open_payout'];
      const csv = [H.join(',')].concat(list.map((x) => H.map((k) => csvEsc(k === 'track' ? trackOf(x) : x[k])).join(','))).join('\n');
      const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'referral-partners-' + new Date().toISOString().slice(0, 10) + '.csv'; a.click();
    } }, '⬇ CSV (' + list.length + ')');
    const refreshBtn = el('button', { class: 'lb-btn lb-btn-sm lb-btn-secondary', onClick: load }, '↻ Refresh');

    const th = (label, key, num) => el('th', { class: (num ? 'num ' : '') + (state.sort === key ? 's' + (state.asc ? ' asc' : '') : ''), onClick: key ? () => { if (state.sort === key) state.asc = !state.asc; else { state.sort = key; state.asc = key === 'name'; } paint(); } : null }, label);
    const HINT = {
      auto: 'Signed up before 22 Sep 2026 and never picked a track. Their links are OFF; nothing accrues until they choose the program in their portal (or a dispatcher activates "my referral link").',
      disp: 'Dispatcher applicants who never chose the referral program. Manage them under Dispatchers — they are listed here only so nobody is lost.',
      both: 'Dispatcher applicants who also run a referral link. Their dispatcher work lives under Dispatchers (badge ⚡ there); referral money is here.',
      codes: 'Codes owned by carrier / broker accounts (their own "refer a friend"). Not partners; no application to review.',
    }[state.track];

    mount(body, el('div', { class: 'rp' }, [
      el('div', { class: 'rp-hdr' }, [
        el('div', null, [el('h2', null, 'Referral partners'), el('p', null, 'Everyone who can earn 1% of a referred load — who is live, who is earning, who needs a decision, and where the money sits. Dispatchers are managed under Dispatchers; anyone doing both shows in both places.')]),
        el('div', { class: 'rp-act' }, [refreshBtn, exportBtn]),
      ]),
      kpis,
      el('div', { class: 'rp-bar' }, [tabs, qIn, stSel, el('span', { class: 'cc-sub' }, list.length + ' shown')]),
      HINT && !state.need ? el('div', { class: 'rp-hint' }, HINT) : '',
      state.need ? el('div', { class: 'rp-hint' }, 'Showing only rows that need a staff decision: applications under review / info needed, and open payout requests.') : '',
      el('div', { class: 'rp-card' }, [list.length ? el('table', { class: 'rp-t' }, [
        el('thead', null, el('tr', null, [th('Partner', 'name'), th('Track', null), th('Status', null), th('Referrals', 'referred', true), th('Last referral', 'last'), th('Earned · clearing · payable', 'earned', true), th('Joined', 'joined')])),
        el('tbody', null, list.map(row)),
      ]) : el('div', { class: 'rp-empty' }, [el('b', null, state.need ? 'Nothing needs you right now' : 'No one here'), document.createTextNode(state.need ? 'Every application is decided and no payout request is waiting.' : 'Try another track tab, clear the search, or set status to "All statuses".')])]),
    ]));
  }

  function needs(x) { return ['under_review', 'info_needed'].includes(String(x.status || '')) || !!x.open_payout; }

  function row(x) {
    const t = trackOf(x);
    const code = el('span', { class: 'rp-code', title: 'Click to copy the referral link', onClick: (e) => { e.stopPropagation(); const u = 'https://loadboot.com/?ref=' + (x.code || ''); if (navigator.clipboard) navigator.clipboard.writeText(u).then(() => toast('Link copied — ' + u, 'success'), () => window.prompt('Referral link', u)); else window.prompt('Referral link', u); } }, x.code || '—');
    const linkOn = !!x.opted_in_at && String(x.status || '') !== 'suspended';
    return el('tr', { onClick: () => open360(x) }, [
      el('td', null, el('div', { class: 'rp-who' }, [
        el('div', { class: 'rp-av', style: 'background:hsl(' + hue(x.user_id) + ' 55% 42%)' }, initials(x.name || x.email)),
        el('div', { style: 'min-width:0' }, [el('b', null, x.name || '(no name)'), el('small', null, [document.createTextNode((x.email || '') + ' · '), code, document.createTextNode(x.country ? ' · ' + x.country : '')])]),
      ])),
      el('td', null, [trackPill(t), x.dispatcher_status && t !== 'opted' ? el('small', { class: 'cc-sub', style: 'display:block;margin-top:3px' }, 'dispatcher: ' + x.dispatcher_status) : '',
        el('small', { style: 'display:block;margin-top:3px;font-size:.74rem;color:#64748b' }, [el('span', { class: 'rp-dot ' + (linkOn ? 'on' : 'off') }), document.createTextNode(linkOn ? 'link live since ' + fmtDate(x.opted_in_at) : 'link off')])]),
      el('td', null, [stPill(x.status), needs(x) ? el('div', { style: 'margin-top:4px' }, el('span', { class: 'rp-need' }, x.open_payout ? '💵 payout request' : '✋ decision needed')) : '']),
      el('td', { class: 'num' }, [el('b', null, String(n(x.referred))), n(x.downline) ? el('small', { class: 'cc-sub', style: 'display:block' }, n(x.downline) + ' downline') : '']),
      el('td', null, x.last_referral_at ? el('span', { title: fmtDateTime(x.last_referral_at) }, fmtDate(x.last_referral_at)) : el('span', { class: 'cc-sub' }, 'none yet')),
      el('td', { class: 'num' }, el('div', { class: 'rp-m' }, [el('b', null, money(n(x.earned))),
        el('small', null, (n(x.accrued) ? money(n(x.accrued)) + ' clearing' : '—') + ' · ' + (n(x.payable) ? money(n(x.payable)) + ' payable' : '—') + (n(x.paid) ? ' · ' + money(n(x.paid)) + ' paid' : ''))])),
      el('td', { class: 'cc-sub dt', title: x.joined_at ? fmtDateTime(x.joined_at) : '' }, x.joined_at ? fmtDate(x.joined_at) : '—'),
    ]);
  }

  // bl_agent_0406 — one referral, its stage bar, the plain "why $0" line and its timeline
  const EV_ICON = { joined: '👋', packet: '📋', verified: '✅', packet_issue: '⚠️', doc: '📄', doc_approved: '✔️', doc_rejected: '↩️', truck: '🚛', posted: '📦', booked: '📌', transit: '🛣️', delivered: '🏁', cancelled: '✖️', credited: '💰', payable: '🏦', paid: '💸' };
  function refCard(c, actv) {
    const a = actv.find((z) => z.org === c.org && (!z.side || !c.side || z.side === c.side)) || { events: [] };
    const ev = a.events || [];
    const ver = ['active', 'verified', 'approved'].includes(String(c.status || ''));
    const hasLoad = n(c.loads_posted) > 0 || n(c.trips_delivered) > 0 || ev.some((e) => ['booked', 'posted', 'transit'].includes(e.kind));
    const del = n(c.trips_delivered) > 0 || ev.some((e) => e.kind === 'delivered');
    const earn = c.your_earnings != null ? n(c.your_earnings) : ev.filter((e) => e.kind === 'credited').reduce((a, e) => a + n(e.amount), 0);  // cc chain has no per-org money → sum the 1% credits
    const steps = [true, ver, hasLoad, del, earn > 0];
    const why = !ver ? 'Waiting on their verification — the partner earns from their first delivered load.'
      : !hasLoad ? ('Verified, but no load ' + (c.side === 'carrier' ? 'booked' : 'posted') + ' yet — that is why the partner has $0 from them.')
      : !del ? 'Loads in progress, none delivered yet — 1% credits on delivery.'
      : earn <= 0 ? 'Delivered — the 1% credit is pending (partner verification or the accrual run).'
      : 'Earning — 1% of every delivered load.';
    let open = false; const listEl = el('div'); const more = el('button', { class: 'rp-more', type: 'button', onClick: (e) => { e.stopPropagation(); open = !open; paintEv(); } });
    const paintEv = () => { const rows = open ? ev : ev.slice(0, 3); mount(listEl, rows.length ? rows.map((e) => el('div', { class: 'rp-ev' }, [el('span', null, EV_ICON[e.kind] || '•'), el('div', null, [document.createTextNode(e.title || e.kind), el('small', null, fmtDateTime(e.at))]), e.amount != null ? el('b', null, money(e.amount)) : el('span')])) : [el('div', { class: 'cc-sub' }, 'Nothing beyond signing up yet.')]); more.textContent = ev.length > 3 ? (open ? 'Show less' : 'All ' + ev.length + ' events →') : ''; };
    paintEv();
    return el('div', { class: 'rp-org' }, [
      el('div', { class: 'rp-org-h', onClick: () => { open = !open; paintEv(); } }, [
        el('span', { style: 'font-size:1.1rem' }, c.side === 'carrier' ? '🚛' : c.side === 'shipper' ? '🏭' : '🏢'), el('b', null, c.org || 'New account'),
        el('span', { class: 'cc-pill' }, c.side || 'partner'), el('span', { class: 'cc-pill' + (ver ? ' cc-pill-green' : ' cc-pill-amber') }, ver ? 'verified' : (c.status || 'onboarding')),
        el('span', { class: 'cc-sub' }, 'joined ' + fmtDate(c.joined_at) + ' · ' + n(c.trips_delivered) + ' delivered' + (c.side !== 'carrier' ? ' · ' + n(c.loads_posted) + ' posted' : '')),
        el('b', { style: 'margin-left:auto;color:' + (earn > 0 ? '#12803c' : '#94a3b8') }, money(earn)),
      ]),
      el('div', { class: 'rp-track' }, steps.map((on) => el('div', { class: 'rp-tk' + (on ? ' on' : '') }))),
      el('div', { class: 'rp-why' + (earn > 0 ? ' ok' : '') }, why),
      el('div', { style: 'margin-top:8px' }, [listEl, more]),
    ]);
  }

  async function open360(x) {
    mount(body, el('div', { class: 'lb-state lb-loading' }, 'Loading ' + (x.name || 'agent') + '…'));
    let d; try { d = await ccAgent360(x.user_id); } catch (e) { mount(body, el('div', { class: 'lb-state lb-error' }, humanizeError(e))); return; }
    let actv = []; try { const a9 = await ccAgentReferralActivity(x.user_id, 60); actv = Array.isArray(a9) ? a9 : []; } catch (_) {}  // bl_agent_0406
    const p = d.profile || {}; const pd = p.payout_details || {};
    const kv = (k, v) => el('div', { style: 'display:flex;justify-content:space-between;gap:10px;padding:4px 0;border-bottom:1px dashed #eef2f7;font-size:.86rem' }, [el('span', { style: 'color:#64748b' }, k), el('b', null, String(v ?? '—'))]);
    const docRow = (label, path, docKey) => {
      const st = pd[docKey + '_doc_status'] || (path ? 'pending' : 'missing');
      const reason = pd[docKey + '_doc_reason'];
      const chip = st === 'accepted' ? el('span', { class: 'cc-pill cc-pill-green' }, '✓ accepted')
        : st === 'rejected' ? el('span', { class: 'cc-pill cc-pill-red', title: reason || '' }, '✕ rejected')
        : path ? el('span', { class: 'cc-pill cc-pill-amber' }, 'pending review')
        : el('span', { class: 'cc-pill cc-pill-red' }, 'missing');
      return el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:5px 0;border-bottom:1px dashed #eef2f7' }, [
        el('span', { style: 'font-size:.85rem;font-weight:700;flex:1;min-width:150px' }, label), chip,
        path ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-secondary', onClick: async (ev) => { const b = ev.currentTarget; const w = b.textContent; b.textContent = '…';
          try { const u = await signedDocumentUrl(path, 600); window.open(u, '_blank', 'noopener'); } catch (e) { toast(humanizeError(e)); } b.textContent = w; } }, [icon('eye',15),' View']) : '',
        path && st !== 'accepted' ? el('button', { class: 'lb-btn lb-btn-sm', onClick: async () => { try { await ccAgentDocReview(x.user_id, docKey, 'accept', null); open360(x); } catch (e) { toast(humanizeError(e)); } } }, '✓ Accept') : '',
        path && st !== 'rejected' ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-secondary', style: 'color:#b91c1c', onClick: async () => { const r = await askReason('Reject ' + label + ' — reason (agent sees this + gets an email):'); if (!r) return; try { await ccAgentDocReview(x.user_id, docKey, 'reject', r); open360(x); } catch (e) { toast(humanizeError(e)); } } }, '✕ Reject') : '',
        reason && st === 'rejected' ? el('div', { class: 'cc-sub', style: 'width:100%' }, 'reason: ' + reason) : '',
      ]);
    };
    const act = (lbl, action, cls) => el('button', { class: 'lb-btn lb-btn-sm ' + (cls || ''), onClick: async () => {
      const note = action === 'approve' ? null : prompt(lbl + ' — note (agent sees this):'); if (action !== 'approve' && !note) return;
      if (action === 'approve' && !await askConfirm('Please confirm', { body: 'Approve this agent? Chain starts earning immediately.', danger: true })) return;
      try { await ccAgentDecide(x.user_id, action, note); open360(x); } catch (e) { toast(humanizeError(e)); }
    } }, lbl);
    // message thread
    const thread = el('div', { style: 'max-height:220px;overflow:auto;display:flex;flex-direction:column;gap:6px' },
      (d.messages || []).map((m) => el('div', { style: 'max-width:80%;padding:7px 11px;border-radius:11px;font-size:.84rem;' + (m.sender === 'staff' ? 'align-self:flex-end;background:#e0edff' : 'align-self:flex-start;background:#f1f5f9') },
        [el('div', null, m.body), el('div', { style: 'font-size:.62rem;color:#94a3b8;margin-top:2px' }, (m.sender === 'staff' ? 'CC' : 'Agent') + ' · ' + fmtDateTime(m.at))])));
    const msgIn = el('input', { class: 'lb-input', placeholder: 'Reply to agent…', style: 'flex:1' });
    const msgBtn = el('button', { class: 'lb-btn lb-btn-sm', onClick: async () => { if (!msgIn.value.trim()) return;
      try { await ccAgentMsgSend(x.user_id, msgIn.value.trim()); open360(x); } catch (e) { toast(humanizeError(e)); } } }, 'Send');
    // notify form
    const ntT = el('input', { class: 'lb-input', placeholder: 'Notification title', style: 'flex:1;min-width:160px' });
    const ntB = el('input', { class: 'lb-input', placeholder: 'Body', style: 'flex:2;min-width:200px' });
    const ntE = el('input', { type: 'checkbox' });
    const ntSend = el('button', { class: 'lb-btn lb-btn-sm', onClick: async () => { if (!ntT.value.trim()) return;
      try { await ccAgentNotifySend(x.user_id, ntT.value.trim(), ntB.value.trim(), ntE.checked); toast('Sent ✓'); ntT.value = ''; ntB.value = ''; } catch (e) { toast(humanizeError(e)); } } }, 'Send');
    const e9 = d.earnings || {};
    mount(body, el('div', { class: 'rp' }, [
      el('button', { class: 'rp-back', onClick: load }, '← All referral partners'),
      el('div', { class: 'rp-hdr', style: 'margin-bottom:14px' }, [
        el('div', { class: 'rp-who' }, [
          el('div', { class: 'rp-av', style: 'width:44px;height:44px;font-size:15px;background:hsl(' + hue(x.user_id) + ' 55% 42%)' }, initials(x.name || x.email)),
          el('div', null, [el('h2', { style: 'margin:0;font-size:1.25rem;font-weight:800' }, x.name || '(no name)'), el('p', { style: 'margin:2px 0 0;color:#64748b;font-size:.84rem' }, [document.createTextNode((x.email || '') + ' · code '), el('span', { class: 'rp-code' }, x.code || '—'), document.createTextNode(' · joined ' + fmtDate(x.joined_at) + (x.country ? ' · ' + x.country : ''))])]),
        ]),
        el('div', { class: 'rp-act', style: 'align-items:center' }, [trackPill(trackOf(x)), stPill(x.status), x.dispatcher_status ? el('span', { class: 'cc-pill cc-pill-blue' }, '🧑‍✈️ ' + x.dispatcher_status) : '',
          el('span', { class: 'cc-pill' + (x.opted_in_at ? ' cc-pill-green' : '') }, x.opted_in_at ? '⚡ link live · ' + fmtDate(x.opted_in_at) : 'link off')]),
      ]),
      el('div', { class: 'cc-grid-2' }, [
        card([el('h4', { class: 'cc-card-title' }, [icon('users',15),' Application — everything submitted']),
          kv('Name', p.full_name), kv('Email', d.email), kv('Phone', p.phone),
          kv('Address', [p.street, p.city, p.state, p.zip, p.country].filter(Boolean).join(', ')),
          kv('Agency', p.agency), kv('Experience', (p.years_exp ?? '—') + ' yrs'),
          (() => { // Network — organized chips instead of raw JSON
            const n9 = p.network || {};
            const chip9 = (t9, on9) => el('span', { style: 'display:inline-block;padding:3px 10px;border-radius:999px;font-size:.72rem;font-weight:700;margin:2px 4px 2px 0;background:' + (on9 ? '#dcfce7' : '#f1f5f9') + ';color:' + (on9 ? '#166534' : '#94a3b8') }, (on9 ? '\u2713 ' : '\u2014 ') + t9);
            const list9 = (v9) => String(v9 || '').split(',').map((x9) => x9.trim()).filter(Boolean);
            return el('div', { style: 'padding:6px 0;border-bottom:1px solid #eef2f7' }, [
              el('div', { style: 'font-size:.72rem;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px' }, 'Network'),
              el('div', null, [chip9('Brokers', !!n9.has_brokers), chip9('Carriers', !!n9.has_carriers), chip9('Shippers', !!n9.has_shippers)]),
              list9(n9.lanes).length ? el('div', { style: 'margin-top:5px' }, [el('b', { style: 'font-size:.74rem;color:#64748b;margin-right:6px' }, 'Lanes:'), ...list9(n9.lanes).map((l9) => el('span', { style: 'display:inline-block;padding:2px 9px;border-radius:999px;font-size:.72rem;font-weight:600;margin:2px 4px 2px 0;background:#e0edff;color:#1d4ed8' }, l9))]) : null,
              list9(n9.equipment).length ? el('div', { style: 'margin-top:4px' }, [el('b', { style: 'font-size:.74rem;color:#64748b;margin-right:6px' }, 'Equipment:'), ...list9(n9.equipment).map((e9) => el('span', { style: 'display:inline-block;padding:2px 9px;border-radius:999px;font-size:.72rem;font-weight:600;margin:2px 4px 2px 0;background:#fff7ed;color:#c2410c' }, e9))]) : null,
            ].filter(Boolean));
          })(),
          kv('Status', p.status), kv('Agreement', p.agreement_signed_at ? '✓ ' + (p.agreement_name || '') + ' · ' + fmtDateTime(p.agreement_signed_at) : '✕ unsigned'),
          kv('Tax form', (p.tax_form || '—') + (p.tax_id_last4 ? ' · TIN •••' + p.tax_id_last4 : '')),
          // FULL PAYOUT PANEL — parity with Carrier 360's payout card. Staff must be able to read
          // exactly where the money is going before approving a payout, without opening the DB.
          (() => {
            const M9 = { payoneer: '⭐ Payoneer', local_bank: '🏦 Local bank · paid via Payoneer', ach: '🏦 US bank (ACH)', crypto: '₿ USDT · TRC-20', intl: '🏦 International bank', other: '❓ Other (requested)' };
            const row9 = (k9, v9, warn) => v9 ? el('div', { style: 'display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px dashed #eef2f7;font-size:.85rem' }, [
              el('span', { style: 'color:#64748b' }, k9),
              el('b', { style: 'text-align:right;word-break:break-word;color:' + (warn ? '#b45309' : '#0f172a') }, v9)]) : null;
            // Masking protects against shoulder-surfing, but whoever sends the wire has to
            // read the full number and type it into their bank. Click to reveal + copy.
            const secretRow9 = (k9, full9, keep9) => {
              const t9 = String(full9 || ''); if (!t9) return null;
              let shown9 = false;
              const val9 = el('b', { style: 'text-align:right;word-break:break-all;color:#0f172a;cursor:pointer;user-select:all', title: 'Click to reveal / hide' }, '•••' + t9.slice(-(keep9 || 4)));
              const cp9 = el('button', { class: 'lb-btn lb-btn-sm lb-btn-secondary', style: 'padding:1px 7px;font-size:.7rem', title: 'Copy full value', onClick: async (ev) => { const __el9 = ev.currentTarget;
                try { await navigator.clipboard.writeText(t9); const b = __el9; b.textContent = '✓'; setTimeout(() => { b.textContent = '⧉'; }, 1200); }
                catch (_) { toast('Copy failed — click the value to reveal it', 'error'); }
              } }, '⧉');
              val9.onclick = () => { shown9 = !shown9; val9.textContent = shown9 ? t9 : ('•••' + t9.slice(-(keep9 || 4))); };
              return el('div', { style: 'display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px dashed #eef2f7;font-size:.85rem;align-items:center' }, [
                el('span', { style: 'color:#64748b' }, k9),
                el('span', { style: 'display:flex;gap:6px;align-items:center;justify-content:flex-end;flex:1' }, [val9, cp9]),
              ]);
            };
            const m9 = String(p.payout_method || '');
            const rows9 = [
              row9('Method', M9[m9] || m9 || '— not set —', !m9),
              row9('Account title', pd.account_title),
              row9('Name match', (pd.account_title && p.full_name) ? (String(pd.account_title).trim().toLowerCase() === String(p.full_name).trim().toLowerCase() ? '✓ matches legal name' : '⚠ differs from application name — verify before paying') : null,
                   !!(pd.account_title && p.full_name && String(pd.account_title).trim().toLowerCase() !== String(p.full_name).trim().toLowerCase())),
              m9 === 'payoneer' ? row9('Payoneer email', pd.email) : null,
              m9 === 'payoneer' ? row9('Payoneer customer ID', pd.account) : null,
              m9 === 'ach' ? row9('Bank', pd.bank_name) : null,
              m9 === 'ach' ? secretRow9('Routing', pd.routing, 4) : null,
              m9 === 'ach' ? secretRow9('Account #', pd.account, 4) : null,
              m9 === 'crypto' ? row9('Network', pd.wallet_network || 'TRC-20') : null,
              m9 === 'crypto' ? secretRow9('Wallet', pd.wallet, 6) : null,
              (m9 === 'intl' || m9 === 'local_bank' || m9 === 'other') ? row9('Bank', pd.bank_name) : null,
              (m9 === 'intl' || m9 === 'local_bank' || m9 === 'other') ? secretRow9('IBAN / account', pd.iban || pd.account, 4) : null,
              (m9 === 'intl' || m9 === 'local_bank' || m9 === 'other') ? row9('SWIFT / BIC', pd.swift) : null,
              row9('Bank address', pd.bank_address),
              m9 === 'other' ? row9('Beneficiary address', pd.beneficiary_address) : null,
              m9 === 'other' ? row9('Requested method', pd.other, !pd.other_approved) : null,
              row9('Country', p.country),
              row9('Tax form', (p.tax_form || '—') + (p.tax_id_last4 ? ' · TIN •••' + p.tax_id_last4 : '')),
            ].filter(Boolean);
            // For an alternative rail, name the fields that are actually missing. "Do not pay"
            // with no list is what forced a reviewer to either guess or reject a real agent.
            const MISS9 = [
              ['Account title (exact legal name on the account)', pd.account_title],
              ['Provider / bank name', pd.bank_name],
              ['IBAN / account number', pd.iban || pd.account],
              ['SWIFT / BIC', pd.swift],
              ['Provider / bank address', pd.bank_address],
              ['Beneficiary address (agent’s own address)', pd.beneficiary_address],
            ].filter(([, v]) => !String(v || '').trim()).map(([k]) => k);
            const appr9 = pd.other_approved || null;
            const note9 = m9 === 'intl'
              ? '⚠ Legacy direct-IBAN payout. New agents are onboarded on Payoneer — a US-sourced USD wire to a foreign IBAN is slow and expensive. Ask this agent to switch to Payoneer before the next run.'
              : m9 === 'other' ? (appr9
                  ? '✓ Method approved' + (appr9.at ? ' on ' + fmtDate(appr9.at) : '') + ' — ' + (appr9.label || 'alternative rail') + ' can receive an international USD payment in this agent’s own name.' + (appr9.note ? ' Reviewer note: ' + appr9.note : '')
                  : '⚠ Unapproved method — do NOT pay until a reviewer confirms it can receive an international USD payment in the agent’s own name.'
                    + (MISS9.length ? ' Still missing: ' + MISS9.join(' · ') + '.' : ' All receiving details are on file — assess the provider, then approve the method.'))
              : m9 === 'crypto' ? 'Send a small test transfer before the first full payout. The network fee is deducted from the payout and printed on the receipt.'
              : m9 === 'local_bank' ? 'Pay via Payoneer’s local bank transfer to this account — lands in local currency, usually 1–3 business days. Verify the account title matches the ID.'
              : m9 === 'payoneer' ? 'Pay the Payoneer account; the agent withdraws to their own local bank inside Payoneer. LoadBoot adds no fee.'
              : null;
            return el('div', { style: 'padding:8px 0' }, [
              el('div', { style: 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px' }, [el('div', { style: 'font-size:.72rem;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em' }, [icon('card',15),' Payout & bank details']), el('span', { class: 'cc-pill cc-pill-' + (pd.payout_status==='verified'?'green':pd.payout_status==='rejected'?'red':'amber') }, pd.payout_status==='verified'?'✓ Verified':pd.payout_status==='rejected'?'✕ Rejected':'Pending review')]),
              ...rows9,
              note9 ? el('div', { style: 'margin-top:8px;border-radius:10px;padding:9px 12px;font-size:.8rem;line-height:1.55;'
                + ((m9 === 'other' && appr9) ? 'background:#f0fdf4;border:1px solid #bbf7d0;color:#166534' : 'background:#f8fafc;border:1px solid #e6ebf3;color:#475569') }, note9) : null,
              pd.details_requested ? el('div', { style: 'margin-top:6px;font-size:.76rem;color:#b45309' },
                '📨 Details requested ' + fmtDate(pd.details_requested.at) + ' — waiting on the agent: ' + (pd.details_requested.fields || []).join(', ')) : null,
              // ---- alternative-rail review actions (only when the agent picked "Other") ----
              m9 === 'other' ? el('div', { style: 'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap' }, [
                MISS9.length ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-secondary', title: 'Email + in-app request listing exactly which receiving details are still missing', onClick: async (ev) => { const __el9 = ev.currentTarget;
                  if (!await askConfirm('Request receiving details', { body: 'Email + in-app request will ask this agent for: ' + MISS9.join(', ') + '. Their onboarding screen unlocks so they can add them.', confirmLabel: 'Send request' })) return;
                  const b = __el9; b.disabled = true;
                  try { await ccAgentPayoutRequestDetails(x.user_id, MISS9, null); toast('Request sent — agent notified by email + in-app', 'success'); open360(x); }
                  catch (e) { b.disabled = false; toast(humanizeError(e), 'error'); }
                } }, [icon('bell',15),' Request receiving details']) : null,
                (!appr9 && !MISS9.length) ? el('button', { class: 'lb-btn lb-btn-sm', style: 'background:#0f766e;border-color:#0f766e', title: 'Record that this rail can legally receive an international USD payment in the agent’s own name', onClick: async (ev) => { const __el9 = ev.currentTarget;
                  const why = await askReason('Approve this payout method — what did you confirm?', { note: 'This records your assessment of the RAIL. Verifying the account numbers is still a separate step.', submitLabel: 'Approve method' });
                  if (!why) return;
                  const b = __el9; b.disabled = true;
                  try { await ccAgentPayoutApproveMethod(x.user_id, why); toast('Method approved — you can now verify the account', 'success'); open360(x); }
                  catch (e) { b.disabled = false; toast(humanizeError(e), 'error'); }
                } }, [icon('check',15),' Approve this method']) : null,
              ].filter(Boolean)) : null,
              el('div', { style: 'display:flex;gap:8px;margin-top:12px;flex-wrap:wrap' }, [(pd.payout_status!=='verified' && !(m9 === 'other' && !appr9)) ? el('button', { class: 'lb-btn lb-btn-sm', style: 'background:#16a34a;border-color:#16a34a', onClick: async (ev) => { const b=ev.currentTarget; if(!await askConfirm('Verify payout',{ body:'Mark this payout method as verified? Payouts can be sent here.' })) return; b.disabled=true; try{ await ccAgentPayoutVerify(x.user_id,true,null); toast('Payout verified','success'); open360(x);}catch(e){ b.disabled=false; toast(humanizeError(e),'error'); } } }, [icon('check',15),' Verify bank details']) : null,pd.payout_status!=='rejected' ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-secondary', style: 'color:#b91c1c', onClick: async (ev) => { const __el9 = ev.currentTarget; const r=await askReason('Reject payout details — reason (agent sees this + gets an email):'); if(!r) return; const b=__el9; b.disabled=true; try{ await ccAgentPayoutVerify(x.user_id,false,r); toast('Payout rejected — agent notified','success'); open360(x);}catch(e){ b.disabled=false; toast(humanizeError(e),'error'); } } }, [icon('x',15),' Reject with reason']) : null,].filter(Boolean)),
            ].filter(Boolean));
          })(),
          el('div', { style: 'margin-top:10px' }, [docRow('🪪 Government photo ID', pd.id_doc, 'id'), docRow('🏦 Bank proof', pd.bank_doc, 'bank')]),
          el('div', { style: 'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap' }, [...((['approved','active'].includes(String(p.status || ''))) ? [el('span', { class: 'cc-pill cc-pill-green', style: 'align-self:center;font-weight:800;padding:8px 12px' }, '✓ Approved — chain earning live')] : [act('✓ Approve', 'approve'), act('？ More info', 'info', 'lb-btn-secondary'), act('✕ Reject', 'reject', 'lb-btn-secondary')]),
            el('button', { class: 'lb-btn lb-btn-sm', title: 'Email + in-app reminder listing what this agent still needs to finish onboarding', onClick: async (ev) => {
              const b = ev.currentTarget; const w = b.textContent; b.disabled = true;
              const miss = [];
              if (!p.agreement_signed_at) miss.push('sign the agent agreement');
              if (!p.payout_method) miss.push('add your payout method');
              if (!pd.id_doc) miss.push('upload a government photo ID');
              if (!pd.bank_doc) miss.push('upload bank proof');
              if (!miss.length) { b.disabled = false; toast('Nothing outstanding — this agent has completed every onboarding step.'); return; }
              const bodyTxt = 'Welcome to LoadBoot! To finish activating your agent account and start earning, please complete: ' + miss.map((m, i) => (i + 1) + ') ' + m).join('   ') + '. Open your Agent portal and go to onboarding to wrap it up. Reply here if you need any help.';
              try { await ccAgentNotifySend(x.user_id, 'Finish your LoadBoot agent onboarding', bodyTxt, true); b.textContent = '✓ Reminder sent'; toast('Onboarding reminder sent to ' + (d.email || 'the agent') + ' — premium email + in-app, listing: ' + miss.join(', ') + '.'); }
              catch (e) { b.disabled = false; b.textContent = w; toast(humanizeError(e)); }
            } }, [icon('bell',15),' Send reminder']),
            // SUSPEND / REINSTATE (audit gap): staff could approve + pay an agent but never stop one.
            (String(x.status || '') === 'suspended')
              ? el('button', { class: 'lb-btn lb-btn-sm', onClick: async (ev) => { const b = ev.currentTarget; b.disabled = true;
                  try { await agentSuspend(x.user_id, false, null); toast('Agent reinstated — accruals resume', 'success'); open360(x); }
                  catch (e) { b.disabled = false; toast(humanizeError(e), 'error'); } } }, '↻ Reinstate agent')
              : el('button', { class: 'lb-btn lb-btn-sm', style: 'border:1px solid #fca5a5;color:#b91c1c;background:#fff', onClick: async () => {
                  const why = await askReason('Suspend this agent — reason', { note: 'The agent is notified. Cleared commissions are untouched; new accruals pause until reinstated. Audit-logged.', submitLabel: 'Suspend agent' });
                  if (!why) return;
                  try { await agentSuspend(x.user_id, true, why); toast('Agent suspended — notified', 'success'); open360(x); }
                  catch (e) { toast(humanizeError(e), 'error'); } } }, '⏸ Suspend agent'),
          ]),
        ]),
        card([el('h4', { class: 'cc-card-title' }, [icon('dollar',15),' Earnings & payouts']),
          kv('Clearing', money(e9.accrued || 0)), kv('Available to settle', money(e9.payable || 0)), kv('Paid out', money(e9.paid || 0)),
          el('div', { class: 'cc-sub', style: 'margin:8px 0 4px;font-weight:700' }, 'Recent commissions'),
          ...(e9.recent || []).slice(0, 8).map((c) => el('div', { class: 'cc-sub' }, money(c.amount) + ' · L' + c.level + ' · ' + c.status + ' · ' + fmtDate(c.at))),
          el('div', { class: 'cc-sub', style: 'margin:8px 0 4px;font-weight:700' }, 'Payout requests'),
          ...(d.payouts || []).map((q) => el('div', { style: 'display:flex;gap:8px;align-items:center;padding:3px 0' }, [
            el('span', { class: 'cc-sub', style: 'flex:1' }, money(q.amount) + ' · ' + q.status + ' · ' + fmtDate(q.requested_at)),
            ['requested'].includes(q.status) ? el('button', { class: 'lb-btn lb-btn-sm', onClick: async () => { try { await referralPayoutDecide(q.id, 'approve', null); open360(x); } catch (e) { toast(humanizeError(e)); } } }, '✓ Approve') : '',
            ['requested'].includes(q.status) ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-secondary', onClick: async () => { const n = await askReason('Reject — why?'); if (!n) return; try { await referralPayoutDecide(q.id, 'reject', n); open360(x); } catch (e) { toast(humanizeError(e)); } } }, '✕') : '',
          ])),
        ]),
      ]),
      el('div', { class: 'cc-grid-2', style: 'margin-top:16px' }, [
        card([el('h4', { class: 'cc-card-title' }, '🔗 Referrals — every step, as the partner sees it'),
          el('div', { class: 'cc-sub', style: 'margin-bottom:4px' }, 'Signup → verification → trucks / loads → booked → delivered → 1% credited → cleared → paid. Same feed the partner sees in their portal.'),
          ...((d.chain && d.chain.length) ? d.chain.map((c) => refCard(c, actv)) : [el('div', { class: 'rp-empty', style: 'padding:18px' }, [el('b', null, 'No referrals yet'), document.createTextNode('Nobody has signed up through this link so far.')])]),
          el('div', { class: 'cc-sub', style: 'margin-top:10px;font-weight:700' }, '🌳 Downline agents (levels 2–5)'),
          ...(d.downline && d.downline.length ? d.downline.map((a) => el('div', { class: 'cc-sub', style: 'padding:2px 0' },
            'L' + a.level + ' · ' + (a.name || a.code) + ' (' + a.code + ') · ' + a.status + ' · earned for this agent: ' + money(a.earned_for_you || 0))) : [el('div', { class: 'cc-sub' }, 'No recruited agents yet.')]),
          d.referrer && d.referrer.parent ? el('div', { class: 'cc-sub', style: 'margin-top:8px' }, '⬆ Upline: ' + d.referrer.parent) : '',
        ]),
        card([el('h4', { class: 'cc-card-title' }, '💬 Thread & direct comms'),
          thread,
          el('div', { style: 'display:flex;gap:8px;margin-top:8px' }, [msgIn, msgBtn]),
          el('div', { class: 'cc-sub', style: 'margin:12px 0 4px;font-weight:700' }, '📣 Send notification' ),
          el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, [ntT, ntB, el('label', { style: 'display:flex;gap:5px;align-items:center;font-size:.8rem' }, [ntE, 'also email']), ntSend]),
        ]),
      ]),
    ]));
  }
}
