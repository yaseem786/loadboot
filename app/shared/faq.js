// faq.js — in-app searchable help center (Uber/DoorDash/Amazon pattern).
// Static content (no backend), searchable accordion. Answers stay short and honest.
export const CARRIER_FAQ = [
  ['How do I get verified?', 'Go to Documents and upload your COI (certificate of insurance), W-9 and authority docs, then sign the Dispatch Agreement. Our team reviews the same day on business days. Your Account page shows a live verification status pill.'],
  ['How does booking a load work?', 'Tap a load on the Load Board → "Send booking request". The broker reviews your verified profile and approves — first acceptance wins. You are never committed until the broker approves and you get a rate confirmation.'],
  ['What does LoadBoot cost?', 'Free to join. A 5% dispatch fee is deducted only when you book and run a load through LoadBoot — no subscriptions, no contracts. Every settlement shows the fee line before Net.'],
  ['When and how do I get paid?', 'After delivery, upload the POD on the trip. Direct-pay brokers pay you per the load terms; if you use factoring, we route the invoice to your factoring company automatically once your NOA is on file (Finance → Factoring).'],
  ['What is an NOA and why do you ask for it?', 'A Notice of Assignment tells brokers to pay your factoring company instead of you. Upload it once in Finance → Factoring and we attach it to every invoice automatically.'],
  ['How does detention work?', 'Arrive and depart with GPS on the trip screen — the timestamps are your evidence. After the free window (usually 2h) the app auto-calculates detention and you can file the claim in one tap from the trip. TONU, layover and lumper claims work the same way.'],
  ['Why does the app ask for my location?', 'Live GPS replaces broker check calls, proves your detention claims, powers deadhead-to-pickup distances on the load board, and shows you can make pickup/delivery on time. Location is shared only while a load is active — you stay in control.'],
  ['How do I upload a POD?', 'Open the trip after delivery → Upload POD. You can photograph the paper POD with your camera — the app converts photos into a single PDF. Payment processing starts once the POD is approved.'],
  ['Can I add drivers and trucks?', 'Yes — Fleet tab. Add drivers (with CDL + medical card dates) and trucks (VIN auto-decodes). You can invite drivers to their own app login and assign them to trips.'],
  ['What if pickup or delivery goes wrong?', 'Use "Report issue" on the trip for normal problems, or the Emergency button for urgent ones (breakdown, accident, rescheduling). Dispatch is on call for active loads.'],
  ['How do I change my notifications?', 'Settings → Notifications turns push on/off for this device. Account → Preferences has per-category toggles (load offers, weekly summaries, SMS, marketing).'],
  ['The app looks outdated / stuck — how do I update?', 'When a new version ships, a blue "Update" bar appears — tap it. You can also close and reopen the app twice. Your data is never stored in the app, so updates never lose anything.'],
  ['How do I delete my account?', 'Settings → Delete account. We queue the deletion with a 30-day window in case you change your mind — you can cancel it from the same place.'],
  ['How do referrals work?', 'Share your referral link (Settings → Invite & earn). When a carrier you refer signs up and runs loads, you earn a share of the dispatch fee — accrued after a 15-day hold and paid out on request.'],
  ['Is my rate negotiable?', 'Yes — on any load tap "Counter" and propose your all-in rate. Check Market Rates first so you never haul below your cost per mile.'],
];

export const PARTNER_FAQ = [
  ['How do I post a load?', 'Dashboard → Post a load. The 5-step wizard saves a draft as you type, so nothing is lost if you leave. Our dispatch team reviews each submission and generates the document checklist before it goes live to carriers.'],
  ['How are carriers vetted?', 'Every carrier is FMCSA-verified (authority, insurance, safety) and carries a trip-verified rating: on-time %, loads delivered, cancellations. Tap any carrier for the full profile and reviews before you approve a booking.'],
  ['What does LoadBoot cost brokers?', 'Posting and tracking is free. The dispatch fee is carried on the carrier side — your rate is your rate.'],
  ['How does live tracking work?', 'Once a carrier is dispatched, the load card → Track shows a live map, ETA and milestone timeline from the driver’s GPS. Every milestone also lands in your notifications.'],
  ['How do claims work?', 'Detention, layover and TONU claims arrive with GPS evidence attached (arrive/depart stamps). Approve or dispute in the Claims tab; disputed claims can be escalated to LoadBoot support for a verdict.'],
  ['How do I pay carrier invoices?', 'Invoices tab → each payable shows pay-by date and bank rail details. Mark payment sent and the carrier confirms receipt — both sides see the same status.'],
  ['What documents do I need to submit?', 'The Documents tab lists your checklist: W-9 (sign in-app), broker authority, bond, and the broker agreement (sign in-app). Verification usually completes the same business day.'],
  ['Can I offer a load to a specific carrier?', 'Yes — when posting, target a carrier you’ve worked with; they get a reserved direct offer with a time window before the load opens to the board.'],
  ['How do I change my login email or password?', 'Account → Security. Password resets go by email; changing the login email sends confirmation links to both addresses.'],
  ['How do I delete my account?', 'Account → Delete account. Deletion is queued with a 30-day window and you can cancel it any time before it completes.'],
];

export function renderFaq(host, items, opts) {
  const o = opts || {};
  const wrap = document.createElement('div');
  const q = document.createElement('input');
  q.className = 'cp-in';
  q.placeholder = o.placeholder || 'Search help… (e.g. detention, POD, payment)';
  q.setAttribute('aria-label', 'Search help articles');
  const list = document.createElement('div');
  list.style.marginTop = '8px';
  function draw(filter) {
    list.innerHTML = '';
    const f = (filter || '').trim().toLowerCase();
    const rows = items.filter(([qq, aa]) => !f || (qq + ' ' + aa).toLowerCase().includes(f));
    if (!rows.length) {
      const none = document.createElement('div');
      none.className = 'cp-row-s';
      none.style.cssText = 'padding:10px 0;color:#94a3b8';
      none.textContent = 'No matching answers — message us below and a person will help.';
      list.appendChild(none);
      return;
    }
    rows.forEach(([qq, aa]) => {
      const d = document.createElement('details');
      d.style.cssText = 'border-bottom:1px solid rgba(148,163,184,.18);padding:4px 0';
      const s = document.createElement('summary');
      s.style.cssText = 'cursor:pointer;font-weight:700;font-size:.88rem;padding:7px 0;list-style-position:inside';
      s.textContent = qq;
      const p = document.createElement('div');
      p.style.cssText = 'font-size:.84rem;line-height:1.55;color:#94a3b8;padding:2px 0 10px';
      p.textContent = aa;
      d.appendChild(s); d.appendChild(p);
      if (f) d.open = true;
      list.appendChild(d);
    });
  }
  let t = null;
  q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => draw(q.value), 180); });
  draw('');
  wrap.appendChild(q); wrap.appendChild(list);
  if (host) { host.appendChild(wrap); }
  return wrap;
}
export default { CARRIER_FAQ, PARTNER_FAQ, renderFaq };
