// brain.js — Command Center → AI Brain (bl_brain_0474). The control plane for the Ops Brain (bl_brain_0470/0472/0473).
//
// One screen, six tabs (app.js TABBED.brain): Overview · Jobs · Permissions · Findings · Facts · Change log.
// Every RPC re-checks settings.manage server-side (app_private.brain_cc_guard); this file only hides what the
// person cannot do.
//
// The Overview's "Spend today" panel is deliberately shaped like the Claude app's context-window panel the owner
// asked for (27 Sep 2026): one number on top ($ spent / cap / %), a stacked bar under it, then one line per source
// with its $ and share, then the token split, then every limit as a progress bar. Same reading order, no
// decoration.
//
// Nothing here talks to Anthropic. The brain runs in Postgres + the `brain` edge function; this screen reads
// brain_jobs / brain_usage_daily / brain_permissions through cc_brain_* and flips switches through them.

import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, statCard, openDrawer, askConfirm, fmtDateTime, ago } from '../../shared/ui/components.js';
import { ccBrainOverview, ccBrainJobs, ccBrainJob, ccBrainChats, ccBrainConfigSet, ccBrainCreditSet, ccBrainPermSet, ccBrainPermAdd, ccBrainPermDelete,
         ccBrainPermLog, ccBrainFindings, ccBrainFindingSet, ccBrainFacts, ccBrainFactSet, ccBrainTest } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';

const REFRESH_MS = 10000;

// Source colours: stable, one per source, so the stacked bar and its legend always agree.
const SRC = {
  chat:       { label: 'Live chat',        c: '#0883F7' },
  assist:     { label: 'Staff assist',     c: '#7c3aed' },
  email:      { label: 'Mailbox',          c: '#f97316' },
  wa:         { label: 'WhatsApp',         c: '#16a34a' },
  onboarding: { label: 'Onboarding',       c: '#0d9488' },
  dispatch:   { label: 'Dispatcher ops',   c: '#e11d48' },
  sales:      { label: 'Sales',            c: '#f59e0b' },
  sweep:      { label: 'Sweeps & digest',  c: '#64748b' },
  voice:      { label: 'Voice (Riley)',    c: '#0ea5e9' },
  test:       { label: 'Test jobs',        c: '#94a3b8' },
};
const TOK = [
  ['input_tokens', 'Input',       '#0883F7'],
  ['cache_read',   'Cache read',  '#16a34a'],
  ['cache_write',  'Cache write', '#f59e0b'],
  ['output_tokens','Output',      '#7c3aed'],
];
const STATUS_TONE = { done: 'green', running: 'blue', queued: 'blue', failed: 'red', capped: 'amber', skipped: 'gray' };
const RISK_TONE = { low: 'green', medium: 'amber', high: 'red' };
const KIND_LABEL = { source: 'Sources — where the brain may work', tool: 'Tools — what the brain may do', rule: 'Rules — what the brain may never do' };
const FINDING_KIND = { bug: 'Bug', kb_gap: 'KB gap', portal: 'Portal idea', growth: 'Growth', seo: 'SEO', ads: 'Ads', process: 'Process' };

/* ------------------------------------------------------------------ formatting */
const n0 = (v) => Number(v) || 0;
function fmtK(v) { const n = n0(v); if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M'; if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k'; return String(Math.round(n)); }
function usd(v, dp) { const n = n0(v); return '$' + n.toFixed(dp != null ? dp : (n >= 100 ? 0 : n >= 10 ? 1 : 2)); }
function pct(a, b) { const d = n0(b); return d > 0 ? Math.round(n0(a) / d * 1000) / 10 : 0; }
function pctTxt(a, b) { const p = pct(a, b); return p === 0 && n0(a) > 0 ? '<0.1%' : p + '%'; }
function srcOf(k) { return SRC[k] || { label: k, c: '#cbd5e1' }; }
function pill(text, tone) { return el('span', { class: 'cc-pill cc-pill-' + (tone || 'gray') }, [el('i', { class: 'cc-pill-dot' }), text]); }
function secs(v) { const n = n0(v); return n >= 60 ? Math.floor(n / 60) + 'm ' + Math.round(n % 60) + 's' : n.toFixed(n < 10 ? 1 : 0) + 's'; }
function conf(v) { if (v == null || v === '') return '—'; const n = Number(v); return Number.isFinite(n) ? Math.round(n * 100) + '%' : String(v); }

/* ------------------------------------------------------------------ shell */
export function renderBrain(host, tab, query) {
  injectStyleOnce();
  if (!can('settings.manage')) {
    mount(host, el('div', { class: 'lb-state lb-error', role: 'alert' }, el('p', null, 'AI Brain needs settings.manage.')));
    return;
  }
  const q = query || new URLSearchParams('');
  switch (tab) {
    case 'jobs': return renderJobs(host, q);
    case 'chats': return renderChats(host, q);   // bl_brain_0479
    case 'permissions': return renderPermissions(host, q);
    case 'findings': return renderFindings(host, q);
    case 'facts': return renderFacts(host, q);
    case 'log': return renderLog(host, q);
    default: return renderOverview(host, q);
  }
}

