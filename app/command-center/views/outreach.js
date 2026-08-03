// outreach.js — Outreach CRM: the automated email acquisition engine dashboard.
// Shows engine state, contact CRM (carrier/broker/shipper), per-template send
// results and campaign clicks/signups. Controls: enable/disable, caps, run-now.
// Backend: cc_outreach_crm / cc_outreach_control / cc_outreach_stats (bl_out_0150-0153).
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, statCard, fmtDateTime, openDrawer, segmented } from '../../shared/ui/components.js';
import { ccOutreachCrm, ccOutreachControl, ccOutreachStats, ccOutreachToday, ccOutreachTemplates, ccOutreachTemplatePreview, ccOutreachTemplateSave, ccOutreachLog } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';

const TPL_LABEL = (k) => {
  // template_key = outreach.<audience>.d<N>
  const m = /^outreach\.(\w+)[.-]d(\d+)$/.exec(k || '');
  return m ? (m[1].charAt(0).toUpperCase() + m[1].slice(1) + ' — Day ' + m[2]) : (k || '—');
};
const ST_TONE = { sent: 'green', queued: 'blue', failed: 'red', bounced: 'red', skipped: 'gray' };

export function renderOutreach(host) {
  const kpis = el('div', { class: 'cc-kpi-grid' });
  const todayHost = el('div', { style: 'margin-top:16px' });
  const grid = el('div', { class: 'fa-grid', style: 'margin-top:16px' });
  const tplHost = el('div', { style: 'margin-top:16px' });
  const logHost = el('div', { style: 'margin-top:16px' });
  mount(host, el('div', null, [
    sectionHead('Outreach CRM', 'Automated daily email engine — FMCSA carriers, brokers and shippers get a 7-part value drip from hello@loadboot.com. Caps auto-ramp weekly; bounces auto-block; kill-switch pauses on high failure.'),
    kpis, todayHost, grid, tplHost, logHost,
  ]));
  load();
  loadToday();
  loadTemplates();
  loadLog('sent');

  async function control(action, value) {
    try {
      const r = await ccOutreachControl(action, value);
      if (r && r.error) throw new Error(r.error);
      toast('Outreach: ' + action + (value != null ? ' → ' + value : '') + ' ✓');
      load();
    } catch (e) { toast(humanizeError(e), 'error'); }
  }

  async function load() {
    showLoading(grid, 'Loading outreach engine…');
    let crm, stats;
    try { [crm, stats] = await Promise.all([ccOutreachCrm(30), ccOutreachStats(30).catch(() => null)]); }
    catch (e) { showError(grid, humanizeError(e), load); return; }
    if (crm && crm.error) { showError(grid, crm.error, load); return; }
    const st = (crm && crm.state) || {};
    const contacts = (crm && crm.contacts) || {};
    const sends = (crm && crm.sends) || [];

    // Aggregate contacts kind:status → totals
    const kinds = {};
    let totalActive = 0, totalUnsub = 0, totalBounced = 0, totalDone = 0, totalAll = 0;
    Object.entries(contacts).forEach(([k, n]) => {
      const [kind, status] = k.split(':');
      kinds[kind] = kinds[kind] || { active: 0, unsubscribed: 0, bounced: 0, completed: 0, suppressed: 0, total: 0 };
      kinds[kind][status] = (kinds[kind][status] || 0) + n; kinds[kind].total += n; totalAll += n;
      if (status === 'active') totalActive += n;
      if (status === 'unsubscribed') totalUnsub += n;
      if (status === 'bounced') totalBounced += n;
      if (status === 'completed') totalDone += n;
    });
    // "Sent" must mean everything that went out the door. Resend's delivery webhook moves
    // rows from 'sent' to 'delivered', so counting only status='sent' silently shrinks the
    // number as confirmations arrive — which is why the panel under-reported real sends.
    const sentN = sends.filter(s => s.status === 'sent' || s.status === 'delivered').reduce((a, s) => a + s.n, 0);
    const failN = sends.filter(s => s.status === 'failed' || s.status === 'bounced' || s.status === 'dead_letter').reduce((a, s) => a + s.n, 0);
    const daily = (crm && crm.daily) || [];
    const on = !!st.enabled;

    mount(kpis, [
      statCard({ icon: on ? 'check' : 'alert', label: 'Engine', value: on ? 'RUNNING' : 'PAUSED', sub: on ? ('cap ' + (st.base_cap || 0) + '/day → max ' + (st.max_cap || 0)) : 'sends disabled', accent: on ? 'green' : 'amber' }),
      statCard({ icon: 'users', label: 'Contacts', value: totalActive.toLocaleString(), sub: totalAll.toLocaleString() + ' total · ' + totalDone.toLocaleString() + ' completed drip', accent: 'blue' }),
      statCard({ icon: 'bell', label: 'Emails sent (30d)', value: sentN.toLocaleString(), sub: (st.sent_today || 0) + ' today · last run ' + (st.last_run ? fmtDateTime(st.last_run) : 'never'), accent: 'violet' }),
      statCard({ icon: 'alert', label: 'List health', value: totalBounced.toLocaleString() + ' bounced', sub: totalUnsub.toLocaleString() + ' unsubscribed · ' + failN + ' failed sends', accent: (sentN > 50 && failN / Math.max(1, sentN + failN) > 0.05) ? 'red' : 'green' }),
    ]);

    // Per-template table (merge statuses per tpl)
    const byTpl = {};
    sends.forEach(s => { byTpl[s.tpl] = byTpl[s.tpl] || {}; byTpl[s.tpl][s.status] = s.n; });
    const tplRows = Object.keys(byTpl).sort();

    // Campaign clicks/signups from web analytics (utm_campaign)
    const camps = (stats && (stats.campaigns || stats.rows)) || (Array.isArray(stats) ? stats : []);

    mount(grid, [
      el('div', { class: 'lb-card fa-col2' }, [
        el('div', { class: 'fa-cardhead' }, [el('h3', null, 'Exact sends by day (last 30 days)'), el('span', null, sentN.toLocaleString() + ' sent · ' + failN + ' failed/bounced')]),
        daily.length ? el('table', { class: 'cc-table' }, [
          el('thead', null, el('tr', null, ['Day', 'Went out', 'Delivery confirmed', 'Bounced', 'Failed'].map(h => el('th', null, h)))),
          el('tbody', null, daily.map(dd => el('tr', { class: 'cc-row' }, [
            el('td', null, el('b', null, dd.day)),
            el('td', null, el('span', { class: 'cc-pill cc-pill-blue' }, String(dd.total || 0))),
            el('td', null, String(dd.delivered || 0)),
            el('td', null, (dd.bounced || 0) > 0 ? el('span', { class: 'cc-pill cc-pill-red' }, String(dd.bounced)) : '0'),
            el('td', null, (dd.failed || 0) > 0 ? el('span', { class: 'cc-pill cc-pill-red' }, String(dd.failed)) : '0'),
          ]))),
        ]) : el('div', { class: 'lb-state' }, 'No sends in this window.'),
        el('div', { class: 'fa-cardhead', style: 'margin-top:16px' }, [el('h3', null, 'Send results by email (last 30 days)')]),
        tplRows.length ? el('table', { class: 'cc-table' }, [
          el('thead', null, el('tr', null, ['Email', 'Sent', 'Confirmed', 'Queued', 'Failed'].map(h => el('th', null, h)))),
          el('tbody', null, tplRows.map(t => el('tr', { class: 'cc-row' }, [
            el('td', null, el('b', null, TPL_LABEL(t))),
            el('td', null, el('span', { class: 'cc-pill cc-pill-green' }, String((byTpl[t].sent || 0) + (byTpl[t].delivered || 0)))),
            el('td', null, String(byTpl[t].delivered || 0)),
            el('td', null, String(byTpl[t].queued || 0)),
            el('td', null, (byTpl[t].failed || byTpl[t].bounced || byTpl[t].dead_letter) ? el('span', { class: 'cc-pill cc-pill-red' }, String((byTpl[t].failed || 0) + (byTpl[t].bounced || 0) + (byTpl[t].dead_letter || 0))) : '0'),
          ]))),
        ]) : el('div', { class: 'lb-state' }, 'No sends yet — first batch goes out at the daily run (13:00 UTC).'),
        camps.length ? el('div', { style: 'margin-top:16px' }, [
          el('div', { class: 'fa-cardhead' }, [el('h3', null, 'Clicks → signups (UTM campaigns)')]),
          el('table', { class: 'cc-table' }, [
            el('thead', null, el('tr', null, ['Campaign', 'Sessions', 'Pageviews', 'Signups'].map(h => el('th', null, h)))),
            el('tbody', null, camps.map(c => el('tr', { class: 'cc-row' }, [
              el('td', null, el('b', null, c.campaign || c.utm_campaign || '—')),
              el('td', null, String(c.sessions || c.clicks || 0)),
              el('td', null, String(c.pageviews || 0)),
              el('td', null, el('span', { class: 'cc-pill cc-pill-' + ((c.signups || c.converted || 0) > 0 ? 'green' : 'gray') }, String(c.signups || c.converted || 0))),
            ]))),
          ]),
        ]) : null,
      ]),
      el('div', null, [
        el('div', { class: 'lb-card' }, [
          el('div', { class: 'fa-cardhead' }, [el('h3', null, 'Engine controls')]),
          el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px' }, [
            el('button', { class: 'lb-btn ' + (on ? 'lb-btn-ghost' : 'lb-btn-primary'), onclick: () => control(on ? 'disable' : 'enable') }, on ? '⏸ Pause engine' : '▶ Enable engine'),
            el('button', { class: 'lb-btn lb-btn-ghost', onclick: () => { if (confirm('Run a send batch right now (up to today’s remaining cap)?')) control('run_now'); } }, '⚡ Run now'),
          ]),
          capRow('Daily cap (base)', st.base_cap, v => control('base_cap', v)),
          capRow('Hard max/day', st.max_cap, v => control('max_cap', v)),
          el('p', { class: 'cc-sub', style: 'margin-top:10px' }, 'Cap auto-doubles weekly from base (started ' + (st.started_on || '—') + ') up to the hard max. Keep max ≤ 400/day until the sending subdomain (mail.loadboot.com) is verified — protects the main domain.'),
        ]),
        el('div', { class: 'lb-card', style: 'margin-top:16px' }, [
          el('div', { class: 'fa-cardhead' }, [el('h3', null, 'Contacts by audience')]),
          el('table', { class: 'cc-table' }, [
            el('thead', null, el('tr', null, ['Audience', 'Active', 'Done', 'Unsub', 'Bounced'].map(h => el('th', null, h)))),
            el('tbody', null, Object.keys(kinds).sort().map(k => el('tr', { class: 'cc-row' }, [
              el('td', null, el('b', { style: 'text-transform:capitalize' }, k)),
              el('td', null, (kinds[k].active || 0).toLocaleString()),
              el('td', null, String(kinds[k].completed || 0)),
              el('td', null, String(kinds[k].unsubscribed || 0)),
              el('td', null, String(kinds[k].bounced || 0)),
            ]))),
          ]),
          el('p', { class: 'cc-sub', style: 'margin-top:10px' }, 'Each contact gets the 7-email drip for its own audience (carrier ≠ broker), one email every 3+ days. Bounces auto-block; unsubscribe is one click. Kill-switch: >10% failures over 2 days auto-pauses the engine and alerts staff.'),
        ]),
      ]),
    ]);
  }

  async function loadToday() {
    let t; try { t = await ccOutreachToday(); } catch (e) { mount(todayHost, ''); return; }
    if (!t || t.error) { mount(todayHost, ''); return; }
    const batch = t.batch || [];
    const sample = t.sample || [];
    mount(todayHost, el('div', { class: 'lb-card' }, [
      el('div', { class: 'fa-cardhead' }, [el('h3', null, "Next run — what goes out today"),
        el('span', null, (t.enabled ? 'cap left today: ' + (t.cap_remaining || 0) : 'ENGINE PAUSED — nothing will send') + ' · ' + Number(t.total_due || 0).toLocaleString() + ' contacts due in queue')]),
      batch.length ? el('table', { class: 'cc-table' }, [
        el('thead', null, el('tr', null, ['Audience', 'Email', 'Subject', 'Recipients'].map(h => el('th', null, h)))),
        el('tbody', null, batch.map(b => el('tr', { class: 'cc-row' }, [
          el('td', null, el('b', { style: 'text-transform:capitalize' }, b.audience)),
          el('td', null, 'Day ' + b.day),
          el('td', null, b.subject || '—'),
          el('td', null, el('span', { class: 'cc-pill cc-pill-blue' }, String(b.n))),
        ]))),
      ]) : el('div', { class: 'lb-state' }, t.enabled ? 'Cap used up for today — next batch tomorrow 13:00 UTC.' : 'Enable the engine to start sending.'),
      sample.length ? el('p', { class: 'cc-sub', style: 'margin-top:10px' }, 'First in line: ' + sample.map(x => (x.company || x.email) + ' (' + x.audience + ' d' + x.day + ')').slice(0, 6).join(' · ')) : null,
    ]));
  }

  async function loadTemplates() {
    let list; try { list = await ccOutreachTemplates(); } catch (e) { mount(tplHost, ''); return; }
    if (!list || list.error) { mount(tplHost, ''); return; }
    mount(tplHost, el('div', { class: 'lb-card' }, [
      el('div', { class: 'fa-cardhead' }, [el('h3', null, 'Email templates (' + list.length + ')'),
        el('button', { class: 'lb-btn lb-btn-primary', onclick: () => openEditor(null) }, '+ New / upload template')]),
      el('table', { class: 'cc-table' }, [
        el('thead', null, el('tr', null, ['Audience', 'Day', 'Subject', 'Body', 'Status', '', ''].map(h => el('th', null, h)))),
        el('tbody', null, list.map(t => el('tr', { class: 'cc-row' }, [
          el('td', null, el('b', { style: 'text-transform:capitalize' }, t.audience)),
          el('td', null, 'Day ' + t.day),
          el('td', null, t.subject),
          el('td', null, el('span', { class: 'cc-pill cc-pill-' + (t.has_parts ? 'blue' : 'violet') }, t.has_parts ? 'designed' : 'custom HTML')),
          el('td', null, el('span', { class: 'cc-pill cc-pill-' + (t.active ? 'green' : 'gray') }, t.active ? 'active' : 'off')),
          el('td', null, el('button', { class: 'lb-btn lb-btn-ghost', onclick: () => openPreview(t.id) }, '👁 Preview')),
          el('td', null, el('button', { class: 'lb-btn lb-btn-ghost', onclick: () => openEditor(t) }, '✏️ Edit')),
        ]))),
      ]),
      el('p', { class: 'cc-sub', style: 'margin-top:10px' }, '“Designed” = built from LoadBoot premium blocks. Editing a designed template with your own HTML replaces its body. Placeholders: {NAME} = company name, {UNSUB} = unsubscribe link (required by law — always keep it).'),
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
    fr.setAttribute('srcdoc', (t.html || '').replace(/\{NAME\}/g, 'Acme Trucking LLC').replace(/\{UNSUB\}/g, '#'));
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
      el('p', { class: 'cc-sub' }, 'Placeholders: {NAME} = company name · {UNSUB} = unsubscribe URL (must stay). Saving custom HTML replaces the designed body for that day.'),
      err, save,
    ]), { subtitle: (t ? 'Overwrites ' : 'Creates ') + 'the email for that audience + day' });
  }

  async function loadLog(filter) {
    const FILTERS = [
      { value: 'sent', label: '✅ Sent' }, { value: 'failed', label: '⚠️ Failed / bounced' },
      { value: 'removed', label: '🚫 Removed from list' }, { value: 'all', label: 'All activity' },
    ];
    const tblHost = el('div', { style: 'margin-top:10px' }, el('div', { class: 'lb-state lb-loading' }, 'Loading…'));
    mount(logHost, el('div', { class: 'lb-card' }, [
      el('div', { class: 'fa-cardhead' }, [el('h3', null, 'Delivery log — every email, one by one'),
        el('span', null, 'last 500 max')]),
      segmented(FILTERS, filter, (v) => loadLog(v)),
      tblHost,
    ]));
    let rows; try { rows = await ccOutreachLog(filter, 200); } catch (e) { mount(tblHost, el('div', { class: 'lb-state lb-error' }, humanizeError(e))); return; }
    if (!rows || rows.error) { mount(tblHost, el('div', { class: 'lb-state lb-error' }, (rows && rows.error) || 'Failed')); return; }
    if (!rows.length) {
      mount(tblHost, el('div', { class: 'lb-state' }, filter === 'removed'
        ? 'Nothing removed yet — list is clean. Bounced/dead addresses will appear here automatically.'
        : 'No emails in this view yet — first batch goes at the daily run.'));
      return;
    }
    if (filter === 'removed') {
      mount(tblHost, el('table', { class: 'cc-table' }, [
        el('thead', null, el('tr', null, ['Email', 'Company', 'Audience', 'Why removed', 'Emails got', 'Last activity'].map(h => el('th', null, h)))),
        el('tbody', null, rows.map(r => el('tr', { class: 'cc-row' }, [
          el('td', null, r.email),
          el('td', null, r.company || '—'),
          el('td', { style: 'text-transform:capitalize' }, r.audience || '—'),
          el('td', null, el('span', { class: 'cc-pill cc-pill-' + (r.status === 'bounced' ? 'red' : 'amber') }, r.status === 'bounced' ? 'email dead (bounced)' : r.status)),
          el('td', null, String(r.emails_sent || 0)),
          el('td', null, r['when'] ? fmtDateTime(r['when']) : '—'),
        ]))),
      ]));
    } else {
      mount(tblHost, el('table', { class: 'cc-table' }, [
        el('thead', null, el('tr', null, ['Email', 'Company', 'Which email', 'Status', 'Time'].map(h => el('th', null, h)))),
        el('tbody', null, rows.map(r => el('tr', { class: 'cc-row' }, [
          el('td', null, r.email),
          el('td', null, r.company || '—'),
          el('td', null, TPL_LABEL(r.tpl)),
          el('td', null, el('span', { class: 'cc-pill cc-pill-' + (ST_TONE[r.status] || 'gray') }, r.status + (r.reason ? '' : ''))),
          el('td', null, r['when'] ? fmtDateTime(r['when']) : '—'),
        ].concat(r.reason ? [el('td', { class: 'cc-sub' }, r.reason)] : [])))),
      ]));
    }
  }

  function capRow(label, cur, onSave) {
    const inp = el('input', { class: 'lb-input', type: 'number', min: '10', max: '5000', value: String(cur || 0), style: 'width:90px' });
    return el('div', { style: 'display:flex;align-items:center;gap:8px;margin-top:8px' }, [
      el('span', { class: 'cc-sub', style: 'flex:1' }, label),
      inp,
      el('button', { class: 'lb-btn lb-btn-ghost', onclick: () => { const v = parseInt(inp.value, 10); if (v > 0) onSave(v); } }, 'Save'),
    ]);
  }
}
