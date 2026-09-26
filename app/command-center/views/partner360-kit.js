// partner360-kit.js — the shared building blocks behind the three partner 360 screens
// (broker360.js · agent360.js · shipper360.js). bl_bp_0455.
//
// One data read (cc_partner_360 v2, role-aware) → one page shell (hero, next-action banner, KPI row,
// sticky section nav, auto-refresh) → role views compose the cards they need from here. Everything that
// reviews a document, approves an account or moves a trust tier lives in this file once, so the three
// screens cannot drift apart the way broker360 v1 and partners.js did (0/8 vs 3/3).
//
// Rules kept from carrier360: create every card synchronously with a placeholder, then fill it — section
// order never depends on RPC latency. No native prompt()/alert(): askReason / askConfirm / openDrawer only.
// Pill colours come from cc-pill-* classes (dark mode restyles them); no hard-coded #hex pills.
import { el, mount } from '../../shared/ui/dom.js';
import { icon } from '../../shared/ui/icons.js';
import { card, statCard, statusPill, fmtDate, fmtDateTime, ago, openDrawer, askReason, askConfirm } from '../../shared/ui/components.js';
import { partner360, onboardingReviewItem, partnerSetStatus, issueViolation, partnerPacketRemind, claimBundle, ccBrokerTrustSet, ccShipperTrustSet } from '../../shared/api.js';
import { signedDocumentUrl } from '../../shared/storage.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';
import { printExecutedW9 } from '../../carrier/w9-form.js';
import { partnerRoute, ROLE_LABEL } from '../../shared/ui/entityLink.js';
import { partnersLiveJoin, coalesceEvents } from '../../shared/partners-live.js';  // bl_bp_0457

export const money = (n) => '$' + Number(n || 0).toLocaleString();
export const n0 = (v) => Number(v || 0);
export const dash = (v) => (v == null || v === '' ? '—' : String(v));
export const kv = (k, v) => el('div', { class: 'cc-kv' }, [el('span', { class: 'cc-kv-k' }, k), el('span', { class: 'cc-kv-v' }, v instanceof Node ? v : dash(v))]);
export const pill = (tone, text, title) => el('span', { class: 'cc-pill cc-pill-' + (tone || 'gray'), title: title || null }, text);
export const when = (ts) => (ts ? fmtDateTime(ts) : '—');
export const agoOr = (ts, none) => (ts ? ago(ts) : (none || 'never'));

export const TIER_LABEL = {
  new: 'New', unclaimed: 'Identity pending', screened: 'Screened · can post', verified: 'Verified', hold: 'On hold',
  authority_fail: 'Authority failed', authority_stale: 'Authority stale', agent_pending: 'Awaiting brokerage', agent_confirmed: 'Confirmed agent',
  business_verified: 'Business confirmed',
};
export const TIER_TONE = {
  new: 'gray', unclaimed: 'amber', screened: 'blue', verified: 'green', hold: 'red', authority_fail: 'red', authority_stale: 'red',
  agent_pending: 'amber', agent_confirmed: 'green', business_verified: 'blue',
};
export const tierPill = (tier) => pill(TIER_TONE[tier] || 'gray', TIER_LABEL[tier] || dash(tier), 'trust tier: ' + dash(tier));

// ------------------------------------------------------------------------------------------------
// styles (injected once; tokens keep dark mode right)
// ------------------------------------------------------------------------------------------------
let _css = false;
export function injectStyles() {
  if (_css) return; _css = true;
  document.head.appendChild(el('style', { html: `
.p360{--p360-ink:var(--lb-navy,#10223B);--p360-muted:var(--lb-muted,#64748b);--p360-line:var(--lb-border,#e2e8f0);--p360-surface:var(--lb-surface,#fff);--p360-soft:var(--lb-blue-soft,#eff6ff)}
.p360-hero{background:linear-gradient(135deg,#0b1b33 0%,#12294a 55%,#0f2f5c 100%);border-radius:20px;padding:24px 28px;color:#fff;box-shadow:0 18px 40px -22px rgba(8,30,63,.55);position:relative;overflow:hidden}
.p360-hero:before{content:"";position:absolute;inset:auto -80px -120px auto;width:320px;height:320px;border-radius:50%;background:radial-gradient(circle,rgba(8,131,247,.35),transparent 65%);pointer-events:none}
.p360-hero-row{display:flex;gap:20px;align-items:center;flex-wrap:wrap;position:relative}
.p360-avatar{width:68px;height:68px;border-radius:20px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:26px;flex:none;color:#fff;box-shadow:0 12px 26px -10px rgba(0,0,0,.5)}
.p360-avatar.broker{background:linear-gradient(135deg,#0883F7,#0a5fc2)}.p360-avatar.agent{background:linear-gradient(135deg,#7c3aed,#5b21b6)}.p360-avatar.shipper{background:linear-gradient(135deg,#0d9488,#0f766e)}.p360-avatar.facility{background:linear-gradient(135deg,#64748b,#334155)}
.p360-name{font-size:1.5rem;font-weight:800;letter-spacing:-.02em;line-height:1.15}
.p360-sub{color:#9db4d6;font-size:.86rem;margin-top:7px;display:flex;gap:6px 14px;flex-wrap:wrap}
.p360-sub b{color:#dbe7f7;font-weight:700}
.p360-eyebrow{font-size:.66rem;font-weight:800;letter-spacing:.12em;color:#7c8db5;text-transform:uppercase}
.p360 .cc-pill{text-transform:none}
.p360 .cc-kpi-grid{grid-template-columns:repeat(6,1fr)}
@media(max-width:1250px){.p360 .cc-kpi-grid{grid-template-columns:repeat(3,1fr)}}
@media(max-width:760px){.p360 .cc-kpi-grid{grid-template-columns:repeat(2,1fr)}}
@media(max-width:480px){.p360 .cc-kpi-grid{grid-template-columns:1fr}}
.p360-hero .cc-pill{background:rgba(255,255,255,.12);color:#fff;border:1px solid rgba(255,255,255,.18)}
.p360-hero .cc-pill.cc-pill-green{background:rgba(52,211,153,.22);color:#a7f3d0;border-color:rgba(52,211,153,.35)}
.p360-hero .cc-pill.cc-pill-amber{background:rgba(245,158,11,.22);color:#fde68a;border-color:rgba(245,158,11,.35)}
.p360-hero .cc-pill.cc-pill-red{background:rgba(248,113,113,.22);color:#fecaca;border-color:rgba(248,113,113,.35)}
.p360-hero .cc-pill.cc-pill-blue{background:rgba(96,165,250,.22);color:#bfdbfe;border-color:rgba(96,165,250,.35)}
.p360-hero-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;position:relative}
.p360-hero-actions .lb-btn{border-radius:12px}
.p360-hero-actions .lb-btn-ghost{background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.18)}
.p360-hero-actions .lb-btn-ghost:hover{background:rgba(255,255,255,.16)}
.p360-banner{display:flex;gap:14px;align-items:center;flex-wrap:wrap;border-radius:16px;padding:14px 18px;margin-top:16px;border:1px solid var(--p360-line);background:var(--p360-surface)}
.p360-banner.red{border-color:#fca5a5;background:rgba(220,38,38,.06)}.p360-banner.amber{border-color:#fcd34d;background:rgba(245,158,11,.07)}.p360-banner.green{border-color:#86efac;background:rgba(22,163,74,.06)}.p360-banner.blue{border-color:#93c5fd;background:rgba(8,131,247,.06)}
.p360-banner-ico{width:38px;height:38px;border-radius:12px;display:flex;align-items:center;justify-content:center;flex:none;background:var(--p360-soft);color:var(--lb-blue,#0883F7)}
.p360-banner.red .p360-banner-ico{background:rgba(220,38,38,.12);color:#dc2626}.p360-banner.amber .p360-banner-ico{background:rgba(245,158,11,.14);color:#b45309}.p360-banner.green .p360-banner-ico{background:rgba(22,163,74,.12);color:#15803d}
.p360-banner-t{font-weight:800;font-size:.92rem;color:var(--p360-ink)}.p360-banner-d{font-size:.84rem;color:var(--p360-muted);margin-top:2px;line-height:1.5}
.p360-nav{position:sticky;top:var(--lcx-head,78px);z-index:5;display:flex;gap:6px;flex-wrap:wrap;padding:8px 0;margin:14px 0 2px;background:var(--lb-bg,#f6f8fb)}
.p360-nav a{font-size:.8rem;font-weight:700;color:var(--p360-muted);padding:6px 12px;border-radius:999px;border:1px solid var(--p360-line);background:var(--p360-surface);text-decoration:none}
.p360-nav a:hover,.p360-nav a.on{color:var(--lb-blue,#0883F7);border-color:var(--lb-blue,#0883F7)}
.p360-sec{margin-top:16px;scroll-margin-top:140px}
.p360-head{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.p360-head h4{margin:0}
.p360-grid2{display:grid;grid-template-columns:1.4fr 1fr;gap:16px;margin-top:16px}
@media(max-width:980px){.p360-grid2{grid-template-columns:1fr}}
.p360-ladder{display:flex;flex-direction:column;gap:0;position:relative}
.p360-step{display:grid;grid-template-columns:34px 1fr auto;gap:12px;padding:10px 0;border-bottom:1px solid var(--p360-line);align-items:start}
.p360-step:last-child{border-bottom:0}
.p360-dot{width:26px;height:26px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.72rem;font-weight:800;border:2px solid var(--p360-line);color:var(--p360-muted);background:var(--p360-surface);margin-top:1px}
.p360-step.done .p360-dot{background:#16a34a;border-color:#16a34a;color:#fff}
.p360-step.current .p360-dot{border-color:var(--lb-blue,#0883F7);color:var(--lb-blue,#0883F7);box-shadow:0 0 0 4px rgba(8,131,247,.15)}
.p360-step.blocked .p360-dot{background:#dc2626;border-color:#dc2626;color:#fff}
.p360-step-l{font-weight:700;font-size:.9rem;color:var(--p360-ink)}
.p360-step.todo .p360-step-l{color:var(--p360-muted);font-weight:600}
.p360-step-d{font-size:.8rem;color:var(--p360-muted);margin-top:2px;line-height:1.5}
.p360-step.blocked .p360-step-d{color:#b91c1c}
.p360-step-r{font-size:.74rem;color:var(--p360-muted);text-align:right;white-space:nowrap}
.p360-block{border:1px solid var(--p360-line);border-radius:14px;padding:12px 14px;background:var(--p360-surface)}
.p360-block+.p360-block{margin-top:10px}
.p360-block-h{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px}
.p360-block-h b{font-size:.88rem}
.p360-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px 18px;margin-top:6px}
.p360-fact-l{font-size:.64rem;font-weight:800;letter-spacing:.08em;color:var(--p360-muted);text-transform:uppercase}
.p360-fact-v{font-weight:700;color:var(--p360-ink);margin-top:2px;font-size:.9rem;word-break:break-word}
.p360-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.p360-danger{border:1px solid #fca5a5!important;color:#b91c1c!important;background:transparent!important}
.p360-row{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--p360-line);flex-wrap:wrap}
.p360-row:last-child{border-bottom:0}
.p360-chip{background:var(--p360-soft);border:1px solid var(--p360-line);border-radius:8px;padding:3px 9px;font-size:.76rem;color:var(--p360-ink)}
.p360-chip b{color:var(--p360-muted);font-weight:700}
.p360-tabs{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px}
.p360-tabs button{border:1px solid var(--p360-line);background:var(--p360-surface);border-radius:999px;padding:5px 12px;font-size:.78rem;font-weight:700;color:var(--p360-muted);cursor:pointer}
.p360-tabs button.on{color:var(--lb-blue,#0883F7);border-color:var(--lb-blue,#0883F7)}
.p360-table{width:100%;border-collapse:collapse;font-size:.83rem}
.p360-table th{text-align:left;font-size:.66rem;letter-spacing:.08em;text-transform:uppercase;color:var(--p360-muted);padding:6px 8px;border-bottom:1px solid var(--p360-line)}
.p360-table td{padding:8px;border-bottom:1px solid var(--p360-line);vertical-align:top}
.p360-table tr:last-child td{border-bottom:0}
.p360-table tr.click{cursor:pointer}.p360-table tr.click:hover td{background:var(--lcx-hover,#f4f8ff)}
.p360-refresh{font-size:.74rem;color:var(--p360-muted);display:flex;gap:8px;align-items:center}
.p360-refresh button{border:0;background:transparent;color:var(--lb-blue,#0883F7);font-weight:700;cursor:pointer;font-size:.74rem}
.p360-empty{color:var(--p360-muted);font-size:.83rem;padding:6px 0}
.p360-note{background:var(--p360-soft);border:1px solid var(--p360-line);border-radius:10px;padding:9px 12px;font-size:.82rem;color:var(--p360-ink);line-height:1.55}
.p360-warn{background:rgba(220,38,38,.06);border:1px solid #fecaca;border-radius:12px;padding:10px 14px;font-size:.83rem;color:#7f1d1d;line-height:1.55}
` }));
}