/* ================================================================== OVERVIEW */
function renderOverview(host) {
  const head = el('div');
  const spendHost = el('div');
  const rightHost = el('div', { class: 'cc-brain-right' });
  const root = el('div', { class: 'cc-brain' }, [head, el('div', { class: 'cc-brain-grid' }, [spendHost, rightHost])]);
  mount(host, root);
  showLoading(spendHost, 'Reading the brain…');

  let timer = null; let busy = false;
  const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
  async function load(silent) {
    if (!host.isConnected) { stop(); return; }
    if (busy) return; busy = true;
    try {
      const o = await ccBrainOverview();
      if (!host.isConnected) return;
      paintHead(o); paintSpend(o); paintRight(o);
    } catch (e) {
      if (!silent) showError(spendHost, humanizeError(e), () => load());
    } finally { busy = false; }
  }
  load();
  timer = setInterval(() => load(true), REFRESH_MS);

  /* ---- header: state + switches + try a question */
  function paintHead(o) {
    const st = o.state || {}, cfg = o.config || {};
    const chatPerm = (o.permissions || []).find(p => p.key === 'source.chat') || {};
    const assistPerm = (o.permissions || []).find(p => p.key === 'source.assist') || {};
    const keyOk = !!cfg.fn_key_set;
    const lastFail = (o.counts && o.counts.failed_today) || 0;

    const sw = (on, onChange, title) => {
      const input = el('input', { type: 'checkbox', checked: !!on, onChange: (e) => onChange(e.target.checked, e.target) });
      return el('label', { class: 'cc-switch', title: title || '' }, [input, el('span', { class: 'track' })]);
    };
    const row = (label, sub, ctl) => el('div', { class: 'cc-brain-ctl' }, [el('div', null, [el('b', null, label), el('small', null, sub)]), ctl]);

    const capInput = el('input', { class: 'lb-input cc-brain-cap', type: 'number', min: '0', step: '1', value: String(st.cap_usd ?? cfg.daily_usd_cap ?? 25) });
    const capBtn = el('button', { class: 'lb-btn lb-btn-sm', onClick: async () => {
      const v = Number(capInput.value);
      if (!(v >= 0)) { toast('Cap must be a number', 'error'); return; }
      try { await ccBrainConfigSet({ daily_usd_cap: v, reason: 'CC → AI Brain → Overview' }); toast('Daily cap is now ' + usd(v, 0)); load(true); }
      catch (e) { toast(humanizeError(e), 'error'); }
    } }, 'Save');

    const controls = el('div', { class: 'cc-brain-ctls' }, [
      row('Brain', st.enabled ? 'On — jobs run on ' + (st.model || cfg.model || 'Claude') : 'OFF — every source falls back (chat → Gemini, mail → nothing sent)',
        sw(st.enabled, async (on, input) => {
          if (!on && !(await askConfirm('Switch the brain off?', { body: 'Every source stops immediately. Live chat falls back to Gemini, no email is drafted, nothing is lost — jobs are skipped, not dropped.', confirmLabel: 'Switch off', danger: true }))) { input.checked = true; return; }
          try { await ccBrainConfigSet({ enabled: on, reason: 'CC kill switch' }); toast(on ? 'Brain is on' : 'Brain is off'); load(true); } catch (e) { input.checked = !on; toast(humanizeError(e), 'error'); }
        }, 'Kill switch')),
      row('Live chat on Claude', chatPerm.enabled ? 'On — visitors get Claude; Gemini only on cap / error / timeout' : 'Off — visitors get Gemini (lc-brain v4)',
        sw(chatPerm.enabled, async (on, input) => {
          try { await ccBrainPermSet('source.chat', { enabled: on, reason: 'CC → AI Brain → Overview' }); toast(on ? 'Live chat answers through Claude' : 'Live chat is back on Gemini'); load(true); }
          catch (e) { input.checked = !on; toast(humanizeError(e), 'error'); }
        }, 'source.chat')),
      row('Staff suggested replies', assistPerm.enabled ? 'On — "Suggest a reply" in Live chat drafts for staff only' : 'Off — the Live chat button is hidden',
        sw(assistPerm.enabled, async (on, input) => {
          try { await ccBrainPermSet('source.assist', { enabled: on, reason: 'CC → AI Brain → Overview' }); toast(on ? 'Suggested replies on' : 'Suggested replies off'); load(true); }
          catch (e) { input.checked = !on; toast(humanizeError(e), 'error'); }
        }, 'source.assist')),
      // bl_brain_0479 — one bell notification the moment the AI writes the FIRST reply of a new chat (never per message).
      row('Tell me when the AI takes a new chat', cfg.chat_notify_new !== false ? 'On — a bell notification with the visitor’s question, linked to the chat' : 'Off — AI chats only show in Live chat and the Chats tab',
        sw(cfg.chat_notify_new !== false, async (on, input) => {
          try { await ccBrainConfigSet({ chat_notify_new: on, reason: 'CC → AI Brain → Overview' }); toast(on ? 'You will be told when the AI takes a new chat' : 'New-chat notifications off'); load(true); }
          catch (e) { input.checked = !on; toast(humanizeError(e), 'error'); }
        }, 'brain_config.chat_notify_new')),
      row('Daily cap', 'Hard stop for the day (UTC). Over the cap: chat → Gemini, everything else waits for tomorrow.',
        el('div', { class: 'cc-brain-capbox' }, [el('span', null, '$'), capInput, capBtn])),
    ]);

    const status = el('div', { class: 'cc-brain-status' }, [
      pill(st.enabled ? 'Brain on' : 'Brain off', st.enabled ? 'green' : 'red'),
      pill(keyOk ? 'Function key set' : 'Function key missing', keyOk ? 'green' : 'red'),
      st.over_cap ? pill('Over daily cap', 'amber') : null,
      o.credit && o.credit.below_reserve ? pill('Below Claude credit reserve', 'red') : null,
      st.spot_check ? pill('Spot-check window', 'blue') : null,
      lastFail ? pill(lastFail + ' failed today', 'red') : null,
      el('span', { class: 'cc-brain-model' }, [el('u', null, 'Model'), el('b', null, st.model || cfg.model || '—'), el('u', null, 'Gate'), el('b', null, cfg.gate_model || '—')]),
    ].filter(Boolean));

    // Try a question — a real Claude call, filed under source.test. Costs money, delivers nothing.
    const ta = el('textarea', { class: 'lb-input', rows: '2', placeholder: 'Ask the brain something a visitor would ask — e.g. "my COI was rejected, why?"' });
    const lang = el('select', { class: 'lb-input cc-brain-lang' }, [el('option', { value: 'en' }, 'English'), el('option', { value: 'es' }, 'Español')]);
    const out = el('div', { class: 'cc-brain-testout' });
    const ask = el('button', { class: 'lb-btn lb-btn-primary lb-btn-sm', onClick: async () => {
      const qq = ta.value.trim(); if (!qq) { ta.focus(); return; }
      ask.disabled = true; mount(out, el('div', { class: 'cc-brain-muted' }, 'Queued… the answer lands in Jobs in a few seconds.'));
      try {
        const r = await ccBrainTest(qq, lang.value);
        if (r && r.status && r.status !== 'queued') { mount(out, el('div', { class: 'cc-brain-bad' }, 'Not run: ' + (r.error || r.status))); return; }
        const id = r && r.job_id;
        mount(out, el('div', { class: 'cc-brain-muted' }, 'Job #' + id + ' running…'));
        for (let i = 0; i < 40; i++) {
          await new Promise(res => setTimeout(res, 2000));
          const j = await ccBrainJob(id);
          const job = j && j.job;
          if (!job) break;
          if (job.status === 'done' || job.status === 'failed') { mount(out, jobResultCard(job, j.actions || [])); load(true); return; }
        }
        mount(out, el('div', { class: 'cc-brain-bad' }, 'Still running after 80 s — open Jobs to follow it.'));
      } catch (e) { mount(out, el('div', { class: 'cc-brain-bad' }, humanizeError(e))); }
      finally { ask.disabled = false; }
    } }, 'Ask the brain');
    const tryBox = el('div', { class: 'lb-card cc-brain-try' }, [
      el('h3', null, 'Try a question'), el('p', { class: 'cc-brain-muted' }, 'Runs the real model with the live facts and knowledge base. Filed under "Test jobs" — costs a few cents, reaches nobody.'),
      ta, el('div', { class: 'cc-brain-tryrow' }, [lang, ask]), out,
    ]);

    mount(head, [
      sectionHead('AI Brain', 'Claude runs live chat, drafts for staff, and — as each source is switched on — the mailbox, onboarding, dispatcher ops and sales. Everything it does is a job with a cost and an audit row.'),
      status,
      el('div', { class: 'cc-brain-headgrid' }, [el('div', { class: 'lb-card' }, controls), tryBox]),
    ]);
  }

  /* ---- the panel the owner asked for */
  function paintSpend(o) {
    const st = o.state || {}, today = o.today || {}, cap = n0(st.cap_usd), spent = n0(st.spent_today);
    const sources = (o.permissions || []).filter(p => p.kind === 'source');
    const bySrc = sources.map(p => ({ key: p.name, usd: n0(p.usd_today), jobs: n0(p.today), cap: p.usd_cap_daily, maxDay: p.max_per_day, enabled: p.enabled, label: p.label }))
      .sort((a, b) => b.usd - a.usd);
    const denom = Math.max(cap, spent, 0.01);

    // stacked bar: one segment per source that spent, grey remainder = what is left under the cap
    const bar = el('div', { class: 'cc-brain-stack' }, bySrc.filter(s => s.usd > 0).map(s =>
      el('i', { style: 'width:' + Math.max(0.6, s.usd / denom * 100) + '%;background:' + srcOf(s.key).c, title: srcOf(s.key).label + ' ' + usd(s.usd) })));
    const line = (sw, label, v, p, cls) => el('div', { class: 'cc-brain-line ' + (cls || '') }, [
      sw ? el('i', { class: 'cc-brain-sw', style: 'background:' + sw }) : el('i', { class: 'cc-brain-sw none' }),
      el('span', { class: 'cc-brain-ll' }, label), el('span', { class: 'cc-brain-lv' }, v), el('span', { class: 'cc-brain-lp' }, p),
    ]);
    const srcLines = bySrc.filter(s => s.usd > 0).map(s => line(srcOf(s.key).c, s.label || srcOf(s.key).label, usd(s.usd), pctTxt(s.usd, denom)));
    srcLines.push(line('#e5e7eb', 'Left under the cap', usd(Math.max(0, cap - spent)), pctTxt(Math.max(0, cap - spent), denom), 'muted'));
    const quiet = bySrc.filter(s => s.usd === 0).map(s => line(null, s.label || srcOf(s.key).label, s.enabled ? '$0' : 'off', '—', 'muted'));

    const totalTok = TOK.reduce((a, t) => a + n0(today[t[0]]), 0);
    const tokLines = TOK.map(t => line(t[2], t[1], fmtK(today[t[0]]), pctTxt(today[t[0]], totalTok)));
    const cacheHit = o.counts && o.counts.cache_hit_pct;

    const limit = (label, sub, a, b, unit) => {
      const p = b > 0 ? Math.min(100, pct(a, b)) : 0;
      const tone = p >= 90 ? 'bad' : p >= 70 ? 'warn' : 'ok';
      return el('div', { class: 'cc-brain-lim' }, [
        el('div', { class: 'cc-brain-limhead' }, [el('span', null, [el('b', null, label), sub ? el('small', null, ' · ' + sub) : null]),
          el('span', { class: 'cc-brain-limv' }, (unit === '$' ? usd(a) + ' / ' + usd(b, 0) : fmtK(a) + ' / ' + fmtK(b)) + '  ' + Math.round(p) + '%')]),
        el('div', { class: 'cc-brain-track' }, el('i', { class: 'cc-brain-fill ' + tone, style: 'width:' + p + '%' })),
      ]);
    };
    const lims = [limit('Daily cap', 'resets 00:00 UTC', spent, cap, '$')];
    bySrc.filter(s => s.enabled && (s.cap != null || s.maxDay != null)).forEach(s => {
      if (s.cap != null) lims.push(limit(s.label || srcOf(s.key).label, 'spend today', s.usd, n0(s.cap), '$'));
      if (s.maxDay != null) lims.push(limit(s.label || srcOf(s.key).label, 'jobs today', s.jobs, n0(s.maxDay), 'n'));
    });

    const days = (o.days || []).slice(-7);
    const week = days.reduce((a, d) => a + n0(d.usd), 0);
    const weekJobs = days.reduce((a, d) => a + n0(d.jobs), 0);

    mount(spendHost, el('div', { class: 'lb-card cc-brain-spend' }, [
      el('div', { class: 'cc-brain-sphead' }, [el('span', null, 'Spend today'), el('b', null, usd(spent) + ' / ' + usd(cap, 0) + ' (' + Math.round(pct(spent, cap)) + '%)')]),
      bar,
      el('div', { class: 'cc-brain-lines' }, srcLines.concat(quiet)),
      el('div', { class: 'cc-brain-sphead sub' }, [el('span', null, 'Tokens today'), el('b', null, fmtK(totalTok) + (cacheHit != null ? ' · ' + Math.round(cacheHit) + '% from cache' : ''))]),
      el('div', { class: 'cc-brain-lines' }, tokLines),
      el('div', { class: 'cc-brain-sphead sub' }, [el('span', null, 'Limits'), el('b', null, (today.jobs || 0) + ' jobs today')]),
      el('div', { class: 'cc-brain-lims' }, lims),
      o.credit ? creditBlock(o.credit, line) : null,
      el('div', { class: 'cc-brain-sphead sub' }, [el('span', null, 'Last 7 days'), el('b', null, usd(week) + ' · ' + weekJobs + ' jobs')]),
      el('div', { class: 'cc-brain-days' }, days.map(d => {
        const h = week > 0 ? Math.max(4, n0(d.usd) / Math.max(...days.map(x => n0(x.usd)), 0.01) * 100) : 4;
        return el('div', { class: 'cc-brain-day', title: d.day + ' · ' + usd(d.usd) + ' · ' + (d.jobs || 0) + ' jobs' }, [el('i', { style: 'height:' + h + '%' }), el('small', null, String(d.day || '').slice(5))]);
      })),
    ]));
  }

  /* ---- Claude credit (bl_ai_0531): prepaid Console balance, each credit's expiry, the reserve stop */
  function creditBlock(cr, line) {
    const est = cr.est_balance, res = n0(cr.reserve_usd);
    const save = async (patch, msg) => {
      try { await ccBrainCreditSet(Object.assign({ reason: 'CC → AI Brain → Overview' }, patch)); toast(msg); load(true); }
      catch (e) { toast(humanizeError(e), 'error'); }
    };
    const balInput = el('input', { class: 'lb-input cc-brain-cap', type: 'number', min: '0', step: '0.01', placeholder: 'Console' });
    const balBtn = el('button', { class: 'lb-btn lb-btn-sm', onClick: () => {
      const v = Number(balInput.value);
      if (balInput.value === '' || !(v >= 0)) { toast('Type the balance shown in Console → Billing → Credits', 'error'); return; }
      save({ balance_usd: v }, 'Claude balance set to ' + usd(v));
    } }, 'Set');
    const resInput = el('input', { class: 'lb-input cc-brain-cap', type: 'number', min: '0', step: '1', value: String(res) });
    const resBtn = el('button', { class: 'lb-btn lb-btn-sm', onClick: () => {
      const v = Number(resInput.value);
      if (!(v >= 0)) { toast('Reserve must be a number', 'error'); return; }
      save({ reserve_usd: v }, 'Reserve is now ' + usd(v, 0));
    } }, 'Save');
    const lots = (cr.lots || []).map(l => line(l.expired ? '#e5e7eb' : (n0(l.days_left) <= 14 ? '#f59e0b' : '#10b981'), l.label, usd(l.usd),
      l.expired ? 'expired ' + l.expires_on : l.days_left + 'd left · ' + l.expires_on, l.expired ? 'muted' : ''));
    const soon = (cr.expiring_soon || []).map(l => usd(l.usd, 0) + ' expires ' + l.expires_on + ' (' + l.days_left + 'd)').join(' · ');
    const asOf = cr.balance_at ? String(cr.balance_at).slice(0, 10) : null;
    return el('div', null, [
      el('div', { class: 'cc-brain-sphead sub' }, [el('span', null, 'Claude credit'),
        el('b', null, est == null ? 'balance not set' : '~' + usd(est) + ' left' + (cr.below_reserve ? ' · below reserve' : ''))]),
      el('div', { class: 'cc-brain-lines' }, [
        line(null, 'Console balance' + (asOf ? ' (typed ' + asOf + ')' : ''), cr.balance_usd == null ? '—' : usd(cr.balance_usd), ''),
        line(null, 'Spent since then (this database)', usd(cr.spent_since), ''),
        n0(cr.lots_expired) ? line(null, 'Credits expired since then', '−' + usd(cr.lots_expired), '', 'muted') : null,
        n0(cr.lots_added) ? line(null, 'Credits added since then', '+' + usd(cr.lots_added), '') : null,
        line(null, 'This month (UTC)', usd(cr.month_to_date), ''),
      ].filter(Boolean).concat(lots)),
      soon ? el('small', { class: 'cc-brain-muted' }, 'Use it or lose it: ' + soon + '. After an expiry, re-type the Console balance.') : null,
      el('div', { class: 'cc-brain-ctl' }, [el('div', null, [el('b', null, 'Console balance'), el('small', null, 'Copy it from Console → Billing. Prepaid: no billing cycle.')]),
        el('div', { class: 'cc-brain-capbox' }, [el('span', null, '$'), balInput, balBtn])]),
      el('div', { class: 'cc-brain-ctl' }, [el('div', null, [el('b', null, 'Reserve'), el('small', null, 'At or below it every Claude job stops: chat → Gemini, load-mail → its non-Claude path.')]),
        el('div', { class: 'cc-brain-capbox' }, [el('span', null, '$'), resInput, resBtn])]),
    ]);
  }

  /* ---- right column: KPIs, live jobs, recent actions */
  function paintRight(o) {
    const c = o.counts || {}, live = o.live || [], acts = (o.actions || []).slice(0, 12);
    mount(rightHost, [
      el('div', { class: 'cc-kpi-grid cc-brain-kpis' }, [
        statCard({ icon: 'zap', label: 'Done today', value: String(c.done_today || 0), sub: (c.failed_today || 0) + ' failed · ' + (c.skipped_today || 0) + ' skipped / capped', to: '#/ai-brain-jobs' }),
        statCard({ icon: 'flag', label: 'Escalated to a person', value: String(c.escalated_today || 0), sub: 'today', to: '#/ai-brain-jobs?status=done' }),
        statCard({ icon: 'clock', label: 'Avg answer', value: c.avg_secs != null ? secs(c.avg_secs) : '—', sub: 'queued → done, today' }),
        statCard({ icon: 'activity', label: 'Findings open', value: String(o.open_findings || 0), sub: 'bugs, KB gaps, ideas', to: '#/ai-brain-findings', accent: n0(o.open_findings) ? 'amber' : '' }),
      ]),
      el('div', { class: 'lb-card cc-brain-list' }, [
        el('h3', null, ['Running now', el('span', { class: 'cc-brain-count' }, String(live.length))]),
        live.length ? live.map(j => el('div', { class: 'cc-brain-row', onClick: () => openJob(j.id) }, [
          el('i', { class: 'cc-brain-sw', style: 'background:' + srcOf(j.source).c }),
          el('div', null, [el('b', null, srcOf(j.source).label + ' · ' + j.route), el('small', null, j.question || '')]),
          pill(j.status, STATUS_TONE[j.status]), el('small', { class: 'cc-brain-when' }, ago(j.created_at)),
        ])) : el('p', { class: 'cc-brain-muted' }, 'Nothing in flight. Jobs usually finish in 5–30 seconds.'),
      ]),
      el('div', { class: 'lb-card cc-brain-list' }, [
        el('h3', null, ['What the brain just did', el('span', { class: 'cc-brain-count' }, String(acts.length))]),
        acts.length ? acts.map(a => el('div', { class: 'cc-brain-row', onClick: () => openJob(a.job_id) }, [
          el('i', { class: 'cc-brain-sw', style: 'background:' + srcOf(a.source).c }),
          el('div', null, [el('b', null, a.tool.replace(/_/g, ' ') + (a.outcome && a.outcome !== 'executed' ? ' · ' + a.outcome : '')), el('small', null, a.summary || (a.error ? 'error: ' + a.error : ''))]),
          a.ok === false ? pill('failed', 'red') : null, el('small', { class: 'cc-brain-when' }, ago(a.created_at)),
        ].filter(Boolean))) : el('p', { class: 'cc-brain-muted' }, 'No tool calls yet.'),
      ]),
    ]);
  }
}

