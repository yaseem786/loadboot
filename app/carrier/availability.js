// Daily truck availability — owner rule 5 Sep 2026.
//
// One card, three places (Dashboard, Load Board, and the posting form's footer) that always says the
// same thing: LoadBoot's dedicated dispatcher works a carrier's loads ONLY while at least one
// availability post was confirmed in the last 24 hours. A post is either "my truck is empty at X"
// or "I'm booked, I deliver at X on <date> and need a backhaul toward Y". Posts go stale daily.
//
// Additive module. It receives the portal's own h() so it renders in the portal's theme, and it
// never talks to the backend itself — the caller passes the status object from
// cc_my_availability_status() and the callbacks. Nothing here can break booking/settlement engines.

export const AVAIL_RULE = 'Your dedicated LoadBoot dispatcher works your loads only while an availability post is confirmed within the last 24 hours. Posts expire daily — confirm every morning, or post the backhaul the moment you are booked.';

export function fleetGap(status) {
  const s = status || {};
  if (s.has_truck === false && s.has_driver === false) return 'truck and driver';
  if (s.has_truck === false) return 'truck';
  if (s.has_driver === false) return 'driver';
  return null;
}

function agoText(hours) {
  if (hours == null) return '';
  if (hours < 1) return 'just now';
  if (hours < 24) return hours + 'h ago';
  const d = Math.floor(hours / 24);
  return d + ' day' + (d === 1 ? '' : 's') + ' ago';
}

// Route the carrier to the exact missing Fleet step. #fleet/add-truck and #fleet/add-driver are
// existing deep links (LB_DEEP in app.js) that open the matching form on arrival.
export function goFleet(which) {
  try { location.hash = which === 'driver' ? '#fleet/add-driver' : '#fleet/add-truck'; } catch (_) {}
}

// opts: { h, status, variant: 'dashboard'|'board', onPost(kind), onConfirm(), busy }
export function renderAvailabilityCard(host, opts) {
  const h = opts.h; const s = opts.status || {}; const variant = opts.variant || 'dashboard';
  host.innerHTML = '';
  const gap = fleetGap(s);
  const live = Number(s.live || 0), fresh = Number(s.fresh || 0);
  const hrs = s.hours_since_confirm;

  let tone, title, body, actions;
  if (gap) {
    tone = { c: '#FC5305', bg: 'rgba(252,83,5,.08)', label: 'Setup needed' };
    title = 'Post your availability — add your ' + gap + ' first';
    body = 'We post trucks, not accounts. Add at least one truck and one driver under Fleet, then post where the truck is today.';
    actions = [
      (s.has_truck === false) ? h('button', { class: 'cp-btn cp-btn-sm', onClick: () => goFleet('truck') }, '+ Add truck') : null,
      (s.has_driver === false) ? h('button', { class: 'cp-btn cp-btn-sm' + (s.has_truck === false ? ' ghost' : ''), onClick: () => goFleet('driver') }, '+ Add driver') : null,
    ];
  } else if (fresh > 0) {
    tone = { c: '#4ade80', bg: 'rgba(74,222,128,.07)', label: 'Dispatcher working your loads' };
    title = fresh + ' truck' + (fresh === 1 ? '' : 's') + ' posted · confirmed ' + agoText(hrs);
    body = 'Your dispatcher is sourcing against this post right now. It expires ' + (hrs != null ? 'in ' + Math.max(0, 24 - hrs) + 'h' : 'in 24h') + ' — confirm again tomorrow morning, or post the backhaul as soon as you are booked.';
    actions = [
      h('button', { class: 'cp-btn cp-btn-sm', onClick: () => opts.onPost && opts.onPost('empty') }, '+ Post another truck'),
      h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => opts.onPost && opts.onPost('backhaul') }, 'Booked — post backhaul'),
    ];
  } else if (live > 0) {
    tone = { c: '#fbbf24', bg: 'rgba(251,191,36,.08)', label: 'Confirm today' };
    title = 'Your post is ' + (hrs != null ? hrs + ' hours' : 'a day') + ' old — still right?';
    body = 'Until you confirm, your dedicated dispatcher is paused on your loads. One tap if the truck is still there; update it if it moved.';
    actions = [
      h('button', { class: 'cp-btn cp-btn-sm', disabled: opts.busy ? 'disabled' : null, onClick: () => opts.onConfirm && opts.onConfirm() }, '✓ Still available today'),
      h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => opts.onPost && opts.onPost('empty') }, 'Truck moved — update'),
    ];
  } else {
    tone = { c: '#FC5305', bg: 'rgba(252,83,5,.08)', label: 'Dispatcher paused' };
    title = 'No availability posted today';
    body = 'Your dedicated dispatcher is not working your loads right now — we only source for trucks we know are free. Tell us where the truck is (30 seconds), or where it delivers if you are booked and need a backhaul.';
    actions = [
      h('button', { class: 'cp-btn cp-btn-sm', onClick: () => opts.onPost && opts.onPost('empty') }, '+ Post availability'),
      h('button', { class: 'cp-btn cp-btn-sm ghost', onClick: () => opts.onPost && opts.onPost('backhaul') }, 'Booked — need a backhaul'),
    ];
  }

  const card = h('div', { class: 'cp-card', 'data-lb': 'avail-card', style: 'border-left:4px solid ' + tone.c + ';background:' + tone.bg + (variant === 'board' ? ';margin-bottom:12px' : '') }, [
    h('div', { style: 'display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap' }, [
      h('div', { style: 'min-width:0;flex:1' }, [
        h('div', { class: 'cp-row-s', style: 'color:' + tone.c + ';font-weight:800;letter-spacing:.02em;text-transform:uppercase;font-size:.72rem' }, tone.label),
        h('div', { class: 'cp-row-t', style: 'margin-top:2px' }, title),
        h('div', { class: 'cp-row-s', style: 'margin-top:4px;line-height:1.5' }, body),
      ]),
      h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;align-items:center' }, actions.filter(Boolean)),
    ]),
    h('div', { class: 'cp-row-s', style: 'margin-top:10px;padding-top:8px;border-top:1px solid rgba(148,163,184,.18);font-size:.78rem;color:#94a3b8;line-height:1.5' }, [
      h('span', { style: 'font-weight:800;color:#cbd5e1' }, 'The rule: '), AVAIL_RULE,
    ]),
  ]);
  host.appendChild(card);
  return card;
}

// Short line for the posting form footer and the per-post rows.
export function freshnessLine(h, p) {
  if (!p) return null;
  if (p.status === 'paused') return null;
  if (p.is_fresh) return h('div', { class: 'cp-row-s', style: 'color:#4ade80;font-weight:700;margin-top:2px' }, '● Confirmed ' + agoText(p.hours_since_confirm) + ' · dispatcher working it');
  if (p.is_live) return h('div', { class: 'cp-row-s', style: 'color:#fbbf24;font-weight:700;margin-top:2px' }, '◐ Not confirmed today (' + agoText(p.hours_since_confirm) + ') — dispatcher paused until you confirm');
  return null;
}
