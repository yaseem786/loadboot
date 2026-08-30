// lb-cdn-bump 2026-08-15: force fresh Netlify blob upload (corrupt-deploy recovery) — no code changes.
// outreach.js — Outreach CRM: the automated email acquisition engine dashboard.
//
// Rebuilt 2026-08-29 after a deep audit of the live engine. What the audit found, and what
// this screen now does about it:
//
//   * The list was not moving. 140,667 contacts were imported and only 2,830 had ever been
//     emailed; on 29 Aug every one of the day's 600 sends went to an existing drip and not a
//     single new contact was started. The screen never showed that, because it only counted
//     emails sent — never how much of the list had been reached. There is now a "Cold list"
//     card with the untouched count, the real intake rate, and the runway in days.
//   * Opens always read 0 (13,000 sends, no open tracking). Opens are now first-party, and
//     the screen says plainly when a number is not being measured rather than printing 0.
//   * The delivery log could only ever show one truncated page of a 13,000-row table, with
//     no date window and no search. It is now paged, searchable, filterable by audience,
//     and every table long enough to scroll is collapsed to its first rows.
//   * Nothing compared broker to carrier. There is now a side-by-side card.
//   * The page was a snapshot; a run at 13/15/17/19 UTC changed nothing on screen. It now
//     refreshes itself while you watch it and shows how old the numbers are.
//
// Backend: cc_outreach_crm / _control / _stats / _today / _templates / _log_page / _audience.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, statCard, fmtDateTime, ago, openDrawer, segmented } from '../../shared/ui/components.js';
import { ccOutreachCrm, ccOutreachControl, ccOutreachStats, ccOutreachToday, ccOutreachTemplates,
         ccOutreachTemplatePreview, ccOutreachTemplateSave, ccOutreachLogPage, ccOutreachAudience } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';

const TPL_LABEL = (k) => {
  // template_key = outreach.<audience>-d<N>
  const m = /^outreach\.(\w+)[.-]d(\d+)$/.exec(k || '');
  return m ? (m[1].charAt(0).toUpperCase() + m[1].slice(1) + ' — Day ' + m[2]) : (k || '—');
};
const ST_TONE = { sent: 'blue', delivered: 'green', queued: 'blue', failed: 'red', bounced: 'red', complained: 'red', dead_letter: 'red', skipped: 'gray', unsubscribed: 'amber' };
const N = (v) => Number(v || 0).toLocaleString();
const PCT = (a, b) => (b > 0 ? (Math.round((a / b) * 1000) / 10) + '%' : '—');

// Time windows. "All time" is p_days = 0, which the RPCs read as "no window".
const RANGES = [
  { value: 7, label: '7 days' }, { value: 30, label: '30 days' },
  { value: 90, label: '90 days' }, { value: 0, label: 'All time' },
];
const LOG_FILTERS = [
  { value: 'sent', label: '\u2705 Sent' }, { value: 'opened', label: '\ud83d\udc41 Opened' },
  { value: 'clicked', label: '\ud83d\uddb1 Clicked' }, { value: 'failed', label: '\u26a0\ufe0f Failed' },
  { value: 'removed', label: '\ud83d\udeab Removed' }, { value: 'all', label: 'All' },
];
const PAGE_SIZES = [25, 50, 100];
const REFRESH_MS = 20000;