/* ================================================================== JOBS */
function renderJobs(host, q) {
  const F = { source: q.get('source') || '', status: q.get('status') || '' };
  const bar = el('div', { class: 'cc-toolbar cc-brain-toolbar' });
  const listHost = el('div');
  mount(host, el('div', { class: 'cc-brain' }, [
    sectionHead('Jobs', 'Every question the brain was asked, what it cost, what it called, how sure it was. Click a row for the full answer and every tool call.'),
    bar, listHost,
  ]));
  const sel = (name, opts, cur, onPick) => el('select', { class: 'lb-input', onChange: (e) => onPick(e.target.value) },
    [el('option', { value: '' }, name)].concat(opts.map(o => el('option', { value: o[0], selected: o[0] === cur ? '' : null }, o[1]))));
  mount(bar, [
    sel('All sources', Object.keys(SRC).map(k => [k, SRC[k].label]), F.source, (v) => { F.source = v; load(); }),
    sel('All statuses', ['done', 'failed', 'running', 'queued', 'capped', 'skipped'].map(s => [s, s]), F.status, (v) => { F.status = v; load(); }),
    el('button', { class: 'lb-btn lb-btn-sm', onClick: () => load() }, 'Refresh'),
  ]);
  let timer = setInterval(() => { if (!host.isConnected) { clearInterval(timer); return; } load(true); }, REFRESH_MS);
  async function load(silent) {
    if (!silent) showLoading(listHost, 'Loading jobs…');
    let rows; try { rows = await ccBrainJobs(120, F.source || null, F.status || null); } catch (e) { if (!silent) showError(listHost, humanizeError(e), () => load()); return; }
    if (!Array.isArray(rows) || !rows.length) { mount(listHost, el('div', { class: 'lb-state lb-empty' }, 'No jobs match.')); return; }
    const tbl = el('table', { class: 'cc-table cc-brain-jobs' }, [
      el('thead', null, el('tr', null, ['When', 'Source · route', 'Status', 'Question', 'Sure', 'Tools', 'Tokens in / cache / out', 'Cost', 'Time'].map(h => el('th', null, h)))),
      el('tbody', null, rows.map(j => el('tr', { class: 'cc-brain-jr', onClick: () => openJob(j.id) }, [
        el('td', { title: fmtDateTime(j.created_at) }, ago(j.created_at)),
        el('td', null, [el('i', { class: 'cc-brain-sw', style: 'background:' + srcOf(j.source).c }), srcOf(j.source).label + ' · ' + j.route]),
        el('td', null, [pill(j.status, STATUS_TONE[j.status]), j.escalate ? el('small', { class: 'cc-brain-esc' }, ' → person') : null]),
        el('td', { class: 'cc-brain-q' }, j.question || (j.error ? el('span', { class: 'cc-brain-bad' }, j.error) : '')),
        el('td', null, conf(j.confidence)),
        el('td', null, String(j.tool_calls || 0)),
        el('td', { class: 'cc-brain-num' }, fmtK(j.input) + ' / ' + fmtK(j.cache_read) + ' / ' + fmtK(j.output)),
        el('td', { class: 'cc-brain-num' }, usd(j.usd, 3)),
        el('td', { class: 'cc-brain-num' }, j.secs != null ? secs(j.secs) : '—'),
      ]))),
    ]);
    mount(listHost, tbl);
  }
  load();
}

