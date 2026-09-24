// mock.js — a stand-in carrier portal for previewing the guided tour. Same CSS, same shell
// classes, same data-tour hooks the real views will carry; the data is invented.
import { el as h, mount } from './lib/dom.js';
import { icon } from './lib/icons.js';
import { brandLogo } from './lib/components.js';
import { createTour, mountHelp } from './lib/tour.js';
import { CARRIER_TOUR } from './lib/tour-content.js';

const q = new URLSearchParams(location.search);
const ROLE = ['owner', 'driver', 'dispatcher'].includes(q.get('role')) ? q.get('role') : 'owner';
const THEME = q.get('theme') === 'light' ? 'light' : 'dark';
document.documentElement.setAttribute('data-lbtheme', THEME);
const NAME = { owner: 'Mike', driver: 'Luis', dispatcher: 'Dana' }[ROLE];
const CO = 'Redline Freight LLC';

const NAV_OWNER = [['dashboard', 'Dashboard', 'dash'], ['health', 'Ratings', 'shield'], ['loads', 'Load Board', 'loads'], ['trips', 'My Loads', 'trips'],
  ['dispatcher', 'Dispatcher', 'handshake'], ['profile', 'My Profile', 'id'], ['fleet', 'Fleet', 'truck'], ['finance', 'Finance', 'finance'], ['documents', 'Documents', 'docs'],
  ['rates', 'Market Rates', 'tag'], ['notifications', 'Alerts', 'bell'], ['support', 'Support', 'support'], ['safety', 'Safety', 'sos'], ['account', 'Account', 'user']];
const NAV_DRIVER = [['dashboard', 'Today', 'dash'], ['trips', 'My loads', 'trips'], ['documents', 'Documents', 'docs'], ['finance', 'Earnings', 'finance'],
  ['notifications', 'Alerts', 'bell'], ['safety', 'Safety', 'sos'], ['support', 'Support', 'support'], ['account', 'Me', 'user']];
const NAV_DISP = [['dashboard', 'Today', 'dash'], ['trips', 'My loads', 'trips'], ['loads', 'Load board', 'loads'], ['fleet', 'Fleet', 'truck'], ['documents', 'Documents', 'docs'],
  ['rates', 'Market rates', 'finance'], ['notifications', 'Alerts', 'bell'], ['safety', 'Safety', 'sos'], ['support', 'Support', 'support'], ['account', 'Me', 'user']];
const NAV = ROLE === 'owner' ? NAV_OWNER : ROLE === 'driver' ? NAV_DRIVER : NAV_DISP;
const TABS = ROLE === 'owner' ? ['dashboard', 'loads', 'trips', 'fleet'] : ROLE === 'driver' ? ['dashboard', 'trips', 'notifications', 'safety', 'account'] : ['dashboard', 'loads', 'trips', 'fleet', 'notifications'];
const FAB = ROLE === 'owner';
// icons.js has no 'dash'/'loads'/'trips'/'docs'/'sos'/'support'/'tag'/'finance' aliases in this copy — map to the nearest real key
const IC = { dash: 'grid', loads: 'search', trips: 'route', docs: 'doc', sos: 'alert', support: 'chat', tag: 'trend', finance: 'dollar', id: 'id', handshake: 'handshake', truck: 'truck', bell: 'bell', user: 'user', shield: 'shield', filter: 'filter', check: 'check', upload: 'upload', users: 'users', chev: 'chev' };
const ico = (n, s) => icon(IC[n] || n, s);

let tab = (location.hash || '').replace('#', '') || 'dashboard';
const navLinks = {};
const content = h('div', { class: 'cp-content' });
const titleEl = h('h1', { class: 'cp-top-title' }, 'Dashboard');