export function renderOutreach(host) {
  // One place for every piece of screen state, so a refresh never loses the page you are on.
  const S = {
    days: 30,
    live: true,
    fetchedAt: null,
    log: { filter: 'sent', kind: '', q: '', limit: 25, offset: 0, total: 0 },
    open: { daily: false, tpl: false, camps: false, convs: false, tpls: false, batch: false },
  };
  let LOG = null;   // { tblHost, count } — the delivery-log card, built once.

  const bar      = el('div', { class: 'cc-toolbar lbo-bar' });
  const kpis     = el('div', { class: 'cc-kpi-grid lbo-kpis' });
  const reachHost= el('div', { style: 'margin-top:4px' });
  const todayHost= el('div', { style: 'margin-top:16px' });
  const cmpHost  = el('div', { style: 'margin-top:16px' });
  const grid     = el('div', { class: 'fa-grid', style: 'margin-top:16px' });
  const tplHost  = el('div', { style: 'margin-top:16px' });
  const logHost  = el('div', { style: 'margin-top:16px' });

  mount(host, el('div', null, [
    sectionHead('Email outreach',
      'The automated acquisition engine. FMCSA carriers, brokers and shippers get a 7-part value drip from the verified mail.loadboot.com subdomain (replies land at hello@). Sends spread across four daily runs; bounces auto-block; a reply or a signup stops that contact’s drip; the kill-switch pauses everything on high failure.'),
    bar, kpis, reachHost, todayHost, cmpHost, grid, tplHost, logHost,
  ]));

  buildBar();
  refreshAll();

  // ---- live refresh -------------------------------------------------------
  // There is no realtime publication for these tables, so honest "live" here means a poll
  // that stops when nobody is looking. The clock keeps ticking so a stale number always
  // looks stale rather than looking current.
  const timer = setInterval(() => {
    if (!host.isConnected) { clearInterval(timer); clearInterval(clockTimer); return; }
    if (!S.live || document.visibilityState === 'hidden') { return; }
    refreshAll(true);
  }, REFRESH_MS);
  const clockTimer = setInterval(() => {
    if (!host.isConnected) { clearInterval(timer); clearInterval(clockTimer); return; }
    const n = bar.querySelector('.lbo-stamp'); if (n && S.fetchedAt) n.textContent = 'updated ' + ago(S.fetchedAt);
  }, 5000);

  async function refreshAll(quiet) {
    // Engine controls read their values out of cc_outreach_today, so that one resolves first.
    await loadToday();
    load(quiet); loadCompare(); loadTemplates(); loadLog();
  }

  function buildBar() {
    const stamp = el('span', { class: 'cc-sub lbo-stamp' }, S.fetchedAt ? 'updated ' + ago(S.fetchedAt) : 'loading…');
    const liveBtn = el('button', { class: 'lb-btn lb-btn-ghost lb-btn-sm', onclick: (e) => {
      S.live = !S.live;
      e.currentTarget.classList.toggle('lbo-live-on', S.live);
      e.currentTarget.textContent = S.live ? '● Live' : '⏸ Paused';
      if (S.live) refreshAll(true);
    } }, S.live ? '● Live' : '⏸ Paused');
    if (S.live) liveBtn.classList.add('lbo-live-on');
    mount(bar, [
      el('span', { class: 'cc-sub', style: 'font-weight:700' }, 'Window'),
      segmented(RANGES, S.days, (v) => { S.days = v; S.log.offset = 0; refreshAll(); }),
      el('span', { style: 'flex:1' }),
      stamp,
      liveBtn,
      el('button', { class: 'lb-btn lb-btn-ghost lb-btn-sm', onclick: () => refreshAll() }, '↻ Refresh'),
    ]);
  }

  async function control(action, value) {
    try {
      const r = await ccOutreachControl(action, value);
      if (r && r.error) throw new Error(r.error);
      toast('Outreach: ' + action + (value != null ? ' → ' + value : '') + ' ✓');
      refreshAll();
    } catch (e) { toast(humanizeError(e), 'error'); }
  }

  // ------------------------------------------------------------------ main
  async function load(quiet) {
    if (!quiet) showLoading(grid, 'Loading outreach engine…');
    let crm, stats;
    try { [crm, stats] = await Promise.all([ccOutreachCrm(S.days || 3650), ccOutreachStats(S.days || 3650).catch(() => null)]); }
    catch (e) { showError(grid, humanizeError(e), () => load()); return; }
    if (crm && crm.error) { showError(grid, crm.error, () => load()); return; }
    S.fetchedAt = new Date().toISOString();
    const n = bar.querySelector('.lbo-stamp'); if (n) n.textContent = 'updated ' + ago(S.fetchedAt);

    const st = (crm && crm.state) || {};
    const contacts = (crm && crm.contacts) || {};
    const sends = (crm && crm.sends) || [];

    const kinds = {};
    let totalActive = 0, totalUnsub = 0, totalBounced = 0, totalDone = 0, totalAll = 0;
    Object.entries(contacts).forEach(([k, cnt]) => {
      const [kind, status] = k.split(':');
      kinds[kind] = kinds[kind] || { active: 0, unsubscribed: 0, bounced: 0, completed: 0, suppressed: 0, total: 0 };
      kinds[kind][status] = (kinds[kind][status] || 0) + cnt; kinds[kind].total += cnt; totalAll += cnt;
      if (status === 'active') totalActive += cnt;
      if (status === 'unsubscribed') totalUnsub += cnt;
      if (status === 'bounced') totalBounced += cnt;
      if (status === 'completed') totalDone += cnt;
    });

    // "Sent" must mean everything that went out the door. Resend's delivery webhook moves
    // rows from 'sent' to 'delivered', so counting only status='sent' silently shrinks the
    // number as confirmations arrive — which is why the panel used to under-report sends.
    const sentN = sends.filter(s => s.status === 'sent' || s.status === 'delivered').reduce((a, s) => a + s.n, 0);
    const failN = sends.filter(s => s.status === 'failed' || s.status === 'bounced' || s.status === 'dead_letter' || s.status === 'complained').reduce((a, s) => a + s.n, 0);
    const daily = (crm && crm.daily) || [];
    const on = !!st.enabled;

    const camps = (stats && (stats.campaigns || stats.rows)) || (Array.isArray(stats) ? stats : []);
    const tot = (stats && stats.totals) || {};
    const opens = (stats && stats.opens) || {};
    const convs = (stats && stats.conversions) || [];
    S.stats = stats;

    mount(kpis, [
      statCard({ icon: on ? 'check' : 'alert', label: 'Engine', value: on ? 'RUNNING' : 'PAUSED',
        sub: on ? ('cap ' + N(st.base_cap) + '/day → max ' + N(st.max_cap)) : 'sends disabled', accent: on ? 'green' : 'amber' }),
      statCard({ icon: 'users', label: 'Contacts', value: N(totalActive),
        sub: N(totalAll) + ' total · ' + N(totalDone) + ' completed drip', accent: 'blue' }),
      statCard({ icon: 'bell', label: 'Emails sent (' + windowLabel() + ')', value: N(sentN),
        sub: N(st.sent_today) + ' today · last run ' + (st.last_run ? fmtDateTime(st.last_run) : 'never'), accent: 'violet' }),
      statCard({ icon: 'alert', label: 'List health', value: N(totalBounced) + ' bounced',
        sub: N(totalUnsub) + ' unsubscribed · ' + N(failN) + ' failed sends',
        accent: (sentN > 50 && failN / Math.max(1, sentN + failN) > 0.05) ? 'red' : 'green' }),
      statCard({ icon: 'check', label: 'Results', value: N(tot.converted) + ' signup' + ((tot.converted || 0) === 1 ? '' : 's'),
        sub: N(tot.replied) + ' replies · ' + N(tot.clicked_contacts) + ' contacts clicked'
             + ((opens.opened || 0) ? ' · ' + N(opens.opened) + ' opens' : ''),
        accent: (tot.converted || 0) > 0 ? 'green' : 'blue' }),
    ]);

    const byTpl = {};
    sends.forEach(s => { byTpl[s.tpl] = byTpl[s.tpl] || {}; byTpl[s.tpl][s.status] = s.n; });
    const tplRows = Object.keys(byTpl).sort();

    mount(grid, [
      el('div', { class: 'lb-card fa-col2' }, [
        collapsible({
          key: 'daily', title: 'Exact sends by day', note: N(sentN) + ' sent · ' + N(failN) + ' failed/bounced',
          headers: ['Day', 'Went out', 'Delivery confirmed', 'Bounced', 'Failed'],
          rows: daily,
          empty: 'No sends in this window.',
          row: (dd) => el('tr', { class: 'cc-row' }, [
            el('td', null, el('b', null, dd.day)),
            el('td', null, el('span', { class: 'cc-pill cc-pill-blue' }, N(dd.total))),
            el('td', null, N(dd.delivered)),
            el('td', null, (dd.bounced || 0) > 0 ? el('span', { class: 'cc-pill cc-pill-red' }, N(dd.bounced)) : '0'),
            el('td', null, (dd.failed || 0) > 0 ? el('span', { class: 'cc-pill cc-pill-red' }, N(dd.failed)) : '0'),
          ]),
        }),
        el('div', { style: 'margin-top:18px' }, collapsible({
          key: 'tpl', title: 'Send results by email', note: tplRows.length + ' template' + (tplRows.length === 1 ? '' : 's'),
          headers: ['Email', 'Sent', 'Confirmed', 'Queued', 'Failed'],
          rows: tplRows,
          empty: 'No sends yet — the first batch goes out at the next run.',
          row: (t) => el('tr', { class: 'cc-row' }, [
            el('td', null, el('b', null, TPL_LABEL(t))),
            el('td', null, el('span', { class: 'cc-pill cc-pill-green' }, N((byTpl[t].sent || 0) + (byTpl[t].delivered || 0)))),
            el('td', null, N(byTpl[t].delivered)),
            el('td', null, N(byTpl[t].queued)),
            el('td', null, (byTpl[t].failed || byTpl[t].bounced || byTpl[t].dead_letter)
              ? el('span', { class: 'cc-pill cc-pill-red' }, N((byTpl[t].failed || 0) + (byTpl[t].bounced || 0) + (byTpl[t].dead_letter || 0))) : '0'),
          ]),
        })),
        camps.length ? el('div', { style: 'margin-top:18px' }, collapsible({
          key: 'camps', title: 'Clicks → signups (UTM campaigns)', note: camps.length + ' campaign' + (camps.length === 1 ? '' : 's'),
          headers: ['Campaign', 'Sessions', 'Pageviews', 'Signups'],
          rows: camps, empty: '—',
          row: (c) => el('tr', { class: 'cc-row' }, [
            el('td', null, el('b', null, c.campaign || c.utm_campaign || '—')),
            el('td', null, N(c.sessions || c.clicks)),
            el('td', null, N(c.pageviews)),
            el('td', null, el('span', { class: 'cc-pill cc-pill-' + ((c.signups || c.converted || 0) > 0 ? 'green' : 'gray') }, N(c.signups || c.converted))),
          ]),
        })) : null,
        convs.length ? el('div', { style: 'margin-top:18px' }, collapsible({
          key: 'convs', title: '🎯 Outreach signups — cold email → account', note: convs.length + ' total',
          headers: ['Company', 'Audience', 'Emails got', 'Signed up'],
          rows: convs, empty: '—',
          row: (cv) => el('tr', { class: 'cc-row' }, [
            el('td', null, el('b', null, cv.company || '—')),
            el('td', { style: 'text-transform:capitalize' }, cv.kind || '—'),
            el('td', null, N(cv.emails_got)),
            el('td', null, cv.signed_up ? fmtDateTime(cv.signed_up) : '—'),
          ]),
        })) : null,
      ]),
      el('div', null, [
        el('div', { class: 'lb-card' }, [
          el('div', { class: 'fa-cardhead' }, [el('h3', null, 'Engine controls')]),
          el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px' }, [
            el('button', { class: 'lb-btn ' + (on ? 'lb-btn-ghost' : 'lb-btn-primary'), onclick: () => control(on ? 'disable' : 'enable') }, on ? '⏸ Pause engine' : '▶ Enable engine'),
            el('button', { class: 'lb-btn lb-btn-ghost', onclick: () => { if (confirm('Run a send batch right now (up to today’s remaining cap)?')) control('run_now'); } }, '⚡ Run now'),
          ]),
          capRow('Ramp base (per day)', st.base_cap, v => control('base_cap', v)),
          capRow('Hard max/day', st.max_cap, v => control('max_cap', v)),
          capRow('Real daily ceiling', S.today && S.today.daily_cap, v => control('daily_cap', v)),
          capRow('Batch per run', S.today && S.today.batch_per_run, v => control('batch_per_run', v)),
          capRow('New-contact share %', S.today && S.today.intake_pct, v => control('new_intake_pct', v), 0, 100),
          el('p', { class: 'cc-sub', style: 'margin-top:10px' },
            'Volume is governed by the LOWER of the ramp (base doubles weekly from ' + (st.started_on || '—') + ' up to the hard max) and the real daily ceiling. '
            + 'Sends leave the verified mail.loadboot.com subdomain across four runs (13/15/17/19 UTC). '
            + '“New-contact share” is what stops the follow-up drip eating the whole cap: that percentage of every run is reserved for people who have never been emailed.'),
        ]),
        el('div', { class: 'lb-card', style: 'margin-top:16px' }, [
          el('div', { class: 'fa-cardhead' }, [el('h3', null, 'Contacts by audience')]),
          el('table', { class: 'cc-table' }, [
            el('thead', null, el('tr', null, ['Audience', 'Active', 'Done', 'Unsub', 'Bounced'].map(h => el('th', null, h)))),
            el('tbody', null, Object.keys(kinds).sort().map(k => el('tr', { class: 'cc-row' }, [
              el('td', null, el('b', { style: 'text-transform:capitalize' }, k)),
              el('td', null, N(kinds[k].active)),
              el('td', null, N(kinds[k].completed)),
              el('td', null, N(kinds[k].unsubscribed)),
              el('td', null, N(kinds[k].bounced)),
            ]))),
          ]),
          el('p', { class: 'cc-sub', style: 'margin-top:10px' },
            'Each contact gets the 7-email drip for its own audience (carrier ≠ broker), one email every 3+ days. A reply or a signup stops that contact’s drip automatically, and anyone who already has an account is never emailed. Bounces auto-block; unsubscribe is one click. Kill-switch: >10% failures over 2 days auto-pauses the engine and alerts staff.'),
        ]),
      ]),
    ]);
  }

  function windowLabel() { return S.days ? S.days + 'd' : 'all time'; }

  // -------------------------------------------------- cold-list reach + runway
  async function loadCompare() {
    let a; try { a = await ccOutreachAudience(S.days || 3650); } catch (e) { return; }
    if (!a || a.error || !a.audiences) return;
    const rows = a.audiences;
    S.audience = rows;

    const totalContacts = rows.reduce((s, r) => s + (r.contacts || 0), 0);
    const untouched     = rows.reduce((s, r) => s + (r.never_touched || 0), 0);
    const touched       = totalContacts - untouched;
    const perDay        = rows.reduce((s, r) => s + Number(r.intake_per_day || 0), 0);
    const runway        = perDay > 0 ? Math.ceil(untouched / perDay) : null;

    // The single most important number on this screen, and the one that was missing: not
    // how many emails went out, but how much of the list has actually been reached.
    mount(reachHost, el('div', { class: 'lb-card lbo-reach' }, [
      el('div', { class: 'fa-cardhead' }, [
        el('h3', null, 'Cold list — how far through it are we?'),
        el('span', null, N(touched) + ' of ' + N(totalContacts) + ' contacts ever emailed'),
      ]),
      el('div', { class: 'lbo-reachbar' }, el('span', { style: 'width:' + Math.max(0.4, totalContacts ? (touched / totalContacts) * 100 : 0) + '%' })),
      el('div', { class: 'lbo-reachnums' }, [
        reachNum(PCT(touched, totalContacts), 'of the list reached'),
        reachNum(N(untouched), 'never emailed once'),
        reachNum(perDay ? perDay.toFixed(1) + '/day' : '0/day', 'new contacts started (' + windowLabel() + ')'),
        reachNum(runway === null ? 'never' : (runway > 3650 ? '10+ yrs' : N(runway) + ' days'),
                 runway === null ? 'at this rate the list never finishes' : 'to finish the list at this rate',
                 runway === null || runway > 730 ? 'bad' : (runway > 180 ? 'warn' : 'good')),
      ]),
      runway === null ? el('p', { class: 'cc-sub lbo-warn' },
        'No new contact has been started in this window. Every send is going to somebody already in the drip — raise “New-contact share %” in Engine controls, or raise the daily ceiling.') : null,
    ]));

    // Broker vs carrier, side by side.
    mount(cmpHost, el('div', { class: 'lb-card' }, [
      el('div', { class: 'fa-cardhead' }, [el('h3', null, 'Broker vs carrier'), el('span', null, 'window: ' + windowLabel())]),
      el('div', { class: 'lbo-cmp' }, rows.map(r => audienceColumn(r))),
    ]));
  }

  function reachNum(value, label, tone) {
    return el('div', { class: 'lbo-rn' + (tone ? ' lbo-rn-' + tone : '') }, [
      el('div', { class: 'lbo-rn-v' }, value), el('div', { class: 'lbo-rn-l' }, label),
    ]);
  }

  function audienceColumn(r) {
    const steps = r.steps || [];
    const maxStep = steps.reduce((m, s) => Math.max(m, s.n || 0), 0) || 1;
    const clickPct = PCT(r.contacts_clicked, r.contacts - r.never_touched);
    return el('div', { class: 'lbo-cmp-col' }, [
      el('div', { class: 'lbo-cmp-h' }, [
        el('b', { style: 'text-transform:capitalize' }, r.kind),
        el('span', { class: 'cc-pill cc-pill-' + ((r.converted || 0) > 0 ? 'green' : 'gray') }, N(r.converted) + ' signup' + ((r.converted || 0) === 1 ? '' : 's')),
      ]),
      el('div', { class: 'lbo-cmp-rows' }, [
        cmpRow('List size', N(r.contacts)),
        cmpRow('Never emailed', N(r.never_touched), (r.never_touched || 0) > 0 ? 'warn' : null),
        cmpRow('Mid-drip', N(r.in_drip)),
        cmpRow('Finished all 7', N(r.finished_drip)),
        cmpRow('Sent (' + windowLabel() + ')', N(r.sent)),
        cmpRow('Delivered', N(r.delivered)),
        cmpRow('Failed / bounced', N(r.bad), (r.bad || 0) > 0 ? 'warn' : null),
        // Opens are only meaningful once the pixel has been live for a while; say so
        // instead of printing a 0 that reads as "nobody opened it".
        cmpRow('Opened', (r.opens || 0) > 0 ? N(r.opens) : 'not measured yet'),
        cmpRow('Contacts who clicked', N(r.contacts_clicked) + ' (' + clickPct + ')'),
        cmpRow('Replies captured', N(r.replied), (r.replied || 0) === 0 ? 'warn' : null),
        cmpRow('New started (' + windowLabel() + ')', N(r.new_started), (r.new_started || 0) === 0 ? 'bad' : null),
        cmpRow('Runway', r.runway_days == null ? 'never at this rate' : N(r.runway_days) + ' days', r.runway_days == null ? 'bad' : null),
      ]),
      steps.length ? el('div', { class: 'lbo-steps' }, [
        el('div', { class: 'cc-sub', style: 'margin-bottom:6px' }, 'Where the drip stands (contacts by emails received)'),
        el('div', { class: 'lbo-stepbars' }, steps.map(s => el('div', { class: 'lbo-step', title: 'Day ' + s.step + ': ' + N(s.n) + ' contacts, ' + N(s.clicked) + ' clicked' }, [
          el('span', { class: 'lbo-step-bar', style: 'height:' + Math.max(4, Math.round((s.n / maxStep) * 46)) + 'px' }),
          el('span', { class: 'lbo-step-l' }, 'd' + s.step),
        ]))),
      ]) : null,
    ]);
  }

  function cmpRow(k, v, tone) {
    return el('div', { class: 'lbo-cmp-r' + (tone ? ' lbo-t-' + tone : '') }, [el('span', null, k), el('b', null, v)]);
  }

  // ------------------------------------------------------------- next run
  async function loadToday() {
    let t; try { t = await ccOutreachToday(); } catch (e) { mount(todayHost, ''); return; }
    if (!t || t.error) { mount(todayHost, ''); return; }
    S.today = t;
    const batch = t.batch || [];
    const sample = t.sample || [];
    const newShare = t.due_new != null ? (N(t.due_new) + ' never emailed · ' + N(t.due_followup) + ' mid-drip') : null;
    mount(todayHost, el('div', { class: 'lb-card' }, [
      el('div', { class: 'fa-cardhead' }, [
        el('h3', null, 'Next run — what goes out today'),
        el('span', null, (t.enabled ? 'cap left today: ' + N(t.cap_remaining) : 'ENGINE PAUSED — nothing will send')
          + ' · ' + N(t.total_due) + ' contacts due' + (newShare ? ' (' + newShare + ')' : '')),
      ]),
      t.intake_pct != null ? el('p', { class: 'cc-sub', style: 'margin:-4px 0 10px' },
        'Reserved for new contacts: ' + t.intake_pct + '% of each run · daily ceiling ' + N(t.daily_cap) + ' · batch ' + N(t.batch_per_run)) : null,
      batch.length ? collapsible({
        key: 'batch', title: null,
        headers: ['Audience', 'Email', 'Subject', 'Recipients'],
        rows: batch, empty: '—', initial: 8,
        row: (b) => el('tr', { class: 'cc-row' }, [
          el('td', null, el('b', { style: 'text-transform:capitalize' }, b.audience)),
          el('td', null, 'Day ' + b.day),
          el('td', null, b.subject || '—'),
          el('td', null, el('span', { class: 'cc-pill cc-pill-blue' }, N(b.n))),
        ]),
      }) : el('div', { class: 'lb-state' }, t.enabled ? 'Cap used up for today — next batch at the following run.' : 'Enable the engine to start sending.'),
      sample.length ? el('p', { class: 'cc-sub', style: 'margin-top:10px' },
        'First in line: ' + sample.map(x => (x.company || x.email) + ' (' + x.audience + ' d' + x.day + ')').slice(0, 6).join(' · ')) : null,
    ]));
  }

  // ------------------------------------------------------------ templates
  async function loadTemplates() {
    let list; try { list = await ccOutreachTemplates(); } catch (e) { mount(tplHost, ''); return; }
    if (!list || list.error) { mount(tplHost, ''); return; }
    mount(tplHost, el('div', { class: 'lb-card' }, [
      el('div', { class: 'fa-cardhead' }, [el('h3', null, 'Email templates (' + list.length + ')'),
        el('button', { class: 'lb-btn lb-btn-primary', onclick: () => openEditor(null) }, '+ New / upload template')]),
      collapsible({
        key: 'tpls', title: null, initial: 8,
        headers: ['Audience', 'Day', 'Subject', 'Body', 'Status', '', ''],
        rows: list, empty: 'No templates.',
        row: (t) => el('tr', { class: 'cc-row' }, [
          el('td', null, el('b', { style: 'text-transform:capitalize' }, t.audience)),
          el('td', null, 'Day ' + t.day),
          el('td', null, t.subject),
          el('td', null, el('span', { class: 'cc-pill cc-pill-' + (t.has_parts ? 'blue' : 'violet') }, t.has_parts ? 'designed' : 'custom HTML')),
          el('td', null, el('span', { class: 'cc-pill cc-pill-' + (t.active ? 'green' : 'gray') }, t.active ? 'active' : 'off')),
          el('td', null, el('button', { class: 'lb-btn lb-btn-ghost lb-btn-sm', onclick: () => openPreview(t.id) }, '👁 Preview')),
          el('td', null, el('button', { class: 'lb-btn lb-btn-ghost lb-btn-sm', onclick: () => openEditor(t) }, '✏️ Edit')),
        ]),
      }),
      el('p', { class: 'cc-sub', style: 'margin-top:10px' },
        '“Designed” = built from LoadBoot premium blocks. Editing a designed template with your own HTML replaces its body. Placeholders: {NAME} company · {STATE} state · {DOT} DOT number · {TRUCKS} fleet size · {RATE_VAN}/{RATE_REEFER}/{RATE_FLATBED} live rates · {OC} contact id for click attribution (keep it in every link) · {UNSUB} unsubscribe link (required by law — always keep it). The open pixel is added automatically; you do not put it in the template.'),
    ]));
  }

  async function openPreview(id) {
    const { body } = openDrawer('Email preview', el('div', { class: 'lb-state lb-loading' }, 'Rendering…'), { subtitle: 'Exactly what the recipient sees' });
    let t; try { t = await ccOutreachTemplatePreview(id); } catch (e) { mount(body, el('div', { class: 'lb-state lb-error' }, humanizeError(e))); return; }
    if (!t || t.error) { mount(body, el('div', { class: 'lb-state lb-error' }, (t && t.error) || 'Not found')); return; }
    const fr = el('iframe', { style: 'width:100%;height:70vh;border:1px solid var(--lb-line,#e2e8f0);border-radius:12px;background:#fff', sandbox: '' });
    mount(body, el('div', null, [
      el('p', { class: 'cc-sub' }, [el('b', { style: 'text-transform:capitalize' }, t.audience + ' — Day ' + t.day + ': '), t.subject]),
      fr,
    ]));
    fr.setAttribute('srcdoc', (t.html || '')
      .replace(/\{NAME\}/g, 'Acme Trucking LLC').replace(/\{STATE\}/g, 'Texas')
      .replace(/\{DOT\}/g, '1234567').replace(/\{TRUCKS\}/g, '4')
      .replace(/\{OC\}/g, 'preview').replace(/\{UNSUB\}/g, '#'));
  }

  async function openEditor(t) {
    let existingHtml = '';
    if (t) { try { const pv = await ccOutreachTemplatePreview(t.id); existingHtml = (pv && pv.html) || ''; } catch (e) { /* empty */ } }
    const selAud = el('select', { class: 'cc-input' }, ['carrier', 'broker', 'shipper'].map(a => el('option', { value: a, selected: t && t.audience === a ? 'selected' : null }, a)));
    const selDay = el('select', { class: 'cc-input' }, [1, 2, 3, 4, 5, 6, 7].map(d => el('option', { value: String(d), selected: t && t.day === d ? 'selected' : null }, 'Day ' + d)));
    const subj = el('input', { class: 'cc-input', placeholder: 'Email subject', value: t ? t.subject : '' });
    const ta = el('textarea', { class: 'cc-input', placeholder: 'Paste full email HTML here… (leave unchanged to keep the current design and only update subject/status)', style: 'min-height:320px;font-family:monospace;font-size:12px' });
    ta.value = existingHtml;
    const activeCb = el('input', { type: 'checkbox' }); activeCb.checked = t ? !!t.active : true;
    const err = el('div', { class: 'err' });
    const save = el('button', { class: 'lb-btn lb-btn-primary', onclick: async (ev) => {
      err.textContent = '';
      const html = ta.value.trim();
      if (!subj.value.trim()) { err.textContent = 'Subject required.'; return; }
      if (html && html.indexOf('{UNSUB}') === -1) { err.textContent = 'HTML must contain the {UNSUB} unsubscribe placeholder (legal requirement).'; return; }
      if (html && html.indexOf('{OC}') === -1) { err.textContent = 'HTML has no {OC} placeholder — without it no click from this email can be attributed. Add &oc={OC} to every link.'; return; }
      const b = ev.currentTarget; b.disabled = true; b.textContent = 'Saving…';
      try {
        const r = await ccOutreachTemplateSave({ audience: selAud.value, day: parseInt(selDay.value, 10), subject: subj.value.trim(),
          html: (html && html !== existingHtml.trim()) ? html : null, active: activeCb.checked });
        if (r && r.error) throw new Error(r.error);
        toast('Template saved ✓'); drawer.close(); loadTemplates(); loadToday();
      } catch (e) { err.textContent = humanizeError(e); b.disabled = false; b.textContent = 'Save template'; }
    } }, 'Save template');
    const drawer = openDrawer(t ? 'Edit template' : 'New template', el('div', { class: 'cc-form' }, [
      el('div', { class: 'cc-form-2' }, [selAud, selDay]),
      subj,
      ta,
      el('label', { style: 'display:flex;align-items:center;gap:8px' }, [activeCb, el('span', { class: 'cc-sub' }, 'Active (will be sent on its day)')]),
      el('p', { class: 'cc-sub' }, 'Placeholders: {NAME} {STATE} {DOT} {TRUCKS} {RATE_VAN} {RATE_REEFER} {RATE_FLATBED} · {OC} must be on every link · {UNSUB} must stay.'),
      err, save,
    ]), { subtitle: (t ? 'Overwrites ' : 'Creates ') + 'the email for that audience + day' });
  }

  // --------------------------------------------------------- delivery log
  // The card is built once and only the table body is refetched. Rebuilding the whole card
  // on every keystroke (or on every 20-second auto-refresh) would yank focus out of the
  // search box mid-word and reset the page you were on.

  function buildLogShell() {
    const L = S.log;
    const tblHost = el('div', { style: 'margin-top:10px' }, el('div', { class: 'lb-state lb-loading' }, 'Loading\u2026'));
    const count = el('span', null, 'loading\u2026');

    const search = el('input', { class: 'cc-input lbo-search', type: 'search', placeholder: 'Search email or company\u2026', value: L.q });
    let tmr = null;
    search.addEventListener('input', () => {
      clearTimeout(tmr);
      tmr = setTimeout(() => { L.q = search.value.trim(); L.offset = 0; loadLog(); }, 350);
    });

    const kindSel = el('select', null, [
      { v: '', l: 'All audiences' }, { v: 'carrier', l: 'Carriers' }, { v: 'broker', l: 'Brokers' }, { v: 'shipper', l: 'Shippers' },
    ].map(o => el('option', { value: o.v, selected: L.kind === o.v ? 'selected' : null }, o.l)));
    kindSel.addEventListener('change', () => { L.kind = kindSel.value; L.offset = 0; loadLog(); });

    const sizeSel = el('select', null, PAGE_SIZES.map(n => el('option', { value: String(n), selected: L.limit === n ? 'selected' : null }, n + ' / page')));
    sizeSel.addEventListener('change', () => { L.limit = parseInt(sizeSel.value, 10); L.offset = 0; loadLog(); });

    mount(logHost, el('div', { class: 'lb-card' }, [
      el('div', { class: 'fa-cardhead' }, [el('h3', null, 'Delivery log \u2014 every email, one by one'), count]),
      el('div', { class: 'cc-toolbar', style: 'margin-bottom:0' }, [
        segmented(LOG_FILTERS, L.filter, (v) => { L.filter = v; L.offset = 0; loadLog(); }),
        kindSel, search, el('span', { style: 'flex:1' }), sizeSel,
      ]),
      tblHost,
    ]));
    LOG = { tblHost, count };
  }

  async function loadLog() {
    if (!LOG || !logHost.firstChild) buildLogShell();
    const L = S.log;

    let res;
    try { res = await ccOutreachLogPage({ filter: L.filter, kind: L.kind || null, days: S.days, q: L.q || null, limit: L.limit, offset: L.offset }); }
    catch (e) { mount(LOG.tblHost, el('div', { class: 'lb-state lb-error' }, humanizeError(e))); return; }
    if (!res || res.error) { mount(LOG.tblHost, el('div', { class: 'lb-state lb-error' }, (res && res.error) || 'Failed')); return; }

    const rows = res.rows || [];
    L.total = res.total || 0;
    const from = L.total ? L.offset + 1 : 0, to = Math.min(L.offset + L.limit, L.total);
    LOG.count.textContent = L.total ? (N(from) + '\u2013' + N(to) + ' of ' + N(L.total) + ' \u00b7 ' + windowLabel()) : 'nothing in this view';

    if (!rows.length) {
      mount(LOG.tblHost, el('div', { class: 'lb-state' }, L.filter === 'removed'
        ? 'Nothing removed in this window \u2014 the list is clean. Bounced and dead addresses appear here automatically.'
        : (L.filter === 'opened'
          ? 'No opens recorded in this window. Open tracking only became first-party on 29 Aug 2026 \u2014 everything sent before that was never measured, so an empty result here is not the same as nobody opening.'
          : 'No emails match this view. Try a wider window or a different filter.')));
      return;
    }

    const table = (L.filter === 'removed')
      ? el('table', { class: 'cc-table' }, [
          el('thead', null, el('tr', null, ['Email', 'Company', 'Audience', 'Why removed', 'Emails got', 'Last activity'].map(h => el('th', null, h)))),
          el('tbody', null, rows.map(r => el('tr', { class: 'cc-row' }, [
            el('td', null, r.email),
            el('td', null, r.company || '\u2014'),
            el('td', { style: 'text-transform:capitalize' }, r.audience || '\u2014'),
            el('td', null, el('span', { class: 'cc-pill cc-pill-' + (r.status === 'bounced' ? 'red' : 'amber') }, r.status === 'bounced' ? 'email dead (bounced)' : r.status)),
            el('td', null, N(r.emails_sent)),
            el('td', null, r['when'] ? fmtDateTime(r['when']) : '\u2014'),
          ]))),
        ])
      // The old log built a 5-column header and then appended a 6th cell only on rows that
      // had a failure reason, so a single failed row knocked the whole table out of line.
      : el('table', { class: 'cc-table' }, [
          el('thead', null, el('tr', null, ['Email', 'Company', 'Which email', 'Status', 'Engagement', 'Time'].map(h => el('th', null, h)))),
          el('tbody', null, rows.map(r => el('tr', { class: 'cc-row' }, [
            el('td', null, r.email),
            el('td', null, r.company || '\u2014'),
            el('td', null, TPL_LABEL(r.tpl)),
            el('td', null, [
              el('span', { class: 'cc-pill cc-pill-' + (ST_TONE[r.status] || 'gray') }, r.status),
              r.reason ? el('div', { class: 'cc-sub', style: 'margin-top:3px' }, r.reason) : null,
            ]),
            el('td', null, [
              r.opened ? el('span', { class: 'cc-pill cc-pill-blue', style: 'margin-right:4px' }, 'opened') : null,
              r.clicked ? el('span', { class: 'cc-pill cc-pill-green' }, 'clicked') : null,
              (!r.opened && !r.clicked) ? el('span', { class: 'cc-sub' }, '\u2014') : null,
            ]),
            el('td', null, r['when'] ? fmtDateTime(r['when']) : '\u2014'),
          ]))),
        ]);

    mount(LOG.tblHost, [table, pager(L.total, L.limit, L.offset, (off) => { L.offset = off; loadLog(); })]);
  }

  // ------------------------------------------------------------- helpers
  // Any table that can run to dozens of rows shows its first few and a "show all" toggle,
  // so one long list can no longer push everything else off the screen.
  function collapsible(o) {
    const initial = o.initial || 7;
    const all = o.rows || [];
    const wrap = el('div');
    const draw = () => {
      const expanded = !!S.open[o.key];
      const shown = expanded ? all : all.slice(0, initial);
      mount(wrap, [
        o.title ? el('div', { class: 'fa-cardhead' }, [el('h3', null, o.title), o.note ? el('span', null, o.note) : null]) : null,
        all.length ? el('table', { class: 'cc-table' }, [
          el('thead', null, el('tr', null, o.headers.map(h => el('th', null, h)))),
          el('tbody', null, shown.map(o.row)),
        ]) : el('div', { class: 'lb-state' }, o.empty || 'Nothing here.'),
        all.length > initial ? el('button', {
          class: 'lb-btn lb-btn-ghost lb-btn-sm lbo-more',
          onclick: () => { S.open[o.key] = !S.open[o.key]; draw(); },
        }, expanded ? '▲ Show less' : ('▼ Show all ' + all.length + ' rows')) : null,
      ]);
    };
    draw();
    return wrap;
  }

  function pager(total, limit, offset, go) {
    const pages = Math.max(1, Math.ceil(total / limit));
    const cur = Math.floor(offset / limit) + 1;
    if (pages <= 1) return el('div');
    // 1 … 4 5 [6] 7 8 … 42 — never more than a handful of buttons however long the list is.
    const nums = [];
    const push = (p) => { if (nums[nums.length - 1] !== p) nums.push(p); };
    push(1);
    if (cur - 2 > 2) nums.push('…');
    for (let p = Math.max(2, cur - 2); p <= Math.min(pages - 1, cur + 2); p++) push(p);
    if (cur + 2 < pages - 1) nums.push('…');
    if (pages > 1) push(pages);
    return el('div', { class: 'lbo-pager' }, [
      el('button', { class: 'lb-btn lb-btn-ghost lb-btn-sm', disabled: cur === 1 ? true : null,
        onclick: () => go((cur - 2) * limit) }, '‹ Prev'),
      el('div', { class: 'lbo-pagenums' }, nums.map(p => p === '…'
        ? el('span', { class: 'lbo-gap' }, '…')
        : el('button', { class: 'lbo-page' + (p === cur ? ' active' : ''), onclick: () => go((p - 1) * limit) }, String(p)))),
      el('button', { class: 'lb-btn lb-btn-ghost lb-btn-sm', disabled: cur === pages ? true : null,
        onclick: () => go(cur * limit) }, 'Next ›'),
    ]);
  }

  function capRow(label, cur, onSave, min, max) {
    const inp = el('input', { class: 'lb-input', type: 'number', min: String(min == null ? 1 : min), max: String(max == null ? 100000 : max),
      value: cur == null ? '' : String(cur), style: 'width:90px' });
    return el('div', { style: 'display:flex;align-items:center;gap:8px;margin-top:8px' }, [
      el('span', { class: 'cc-sub', style: 'flex:1' }, label),
      inp,
      el('button', { class: 'lb-btn lb-btn-ghost lb-btn-sm', onclick: () => {
        const v = parseInt(inp.value, 10);
        if (!Number.isFinite(v)) { toast('Enter a number', 'error'); return; }
        onSave(v);
      } }, 'Save'),
    ]);
  }
}
