// sideRail.js — collapsible sidebar ("icon rail") for the portal shells (broker, carrier,
// dispatcher). bl_ux_0320, 2026-09-04.
//
// Industry pattern (Linear / Notion / Slack / Front): the user PINS the sidebar open or
// collapses it to a 72px icon rail with a toggle — never hover-expand, which flickers and
// steals focus from the workspace. Rules:
//   • explicit choice is remembered per portal in localStorage (lb_side_<key>)
//   • no choice yet → "auto": expanded while the account is still onboarding (the labels
//     carry new users), collapsed once onboarding is done; and always collapsed on
//     narrow laptops (< 1280px). Below 900px the CSS hides the sidebar entirely — the
//     existing burger/drawer + bottom tab bar take over, untouched.
//   • collapsed: tooltip with the label on hover/focus, unread badges still show on
//     the icon, keyboard "[" toggles (Linear/GitHub convention) when no field is focused.
//
// Usage:  mountSideRail(shellEl, { key: 'partner', defaultCollapsed: !!ov.onboarded })
// Markup expected (already what all three shells render): .cp-shell > aside.cp-side >
// .cp-brandrow + nav.cp-nav > a.cp-navlink(icon + span) … + .cp-side-foot > .cp-side-out.
import { el } from './dom.js';

const RAIL_CLASS = 'cp-shell--rail';
const AUTO_MQ = '(max-width: 1279px)';
const SVG = (d) => '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + d + '</svg>';
const IC_COLLAPSE = SVG('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 10l-2 2 2 2"/>');
const IC_EXPAND = SVG('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M14 10l2 2-2 2"/>');

let tipEl = null;
function tip(target, text) {
  if (!text) return hideTip();
  if (!tipEl) { tipEl = el('div', { class: 'cp-railtip', role: 'tooltip' }); document.body.appendChild(tipEl); }
  tipEl.textContent = text;
  const r = target.getBoundingClientRect();
  tipEl.style.top = Math.round(r.top + r.height / 2) + 'px';
  tipEl.style.left = Math.round(r.right + 10) + 'px';
  tipEl.classList.add('show');
}
function hideTip() { if (tipEl) tipEl.classList.remove('show'); }

export function mountSideRail(shell, opts = {}) {
  const side = shell && shell.querySelector ? shell.querySelector('aside.cp-side') : null;
  if (!side || side.querySelector('.cp-rail-tg')) return null;   // one-column shells / already mounted
  const key = 'lb_side_' + (opts.key || 'portal');
  const mq = window.matchMedia ? window.matchMedia(AUTO_MQ) : null;

  const stored = () => { try { const v = localStorage.getItem(key); return v === 'rail' || v === 'full' ? v : null; } catch (_) { return null; } };
  const wanted = () => { const s = stored(); if (s) return s === 'rail'; if (mq && mq.matches) return true; return !!opts.defaultCollapsed; };

  const tg = el('button', { class: 'cp-rail-tg', type: 'button', 'aria-label': 'Collapse sidebar', html: IC_COLLAPSE });
  side.insertBefore(tg, side.firstChild);

  function apply(collapsed) {
    shell.classList.toggle(RAIL_CLASS, collapsed);
    tg.innerHTML = collapsed ? IC_EXPAND : IC_COLLAPSE;
    tg.setAttribute('aria-label', collapsed ? 'Expand sidebar' : 'Collapse sidebar');
    tg.dataset.tip = collapsed ? 'Expand sidebar  [' : 'Collapse sidebar  [';
    side.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    hideTip();
    if (typeof opts.onChange === 'function') { try { opts.onChange(collapsed); } catch (_) {} }
  }
  function set(collapsed, remember) {
    if (remember) { try { localStorage.setItem(key, collapsed ? 'rail' : 'full'); } catch (_) {} }
    apply(collapsed);
  }
  const toggle = () => set(!shell.classList.contains(RAIL_CLASS), true);
  tg.addEventListener('click', (e) => { e.preventDefault(); toggle(); });

  // Tooltips — only while collapsed (labels are visible otherwise); the toggle always has one.
  const label = (a) => a.dataset.tip || ((a.querySelector('span:not(.cp-ic):not(.cc-ico):not(.cp-tab-badge)') || {}).textContent || '').trim();
  side.addEventListener('mouseover', (e) => {
    const a = e.target.closest && e.target.closest('.cp-navlink, .cp-side-out, .cp-rail-tg');
    if (!a || !side.contains(a)) return;
    if (a !== tg && !shell.classList.contains(RAIL_CLASS)) return;
    tip(a, label(a));
  });
  side.addEventListener('mouseout', (e) => { const a = e.target.closest && e.target.closest('.cp-navlink, .cp-side-out, .cp-rail-tg'); if (a) hideTip(); });
  side.addEventListener('focusin', (e) => { const a = e.target.closest && e.target.closest('.cp-navlink, .cp-side-out, .cp-rail-tg'); if (a && (a === tg || shell.classList.contains(RAIL_CLASS))) tip(a, label(a)); });
  side.addEventListener('focusout', hideTip);
  window.addEventListener('scroll', hideTip, true);

  // Auto mode follows the viewport until the user pins a choice.
  if (mq) { const onMq = () => { if (!stored()) apply(wanted()); }; if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq); }

  // "[" toggles when focus is not in a field (Linear / GitHub convention).
  document.addEventListener('keydown', (e) => {
    if (e.key !== '[' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target; const tag = t && t.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t && t.isContentEditable)) return;
    if (!document.body.contains(shell)) return;
    e.preventDefault(); toggle();
  });

  apply(wanted());
  return { set, toggle, collapsed: () => shell.classList.contains(RAIL_CLASS) };
}

export default { mountSideRail };