function navEl(mobile) {
  const items = (mobile ? TABS.map((id) => NAV.find((n) => n[0] === id)).filter(Boolean) : NAV).map(([id, label, ic]) => {
    const a = h('a', { class: 'cp-navlink', href: '#' + id, onClick: (e) => { e.preventDefault(); go(id); } }, [ico(ic, mobile ? 22 : 20), h('span', null, label)]);
    (navLinks[id] = navLinks[id] || []).push(a); return a;
  });
  if (mobile && FAB) items.splice(Math.ceil(items.length / 2), 0, h('button', { class: 'cp-fab', type: 'button', 'aria-label': 'Post your truck availability', onClick: () => toast('Availability form opens here') }, [h('span', { class: 'cp-fab-in' }, icon('plus', 24)), h('span', null, 'Post')]));
  return h('nav', { class: mobile ? 'cp-tabbar' : 'cp-nav' }, items);
}

const availPill = h('button', { class: 'cpx-avail on cpx-desktop', title: 'Your availability for new loads', onClick: (e) => { const on = e.currentTarget.classList.toggle('on'); e.currentTarget.classList.toggle('off', !on); e.currentTarget.textContent = on ? 'Online' : 'Offline'; } }, 'Online');
const bell = h('button', { class: 'cp-iconbtn cp-bell', title: 'Alerts', onClick: () => go('notifications') }, [icon('bell', 20), h('span', { class: 'cp-bell-badge' }, '3')]);
const shell = h('div', { class: 'cp-shell' }, [
  h('aside', { class: 'cp-side' }, [
    h('div', { class: 'cp-brandrow' }, brandLogo({ dark: true, sub: ROLE === 'driver' ? 'Driver' : 'Carrier' })),
    navEl(false),
    h('div', { class: 'cp-side-foot' }, [h('div', { class: 'cp-carrier' }, [h('div', { class: 'cp-carrier-name' }, CO), h('div', { class: 'cp-carrier-mail' }, NAME.toLowerCase() + '@redlinefreight.com')]),
      h('button', { class: 'cp-side-out' }, [icon('logout', 16), h('span', null, 'Sign out')])]),
  ]),
  h('main', { class: 'cp-main' }, [
    h('header', { class: 'cp-top' }, [
      h('div', { class: 'cp-top-left' }, [h('button', { class: 'cpx-burger', 'aria-label': 'Menu' }, icon('list', 24)), titleEl]),
      h('div', { class: 'cp-top-right' }, [
        ROLE === 'owner' ? availPill : null,
        ROLE === 'owner' ? h('button', { class: 'cp-iconbtn cpx-desktop', title: 'Settings' }, icon('cog', 20)) : null,
        ROLE === 'owner' ? h('button', { class: 'cp-chip cp-chip-btn cpx-desktop warn', title: 'Action needed', onClick: () => go('documents') }, 'Action needed') : null,
        bell,
        h('div', { class: 'cp-menuwrap' }, h('button', { class: 'cp-avatar', 'aria-label': 'Account menu', html: '<span style="width:38px;height:38px;border-radius:50%;background:linear-gradient(135deg,#0883F7,#1d4ed8);color:#fff;font-weight:800;display:flex;align-items:center;justify-content:center;font-size:15px">' + NAME[0] + '</span>' })),
      ]),
    ]),
    content,
  ]),
  navEl(true),
]);
mount(document.getElementById('lb-app'), shell);