/* ================================================================== CHATS (bl_brain_0479) */
// Every live-chat answer the brain gave, next to the conversation it was given in: who asked, which desk
// answered (the [[as:<desk>]] tag → a name), what it cost, and whether a person has since taken over.
const DESK = { general: 'Riley', billing: 'Sara', onboarding: 'Omar', tech: 'Ali', sales: 'Maya', dispatch: 'Daniel' };
function renderChats(host) {
  const sumHost = el('div', { class: 'cc-brain-chatsum' });
  const listHost = el('div');
  mount(host, el('div', { class: 'cc-brain' }, [
    sectionHead('Chats', 'Every live-chat reply the AI wrote — who asked, which desk answered, what it cost, and whether a person took over. Click a row for the full answer; "Open chat" jumps to the conversation.'),
    el('div', { class: 'cc-toolbar cc-brain-toolbar' }, [el('button', { class: 'lb-btn lb-btn-sm', onClick: () => load() }, 'Refresh')]),
    sumHost, listHost,
  ]));
  let timer = setInterval(() => { if (!host.isConnected) { clearInterval(timer); return; } load(true); }, REFRESH_MS);
  const who = (r) => (r.name && String(r.name).trim()) || (r.email && String(r.email).trim()) || (r.origin === 'website' ? 'Website visitor' : (r.origin ? r.origin + ' visitor' : 'Visitor'));
  const now = (r) => !r.conv_id ? pill('no chat', 'gray') : r.conv_status !== 'open' ? pill('closed', 'gray') : r.human ? pill('person took over', 'amber') : pill('AI handling', 'blue');
  async function load(silent) {
    if (!silent) showLoading(listHost, 'Loading chats…');
    let rows; try { rows = await ccBrainChats(200); } catch (e) { if (!silent) showError(listHost, humanizeError(e), () => load()); return; }
    if (!Array.isArray(rows) || !rows.length) { mount(sumHost, null); mount(listHost, el('div', { class: 'lb-state lb-empty' }, 'The AI has not answered a live chat yet.')); return; }
    const convs = new Set(rows.map(r => r.conv_id).filter(Boolean));
    const cost = rows.reduce((a, r) => a + n0(r.usd), 0);
    const esc = rows.filter(r => r.escalate).length, human = rows.filter(r => r.human).length;
    mount(sumHost, el('div', { class: 'cc-brain-kvs' }, [
      ['Replies', String(rows.length)], ['Conversations', String(convs.size)], ['Cost', usd(cost, 2) + ' · ' + usd(cost / rows.length, 3) + ' per reply'],
      ['Handed to a person', esc + ' by the AI · ' + human + ' chats now with a person'],
    ].map(m => el('div', { class: 'cc-brain-kv' }, [el('u', null, m[0]), el('b', null, m[1])]))));
    const tbl = el('table', { class: 'cc-table cc-brain-jobs cc-brain-chats' }, [
      el('thead', null, el('tr', null, ['When', 'Visitor', 'Desk', 'Question', 'Answer', 'Now', 'Model', 'Cost', 'Time', ''].map(h => el('th', null, h)))),
      el('tbody', null, rows.map(r => el('tr', { class: 'cc-brain-jr', onClick: () => openJob(r.id) }, [
        el('td', { title: fmtDateTime(r.created_at) }, ago(r.created_at)),
        el('td', null, [el('b', null, who(r)), el('br'), el('small', { class: 'cc-brain-muted' }, [r.visitor_role || 'unknown role', r.page ? ' · ' + r.page : ''].join(''))]),
        el('td', null, r.desk ? [el('b', null, DESK[r.desk] || r.desk), el('br'), el('small', { class: 'cc-brain-muted' }, r.desk)] : el('span', { class: 'cc-brain-muted' }, '—')),
        el('td', { class: 'cc-brain-q' }, r.question || (r.error ? el('span', { class: 'cc-brain-bad' }, r.error) : '')),
        el('td', { class: 'cc-brain-q' }, [r.escalate ? el('small', { class: 'cc-brain-esc' }, '→ person · ') : null, (r.reply || '').replace(/<[^>]+>/g, ' ').slice(0, 160) || (r.status === 'done' ? '—' : r.status)]),
        el('td', null, now(r)),
        el('td', null, el('small', null, (r.model || '—').replace(/^claude-/, ''))),
        el('td', { class: 'cc-brain-num' }, usd(r.usd, 3)),
        el('td', { class: 'cc-brain-num' }, r.secs != null ? secs(r.secs) : '—'),
        el('td', null, r.conv_id ? el('a', { class: 'lb-btn lb-btn-sm', href: '#/live-chat?id=' + r.conv_id, onClick: (e) => e.stopPropagation() }, 'Open chat') : null),
      ]))),
    ]);
    mount(listHost, tbl);
  }
  load();
}

