// lb-cdn-bump 2026-08-15: force fresh Netlify blob upload (corrupt-deploy recovery) — no code changes.
// shell.js — persistent Command Center chrome for the FULL ops suite (65+ screens):
// premium topbar (title + breadcrumb + user), and the content host the router fills.
// Nav items hide by permission (UI convenience only; routes are still guarded and
// the server re-checks every action).
import { el, mount } from '../../shared/ui/dom.js';
import { can } from '../../shared/permissions.js';
import { icon } from '../../shared/ui/icons.js';
import { globalSearch, myNotifications, markMyNotification } from '../../shared/api.js';
import { avatar, brandLogo, BRAND_TAGLINE } from '../../shared/ui/components.js';
import ENV from '../../shared/env.js';
import { signOut } from '../../shared/session.js';

const NAV = [
  // bl_ui_0386 — one icon per destination. 19 of these 21 used to share six glyphs
  // (doc x6, bell x4, trend x3, grid/truck/refresh x2), so the sidebar read as a wall of
  // repeats. Every name below exists in app/shared/ui/icons.js.
  // CC CUT, 2 Sep 2026 (docs/CC-AUDIT-2026-09-02.md): 73 items / 12 groups → 21 items / 6 groups.
  // Every retired route still works as a deep link; the merged screens live on as tabs
  // (see app.js TABBED). Hidden screens sit on tables with 0 rows in production.
  { group: 'Home', items: [
    { path: '/', label: 'Today', icon: 'home', perm: null },
    { path: '/automation', label: 'Task queue', icon: 'refresh', perm: null, flag: 'automation' },
  ] },
  { group: 'Loads', items: [
    { path: '/loads', label: 'Loads & trips', icon: 'package', perm: 'any:loads.create,loads.assign,loads.publish,carriers.view,dispatch.view' },
    { path: '/market-rates', label: 'Market rates', icon: 'dollar' },
    { path: '/rate-standards', label: 'Rate standards', icon: 'target', perm: 'any:dispatch.manage,settings.manage' },
  ] },
  { group: 'Carriers', items: [
    { path: '/carriers', label: 'Carriers', icon: 'truck', perm: 'any:carriers.view,carriers.edit,carriers.approve' },
    { path: '/compliance', label: 'Compliance', icon: 'shield', perm: 'compliance.view', flag: 'compliance' },
    { path: '/documents', label: 'Document review', icon: 'doc', perm: 'any:documents.view,documents.review', badge: 'docs' },
    { path: '/carrier-reminders', label: 'Carrier reminders', icon: 'bell', perm: 'any:content.view,comm.view,comm.send' },
  ] },
  { group: 'Partners & People', items: [
    { path: '/partners', label: 'Brokers & shippers', icon: 'handshake', perm: 'partners.view', flag: 'partners' },
    { path: '/partner-intake', label: 'Partner intake', icon: 'clipboard', perm: 'partners.view', flag: 'partners' },
    { path: '/dispatchers', label: 'Dispatchers & agents', icon: 'users', perm: 'carriers.approve' },
  ] },
  { group: 'Money & Customers', items: [
    { path: '/finance', label: 'Finance', icon: 'bank', perm: 'finance.view', flag: 'finance' },
    { path: '/live-chat', label: 'Live chat', icon: 'chat', perm: 'any:comm.view,support.view,dispatch.manage' },
    { path: '/mailbox', label: 'Mailbox', icon: 'mail', perm: 'comm.view' },
    { path: '/support', label: 'Support tickets', icon: 'flag', perm: 'support.view', flag: 'support' },
    { path: '/crm', label: 'CRM & outreach', icon: 'send', perm: 'crm.view', flag: 'crm' },
    { path: '/forms', label: 'Forms', icon: 'pen', perm: 'forms.view', flag: 'forms' },
  ] },
  { group: 'Insights & Admin', items: [
    { path: '/bi', label: 'Business', icon: 'trend', perm: 'any:analytics.view,reports.view' },
    { path: '/web-analytics', label: 'Website & marketing', icon: 'globe', perm: 'analytics.view', flag: 'webAnalytics' },
    { path: '/templates', label: 'Templates', icon: 'copy', perm: 'content.view' },
    { path: '/integrations', label: 'Integrations', icon: 'link', perm: 'integrations.view', flag: 'integrations' },
    { path: '/settings', label: 'Settings', icon: 'cog', perm: 'any:settings.manage,users.manage,roles.manage,flags.manage,audit.view' },
  ] },
];

