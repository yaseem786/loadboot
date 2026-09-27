// Command Center → AI Brain — bl_brain_0472 (27 Sep 2026)
//
// ONE screen for the Claude Ops Brain (plan docs/livechat/LIVECHAT-CLAUDE-BRAIN-PLAN.md): what it is allowed to do,
// when it runs, what it is doing right now, what every action cost, and the switch for each of those.
//   Live         — kill switch, spend vs cap, jobs in flight, the last 40 tool calls as they happen (polls every 5 s).
//   Permissions  — sources (WHEN it runs), tools (WHAT it may do), rules (owner policy lines in the prompt). Every row
//                  has an on/off switch, a mode, caps, and live numbers. New permissions are added from here.
//   Jobs         — every job with tokens, cache hits, USD, tools, latency; open one for the full prompt/answer/actions.
//   Findings     — what the brain filed for the owner (bugs, KB gaps, portal / growth / SEO / ads ideas).
//   Facts        — the facts registry the brain answers from (site.* rows are the Market-rates mirror, read-only here).
//   Settings     — model, effort per route, max tokens, tool budget, daily cap, spot-check window, price table.
//   Log          — who flipped what, before → after.
// Every write is an RPC gated by settings.manage server-side and lands in app_private.brain_permission_log.
// Popups are openDrawer (CLAUDE.md §8). Nothing here contacts a customer.

import { el, mount } from '../../shared/ui/dom.js';
import { icon } from '../../shared/ui/icons.js';
import { sectionHead, openDrawer, askConfirm, barChart, segmented } from '../../shared/ui/components.js';
import { showLoading, showError } from '../../shared/loading.js';
import { humanizeError, toast } from '../../shared/errors.js';
import {
  ccBrainOverview, ccBrainPermSet, ccBrainPermAdd, ccBrainPermDelete, ccBrainConfigSet,
  ccBrainJobs, ccBrainJob, ccBrainFindings, ccBrainFindingSet, ccBrainFacts, ccBrainFactSet, ccBrainTest, ccBrainPermLog,
} from '../../shared/api.js';