async function openJob(id) {
  const body = el('div'); showLoading(body, 'Loading job #' + id + '…');
  const d = openDrawer('Job #' + id, body, { size: 'lg' });
  let r; try { r = await ccBrainJob(id); } catch (e) { showError(body, humanizeError(e)); return; }
  const j = r && r.job; if (!j) { showError(body, 'Not found'); return; }
  mount(body, [jobResultCard(j, r.actions || []), r.findings && r.findings.length ? el('div', { class: 'cc-brain-sub' }, [el('h4', null, 'Findings filed by this job'), r.findings.map(f => findingCard(f, null))]) : null,
    el('details', { class: 'cc-brain-raw' }, [el('summary', null, 'What the model was given (context)'), el('pre', null, JSON.stringify(j.context || {}, null, 2))])]);
  return d;
}

function jobResultCard(j, actions) {
  const res = j.result || {};
  const meta = [
    ['Source', srcOf(j.source).label + ' · ' + j.route], ['Status', j.status], ['Model', j.model || '—'], ['Effort', j.effort || '—'],
    ['Confidence', conf(res.confidence)], ['Escalate', res.escalate ? 'yes — ' + (res.escalate_reason || '') : 'no'],
    ['Tokens', fmtK(j.input_tokens ?? j.input) + ' in · ' + fmtK(j.cache_read) + ' cache · ' + fmtK(j.cache_write) + ' cache-write · ' + fmtK(j.output_tokens ?? j.output) + ' out'],
    ['Cost', usd(j.usd, 4)], ['Time', j.secs != null ? secs(j.secs) : (j.done_at ? secs((new Date(j.done_at) - new Date(j.created_at)) / 1000) : 'running')],
    ['Asked', fmtDateTime(j.created_at)],
  ];
  return el('div', { class: 'cc-brain-job' }, [
    el('div', { class: 'cc-brain-kvs' }, meta.map(m => el('div', { class: 'cc-brain-kv' }, [el('u', null, m[0]), el('b', null, m[1])]))),
    el('h4', null, 'Question'), el('div', { class: 'cc-brain-quote' }, j.question || '—'),
    j.error ? [el('h4', null, 'Error'), el('div', { class: 'cc-brain-bad' }, j.error)] : null,
    res.reply != null ? [el('h4', null, 'Answer'), el('div', { class: 'cc-brain-quote ans' }, res.reply)] : null,
    Array.isArray(res.actions) && res.actions.length ? [el('h4', null, 'What it says it did'), el('ul', { class: 'cc-brain-ul' }, res.actions.map(a => el('li', null, String(a))))] : null,
    el('h4', null, 'Tool calls (' + actions.length + ')'),
    actions.length ? actions.map(a => el('details', { class: 'cc-brain-act' }, [
      el('summary', null, [pill(a.outcome || 'executed', a.ok === false ? 'red' : a.outcome === 'denied' ? 'red' : a.outcome === 'prepared' ? 'amber' : 'green'), el('b', null, a.tool), el('small', null, (a.ms != null ? a.ms + ' ms · ' : '') + fmtK(a.bytes) + ' B')]),
      el('pre', null, 'input:  ' + JSON.stringify(a.payload || {}, null, 1) + '\n\nresult: ' + JSON.stringify(a.result || {}, null, 1).slice(0, 4000)),
    ])) : el('p', { class: 'cc-brain-muted' }, 'Answered without tools.'),
  ]);
}

/* ================================================================== PERMISSIONS */
function renderPermissions(host) {
  const listHost = el('div');
  const addBtn = el('button', { class: 'lb-btn lb-btn-primary lb-btn-sm', onClick: () => openPermEdit(null, load) }, '+ Add a rule or source');
  mount(host, el('div', { class: 'cc-brain' }, [
    sectionHead('Permissions', 'Three switches the brain cannot get around: which sources it works on, which tools it may call (auto = does it, prep = prepares for you), and rules it must never break. Every flip is logged.', [addBtn]),
    listHost,
  ]));
  async function load() {
    showLoading(listHost, 'Loading…');
    let o; try { o = await ccBrainOverview(); } catch (e) { showError(listHost, humanizeError(e), load); return; }
    const perms = o.permissions || [];
    const groups = ['source', 'tool', 'rule'].map(kind => {
      const rows = perms.filter(p => p.kind === kind);
      return el('div', { class: 'lb-card cc-brain-permgrp' }, [
        el('h3', null, KIND_LABEL[kind]),
        rows.length ? rows.map(p => permRow(p, load)) : el('p', { class: 'cc-brain-muted' }, 'None yet.'),
      ]);
    });
    mount(listHost, groups);
  }
  load();
}