const FLAT = NAV.flatMap(g => g.items.flatMap(it => it.children ? [it, ...it.children] : [it]));

function permVisible(item) {
  if (!item.perm) return true;
  if (item.perm.indexOf('any:') === 0) return item.perm.slice(4).split(',').some(p => can(p.trim()));
  return can(item.perm);
}

const SEARCH_HASH = { carrier: '/carriers', partner: '/partners', load: '/loads', lead: '/crm', invoice: '/finance', driver: '/fleet' };
function flattenNav(arr, out, grp) {
  (arr || []).forEach(it => {
    if (!it) return;
    if (Array.isArray(it)) { flattenNav(it, out, grp); return; }
    const g = it.group || grp || '';
    if (it.path && it.label) out.push({ path: it.path, label: it.label, group: g });
    if (it.items) flattenNav(it.items, out, g);
    if (it.children) flattenNav(it.children, out, g);
  });
  return out;
}
const NAV_PAGES = flattenNav(NAV, []);

function globalSearchBox() {
  const input = el('input', { class: 'cc-input cc-search', placeholder: 'Search carriers, loads, leads, invoices…' });
  const panel = el('div', { class: 'cc-search-panel', hidden: true });
  const wrap = el('div', { class: 'cc-search-wrap' }, [input, panel]);
  let t = null;
  const close = () => { panel.hidden = true; };
  input.addEventListener('input', () => {
    clearTimeout(t);
    const q = input.value.trim();
    if (q.length < 2) { close(); return; }
    t = setTimeout(async () => {
      const ql = q.toLowerCase();
      const words = ql.split(/\s+/).filter(Boolean);
      const pages = NAV_PAGES.filter(p => { const hay = (p.label + ' ' + (p.group || '')).toLowerCase(); return words.every(w => hay.includes(w)); }).slice(0, 8);
      let rows = [];
      try { rows = await globalSearch(q, 12); } catch (_) { rows = []; }
      const nodes = [];
      pages.forEach(p => nodes.push(el('a', { class: 'cc-search-row', href: '#' + p.path, onClick: close }, [
        el('span', { class: 'cc-pill cc-pill-blue' }, 'Page'),
        el('b', null, p.label),
        el('span', { class: 'cc-sub' }, p.group || 'Go to page'),
      ])));
      const hashFor = (r) => r.kind === 'carrier' ? ('/carrier?id=' + r.id)
        : r.kind === 'partner' ? ('/broker?id=' + r.id)
        : (SEARCH_HASH[r.kind] || '/');
      (rows || []).forEach(r => nodes.push(el('a', { class: 'cc-search-row', href: '#' + hashFor(r), onClick: close }, [
        el('span', { class: 'cc-pill cc-pill-gray' }, r.sublabel),
        el('b', null, r.label),
        el('span', { class: 'cc-sub' }, r.status || ''),
      ])));
      if (!nodes.length) { mount(panel, el('div', { class: 'cc-search-empty' }, 'No matches')); panel.hidden = false; return; }
      mount(panel, nodes);
      panel.hidden = false;
    }, 220);
  });
  document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) close(); });
  return wrap;
}

