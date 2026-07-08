// shell.js — persistent Command Center chrome: branded sidebar (grouped, icons),
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

// V1 navigation — only the ten shipped screens. Deferred modules (analytics, content,
// builder, fleet, rate intelligence, finance, messages, search) are intentionally absent.
const NAV = [
  { group: 'Overview', items: [
    { path: '/', label: 'Dashboard', icon: 'grid', perm: null },
    { path: '/radar', label: 'Ops Radar', icon: 'bell', perm: null },
    { path: '/management', label: 'Management', icon: 'grid', perm: null },
    { path: '/bi', label: 'Business Intelligence', icon: 'trend', perm: 'any:analytics.view,reports.view' },
    { path: '/web-analytics', label: 'Analytics Control Center', icon: 'trend', perm: 'analytics.view', flag: 'webAnalytics', children: [
      { path: '/analytics', label: 'Business Analytics', icon: 'trend', perm: 'analytics.view', flag: 'analytics' },
    ] },
  ]},
  { group: 'Operations', items: [
    { path: '/dispatch', label: 'Dispatch board', icon: 'grid', perm: 'any:loads.create,loads.assign,loads.publish,carriers.view' },
    { path: '/booking-requests', label: 'Booking requests', icon: 'list', perm: 'any:loads.assign,loads.publish,carriers.view' },
    { path: '/safety', label: 'Safety desk', icon: 'shield', perm: 'any:compliance.approve,carriers.view' },
    { path: '/carriers', label: 'Carriers', icon: 'truck', perm: 'any:carriers.view,carriers.edit,carriers.approve' },
    { path: '/contacts', label: 'Contacts directory', icon: 'users', perm: 'any:carriers.view,partners.view' },
    { path: '/loads', label: 'Loads & trips', icon: 'list', perm: 'any:loads.create,loads.assign,loads.publish,carriers.view' },
    { path: '/matching', label: 'Smart matching', icon: 'trend', perm: 'carriers.view' },
    // MERGED into Carrier 360 (per-carrier scorecard card) + Account health board — route still works, nav hidden.
    // { path: '/carrier-scorecards', label: 'Carrier Scorecards', icon: 'trend', perm: 'any:carriers.view,dispatch.view' },
    { path: '/trips', label: 'Dispatch & trips', icon: 'truck', perm: 'dispatch.view', flag: 'dispatch' },
    { path: '/map', label: 'Live map', icon: 'truck', perm: null, flag: 'opsMap' },
    { path: '/fleet', label: 'Fleet & drivers', icon: 'users', perm: 'fleet.view', flag: 'fleet' },
    { path: '/fleet-expiry', label: 'License & medical expiry', icon: 'shield', perm: 'any:fleet.view,carriers.view' },
    { path: '/documents', label: 'Documents', icon: 'doc', perm: 'any:documents.view,documents.review', badge: 'docs' },
    { path: '/compliance', label: 'Onboarding & compliance', icon: 'shield', perm: 'compliance.view', flag: 'compliance' },
    { path: '/verification', label: 'Verification Center', icon: 'shield', perm: 'compliance.view' },
    { path: '/pod-review', label: 'POD Review', icon: 'document', perm: 'dispatch.manage' },
    { path: '/exceptions', label: 'Exceptions', icon: 'document', perm: 'dispatch.manage' },
    { path: '/load-intake', label: 'Load Intake', icon: 'trend', perm: 'dispatch.view', flag: 'load_marketplace' },
    { path: '/control-tower', label: 'Trip Control Tower', icon: 'refresh', perm: 'dispatch.view', flag: 'load_marketplace' },
    { path: '/exceptions', label: 'Exception Center', icon: 'alert', perm: 'dispatch.view', flag: 'load_marketplace' },
    { path: '/workflows', label: 'Workflow Builder', icon: 'settings', perm: 'settings.manage', flag: 'load_marketplace' },
    { path: '/automation', label: 'Automation', icon: 'refresh', perm: null, flag: 'automation' },
  ]},
  { group: 'Sales & CRM', items: [
    { path: '/crm', label: 'CRM & leads', icon: 'trend', perm: 'crm.view', flag: 'crm' },
    { path: '/forms', label: 'Forms inbox', icon: 'bell', perm: 'forms.view', flag: 'forms' },
    { path: '/partners', label: 'Brokers & shippers', icon: 'users', perm: 'partners.view', flag: 'partners' },
    { path: '/partner-intake', label: 'Partner intake', icon: 'doc', perm: 'partners.view', flag: 'partners' },
    { path: '/market-rates', label: 'Market rates', icon: 'doc' },
    { path: '/broker-sla', label: 'Broker SLA', icon: 'trend', perm: 'partners.view', flag: 'partners' },
  ]},
  { group: 'Support', items: [
    { path: '/support', label: 'Tickets', icon: 'bell', perm: 'support.view', flag: 'support' },
  ]},
  { group: 'SEO & Website', items: [
    { path: '/seo', label: 'SEO & redirects', icon: 'trend', perm: 'seo.view', flag: 'seo' },
  ]},
  { group: 'Reporting', items: [
    { path: '/reports', label: 'Reports', icon: 'doc', perm: 'reports.view', flag: 'reports' },
  ]},
  { group: 'Communications', items: [
    { path: '/comms', label: 'Messages & inbox', icon: 'bell', perm: 'comm.view', flag: 'comms' },
    { path: '/notifications', label: 'Notifications', icon: 'bell', perm: null, flag: 'notificationsCenter' },
    { path: '/delivery', label: 'Delivery health', icon: 'refresh', perm: null },
    { path: '/announcements', label: 'Announcements', icon: 'bell', perm: 'announce.view', flag: 'announcements' },
    { path: '/chat', label: 'Team chat', icon: 'bell', perm: null, flag: 'teamChat' },
  ]},
  { group: 'Finance', items: [
    { path: '/finance', label: 'Invoices & settlements', icon: 'doc', perm: 'finance.view', flag: 'finance' },
    { path: '/finance-analytics', label: 'Finance analytics', icon: 'trend', perm: 'finance.view', flag: 'finance' },
    { path: '/referrals', label: 'Referral Program', icon: 'users', perm: 'finance.view', flag: 'referral_program' },
  ]},
  { group: 'Marketing', items: [
    { path: '/content', label: 'Content & posts', icon: 'doc', perm: 'content.view', flag: 'content' },
    { path: '/brand-kit', label: 'Brand Kit', icon: 'doc', perm: 'content.view' },
    { path: '/form-builder', label: 'Form Builder', icon: 'doc', perm: 'content.view' },
    { path: '/templates', label: 'Template Studio', icon: 'doc', perm: 'content.view' },
    { path: '/email-builder', label: 'Email Builder', icon: 'doc', perm: 'content.view' },
    { path: '/audiences', label: 'Audiences', icon: 'users', perm: 'content.view' },
    { path: '/campaign-manager', label: 'Campaign Manager', icon: 'trend', perm: 'content.view' },
    { path: '/marketing-analytics', label: 'Marketing analytics', icon: 'trend', perm: 'content.view' },
    { path: '/account-health', label: 'Account Health', icon: 'users', perm: 'carriers.view' },
    { path: '/marketing-intel', label: 'Marketing Intelligence', icon: 'trend', perm: 'analytics.view' },
    { path: '/campaigns', label: 'Campaigns', icon: 'trend', perm: 'campaigns.view', flag: 'campaigns' },
  ]},
  { group: 'Administration', items: [
    { path: '/staff', label: 'Staff & roles', icon: 'users', perm: 'any:users.manage,roles.manage,staff.suspend' },
    { path: '/automations', label: 'Automations', icon: 'refresh', perm: null, flag: 'automationsAdmin' },
    { path: '/audit', label: 'Audit log', icon: 'shield', perm: 'audit.view' },
    { path: '/modules', label: 'Module registry', icon: 'grid', perm: 'settings.manage' },
    { path: '/health', label: 'System health', icon: 'refresh', perm: null },
    { path: '/integrations', label: 'Integrations', icon: 'refresh', perm: 'integrations.view', flag: 'integrations' },
    { path: '/webhooks', label: 'Webhooks', icon: 'refresh', perm: 'integrations.view' },
    { path: '/plugins', label: 'Plugin Marketplace', icon: 'grid', perm: null },
    { path: '/flags', label: 'Feature flags', icon: 'flag', perm: 'flags.manage' },
    { path: '/settings', label: 'Settings', icon: 'cog', perm: 'settings.manage' },
  ]},
];

const FLAT = NAV.flatMap(g => g.items.flatMap(it => it.children ? [it, ...it.children] : [it]));

function permVisible(item) {
  if (!item.perm) return true;
  if (item.perm.indexOf('any:') === 0) return item.perm.slice(4).split(',').some(p => can(p.trim()));
  return can(item.perm);
}

const SEARCH_HASH = { carrier: '/carriers', partner: '/partners', load: '/trips', lead: '/crm', invoice: '/finance', driver: '/fleet' };
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
        const url = p.url ? (String(p.url).charAt(0) === '/' ? '#' + p.url : p.url) : '#';
        return el('a', { class: 'cc-search-row', href: url, style: n.read_at ? 'opacity:.55' : '', onClick: async () => { try { if (!n.read_at) await markMyNotification(n.id); } catch (_) {} panel.hidden = true; refresh(); } }, [
          el('div', null, [el('b', null, p.title || n.template_key || 'Update'), p.body ? el('div', { class: 'cc-sub' }, p.body) : '']),
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
  }
  return { content, setActive, setBadge, nav: FLAT };
}

export default renderShell;
