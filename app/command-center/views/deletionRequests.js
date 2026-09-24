// deletionRequests.js — the Deletion desk (bl_priv_0437, 24 Sep 2026).
//
// Every "delete my account" request lands here: carriers, brokers, shippers, agents. Before this
// screen existed the requests were filed (request_account_deletion) but invisible — the staff
// notification pointed at the task queue, where they never appear. A real carrier waited 32 hours.
//
// Promise to the user: completed within 30 days. The desk is built around that clock.
// Server side (all gated to carriers.approve OR finance.approve, all re-checked server side):
//   cc_account_deletions(view)            one read: enriched rows + KPI summary      (bl_priv_0437)
//   cc_account_deletion_process(id, act)  'complete' erases, 'reject' needs a reason  (bl_priv_0211+)
//   cc_erasure_items / cc_erasure_decide  per-file remove / hold (legal retention)     (bl_audit_0365)
//   erasure-purge (edge fn)               removes the files staff decided to remove    (bl_audit_0365)
// A request with files cannot be completed until every file has a decision and every "remove" is
// actually removed — the server returns ERASURE_REVIEW_REQUIRED and this screen pivots to the review.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showEmpty, showError } from '../../shared/loading.js';
import { sectionHead, statCard, openDrawer, fmtDate, fmtDateTime, ago, askReason, segmented } from '../../shared/ui/components.js';
import { ccAccountDeletions, ccAccountDeletionProcess, ccErasureItems, ccErasureDecide, ccErasurePurge } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';

const CSS = `
.dd-list{display:grid;gap:10px}
.dd-card{display:grid;grid-template-columns:minmax(0,2.2fr) minmax(0,1.2fr) minmax(0,1.1fr) auto;gap:14px;align-items:center;
  background:#fff;border:1px solid #e6ebf3;border-radius:14px;padding:14px 16px;cursor:pointer;
  box-shadow:0 10px 28px -24px rgba(16,34,59,.35);transition:border-color .15s,box-shadow .15s,transform .15s}
.dd-card:hover{border-color:#0883F7;box-shadow:0 14px 34px -22px rgba(16,34,59,.38);transform:translateY(-1px)}
.dd-card:focus-visible{outline:2px solid #0883F7;outline-offset:2px}
.dd-card.dd-overdue{border-left:4px solid #dc2626}
.dd-card.dd-soon{border-left:4px solid #d97706}
.dd-who{display:flex;gap:12px;align-items:center;min-width:0}
.dd-av{flex:0 0 40px;height:40px;border-radius:12px;display:grid;place-items:center;font-weight:800;color:#fff;background:linear-gradient(135deg,#0883F7,#10223B)}
.dd-name{font-weight:700;color:#10223B;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dd-sub{color:#6b7d99;font-size:.82rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dd-k{color:#6b7d99;font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px}
.dd-v{color:#10223B;font-size:.9rem;word-break:break-word}
.dd-go{color:#9aa9c0;font-size:1.4rem;padding-left:4px}
.dd-meter{height:6px;border-radius:6px;background:#eef2f8;overflow:hidden;margin-top:6px}
.dd-meter>i{display:block;height:100%;border-radius:6px}
.dd-pill{text-transform:none!important}
.dd-sec{margin:18px 0 8px;font-size:.76rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#6b7d99}
.dd-box{background:#f8fafd;border:1px solid #e6ebf3;border-radius:12px;padding:12px 14px}
.dd-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 16px}
.dd-quote{border-left:3px solid #0883F7;padding:8px 12px;background:#eff6ff;border-radius:0 10px 10px 0;color:#1c2f4d;white-space:pre-wrap;line-height:1.55;word-break:break-word}
.dd-ul{margin:0;padding-left:18px;line-height:1.7;color:#1c2f4d;font-size:.9rem}
.dd-file{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;padding:10px 0;border-bottom:1px solid #e6ebf3}
.dd-file:last-child{border-bottom:0}
.dd-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.dd-danger{background:#dc2626!important;border-color:#dc2626!important;color:#fff!important}
.dd-danger[disabled]{opacity:.45;cursor:not-allowed}
.dd-banner{border-radius:12px;padding:12px 14px;margin-bottom:12px;line-height:1.55;font-size:.9rem}
.dd-banner.red{background:#fef2f2;border:1px solid #fecaca;color:#991b1b}
.dd-banner.amber{background:#fffbeb;border:1px solid #fde68a;color:#92400e}
.dd-banner.green{background:#f0fdf4;border:1px solid #bbf7d0;color:#166534}
.dd-banner.blue{background:#eff6ff;border:1px solid #bfdbfe;color:#1e3a8a}
.dd-bar{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin:14px 0 12px}
@media(max-width:860px){.dd-card{grid-template-columns:1fr 1fr;gap:10px}.dd-who{grid-column:1/-1}.dd-go{display:none}.dd-grid{grid-template-columns:1fr}.dd-file{grid-template-columns:1fr}}
`;