// ---------- views (fake data) ----------
const money = (n) => '$' + Number(n).toLocaleString('en-US');
const cardHead = (t, sub, more) => h('div', { class: 'cp-cardhead' }, [h('div', null, [h('h3', null, t), sub ? h('span', { class: 'cp-cardhead-sub' }, sub) : null]), more ? h('button', { class: 'cp-link' }, 'View all →') : null]);
const stat = (v, l, ic, tone) => h('button', { class: 'cp-stat clickable ' + (tone || 'blue') }, [h('span', { class: 'cp-stat-ic' }, icon(ic, 20)), h('span', null, [h('div', { class: 'cp-stat-v' }, v), h('div', { class: 'cp-stat-l' }, l)])]);
const pill = (t, cls) => h('span', { class: 'cp-pill ' + (cls || '') }, t);
const LOADS = [
  ['Dallas, TX', 'Atlanta, GA', 2450, 781, 'Dry van', '3.14', true], ['Houston, TX', 'Memphis, TN', 1980, 586, 'Reefer', '3.38', true],
  ['Fort Worth, TX', 'Kansas City, MO', 1720, 553, 'Flatbed', '3.11', false], ['San Antonio, TX', 'Phoenix, AZ', 2900, 984, 'Dry van', '2.95', true],
  ['Laredo, TX', 'Chicago, IL', 3650, 1430, 'Dry van', '2.55', true], ['Austin, TX', 'Denver, CO', 2600, 920, 'Reefer', '2.83', false],
];
const loadCard = ([a, b, rate, mi, eq, rpm, det]) => h('div', { class: 'cp-load' }, [
  h('div', { class: 'cp-load-top' }, [h('div', { class: 'cp-load-lane' }, [h('b', null, a), h('span', { class: 'cp-arrow' }, '→ '), b]), h('div', { class: 'cp-load-rate' }, [money(rate), h('span', null, '$' + rpm + '/mi')])]),
  h('div', { class: 'cp-load-tags' }, [pill(eq, 'blue'), pill(mi + ' mi'), det ? pill('Detention $60/hr', 'amber') : null]),
  h('div', { class: 'cp-load-meta' }, 'Pickup tomorrow 08:00 · 42,000 lb · Broker: Apex Logistics ★ 4.8'),
  h('div', { style: 'display:flex;gap:8px' }, [h('button', { class: 'cp-btn cp-btn-sm' }, 'Book now'), h('button', { class: 'cp-btn cp-btn-sm ghost' }, 'Details')]),
]);
const V = {
  dashboard() {
    if (ROLE === 'driver') return h('div', { class: 'cp-dash' }, [
      h('div', { class: 'cp-card', 'data-tour': 'today' }, [cardHead('Today', 'Tue, Sep 24'),
        h('div', { class: 'cp-row' }, [h('div', null, [h('div', { class: 'cp-row-t' }, 'Pickup · Dallas, TX'), h('div', { class: 'cp-row-s' }, '2200 Irving Blvd · appt 08:00 · Dock 14')]), pill('Next', 'blue')]),
        h('div', { class: 'cp-row' }, [h('div', null, [h('div', { class: 'cp-row-t' }, 'Deliver · Atlanta, GA'), h('div', { class: 'cp-row-s' }, '781 mi · appt tomorrow 14:00')]), pill('Dry van')]),
        h('div', { class: 'cp-ann' }, [h('div', { class: 'cp-ann-t' }, 'Dispatcher note'), 'Call the receiver 30 min before arrival. Lumper is paid by broker.']),
        h('div', { style: 'display:flex;gap:8px;margin-top:6px' }, [h('button', { class: 'cp-btn' }, 'Navigate'), h('button', { class: 'cp-btn ghost' }, 'Call dispatcher')])]),
      h('div', { class: 'cp-card' }, [cardHead('This week'), h('div', { class: 'cp-kpis' }, [stat('3', 'Loads', 'route'), stat('1,940', 'Miles', 'trend'), stat('$1,260', 'Earnings', 'dollar', 'blue'), stat('100%', 'On time', 'check')])]),
    ]);
    return h('div', { class: 'cp-dash' }, [
      h('div', { class: 'cp-kpis', 'data-tour': 'dash-kpis' }, [stat('4', 'Loads in transit', 'route'), stat(money(12840), 'Revenue this week', 'dollar'), stat('2', 'Booking requests', 'inbox', 'amber'), stat('4.8', 'Rating', 'star')]),
      h('div', { class: 'cp-grid' }, [
        h('div', { class: 'cp-card', 'data-tour': 'dash-setup' }, [cardHead('Complete your setup', 'Action needed'),
          ...[['Required', 'Insurance certificate expires in 12 days', '#d97706', '#fffbeb'], ['Required', 'W-9 not uploaded yet', '#dc2626', '#fef2f2'], ['Optional', 'Add your bank account for faster payouts', '#0883F7', '#eff6ff']].map(([l, t, c, bg]) =>
            h('button', { class: 'cp-rowbtn', style: 'border-left:4px solid ' + c + ';background:' + bg, onClick: () => go('documents') }, [h('span', null, [h('span', { style: 'color:' + c + ';font-weight:700;margin-right:8px' }, l), t]), h('span', { class: 'cp-go', style: 'color:' + c }, '›')]))]),
        h('div', { class: 'cp-card' }, [cardHead('On the road', '4 loads', true), ...[['Dallas → Atlanta', 'Luis · delivered 14:10', 'Delivered'], ['Houston → Memphis', 'Ray · at pickup', 'Loading'], ['Laredo → Chicago', 'Maria · 320 mi to go', 'In transit']].map(([a, b, s]) =>
          h('div', { class: 'cp-row' }, [h('div', null, [h('div', { class: 'cp-row-t' }, a), h('div', { class: 'cp-row-s' }, b)]), pill(s, s === 'Delivered' ? 'blue' : '')]))]),
      ]),
    ]);
  },
  loads() {
    return h('div', { class: 'cp-dash' }, [
      h('div', { style: 'display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap' }, [h('div', { class: 'cp-muted' }, '128 loads near Dallas, TX · updated 2 min ago'), h('div', { style: 'display:flex;gap:8px' }, [h('button', { class: 'cp-btn cp-btn-sm', 'data-tour': 'loads-post' }, [icon('plus', 16), ' Post availability']), h('button', { class: 'cp-btn cp-btn-sm ghost' }, '🔗 Trip Builder')])]),
      h('div', { class: 'cp-card', 'data-tour': 'loads-filters' }, [cardHead('Filters', 'Saved for next time'),
        h('div', { class: 'cp-wiz-grid', style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px' }, [
          h('input', { class: 'cp-in', value: 'Dallas, TX', placeholder: 'Origin' }), h('input', { class: 'cp-in', placeholder: 'Destination (any)' }),
          h('select', { class: 'cp-in' }, [h('option', null, 'Dry van'), h('option', null, 'Reefer'), h('option', null, 'Flatbed')]), h('input', { class: 'cp-in', placeholder: 'Min $/mi', value: '2.50' })])]),
      h('div', { class: 'cp-loadgrid', 'data-tour': 'loads-list' }, LOADS.map(loadCard)),
    ]);
  },
  trips() {
    const trip = (a, b, drv, st, act) => h('div', { class: 'cp-trip' }, [
      h('div', { class: 'cp-trip-head' }, [h('div', null, [h('div', { class: 'cp-row-t' }, a + ' → ' + b), h('div', { class: 'cp-row-s' }, drv + ' · ' + money(2450) + ' · Apex Logistics')]), pill(st, 'blue')]),
      act ? h('div', { class: 'cp-trip-actions', 'data-tour': 'trip-actions' }, [h('button', { class: 'cp-btn cp-btn-sm' }, [icon('check', 16), ' Arrived']), h('button', { class: 'cp-btn cp-btn-sm ghost' }, 'Loaded'), h('button', { class: 'cp-btn cp-btn-sm ghost' }, 'Delivered'), h('button', { class: 'cp-btn cp-btn-sm ghost' }, 'Call broker')]) : null,
      act ? h('div', { class: 'cp-podzone', 'data-tour': 'trip-pod', style: 'margin-top:10px' }, [h('div', { class: 'cp-podzone-t' }, '📷 Upload signed delivery receipt'), h('div', { class: 'cp-muted', style: 'font-size:.8rem' }, 'Photo or PDF · the invoice goes out the same day')]) : null,
    ]);
    return h('div', { class: 'cp-card', 'data-tour': 'trips-list' }, [cardHead('My loads', '3 active'),
      trip('Dallas, TX', 'Atlanta, GA', ROLE === 'driver' ? 'You' : 'Luis', 'At pickup', true), trip('Houston, TX', 'Memphis, TN', 'Ray', 'In transit', false), trip('Laredo, TX', 'Chicago, IL', 'Maria', 'Booked', false)]);
  },
  documents() {
    return h('div', { class: 'cp-card', 'data-tour': 'docs-list' }, [cardHead('Documents', '1 expiring · 1 missing'),
      ...[['Operating authority (MC 123456)', 'Verified · valid', 'ok'], ['Certificate of insurance', 'Expires Oct 6 · upload the renewal', 'warn'], ['W-9', 'Missing', 'warn'], ['Void check / bank letter', 'Verified', 'ok']].map(([t, s, k]) =>
        h('div', { class: 'cp-row' }, [h('div', null, [h('div', { class: 'cp-row-t' }, t), h('div', { class: 'cp-row-s' }, s)]), h('span', { class: 'cp-chip ' + k }, k === 'ok' ? 'Valid' : 'Action')])),
      h('button', { class: 'cp-btn', style: 'margin-top:12px' }, [icon('upload', 16), ' Upload a document'])]);
  },
  finance() {
    return h('div', { class: 'cp-dash' }, [
      h('div', { class: 'cp-kpis', 'data-tour': 'fin-summary' }, [stat(money(12840), 'Earned this week', 'dollar'), stat(money(4900), 'On its way', 'send'), stat(money(360), 'Detention paid', 'clock', 'amber'), stat('Fri', 'Next settlement', 'cal')]),
      h('div', { class: 'cp-card' }, [cardHead('Settlements', 'Per load', true), ...[['Dallas → Atlanta', 'Linehaul $2,450 · detention $120 · fee −$122.50', '$2,447.50'], ['Houston → Memphis', 'Linehaul $1,980 · fee −$99.00', '$1,881.00']].map(([a, b, c]) =>
        h('div', { class: 'cp-row' }, [h('div', null, [h('div', { class: 'cp-row-t' }, a), h('div', { class: 'cp-row-s' }, b)]), h('b', null, c)]))]),
    ]);
  },
  dispatcher() {
    return h('div', { class: 'cp-dash' }, [
      h('div', { 'data-tour': 'disp-hero', style: 'border-radius:22px;padding:22px;background:linear-gradient(135deg,#132a4d 0%,#0f1f3a 55%,#0d1a31 100%);border:1px solid rgba(255,255,255,.1);color:#fff' }, [
        h('div', { style: 'font-size:.68rem;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#7fb4ff;margin-bottom:8px' }, 'Your dispatcher'),
        h('div', { style: 'font-size:1.45rem;font-weight:900;line-height:1.2;margin-bottom:8px' }, 'Get a dedicated dispatcher on the line'),
        h('div', { style: 'color:#b9c7e0;font-size:.92rem;max-width:520px' }, 'A LoadBoot dispatcher books, negotiates and handles brokers for you. Assigned within 3 business days of approval. Pause or change any time.'),
        h('div', { style: 'display:flex;gap:8px;margin-top:14px' }, [h('button', { class: 'cp-btn' }, 'Request a dispatcher'), h('button', { class: 'cp-btn ghost' }, 'How it works')])]),
    ]);
  },
  fleet() {
    return h('div', { class: 'cp-grid', 'data-tour': 'fleet-list' }, [
      h('div', { class: 'cp-card' }, [cardHead('Trucks', '3'), ...[['#101 · 2021 Freightliner Cascadia', 'Dry van · Luis'], ['#102 · 2019 Kenworth T680', 'Reefer · Ray'], ['#103 · 2022 Volvo VNL', 'Dry van · Maria']].map(([a, b]) => h('div', { class: 'cp-row' }, [h('div', null, [h('div', { class: 'cp-row-t' }, a), h('div', { class: 'cp-row-s' }, b)]), pill('Active', 'blue')])), h('button', { class: 'cp-btn cp-btn-sm ghost', style: 'margin-top:10px' }, '+ Add truck')]),
      h('div', { class: 'cp-card' }, [cardHead('Drivers', '3'), ...[['Luis Ortega', 'Can see: loads, documents'], ['Ray Coleman', 'Can see: loads'], ['Maria Santos', 'Can see: loads, earnings']].map(([a, b]) => h('div', { class: 'cp-row' }, [h('div', null, [h('div', { class: 'cp-row-t' }, a), h('div', { class: 'cp-row-s' }, b)]), pill('Online')])), h('button', { class: 'cp-btn cp-btn-sm ghost', style: 'margin-top:10px' }, '+ Invite driver by phone')]),
    ]);
  },
  notifications() { return h('div', { class: 'cp-card' }, [cardHead('Alerts', '3 unread'), ...[['New booking request', 'Apex Logistics wants truck #101 for Dallas → Atlanta', true], ['Insurance expires in 12 days', 'Upload the renewal to stay bookable', true], ['Payout sent', '$2,447.50 · arrives Friday', true], ['Load delivered', 'Houston → Memphis · POD received', false]].map(([t, s, u]) => h('div', { class: 'cp-notif' + (u ? ' unread' : ''), style: 'padding:11px 0;border-bottom:1px solid rgba(148,163,184,.15)' }, [h('div', { class: 'cp-row-t' }, t), h('div', { class: 'cp-row-s' }, s)]))]); },
  safety() { return h('div', { class: 'cp-card' }, [cardHead('Safety'), h('div', { class: 'cp-grid' }, [h('button', { class: 'cp-btn cp-btn-lg', style: 'background:#dc2626' }, '🚨 Emergency · 911'), h('button', { class: 'cp-btn cp-btn-lg ghost' }, 'Call the office'), h('button', { class: 'cp-btn cp-btn-lg ghost' }, 'Roadside assistance'), h('button', { class: 'cp-btn cp-btn-lg ghost' }, 'Report an incident')])]); },
  account() { return h('div', { class: 'cp-card' }, [cardHead(ROLE === 'driver' ? 'Me' : 'Account'), ...[['Company', CO], ['Email', NAME.toLowerCase() + '@redlinefreight.com'], ['Appearance', 'Dark'], ['Bottom bar tabs', 'Customize']].map(([a, b]) => h('div', { class: 'cp-row' }, [h('div', { class: 'cp-row-t' }, a), h('div', { class: 'cp-row-s' }, b)]))]); },
  generic(t) { return h('div', { class: 'cp-card' }, [cardHead(t), h('p', { class: 'cp-muted' }, 'This screen is part of the real portal; the preview only shows the shell here.')]); },
};
function go(id) {
  tab = id; if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
  Object.keys(navLinks).forEach((k) => navLinks[k].forEach((a) => { a.classList.toggle('active', k === tab); if (k === tab) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); }));
  const item = NAV.find((n) => n[0] === tab); titleEl.textContent = item ? item[1] : 'Dashboard';
  mount(content, (V[tab] || (() => V.generic(item ? item[1] : tab)))());
  content.scrollTop = 0; help.onRoute(tab);
}
function toast(m) { const t = h('div', { style: 'position:fixed;left:50%;bottom:110px;transform:translateX(-50%);background:#0b1220;color:#fff;padding:10px 16px;border-radius:12px;font-weight:700;font-size:.9rem;z-index:9500;box-shadow:0 12px 30px -10px rgba(0,0,0,.6)' }, m); document.body.appendChild(t); setTimeout(() => t.remove(), 1800); }

// ---------- the tour ----------
const tour = createTour({ key: 'carrier-preview-' + ROLE, version: 1, role: ROLE, flows: CARRIER_TOUR.flows, screens: CARRIER_TOUR.screens, userName: NAME,
  navigate: (r) => go(String(r).replace('#', '')), currentRoute: () => tab,
  onEvent: (n, d) => { try { parent.postMessage({ type: 'tour.event', name: n, data: d }, '*'); } catch (_) {} } });
const help = mountHelp(tour, { supportRoute: '#support', navigate: (r) => go(String(r).replace('#', '')) });
window.addEventListener('hashchange', () => go((location.hash || '').replace('#', '') || 'dashboard'));
window.addEventListener('message', (e) => { const m = e.data || {}; if (m.type === 'tour.restart') { tour.reset(); go('dashboard'); tour.start(); } if (m.type === 'tour.screen') { tour.startScreen(tab); } if (m.type === 'help.open') help.open(); });
go(tab);
setTimeout(() => tour.autoStart(), 700);