// ------------------------------------------------------------------------------------------------
// page shell — fetch, dispatch, auto-refresh
// ------------------------------------------------------------------------------------------------
// renderers: { broker(ctx), agent(ctx), shipper(ctx), facility(ctx) } each returns [sectionNodes] and
// ctx = { d, orgId, manage, reload, role, sections: [] } — sections push {id,label} so the nav is built after.
export function mountPartner360(host, orgId, renderers) {
  injectStyles();
  mount(host, el('div', { class: 'cc-view p360' }, [
    el('a', { class: 'cc-back', href: '#/partners' }, '← Back to brokers & shippers'),
    el('div', { id: 'p360-body' }, el('div', { class: 'lb-state lb-loading' }, 'Loading partner 360…')),
  ]));
  const body = host.querySelector('#p360-body');
  if (!orgId) { mount(body, el('div', { class: 'cc-sub' }, 'No partner selected.')); return; }
  let timer = null, lastAt = null, alive = true, refreshing = false;
  // bl_bp_0457: `partners:live` broadcast from notify_partner / trust / packet / org triggers → refetch this org.
  const bump = coalesceEvents(() => { if (alive && document.visibilityState === 'visible') load(true); }, 500);
  const live = partnersLiveJoin((p) => { if (String(p.org_id) === String(orgId) || (lastOrg && String(p.org_id) === String(lastOrg))) bump(); });
  let lastOrg = null;
  const stop = () => { alive = false; if (timer) clearInterval(timer); document.removeEventListener('visibilitychange', onVis); try { live.leave(); } catch (_) {} };
  const onVis = () => { if (document.visibilityState === 'visible' && lastAt && Date.now() - lastAt > 25000) load(true); };
  document.addEventListener('visibilitychange', onVis);
  // stop refreshing once the view is swapped out
  const obs = new MutationObserver(() => { if (!document.body.contains(body)) { stop(); obs.disconnect(); } });
  obs.observe(host.parentNode || document.body, { childList: true, subtree: true });

  async function load(silent) {
    if (!alive || refreshing) return; refreshing = true;
    let d;
    try { d = await partner360(orgId); }
    catch (e) { refreshing = false; if (!silent) mount(body, el('div', { class: 'lb-state lb-error', style: 'margin:20px' }, [humanizeError(e), ' ', el('button', { class: 'lb-btn lb-btn-sm', onClick: () => load(false) }, 'Retry')])); return; }
    refreshing = false; lastAt = Date.now(); lastOrg = (d.org && d.org.id) || orgId;
    const role = d.role || (d.org && d.org.kind) || 'broker';
    // canonical hash for this role (a stale #/broker?id= link for an agent lands here, then the URL is fixed)
    const want = '#' + partnerRoute(role) + '?id=' + (d.org && d.org.id || orgId);
    if (location.hash !== want && /^#\/(broker|broker-agent|shipper)\?/.test(location.hash)) history.replaceState(null, '', want);
    const ctx = { d, orgId: (d.org && d.org.id) || orgId, role, manage: can('partners.manage') || can('dispatch.manage'), reload: () => load(true), sections: [] };
    const fn = renderers[role] || renderers.broker;
    const y = window.scrollY;
    let nodes; try { nodes = fn(ctx); } catch (e) { console.error(e); mount(body, el('div', { class: 'lb-state lb-error', style: 'margin:20px' }, 'Render failed: ' + (e && e.message))); return; }
    const refreshBar = el('div', { class: 'p360-refresh', style: 'justify-content:flex-end;margin-top:8px' }, [
      el('span', { title: live.isLive() ? 'Realtime: this screen re-reads the account the moment it changes (and every 30 s as a fallback)' : 'Realtime is not connected — this screen re-reads the account every 30 s while the tab is visible' },
        (live.isLive() ? 'live · realtime · updated ' : 'live · polling 30 s · updated ') + new Date(lastAt).toLocaleTimeString()),
      el('button', { onClick: () => load(false) }, '↻ refresh now'),
    ]);
    mount(body, [refreshBar, ...nodes]);
    if (silent) window.scrollTo(0, y);
    if (!timer) timer = setInterval(() => { if (document.visibilityState === 'visible') load(true); }, 30000);
  }
  load(false);
  return { reload: () => load(true), stop };
}

// ------------------------------------------------------------------------------------------------
// hero + banner + KPIs + section nav
// ------------------------------------------------------------------------------------------------
export function hero(ctx, opts) {
  const { d, role } = ctx; const o = d.org || {}; const own = d.owner || {}; const j = d.journey || {}; const prof = d.profile || {};
  const init = String(o.name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  const sub = (opts && opts.sub) || [];
  return el('div', { class: 'p360-hero' }, [
    el('div', { class: 'p360-hero-row' }, [
      el('div', { class: 'p360-avatar ' + role }, init),
      el('div', { style: 'flex:1;min-width:240px' }, [
        el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [
          el('span', { class: 'p360-name' }, o.name || ROLE_LABEL[role] || 'Partner'),
          pill('blue', ROLE_LABEL[role] || role),
          pill(j.stage_tone || 'gray', j.stage || 'New', 'onboarding stage'),
          o.is_demo ? pill('amber', 'demo account') : null,
          o.status === 'active' ? pill('green', 'account active') : pill('amber', 'account ' + dash(o.status)),
        ]),
        el('div', { class: 'p360-sub' }, sub.filter(Boolean).map((s) => el('span', null, s))),
        el('div', { class: 'p360-sub', style: 'margin-top:4px' }, [
          el('span', null, ['joined ', el('b', null, o.created_at ? fmtDate(o.created_at) : '—')]),
          el('span', null, ['last sign-in ', el('b', null, agoOr(own.last_sign_in_at))]),
          el('span', null, ['journey ', el('b', null, n0(j.done) + '/' + n0(j.total))]),
        ]),
      ]),
      el('div', { style: 'text-align:right;flex:none;min-width:180px' }, [
        el('div', { class: 'p360-eyebrow' }, 'Owner (staff only)'),
        el('div', { style: 'font-weight:700;font-size:.92rem;margin-top:3px' }, prof.contact_name || own.name || '—'),
        el('div', { style: 'color:#9db4d6;font-size:.84rem' }, own.email || '—'),
        el('div', { style: 'color:#9db4d6;font-size:.84rem' }, prof.phone || '—'),
      ]),
    ]),
    el('div', { class: 'p360-hero-actions' }, (opts && opts.actions) || []),
  ]);
}

export function nextActionBanner(ctx, handlers) {
  const j = ctx.d.journey || {}; const tone = j.stage_tone || 'blue';
  const blockers = Array.isArray(j.blockers) ? j.blockers : [];
  const btns = [];
  const cur = (j.steps || []).find((s) => s.state === 'current');
  const key = blockers.length ? blockers[0].action : (cur && cur.action);
  if (key && handlers && handlers[key]) btns.push(el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: handlers[key] }, handlers.labels && handlers.labels[key] || 'Do it'));
  return el('div', { class: 'p360-banner ' + tone }, [
    el('div', { class: 'p360-banner-ico' }, icon(tone === 'red' ? 'alert' : tone === 'green' ? 'check' : 'target', 18)),
    el('div', { style: 'flex:1;min-width:220px' }, [
      el('div', { class: 'p360-banner-t' }, blockers.length ? ('Blocked — ' + blockers.length + ' item' + (blockers.length > 1 ? 's need' : ' needs') + ' a human') : (tone === 'green' ? 'Nothing blocking' : 'Next for this account')),
      el('div', { class: 'p360-banner-d' }, j.next_action || '—'),
    ]),
    btns.length ? el('div', { style: 'display:flex;gap:8px' }, btns) : null,
  ]);
}