const pill = (text, tone) => el('span', { class: 'cc-pill dd-pill cc-pill-' + tone }, [el('i', { class: 'cc-pill-dot' }), text]);
const field = (k, v) => el('div', null, [el('div', { class: 'dd-k' }, k), el('div', { class: 'dd-v' }, v == null || v === '' ? '—' : v)]);
const roleLabel = (r) => ({ carrier: 'Carrier', broker: 'Broker', shipper: 'Shipper', agent: 'Agent', dispatcher: 'Dispatcher', partner: 'Broker' }[String(r || '').toLowerCase()] || (r ? String(r) : 'User'));
const initialsOf = (r) => (String(r.name || r.org_name || r.company || r.email || '?').trim().split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map(s => s[0]).join('') || '?').toUpperCase();
const fileName = (p) => { const s = String(p || ''); const i = s.lastIndexOf('/'); return i >= 0 ? s.slice(i + 1) : (s || 'file'); };
const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');
const daysAgo = (ts) => { const d = Math.floor((Date.now() - new Date(ts).getTime()) / 86400000); return d <= 0 ? ago(ts) : d === 1 ? 'yesterday' : d + ' days ago'; };
const whoOf = (r) => r.name || r.org_name || r.company || r.email || 'this account';

// The 30-day clock, in words a person reads at a glance.
function clock(r) {
  if (r.status !== 'requested') {
    const t = { completed: ['Completed', 'green'], rejected: ['Rejected', 'gray'], cancelled: ['Cancelled by user', 'gray'] }[r.status] || [String(r.status || '—'), 'gray'];
    return { label: t[0], tone: t[1], pct: 100, color: t[1] === 'green' ? '#16a34a' : '#9aa9c0' };
  }
  const left = Number(r.days_left);
  const pct = Math.min(100, Math.max(4, ((30 - left) / 30) * 100));
  if (left < 0) return { label: 'Overdue by ' + plural(-left, 'day'), tone: 'red', pct: 100, color: '#dc2626' };
  if (left === 0) return { label: 'Due today', tone: 'red', pct: 100, color: '#dc2626' };
  if (left <= 7) return { label: plural(left, 'day') + ' left', tone: 'amber', pct, color: '#d97706' };
  return { label: plural(left, 'day') + ' left', tone: 'green', pct, color: '#16a34a' };
}

function dataOnFile(r) {
  const rv = r.review || {};
  if (r.status !== 'requested') return r.status === 'completed' ? 'Personal data erased' : '—';
  if (rv.items > 0) {
    if (rv.undecided > 0) return plural(rv.undecided, 'file') + ' to review';
    if (rv.pending_removal > 0) return plural(rv.pending_removal, 'file') + ' to purge';
    return 'Files reviewed — ready';
  }
  const n = Math.max(Number(r.files || 0), Number(r.documents || 0));
  return n ? plural(n, 'file') + ' on the account' : 'No files — one step';
}