// Notification payloads carry a link written by whichever backend raised them, and the
// writers never agreed on a convention: some store the in-app route ('/crm'), others the
// full deploy path with its own hash ('/app/command-center/#/agents'). Blindly prefixing
// '#' turned the second kind into '#/app/command-center/#/agents' — a dead click, which is
// what most staff notifications were. Normalize to the route and prefix once.
function ccNotifHref(raw) {
  let u = String(raw || '').trim();
  if (!u) return '#';
  if (/^https?:\/\//i.test(u)) return u;          // absolute link — leave alone
  const h = u.indexOf('#');
  if (h !== -1) u = u.slice(h + 1);                // '/app/command-center/#/agents' -> '/agents'
  else u = u.replace(/^\/app\/command-center\/?/, '/');
  if (u.charAt(0) !== '/') u = '/' + u;            // '#carriers' -> '/carriers'
  return '#' + u;
}

function notifBell() {
  const badge = el('span', { hidden: true, style: 'position:absolute;top:-5px;right:-5px;min-width:17px;height:17px;padding:0 4px;border-radius:9px;background:#ef4444;color:#fff;font-size:.62rem;font-weight:800;display:flex;align-items:center;justify-content:center;line-height:1' });
  const btn = el('button', { class: 'cc-iconbtn', title: 'Notifications', style: 'position:relative' }, [icon('bell', 18), badge]);
  const panel = el('div', { class: 'cc-search-panel', hidden: true, style: 'right:0;left:auto;min-width:320px;max-width:370px;max-height:440px;overflow:auto' });
  const wrap = el('div', { class: 'cc-search-wrap', style: 'position:relative' }, [btn, panel]);
  let items = [];
  async function refresh() {
    try { items = await myNotifications(30); } catch (_) { items = []; }
    const unread = (items || []).filter(n => !n.read_at).length;
    if (unread > 0) { badge.textContent = String(unread > 99 ? '99+' : unread); badge.hidden = false; } else badge.hidden = true;
  }
  function renderPanel() {
    if (!items || !items.length) { mount(panel, el('div', { class: 'cc-search-empty' }, 'No notifications')); return; }
    mount(panel, [
      el('div', { style: 'display:flex;justify-content:space-between;align-items:center;padding:9px 12px;border-bottom:1px solid var(--lb-border,#e2e8f0)' }, [
        el('b', null, 'Notifications'),
        el('button', { style: 'font-size:.8rem;color:var(--lb-blue,#0883F7);background:none;border:none;cursor:pointer', onClick: async (e) => { e.stopPropagation(); for (const n of items.filter(x => !x.read_at)) { try { await markMyNotification(n.id); } catch (_) {} } await refresh(); renderPanel(); } }, 'Mark all read'),
      ]),
      ...items.map(n => {
        const p = n.payload || {};
        const url = ccNotifHref(p.url);
        return el('a', { class: 'cc-search-row', href: url, style: n.read_at ? 'opacity:.55' : '', onClick: async () => { try { if (!n.read_at) await markMyNotification(n.id); } catch (_) {} panel.hidden = true; refresh(); } }, [
          el('div', null, [el('b', null, p.title || n.template_key || 'Update'), p.body ? el('div', { class: 'cc-sub' }, p.body) : '',
            n.created_at ? el('div', { class: 'cc-sub', style: 'font-size:11px;opacity:.75;margin-top:2px' }, new Date(n.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' + new Date(n.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })) : '']),
        ]);
      }),
    ]);
  }
  btn.addEventListener('click', (e) => { e.stopPropagation(); panel.hidden = !panel.hidden; if (!panel.hidden) renderPanel(); });
  document.addEventListener('click', (e) => { if (!wrap.contains(e.target)) panel.hidden = true; });
  refresh(); setInterval(refresh, 60000);
  return wrap;
}

export function renderShell(root, user, flags) {
  flags = flags || {};
  const content = el('div', { class: 'cc-content', id: 'cc-content' });
  const linkEls = {};
  const badgeEls = {};
  const childParent = {};

  function visible(item) {
    if (item.flag && !flags[item.flag]) return false;
    return permVisible(item);
  }

  const groups = NAV.map(g => {
    const makeLink = (item, isSub) => {
      const badge = el('span', { class: 'cc-badge-count', hidden: true });
      badgeEls[item.path] = item.badge ? badge : null;
      const a = el('a', { href: '#' + item.path, dataset: { path: item.path }, hidden: !visible(item), class: isSub ? 'cc-nav-sub-link' : '' },
        [icon(item.icon, 18), el('span', null, item.label), item.badge ? badge : '']);
      linkEls[item.path] = a;
      return a;
    };
    const items = [];
    g.items.forEach(item => {
      if (item.children) {
        const parent = makeLink(item, false);
        const chev = el('span', { class: 'cc-nav-chev', html: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>' });
        parent.appendChild(chev);
        const sub = el('nav', { class: 'cc-nav-sub' }, item.children.map(c => makeLink(c, true)));
        const wrap = el('div', { class: 'cc-nav-parent' }, [parent, sub]);
        chev.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); wrap.classList.toggle('open'); });
        parent.addEventListener('click', () => wrap.classList.add('open'));
        item.children.forEach(c => { childParent[c.path] = wrap; });
        items.push(wrap);
      } else {
        items.push(makeLink(item, false));
      }
    });
    const anyVisible = g.items.some(it => visible(it) || (it.children && it.children.some(visible)));
    return el('div', { hidden: !anyVisible }, [
      el('div', { class: 'cc-nav-group' }, g.group),
      el('nav', { class: 'cc-nav' }, items),
    ]);
  });

  const envPill = el('span', { class: 'pill ' + (ENV.isProduction ? 'prod' : 'prev') },
    ENV.isProduction ? 'Production' : 'Preview');

  const collapseBtn = el('button', { class: 'cc-iconbtn cc-collapse-btn', title: 'Collapse / expand menu',
    html: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M3 12h18M3 18h18"/></svg>' });

  // bl_ui_0389 — Command Center had NO phone navigation. At <=780px the sidebar collapses
  // into 21 ungrouped chips that wrap across the top, so a phone user scrolls past the whole
  // menu before reaching any content. Every entry below is a real route; More opens the full
  // menu as a drawer, so nothing is lost. Desktop is untouched — the bar only exists under 780px.
  // bl_ui_0392 — variant C on the CC bar too: three destinations + the raised centre action
  // + More. Finance left the bar for the drawer — it is a desk screen with no count on it,
  // and Document review (the one badged route) keeps showing its count on More either way.
  const TAB_PATHS = ['/', '/carriers', '/live-chat'];
  const tabEls = {};
  const moreBadge = el('span', { class: 'cc-tab-badge', hidden: true });
  // The centre action is the wizard the Loads & trips screen already posts through, and it is
  // shown only to staff who may actually post. cc_post_load re-checks the permission server-side.
  const ccFab = can('loads.create') ? (() => {
    const b = el('button', { class: 'cc-tab cc-fab', type: 'button', 'aria-label': 'Post a load' },
      [el('span', { class: 'cc-fab-in' }, [icon('plus', 24)]), el('span', null, 'Post')]);
    b.addEventListener('click', () => {
      try { if (navigator.vibrate) navigator.vibrate(8); } catch (_) {}   // bl_ui_0393
      if ((location.hash || '').replace('#', '') === '/loads' && typeof window.__lbCCNewLoad === 'function') { window.__lbCCNewLoad(); return; }
      window.__lbCCNewLoadPending = true;          // loads.js opens the wizard as it mounts
      location.hash = '#/loads';
    });
    return b;
  })() : '';
  // five items on a 360px phone: 'Live chat' ellipsised to 'Live c…', so the bar carries a
  // short label where the sidebar's full one does not fit. Same route, same icon.
  const TAB_SHORT = { '/live-chat': 'Chat' };
  const tabItems = TAB_PATHS.map((path) => {
    const it = FLAT.find((n) => n.path === path);
    if (!it) return '';
    const a = el('a', { href: '#' + path, class: 'cc-tab', dataset: { path } },
      [icon(it.icon, 21), el('span', null, TAB_SHORT[path] || it.label)]);
    tabEls[path] = a;
    return a;
  }).filter(Boolean);
  if (ccFab) tabItems.splice(Math.min(2, tabItems.length), 0, ccFab);
  const tabbar = el('nav', { class: 'cc-tabbar', 'aria-label': 'Main' }, [
    ...tabItems,
    (() => {
      const b = el('button', { class: 'cc-tab cc-tab-more', type: 'button' },
        [icon('more', 21), el('span', null, 'More'), moreBadge]);
      b.addEventListener('click', () => {
        const open = shell.classList.toggle('cc-nav-open');
        b.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
      return b;
    })(),
  ]);
  const scrim = el('div', { class: 'cc-nav-scrim' });
  scrim.addEventListener('click', () => shell.classList.remove('cc-nav-open'));

  const shell = el('div', { class: 'cc-shell' }, [
    el('aside', { class: 'cc-side' }, [
      el('div', { class: 'cc-brand' }, [
        brandLogo({ dark: true, sub: 'Command Center' }),
        el('div', { class: 'cc-brand-tag' }, BRAND_TAGLINE),
      ]),
      ...groups,
      el('div', { class: 'cc-env' }, [
        el('div', { style: 'margin-bottom:6px' }, ['Environment ', envPill]),
        el('div', null, ['Build ', el('b', null, ENV.buildId)]),
      ]),
    ]),
    scrim,
    tabbar,
    el('main', { class: 'cc-main' }, [
      el('header', { class: 'cc-top' }, [
        collapseBtn,
        el('div', null, [
          el('h1', { id: 'cc-title' }, 'Dashboard'),
          el('div', { class: 'cc-crumb', id: 'cc-crumb' }, 'LoadBoot · Command Center'),
        ]),
        globalSearchBox(),
        el('div', { class: 'cc-top-right' }, [
          notifBell(),
          el('div', { class: 'cc-user' }, [
            avatar(user && user.email, 'Owner'),
            el('div', { class: 'who' }, [
              el('b', null, (user && (user.user_metadata && user.user_metadata.name)) || 'Owner'),
              el('span', null, (user && user.email) || ''),
            ]),
            el('button', { class: 'cc-iconbtn', title: 'Sign out',
              onClick: async () => { await signOut(); location.reload(); } }, icon('logout', 18)),
          ]),
        ]),
      ]),
      content,
    ]),
  ]);
  mount(root, shell);

  // Sidebar collapse (desktop) — icons-only; choice persisted. On mobile it toggles
  // the slide-in drawer instead.
  try { if (localStorage.getItem('cc-collapsed') === '1') shell.classList.add('cc-collapsed'); } catch (_) {}
  collapseBtn.onclick = () => {
    if (window.matchMedia('(max-width: 900px)').matches) {
      shell.classList.toggle('cc-side-open');
    } else {
      shell.classList.toggle('cc-collapsed');
      try { localStorage.setItem('cc-collapsed', shell.classList.contains('cc-collapsed') ? '1' : '0'); } catch (_) {}
    }
  };
  // close the mobile drawer when a nav link is tapped
  FLAT.forEach(n => { const a = linkEls[n.path]; if (a) a.addEventListener('click', () => shell.classList.remove('cc-side-open')); });

  function setActive(path) {
    FLAT.forEach(n => { const a = linkEls[n.path]; if (a) a.classList.toggle('active', n.path === path); });
    const _pw = childParent[path]; if (_pw) _pw.classList.add('open');
    TAB_PATHS.forEach((p9) => { const t = tabEls[p9]; if (!t) return; const on9 = (p9 === path); t.classList.toggle('active', on9);
      if (on9) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); });   // bl_ui_0393
    shell.classList.toggle('cc-tab-other', !TAB_PATHS.includes(path));
    shell.classList.remove('cc-nav-open');
    const item = FLAT.find(n => n.path === path);
    const title = document.getElementById('cc-title');
    const crumb = document.getElementById('cc-crumb');
    if (title && item) title.textContent = item.label;
    if (crumb && item) crumb.textContent = 'LoadBoot · ' + item.label;
  }
  function setBadge(path, count) {
    const b = badgeEls[path];
    if (!b) return;
    if (count && count > 0) { b.textContent = String(count); b.hidden = false; }
    else b.hidden = true;
    // the badged routes all live behind More on a phone, so surface the count there too
    try {
      const total = Object.keys(badgeEls).reduce((s9, k9) => {
        const e9 = badgeEls[k9];
        return s9 + (e9 && !e9.hidden ? (Number(e9.textContent) || 0) : 0);
      }, 0);
      if (total > 0) { moreBadge.textContent = String(total); moreBadge.hidden = false; }
      else moreBadge.hidden = true;
    } catch (_) {}
  }
  return { content, setActive, setBadge, nav: FLAT };
}

export default renderShell;