export function kpiRow(items) {
  return el('div', { class: 'cc-kpi-grid', style: 'margin:16px 0 0' }, items.filter(Boolean).map((k) => statCard(k)));
}

export function sectionNav(sections) {
  const nav = el('div', { class: 'p360-nav' }, sections.map((s) => el('a', { href: '#' + location.hash.slice(1), dataset: { sec: s.id }, onClick: (e) => { e.preventDefault(); const t = document.getElementById(s.id); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); } }, s.label)));
  // scroll spy
  const spy = () => {
    let best = null; sections.forEach((s) => { const t = document.getElementById(s.id); if (t && t.getBoundingClientRect().top < 180) best = s.id; });
    nav.querySelectorAll('a').forEach((a) => a.classList.toggle('on', a.dataset.sec === best));
  };
  window.addEventListener('scroll', spy, { passive: true }); setTimeout(spy, 50);
  return nav;
}

export function section(id, label, node, ctx) {
  if (ctx) ctx.sections.push({ id, label });
  return el('div', { id, class: 'p360-sec' }, node);
}

export const head = (title, right) => el('div', { class: 'p360-head' }, [el('h4', { class: 'cc-card-title' }, title), right || null]);
export const facts = (pairs) => el('div', { class: 'p360-facts' }, pairs.filter(Boolean).map(([l, v]) => el('div', null, [el('div', { class: 'p360-fact-l' }, l), el('div', { class: 'p360-fact-v' }, v instanceof Node ? v : dash(v))])));
export const block = (title, right, children) => el('div', { class: 'p360-block' }, [el('div', { class: 'p360-block-h' }, [el('b', null, title), right || null]), ...(children || [])]);

// ------------------------------------------------------------------------------------------------
// journey ladder
// ------------------------------------------------------------------------------------------------
export function journeyCard(ctx, handlers) {
  const j = ctx.d.journey || {}; const steps = Array.isArray(j.steps) ? j.steps : [];
  const ICON = { done: '✓', blocked: '!', current: '●', todo: '' };
  return card([
    head('Onboarding journey', el('span', { class: 'cc-sub' }, n0(j.done) + ' of ' + n0(j.total) + ' steps done · same facts the partner sees in the portal')),
    el('div', { class: 'p360-ladder' }, steps.map((s, i) => el('div', { class: 'p360-step ' + (s.state || 'todo') }, [
      el('div', { class: 'p360-dot' }, ICON[s.state] || String(i + 1)),
      el('div', null, [
        el('div', { class: 'p360-step-l' }, s.label),
        s.detail ? el('div', { class: 'p360-step-d' }, s.detail) : null,
      ]),
      el('div', { class: 'p360-step-r' }, [
        s.at ? el('div', null, fmtDateTime(s.at)) : null,
        (s.action && handlers && handlers[s.action] && s.state !== 'done') ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', style: 'margin-top:4px', onClick: handlers[s.action] }, (handlers.labels && handlers.labels[s.action]) || 'Open') : null,
      ]),
    ]))),
  ]);
}

// ------------------------------------------------------------------------------------------------
// trust actions (brokers + agents share cc_broker_trust_set; shippers use cc_shipper_trust_set)
// ------------------------------------------------------------------------------------------------
export async function brokerTrustAct(ctx, action, opts) {
  const o = opts || {};
  let note = o.note ?? null;
  if (o.ask) { note = await askReason(o.ask, { placeholder: o.placeholder || 'Recorded in the audit log — be specific.', optional: !!o.optional, submitLabel: o.label || 'Confirm' }); if (note == null) return false; if (!note && !o.optional) return false; }
  if (o.confirm && !(await askConfirm(o.confirm, { body: o.body || '', danger: !!o.danger, confirmLabel: o.label || 'Confirm' }))) return false;
  try { await ccBrokerTrustSet(ctx.orgId, action, note); toast(o.done || 'Done', 'success'); ctx.reload(); return true; }
  catch (e) { toast(humanizeError(e), 'error'); return false; }
}
export async function shipperTrustAct(ctx, action, opts) {
  const o = opts || {};
  let note = o.note ?? null;
  if (o.ask) { note = await askReason(o.ask, { placeholder: o.placeholder || 'Recorded in the audit log.', optional: !!o.optional, submitLabel: o.label || 'Confirm' }); if (note == null) return false; if (!note && !o.optional) return false; }
  try { await ccShipperTrustSet(ctx.orgId, action, note); toast(o.done || 'Done', 'success'); ctx.reload(); return true; }
  catch (e) { toast(humanizeError(e), 'error'); return false; }
}

export function holdReleaseButtons(ctx, act) {
  const t = ctx.d.trust || {}; const onHold = !!t.hold_reason;
  if (!ctx.manage) return [];
  return onHold
    ? [el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: () => act(ctx, 'release', { ask: 'Release the hold — note to the partner (optional):', optional: true, done: 'Hold released — partner notified' }) }, '▶ Release hold')]
    : [el('button', { class: 'lb-btn lb-btn-sm p360-danger', onClick: () => act(ctx, 'hold', { ask: '⛔ Put this account on hold — reason (the partner reads these words):', done: 'On hold — posting paused, partner notified' }) }, '⛔ Hold account')];
}