function permRow(p, reload) {
  const usage = p.kind === 'source'
    ? (p.today || 0) + ' today · ' + (p.week || 0) + ' this week · ' + usd(p.usd_today) + ' today' + (p.failed_7d ? ' · ' + p.failed_7d + ' failed' : '') + (p.skipped_7d ? ' · ' + p.skipped_7d + ' capped' : '')
    : p.kind === 'tool' ? (p.today || 0) + ' today · ' + (p.week || 0) + ' this week' + (p.denied_7d ? ' · ' + p.denied_7d + ' denied' : '') + (p.prepared_7d ? ' · ' + p.prepared_7d + ' prepared' : '') + (p.avg_ms != null ? ' · ' + p.avg_ms + ' ms avg' : '')
    : (p.enabled ? 'enforced in every prompt' : 'not enforced');
  const caps = [p.max_per_job != null ? p.max_per_job + '/job' : null, p.max_per_day != null ? p.max_per_day + '/day' : null, p.usd_cap_daily != null ? usd(p.usd_cap_daily, 0) + '/day' : null].filter(Boolean).join(' · ');
  const input = el('input', { type: 'checkbox', checked: !!p.enabled, disabled: p.status === 'planned' && p.kind === 'tool' ? '' : null, onChange: async (e) => {
    const on = e.target.checked;
    if (on && p.risk === 'high' && !(await askConfirm('Switch on "' + p.label + '"?', { body: 'This is a high-risk permission: ' + (p.description || ''), confirmLabel: 'Switch on' }))) { e.target.checked = false; return; }
    if (!on && p.key === 'tool.escalate' && !(await askConfirm('Switch off escalation?', { body: 'Escalate is the safe exit — with it off the brain cannot hand a chat to a person.', confirmLabel: 'Switch off anyway', danger: true }))) { e.target.checked = true; return; }
    try { await ccBrainPermSet(p.key, { enabled: on, reason: 'CC → AI Brain → Permissions' }); toast((on ? 'On: ' : 'Off: ') + p.label); reload(); }
    catch (e2) { e.target.checked = !on; toast(humanizeError(e2), 'error'); }
  } });
  return el('div', { class: 'cc-brain-perm' + (p.enabled ? '' : ' off') }, [
    el('label', { class: 'cc-switch', title: p.status === 'planned' ? 'Planned — the code behind this is not built yet' : p.key }, [input, el('span', { class: 'track' })]),
    el('div', { class: 'cc-brain-permbody' }, [
      el('div', { class: 'cc-brain-permhead' }, [
        el('b', null, p.label),
        pill(p.risk + ' risk', RISK_TONE[p.risk]),
        p.kind === 'tool' ? pill(p.mode === 'auto' ? 'auto' : p.mode === 'prep' ? 'prepares only' : p.mode, p.mode === 'auto' ? 'blue' : 'amber') : null,
        p.status === 'planned' ? pill('planned', 'gray') : null,
        !p.builtin ? pill('custom', 'violet') : null,
        el('code', { class: 'cc-brain-key' }, p.key),
      ].filter(Boolean)),
      el('p', null, p.description || ''),
      el('small', { class: 'cc-brain-muted' }, usage + (caps ? ' · caps ' + caps : '') + (p.sources ? ' · only for ' + p.sources.join(', ') : '') + (p.note ? ' · note: ' + p.note : '')),
    ]),
    el('div', { class: 'cc-brain-permacts' }, [
      el('button', { class: 'lb-btn lb-btn-sm', onClick: () => openPermEdit(p, reload) }, 'Edit'),
      !p.builtin ? el('button', { class: 'lb-btn lb-btn-sm', onClick: async () => {
        if (!(await askConfirm('Delete "' + p.label + '"?', { body: 'Custom permissions can be deleted; built-in ones can only be switched off.', confirmLabel: 'Delete', danger: true }))) return;
        try { await ccBrainPermDelete(p.key); toast('Deleted'); reload(); } catch (e) { toast(humanizeError(e), 'error'); }
      } }, 'Delete') : null,
    ].filter(Boolean)),
  ]);
}

function openPermEdit(p, reload) {
  const isNew = !p;
  const f = (label, node, hint) => el('label', { class: 'cc-brain-f' }, [el('span', null, label), node, hint ? el('small', null, hint) : null]);
  const kind = el('select', { class: 'lb-input' }, [['rule', 'Rule (something it must never do)'], ['source', 'Source (a place it may work)'], ['tool', 'Tool (an action it may take)']].map(o => el('option', { value: o[0] }, o[1])));
  const name = el('input', { class: 'lb-input', placeholder: 'short_key_like_this', value: p ? p.name : '' , disabled: p ? '' : null });
  const label = el('input', { class: 'lb-input', value: p ? p.label : '' });
  const desc = el('textarea', { class: 'lb-input', rows: '3' }, p ? (p.description || '') : '');
  const mode = el('select', { class: 'lb-input' }, [['auto', 'auto — does it'], ['prep', 'prep — prepares, a person confirms'], ['deny', 'deny — never']].map(o => el('option', { value: o[0], selected: p && p.mode === o[0] ? '' : null }, o[1])));
  const risk = el('select', { class: 'lb-input' }, ['low', 'medium', 'high'].map(r => el('option', { value: r, selected: p && p.risk === r ? '' : null }, r)));
  const mpj = el('input', { class: 'lb-input', type: 'number', min: '0', value: p && p.max_per_job != null ? p.max_per_job : '' });
  const mpd = el('input', { class: 'lb-input', type: 'number', min: '0', value: p && p.max_per_day != null ? p.max_per_day : '' });
  const cap = el('input', { class: 'lb-input', type: 'number', min: '0', step: '0.5', value: p && p.usd_cap_daily != null ? p.usd_cap_daily : '' });
  const sources = el('input', { class: 'lb-input', placeholder: 'chat, email (blank = every source)', value: p && p.sources ? p.sources.join(', ') : '' });
  const note = el('input', { class: 'lb-input', value: p ? (p.note || '') : '' });
  const reason = el('input', { class: 'lb-input', placeholder: 'Why (goes in the change log)' });
  const save = el('button', { class: 'lb-btn lb-btn-primary', onClick: async () => {
    const patch = { mode: mode.value, risk: risk.value, max_per_job: mpj.value === '' ? '' : Number(mpj.value), max_per_day: mpd.value === '' ? '' : Number(mpd.value),
      usd_cap_daily: cap.value === '' ? '' : Number(cap.value), sources: sources.value.trim() ? sources.value.split(',').map(s => s.trim()).filter(Boolean) : null,
      note: note.value, reason: reason.value || (isNew ? 'CC add' : 'CC edit') };
    try {
      if (isNew) await ccBrainPermAdd(kind.value, name.value.trim(), label.value.trim(), desc.value.trim(), patch);
      else await ccBrainPermSet(p.key, Object.assign(patch, { label: label.value.trim(), description: desc.value.trim() }));
      toast(isNew ? 'Added' : 'Saved'); d.close(); reload();
    } catch (e) { toast(humanizeError(e), 'error'); }
  } }, isNew ? 'Add' : 'Save');
  const d = openDrawer(isNew ? 'Add a permission' : 'Edit ' + p.label, el('div', { class: 'cc-brain-form' }, [
    isNew ? f('Kind', kind) : null,
    f('Key', name, isNew ? 'Letters, digits, underscore. Becomes kind.key' : 'Keys do not change'),
    f('Label', label), f('Description', desc, 'Rules are put into every prompt word for word — write them as an instruction.'),
    (isNew || p.kind === 'tool') ? f('Mode', mode) : null, f('Risk', risk),
    el('div', { class: 'cc-brain-f3' }, [f('Max per job', mpj), f('Max per day', mpd), f('$ cap per day', cap)]),
    f('Only for sources', sources), f('Note', note), f('Reason', reason),
    el('div', { class: 'cc-brain-tryrow' }, [save, el('button', { class: 'lb-btn', onClick: () => d.close() }, 'Cancel')]),
  ].filter(Boolean)), { size: 'md', subtitle: isNew ? 'A rule is the fastest way to stop a behaviour you saw in a job' : p.key });
}

/* ================================================================== FINDINGS */
function renderFindings(host, q) {
  let status = q.get('status') || 'open';
  const seg = el('div', { class: 'cc-brain-seg' });
  const listHost = el('div');
  mount(host, el('div', { class: 'cc-brain' }, [
    sectionHead('Findings', 'What the brain noticed while working: bugs it hit, questions the knowledge base could not answer, portal and growth ideas — each with evidence and a suggested fix.'),
    seg, listHost,
  ]));
  function paintSeg() {
    mount(seg, [['open', 'Open'], ['accepted', 'Accepted'], ['done', 'Done'], ['dismissed', 'Dismissed'], ['', 'All']].map(o =>
      el('button', { class: 'cc-brain-segb' + (o[0] === status ? ' on' : ''), onClick: () => { status = o[0]; paintSeg(); load(); } }, o[1])));
  }
  async function load() {
    showLoading(listHost, 'Loading…');
    let rows; try { rows = await ccBrainFindings(status || null, 200); } catch (e) { showError(listHost, humanizeError(e), load); return; }
    if (!Array.isArray(rows) || !rows.length) { mount(listHost, el('div', { class: 'lb-state lb-empty' }, status === 'open' ? 'Nothing open. The brain files a finding when it hits a bug, a KB gap or has an idea.' : 'Nothing here.')); return; }
    mount(listHost, rows.map(f => findingCard(f, load)));
  }
  paintSeg(); load();
}

