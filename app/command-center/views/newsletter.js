// Newsletter — the double opt-in list's Command Center screen (bl_comm_0447, 26 Sep 2026).
// Who asked (pending), who confirmed, who left; where each came from; which emails each one got or was refused.
// The weekly send is a switch here (off until the owner turns it on) and "Send confirm email" on a pending row is
// the approval step for addresses that predate double opt-in: nothing reaches them until someone presses it.
// Built on the unsubscribe engine: an unsubscribe by any route flips the row to "unsubscribed" and the gate refuses.
import { el, mount } from '../../shared/ui/dom.js';
import { sectionHead, statCard, searchBox, segmented, openDrawer, fmtDateTime, ago, askConfirm } from '../../shared/ui/components.js';
import { toast, humanizeError } from '../../shared/errors.js';
import { showLoading, showError } from '../../shared/loading.js';
import { can } from '../../shared/permissions.js';
import { newsletterOverview, newsletterPerson, newsletterSendConfirm, newsletterPreview, newsletterSet } from '../../shared/api.js';

const STATUS_TONE = { pending: 'amber', confirmed: 'green', unsubscribed: 'gray' };
const STATUS_LABEL = { pending: 'Pending', confirmed: 'Confirmed', unsubscribed: 'Unsubscribed' };
const GATE_TONE = { ok: 'green', essential: 'green', suppressed: 'red', unsubscribed_all: 'red', unsubscribed_group: 'amber', unsubscribed_marketing: 'amber', preference_opted_out: 'amber', frequency_cap: 'violet' };
const pill = (label, tone) => el('span', { class: 'cc-pill cc-pill-' + (tone || 'gray') }, String(label || '—'));
const num = (n) => Number(n || 0).toLocaleString();
const sub = (t, style) => el('div', { class: 'cc-sub', style: style || '' }, t);
const when = (ts) => ts ? el('span', { title: fmtDateTime(ts), style: 'white-space:nowrap' }, ago(ts)) : '—';
const qs = () => { try { return new URLSearchParams((location.hash.split('?')[1] || '')); } catch (_) { return new URLSearchParams(); } };

function table(cols, rows, onRow) {
  return el('div', { class: 'cc-table-wrap' }, el('table', { class: 'cc-table' }, [
    el('thead', null, el('tr', null, cols.map(c => el('th', null, c)))),
    el('tbody', null, rows.map(r => el('tr', { class: onRow ? 'clickable' : '', onClick: onRow ? () => onRow(r.row) : null }, r.cells.map(c => el('td', null, c))))),
  ]));
}