// ------------------------------------------------------------------------------------------------
// approve / park (cc_partner_set_status) — the account gate
// ------------------------------------------------------------------------------------------------
export function gateRow(ctx, opts) {
  const { d, orgId, manage, reload } = ctx; const o = d.org || {}; const j = d.journey || {};
  if (!manage) return null;
  const canApprove = opts && typeof opts.canApprove === 'boolean' ? opts.canApprove : true;
  const why = (opts && opts.whyNot) || '';
  return el('div', { class: 'p360-block', style: 'display:flex;gap:9px;align-items:center;flex-wrap:wrap' }, [
    o.status === 'active'
      ? el('button', { class: 'lb-btn lb-btn-primary', disabled: 'disabled', style: 'opacity:.7' }, '✓ Account approved')
      : !canApprove
      ? el('button', { class: 'lb-btn lb-btn-primary', disabled: 'disabled', style: 'opacity:.6', title: why }, '✓ Approve account (' + (why || 'not yet') + ')')
      : el('button', { class: 'lb-btn lb-btn-primary', onClick: async (ev) => {
          const b = ev.currentTarget;
          if (!await askConfirm('Approve this account?', { body: (opts && opts.approveBody) || 'The account goes active and the partner is notified in-app.', confirmLabel: 'Approve' })) return;
          b.disabled = true;
          try { await partnerSetStatus(orgId, 'approve', null); toast('Approved — partner notified 🎉', 'success'); reload(); } catch (e) { b.disabled = false; toast(humanizeError(e), 'error'); }
        } }, '✓ Approve account'),
    pill(o.status === 'active' ? 'green' : 'amber', 'status: ' + dash(o.status)),
    el('span', { class: 'cc-sub' }, j.next_action ? ('→ ' + j.next_action) : ''),
    el('button', { class: 'lb-btn lb-btn-sm p360-danger', style: 'margin-left:auto', onClick: async (ev) => {
      const b = ev.currentTarget;
      const why9 = await askReason((o.status === 'active' ? 'Revoke approval / park the account' : 'Park the account') + ' — reason (the partner reads this):', { placeholder: 'What must they fix? They see these exact words in-app.' }); if (!why9) return;
      b.disabled = true;
      try { await partnerSetStatus(orgId, 'park', why9); toast('Account parked — posting paused, partner notified', 'info'); reload(); } catch (e) { b.disabled = false; toast(humanizeError(e), 'error'); }
    } }, o.status === 'active' ? '✕ Revoke approval' : '✕ Park account'),
  ]);
}

// ------------------------------------------------------------------------------------------------
// packet review card (lifted from broker360 v1, unchanged behaviour: verify / waive / reject / remind)
// ------------------------------------------------------------------------------------------------
const HINTS = {
  mc_authority: 'Check the MC on the letter against FMCSA — name and status must match.',
  bmc84_bond: 'Bond must be ACTIVE and $75,000 — call the surety if the certificate looks stale.',
  boc3: 'Process-agent filing on file with FMCSA (auto-verified from the screen when authority passes).',
  w9: 'Legal name + 9-digit TIN + signature. Signed-online copies carry the data (⬇ Executed W-9).',
  coi: 'GL / E&O / contingent cargo current — check expiry dates and insured name.',
  broker_agreement: 'Open ⬇ Executed agreement — signer name and date must be present.',
  bank_instructions: 'Match the voided check to the typed account/routing before verifying.',
  claims_procedure: 'A named contact + phone + a real process — not just “we handle it”.',
  billing_instructions: 'Who receives invoices, how they pay (ACH / check), and their AP contact.',
  claims_contact: 'A named claims contact with a phone that answers.',
  signed_agreement: 'Shipper Agreement — accepted with one click in the portal once published; a signed PDF is the fallback.',
  credit_application: 'Legal entity, EIN, trade references, requested terms.',
};
const REJECT_REASONS = ['Illegible / wrong document uploaded', 'Expired or inactive — needs a current one', 'Details do not match the FMCSA record', 'Wrong format — official PDF required (screenshots rejected)', 'Incomplete information / fields missing', 'Suspected altered or fraudulent document', 'Other (describe below)'];
const filePathOf = (ref) => { const m = /file:([^\s·]+)/.exec(ref || ''); return m ? m[1] : null; };

