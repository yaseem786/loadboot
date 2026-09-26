// Newsletter — LoadBoot Weekly's Command Center screen (bl_comm_0447 double opt-in, bl_comm_0448 the weekly engine).
// Top: this week's three issues (carrier / dispatcher / public newsletter) — built Monday 12:00 UTC, previewed here as a
// real recipient would get them, approved by the owner (or automatically when approval = auto), sent Tuesday 14:00 UTC.
// Middle: the content pool (tips, compliance reminders, articles) — drafts from the Tuesday article Routine or added
// here, approved before the engine may pick them. Bottom: the double opt-in subscriber list from 0447 (who asked, who
// confirmed, who left; "Send confirmation email" is the approval step for pre-double-opt-in addresses).
// Every send goes through sys_email → email_gate; an unsubscribe by any route flips the row and the gate refuses.
import { el, mount } from '../../shared/ui/dom.js';
import { sectionHead, statCard, searchBox, segmented, openDrawer, fmtDateTime, ago, askConfirm } from '../../shared/ui/components.js';
import { toast, humanizeError } from '../../shared/errors.js';
import { showLoading, showError } from '../../shared/loading.js';
import { can } from '../../shared/permissions.js';
import { newsletterOverview, newsletterPerson, newsletterSendConfirm,
         weeklyOverview, weeklyPreview, weeklyIssueSet, weeklyContentList, weeklyContentSet, weeklySettingsSet } from '../../shared/api.js';

const STATUS_TONE = { pending: 'amber', confirmed: 'green', unsubscribed: 'gray' };
const STATUS_LABEL = { pending: 'Pending', confirmed: 'Confirmed', unsubscribed: 'Unsubscribed' };
const GATE_TONE = { ok: 'green', essential: 'green', suppressed: 'red', unsubscribed_all: 'red', unsubscribed_group: 'amber', unsubscribed_marketing: 'amber', preference_opted_out: 'amber', frequency_cap: 'violet' };
const ISSUE_TONE = { 'not built': 'gray', draft: 'amber', approved: 'green', sent: 'blue', skipped: 'gray' };
const AUD = { carrier: { label: 'Carriers', sub: 'registered carriers · their week + rates for their equipment', key: 'weekly.carrier' },
              dispatcher: { label: 'Dispatchers', sub: 'active dispatchers · their carriers, bookings, fleet rates', key: 'weekly.dispatcher' },
              public: { label: 'Newsletter', sub: 'confirmed subscribers who are not carriers or dispatchers', key: 'newsletter.weekly' } };
const KIND = { tip_carrier: 'Carrier tips', tip_dispatcher: 'Dispatcher tips', compliance: 'Compliance reminders', article: 'Articles' };
const POOL_TONE = { draft: 'amber', approved: 'green', retired: 'gray' };
const pill = (label, tone) => el('span', { class: 'cc-pill cc-pill-' + (tone || 'gray') }, String(label || '—'));
const num = (n) => Number(n || 0).toLocaleString();
const sub = (t, style) => el('div', { class: 'cc-sub', style: style || '' }, t);
const when = (ts) => ts ? el('span', { title: fmtDateTime(ts), style: 'white-space:nowrap' }, ago(ts)) : '—';
const qs = () => { try { return new URLSearchParams((location.hash.split('?')[1] || '')); } catch (_) { return new URLSearchParams(); } };
const snip = (t, n) => { const s = String(t || ''); return s.length > (n || 90) ? s.slice(0, (n || 90) - 1) + '…' : s; };

function table(cols, rows, onRow) {
  return el('div', { class: 'cc-table-wrap' }, el('table', { class: 'cc-table' }, [
    el('thead', null, el('tr', null, cols.map(c => el('th', null, c)))),
    el('tbody', null, rows.map(r => el('tr', { class: onRow ? 'clickable' : '', onClick: onRow ? () => onRow(r.row) : null }, r.cells.map(c => el('td', null, c))))),
  ]));
}