const ET = 'America/New_York';
const et = (v) => { if (!v) return '—'; const d = new Date(v); return isNaN(d) ? '—' : d.toLocaleString('en-US', { timeZone: ET, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET'; };
const ago = (v) => { if (!v) return '—'; const s = Math.round((Date.now() - new Date(v).getTime()) / 1000); if (s < 5) return 'just now'; if (s < 60) return s + 's ago'; if (s < 3600) return Math.round(s / 60) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago'; return Math.round(s / 86400) + ' d ago'; };
const num = (n) => Number(n || 0).toLocaleString();
const usd = (n, dp) => '$' + Number(n || 0).toFixed(dp == null ? 4 : dp);
const kb = (b) => { b = Number(b || 0); return b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(2) + ' MB'; };
const mmss = (s) => { s = Math.max(0, Math.round(Number(s || 0))); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const pill = (t, tone) => el('span', { class: 'bp-pill ' + (tone || 'm') }, t);
const mono = (s) => el('code', { class: 'bp-mono' }, s == null ? '' : String(s));
const OUTCOME = { executed: ['executed', 'g'], prepared: ['prepared · not run', 'a'], denied: ['denied', 'r'], error: ['error', 'r'] };
const JOB = { done: 'g', running: 'b', queued: 'b', failed: 'r', skipped: 'm', capped: 'a' };
const RISK = { low: 'm', medium: 'a', high: 'r' };
const KIND = {
  source: { title: 'Sources — WHEN the brain runs', hint: 'Each source is a door. Off = every job from that door is filed as skipped (no API call, no spend). Per-source daily caps on jobs and dollars sit under the global cap.' },
  tool:   { title: 'Tools — WHAT the brain may do', hint: 'Off = the tool is not offered to the model and is refused by name if it asks anyway. Prep = the call is recorded for you, never executed. Planned = the row is ready, the code is not; it cannot be switched on yet.' },
  rule:   { title: 'Rules — owner policy the model reads', hint: 'Each enabled rule is a line in the system prompt ("NEVER …" or "ALLOWED …"). A rule typed here reaches the model on its next job, no deploy. Changing rules re-warms the prompt cache once.' },
};
const SOURCES = ['chat', 'email', 'wa', 'onboarding', 'dispatch', 'sales', 'sweep', 'voice', 'test'];
const ROUTES = ['chat', 'email', 'verdict', 'handoff', 'doc', 'sweep', 'test', 'default'];

const CSS = `
.bp{--n:#10223B;--b:#0883F7;--g:#22c55e;--r:#ef4444;--a:#f59e0b;--mu:#64748b;--ln:#e5e9f2}
.bp-board{border-radius:18px;padding:18px;color:#e8eefc;background:linear-gradient(160deg,#12284a,#0b1830 55%,#08111f);box-shadow:0 18px 50px rgba(8,20,45,.25);margin-bottom:16px}
.bp-board h3{margin:0 0 12px;font-size:12px;letter-spacing:1.4px;text-transform:uppercase;color:#93a4c3;display:flex;align-items:center;gap:8px}
.bp-dot{width:9px;height:9px;border-radius:50%;background:var(--g);box-shadow:0 0 0 0 rgba(34,197,94,.6);animation:bpp 1.6s infinite}.bp-dot.off{background:var(--r);animation:none}
@keyframes bpp{70%{box-shadow:0 0 0 10px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}
.bp-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:14px}
.bp-kpi{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.09);border-radius:14px;padding:12px 14px;min-width:0}
.bp-kpi b{display:block;font-size:22px;font-weight:700;color:#fff;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.bp-kpi span{font-size:11px;color:#93a4c3;text-transform:uppercase;letter-spacing:.8px}.bp-kpi small{display:block;font-size:12px;color:#b8c6e2;margin-top:2px}
.bp-bar{height:7px;border-radius:99px;background:rgba(255,255,255,.12);overflow:hidden;margin-top:8px}.bp-bar i{display:block;height:100%;background:var(--g)}.bp-bar i.warn{background:var(--a)}.bp-bar i.over{background:var(--r)}
.bp-two{display:grid;grid-template-columns:1fr 1fr;gap:14px}@media(max-width:900px){.bp-two{grid-template-columns:1fr}}
.bp-live{display:grid;gap:8px}.bp-lj{border-radius:12px;padding:10px 12px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.09);border-left:3px solid var(--b);cursor:pointer}
.bp-lj .top{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:#93a4c3}.bp-lj .q{font-size:13.5px;color:#fff;margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bp-none{color:#93a4c3;font-size:13.5px;padding:6px 2px}
.bp-feed{display:grid;gap:6px;max-height:520px;overflow:auto}.bp-act{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);font-size:12.5px;cursor:pointer}
.bp-act .t{font-weight:700;color:#fff}.bp-act .s{color:#b8c6e2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bp-act .m{color:#93a4c3;font-variant-numeric:tabular-nums;white-space:nowrap;text-align:right}
.bp-card{background:#fff;border:1px solid var(--ln);border-radius:16px;padding:16px;margin-bottom:16px}
.bp-card h3{margin:0 0 4px;font-size:16px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}.bp-card .hint{color:var(--mu);font-size:13px;margin:0 0 12px;line-height:1.5}
.bp-tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px}.bp-tab{border:1px solid #d8dee9;background:#fff;color:inherit;border-radius:999px;padding:7px 14px;font:inherit;font-weight:600;cursor:pointer;display:inline-flex;gap:6px;align-items:center}
.bp-tab.on{background:var(--n);border-color:var(--n);color:#fff}.bp-tab .n{background:rgba(0,0,0,.08);border-radius:99px;padding:0 7px;font-size:11px}.bp-tab.on .n{background:rgba(255,255,255,.2)}
.bp-pill{display:inline-block;font-size:11px;font-weight:700;padding:2px 9px;border-radius:999px;white-space:nowrap;text-transform:none}
.bp-pill.g{background:rgba(34,197,94,.14);color:#15803d}.bp-pill.r{background:rgba(239,68,68,.13);color:#b91c1c}.bp-pill.a{background:rgba(245,158,11,.16);color:#b45309}.bp-pill.b{background:rgba(8,131,247,.13);color:#0369a1}.bp-pill.m{background:rgba(100,116,139,.15);color:#475569}.bp-pill.v{background:#ede9fe;color:#6d28d9}
.bp-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;background:#f1f5f9;padding:1px 6px;border-radius:6px;color:#334155}
.bp-perm{display:grid;grid-template-columns:auto 1fr auto;gap:14px;align-items:center;padding:13px 0;border-bottom:1px solid var(--ln)}.bp-perm:last-child{border-bottom:0}
.bp-perm.off .k{color:#94a3b8}.bp-perm .k{font-weight:700;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.bp-perm .d{color:var(--mu);font-size:13px;margin-top:3px;line-height:1.45}
.bp-perm .st{display:flex;gap:12px;flex-wrap:wrap;margin-top:6px;font-size:12px;color:#475569;font-variant-numeric:tabular-nums}.bp-perm .st b{color:var(--n)}
.bp-perm .act{display:flex;gap:6px;align-items:center}
@media(max-width:700px){.bp-perm{grid-template-columns:auto 1fr}.bp-perm .act{grid-column:1/-1;justify-content:flex-end}}
.bp-t{width:100%;border-collapse:collapse;font-size:13px}.bp-t th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.7px;color:var(--mu);padding:8px 10px;border-bottom:1px solid var(--ln);white-space:nowrap}
.bp-t td{padding:9px 10px;border-bottom:1px solid #eef1f6;vertical-align:middle;font-variant-numeric:tabular-nums}.bp-t tr:last-child td{border-bottom:0}.bp-t tr.click{cursor:pointer}.bp-t tr.click:hover td{background:rgba(8,131,247,.05)}
.bp-t td.r,.bp-t th.r{text-align:right}.bp-wrap{overflow-x:auto}
.bp-btn{border:1px solid #d8dee9;background:#fff;color:inherit;border-radius:10px;padding:8px 13px;font:inherit;font-weight:600;cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;gap:6px}
.bp-btn:hover{filter:brightness(.97)}.bp-btn.p{background:var(--b);border-color:var(--b);color:#fff}.bp-btn.d{background:#fff;border-color:#fecaca;color:#b91c1c}.bp-btn.sm{padding:5px 10px;font-size:12.5px}.bp-btn[disabled]{opacity:.5;cursor:not-allowed}
.bp-form{display:grid;gap:12px}.bp-form label{display:grid;gap:5px;font-size:13px;font-weight:600}.bp-form input,.bp-form select,.bp-form textarea{border:1px solid #d8dee9;border-radius:10px;padding:9px 11px;font:inherit;background:#fff;color:inherit;width:100%;box-sizing:border-box}
.bp-form .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}@media(max-width:600px){.bp-form .row{grid-template-columns:1fr}}
.bp-form .hint{font-weight:400;color:var(--mu);font-size:12px}
.bp-json{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;background:#0b1830;color:#dbe6ff;padding:12px;border-radius:12px;overflow:auto;max-height:340px;white-space:pre-wrap;word-break:break-word;margin:0}
.bp-reply{background:#f8fafc;border:1px solid var(--ln);border-radius:12px;padding:12px 14px;line-height:1.55;font-size:14px}
.bp-find{border:1px solid var(--ln);border-radius:14px;padding:14px 16px;margin-bottom:10px;background:#fff}.bp-find h4{margin:4px 0 6px;font-size:15px}.bp-find p{margin:0 0 6px;font-size:13.5px;line-height:1.5}.bp-find .fix{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:8px 10px}
.bp-diff{font-size:12px;color:#475569}.bp-diff b{color:var(--n)}
.bp-switch{position:relative;width:46px;height:26px;flex-shrink:0}.bp-switch input{opacity:0;width:0;height:0}.bp-switch .track{position:absolute;inset:0;background:#cbd5e1;border-radius:999px;transition:.2s;cursor:pointer}
.bp-switch .track::before{content:'';position:absolute;width:20px;height:20px;left:3px;top:3px;background:#fff;border-radius:50%;transition:.2s}.bp-switch input:checked+.track{background:var(--g)}.bp-switch input:checked+.track::before{transform:translateX(20px)}.bp-switch input:disabled+.track{opacity:.5;cursor:not-allowed}
`;

function sw(checked, onChange, disabled) {
  const input = el('input', { type: 'checkbox' });
  input.checked = !!checked; if (disabled) input.disabled = true;
  input.addEventListener('change', async () => {
    input.disabled = true;
    try { await onChange(input.checked); } catch (e) { input.checked = !input.checked; toast(humanizeError(e), 'error'); }
    input.disabled = !!disabled;
  });
  return el('label', { class: 'bp-switch', title: checked ? 'On — click to switch off' : 'Off — click to switch on' }, [input, el('span', { class: 'track' })]);
}

const field = (label, node, hint) => el('label', null, [label, node, hint ? el('span', { class: 'hint' }, hint) : null]);
const input = (attrs, val) => { const i = el('input', Object.assign({ type: 'text' }, attrs)); if (val != null) i.value = String(val); return i; };
const select = (opts, val) => { const s = el('select', null, opts.map(([v, l]) => el('option', { value: v }, l))); s.value = val == null ? '' : String(val); return s; };
const textarea = (attrs, val) => { const t = el('textarea', Object.assign({ rows: '3' }, attrs)); if (val != null) t.value = String(val); return t; };
const numOrNull = (s) => { s = String(s == null ? '' : s).trim(); return s === '' ? null : Number(s); };
const json = (o) => el('pre', { class: 'bp-json' }, typeof o === 'string' ? o : JSON.stringify(o, null, 2));

export async function renderBrain(host, query) {
  const wanted = (() => { try { return query && query.get ? query.get('tab') : null; } catch (_) { return null; } })();
  const TABS = [['live', 'Live'], ['permissions', 'Permissions'], ['jobs', 'Jobs'], ['findings', 'Findings'], ['facts', 'Facts'], ['settings', 'Settings'], ['log', 'Change log']];
  let tab = TABS.some(([k]) => k === wanted) ? wanted : 'live';
  let ov = null, timer = null, tick = null, busy = false, jobsFilter = { source: '', status: '' }, findStatus = 'open';

  const style = el('style', null, CSS);
  const headBox = el('div');
  const tabsEl = el('div');
  const bodyEl = el('div');
  const root = el('div', { class: 'bp cc-view' }, [style, headBox, tabsEl, bodyEl]);
  mount(host, root);

  // ---------- header: title + kill switch + try-a-question
  function paintHead() {
    const st = ov && ov.state; const cfg = ov && ov.config;
    const killer = st ? el('div', { style: 'display:flex;align-items:center;gap:10px' }, [
      el('span', { style: 'font-weight:700;font-size:13px;color:' + (st.enabled ? '#15803d' : '#b91c1c') }, st.enabled ? 'Brain ON' : 'Brain OFF'),
      sw(st.enabled, async (on) => {
        if (!on) { const ok = await askConfirm('Switch the brain off?', { body: 'Every new job from every source is filed as skipped until you switch it back on. Nothing in flight is interrupted.', confirmLabel: 'Switch off', danger: true }); if (!ok) throw new Error('cancelled'); }
        await ccBrainConfigSet({ enabled: on, reason: 'kill switch from CC' }); toast(on ? 'Brain switched on.' : 'Brain switched off.', on ? 'success' : 'info'); await loadAll();
      }),
    ]) : null;
    mount(headBox, sectionHead('AI Brain',
      'Everything the Claude brain is allowed to do, when it runs, what it is doing right now and what each action costs — with a switch on every one of them. Live chat still runs on Gemini until plan §3 moves it here.',
      [killer, el('button', { class: 'bp-btn p', onClick: tryQuestion }, [icon('sparkle', 15), 'Try a question']),
       cfg && !cfg.fn_key_set ? pill('function key not set', 'r') : null]));
  }

  function paintTabs() {
    const counts = ov ? { live: (ov.live || []).length, findings: ov.open_findings, permissions: (ov.permissions || []).filter((p) => p.enabled).length } : {};
    mount(tabsEl, el('div', { class: 'bp-tabs' }, TABS.map(([k, l]) => el('button', { class: 'bp-tab' + (tab === k ? ' on' : ''), onClick: () => { tab = k; try { history.replaceState(null, '', '#/brain?tab=' + k); } catch (_) {} paintTabs(); paintBody(); } },
      [l, counts[k] ? el('span', { class: 'n' }, String(counts[k])) : null]))));
  }

  function paintBody() {
    if (!ov) { showLoading(bodyEl, 'Loading the brain…'); return; }
    if (tab === 'live') paintLive(); else if (tab === 'permissions') paintPermissions(); else if (tab === 'jobs') paintJobs();
    else if (tab === 'findings') paintFindings(); else if (tab === 'facts') paintFacts(); else if (tab === 'settings') paintSettings(); else paintLog();
  }

  // ---------- LIVE
  function paintLive() {
    const st = ov.state, t = ov.today || {}, c = ov.counts || {};
    const pct = st.cap_usd > 0 ? Math.min(100, (Number(st.spent_today) / Number(st.cap_usd)) * 100) : 0;
    const tokens = Number(t.input_tokens || 0) + Number(t.cache_read || 0) + Number(t.cache_write || 0) + Number(t.output_tokens || 0);
    const kpi = (v, l, s) => el('div', { class: 'bp-kpi' }, [el('b', null, v), el('span', null, l), s ? el('small', null, s) : null]);
    const perSource = (ov.permissions || []).filter((p) => p.kind === 'source' && (Number(p.today) || Number(p.usd_today))).sort((a, b) => Number(b.usd_today) - Number(a.usd_today));

    mount(bodyEl, [
      el('div', { class: 'bp-board' }, [
        el('h3', null, [el('i', { class: 'bp-dot' + (st.enabled && !st.over_cap ? '' : ' off') }), st.enabled ? (st.over_cap ? 'Paused — daily cap reached' : 'Running') : 'Switched off', el('span', { style: 'margin-left:auto;text-transform:none;letter-spacing:0' }, 'refreshes every 5 s · ' + ago(ov._at))]),
        el('div', { class: 'bp-kpis' }, [
          el('div', { class: 'bp-kpi' }, [el('b', null, usd(st.spent_today, 2) + ' / ' + usd(st.cap_usd, 0)), el('span', null, 'Spent today · cap'),
            el('div', { class: 'bp-bar' }, el('i', { class: pct >= 100 ? 'over' : pct >= 80 ? 'warn' : '', style: 'width:' + pct.toFixed(0) + '%' }))]),
          kpi(num(t.jobs), 'Jobs today', num(c.done_today) + ' done · ' + num(c.failed_today) + ' failed · ' + num(c.skipped_today) + ' skipped'),
          kpi(num(tokens), 'Tokens today', num(t.cache_read) + ' from cache · ' + num(t.output_tokens) + ' out'),
          kpi(c.cache_hit_pct == null ? '—' : c.cache_hit_pct + '%', 'Cache hit', 'system block read from the 1 h cache'),
          kpi(c.avg_secs == null ? '—' : c.avg_secs + ' s', 'Avg answer time', num(c.escalated_today) + ' escalated to a person'),
          kpi(num(ov.open_findings), 'Open findings', 'bugs, KB gaps, ideas filed for you'),
          kpi(st.model || '—', 'Model', 'tool budget ' + num(st.max_tool_calls) + ' calls / job'),
        ]),
        el('div', { class: 'bp-two' }, [
          el('div', null, [el('h3', null, 'In flight (' + (ov.live || []).length + ')'),
            (ov.live || []).length ? el('div', { class: 'bp-live' }, ov.live.map((j) => el('div', { class: 'bp-lj', onClick: () => openJob(j.id) }, [
              el('div', { class: 'top' }, [el('span', null, '#' + j.id + ' · ' + j.source + ' / ' + j.route + ' · ' + j.status + ' · ' + num(j.tool_calls) + ' tools'), el('span', { dataset: { since: j.created_at } }, mmss((Date.now() - new Date(j.created_at).getTime()) / 1000))]),
              el('div', { class: 'q' }, j.question || '(no question)')]))) : el('div', { class: 'bp-none' }, 'Nothing running. Every job the brain picks up shows here with a live timer.')]),
          el('div', null, [el('h3', null, 'Spend by source today'),
            perSource.length ? el('table', { class: 'bp-t', style: 'color:#e8eefc' }, [el('tbody', null, perSource.map((p) => el('tr', null, [
              el('td', null, p.label), el('td', { class: 'r' }, num(p.today) + ' jobs'), el('td', { class: 'r' }, usd(p.usd_today, 3)),
              el('td', { class: 'r' }, p.usd_cap_daily != null ? 'cap ' + usd(p.usd_cap_daily, 0) : '')])))]) : el('div', { class: 'bp-none' }, 'No spend yet today.'),
            el('h3', { style: 'margin-top:14px' }, 'Last 14 days (USD)'),
            (ov.days || []).length ? barChart(ov.days.map((d) => ({ d: d.day, c: Number(d.usd) }))) : el('div', { class: 'bp-none' }, 'No history yet.')]),
        ]),
        el('h3', { style: 'margin-top:16px' }, 'Action feed — every tool call, as it happens'),
        (ov.actions || []).length ? el('div', { class: 'bp-feed' }, ov.actions.map((a) => {
          const o = OUTCOME[a.outcome] || [a.outcome, 'm'];
          return el('div', { class: 'bp-act', onClick: () => openJob(a.job_id), title: a.error || '' }, [
            el('div', null, [el('div', { class: 't' }, a.tool), pill(o[0], o[1])]),
            el('div', { class: 's' }, [el('span', { style: 'color:#93a4c3' }, '#' + a.job_id + ' · ' + a.source + ' / ' + a.route + ' · '), a.error ? el('span', { style: 'color:#fca5a5' }, a.error) : (a.summary || '')]),
            el('div', { class: 'm' }, [el('div', null, kb(a.bytes) + ' · ' + (a.ms == null ? '—' : a.ms + ' ms')), el('div', null, ago(a.created_at))]),
          ]);
        })) : el('div', { class: 'bp-none' }, 'No tool calls yet. Press “Try a question” to watch one go through.'),
      ]),
      ov.lc_brain ? el('div', { class: 'bp-card' }, [el('h3', null, 'Live chat (Gemini, lc-brain)'), el('p', { class: 'hint', style: 'margin:0' }, ov.lc_brain.note + ' Chat jobs today: ' + num(ov.lc_brain.jobs_today) + '. Its switches live in Live chat → Settings until then.')]) : null,
    ]);
  }

  // ---------- PERMISSIONS
  function permStats(p) {
    if (p.kind === 'tool') return [['today', num(p.today)], ['7 d', num(p.week)], ['denied 7 d', num(p.denied_7d)], p.prepared_7d ? ['prepared 7 d', num(p.prepared_7d)] : null, ['data 7 d', kb(p.bytes_7d)], ['avg', p.avg_ms == null ? '—' : p.avg_ms + ' ms'], ['last', ago(p.last_used)]];
    if (p.kind === 'source') return [['today', num(p.today) + ' jobs'], ['spent today', usd(p.usd_today, 3)], ['7 d', num(p.week) + ' jobs · ' + usd(p.usd_7d, 2)], ['tokens 7 d', num(p.tokens_7d)], ['skipped 7 d', num(p.skipped_7d)], ['failed 7 d', num(p.failed_7d)], ['avg', p.avg_secs == null ? '—' : p.avg_secs + ' s'], ['last', ago(p.last_used)]];
    return [];
  }
  function limits(p) {
    const out = [];
    if (p.kind === 'tool') { if (p.max_per_job != null) out.push('≤ ' + p.max_per_job + ' / job'); if (p.max_per_day != null) out.push('≤ ' + num(p.max_per_day) + ' / day'); if (p.sources) out.push('only: ' + p.sources.join(', ')); }
    if (p.kind === 'source') { if (p.max_per_day != null) out.push('≤ ' + num(p.max_per_day) + ' jobs / day'); if (p.usd_cap_daily != null) out.push('≤ ' + usd(p.usd_cap_daily, 0) + ' / day'); }
    return out;
  }
  function permRow(p) {
    const planned = p.status === 'planned';
    const canOn = !(p.kind === 'tool' && planned);
    return el('div', { class: 'bp-perm' + (p.enabled ? '' : ' off') }, [
      sw(p.enabled, async (on) => { await ccBrainPermSet(p.key, { enabled: on, reason: 'switch from CC' }); toast(p.label + (on ? ' switched on.' : ' switched off.'), on ? 'success' : 'info'); await loadAll(); }, !canOn),
      el('div', { style: 'min-width:0' }, [
        el('div', { class: 'k' }, [p.label, mono(p.key),
          p.kind === 'tool' ? pill(p.mode === 'prep' ? 'prep · record only' : 'auto · executes', p.mode === 'prep' ? 'a' : 'g') : null,
          p.kind === 'rule' ? pill(p.mode === 'allow' ? 'ALLOWED' : 'NEVER', p.mode === 'allow' ? 'g' : 'r') : null,
          pill(p.risk + ' risk', RISK[p.risk] || 'm'), planned ? pill('planned · no code yet', 'v') : null, p.builtin ? null : pill('custom', 'b')]),
        el('div', { class: 'd' }, [p.description || '', limits(p).length ? el('span', { style: 'color:#0369a1' }, ' · ' + limits(p).join(' · ')) : null, p.note ? el('span', { style: 'color:#6d28d9' }, ' · note: ' + p.note) : null]),
        permStats(p).length ? el('div', { class: 'st' }, permStats(p).filter(Boolean).map(([l, v]) => el('span', null, [l + ' ', el('b', null, v)]))) : null,
      ]),
      el('div', { class: 'act' }, [
        el('button', { class: 'bp-btn sm', onClick: () => editPerm(p) }, 'Edit'),
        p.builtin ? null : el('button', { class: 'bp-btn sm d', onClick: async () => {
          const ok = await askConfirm('Delete ' + p.key + '?', { body: 'The row is removed and logged. A tool with this name is denied again on the next call; a rule disappears from the prompt.', confirmLabel: 'Delete', danger: true });
          if (!ok) return; try { await ccBrainPermDelete(p.key); toast('Deleted.', 'success'); await loadAll(); } catch (e) { toast(humanizeError(e), 'error'); }
        } }, 'Delete'),
      ]),
    ]);
  }
  function paintPermissions() {
    if (busy) return;
    const perms = ov.permissions || [];
    mount(bodyEl, [
      el('div', { style: 'display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:12px' }, [
        el('div', { class: 'hint', style: 'color:#64748b;font-size:13px;max-width:760px;line-height:1.5' }, 'Three kinds of permission. The switch is the law: enforcement is in Postgres (brain_enqueue for sources, brain_tool_exec for tools), not in the model and not in this page. Anything not on this list is denied.'),
        el('button', { class: 'bp-btn p', onClick: () => addPerm() }, [icon('plus', 15), 'New permission']),
      ]),
      ...['source', 'tool', 'rule'].map((k) => el('div', { class: 'bp-card' }, [
        el('h3', null, [KIND[k].title, pill(perms.filter((p) => p.kind === k && p.enabled).length + ' on / ' + perms.filter((p) => p.kind === k).length, 'm')]),
        el('p', { class: 'hint' }, KIND[k].hint),
        perms.filter((p) => p.kind === k).length ? perms.filter((p) => p.kind === k).map(permRow) : el('div', { class: 'bp-none', style: 'color:#64748b' }, 'None yet.'),
      ])),
    ]);
  }
  function editPerm(p) {
    const f = {
      label: input({}, p.label), description: textarea({}, p.description),
      mode: p.kind === 'tool' ? select([['auto', 'auto — executes the action'], ['prep', 'prep — records it for you, never executes']], p.mode)
          : p.kind === 'rule' ? select([['deny', 'NEVER — forbids'], ['allow', 'ALLOWED — permits']], p.mode) : null,
      risk: select([['low', 'low'], ['medium', 'medium'], ['high', 'high']], p.risk),
      max_per_job: input({ type: 'number', min: '0', placeholder: 'no limit' }, p.max_per_job),
      max_per_day: input({ type: 'number', min: '0', placeholder: 'no limit' }, p.max_per_day),
      usd_cap_daily: input({ type: 'number', min: '0', step: '0.5', placeholder: 'no cap' }, p.usd_cap_daily),
      sources: input({ placeholder: 'all sources' }, (p.sources || []).join(', ')),
      note: input({ placeholder: 'why this is set the way it is' }, p.note), reason: input({ placeholder: 'goes into the change log' }),
    };
    const err = el('div', { style: 'color:#b91c1c;font-size:13px;min-height:18px' });
    const save = el('button', { class: 'bp-btn p', onClick: async () => {
      save.disabled = true; err.textContent = '';
      const patch = { label: f.label.value, description: f.description.value, risk: f.risk.value, note: f.note.value, reason: f.reason.value || null };
      if (f.mode) patch.mode = f.mode.value;
      if (p.kind === 'tool') { patch.max_per_job = numOrNull(f.max_per_job.value); patch.max_per_day = numOrNull(f.max_per_day.value); patch.sources = f.sources.value.split(',').map((s) => s.trim()).filter(Boolean); }
      if (p.kind === 'source') { patch.max_per_day = numOrNull(f.max_per_day.value); patch.usd_cap_daily = numOrNull(f.usd_cap_daily.value); }
      try { busy = true; await ccBrainPermSet(p.key, patch); busy = false; toast('Saved ' + p.key + '.', 'success'); d.close(); await loadAll(); }
      catch (e) { busy = false; err.textContent = humanizeError(e); save.disabled = false; }
    } }, 'Save');
    const d = openDrawer(p.label, el('div', { class: 'bp-form' }, [
      el('div', null, [mono(p.key), ' ', pill(p.kind, 'b'), ' ', p.status === 'planned' ? pill('planned — cannot be switched on until its code ships', 'v') : null]),
      field('Label', f.label), field('What it does / the rule text', f.description, p.kind === 'rule' ? 'This exact text goes into the prompt after NEVER / ALLOWED.' : null),
      el('div', { class: 'row' }, [f.mode ? field('Mode', f.mode) : el('div'), field('Risk', f.risk)]),
      p.kind === 'tool' ? el('div', { class: 'row' }, [field('Max calls per job', f.max_per_job), field('Max calls per day', f.max_per_day)]) : null,
      p.kind === 'tool' ? field('Only for these sources', f.sources, 'Comma-separated: ' + SOURCES.join(', ') + '. Empty = every source.') : null,
      p.kind === 'source' ? el('div', { class: 'row' }, [field('Max jobs per day', f.max_per_day), field('Max USD per day', f.usd_cap_daily)]) : null,
      field('Note', f.note), field('Reason for this change', f.reason), err,
      el('div', { style: 'display:flex;gap:8px' }, [save, el('button', { class: 'bp-btn', onClick: () => d.close() }, 'Cancel')]),
    ]), { subtitle: 'Saved server-side and written to the change log.' });
  }
  function addPerm() {
    const f = { kind: select([['rule', 'Rule — a policy line the model must follow'], ['tool', 'Tool — an action (planned until its code ships)'], ['source', 'Source — a door jobs come through']], 'rule'),
      name: input({ placeholder: 'e.g. no_rate_quotes_to_brokers' }), label: input({ placeholder: 'Short name shown in this list' }), description: textarea({ placeholder: 'For a rule: the exact sentence the model reads.' }),
      mode: select([['deny', 'NEVER — forbids'], ['allow', 'ALLOWED — permits']], 'deny'), risk: select([['low', 'low'], ['medium', 'medium'], ['high', 'high']], 'medium'),
      max_per_job: input({ type: 'number', min: '0', placeholder: 'no limit' }), max_per_day: input({ type: 'number', min: '0', placeholder: 'no limit' }), usd_cap_daily: input({ type: 'number', min: '0', step: '0.5', placeholder: 'no cap' }), reason: input({ placeholder: 'goes into the change log' }) };
    const modeBox = el('div'); const capBox = el('div');
    const paintKind = () => {
      const k = f.kind.value;
      if (k === 'rule') f.mode = select([['deny', 'NEVER — forbids'], ['allow', 'ALLOWED — permits']], 'deny');
      else if (k === 'tool') f.mode = select([['prep', 'prep — records it for you, never executes'], ['auto', 'auto — executes']], 'prep');
      else f.mode = null;
      mount(modeBox, f.mode ? field('Mode', f.mode) : el('div'));
      mount(capBox, k === 'tool' ? el('div', { class: 'row' }, [field('Max calls per job', f.max_per_job), field('Max calls per day', f.max_per_day)])
        : k === 'source' ? el('div', { class: 'row' }, [field('Max jobs per day', f.max_per_day), field('Max USD per day', f.usd_cap_daily)]) : '');
    };
    f.kind.addEventListener('change', paintKind); paintKind();
    const err = el('div', { style: 'color:#b91c1c;font-size:13px;min-height:18px' });
    const save = el('button', { class: 'bp-btn p', onClick: async () => {
      save.disabled = true; err.textContent = '';
      const k = f.kind.value;
      const patch = { mode: f.mode ? f.mode.value : undefined, risk: f.risk.value, reason: f.reason.value || null, max_per_job: numOrNull(f.max_per_job.value), max_per_day: numOrNull(f.max_per_day.value), usd_cap_daily: numOrNull(f.usd_cap_daily.value) };
      try { busy = true; const r = await ccBrainPermAdd(k, f.name.value, f.label.value, f.description.value, patch); busy = false; toast('Added ' + r.key + '.', 'success'); d.close(); await loadAll(); }
      catch (e) { busy = false; err.textContent = humanizeError(e); save.disabled = false; }
    } }, 'Add permission');
    const d = openDrawer('New permission', el('div', { class: 'bp-form' }, [
      field('Kind', f.kind, 'A rule is live at once. A tool is planned until a migration ships its executor — the row lets you decide its mode and caps before the code exists. A source becomes a real gate the moment code enqueues with that name.'),
      el('div', { class: 'row' }, [field('Key name', f.name, 'letters, digits, _'), field('Label', f.label)]),
      field('Description / rule text', f.description), el('div', { class: 'row' }, [modeBox, field('Risk', f.risk)]), capBox,
      field('Reason', f.reason), err,
      el('div', { style: 'display:flex;gap:8px' }, [save, el('button', { class: 'bp-btn', onClick: () => d.close() }, 'Cancel')]),
    ]), { subtitle: 'Written to app_private.brain_permissions and the change log.' });
  }

  // ---------- JOBS
  async function paintJobs() {
    const box = el('div');
    mount(bodyEl, [
      el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:12px' }, [
        select([['', 'All sources'], ...SOURCES.map((s) => [s, s])], jobsFilter.source),
        select([['', 'All statuses'], ['done', 'done'], ['running', 'running'], ['queued', 'queued'], ['failed', 'failed'], ['skipped', 'skipped'], ['capped', 'capped']], jobsFilter.status),
        el('button', { class: 'bp-btn sm', onClick: () => paintJobs() }, [icon('refresh', 14), 'Refresh']),
      ].map((n, i) => { if (i === 0) n.addEventListener('change', () => { jobsFilter.source = n.value; paintJobs(); }); if (i === 1) n.addEventListener('change', () => { jobsFilter.status = n.value; paintJobs(); }); return n; })),
      box,
    ]);
    showLoading(box, 'Loading jobs…');
    let rows; try { rows = await ccBrainJobs(120, jobsFilter.source || null, jobsFilter.status || null); } catch (e) { showError(box, humanizeError(e), paintJobs); return; }
    if (!rows.length) { mount(box, el('div', { class: 'bp-card' }, el('div', { class: 'bp-none', style: 'color:#64748b' }, 'No jobs match.'))); return; }
    mount(box, el('div', { class: 'bp-card bp-wrap' }, el('table', { class: 'bp-t' }, [
      el('thead', null, el('tr', null, ['#', 'When', 'Source / route', 'Status', 'In', 'Cache', 'Out', 'USD', 'Tools', 'Secs', 'Conf.', 'Question'].map((h, i) => el('th', { class: i >= 4 && i <= 9 ? 'r' : '' }, h)))),
      el('tbody', null, rows.map((j) => el('tr', { class: 'click', onClick: () => openJob(j.id) }, [
        el('td', null, String(j.id)), el('td', null, et(j.created_at)), el('td', null, j.source + ' / ' + j.route),
        el('td', null, [pill(j.status, JOB[j.status] || 'm'), j.escalate ? [' ', pill('escalated', 'a')] : null]),
        el('td', { class: 'r' }, num(j.input)), el('td', { class: 'r' }, num(j.cache_read) + (j.cache_write ? ' +' + num(j.cache_write) + 'w' : '')), el('td', { class: 'r' }, num(j.output)),
        el('td', { class: 'r' }, usd(j.usd)), el('td', { class: 'r' }, num(j.tool_calls)), el('td', { class: 'r' }, j.secs == null ? '—' : String(j.secs)),
        el('td', { class: 'r' }, j.confidence == null ? '—' : Number(j.confidence).toFixed(2)),
        el('td', { style: 'max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap', title: j.error || j.question || '' }, j.error ? el('span', { style: 'color:#b91c1c' }, j.error) : (j.question || '')),
      ]))),
    ])));
  }
  async function openJob(id) {
    const body = el('div'); showLoading(body, 'Loading job #' + id + '…');
    const d = openDrawer('Job #' + id, body, { size: 'lg', subtitle: 'The full record: what went in, what came back, every tool call with its payload and result.' });
    let r; try { r = await ccBrainJob(id); } catch (e) { showError(body, humanizeError(e)); return; }
    if (!r || !r.job) { showError(body, 'Job not found.'); return; }
    const j = r.job; const res = j.result || {};
    const tokens = [['input', j.input_tokens], ['cache read', j.cache_read], ['cache write', j.cache_write], ['output', j.output_tokens]];
    mount(body, [
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px' }, [pill(j.status, JOB[j.status] || 'm'), pill(j.source + ' / ' + j.route, 'b'), pill(j.model || '—', 'm'), pill('effort ' + (j.effort || '—'), 'm'), pill(j.lang, 'm'),
        el('span', { style: 'color:#64748b;font-size:12.5px' }, et(j.created_at) + (j.done_at ? ' → ' + Math.round((new Date(j.done_at) - new Date(j.created_at)) / 100) / 10 + ' s' : ''))]),
      el('div', { class: 'bp-kpis', style: 'grid-template-columns:repeat(auto-fit,minmax(110px,1fr))' }, [...tokens.map(([l, v]) => el('div', { class: 'bp-kpi', style: 'background:#f8fafc;border-color:#e5e9f2' }, [el('b', { style: 'color:#10223B' }, num(v)), el('span', null, l)])),
        el('div', { class: 'bp-kpi', style: 'background:#f8fafc;border-color:#e5e9f2' }, [el('b', { style: 'color:#10223B' }, usd(j.usd)), el('span', null, 'cost')]),
        el('div', { class: 'bp-kpi', style: 'background:#f8fafc;border-color:#e5e9f2' }, [el('b', { style: 'color:#10223B' }, num(j.tool_calls) + ' / ' + num(j.iterations)), el('span', null, 'tools / turns')])]),
      j.error ? el('div', { class: 'bp-reply', style: 'border-color:#fecaca;background:#fef2f2;color:#b91c1c;margin-bottom:12px' }, j.error) : null,
      el('h4', { style: 'margin:12px 0 6px' }, 'Question / task'), el('div', { class: 'bp-reply' }, j.question || '(none)'),
      j.status === 'done' ? [el('h4', { style: 'margin:14px 0 6px' }, ['Reply ', res.escalate ? pill('escalated: ' + (res.escalate_reason || ''), 'a') : pill('confidence ' + Number(res.confidence || 0).toFixed(2), 'g')]),
        el('div', { class: 'bp-reply', html: String(res.reply || '(empty)').replace(/<(?!\/?[bi]>)/g, '&lt;') }),
        (res.actions || []).length ? el('div', { style: 'margin-top:6px;font-size:12.5px;color:#64748b' }, 'actions: ' + res.actions.join(', ')) : null] : null,
      el('h4', { style: 'margin:14px 0 6px' }, 'Tool calls (' + (r.actions || []).length + ')'),
      (r.actions || []).length ? r.actions.map((a) => { const o = OUTCOME[a.outcome] || [a.outcome, 'm']; return el('details', { style: 'margin-bottom:6px' }, [
        el('summary', { style: 'cursor:pointer;font-size:13.5px' }, [el('b', null, a.tool), ' ', pill(o[0], o[1]), ' ', el('span', { style: 'color:#64748b' }, kb(a.bytes) + ' · ' + (a.ms == null ? '—' : a.ms + ' ms') + ' · ' + ago(a.created_at))]),
        el('div', { style: 'display:grid;gap:6px;margin-top:6px' }, [el('div', { style: 'font-size:12px;color:#64748b' }, 'payload'), json(a.payload || {}), el('div', { style: 'font-size:12px;color:#64748b' }, 'result'), json(a.result || {})])]); })
        : el('div', { class: 'bp-none', style: 'color:#64748b' }, 'No tool calls on this job.'),
      (r.findings || []).length ? [el('h4', { style: 'margin:14px 0 6px' }, 'Findings filed'), r.findings.map(findingCard)] : null,
      el('details', { style: 'margin-top:12px' }, [el('summary', { style: 'cursor:pointer;font-size:13px;color:#64748b' }, 'Context sent (json)'), json(j.context || {})]),
    ]);
  }
  async function tryQuestion() {
    const q = textarea({ rows: '3', placeholder: 'e.g. What does LoadBoot charge and when do I pay?' });
    const lang = select([['en', 'English'], ['es', 'Español']], 'en');
    const err = el('div', { style: 'color:#b91c1c;font-size:13px;min-height:18px' });
    const go = el('button', { class: 'bp-btn p', onClick: async () => {
      go.disabled = true; err.textContent = '';
      try { const r = await ccBrainTest(q.value, lang.value); d.close(); if (r.status === 'queued') { toast('Job #' + r.job_id + ' queued — watch it on Live.', 'success'); tab = 'live'; paintTabs(); } else toast('Job #' + r.job_id + ' ' + r.status + ': ' + (r.error || ''), 'error'); await loadAll(); }
      catch (e) { err.textContent = humanizeError(e); go.disabled = false; }
    } }, 'Send to the brain');
    const d = openDrawer('Try a question', el('div', { class: 'bp-form' }, [
      el('p', { style: 'margin:0;color:#64748b;font-size:13px;line-height:1.5' }, 'Goes through the real queue as a test job (source “test”), with the same rules, facts, KB and tools a visitor would get. Costs real money (a few cents). Nothing is sent to anyone.'),
      field('Question', q), field('Language', lang), err, el('div', { style: 'display:flex;gap:8px' }, [go, el('button', { class: 'bp-btn', onClick: () => d.close() }, 'Cancel')]),
    ]), { subtitle: 'source.test must be on', size: 'sm' });
  }

  // ---------- FINDINGS
  function findingCard(f) {
    const tone = { bug: 'r', kb_gap: 'a', portal: 'b', growth: 'g', seo: 'v', ads: 'v', process: 'm' }[f.kind] || 'm';
    const btn = (label, status, cls) => el('button', { class: 'bp-btn sm ' + (cls || ''), onClick: async () => { try { await ccBrainFindingSet(f.id, status); toast('Finding #' + f.id + ' → ' + status + '.', 'success'); paintFindings(); } catch (e) { toast(humanizeError(e), 'error'); } } }, label);
    return el('div', { class: 'bp-find' }, [
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, [pill(f.kind.replace('_', ' '), tone), pill(f.status, f.status === 'open' ? 'a' : f.status === 'done' ? 'g' : 'm'), f.surface ? pill(f.surface, 'm') : null, el('span', { style: 'color:#64748b;font-size:12px;margin-left:auto' }, '#' + f.id + ' · ' + et(f.created_at) + (f.job_id ? ' · job #' + f.job_id : ''))]),
      el('h4', null, f.title), f.detail ? el('p', null, f.detail) : null,
      f.suggested_fix ? el('p', { class: 'fix' }, [el('b', null, 'Suggested fix: '), f.suggested_fix]) : null,
      f.evidence ? el('details', null, [el('summary', { style: 'cursor:pointer;font-size:12.5px;color:#64748b' }, 'evidence'), json(f.evidence)]) : null,
      el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:8px' }, [
        f.status !== 'accepted' && f.status !== 'done' ? btn('Accept', 'accepted', 'p') : null, f.status !== 'done' ? btn('Done', 'done') : null,
        f.status !== 'dismissed' ? btn('Dismiss', 'dismissed', 'd') : null, f.status !== 'open' ? btn('Reopen', 'open') : null,
        f.job_id ? el('button', { class: 'bp-btn sm', onClick: () => openJob(f.job_id) }, 'Open job') : null]),
    ]);
  }
  async function paintFindings() {
    const box = el('div');
    mount(bodyEl, [el('div', { style: 'margin-bottom:12px' }, segmented([{ value: 'open', label: 'Open' }, { value: 'accepted', label: 'Accepted' }, { value: 'done', label: 'Done' }, { value: 'dismissed', label: 'Dismissed' }, { value: '', label: 'All' }], findStatus, (v) => { findStatus = v; paintFindings(); })), box]);
    showLoading(box, 'Loading findings…');
    let rows; try { rows = await ccBrainFindings(findStatus || null, 200); } catch (e) { showError(box, humanizeError(e), paintFindings); return; }
    mount(box, rows.length ? rows.map(findingCard) : el('div', { class: 'bp-card' }, el('div', { class: 'bp-none', style: 'color:#64748b' }, 'Nothing here. The brain files a finding when it hits a bug, a question the KB cannot answer, or an idea worth your time.')));
  }

  // ---------- FACTS
  async function paintFacts() {
    const box = el('div');
    mount(bodyEl, [el('div', { style: 'display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:12px' }, [
      el('div', { style: 'color:#64748b;font-size:13px;max-width:760px;line-height:1.5' }, 'What the brain treats as TRUE. Every enabled fact is in the cached system block of every job. site.* rows mirror the site registry (edit in Market rates); the rest are yours to edit here. Changing a fact re-warms the cache once.'),
      el('button', { class: 'bp-btn p', onClick: () => editFact(null) }, [icon('plus', 15), 'Add fact'])]), box]);
    showLoading(box, 'Loading facts…');
    let rows; try { rows = await ccBrainFacts(); } catch (e) { showError(box, humanizeError(e), paintFacts); return; }
    mount(box, el('div', { class: 'bp-card bp-wrap' }, el('table', { class: 'bp-t' }, [
      el('thead', null, el('tr', null, ['Key', 'Value', 'Source', 'As of', ''].map((h) => el('th', null, h)))),
      el('tbody', null, rows.map((f) => { const site = String(f.key).indexOf('site.') === 0; return el('tr', null, [
        el('td', null, mono(f.key)), el('td', { style: 'max-width:520px;white-space:normal;line-height:1.45' }, f.value + (f.unit ? ' ' + f.unit : '')), el('td', null, f.source || '—'), el('td', null, f.as_of || '—'),
        el('td', { class: 'r' }, site ? pill('registry', 'm') : el('button', { class: 'bp-btn sm', onClick: () => editFact(f) }, 'Edit'))]); })),
    ])));
  }
  function editFact(f) {
    const key = input({ placeholder: 'e.g. lb.support_hours' }, f ? f.key : ''); if (f) key.disabled = true;
    const val = textarea({ rows: '4' }, f ? f.value : ''); const note = input({ placeholder: 'why / where from' }, f ? f.note : '');
    const err = el('div', { style: 'color:#b91c1c;font-size:13px;min-height:18px' });
    const save = el('button', { class: 'bp-btn p', onClick: async () => { save.disabled = true; try { await ccBrainFactSet(key.value, val.value, note.value || null); toast('Fact saved.', 'success'); d.close(); paintFacts(); } catch (e) { err.textContent = humanizeError(e); save.disabled = false; } } }, 'Save');
    const del = f ? el('button', { class: 'bp-btn d', onClick: async () => { const ok = await askConfirm('Remove fact ' + f.key + '?', { body: 'The brain stops seeing it on the next job.', confirmLabel: 'Remove', danger: true }); if (!ok) return; try { await ccBrainFactSet(f.key, null, 'removed from CC'); toast('Removed.', 'success'); d.close(); paintFacts(); } catch (e) { toast(humanizeError(e), 'error'); } } }, 'Remove') : null;
    const d = openDrawer(f ? 'Edit fact' : 'New fact', el('div', { class: 'bp-form' }, [field('Key', key, 'a-z 0-9 _ . — not site.*'), field('Value (the sentence the brain reads)', val), field('Note', note), err,
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [save, el('button', { class: 'bp-btn', onClick: () => d.close() }, 'Cancel'), del])]), { subtitle: 'Written to app_private.brain_facts and the change log.' });
  }

  // ---------- SETTINGS
  function paintSettings() {
    const c = ov.config || {};
    const f = { model: input({}, c.model), gate_model: input({}, c.gate_model), cap: input({ type: 'number', min: '0', step: '1' }, c.daily_usd_cap), tools: input({ type: 'number', min: '0', max: '40' }, c.max_tool_calls),
      timeout: input({ type: 'number', min: '1000', max: '120000', step: '1000' }, c.timeout_ms), spot: input({ type: 'date' }, c.spot_check_until || ''), reason: input({ placeholder: 'goes into the change log' }) };
    const eff = {}; const mt = {};
    ROUTES.forEach((r) => { eff[r] = select([['', '(default: medium)'], ['low', 'low'], ['medium', 'medium'], ['high', 'high'], ['max', 'max']], (c.effort || {})[r] || ''); mt[r] = input({ type: 'number', min: '256', max: '64000', placeholder: 'default' }, (c.max_tokens || {})[r]); });
    const price = {}; const models = Object.keys(c.price || {});
    models.forEach((m) => { price[m] = {}; ['in', 'out', 'cache_read', 'cache_write'].forEach((k) => { price[m][k] = input({ type: 'number', min: '0', step: '0.01' }, (c.price[m] || {})[k]); }); });
    const err = el('div', { style: 'color:#b91c1c;font-size:13px;min-height:18px' });
    const save = el('button', { class: 'bp-btn p', onClick: async () => {
      save.disabled = true; err.textContent = '';
      const patch = { model: f.model.value, gate_model: f.gate_model.value, daily_usd_cap: numOrNull(f.cap.value), max_tool_calls: numOrNull(f.tools.value), timeout_ms: numOrNull(f.timeout.value), spot_check_until: f.spot.value || '', reason: f.reason.value || null, effort: {}, max_tokens: {}, price: {} };
      ROUTES.forEach((r) => { if (eff[r].value) patch.effort[r] = eff[r].value; if (mt[r].value) patch.max_tokens[r] = Number(mt[r].value); });
      models.forEach((m) => { patch.price[m] = {}; ['in', 'out', 'cache_read', 'cache_write'].forEach((k) => { patch.price[m][k] = Number(price[m][k].value || 0); }); });
      try { busy = true; await ccBrainConfigSet(patch); busy = false; toast('Settings saved.', 'success'); await loadAll(); } catch (e) { busy = false; err.textContent = humanizeError(e); save.disabled = false; }
    } }, 'Save settings');
    mount(bodyEl, [
      el('div', { class: 'bp-card' }, [el('h3', null, 'Model & budget'), el('p', { class: 'hint' }, 'The daily cap is the hard stop: at the cap every new job is filed as capped, no API call. Tool budget is the most tool calls one job may make. Spot-check: while the date is in the future, everything the brain sends is also copied to your digest.'),
        el('div', { class: 'bp-form' }, [el('div', { class: 'row' }, [field('Model', f.model, 'Anthropic model id, e.g. claude-fable-5-1'), field('Gate model (cheap triage)', f.gate_model)]),
          el('div', { class: 'row' }, [field('Daily cap (USD)', f.cap), field('Tool budget per job', f.tools)]), el('div', { class: 'row' }, [field('Function timeout (ms)', f.timeout), field('Spot-check until', f.spot)])])]),
      el('div', { class: 'bp-card' }, [el('h3', null, 'Effort & max tokens per route'), el('p', { class: 'hint' }, 'Effort is how hard the model thinks (and how much it costs) on that kind of job. Max tokens bounds the answer.'),
        el('div', { class: 'bp-wrap' }, el('table', { class: 'bp-t' }, [el('thead', null, el('tr', null, ['Route', 'Effort', 'Max tokens'].map((h) => el('th', null, h)))),
          el('tbody', null, ROUTES.map((r) => el('tr', null, [el('td', null, mono(r)), el('td', null, eff[r]), el('td', null, mt[r])])))]))]),
      el('div', { class: 'bp-card' }, [el('h3', null, 'Price table (USD per million tokens)'), el('p', { class: 'hint' }, 'What every job is priced with. Correct it here if Anthropic changes prices — no deploy.'),
        el('div', { class: 'bp-wrap' }, el('table', { class: 'bp-t' }, [el('thead', null, el('tr', null, ['Model', 'Input', 'Output', 'Cache read', 'Cache write'].map((h) => el('th', null, h)))),
          el('tbody', null, models.map((m) => el('tr', null, [el('td', null, mono(m)), ...['in', 'out', 'cache_read', 'cache_write'].map((k) => el('td', null, price[m][k]))])))]))]),
      el('div', { class: 'bp-card' }, [el('h3', null, 'Wiring'), el('p', { class: 'hint', style: 'margin:0' }, ['Function: ', mono(c.fn_url || '(not set)'), ' · key ', c.fn_key_set ? pill('set', 'g') : pill('missing', 'r'), ' · last change ', et(c.updated_at), '. These are set in SQL (brain_config), not here.'])]),
      el('div', { class: 'bp-form', style: 'margin-bottom:20px' }, [field('Reason for this change', f.reason), err, el('div', null, save)]),
    ]);
  }

  // ---------- LOG
  async function paintLog() {
    const box = el('div'); mount(bodyEl, box); showLoading(box, 'Loading the change log…');
    let rows; try { rows = await ccBrainPermLog(200); } catch (e) { showError(box, humanizeError(e), paintLog); return; }
    const diff = (b, a) => { const out = []; const keys = new Set([...Object.keys(b || {}), ...Object.keys(a || {})]); keys.forEach((k) => { if (k === 'updated_at' || k === 'updated_by') return; const x = JSON.stringify((b || {})[k]), y = JSON.stringify((a || {})[k]); if (x !== y) out.push(el('div', null, [el('b', null, k + ': '), (x == null ? '—' : x) + ' → ' + (y == null ? '—' : y)])); }); return out.length ? out : [el('div', null, b && !a ? 'deleted' : !b && a ? 'added' : 'no field changed')]; };
    mount(box, el('div', { class: 'bp-card bp-wrap' }, rows.length ? el('table', { class: 'bp-t' }, [
      el('thead', null, el('tr', null, ['When', 'Who', 'Action', 'Key', 'Change'].map((h) => el('th', null, h)))),
      el('tbody', null, rows.map((l) => el('tr', null, [el('td', null, et(l.created_at)), el('td', null, l.by_email || (l.by_user ? String(l.by_user).slice(0, 8) : 'sql')), el('td', null, pill(l.action, 'b')), el('td', null, mono(l.key)),
        el('td', { class: 'bp-diff', style: 'white-space:normal;max-width:560px' }, [...diff(l.before, l.after), l.note ? el('div', { style: 'color:#6d28d9' }, 'reason: ' + l.note) : null])]))),
    ]) : el('div', { class: 'bp-none', style: 'color:#64748b' }, 'No changes yet.')));
  }

  // ---------- load + timers
  async function loadAll(first) {
    try { const r = await ccBrainOverview(); r._at = new Date().toISOString(); ov = r; }
    catch (e) { if (first) { showError(bodyEl, humanizeError(e), () => loadAll(true)); mount(headBox, sectionHead('AI Brain', 'Could not load.')); } return; }
    paintHead(); paintTabs();
    if (tab === 'live' || tab === 'permissions' || first) paintBody();
  }
  function tickTimers() { bodyEl.querySelectorAll('[data-since]').forEach((n) => { n.textContent = mmss((Date.now() - new Date(n.getAttribute('data-since')).getTime()) / 1000); }); }
  const start = () => { stop(); timer = setInterval(() => { if (document.hidden || busy) return; loadAll(); }, 5000); tick = setInterval(tickTimers, 1000); };
  const stop = () => { clearInterval(timer); clearInterval(tick); };
  const mo = new MutationObserver(() => { if (!document.body.contains(root)) { stop(); mo.disconnect(); } });
  mo.observe(document.body, { childList: true, subtree: true });

  paintTabs(); showLoading(bodyEl, 'Loading the brain…');
  await loadAll(true);
  start();
}

export default renderBrain;