export function packetCard(ctx, opts) {
  const { d, orgId, manage, reload } = ctx; const packet = Array.isArray(d.packet) ? d.packet : []; const ps = d.packet_summary || {};
  const o = opts || {};
  const done = n0(ps.mandatory_done), total = n0(ps.mandatory_total), aw = n0(ps.awaiting), rej = n0(ps.rejected);
  const headPill = o.notGating ? pill('gray', 'does not gate approval') : (done >= total && total > 0) ? pill('green', 'complete · ' + done + '/' + total) : aw ? pill('blue', aw + ' awaiting review · ' + done + '/' + total) : rej ? pill('red', rej + ' rejected · ' + done + '/' + total) : pill('amber', done + '/' + total + ' required');
  const openState = o.collapsed ? null : 'open';
  const rows = packet.map((it) => packetRow(it, ctx));
  return card([
    head(o.title || 'Onboarding packet — review & decide', el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [
      headPill, n0(ps.expiring_30d) ? pill('amber', ps.expiring_30d + ' expiring < 30 d') : null, n0(ps.lapsed) ? pill('red', ps.lapsed + ' lapsed') : null,
    ])),
    o.explainer ? el('div', { class: 'p360-note', style: 'margin-bottom:8px' }, o.explainer) : null,
    o.collapsed ? el('details', { open: openState }, [el('summary', { class: 'cc-sub', style: 'cursor:pointer;font-weight:700' }, 'Show the ' + packet.length + ' packet items'), el('div', null, rows)]) : el('div', null, rows),
  ]);

  function packetRow(it, ctx2) {
    const st = it.status;
    const tone = st === 'verified' ? 'green' : st === 'waived' ? 'green' : st === 'rejected' ? 'red' : st === 'submitted' ? 'blue' : 'amber';
    const fpath = filePathOf(it.ref);
    const refTxt = (it.ref || '').replace(/file:[^\s·]+/, '').replace(/^\s*·\s*|\s*·\s*$/g, '');
    const pairs = (refTxt || '').split('·').map((x) => /^\s*([^:]{2,40}):\s*(.+)\s*$/.exec(x)).filter(Boolean);
    const chips = pairs.length >= 2 ? el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:5px' }, pairs.map((m) => el('span', { class: 'p360-chip' }, [el('b', null, m[1].trim() + ': '), m[2].trim()]))) : null;
    let sd = null; try { sd = it.note && it.note.trim().startsWith('{') ? JSON.parse(it.note) : null; } catch (_) { sd = null; }
    const meta = [
      '[' + String(it.tag || '').toUpperCase() + (it.mandatory ? ' · required' : '') + ']',
      (!chips && refTxt) ? refTxt : null,
      it.submitted_at ? 'submitted ' + fmtDateTime(it.submitted_at) : null,
      it.reviewed_at ? (st + ' ' + fmtDateTime(it.reviewed_at) + (it.reviewed_by ? ' by ' + it.reviewed_by : '')) : null,
      it.expires_at ? 'expires ' + fmtDate(it.expires_at) : null,
      (st === 'rejected' && it.note && !sd) ? '✕ ' + it.note : null,
      (st === 'submitted' && !fpath && !sd) ? '⚠ no file on record — text-only submission' : null,
    ].filter(Boolean).join(' · ');
    return el('div', { class: 'p360-row' }, [
      el('div', { style: 'min-width:220px;flex:1' }, [el('b', { style: 'font-size:.9rem' }, it.label), el('div', { class: 'cc-sub' }, meta), chips]),
      el('div', { style: 'display:flex;gap:6px;align-items:center;flex:none;flex-wrap:wrap' }, [
        pill(tone, st),
        fpath ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: async (ev) => { const b = ev.currentTarget; b.disabled = true; try { const u = await signedDocumentUrl(fpath, 300); window.open(u, '_blank', 'noopener'); } catch (e) { toast(humanizeError(e)); } b.disabled = false; } }, [icon('eye', 15), ' View file']) : null,
        (sd && it.key === 'w9') ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: () => printExecutedW9(Object.assign({ approved: st === 'verified' }, sd)) }, '⬇ Executed W-9') : null,
        (sd && (it.key === 'broker_agreement' || it.key === 'signed_agreement') && sd.body) ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: () => printExecutedAgreementDoc(sd) }, '⬇ Executed agreement') : null,
        (manage && st !== 'verified' && st !== 'waived') ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: async (ev) => { const b = ev.currentTarget; b.disabled = true; try { await onboardingReviewItem(orgId, it.key, 'verify', null); toast(it.label + ' verified — partner notified', 'success'); reload(); } catch (e) { b.disabled = false; toast(humanizeError(e), 'error'); } } }, '✓ Verify') : null,
        (manage && (st === 'missing' || st === 'pending' || st === 'rejected')) ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', title: 'In-app + branded email reminder naming this item', onClick: async (ev) => { const b = ev.currentTarget; b.disabled = true; try { const r = await partnerPacketRemind(orgId, it.key); toast('Reminder sent — in-app + ' + ((r && r.emails) || 0) + ' email(s)', 'success'); } catch (e) { toast(humanizeError(e), 'error'); } b.disabled = false; } }, '🔔 Remind') : null,
        manage ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: () => actionsDrawer(it, st) }, '⚙ Actions') : null,
        (manage && st !== 'rejected') ? el('button', { class: 'lb-btn lb-btn-sm p360-danger', onClick: () => rejectDrawer(it) }, '✕ Reject') : null,
      ].filter(Boolean)),
    ]);
  }

  function actionsDrawer(it, st) {
    const dA = openDrawer('⚙ Actions — ' + it.label, [
      el('div', { class: 'cc-sub' }, '[' + String(it.tag || '').toUpperCase() + '] · status: ' + st + (it.submitted_at ? ' · submitted ' + fmtDateTime(it.submitted_at) : '')),
      HINTS[it.key] ? el('div', { class: 'p360-note', style: 'margin-top:8px' }, '🎛 Review hint: ' + HINTS[it.key]) : null,
      el('div', { class: 'p360-actions' }, [
        (st !== 'verified') ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: async (ev) => { const b = ev.currentTarget; b.disabled = true; try { await onboardingReviewItem(orgId, it.key, 'verify', null); toast('Verified — partner notified', 'success'); dA.close(); reload(); } catch (e) { b.disabled = false; toast(humanizeError(e), 'error'); } } }, '✓ Verify') : null,
        el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: async (ev) => { const b = ev.currentTarget; const why = await askReason('Waive "' + it.label + '" — reason (audited; item counts as satisfied):'); if (!why) return; b.disabled = true; try { await onboardingReviewItem(orgId, it.key, 'waive', why); toast('Waived', 'info'); dA.close(); reload(); } catch (e) { b.disabled = false; toast(humanizeError(e), 'error'); } } }, 'Waive'),
        el('button', { class: 'lb-btn lb-btn-sm p360-danger', onClick: async (ev) => { const b = ev.currentTarget; const why = await askReason('⚠ Reject + WARN — reason (rejects the item AND issues a −5 pt document strike):'); if (!why) return; b.disabled = true; try { await onboardingReviewItem(orgId, it.key, 'reject', why); await issueViolation(orgId, 'document', 'warning', '[' + it.label + '] ' + why); toast('Rejected + strike issued', 'info'); dA.close(); reload(); } catch (e) { b.disabled = false; toast(humanizeError(e), 'error'); } } }, [icon('alert', 15), ' Reject + warn']),
      ].filter(Boolean)),
    ].filter(Boolean), { size: 'sm' });
  }

  function rejectDrawer(it) {
    const cat = el('select', { class: 'cc-input' }, REJECT_REASONS.map((x) => el('option', { value: x }, x)));
    const why = el('textarea', { class: 'cc-input', rows: '4', placeholder: 'Description (required) — the partner reads these exact words in-app and by branded email.' });
    const required = !!it.mandatory && !o.notGating;
    const dr = openDrawer('✕ Reject — ' + it.label, [
      el('div', { class: 'cc-sub' }, '[' + String(it.tag || '').toUpperCase() + ']' + (it.submitted_at ? ' · submitted ' + fmtDateTime(it.submitted_at) : '') + (it.ref ? ' · ' + String(it.ref).slice(0, 80) : '')),
      el('label', { class: 'cc-sub', style: 'font-weight:700;margin-top:12px;display:block' }, 'Reason category'), cat,
      el('label', { class: 'cc-sub', style: 'font-weight:700;margin-top:12px;display:block' }, 'Description (required)'), why,
      el('div', { class: 'p360-warn', style: 'margin-top:12px' }, [
        el('div', { style: 'font-weight:800;margin-bottom:3px' }, 'What happens:'),
        'Partner gets an urgent notification + branded email with your reason · the item goes back to them to fix & resubmit'
        + (required ? ' · their packet turns INCOMPLETE, the account goes PENDING and load posting STOPS until this is verified again.' : ' · ' + (o.notGating ? 'this packet does not gate a broker agent — account status and posting are not affected.' : String(it.tag || 'optional').toLowerCase() + ' item — account status and posting are not affected.')),
      ]),
      el('div', { style: 'display:flex;gap:8px;margin-top:14px' }, [
        el('button', { class: 'lb-btn lb-btn-primary', style: 'background:#b91c1c;border-color:#b91c1c', onClick: async (ev) => {
          if (!why.value.trim()) { toast('Description is required — the partner must know exactly what to fix.'); return; }
          const b = ev.currentTarget; b.disabled = true; b.textContent = 'Rejecting…';
          try { await onboardingReviewItem(orgId, it.key, 'reject', cat.value + ' — ' + why.value.trim()); dr.close(); toast('Rejected — partner notified + emailed' + (required ? ' · account parked (pending)' : ''), 'info'); reload(); }
          catch (e) { b.disabled = false; b.textContent = '✕ Reject item'; toast(humanizeError(e)); }
        } }, '✕ Reject item'),
        el('button', { class: 'lb-btn lb-btn-ghost', onClick: () => dr.close() }, 'Cancel'),
      ]),
    ]);
  }
}

export function bankCard(ctx) {
  const { d, orgId, manage, reload } = ctx;
  const bankIt = (d.packet || []).find((x) => x.key === 'bank_instructions' || x.key === 'billing_instructions');
  if (!bankIt) return null;
  const kvs = {};
  String(bankIt.ref || '').split('·').forEach((seg) => { const m = /^\s*([^:]+):\s*(.+)\s*$/.exec(seg); if (m) kvs[m[1].trim().toLowerCase()] = m[2].trim(); });
  const get = (k) => { const kk = Object.keys(kvs).find((x) => x.startsWith(k)); return kk ? kvs[kk] : null; };
  const st = bankIt.status; const fpath = filePathOf(bankIt.ref);
  return card([
    head(bankIt.key === 'bank_instructions' ? 'Payout & bank details' : 'Billing instructions', pill(st === 'verified' ? 'green' : st === 'rejected' ? 'red' : 'amber', st)),
    facts([['Bank', get('bank name')], ['Account holder', get('account holder')], ['Account #', get('account number')], ['Routing / ABA', get('routing')], ['Account type', get('account type')], ['Bank address', get('bank address')], ['Bank phone', get('bank phone')], ['Remittance / AP email', get('remittance') || get('ap') || get('invoice')]]),
    el('div', { class: 'p360-actions' }, [
      fpath ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: async (ev) => { const b = ev.currentTarget; b.disabled = true; try { const u = await signedDocumentUrl(fpath, 300); window.open(u, '_blank', 'noopener'); } catch (e) { toast(humanizeError(e)); } b.disabled = false; } }, [icon('eye', 15), ' Voided check / bank letter']) : el('span', { class: 'cc-sub' }, [icon('alert', 15), ' no voided check on file']),
      (manage && st !== 'verified') ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: async (ev) => { const b = ev.currentTarget; b.disabled = true; try { await onboardingReviewItem(orgId, bankIt.key, 'verify', null); toast('Verified — partner notified', 'success'); reload(); } catch (e) { b.disabled = false; toast(humanizeError(e), 'error'); } } }, '✓ Verify') : null,
      (manage && st !== 'rejected') ? el('button', { class: 'lb-btn lb-btn-sm p360-danger', onClick: async (ev) => { const b = ev.currentTarget; const why = await askReason('Reject — reason (partner notified + emailed):'); if (!why) return; b.disabled = true; try { await onboardingReviewItem(orgId, bankIt.key, 'reject', why); toast('Rejected — partner notified', 'info'); reload(); } catch (e) { b.disabled = false; toast(humanizeError(e), 'error'); } } }, '✕ Reject with reason') : null,
    ].filter(Boolean)),
  ]);
}