function findingCard(f, reload) {
  const act = (label, st, cls) => el('button', { class: 'lb-btn lb-btn-sm ' + (cls || ''), onClick: async () => {
    try { await ccBrainFindingSet(f.id, st); toast(label); if (reload) reload(); } catch (e) { toast(humanizeError(e), 'error'); }
  } }, label);
  const acts = [];
  if (reload) {
    if (f.status !== 'accepted' && f.status !== 'done') acts.push(act('Accept', 'accepted', 'lb-btn-primary'));
    if (f.status !== 'done') acts.push(act('Done', 'done'));
    if (f.status !== 'dismissed') acts.push(act('Dismiss', 'dismissed'));
    if (f.status !== 'open') acts.push(act('Reopen', 'open'));
  }
  return el('div', { class: 'lb-card cc-brain-finding' }, [
    el('div', { class: 'cc-brain-permhead' }, [pill(FINDING_KIND[f.kind] || f.kind, f.kind === 'bug' ? 'red' : f.kind === 'kb_gap' ? 'amber' : 'blue'), el('b', null, f.title),
      f.surface ? el('small', { class: 'cc-brain-muted' }, f.surface) : null, pill(f.status, f.status === 'open' ? 'amber' : f.status === 'done' ? 'green' : 'gray'),
      el('small', { class: 'cc-brain-when' }, ago(f.created_at) + (f.job_id ? ' · ' : '')), f.job_id ? el('a', { href: '#', onClick: (e) => { e.preventDefault(); openJob(f.job_id); } }, 'job #' + f.job_id) : null].filter(Boolean)),
    f.detail ? el('p', null, f.detail) : null,
    f.evidence ? el('div', { class: 'cc-brain-quote' }, typeof f.evidence === 'string' ? f.evidence : JSON.stringify(f.evidence)) : null,
    f.suggested_fix ? el('p', null, [el('b', null, 'Suggested fix: '), f.suggested_fix]) : null,
    acts.length ? el('div', { class: 'cc-brain-tryrow' }, acts) : null,
  ].filter(Boolean));
}

/* ================================================================== FACTS */
function renderFacts(host) {
  const listHost = el('div');
  mount(host, el('div', { class: 'cc-brain' }, [
    sectionHead('Facts', 'The registry the brain quotes from — fees, verification, accessorial standards, the contact line. Edit here and every next answer uses the new value; no deploy.'),
    listHost,
  ]));
  async function load() {
    showLoading(listHost, 'Loading…');
    let rows; try { rows = await ccBrainFacts(); } catch (e) { showError(listHost, humanizeError(e), load); return; }
    if (!Array.isArray(rows) || !rows.length) { mount(listHost, el('div', { class: 'lb-state lb-empty' }, 'No facts yet.')); return; }
    mount(listHost, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, ['Key', 'Value', 'Source', 'As of', 'Note', ''].map(h => el('th', null, h)))),
      el('tbody', null, rows.map(f => el('tr', null, [
        el('td', null, el('code', { class: 'cc-brain-key' }, f.key)), el('td', { class: 'cc-brain-val' }, f.value + (f.unit ? ' ' + f.unit : '')),
        el('td', null, f.source || '—'), el('td', null, f.as_of || (f.updated_at ? fmtDateTime(f.updated_at) : '—')), el('td', null, f.note || ''),
        el('td', null, el('button', { class: 'lb-btn lb-btn-sm', onClick: () => edit(f) }, 'Edit')),
      ]))),
    ]));
  }
  function edit(f) {
    const val = el('textarea', { class: 'lb-input', rows: '4' }, f.value || '');
    const note = el('input', { class: 'lb-input', value: f.note || '', placeholder: 'Why it changed (optional)' });
    const save = el('button', { class: 'lb-btn lb-btn-primary', onClick: async () => {
      try { await ccBrainFactSet(f.key, val.value.trim(), note.value.trim() || null); toast('Saved — next answers use it'); d.close(); load(); } catch (e) { toast(humanizeError(e), 'error'); }
    } }, 'Save');
    const d = openDrawer('Edit fact', el('div', { class: 'cc-brain-form' }, [
      el('label', { class: 'cc-brain-f' }, [el('span', null, 'Key'), el('code', { class: 'cc-brain-key' }, f.key)]),
      el('label', { class: 'cc-brain-f' }, [el('span', null, 'Value'), val]),
      el('label', { class: 'cc-brain-f' }, [el('span', null, 'Note'), note]),
      el('div', { class: 'cc-brain-tryrow' }, [save, el('button', { class: 'lb-btn', onClick: () => d.close() }, 'Cancel')]),
    ]), { size: 'md', subtitle: 'Quoted word for word in every prompt' });
  }
  load();
}

/* ================================================================== LOG */
function renderLog(host) {
  const listHost = el('div');
  mount(host, el('div', { class: 'cc-brain' }, [sectionHead('Change log', 'Who flipped what, and when. Config changes, permission flips, finding status changes.'), listHost]));
  (async () => {
    showLoading(listHost, 'Loading…');
    let rows; try { rows = await ccBrainPermLog(200); } catch (e) { showError(listHost, humanizeError(e)); return; }
    if (!Array.isArray(rows) || !rows.length) { mount(listHost, el('div', { class: 'lb-state lb-empty' }, 'No changes yet.')); return; }
    mount(listHost, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, ['When', 'What', 'Action', 'Change', 'By', 'Note'].map(h => el('th', null, h)))),
      el('tbody', null, rows.map(l => el('tr', null, [
        el('td', { title: fmtDateTime(l.created_at) }, ago(l.created_at)), el('td', null, el('code', { class: 'cc-brain-key' }, l.key)), el('td', null, l.action),
        el('td', { class: 'cc-brain-diff' }, diffText(l.before, l.after)), el('td', null, l.by_email || (l.by_user ? String(l.by_user).slice(0, 8) : 'system')), el('td', null, l.note || ''),
      ]))),
    ]));
  })();
}

function diffText(b, a) {
  if (!b && a) return 'created';
  if (b && !a) return 'removed';
  const out = [];
  try {
    const keys = new Set(Object.keys(a || {}).concat(Object.keys(b || {})));
    keys.forEach(k => { if (k === 'updated_at') return; const x = JSON.stringify((b || {})[k]), y = JSON.stringify((a || {})[k]); if (x !== y) out.push(k + ': ' + (x == null ? '∅' : x) + ' → ' + (y == null ? '∅' : y)); });
  } catch (_) { /* fall through */ }
  return out.length ? out.join(' · ').slice(0, 400) : '—';
}