export async function renderNewsletter(host) {
  const manage = can('comm.manage') || can('settings.manage') || can('content.manage');
  let status = '', q = '', overview = null, weekly = null, poolKind = 'tip_carrier', poolStatus = '';

  const weeklyBox = el('div');
  const poolBox = el('div');
  const kpis = el('div', { class: 'cc-kpi-grid' });
  const toolbar = el('div', { class: 'cc-toolbar', style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:6px 0 14px' });
  const listBox = el('div');
  const weeklyBtn = el('button', { class: 'lb-btn', onClick: () => toggleWeekly() }, 'Weekly send');
  const approvalBtn = el('button', { class: 'lb-btn', onClick: () => toggleApproval() }, 'Approval');

  const head = sectionHead(
    'LoadBoot Weekly',
    'One weekly email, three versions. Monday 12:00 UTC the engine builds this week’s issues (rates with week-over-week, one tip, one compliance reminder, one article). You preview each one exactly as a recipient would get it, approve, and Tuesday 14:00 UTC it goes out — carriers get their own week and their equipment’s rates, dispatchers their fleet, newsletter subscribers the market version. Every send passes the unsubscribe gate.',
    [
      manage ? weeklyBtn : null,
      manage ? approvalBtn : null,
      manage ? el('button', { class: 'lb-btn', onClick: () => buildNow() }, 'Build this week now') : null,
    ],
  );
  mount(host, el('div', { class: 'cc-view' }, [head, weeklyBox,
    el('div', { style: 'font-weight:800;font-size:1.05rem;margin:26px 0 4px' }, 'Content pool'),
    sub('What the engine picks from, least-used first. Drafts come from the Tuesday article Routine or from “Add”; only approved items are ever sent. Approve, retire, or add your own.', 'margin-bottom:10px'),
    poolBox,
    el('div', { style: 'font-weight:800;font-size:1.05rem;margin:26px 0 4px' }, 'Newsletter subscribers'),
    sub('The footer form (“Get carrier tips & better loads”) with double opt-in. A person asks, gets one confirmation email, and is on the list only after the click. Registered carriers and dispatchers who also subscribe get their role version instead.', 'margin-bottom:10px'),
    kpis, toolbar, listBox]));

  mount(toolbar, [
    segmented([{ value: '', label: 'Everyone' }, { value: 'pending', label: 'Pending' }, { value: 'confirmed', label: 'Confirmed' }, { value: 'unsubscribed', label: 'Unsubscribed' }],
      status, (v) => { status = v; load(); }),
    searchBox('Search address or source page…', (v) => { q = v; load(); }),
  ]);

  // ---------------------------------------------------------------- this week's issues
  async function loadWeekly() {
    showLoading(weeklyBox, 'Loading this week…');
    try { weekly = await weeklyOverview(); }
    catch (e) { showError(weeklyBox, humanizeError(e), loadWeekly); return; }
    weeklyBtn.textContent = 'Weekly send: ' + (weekly.enabled ? 'ON' : 'off');
    weeklyBtn.className = 'lb-btn' + (weekly.enabled ? ' lb-btn-primary' : '');
    approvalBtn.textContent = 'Approval: ' + (weekly.approval === 'auto' ? 'automatic' : 'manual');
    const cards = (weekly.issues || []).map(i => issueCard(i));
    mount(weeklyBox, [
      el('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:4px 0 10px' }, [
        pill(weekly.week_label + ' · ' + weekly.week, 'blue'),
        pill(weekly.enabled ? 'Send is ON' : 'Send is OFF — nothing goes out', weekly.enabled ? 'green' : 'amber'),
        pill(weekly.approval === 'auto' ? 'Auto-approve' : 'Manual approval', weekly.approval === 'auto' ? 'violet' : 'gray'),
        sub('Build ' + (weekly.next_build || '—') + ' · send ' + (weekly.next_send || '—') + ' (UTC, cron) · rates as of ' + (weekly.as_of || '—')),
      ]),
      el('div', { class: 'cc-kpi-grid', style: 'align-items:stretch' }, cards),
      (weekly.history || []).length ? el('details', { style: 'margin-top:10px' }, [
        el('summary', { style: 'cursor:pointer;font-weight:600;color:#475569' }, 'Past weeks'),
        table(['Week', 'Version', 'Status', 'Queued', 'Refused', 'Sent'], weekly.history.map(h => ({ cells: [h.week, AUD[h.audience] ? AUD[h.audience].label : h.audience, pill(h.status, ISSUE_TONE[h.status]), num(h.sent_count), num(h.refused_count), when(h.sent_at)] }))),
      ]) : null,
    ]);
  }

  function issueCard(i) {
    const a = AUD[i.audience] || { label: i.audience, sub: '' };
    const st = i.status || 'not built';
    const built = st !== 'not built';
    const canSend = manage && weekly.enabled && (st === 'approved' || st === 'sent');
    const line = (label, v) => v ? el('div', { style: 'font-size:.86rem;line-height:1.4;margin-top:6px' }, [el('span', { style: 'color:#64748b;font-weight:600' }, label + ' '), snip(v.title || v.body, 110)]) : null;
    return el('div', { class: 'lb-card', style: 'padding:16px 18px;display:flex;flex-direction:column;gap:6px' }, [
      el('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:8px' }, [
        el('div', { style: 'font-weight:800;font-size:1.02rem' }, a.label), pill(st, ISSUE_TONE[st]),
      ]),
      sub(a.sub),
      el('div', { style: 'font-size:.86rem;color:#475569;margin-top:2px' }, num(i.recipients) + ' recipient' + (i.recipients === 1 ? '' : 's') + (i.already_sent ? ' · ' + num(i.already_sent) + ' already got it' : '')
        + (st === 'sent' ? ' · queued ' + num(i.sent_count) + (i.refused_count ? ', refused ' + num(i.refused_count) : '') : '')),
      built ? line('Tip:', i.tip) : null,
      built ? line('Reminder:', i.compliance) : null,
      built ? line('Article:', i.article) : null,
      i.note ? sub(i.note) : null,
      el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:auto;padding-top:8px' }, [
        el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: () => previewDrawer(i.audience) }, 'Preview'),
        manage && !built ? el('button', { class: 'lb-btn lb-btn-sm', onClick: () => buildNow(i.audience) }, 'Build') : null,
        manage && st === 'draft' ? el('button', { class: 'lb-btn lb-btn-sm', onClick: () => issueAction('approve', i.audience) }, 'Approve') : null,
        manage && st === 'approved' ? el('button', { class: 'lb-btn lb-btn-sm', onClick: () => issueAction('unapprove', i.audience) }, 'Un-approve') : null,
        manage && (st === 'draft' || st === 'approved') ? el('button', { class: 'lb-btn lb-btn-sm', onClick: () => issueAction('skip', i.audience) }, 'Skip this week') : null,
        manage && st === 'skipped' ? el('button', { class: 'lb-btn lb-btn-sm', onClick: () => issueAction('unapprove', i.audience) }, 'Back to draft') : null,
        canSend ? el('button', { class: 'lb-btn lb-btn-sm', onClick: () => sendNow(i.audience) }, st === 'sent' ? 'Send to anyone new' : 'Send now') : null,
      ]),
    ]);
  }

  async function issueAction(action, audience, extra) {
    const labels = { approve: ['Approve the ' + AUD[audience].label.toLowerCase() + ' version?', 'It goes out Tuesday 14:00 UTC to ' + num((weekly.issues.find(x => x.audience === audience) || {}).recipients) + ' recipients (if the weekly send is on), or now with “Send now”. Preview it first.', 'Approve'],
                     unapprove: ['Take the approval back?', 'It stays built; nothing is sent until it is approved again.', 'Un-approve'],
                     skip: ['Skip this version this week?', 'Nothing goes to ' + AUD[audience].label.toLowerCase() + ' this week. Next Monday builds a fresh one.', 'Skip'] };
    const l = labels[action];
    if (l) { const ok = await askConfirm(l[0], { body: l[1], confirmLabel: l[2] }); if (!ok) return; }
    try {
      const r = await weeklyIssueSet(Object.assign({ action, audience }, extra || {}));
      if (r && r.ok === false) { toast(r.error || 'Could not do that', 'error'); return; }
      toast(action === 'approve' ? 'Approved' : action === 'swap' ? 'Swapped' : 'Done', 'success'); loadWeekly();
    } catch (e) { toast(humanizeError(e), 'error'); }
  }

  async function buildNow(audience) {
    const exists = weekly && (weekly.issues || []).some(i => (!audience || i.audience === audience) && i.status !== 'not built' && i.status !== 'sent');
    const ok = await askConfirm(audience ? 'Build the ' + AUD[audience].label.toLowerCase() + ' version now?' : 'Build this week’s issues now?', {
      body: (exists ? 'Existing drafts/approvals for this week are rebuilt from scratch (approvals are cleared). ' : '') + 'The engine snapshots today’s rates and picks the least-used approved tip, reminder and article. Nothing is sent.',
      confirmLabel: exists ? 'Rebuild' : 'Build' });
    if (!ok) return;
    try { await weeklyIssueSet({ action: 'build', audience: audience || 'all', force: true }); toast('Built', 'success'); loadWeekly(); loadPool(); }
    catch (e) { toast(humanizeError(e), 'error'); }
  }

  async function sendNow(audience) {
    const i = (weekly.issues || []).find(x => x.audience === audience) || {};
    const left = Math.max(0, (i.recipients || 0) - (i.already_sent || 0));
    const ok = await askConfirm('Send the ' + AUD[audience].label.toLowerCase() + ' version now?', {
      body: 'Queues it for ' + num(left) + ' recipient' + (left === 1 ? '' : 's') + ' who have not had this week’s issue. Each one is rendered with their own data and passes the unsubscribe gate; refusals show in Unsubscribes → Blocked sends. This cannot be recalled.',
      confirmLabel: 'Send' });
    if (!ok) return;
    try {
      const r = await weeklyIssueSet({ action: 'send_now', audience });
      if (r && r.ok === false) { toast(r.error || 'Could not send', 'error'); return; }
      const res = ((r && r.results) || []).find(x => x.audience === audience) || {};
      toast('Queued ' + num(res.queued) + (res.refused ? ', refused ' + num(res.refused) : ''), 'success'); loadWeekly(); load();
    } catch (e) { toast(humanizeError(e), 'error'); }
  }

  async function toggleWeekly() {
    const on = !!(weekly && weekly.enabled);
    const ok = await askConfirm(on ? 'Switch the weekly send off?' : 'Switch the weekly send on?', {
      body: on ? 'The Tuesday cron will run but send nothing until it is switched on again.'
               : 'Every Tuesday 14:00 UTC the approved issues go out: carriers, dispatchers and newsletter subscribers each get their version. Unapproved versions are skipped and you get a staff email. Each send goes through the unsubscribe gate.',
      confirmLabel: on ? 'Switch off' : 'Switch on' });
    if (!ok) return;
    try { await weeklySettingsSet({ enabled: !on }); toast(on ? 'Weekly send is off' : 'Weekly send is on', 'success'); loadWeekly(); }
    catch (e) { toast(humanizeError(e), 'error'); }
  }

  async function toggleApproval() {
    const auto = !!(weekly && weekly.approval === 'auto');
    const ok = await askConfirm(auto ? 'Back to manual approval?' : 'Switch to automatic approval?', {
      body: auto ? 'Monday’s build stays a draft until you approve each version here. You get a staff email when drafts are ready.'
                 : 'Monday’s build is approved at once and goes out Tuesday without anyone looking. Recommended only after a few weeks of previewing what the engine produces.',
      confirmLabel: auto ? 'Manual' : 'Automatic' });
    if (!ok) return;
    try { await weeklySettingsSet({ approval: auto ? 'manual' : 'auto' }); toast('Approval is ' + (auto ? 'manual' : 'automatic'), 'success'); loadWeekly(); }
    catch (e) { toast(humanizeError(e), 'error'); }
  }

  // Preview = the exact email for one recipient (pick another from the list); swap a tip/reminder/article from here.
  async function previewDrawer(audience, sample) {
    const body = el('div');
    const a = AUD[audience];
    openDrawer('This week — ' + a.label, body, { subtitle: 'Exactly what this recipient gets (the worker adds the header, footer and unsubscribe link). Nothing is sent from here.', size: 'lg' });
    showLoading(body, 'Rendering…');
    let p;
    try { p = await weeklyPreview(audience, sample); } catch (e) { showError(body, humanizeError(e), () => previewDrawer(audience, sample)); return; }
    const frame = el('iframe', { style: 'width:100%;height:68vh;border:1px solid #e2e8f0;border-radius:12px;background:#fff', sandbox: '' });
    const picker = (p.samples || []).length ? el('select', { class: 'cc-input', style: 'max-width:340px', onChange: (ev) => previewDrawer(audience, ev.target.value) },
      p.samples.map(s => el('option', { value: s.id, selected: p.sample && p.sample.id === s.id ? true : null }, s.label))) : null;
    const swapBtn = (slot, label) => (!manage || !p.issue_exists) ? null : el('button', { class: 'lb-btn lb-btn-sm', onClick: () => swapDrawer(audience, slot) }, 'Change ' + label);
    mount(body, [
      el('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px' }, [
        el('div', { style: 'font-weight:700' }, 'Subject: ' + (p.subject || '')),
        p.sample && p.sample.demo ? pill('Demo data', 'amber') : null,
      ]),
      el('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px' }, [
        sub('Viewing as: ' + ((p.sample && p.sample.label) || '—')), picker,
        p.issue_exists ? null : pill('Not built yet — this is what Monday would build', 'gray'),
      ]),
      el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px' }, [swapBtn('tip', 'tip'), swapBtn('compliance', 'reminder'), swapBtn('article', 'article')]),
      frame,
    ]);
    frame.srcdoc = '<!doctype html><meta charset="utf-8"><body style="margin:0;padding:28px 12px;background:#eef2f8;font-family:Segoe UI,Arial,sans-serif;color:#0f172a;font-size:15px;line-height:1.7">'
      + '<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;border:1px solid #e2e8f0;padding:34px 32px 30px">' + (p.html || '') + '</div></body>';
  }

  async function swapDrawer(audience, slot) {
    const kind = slot === 'tip' ? (audience === 'dispatcher' ? 'tip_dispatcher' : 'tip_carrier') : slot;
    const body = el('div');
    openDrawer('Pick a ' + (slot === 'compliance' ? 'reminder' : slot), body, { subtitle: 'Approved ' + KIND[kind].toLowerCase() + ', least used first. Click one to put it in this week’s ' + AUD[audience].label.toLowerCase() + ' version.', size: 'lg' });
    showLoading(body, 'Loading…');
    let rows;
    try { rows = await weeklyContentList(kind, 'approved'); } catch (e) { showError(body, humanizeError(e), () => swapDrawer(audience, slot)); return; }
    if (!rows.length) { mount(body, sub('Nothing approved of this kind. Add one in the content pool first.')); return; }
    mount(body, table(['', 'Used', 'Last used'], rows.map(r => ({ row: r, cells: [
      el('div', { style: 'max-width:640px;line-height:1.45' }, [r.title ? el('div', { style: 'font-weight:700' }, r.title) : null, el('div', null, r.body), r.url ? sub(r.url) : null]),
      num(r.used_count), when(r.last_used_at)] })), async (r) => {
        await issueAction('swap', audience, { slot, content_id: r.id });
        previewDrawer(audience);
      }));
  }

  // ---------------------------------------------------------------- content pool
  async function loadPool() {
    showLoading(poolBox, 'Loading the pool…');
    let rows;
    try { rows = await weeklyContentList(poolKind, poolStatus); } catch (e) { showError(poolBox, humanizeError(e), loadPool); return; }
    const counts = ((weekly && weekly.pool) || []).reduce((m, k) => { m[k.kind] = k; return m; }, {});
    const tabs = Object.keys(KIND).map(k => ({ value: k, label: KIND[k] + (counts[k] ? ' ' + counts[k].approved + (counts[k].draft ? ' +' + counts[k].draft + ' draft' : '') : '') }));
    mount(poolBox, [
      el('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:6px 0 10px' }, [
        segmented(tabs, poolKind, (v) => { poolKind = v; loadPool(); }),
        segmented([{ value: '', label: 'All' }, { value: 'draft', label: 'Drafts' }, { value: 'approved', label: 'Approved' }, { value: 'retired', label: 'Retired' }], poolStatus, (v) => { poolStatus = v; loadPool(); }),
        manage ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: () => addDrawer(poolKind) }, '+ Add') : null,
      ]),
      rows.length ? table(['', 'Status', 'Source', 'Used', 'Last used', ''], rows.map(r => ({ cells: [
        el('div', { style: 'max-width:620px;line-height:1.45' }, [r.title ? el('div', { style: 'font-weight:700' }, r.title) : null, el('div', null, r.body), r.url ? sub(r.url) : null, r.note ? sub('Note: ' + r.note) : null]),
        pill(r.status, POOL_TONE[r.status]), r.source, num(r.used_count), when(r.last_used_at),
        manage ? el('div', { style: 'display:flex;gap:4px;flex-wrap:wrap' }, [
          r.status !== 'approved' ? el('button', { class: 'lb-btn lb-btn-sm', onClick: () => poolAction('approve', r) }, 'Approve') : null,
          r.status !== 'retired' ? el('button', { class: 'lb-btn lb-btn-sm', onClick: () => poolAction('retire', r) }, 'Retire') : null,
          r.status === 'draft' ? el('button', { class: 'lb-btn lb-btn-sm', onClick: () => poolAction('delete', r) }, 'Delete') : null,
        ]) : '',
      ] }))) : el('div', { class: 'lb-card', style: 'padding:22px;text-align:center' }, sub('Nothing here.')),
    ]);
  }

  async function poolAction(action, r) {
    if (action === 'delete') { const ok = await askConfirm('Delete this draft?', { body: snip(r.title || r.body, 160), confirmLabel: 'Delete' }); if (!ok) return; }
    try {
      const res = await weeklyContentSet({ action, id: r.id });
      if (res && res.ok === false) { toast(res.error || 'Could not do that', 'error'); return; }
      toast('Done', 'success'); loadWeekly().then(loadPool);
    } catch (e) { toast(humanizeError(e), 'error'); }
  }

  function addDrawer(kind) {
    const body = el('div');
    const drawer = openDrawer('Add to the pool', body, { subtitle: 'Approve now to make it pickable this Monday, or leave it as a draft to review later.', size: 'sm' });
    const kindSel = el('select', { class: 'cc-input' }, Object.keys(KIND).map(k => el('option', { value: k, selected: k === kind ? true : null }, KIND[k])));
    const titleIn = el('input', { class: 'cc-input', placeholder: 'Title (articles)' });
    const urlIn = el('input', { class: 'cc-input', placeholder: 'URL (articles) — /how-to-read-a-rate-confirmation.html or https://…' });
    const bodyIn = el('textarea', { class: 'cc-input', rows: '5', placeholder: 'The tip, reminder, or the article’s one-paragraph blurb. One idea, something the reader can act on this week.' });
    const approveIn = el('input', { type: 'checkbox', checked: true });
    const showArticle = () => { const a = kindSel.value === 'article'; titleIn.style.display = a ? '' : 'none'; urlIn.style.display = a ? '' : 'none'; };
    kindSel.addEventListener('change', showArticle); showArticle();
    mount(body, [
      el('div', { style: 'display:grid;gap:10px' }, [kindSel, titleIn, urlIn, bodyIn,
        el('label', { style: 'display:flex;gap:8px;align-items:center;font-size:.92rem' }, [approveIn, 'Approve now']),
        el('button', { class: 'lb-btn lb-btn-primary', onClick: async () => {
          try {
            const r = await weeklyContentSet({ action: 'add', kind: kindSel.value, title: titleIn.value, url: urlIn.value, body: bodyIn.value, approve: approveIn.checked });
            if (r && r.ok === false) { toast(r.error || 'Could not add', 'error'); return; }
            toast('Added' + (approveIn.checked ? ' and approved' : ' as a draft'), 'success'); poolKind = kindSel.value; loadWeekly().then(loadPool);
            drawer.close();
          } catch (e) { toast(humanizeError(e), 'error'); }
        } }, 'Save'),
      ]),
    ]);
  }

  // ---------------------------------------------------------------- subscribers (0447)
  async function load() {
    showLoading(listBox, 'Loading…');
    try { overview = await newsletterOverview({ q, status, limit: 500 }); }
    catch (e) { showError(listBox, humanizeError(e), load); return; }
    const k = overview.kpis || {};
    mount(kpis, [
      statCard({ icon: 'users', label: 'Confirmed', value: num(k.confirmed), sub: num(k.confirmed_30d) + ' in the last 30 days', accent: 'green', onClick: () => { status = 'confirmed'; load(); } }),
      statCard({ icon: 'mail', label: 'Pending', value: num(k.pending), sub: num(k.awaiting_confirm_email) + ' never got a confirm email', accent: k.awaiting_confirm_email ? 'amber' : 'blue', onClick: () => { status = 'pending'; load(); } }),
      statCard({ icon: 'x', label: 'Unsubscribed', value: num(k.unsubscribed), sub: 'left through any route', accent: 'gray', onClick: () => { status = 'unsubscribed'; load(); } }),
      statCard({ icon: 'shield', label: 'Last newsletter', value: k.last_digest ? ago(k.last_digest) : 'never', sub: k.enabled ? 'weekly send is on' : 'weekly send is off', accent: k.enabled ? 'green' : 'amber' }),
    ]);
    const rows = overview.rows || [];
    if (!rows.length) { mount(listBox, el('div', { class: 'lb-card', style: 'padding:28px;text-align:center' }, [el('div', { style: 'font-weight:700;margin-bottom:6px' }, 'Nobody here'), sub('When someone uses the footer form, they show up here as Pending until they click the confirmation link.')])); return; }
    mount(listBox, [
      sub(num(overview.total) + ' addresses' + (rows.length < overview.total ? ' · showing ' + rows.length : ''), 'margin-bottom:8px'),
      table(['Address', 'Status', 'Came from', 'Asked', 'Confirm email', 'Confirmed', 'Digests', 'Gate says'], rows.map(r => ({ row: r, cells: [
        el('div', null, [el('div', { style: 'font-weight:600' }, r.email), sub(r.is_user ? 'signed-in user' : 'not a user')]),
        pill(STATUS_LABEL[r.status] || r.status, STATUS_TONE[r.status]),
        el('div', null, [r.source_page || '—', r.utm_source ? sub('utm ' + r.utm_source) : null]),
        el('div', null, [when(r.requested_at), r.requests > 1 ? sub(r.requests + ' requests') : null]),
        r.confirm_sent_at ? el('div', null, [when(r.confirm_sent_at), sub(r.confirm_sends + (r.confirm_sends === 1 ? ' send' : ' sends') + (r.status === 'pending' && r.token_expires_at ? ' · link ' + (new Date(r.token_expires_at) > new Date() ? 'valid until ' + fmtDateTime(r.token_expires_at) : 'expired') : ''))])
          : (r.status === 'pending' ? pill('Not sent yet', 'amber') : sub('—')),
        when(r.confirmed_at),
        el('div', null, [num(r.digests_sent), r.last_digest_at ? sub('last ' + ago(r.last_digest_at)) : null]),
        pill(String(r.gate || '—').replace(/_/g, ' '), GATE_TONE[r.gate] || 'gray'),
      ] })), (r) => personDrawer(r.email)),
    ]);
  }

  async function personDrawer(email) {
    const body = el('div');
    const drawer = openDrawer('Subscriber', body, { subtitle: email, size: 'lg' });
    showLoading(body, 'Loading…');
    let p;
    try { p = await newsletterPerson(email); } catch (e) { showError(body, humanizeError(e), () => personDrawer(email)); return; }
    const s = p.subscriber || {}; const g = p.gate || {}; const st = p.state || {};
    const row = (k, v) => el('tr', null, [el('td', { style: 'font-weight:600;white-space:nowrap' }, k), el('td', null, v == null || v === '' ? '—' : v)]);
    const sendBtn = (!manage || s.status !== 'pending') ? null : el('button', { class: 'lb-btn lb-btn-primary', onClick: async () => {
      const ok = await askConfirm('Send the confirmation email?', { body: 'One email goes to ' + email + ' asking them to confirm the newsletter. Nothing else is sent until they click it. The link works for 7 days.', confirmLabel: 'Send it' });
      if (!ok) return;
      try { const r = await newsletterSendConfirm(email); if (r && r.ok === false) { toast(r.error || 'Could not send', 'error'); return; } toast('Confirmation email queued', 'success'); personDrawer(email); load(); }
      catch (e) { toast(humanizeError(e), 'error'); }
    } }, s.confirm_sent_at ? 'Resend confirmation email' : 'Send confirmation email (approve)');
    mount(body, [
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px' }, [
        pill(STATUS_LABEL[s.status] || s.status || 'not a subscriber', STATUS_TONE[s.status]),
        g.code ? pill('Gate: ' + String(g.code).replace(/_/g, ' '), GATE_TONE[g.code] || 'gray') : null,
        st.all_off ? pill('Every optional email off', 'red') : null,
        st.hard_suppressed ? pill('Hard suppressed: ' + st.hard_reason, 'red') : null,
      ]),
      g.reason ? el('div', { class: 'lb-card', style: 'padding:12px 14px;margin-bottom:12px;font-size:.92rem;line-height:1.5;border-left:5px solid ' + (g.allowed ? '#15803d' : '#dc2626') }, g.reason) : null,
      sendBtn ? el('div', { style: 'margin-bottom:14px' }, [sendBtn, s.confirm_sent_at ? sub('Last confirmation email ' + fmtDateTime(s.confirm_sent_at) + ' · ' + s.confirm_sends + ' so far. A resend is allowed once an hour.', 'margin-top:6px') : sub('This address has never been emailed. Pressing the button is the approval.', 'margin-top:6px')]) : null,
      el('div', { style: 'font-weight:700;margin:8px 0 6px' }, 'Consent record'),
      el('div', { class: 'cc-table-wrap' }, el('table', { class: 'cc-table' }, el('tbody', null, [
        row('Asked', s.requested_at ? fmtDateTime(s.requested_at) + (s.requests > 1 ? ' (' + s.requests + ' requests)' : '') : null),
        row('From page', [s.source_page, s.referrer ? 'referrer ' + s.referrer : null, s.utm_source ? 'utm ' + [s.utm_source, s.utm_medium, s.utm_campaign].filter(Boolean).join(' / ') : null].filter(Boolean).join(' · ')),
        row('Consent text shown', s.consent_text),
        row('Request IP / agent', [s.ip, s.user_agent].filter(Boolean).join(' · ')),
        row('Confirmed', s.confirmed_at ? fmtDateTime(s.confirmed_at) + (s.confirm_ip ? ' from ' + s.confirm_ip : '') : null),
        row('Welcome email', s.welcome_sent_at ? fmtDateTime(s.welcome_sent_at) : null),
        row('Digests', s.digests_sent != null ? num(s.digests_sent) + (s.last_digest_at ? ' · last ' + fmtDateTime(s.last_digest_at) : '') : null),
        row('Unsubscribed', s.unsubscribed_at ? fmtDateTime(s.unsubscribed_at) : null),
      ]))),
      el('div', { style: 'font-weight:700;margin:16px 0 6px' }, 'Newsletter emails'),
      (p.emails || []).length ? table(['When', 'Email', 'Status', 'Note'], p.emails.map(e => ({ cells: [when(e.at), e.key, pill(e.status, e.status === 'sent' || e.status === 'delivered' || e.status === 'opened' || e.status === 'clicked' ? 'green' : e.status === 'failed' || e.status === 'bounced' ? 'red' : 'gray'), e.note || ''] }))) : sub('None yet.'),
      (p.blocked || []).length ? el('div', null, [el('div', { style: 'font-weight:700;margin:16px 0 6px' }, 'Refused sends'), table(['When', 'Email', 'Why'], p.blocked.map(b => ({ cells: [when(b.at), b.key, el('div', { style: 'max-width:520px;line-height:1.4' }, b.reason || b.code)] })))]) : null,
      (p.audit || []).length ? el('div', null, [el('div', { style: 'font-weight:700;margin:16px 0 6px' }, 'Timeline'), table(['When', 'What'], p.audit.map(a => ({ cells: [when(a.at), a.summary || a.action] })))]) : null,
      sub('Unsubscribes, resubscribes and "fewer emails" for this address are managed in Unsubscribes.', 'margin-top:14px'),
      el('div', { style: 'margin-top:6px' }, el('a', { href: '#/unsubscribes?email=' + encodeURIComponent(email), class: 'lb-btn lb-btn-sm' }, 'Open in Unsubscribes →')),
    ]);
    void drawer;
  }

  await loadWeekly();
  loadPool();
  await load();
  const pre = qs().get('email'); if (pre) personDrawer(pre);
}