// ------------------------------------------------------------------------------------------------
// agreements
// ------------------------------------------------------------------------------------------------
export function agreementBlock(ctx, kind, label) {
  const acc = (ctx.d.agreements || []).find((a) => a.kind === kind);
  const pub = (ctx.d.agreements_published || []).find((a) => a.kind === kind);
  return block(label, acc ? pill('green', 'accepted v' + acc.version) : pub ? pill('amber', 'not accepted yet') : pill('red', 'NOT PUBLISHED'), [
    acc ? el('div', { class: 'cc-sub' }, 'Accepted ' + fmtDateTime(acc.accepted_at) + (acc.accepted_by ? ' by ' + acc.accepted_by : '')) : null,
    (!acc && pub) ? el('div', { class: 'cc-sub' }, 'One click in the portal. Published v' + pub.version + ' · ' + fmtDate(pub.published_at) + '. Posting is gated on it.') : null,
    (!acc && !pub) ? el('div', { class: 'p360-warn', style: 'margin-top:6px' }, 'No published ' + kind + ' agreement exists — the partner cannot accept it and this step stays blocked. Publish it under Command Center → Legal / agreements.') : null,
  ]);
}

// ------------------------------------------------------------------------------------------------
// activity: loads (broker / agent / shipper-as-poster), shipments (shipper), offers, invoices, claims
// ------------------------------------------------------------------------------------------------
export function loadsCard(ctx, title) {
  const loads = Array.isArray(ctx.d.loads) ? ctx.d.loads : []; const ls = ctx.d.load_stats || {}; const of = ctx.d.offers || {};
  const tone = (s) => ({ submitted: 'amber', posted: 'blue', open: 'blue', covered: 'green', delivered: 'green', cancelled: 'red', declined: 'red', rejected: 'red', expired: 'gray' }[s] || 'gray');
  return card([
    head(title || 'Loads', el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, [
      pill('gray', n0(ls.total) + ' total'), pill('blue', n0(ls.last_30d) + ' in 30 d'), n0(ls.submitted) ? pill('amber', n0(ls.submitted) + ' awaiting review') : null, pill('green', n0(ls.covered) + ' covered · ' + n0(ls.delivered) + ' delivered'), n0(ls.cancelled) ? pill('red', n0(ls.cancelled) + ' cancelled') : null,
    ])),
    el('div', { class: 'cc-sub', style: 'margin-bottom:8px' }, 'Offers sent ' + n0(of.sent) + ' · accepted ' + n0(of.accepted) + ' · declined ' + n0(of.declined) + ' · expired ' + n0(of.expired) + ' · pending ' + n0(of.pending)),
    loads.length ? el('div', { style: 'overflow:auto' }, el('table', { class: 'p360-table' }, [
      el('thead', null, el('tr', null, ['Lane', 'Equip', 'Rate', 'Pickup', 'Status', 'Board', 'Carrier / trip', 'Offers', 'Claims'].map((h) => el('th', null, h)))),
      el('tbody', null, loads.map((l) => el('tr', { class: l.posted_load_id ? 'click' : null, title: l.posted_load_id ? 'Open in Loads' : 'Not posted to the board yet', onClick: () => { if (l.posted_load_id) location.hash = '#/loads?id=' + l.posted_load_id; } }, [
        el('td', null, [el('b', null, (l.origin || '?') + ' → ' + (l.destination || '?')), el('div', { class: 'cc-sub' }, [l.reference ? 'ref ' + l.reference + ' · ' : '', l.agent_parent ? 'under ' + l.agent_parent + ' · ' : '', 'created ' + fmtDate(l.created_at)])]),
        el('td', null, dash(l.equipment)), el('td', null, l.rate ? money(l.rate) : '—'), el('td', null, l.pickup_date ? fmtDate(l.pickup_date) : '—'),
        el('td', null, pill(tone(l.status), dash(l.status))),
        el('td', null, l.posted_load_id ? el('span', null, [pill(tone(l.board_status), dash(l.board_status)), l.verification_state ? el('div', { class: 'cc-sub' }, l.verification_state) : null]) : el('span', { class: 'cc-sub' }, 'not posted')),
        el('td', null, l.trip ? el('a', { href: '#/carrier?id=' + l.trip.carrier_id, onClick: (e) => e.stopPropagation() }, [el('b', null, l.trip.carrier || 'carrier'), el('div', { class: 'cc-sub' }, dash(l.trip.status) + (l.trip.delivered_at ? ' · delivered ' + fmtDate(l.trip.delivered_at) : ''))]) : '—'),
        el('td', null, String(n0(l.offers))), el('td', null, n0(l.claims) ? pill('amber', String(l.claims)) : '0'),
      ]))),
    ])) : el('div', { class: 'p360-empty' }, 'No loads submitted yet.'),
  ]);
}

export function shipmentsCard(ctx) {
  const ships = Array.isArray(ctx.d.shipments) ? ctx.d.shipments : []; const ss = ctx.d.shipment_stats || {};
  const tone = (s) => ({ new: 'amber', assigned: 'blue', quoted: 'blue', booked: 'green', tendered: 'green', accepted: 'green', closed: 'gray', declined: 'red' }[s] || 'gray');
  return card([
    head('Shipment requests', el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' }, [pill('gray', n0(ss.total) + ' total'), pill('blue', n0(ss.last_30d) + ' in 30 d'), pill('amber', n0(ss.open) + ' open'), pill('green', n0(ss.quoted) + ' quoted · ' + n0(ss.booked) + ' booked')])),
    ships.length ? el('div', { style: 'overflow:auto' }, el('table', { class: 'p360-table' }, [
      el('thead', null, el('tr', null, ['Lane', 'Ready', 'Equip / commodity', 'Status', 'Broker', 'Quote', 'Complete?'].map((h) => el('th', null, h)))),
      el('tbody', null, ships.map((s) => el('tr', { class: 'click', title: 'Open in Partner intake → Shipper freight', onClick: () => { location.hash = '#/partner-intake?id=' + s.id; } }, [
        el('td', null, [el('b', null, (s.origin || '?') + ' → ' + (s.destination || '?')), el('div', { class: 'cc-sub' }, (s.ref_po ? 'PO ' + s.ref_po + ' · ' : '') + 'created ' + fmtDate(s.created_at))]),
        el('td', null, s.ready_date ? fmtDate(s.ready_date) : '—'),
        el('td', null, [dash(s.equipment), el('div', { class: 'cc-sub' }, dash(s.commodity) + (s.weight ? ' · ' + Number(s.weight).toLocaleString() + ' lb' : ''))]),
        el('td', null, pill(tone(s.status), dash(s.status))),
        el('td', null, s.assigned_broker_id ? el('a', { href: '#/broker?id=' + s.assigned_broker_id, onClick: (e) => e.stopPropagation() }, s.assigned_broker || 'broker') : '—'),
        el('td', null, s.quote_amount ? money(s.quote_amount) : '—'),
        el('td', null, s.complete ? pill('green', 'facility + dock hours') : pill('amber', 'missing facility notes / dock hours')),
      ]))),
    ])) : el('div', { class: 'p360-empty' }, 'No shipment requests yet.'),
  ]);
}

export function claimsCard(ctx) {
  const claims = Array.isArray(ctx.d.claims) ? ctx.d.claims : [];
  return card([
    head('Claims on their loads', pill(claims.length ? 'amber' : 'gray', claims.length + ' on file')),
    claims.length ? el('div', null, claims.map((a) => el('div', { class: 'p360-row', style: 'cursor:pointer', title: 'Open evidence bundle', onClick: async () => {
      let b = null; try { b = await claimBundle(a.id); } catch (e) { toast(humanizeError(e), 'error'); return; }
      const c = (b && b.claim) || {};
      const box = (v) => el('pre', { style: 'font-size:.74rem;background:var(--lb-bg,#f6f8fb);border:1px solid var(--lb-border,#e8edf3);border-radius:8px;padding:8px;max-height:340px;overflow:auto;margin-top:8px;white-space:pre-wrap' }, JSON.stringify(v, null, 2));
      openDrawer('Claim ' + (c.ref || ''), [el('div', { class: 'cc-sub' }, (a.origin || '') + ' → ' + (a.destination || '') + ' · ' + String(a.kind || '').toUpperCase()), box({ timeline: b.timeline, gps_dwell: b.gps_dwell, stop_documents: b.stop_documents }), el('div', { class: 'cc-sub', style: 'margin-top:6px' }, 'Decide in Exception Center → Pay claims, or from the carrier’s 360 trip drawer.')], { size: 'lg' });
    } }, [
      el('div', null, [el('b', { style: 'font-size:.88rem' }, String(a.kind || '').toUpperCase() + ' — ' + (a.origin || '') + ' → ' + (a.destination || '')), el('div', { class: 'cc-sub' }, fmtDateTime(a.created_at) + (a.amount > 0 ? ' · ' + money(a.amount) : ''))]),
      el('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap' }, [statusPill(a.status), a.broker_status === 'approved' ? pill('green', '✓ broker ok') : a.broker_status === 'disputed' ? pill('red', 'disputed') : null, a.support_status === 'open' ? pill('blue', '🎧 escalated') : null].filter(Boolean)),
    ]))) : el('div', { class: 'p360-empty' }, 'No claims filed on their loads.'),
  ]);
}

