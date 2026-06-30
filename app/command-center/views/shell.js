// shell.js — persistent Command Center chrome: branded sidebar (grouped, icons),
// premium topbar (title + breadcrumb + user), and the content host the router fills.
// Nav items hide by permission (UI convenience only; routes are still guarded and
// the server re-checks every action).
import { el, mount } from '../../shared/ui/dom.js';
import { can } from '../../shared/permissions.js';
import { icon } from '../../shared/ui/icons.js';
import { avatar, brandLogo, BRAND_TAGLINE } from '../../shared/ui/components.js';
import ENV from '../../shared/env.js';
import { signOut } from '../../shared/session.js';

// V1 navigation — only the ten shipped screens. Deferred modules (analytics, content,
// builder, fleet, rate intelligence, finance, messages, search) are intentionally absent.
const NAV = [
  { group: 'Overview', items: [
    { path: '/', label: 'Dashboard', icon: 'grid', perm: null },
  ]},
  { group: 'Operations', items: [
    { path: '/dispatch', label: 'Dispatch board', icon: 'grid', perm: 'any:loads.create,loads.assign,loads.publish,carriers.view' },
    { path: '/carriers', label: 'Carriers', icon: 'truck', perm: 'any:carriers.view,carriers.edit,carriers.approve' },
    { path: '/loads', label: 'Loads & trips', icon: 'list', perm: 'any:loads.create,loads.assign,loads.publish,carriers.view' },
    { path: '/documents', label: 'Documents', icon: 'doc', perm: 'any:documents.view,documents.review', badge: 'docs' },
  ]},
  { group: 'Administration', items: [
    { path: '/staff', label: 'Staff & roles', icon: 'users', perm: 'any:users.manage,roles.manage,staff.suspend' },
    { path: '/audit', label: 'Audit log', icon: 'shield', perm: 'audit.view' },
    { path: '/flags', label: 'Feature flags', icon: 'flag', perm: 'flags.manage' },
    { path: '/settings', label: 'Settings', icon: 'cog', perm: 'settings.manage' },
  ]},
];

const FLAT = NAV.flatMap(g => g.items);

function permVisible(item) {
  if (!item.perm) return true;
  if (item.perm.indexOf('any:') === 0) return item.perm.slice(4).split(',').some(p => can(p.trim()));
  return can(item.perm);
}

export function renderShell(root, user) {
  const content = el('div', { class: 'cc-content', id: 'cc-content' });
  const linkEls = {};
  const badgeEls = {};

  const groups = NAV.map(g => {
    const items = g.items.map(item => {
      const badge = el('span', { class: 'cc-badge-count', hidden: true });
      badgeEls[item.path] = item.badge ? badge : null;
      const a = el('a', { href: '#' + item.path, dataset: { path: item.path }, hidden: !permVisible(item) },
        [icon(item.icon, 18), el('span', null, item.label), item.badge ? badge : '']);
      linkEls[item.path] = a;
      return a;
    });
    // hide a whole group if every item is hidden
    const anyVisible = g.items.some(permVisible);
    return el('div', { hidden: !anyVisible }, [
      el('div', { class: 'cc-nav-group' }, g.group),
      el('nav', { class: 'cc-nav' }, items),
    ]);
  });

  const envPill = el('span', { class: 'pill ' + (ENV.isProduction ? 'prod' : 'prev') },
    ENV.isProduction ? 'Production' : 'Preview');

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
        el('div', null, [
          el('h1', { id: 'cc-title' }, 'Dashboard'),
          el('div', { class: 'cc-crumb', id: 'cc-crumb' }, 'LoadBoot · Command Center'),
        ]),
        el('div', { class: 'cc-top-right' }, [
          el('button', { class: 'cc-iconbtn', title: 'Notifications' }, [icon('bell', 18), el('span', { class: 'dotk' })]),
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

  function setActive(path) {
    FLAT.forEach(n => { const a = linkEls[n.path]; if (a) a.classList.toggle('active', n.path === path); });
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