export async function renderNewsletter(host) {
  const manage = can('comm.manage') || can('settings.manage') || can('content.manage');
  let status = '', q = '', overview = null;

  const kpis = el('div', { class: 'cc-kpi-grid' });
  const toolbar = el('div', { class: 'cc-toolbar', style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin:6px 0 14px' });
  const listBox = el('div');
  const weeklyBtn = el('button', { class: 'lb-btn', onClick: () => toggleWeekly() }, 'Weekly send');

  const head = sectionHead(
    'Newsletter',
    'The footer form ("Get carrier tips & better loads") with double opt-in. A person asks, gets one confirmation email, and is on the list only after the click. Every Tuesday: this week’s rates, one dispatch tip, one compliance reminder — through the same gate as every other email, so an unsubscribe wins instantly.',
    [
      el('button', { class: 'lb-btn lb-btn-primary', onClick: () => previewDrawer() }, 'Preview this week’s email'),
      manage ? weeklyBtn : null,
      manage ? el('button', { class: 'lb-btn', onClick: () => sendNow() }, 'Send this week now') : null,
    ],
  );
  mount(host, el('div', { class: 'cc-view' }, [head, kpis, toolbar, listBox]));

  mount(toolbar, [
    segmented([{ value: '', label: 'Everyone' }, { value: 'pending', label: 'Pending' }, { value: 'confirmed', label: 'Confirmed' }, { value: 'unsubscribed', label: 'Unsubscribed' }],
      status, (v) => { status = v; load(); }),
    searchBox('Search address or source page…', (v) => { q = v; load(); }),
  ]);

  async function load() {
    showLoading(listBox, 'Loading…');
    try { overview = await newsletterOverview({ q, status, limit: 500 }); }
    catch (e) { showError(listBox, humanizeError(e), load); return; }
    const k = overview.kpis || {};
    weeklyBtn.textContent = 'Weekly send: ' + (k.enabled ? 'ON' : 'off');
    weeklyBtn.className = 'lb-btn' + (k.enabled ? ' lb-btn-primary' : '');
    mount(kpis, [
      statCard({ icon: 'users', label: 'Confirmed', value: num(k.confirmed), sub: num(k.confirmed_30d) + ' in the last 30 days', accent: 'green', onClick: () => { status = 'confirmed'; load(); } }),
      statCard({ icon: 'mail', label: 'Pending', value: num(k.pending), sub: num(k.awaiting_confirm_email) + ' never got a confirm email', accent: k.awaiting_confirm_email ? 'amber' : 'blue', onClick: () => { status = 'pending'; load(); } }),
      statCard({ icon: 'x', label: 'Unsubscribed', value: num(k.unsubscribed), sub: 'left through any route', accent: 'gray', onClick: () => { status = 'unsubscribed'; load(); } }),
      statCard({ icon: 'shield', label: 'Weekly send', value: k.enabled ? 'On' : 'Off', sub: (k.next_run ? 'cron ' + k.next_run + ' UTC' : 'no cron') + (k.last_digest ? ' · last ' + ago(k.last_digest) : ' · never sent'), accent: k.enabled ? 'green' : 'amber', onClick: manage ? () => toggleWeekly() : null }),
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
      sendBtn ? el('div', { style: 'margin-bottom:14px' }, [sendBtn, s.confirm_sent_at ? sub('Last confirmation email ' + fmtDateTime(s.confirm_sent_at) + ' · ' + s.confirm_sends + ' so far. A resend is allowed once an hour.', 'margin-top:6px') : sub('This address predates double opt-in (or the email never went out). Pressing this is the approval: one confirmation email, nothing else.', 'margin-top:6px')]) : null,
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
      (p.emails || []).length ? table(['When', 'Email', 'Status', 'Note'], p.emails.map(e => ({ cells: [when(e.at), e.key, pill(e.status, e.status === 'sent' || e.status === 'delivered' || e.status === 'opened' || e.status === 'clicked' ? 'green' : e.status === 'unsubscribed' ? 'amber' : e.status === 'failed' ? 'red' : 'gray'), el('div', { style: 'max-width:420px;line-height:1.4' }, e.reason || '')] }))) : sub('None yet.'),
      (p.blocked || []).length ? el('div', null, [el('div', { style: 'font-weight:700;margin:16px 0 6px' }, 'Refused sends'), table(['When', 'Email', 'Why'], p.blocked.map(b => ({ cells: [when(b.at), b.key, el('div', { style: 'max-width:520px;line-height:1.4' }, b.reason || '')] })))]) : null,
      (p.audit || []).length ? el('div', null, [el('div', { style: 'font-weight:700;margin:16px 0 6px' }, 'Timeline'), table(['When', 'What'], p.audit.map(a => ({ cells: [when(a.at), a.summary || a.action] })))]) : null,
      sub('Unsubscribes, resubscribes and "fewer emails" for this address are managed in Unsubscribes.', 'margin-top:14px'),
      el('div', { style: 'margin-top:6px' }, el('a', { href: '#/unsubscribes?email=' + encodeURIComponent(email), class: 'lb-btn lb-btn-sm' }, 'Open in Unsubscribes →')),
    ]);
    void drawer;
  }

  async function previewDrawer() {
    const body = el('div');
    openDrawer('This week’s newsletter', body, { subtitle: 'Exactly what a confirmed subscriber would get on Tuesday (the worker adds the header and footer). Nothing is sent from here.', size: 'lg' });
    showLoading(body, 'Building the preview…');
    let p;
    try { p = await newsletterPreview(); } catch (e) { showError(body, humanizeError(e), previewDrawer); return; }
    const frame = el('iframe', { style: 'width:100%;height:70vh;border:1px solid #e2e8f0;border-radius:12px;background:#fff', sandbox: '' });
    mount(body, [
      el('div', { style: 'font-weight:700;margin-bottom:4px' }, 'Subject: ' + (p.subject || '')),
      sub('Rates as of ' + (p.vars && p.vars.as_of || '—') + ' · tip and reminder rotate by week', 'margin-bottom:10px'),
      frame,
    ]);
    frame.srcdoc = '<!doctype html><meta charset="utf-8"><body style="margin:0;padding:24px;font-family:Segoe UI,Arial,sans-serif;color:#0f172a;font-size:15px;line-height:1.7">' + (p.html || '') + '</body>';
  }

  async function toggleWeekly() {
    const on = !!(overview && overview.kpis && overview.kpis.enabled);
    const ok = await askConfirm(on ? 'Switch the weekly newsletter off?' : 'Switch the weekly newsletter on?', {
      body: on ? 'The Tuesday cron will run but send nothing until it is switched on again.'
                  : 'Every Tuesday 14:00 UTC the cron emails every CONFIRMED subscriber this week’s rates + tip + reminder. Pending addresses never get it. Each send goes through the unsubscribe gate.',
      confirmLabel: on ? 'Switch off' : 'Switch on' });
    if (!ok) return;
    try { await newsletterSet({ enabled: !on }); toast(on ? 'Weekly send is off' : 'Weekly send is on', 'success'); load(); }
    catch (e) { toast(humanizeError(e), 'error'); }
  }

  async function sendNow() {
    const k = (overview && overview.kpis) || {};
    if (!k.enabled) { toast('Switch the weekly send on first', 'error'); return; }
    const ok = await askConfirm('Send this week’s newsletter now?', { body: 'Queues the digest for every confirmed subscriber who has not had one this week (' + num(k.confirmed) + ' confirmed). Unsubscribed and capped addresses are refused by the gate. This cannot be recalled.', confirmLabel: 'Send now', danger: true });
    if (!ok) return;
    try { const r = await newsletterSet({ run_now: true }); toast('Queued ' + num(r && r.run && r.run.queued) + ' emails', 'success'); load(); }
    catch (e) { toast(humanizeError(e), 'error'); }
  }

  await load();
  const pre = qs().get('email'); if (pre) personDrawer(pre);
}
