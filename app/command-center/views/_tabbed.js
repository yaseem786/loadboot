// _tabbed.js — one screen, several former views. (CC cut, 2 Sep 2026 — see docs/CC-AUDIT-2026-09-02.md)
//
// The audit found the same job spread over 2–7 nav items (three loads boards, three FMCSA
// surfaces, seven analytics screens…). Rewriting them is days of work; hosting the existing
// render functions as tabs under ONE nav item is an afternoon and loses nothing: every old
// route still deep-links to its tab, every old view still renders unchanged into its own
// sub-host, and switching tabs disconnects the previous view's DOM so its own
// MutationObserver cleanup fires exactly as it does on a route change.
import { el, mount } from '../../shared/ui/dom.js';

const STYLE_ID = 'cc-tabbed-style';
function ensureStyle() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style'); s.id = STYLE_ID;
  s.textContent = [
    '.cc-tabbar{display:flex;gap:2px;border-bottom:1px solid var(--lb-border,#e6edf5);margin:0 0 18px;overflow-x:auto;scrollbar-width:none;-webkit-overflow-scrolling:touch}',
    '.cc-tabbar::-webkit-scrollbar{display:none}',
    '.cc-tab{border:0;background:none;padding:10px 14px;font:700 .84rem var(--lb-head,Inter,system-ui,sans-serif);color:var(--lb-muted,#64748b);border-bottom:2px solid transparent;margin-bottom:-1px;cursor:pointer;white-space:nowrap;transition:.14s;display:inline-flex;align-items:center;gap:7px}',
    '.cc-tab:hover{color:var(--lb-navy,#10223B)}',
    '.cc-tab.active{color:var(--lb-blue,#0883F7);border-bottom-color:var(--lb-blue,#0883F7)}',
    '.cc-tab .cc-tab-n{font-size:.68rem;font-weight:800;background:#eef2f7;color:#334155;border-radius:999px;padding:1px 7px;line-height:1.5}',
    '.cc-tab.active .cc-tab-n{background:#e0efff;color:var(--lb-blue,#0883F7)}',
    '.cc-tabhost{min-height:200px}',
    '@media (max-width:900px){.cc-tab{padding:10px 11px;font-size:.8rem}}',
  ].join('\n');
  document.head.appendChild(s);
}

/**
 * renderTabbed(host, { key, tabs, initial, query })
 *   key     — remembers the last tab per screen (sessionStorage)
 *   tabs    — [{ id, label, path, render(subHost, query), allowed() }] ; tabs whose allowed() is false are not shown
 *   initial — tab id to open (a deep link to an old route passes its tab here)
 *   query   — URLSearchParams from the router, handed to the tab's render
 */
export function renderTabbed(host, opts) {
  ensureStyle();
  const all = (opts.tabs || []).filter(t => t && (typeof t.allowed !== 'function' || t.allowed()));
  const sub = el('div', { class: 'cc-tabhost' });
  if (!all.length) {
    mount(host, el('div', { class: 'cc-deny' }, [el('h2', null, 'Not available'), el('p', null, 'You do not have permission to view this area.')]));
    return;
  }
  const memKey = 'cc-tab:' + (opts.key || 'x');
  let remembered = null;
  try { remembered = sessionStorage.getItem(memKey); } catch (_) {}
  let cur = [opts.initial, remembered, all[0].id].find(id => id && all.some(t => t.id === id));
  const btns = {};
  const bar = el('div', { class: 'cc-tabbar', role: 'tablist' }, all.map(t => {
    const b = el('button', { class: 'cc-tab', role: 'tab', type: 'button', onClick: () => pick(t.id, true) },
      [t.label, t.count != null ? el('span', { class: 'cc-tab-n' }, String(t.count)) : '']);
    btns[t.id] = b;
    return b;
  }));
  mount(host, el('div', { class: 'cc-tabbed' }, [bar, sub]));

  function pick(id, userClick) {
    const t = all.find(x => x.id === id) || all[0];
    cur = t.id;
    Object.keys(btns).forEach(k => btns[k].classList.toggle('active', k === cur));
    try { sessionStorage.setItem(memKey, cur); } catch (_) {}
    // Keep the old route's deep link in the URL without triggering the router (replaceState
    // does not fire hashchange), so a refresh or a copied link lands on the same tab.
    if (userClick && t.path) { try { history.replaceState(null, '', '#' + t.path); } catch (_) {} }
    sub.innerHTML = '';
    try { t.render(sub, opts.query || new URLSearchParams('')); }
    catch (e) { mount(sub, el('div', { class: 'cc-deny' }, [el('h2', null, 'Something went wrong'), el('p', null, String((e && e.message) || e))])); }
  }
  pick(cur, false);
  return { pick };
}