export function renderDeletionRequests(host) {
  let view = 'open';
  let rows = [];
  let summary = {};
  const kpiHost = el('div');
  const barHost = el('div');
  const listHost = el('div');
  const onChanged = () => { try { window.dispatchEvent(new CustomEvent('lb:deletions-changed')); } catch (_) {} };

  function paintKpis() {
    const s = summary || {};
    mount(kpiHost, el('div', { class: 'cc-kpi-grid' }, [
      statCard({ icon: 'list', label: 'Open requests', value: String(s.open || 0), sub: s.open ? 'waiting for a person' : 'nothing waiting', accent: s.open ? 'blue' : 'green', onClick: () => setView('open') }),
      statCard({ icon: 'alert', label: 'Overdue', value: String(s.overdue || 0), sub: s.overdue ? 'past the 30-day promise' : 'none overdue', accent: s.overdue ? 'red' : 'green', onClick: () => setView('open') }),
      statCard({ icon: 'clock', label: 'Due within 7 days', value: String(s.due_7d || 0), sub: 'act on these first', accent: s.due_7d ? 'amber' : 'green', onClick: () => setView('open') }),
      statCard({ icon: 'check', label: 'Completed · 30 days', value: String(s.completed_30d || 0), sub: s.avg_days_to_complete != null ? 'avg ' + s.avg_days_to_complete + ' days to complete' : 'all time: ' + (s.completed_total || 0), accent: 'green', onClick: () => setView('completed') }),
    ]));
  }

  function setView(v) { if (v === view) return; view = v; paintBar(); load(); }
  function paintBar() {
    mount(barHost, el('div', { class: 'dd-bar' }, [
      segmented([
        { value: 'open', label: 'Open' },
        { value: 'completed', label: 'Completed' },
        { value: 'closed', label: 'Rejected & cancelled' },
        { value: 'all', label: 'All' },
      ], view, (v) => { view = v; load(); }),
      el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: () => load() }, 'Refresh'),
    ]));
  }

  async function load() {
    showLoading(listHost, 'Loading deletion requests…');
    let res;
    try { res = await ccAccountDeletions(view); }
    catch (e) { showError(listHost, humanizeError(e), load); return; }
    rows = (res && res.rows) || [];
    summary = (res && res.summary) || {};
    paintKpis();
    if (!rows.length) {
      showEmpty(listHost, view === 'open'
        ? 'No open deletion requests. When someone asks to delete their account, it appears here straight away.'
        : 'Nothing in this view yet.');
      return;
    }
    // Most urgent first on Open (overdue, then fewest days left); newest outcome first elsewhere.
    if (view === 'open') rows.sort((a, b) => Number(a.days_left) - Number(b.days_left));
    else rows.sort((a, b) => new Date(b.processed_at || b.requested_at) - new Date(a.processed_at || a.requested_at));
    mount(listHost, el('div', { class: 'dd-list' }, rows.map(card)));
  }

  function card(r) {
    const c = clock(r);
    const open = r.status === 'requested';
    const cls = 'dd-card' + (open && c.tone === 'red' ? ' dd-overdue' : open && c.tone === 'amber' ? ' dd-soon' : '');
    return el('div', { class: cls, role: 'button', tabindex: '0', 'aria-label': 'Open deletion request for ' + whoOf(r),
      onClick: () => openOne(r),
      onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openOne(r); } } }, [
      el('div', { class: 'dd-who' }, [
        el('div', { class: 'dd-av' }, initialsOf(r)),
        el('div', { style: 'min-width:0' }, [
          el('div', { class: 'dd-name' }, r.name || r.org_name || r.company || r.email || 'Unknown account'),
          el('div', { class: 'dd-sub' }, roleLabel(r.org_kind || r.role) + ' · ' + (r.email || '—')),
        ]),
      ]),
      el('div', null, [el('div', { class: 'dd-k' }, 'Requested'), el('div', { class: 'dd-v' }, fmtDate(r.requested_at)), el('div', { class: 'dd-sub' }, daysAgo(r.requested_at))]),
      el('div', null, [
        el('div', { class: 'dd-k' }, open ? 'Deadline' : 'Outcome'),
        pill(c.label, c.tone),
        open ? el('div', { class: 'dd-meter' }, el('i', { style: 'width:' + c.pct + '%;background:' + c.color })) : null,
        el('div', { class: 'dd-sub', style: 'margin-top:4px' }, dataOnFile(r)),
      ]),
      el('div', { class: 'dd-go' }, '›'),
    ]);
  }

  // ------------------------------------------------------------------ one request
  function openOne(r) {
    const body = el('div');
    const drawer = openDrawer(whoOf(r), body, { subtitle: 'Deletion request #' + r.id + ' · ' + roleLabel(r.org_kind || r.role) });
    paintOne(r, body, drawer, null);
    if (r.status === 'requested' && (r.review || {}).items > 0) loadReview(r, body, drawer);
  }

  function paintOne(r, body, drawer, reviewNode) {
    const c = clock(r);
    const open = r.status === 'requested';
    const orgHref = r.org_id ? (r.org_kind === 'carrier' ? '#/carrier?id=' + r.org_id : '#/broker?id=' + r.org_id) : null;
    const banner = !open
      ? el('div', { class: 'dd-banner ' + (r.status === 'completed' ? 'green' : 'blue') },
          (r.status === 'completed' ? 'Erased ' : 'Closed ') + (r.processed_at ? fmtDateTime(r.processed_at) : '') + (r.processed_by ? ' by ' + r.processed_by : '') + '.')
      : c.tone === 'red'
        ? el('div', { class: 'dd-banner red' }, [el('b', null, c.label + '. '), 'We promised completion within 30 days of ' + fmtDate(r.requested_at) + '. Complete it now, or reject it with a reason they can act on.'])
        : el('div', { class: 'dd-banner ' + (c.tone === 'amber' ? 'amber' : 'blue') }, [el('b', null, c.label + '. '), 'Due ' + fmtDate(r.due_at) + ' — 30 days from the request.']);

    const mcdot = [r.mc_number ? 'MC ' + r.mc_number : '', r.dot_number ? 'DOT ' + r.dot_number : ''].filter(Boolean).join(' · ');
    const facts = el('div', { class: 'dd-box dd-grid' }, [
      field('Name', r.name), field('Email', r.email ? el('a', { href: 'mailto:' + r.email, style: 'color:#0883F7;font-weight:600' }, r.email) : null),
      field('Account type', roleLabel(r.org_kind || r.role)), field('Company', r.org_name || r.company),
      field('MC / DOT', mcdot || null),
      field('Account opened', r.account_created_at ? fmtDate(r.account_created_at) : null),
      field('Last sign-in', r.last_sign_in_at ? fmtDateTime(r.last_sign_in_at) : 'Never'),
      field('Requested', fmtDateTime(r.requested_at)),
      field('Files on the account', open ? (Number(r.files || 0) + ' stored · ' + Number(r.documents || 0) + ' document records') : null),
      field('Profile', orgHref && open ? el('a', { href: orgHref, style: 'color:#0883F7;font-weight:600' }, 'Open ' + (r.org_kind === 'carrier' ? 'Carrier 360' : 'Broker 360') + ' →') : null),
    ]);

    const reason = r.reason ? [el('div', { class: 'dd-sec' }, 'What they said'), el('div', { class: 'dd-quote' }, r.reason)] : null;

    const erase = open ? [el('div', { class: 'dd-sec' }, 'What completing does'), el('div', { class: 'dd-box' }, [
      el('div', { class: 'dd-grid' }, [
        el('div', null, [el('div', { class: 'dd-k', style: 'color:#dc2626' }, 'Erased'), el('ul', { class: 'dd-ul' }, [
          el('li', null, 'Name, phone, company and email on the profile'),
          el('li', null, 'Bank and payout details'),
          el('li', null, 'Document records, and the files you mark "remove"'),
          el('li', null, 'Name and email on chats; CRM and outreach contacts'),
          el('li', null, 'Devices, push subscriptions, notifications, preferences'),
          el('li', null, 'Login — closed for good, every session signed out')])]),
        el('div', null, [el('div', { class: 'dd-k', style: 'color:#16a34a' }, 'Kept (US law)'), el('ul', { class: 'dd-ul' }, [
          el('li', null, 'Delivered-load paperwork — 3 years'),
          el('li', null, 'Invoices and settlements — 7 years'),
          el('li', null, 'Files you mark "hold", until the date you set'),
          el('li', null, 'Their email on the do-not-email list, so we never write again')])]),
      ]),
    ])] : null;

    const note = !open && r.note ? [el('div', { class: 'dd-sec' }, 'Record'), el('div', { class: 'dd-box', style: 'white-space:pre-wrap;font-size:.85rem;color:#1c2f4d;word-break:break-word' }, r.note)] : null;

    const actions = open ? el('div', { class: 'dd-actions' }, [
      el('button', { class: 'lb-btn lb-btn-primary dd-danger', onClick: () => { drawer.close(); confirmComplete(r); } }, 'Complete deletion…'),
      el('button', { class: 'lb-btn lb-btn-secondary', onClick: () => { drawer.close(); doReject(r); } }, 'Reject with a reason'),
      el('button', { class: 'lb-btn lb-btn-ghost', onClick: () => copyEmail(r, 'received') }, 'Copy "request received" email'),
    ]) : (r.status === 'completed' ? el('div', { class: 'dd-actions' }, [
      el('button', { class: 'lb-btn lb-btn-ghost', onClick: () => copyEmail(r, 'done') }, 'Copy "account deleted" email'),
    ]) : null);

    mount(body, [el('style', null, CSS), banner, facts, reason, erase, reviewNode, note, actions]);
  }

  // ------------------------------------------------------------------ file review
  async function loadReview(r, body, drawer) {
    const box = el('div', null, [el('div', { class: 'dd-sec' }, 'File review'), el('div', { class: 'dd-box' }, 'Loading files…')]);
    paintOne(r, body, drawer, box);
    let res;
    try { res = await ccErasureItems(r.id); }
    catch (e) { mount(box, [el('div', { class: 'dd-sec' }, 'File review'), el('div', { class: 'dd-banner red' }, humanizeError(e))]); return; }
    paintReview(r, body, drawer, box, (res && res.items) || [], (res && res.classes) || []);
  }

  function paintReview(r, body, drawer, box, items, classes) {
    const undecided = items.filter(i => !i.decision).length;
    const pending = items.filter(i => i.decision === 'remove' && !i.removed_at).length;
    const classLabel = (k) => (classes.find(c => c.key === k) || {}).label || k || '—';

    const rowFor = (it) => {
      const item = it.item || {};
      let status;
      if (it.decision === 'hold') status = pill('Hold · ' + classLabel(it.retention_class) + (it.retain_until ? ' until ' + fmtDate(it.retain_until) : ''), 'blue');
      else if (it.decision === 'remove' && it.removed_at) status = pill('Removed ' + fmtDate(it.removed_at), 'green');
      else if (it.decision === 'remove') status = pill('Remove · waiting for purge', 'amber');
      else status = pill('Needs a decision', 'red');
      const sug = it.suggested_decision === 'hold'
        ? 'Suggested: hold — ' + classLabel(it.suggested_class) + (it.suggested_until ? ' until ' + fmtDate(it.suggested_until) : '')
        : 'Suggested: remove (no legal reason to keep it)';
      return el('div', { class: 'dd-file' }, [
        el('div', { style: 'min-width:0' }, [
          el('div', { class: 'dd-name', style: 'font-size:.9rem' }, fileName(item.path)),
          el('div', { class: 'dd-sub' }, (item.kind || item.source || 'file') + ' · ' + sug),
          el('div', { style: 'margin-top:5px' }, status),
        ]),
        it.removed_at ? el('span') : el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end' }, [
          el('button', { class: 'lb-btn lb-btn-sm' + (it.decision === 'remove' ? ' lb-btn-primary' : ''), onClick: () => decide(r, body, drawer, it, 'remove') }, 'Remove'),
          el('button', { class: 'lb-btn lb-btn-sm' + (it.decision === 'hold' ? ' lb-btn-primary' : ''), onClick: () => { drawer.close(); holdSheet(r, it, classes); } }, 'Hold…'),
        ]),
      ]);
    };

    const head = undecided
      ? el('div', { class: 'dd-banner amber' }, [el('b', null, plural(undecided, 'file') + ' need a decision. '), 'Remove what the law does not require us to keep; hold the rest with a retention class and date. Each suggestion is worked out from their paid settlements and delivered loads.'])
      : pending
        ? el('div', { class: 'dd-banner amber' }, [el('b', null, plural(pending, 'file') + ' marked remove. '), 'Purge them, then complete the deletion.'])
        : el('div', { class: 'dd-banner green' }, [el('b', null, 'Every file is decided and done. '), 'You can complete the deletion now.']);

    const bulk = (undecided || pending) ? el('div', { class: 'dd-actions', style: 'margin-top:0;margin-bottom:10px' }, [
      undecided ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: () => applySuggestions(r, body, drawer, items) }, 'Apply every suggestion (' + undecided + ')') : null,
      pending ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: () => purge(r, body, drawer, pending) }, 'Purge ' + plural(pending, 'file')) : null,
    ]) : null;

    mount(box, [el('div', { class: 'dd-sec' }, 'File review · ' + plural(items.length, 'file')), head, bulk, el('div', { class: 'dd-box' }, items.map(rowFor))]);
  }

  const DECIDE_ERR = {
    hold_needs_class_and_future_date: 'A hold needs a retention class and a future date.',
    unknown_retention_class: 'Pick a retention class from the list.',
    item_not_in_inventory: 'That file is no longer on the list — refresh.',
    no_open_request: 'This request is no longer open.',
    bad_decision: 'Choose remove or hold.',
  };

  async function decide(r, body, drawer, it, decision, cls, until) {
    try {
      const out = await ccErasureDecide(r.id, it.item_key, decision, cls || null, until || null, null);
      if (out && out.error) throw new Error(DECIDE_ERR[out.error] || out.error);
      if (body) loadReview(r, body, drawer);
      return true;
    } catch (e) { toast(humanizeError(e), 'error'); return false; }
  }

  function holdSheet(r, it, classes) {
    const opts = classes.filter(c => c.key !== 'D_unused');
    const want = it.retention_class || it.suggested_class;
    const sel = el('select', { class: 'cc-input' }, opts.map(c =>
      el('option', { value: c.key, selected: want === c.key ? true : null }, c.label + (c.years ? ' (' + c.years + ' yrs)' : ''))));
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const d0 = String(it.retain_until || it.suggested_until || new Date(Date.now() + 3 * 365 * 86400000).toISOString()).slice(0, 10);
    const date = el('input', { class: 'cc-input', type: 'date', value: d0 < tomorrow ? tomorrow : d0, min: tomorrow });
    const save = el('button', { class: 'lb-btn lb-btn-primary' }, 'Save hold');
    const sheet = openDrawer('Hold ' + fileName((it.item || {}).path), el('div', null, [
      el('style', null, CSS),
      el('p', { class: 'cc-sub', style: 'margin:0 0 10px;line-height:1.6' }, 'The file stays in storage until this date. Pick the legal reason we keep it.'),
      el('div', { class: 'dd-k' }, 'Retention class'), sel,
      el('div', { class: 'dd-k', style: 'margin-top:10px' }, 'Keep until'), date,
      el('div', { class: 'dd-actions' }, [save, el('button', { class: 'lb-btn', onClick: () => { sheet.close(); reopen(r); } }, 'Cancel')]),
    ]), { subtitle: 'Deletion request #' + r.id });
    save.addEventListener('click', async () => {
      save.disabled = true;
      const ok = await decide(r, null, null, it, 'hold', sel.value, date.value);
      if (ok) { sheet.close(); reopen(r); } else save.disabled = false;
    });
  }

  async function applySuggestions(r, body, drawer, items) {
    const todo = items.filter(i => !i.decision);
    let ok = 0, manual = 0;
    for (const it of todo) {
      try {
        let out;
        if (it.suggested_decision === 'hold') {
          if (!it.suggested_class || !it.suggested_until) { manual++; continue; }
          out = await ccErasureDecide(r.id, it.item_key, 'hold', it.suggested_class, it.suggested_until, 'applied suggestion');
        } else {
          out = await ccErasureDecide(r.id, it.item_key, 'remove', null, null, 'applied suggestion');
        }
        if (out && out.error) manual++; else ok++;
      } catch (_) { manual++; }
    }
    toast(ok + ' decided' + (manual ? ' · ' + manual + ' need your decision' : ''), manual ? 'info' : 'success');
    loadReview(r, body, drawer);
  }

  async function purge(r, body, drawer, pending) {
    try {
      const out = await ccErasurePurge(r.id);
      const done = ((out && out.results) || []).filter(x => x && (x.result === 'removed' || x.status === 'removed')).length;
      toast(done + ' of ' + pending + ' files purged', done ? 'success' : 'info');
    } catch (e) {
      toast(e && e.code === 'PURGE_NOT_LIVE'
        ? 'File purge is not switched on for this environment yet (erasure-purge function). Nothing was removed.'
        : humanizeError(e), 'error');
    }
    loadReview(r, body, drawer);
  }

  async function reopen(r) {
    await load();
    openOne(rows.find(x => x.id === r.id) || r);
  }

  // ------------------------------------------------------------------ complete / reject
  function confirmComplete(r) {
    const who = whoOf(r);
    const input = el('input', { class: 'cc-input', placeholder: 'Type DELETE', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Type DELETE to confirm' });
    const go = el('button', { class: 'lb-btn lb-btn-primary dd-danger', disabled: true }, 'Erase account');
    input.addEventListener('input', () => { go.disabled = input.value.trim().toUpperCase() !== 'DELETE'; });
    const hasFiles = Number(r.files || 0) + Number(r.documents || 0) > 0;
    const sheet = openDrawer('Erase ' + who + '?', el('div', null, [
      el('style', null, CSS),
      el('div', { class: 'dd-banner red' }, [el('b', null, 'This cannot be undone. '), 'Their profile, contact details, bank details, document records and login are erased now. Records US law requires are kept with their personal details stripped out.']),
      hasFiles ? el('div', { class: 'dd-banner blue' }, 'This account has files. If any still need a decision you go to the file review first — nothing is erased until every file is decided.') : null,
      el('div', { class: 'dd-k' }, 'To confirm, type DELETE'), input,
      el('div', { class: 'dd-actions' }, [go, el('button', { class: 'lb-btn', onClick: () => { sheet.close(); openOne(r); } }, 'Keep the account')]),
    ]), { subtitle: 'Deletion request #' + r.id + (r.email ? ' · ' + r.email : '') });
    setTimeout(() => { try { input.focus(); } catch (_) {} }, 60);
    go.addEventListener('click', async () => {
      go.disabled = true; go.textContent = 'Erasing…';
      try {
        await ccAccountDeletionProcess(r.id, 'complete', 'Completed from the Deletion desk.');
        sheet.close();
        toast(who + ' erased', 'success');
        onChanged();
        await reopen(r);
      } catch (e) {
        if (e && e.code === 'ERASURE_REVIEW_REQUIRED') {
          sheet.close();
          toast('Some files need a decision before the account can be erased', 'info');
          onChanged();
          await load();
          const fresh = rows.find(x => x.id === r.id) || r;
          const b2 = el('div');
          const d2 = openDrawer(whoOf(fresh), b2, { subtitle: 'Deletion request #' + fresh.id + ' · file review' });
          loadReview(fresh, b2, d2);
        } else {
          go.disabled = false; go.textContent = 'Erase account';
          toast(humanizeError(e), 'error');
        }
      }
    });
  }

  async function doReject(r) {
    const reason = await askReason('Reject deletion request #' + r.id, {
      placeholder: 'Why can it not be deleted yet? Write it so the user can act on it — for example: an unpaid invoice must be settled first, or we could not confirm the request came from the account holder.',
      submitLabel: 'Reject request',
    });
    if (!reason) { openOne(r); return; }
    try {
      await ccAccountDeletionProcess(r.id, 'reject', typeof reason === 'string' ? reason : reason.note);
      toast('Request rejected — tell the user why', 'success');
      onChanged();
      await reopen(r);
    } catch (e) { toast(humanizeError(e), 'error'); }
  }

  function copyEmail(r, kind) {
    const first = String(r.name || '').trim().split(/\s+/)[0] || 'there';
    const acct = r.org_name ? ' for ' + r.org_name : '';
    const text = kind === 'done'
      ? 'Hi ' + first + ',\n\nThank you for confirming. Your LoadBoot account' + acct + ' has now been deleted, including your profile, contact details and login, and you will not receive any further emails from us.\n\nIf you ever need anything in the future, you are always welcome back.\n\nBest regards,\nLoadBoot | hello@loadboot.com'
      : 'Hi ' + first + ',\n\nWe have received your request to delete your LoadBoot account' + acct + '. A member of our team will complete it by ' + fmtDate(r.due_at) + ' and confirm by email when it is done. If you change your mind before then, just reply to this email.\n\nBest regards,\nLoadBoot | hello@loadboot.com';
    try {
      navigator.clipboard.writeText(text).then(() => toast('Email copied — paste it into your reply', 'success'), () => toast('Could not copy — your browser blocked the clipboard', 'error'));
    } catch (_) { toast('Could not copy — your browser blocked the clipboard', 'error'); }
  }

  paintBar();
  mount(host, el('div', { class: 'cc-view' }, [
    el('style', null, CSS),
    sectionHead('Deletion requests', 'People who asked us to delete their account and personal data. Every request must be completed — or rejected with a reason — within 30 days.'),
    kpiHost, barHost, listHost,
  ]));
  load();
}

export default renderDeletionRequests;
