// outreach.js — Outreach CRM: the automated email acquisition engine dashboard.
// Shows engine state, contact CRM (carrier/broker/shipper), per-template send
// results and campaign clicks/signups. Controls: enable/disable, caps, run-now.
// Backend: cc_outreach_crm / cc_outreach_control / cc_outreach_stats (bl_out_0150-0153).
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, statCard, fmtDateTime } from '../../shared/ui/components.js';
import { ccOutreachCrm, ccOutreachControl, ccOutreachStats } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';

const TPL_LABEL = (k) => {
  // template_key = outreach.<audience>.d<N>
  const m = /^outreach\.(\w+)\.d(\d+)$/.exec(k || '');
  return m ? (m[1].charAt(0).toUpperCase() + m[1].slice(1) + ' — Day ' + m[2]) : (k || '—');
};
const ST_TONE = { sent: 'green', queued: 'blue', failed: 'red', bounced: 'red', skipped: 'gray' };

export function renderOutreach(host) {
  const kpis = el('div', { class: 'cc-kpi-grid' });
  const grid = el('div', { class: 'fa-grid', style: 'margin-top:16px' });
  mount(host, el('div', null, [
    sectionHead('Outreach CRM', 'Automated daily email engine — FMCSA carriers, brokers and shippers get a 7-part value drip from hello@loadboot.com. Caps auto-ramp weekly; bounces auto-block; kill-switch pauses on high failure.'),
    kpis, grid,
  ]));
  load();

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
    const sentN = sends.filter(s => s.status === 'sent').reduce((a, s) => a + s.n, 0);
    const failN = sends.filter(s => s.status === 'failed' || s.status === 'bounced').reduce((a, s) => a + s.n, 0);
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
        el('div', { class: 'fa-cardhead' }, [el('h3', null, 'Send results by email (last 30 days)'), el('span', null, sentN.toLocaleString() + ' delivered')]),
        tplRows.length ? el('table', { class: 'cc-table' }, [
          el('thead', null, el('tr', null, ['Email', 'Sent', 'Queued', 'Failed'].map(h => el('th', null, h)))),
          el('tbody', null, tplRows.map(t => el('tr', { class: 'cc-row' }, [
            el('td', null, el('b', null, TPL_LABEL(t))),
            el('td', null, el('span', { class: 'cc-pill cc-pill-green' }, String(byTpl[t].sent || 0))),
            el('td', null, String(byTpl[t].queued || 0)),
            el('td', null, (byTpl[t].failed || byTpl[t].bounced) ? el('span', { class: 'cc-pill cc-pill-red' }, String((byTpl[t].failed || 0) + (byTpl[t].bounced || 0))) : '0'),
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

  function capRow(label, cur, onSave) {
    const inp = el('input', { class: 'lb-input', type: 'number', min: '10', max: '5000', value: String(cur || 0), style: 'width:90px' });
    return el('div', { style: 'display:flex;align-items:center;gap:8px;margin-top:8px' }, [
      el('span', { class: 'cc-sub', style: 'flex:1' }, label),
      inp,
      el('button', { class: 'lb-btn lb-btn-ghost', onclick: () => { const v = parseInt(inp.value, 10); if (v > 0) onSave(v); } }, 'Save'),
    ]);
  }
}