export function invoicesBlock(ctx) {
  const inv = ctx.d.invoices || {};
  return block('LoadBoot invoices to this partner', n0(inv.overdue) ? pill('red', inv.overdue + ' overdue') : n0(inv.open) ? pill('amber', inv.open + ' open') : pill('green', 'clear'), [
    facts([['Invoices', n0(inv.count)], ['Open amount', money(inv.open_amount)], ['Paid to date', money(inv.paid_amount)], ['Last paid', inv.last_paid_at ? fmtDate(inv.last_paid_at) : '—']]),
    el('div', { class: 'p360-actions' }, [el('a', { class: 'lb-btn lb-btn-sm lb-btn-ghost', href: '#/partner-intake' }, 'Invoices in Partner intake →')]),
  ]);
}

// ------------------------------------------------------------------------------------------------
// comms: what left the system for this account
// ------------------------------------------------------------------------------------------------
export function commsCard(ctx) {
  const c = ctx.d.comms || {}; const emails = c.emails || [], notices = c.notices || [], blocked = c.blocked || [], staff = c.staff_notices || [];
  const host = el('div');
  const tabs = [['emails', 'Emails ' + emails.length], ['notices', 'In-app ' + notices.length + (n0(c.unread_notices) ? ' (' + c.unread_notices + ' unread)' : '')], ['blocked', 'Blocked ' + blocked.length], ['staff', 'Staff alerts ' + staff.length]];
  let cur = blocked.length ? 'blocked' : 'emails';
  const tabBar = el('div', { class: 'p360-tabs' }, tabs.map(([k, l]) => el('button', { class: k === cur ? 'on' : '', dataset: { k }, onClick: (e) => { cur = k; tabBar.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.k === k)); draw(); } }, l)));
  const stTone = (s) => ({ sent: 'green', delivered: 'green', opened: 'green', claimed: 'blue', queued: 'amber', scheduled: 'amber', failed: 'red', blocked: 'red', bounced: 'red' }[s] || 'gray');
  function draw() {
    if (cur === 'emails') mount(host, emails.length ? el('table', { class: 'p360-table' }, [
      el('thead', null, el('tr', null, ['Email', 'To', 'Status', 'When', 'Opened'].map((h) => el('th', null, h)))),
      el('tbody', null, emails.map((m) => el('tr', null, [
        el('td', null, [el('b', null, m.name || m.key), el('div', { class: 'cc-sub' }, m.key + ' · ' + dash(m.channel))]),
        el('td', null, dash(m.to)), el('td', null, [pill(stTone(m.status), dash(m.status)), m.failure ? el('div', { class: 'cc-sub' }, m.failure) : null]),
        el('td', null, when(m.sent_at || m.created_at)), el('td', null, m.opened_at ? '✓ ' + ago(m.opened_at) + (m.clicked_at ? ' · clicked' : '') : '—'),
      ]))),
    ]) : el('div', { class: 'p360-empty' }, 'No emails on record for this account.'));
    else if (cur === 'notices') mount(host, notices.length ? el('div', null, notices.map((n) => el('div', { class: 'p360-row' }, [
      el('div', { style: 'flex:1;min-width:240px' }, [el('b', { style: 'font-size:.86rem' }, (n.read_at ? '' : '● ') + n.title), el('div', { class: 'cc-sub', style: 'white-space:pre-wrap' }, n.body || ''), el('div', { class: 'cc-sub' }, 'links to ' + dash(n.url))]),
      el('div', { style: 'text-align:right' }, [pill(n.kind === 'urgent' ? 'red' : n.kind === 'success' ? 'green' : 'gray', dash(n.kind)), el('div', { class: 'cc-sub' }, fmtDateTime(n.created_at)), el('div', { class: 'cc-sub' }, n.read_at ? 'read ' + ago(n.read_at) : 'unread')]),
    ]))) : el('div', { class: 'p360-empty' }, 'No in-app notices yet.'));
    else if (cur === 'blocked') mount(host, blocked.length ? el('div', null, [el('div', { class: 'p360-warn', style: 'margin-bottom:8px' }, 'These sends were refused by the unsubscribe engine (bl_comm_0446). Do not route around them — the reason names what the person asked for.'), ...blocked.map((b) => el('div', { class: 'p360-row' }, [el('div', null, [el('b', null, b.key), el('div', { class: 'cc-sub' }, b.reason)]), el('div', { class: 'cc-sub' }, fmtDateTime(b.created_at))]))]) : el('div', { class: 'p360-empty' }, 'Nothing blocked — every email to this account was allowed to send.'));
    else mount(host, staff.length ? el('div', null, staff.map((n) => el('div', { class: 'p360-row' }, [el('div', { style: 'flex:1' }, [el('b', { style: 'font-size:.86rem' }, dash(n.title)), el('div', { class: 'cc-sub' }, n.body || ''), el('div', { class: 'cc-sub' }, n.key)]), el('div', { class: 'cc-sub' }, fmtDateTime(n.created_at))]))) : el('div', { class: 'p360-empty' }, 'No staff alerts mention this account in the last 120 days.'));
  }
  draw();
  return card([head('Communications', el('span', { class: 'cc-sub' }, 'everything that left the system for this account, and what was refused')), tabBar, host]);
}

// ------------------------------------------------------------------------------------------------
// health + violations + tasks, members, timeline
// ------------------------------------------------------------------------------------------------
export function healthCard(ctx) {
  const { d, orgId, manage } = ctx; const ah = d.health || {}; const viol = d.violations || []; const tasks = d.tasks || [];
  const t = ah.tier || '—'; const tone = t === 'healthy' ? 'green' : t === 'building' ? 'blue' : t === 'at_risk' ? 'amber' : 'red';
  const ded = Array.isArray(ah.deductions) ? ah.deductions : [];
  return card([
    head('Health & conduct', pill(tone, String(ah.score ?? '—') + ' · ' + String(t).replace('_', ' ').toUpperCase())),
    ded.length ? el('div', null, ded.map((x) => el('div', { class: 'p360-row' }, [el('div', null, [el('b', null, '− ' + x.deducted + ' · ' + x.label), el('div', { class: 'cc-sub' }, x.basis || '')]), el('div', { class: 'cc-sub' }, x.improve || '')]))) : el('div', { class: 'p360-empty' }, 'No deductions — clean account.'),
    viol.length ? block('Warnings & violations', pill(viol.some((v) => !v.resolved_at) ? 'red' : 'gray', viol.filter((v) => !v.resolved_at).length + ' open'), viol.map((v) => el('div', { class: 'p360-row' }, [el('div', null, [el('b', null, String(v.severity || '').toUpperCase() + ' · ' + dash(v.kind) + ' · ' + n0(v.points) + ' pts'), el('div', { class: 'cc-sub' }, v.note || '')]), el('div', { class: 'cc-sub' }, fmtDateTime(v.created_at) + (v.resolved_at ? ' · resolved' : ''))]))) : null,
    tasks.length ? block('Open automation tasks', pill('amber', tasks.length + ' open'), tasks.map((tk) => el('div', { class: 'p360-row' }, [el('div', null, [el('b', null, tk.title || tk.type), el('div', { class: 'cc-sub' }, dash(tk.type) + ' · ' + dash(tk.priority))]), el('a', { class: 'lb-btn lb-btn-sm lb-btn-ghost', href: '#/automation' }, 'Open →')]))) : null,
    manage ? el('div', { class: 'p360-actions' }, [el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: async (ev) => { const b = ev.currentTarget; const why = await askReason('⚠ Warn this partner — reason (they see this; points deducted):'); if (!why) return; b.disabled = true; try { await issueViolation(orgId, 'conduct', 'warning', why); toast('Warning issued', 'success'); ctx.reload(); } catch (e) { b.disabled = false; toast(humanizeError(e), 'error'); } } }, [icon('alert', 15), ' Warn account']), el('a', { class: 'lb-btn lb-btn-sm lb-btn-ghost', href: '#/account-health' }, 'Account health desk →')]) : null,
  ].filter(Boolean));
}