/* ================================================================== CSS */
function injectStyleOnce() {
  if (document.getElementById('cc-brain-style')) return;
  document.head.appendChild(el('style', { id: 'cc-brain-style' }, `
.cc-brain{display:flex;flex-direction:column;gap:14px}
.cc-brain .lb-card{padding:16px 18px}
.cc-brain h3{font-size:.98rem;margin:0 0 10px;display:flex;align-items:center;gap:8px}
.cc-brain h4{font-size:.8rem;text-transform:uppercase;letter-spacing:.06em;color:var(--lb-muted,#64748b);margin:14px 0 6px}
.cc-brain-muted{color:var(--lb-muted,#64748b);font-size:.86rem;margin:0}
.cc-brain-bad{color:#b91c1c;font-size:.86rem}
.cc-brain-status{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:-6px 0 2px}
.cc-brain-model{display:inline-flex;gap:6px;align-items:center;font-size:.8rem;margin-left:auto}
.cc-brain-model u{text-decoration:none;color:var(--lb-muted,#64748b);font-size:.68rem;text-transform:uppercase;letter-spacing:.06em}
.cc-brain-headgrid{display:grid;grid-template-columns:1.2fr .8fr;gap:14px;align-items:start}
.cc-brain-ctls{display:flex;flex-direction:column}
.cc-brain-ctl{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:10px 0;border-bottom:1px solid var(--lb-border,#e6edf5)}
.cc-brain-ctl:last-child{border-bottom:0;padding-bottom:0}.cc-brain-ctl:first-child{padding-top:0}
.cc-brain-ctl b{display:block;font-size:.92rem}.cc-brain-ctl small{display:block;color:var(--lb-muted,#64748b);font-size:.78rem;margin-top:2px;line-height:1.4}
.cc-brain-capbox{display:flex;align-items:center;gap:6px}.cc-brain-cap{width:84px;text-align:right}
.cc-brain-try textarea{width:100%;margin:8px 0;resize:vertical}
.cc-brain-tryrow{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.cc-brain-lang{width:auto}
.cc-brain-testout{margin-top:10px}
.cc-brain-grid{display:grid;grid-template-columns:minmax(320px,440px) 1fr;gap:14px;align-items:start}
.cc-brain-right{display:flex;flex-direction:column;gap:14px;min-width:0}
.cc-brain-kpis{margin:0}
.cc-brain-spend{font-size:.86rem}
.cc-brain-sphead{display:flex;justify-content:space-between;align-items:baseline;gap:10px;font-weight:700;font-size:.95rem;margin-bottom:8px}
.cc-brain-sphead.sub{margin-top:16px;padding-top:12px;border-top:1px solid var(--lb-border,#e6edf5);font-size:.86rem}
.cc-brain-sphead b{font-variant-numeric:tabular-nums;color:var(--lb-muted,#64748b);font-weight:600}
.cc-brain-stack{display:flex;height:6px;border-radius:99px;background:#e9edf3;overflow:hidden;gap:2px;margin:2px 0 10px}
.cc-brain-stack i{display:block;height:100%;border-radius:2px;min-width:2px}
.cc-brain-lines{display:flex;flex-direction:column}
.cc-brain-line{display:grid;grid-template-columns:12px 1fr auto 52px;gap:10px;align-items:center;padding:4px 0;line-height:1.3}
.cc-brain-line.muted{color:var(--lb-muted,#64748b)}
.cc-brain-sw{display:inline-block;width:10px;height:10px;border-radius:3px;flex-shrink:0;vertical-align:-1px;margin-right:6px}
.cc-brain-line .cc-brain-sw{margin:0}.cc-brain-sw.none{background:transparent;border:1px solid #cbd5e1}
.cc-brain-lv,.cc-brain-lp{font-variant-numeric:tabular-nums;text-align:right}.cc-brain-lv{color:var(--lb-muted,#64748b)}.cc-brain-lp{font-weight:600}
.cc-brain-lims{display:flex;flex-direction:column;gap:9px}
.cc-brain-limhead{display:flex;justify-content:space-between;gap:10px;margin-bottom:4px}.cc-brain-limhead small{color:var(--lb-muted,#64748b)}
.cc-brain-limv{font-variant-numeric:tabular-nums;color:var(--lb-muted,#64748b);white-space:pre}
.cc-brain-track{height:6px;border-radius:99px;background:#e9edf3;overflow:hidden}
.cc-brain-fill{display:block;height:100%;border-radius:99px;background:#0883F7;transition:width .3s}.cc-brain-fill.warn{background:#f59e0b}.cc-brain-fill.bad{background:#dc2626}
.cc-brain-days{display:flex;gap:6px;align-items:flex-end;height:64px;padding-top:4px}
.cc-brain-day{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;gap:3px}
.cc-brain-day i{display:block;width:100%;max-width:26px;background:#0883F7;border-radius:4px 4px 2px 2px;opacity:.85}.cc-brain-day small{font-size:.66rem;color:var(--lb-muted,#64748b)}
.cc-brain-list .cc-brain-count{font-size:.72rem;background:#eef2f7;color:#334155;border-radius:999px;padding:1px 8px;font-weight:800}
.cc-brain-row{display:grid;grid-template-columns:12px 1fr auto auto;gap:10px;align-items:center;padding:8px 0;border-top:1px solid var(--lb-border,#e6edf5);cursor:pointer;min-width:0}
.cc-brain-row:first-of-type{border-top:0}.cc-brain-row:hover b{color:var(--lb-blue,#0883F7)}
.cc-brain-row b{display:block;font-size:.86rem}.cc-brain-row small{display:block;color:var(--lb-muted,#64748b);font-size:.78rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cc-brain-when{white-space:nowrap;color:var(--lb-muted,#64748b);font-size:.76rem}
.cc-brain-toolbar{gap:8px;flex-wrap:wrap}.cc-brain-toolbar select{width:auto}
.cc-brain-jobs td{vertical-align:top}.cc-brain-jr{cursor:pointer}.cc-brain-jr:hover td{background:rgba(8,131,247,.05)}
.cc-brain-q{max-width:360px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cc-brain-num{font-variant-numeric:tabular-nums;white-space:nowrap}
.cc-brain-esc{color:#b45309;font-weight:700}
.cc-brain-kvs{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px 14px}
.cc-brain-chatsum{margin:0 0 12px}.cc-brain-chats td{vertical-align:top}
.cc-brain-kv u{display:block;text-decoration:none;font-size:.66rem;text-transform:uppercase;letter-spacing:.06em;color:var(--lb-muted,#64748b)}.cc-brain-kv b{font-size:.86rem;font-weight:600;word-break:break-word}
.cc-brain-quote{background:#f6f8fb;border-left:3px solid #cbd5e1;border-radius:6px;padding:8px 12px;white-space:pre-wrap;font-size:.88rem;line-height:1.5}
.cc-brain-quote.ans{border-left-color:#7c3aed}
.cc-brain-ul{margin:0;padding-left:18px;font-size:.86rem}
.cc-brain-act summary{display:flex;gap:8px;align-items:center;cursor:pointer;font-size:.86rem;padding:6px 0}.cc-brain-act small{color:var(--lb-muted,#64748b)}
.cc-brain-act pre,.cc-brain-raw pre{font-size:.72rem;white-space:pre-wrap;word-break:break-word;background:#f6f8fb;border-radius:6px;padding:8px;max-height:320px;overflow:auto}
.cc-brain-raw{margin-top:14px}.cc-brain-raw summary{cursor:pointer;font-size:.82rem;color:var(--lb-muted,#64748b)}
.cc-brain-permgrp h3{margin-bottom:4px}
.cc-brain-perm{display:grid;grid-template-columns:46px 1fr auto;gap:14px;align-items:start;padding:12px 0;border-top:1px solid var(--lb-border,#e6edf5)}
.cc-brain-perm:first-of-type{border-top:0}.cc-brain-perm.off .cc-brain-permbody{opacity:.72}
.cc-brain-permhead{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.cc-brain-permhead b{font-size:.92rem}
.cc-brain-permbody p{margin:4px 0;font-size:.86rem;line-height:1.5}
.cc-brain-key{font-size:.72rem;background:#f1f5f9;border-radius:4px;padding:1px 6px;color:#475569}
.cc-brain-permacts{display:flex;gap:6px}
.cc-brain-form{display:flex;flex-direction:column;gap:10px}.cc-brain-f{display:flex;flex-direction:column;gap:4px;font-size:.84rem}.cc-brain-f>span{font-weight:700}.cc-brain-f small{color:var(--lb-muted,#64748b)}
.cc-brain-f3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.cc-brain-seg{display:flex;gap:4px;flex-wrap:wrap}.cc-brain-segb{border:1px solid var(--lb-border,#e6edf5);background:#fff;border-radius:999px;padding:5px 12px;font:700 .8rem inherit;cursor:pointer;color:var(--lb-muted,#64748b)}
.cc-brain-segb.on{background:var(--lb-blue,#0883F7);border-color:var(--lb-blue,#0883F7);color:#fff}
.cc-brain-finding p{margin:6px 0;font-size:.88rem;line-height:1.5}
.cc-brain-val{max-width:480px;white-space:pre-wrap}.cc-brain-diff{font-size:.78rem;max-width:420px;word-break:break-word}
.cc-brain-sub{margin-top:12px}
@media (max-width:1100px){.cc-brain-grid,.cc-brain-headgrid{grid-template-columns:1fr}}
@media (max-width:640px){.cc-brain-perm{grid-template-columns:46px 1fr}.cc-brain-permacts{grid-column:2}.cc-brain-f3{grid-template-columns:1fr}.cc-brain-model{margin-left:0}}
`));
}