export function membersCard(ctx) {
  const m = ctx.d.members || []; const own = ctx.d.owner || {}; const prof = ctx.d.profile || {};
  return card([
    head('People & contact', pill('gray', m.length + ' member' + (m.length === 1 ? '' : 's'))),
    facts([['Contact name', prof.contact_name || own.name], ['Phone', prof.phone], ['Contact email', prof.email || own.email], ['Address', prof.address], ['Signed up as', own.signup_kind ? (own.signup_kind + (own.agent_intent ? ' · agent intent' : '')) : null], ['Email confirmed', own.email_confirmed_at ? fmtDateTime(own.email_confirmed_at) : el('span', { class: 'cc-pill cc-pill-red' }, 'NOT confirmed')]]),
    el('table', { class: 'p360-table', style: 'margin-top:10px' }, [
      el('thead', null, el('tr', null, ['Member', 'Role', 'Joined', 'Last sign-in'].map((h) => el('th', null, h)))),
      el('tbody', null, m.map((x) => el('tr', null, [el('td', null, dash(x.email)), el('td', null, x.owner ? pill('blue', 'owner') : pill('gray', dash(x.status))), el('td', null, fmtDate(x.joined_at)), el('td', null, agoOr(x.last_sign_in_at))]))),
    ]),
  ]);
}

export function timelineCard(ctx) {
  const tl = ctx.d.timeline || [];
  return card([
    head('Activity timeline', el('span', { class: 'cc-sub' }, 'audit log · latest 40')),
    tl.length ? el('div', { class: 'cc-timeline' }, tl.map((e) => el('div', { class: 'cc-tl-row' }, [el('span', { class: 'cc-tl-dot', style: e.staff ? 'background:#7c3aed' : null }), el('div', null, [el('b', null, e.action), el('div', { class: 'cc-sub' }, (e.summary || '') + ' · ' + fmtDateTime(e.at) + (e.staff ? ' · staff' : ''))])]))) : el('div', { class: 'p360-empty' }, 'No activity yet.'),
  ]);
}

// ------------------------------------------------------------------------------------------------
// executed agreement print (kept from v1)
// ------------------------------------------------------------------------------------------------
export function printExecutedAgreementDoc(d) {
  const w = window.open('', '_blank'); if (!w) { toast('Allow pop-ups to download.'); return; }
  const esc = (x) => String(x || '').replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const ref = 'LB-BA-' + (d.signed_date || '').replace(/-/g, '') + '-' + (d.signer || 'X').replace(/[^A-Za-z]/g, '').slice(0, 4).toUpperCase();
  const raw = String(d.body || '');
  const parts = raw.split(/\n(?=\d{1,2}\. )/);
  const intro = esc(parts.shift() || '').replace(/\n/g, '<br>');
  const clauses = parts.map((c) => {
    const m = /^(\d{1,2})\. ([A-Z &\/–-]+)\.\s*([\s\S]*)$/.exec(c.trim());
    if (!m) return '<div class="cl"><div class="cl-b">' + esc(c).replace(/\n/g, '<br>') + '</div></div>';
    return '<div class="cl"><div class="cl-h"><span class="cl-n">' + m[1] + '</span>' + esc(m[2]) + '</div><div class="cl-b">' + esc(m[3]).replace(/\n/g, '<br>') + '</div></div>';
  }).join('');
  const logo = '<svg width="30" height="32" viewBox="16 14 68 72"><path d="M16 14 H34 V68 H84 V86 H16 Z" fill="#10223B"/><path d="M34 14 H58 Q76 14 76 24 Q76 34 58 34 H34 Z" fill="#FC5305"/><path d="M34 40 H64 Q84 40 84 51 Q84 62 64 62 H34 Z" fill="#10223B"/></svg>';
  w.document.write('<!doctype html><html><head><meta charset="utf-8"><title>' + esc(d.title) + ' — Executed</title><style>'
    + '*{box-sizing:border-box}body{font-family:Inter,system-ui,Arial,sans-serif;color:#0f1e36;margin:0 auto;max-width:860px;padding:34px 38px}'
    + '.lh{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #FC5305;padding-bottom:14px}'
    + '.lh .wd{font-weight:800;font-size:1.15rem}.lh .wd span{color:#FC5305}'
    + '.meta{text-align:right;font-size:.7rem;color:#51617a;line-height:1.7}'
    + 'h1{text-align:center;font-size:1.28rem;margin:22px 0 2px}.ref{text-align:center;font-size:.72rem;color:#51617a;letter-spacing:.14em;text-transform:uppercase;margin-bottom:16px}'
    + '.intro{font-size:.85rem;line-height:1.65;background:#f6f8fb;border:1px solid #e6ecf4;border-radius:10px;padding:14px 16px;margin-bottom:14px}'
    + '.cl{margin:0 0 12px;page-break-inside:avoid}.cl-h{font-weight:800;font-size:.85rem;margin-bottom:3px}'
    + '.cl-n{display:inline-flex;width:22px;height:22px;border-radius:50%;background:#10223B;color:#fff;font-size:.7rem;align-items:center;justify-content:center;margin-right:8px}'
    + '.cl-b{font-size:.82rem;line-height:1.6;color:#2b3b52;margin-left:30px}'
    + '.sigrow{display:flex;justify-content:space-between;gap:40px;margin-top:34px;page-break-inside:avoid}.sig{flex:1}.sig .lab{font-size:.6rem;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em}.sig .line{border-bottom:1.5px solid #0f1e36;min-height:32px;font-family:cursive;font-size:1.35rem;color:#0b1b33;padding:2px 0;display:flex;align-items:flex-end}.sig .sub{font-size:.64rem;color:#94a3b8;margin-top:3px}'
    + '.stamp{margin-top:26px;display:flex;justify-content:space-between;align-items:center;background:#e7f9ee;border:1.5px solid #16a34a;border-radius:10px;padding:10px 14px}'
    + '.stamp b{color:#12a150;font-size:.8rem}.stamp span{font-size:.68rem;color:#51617a}'
    + '</style></head><body>'
    + '<div class="lh"><div style="display:flex;align-items:center;gap:10px">' + logo + '<div class="wd">Load<span>Boot</span></div></div>'
    + '<div class="meta">LoadBoot — The Operating System for Trucking<br>hello@loadboot.com · loadboot.com<br>Ref ' + esc(ref) + '</div></div>'
    + '<h1>' + esc(d.title) + '</h1><div class="ref">Version ' + esc(d.version) + ' · EXECUTED ELECTRONICALLY</div>'
    + '<div class="intro">' + intro + '</div>' + clauses
    + '<div class="sigrow"><div class="sig"><div class="lab">Partner (signed electronically)</div><div class="line">' + esc(d.signer) + '</div><div class="sub">' + esc(d.company || '') + (d.company ? ' · ' : '') + 'Signed ' + esc(d.signed_date) + '</div></div><div class="sig"><div class="lab">LoadBoot (pre-signed)</div><div class="line" style="color:#0e7490">LoadBoot</div><div class="sub">Authorized Signatory, LoadBoot · ' + new Date().toLocaleDateString() + '</div></div></div>'
    + '<div class="stamp"><b>✓ EXECUTED — SERVER TIMESTAMPED</b><span>Recorded by the LoadBoot platform with an audit entry. Neither party can alter this record.</span></div>'
    + '<scr' + 'ipt>window.print();</scr' + 'ipt></body></html>');
  w.document.close();
}

// scroll helpers for the next-action banner / journey buttons (shared by the three screens)
export function jumpHandlers(extra) {
  const go = (id) => () => { const t = document.getElementById(id); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  return Object.assign({
    trust: go('p360-trust'), packet: go('p360-packet'), approve: go('p360-packet'), journey: go('p360-journey'), activity: go('p360-activity'), health: go('p360-health'),
    legal: () => toast('Publish the agreement under Command Center \u2192 Legal / agreements, then this step clears itself.', 'info'),
    resend_confirm: () => toast('The signup confirmation email is Supabase Auth\u2019s. Ask them to use "Resend confirmation" on the sign-in page, or confirm the user in the Supabase dashboard.', 'info'),
    labels: { trust: 'Open trust', packet: 'Review packet', approve: 'Approve', legal: 'How to fix', resend_confirm: 'How to fix' },
  }, extra || {});
}

// copy-link helper for the hero
export function copyLinkButton() {
  return el('button', { class: 'lb-btn lb-btn-sm lb-btn-ghost', onClick: async () => { try { await navigator.clipboard.writeText(location.origin + location.pathname + location.hash); toast('Link copied', 'success'); } catch (_) { toast(location.href); } } }, [icon('link', 14), ' Copy 360 link']);
}
