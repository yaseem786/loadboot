// dialer-guide.js — bl_dial_0461 (26 Sep 2026): the in-phone guide. Opens by itself the first time a dispatcher
// opens the phone (once per browser), and any time from the "?" in the phone header. Six short chapters — your
// line, calls, texts, WhatsApp, rules, daily rhythm — each with "how" steps and the do / don't that the Phone
// Terms and the SMS / WhatsApp gates actually enforce, so nothing here promises what the server refuses.
// Pure view: dialer.js passes its h() / ic() and the live line + terms; this file keeps no state but the seen flag.
import { el } from './ui/dom.js';

const KEY = 'lbd_guide_seen_v1';
export function guideSeen() { try { return localStorage.getItem(KEY) === '1'; } catch (_) { return true; } }
export function guideMarkSeen() { try { localStorage.setItem(KEY, '1'); } catch (_) {} }

const CSS = `
.lbg{display:flex;flex-direction:column;gap:10px;padding:2px 0 4px}
.lbg-rail{display:flex;gap:6px;overflow-x:auto;padding:2px 0 4px;scrollbar-width:none}.lbg-rail::-webkit-scrollbar{display:none}
.lbg-rail button{flex:none;display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 11px;border-radius:99px;border:1px solid var(--ln);background:rgba(255,255,255,.03);color:var(--mu);font:600 12px Inter,system-ui,sans-serif;cursor:pointer}
.lbg-rail button.on{background:rgba(8,131,247,.18);border-color:rgba(8,131,247,.5);color:#fff}
.lbg-rail button.done{color:#4ade80}
.lbg-hero{display:flex;gap:12px;align-items:center;padding:12px 14px;border-radius:14px;background:linear-gradient(135deg,rgba(8,131,247,.22),rgba(252,83,5,.10));border:1px solid rgba(124,192,255,.25)}
.lbg-hero .orb{flex:none;width:44px;height:44px;border-radius:14px;display:grid;place-items:center;background:var(--bl);color:#fff;box-shadow:0 8px 24px rgba(8,131,247,.45)}
.lbg-hero b{display:block;color:#fff;font-size:15px}.lbg-hero span{color:var(--mu);font-size:12px;line-height:1.45;display:block;margin-top:2px}
.lbg-sec{border:1px solid var(--ln);border-radius:12px;padding:10px 12px;background:rgba(0,0,0,.16)}
.lbg-sec>b{display:flex;align-items:center;gap:7px;color:#fff;font-size:12.5px;margin-bottom:6px}
.lbg-steps{margin:0;padding:0;list-style:none;display:grid;gap:6px}
.lbg-steps li{display:grid;grid-template-columns:22px 1fr;gap:8px;font-size:12.5px;line-height:1.5;color:#dbe4f3}
.lbg-steps li i{width:22px;height:22px;border-radius:50%;background:rgba(8,131,247,.25);color:#fff;font-style:normal;font-weight:800;font-size:11px;display:grid;place-items:center;margin-top:1px}
.lbg-rules{display:grid;gap:5px}.lbg-rules div{display:flex;gap:8px;font-size:12.3px;line-height:1.45;color:#dbe4f3;align-items:flex-start}
.lbg-rules .ok{color:#4ade80;font-weight:800;flex:none}.lbg-rules .no{color:#f87171;font-weight:800;flex:none}
.lbg-tip{font-size:12px;color:#c9d6e5;background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.35);border-radius:10px;padding:8px 10px;line-height:1.5}
.lbg-nav{display:flex;gap:8px;align-items:center;margin-top:2px}.lbg-nav .dots{flex:1;display:flex;gap:5px;justify-content:center}
.lbg-nav .dots i{width:6px;height:6px;border-radius:50%;background:rgba(255,255,255,.18)}.lbg-nav .dots i.on{background:var(--bl);width:16px;border-radius:99px}
.lbg-num{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#fff;font-weight:800;letter-spacing:.02em}
@media (prefers-reduced-motion:no-preference){.lbg-sec{animation:lbgIn .18s ease-out}}@keyframes lbgIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
`;
let cssDone = false;

function chapters(ctx) {
  const line = ctx.line && ctx.line.number ? ctx.pretty(ctx.line.number) : null;
  const pts = Array.isArray(ctx.terms && ctx.terms.points) ? ctx.terms.points : [];
  return [
    { id: 'line', icon: 'phone', label: 'Your line', title: line ? 'Your LoadBoot line is ' + line : 'Your LoadBoot line', lead: 'One number for everything — calls, texts and the caller-id carriers and brokers see. It is the only number you ever give out.',
      how: ['The green dot in the header means the phone is connected. Grey? Open ⚙ → “Reconnect phone” and allow the microphone when the browser asks.',
            'Tap the copy icon next to your number to paste it into an e-mail or a rate confirmation.',
            'Minimise the phone with the ▾ — calls keep ringing in the dock while you work the board.'],
      rules: [['ok', 'Give brokers and carriers THIS number, and the LoadBoot mailbox.'], ['no', 'Never your personal phone, WhatsApp, Telegram or social account — for anyone, ever.'], ['no', 'Never move a carrier, a driver or a broker off LoadBoot. A confirmed report = same-day suspension.']] },
    { id: 'calls', icon: 'pad', label: 'Calls', title: 'Calls — keypad, click-to-call, wrap-up', lead: 'Every call is made and answered here, in the browser. Nothing is dialled from a handset.',
      how: ['Keypad: type the number, or simply tap any phone number anywhere in the workspace — carrier, driver, broker rep — and it dials with the right name attached.',
            'On the call: mute, speaker, keypad for IVR menus, hang up. A second incoming call shows in the dock.',
            'After EVERY call the wrap-up appears: pick the Outcome (Booked, Quoted, Load gone, Rate too low, No new MC, Left voicemail, Check call, No answer…), a tag and a one-line note. It is not optional — it is how LoadBoot sees your day.',
            'Recent: your history with recordings where allowed, and a tap to call back. Callbacks: missed calls and “call me back” requests — return them the same working session.'],
      rules: [['ok', 'Say “LoadBoot Dispatch for <carrier>” — that is who you are on the phone.'], ['ok', 'No answer? Two tries ten minutes apart, then the driver, then a text.'], ['no', 'No auto-dialling, no robocalls, no calling the same number over and over. No calls outside reasonable hours in the other side’s time zone.'], ['no', 'Never promise a rate below the carrier’s floor before LoadBoot approves it.']] },
    { id: 'sms', icon: 'msg', label: 'Texts', title: 'Texts (SMS) — only with consent', lead: 'Texts go from the same number. The law (TCPA) and the carriers’ rules mean a number must agree before you text it — the phone enforces this.',
      how: ['Texts tab → pick a number (or tap the message icon next to a call). The first time, the phone checks whether that number agreed to texts.',
            'No consent yet? Choose how they agree: “They said yes on a call” — read the consent line out word for word and log which call; or “Their greeting says to text” — quote the greeting. Then you can text.',
            'Threads refresh on their own. A reply to STOP is handled automatically; HELP too. Do not text a number that opted out — the phone will refuse.',
            'Keep it business: load details, pickup times, check calls, RC follow-ups. Never marketing.'],
      rules: [['ok', 'Consent first, every number, once. It is logged with your name.'], ['no', 'Never text a personal phone number you found elsewhere, never bulk texts, never after STOP.'], ['no', 'Never send bank details, rates from other carriers or anything about another dispatcher’s carrier.']] },
    { id: 'wa', icon: 'msg', label: 'WhatsApp', title: 'WhatsApp — the LoadBoot line, Meta’s 24-hour rule', lead: 'Texts tab → WhatsApp. LoadBoot has ONE WhatsApp Business line shared by dispatchers; each conversation belongs to the dispatcher of that carrier. No WhatsApp groups — everything is a thread here that LoadBoot can see.',
      how: ['A carrier or driver who messaged the LoadBoot number in the last 24 hours: reply freely — text, photo, PDF, voice note. The countdown in the thread shows how long the window stays open.',
            'Window closed, or a carrier who never wrote to us? Only a Meta-approved template can open the conversation. The picker shows the templates you may send (e.g. “dispatcher assigned”, call follow-up, RC follow-up) — read the text, fill the fields, send. Their reply re-opens the 24-hour window.',
            'Need the driver? Open the driver’s own thread and paste — no forwarding between people.',
            'Command Center sees every thread live and can step in. Treat every message as if the owner of LoadBoot is reading it — because they can.'],
      rules: [['ok', 'Carriers: “this is where you reach me about your loads, truck and paperwork.” Keep it in the thread.'], ['no', 'Never from your own WhatsApp. Never add a carrier to a private group. Never promotional messages — Meta blocks them and LoadBoot pays.'], ['no', 'Media only for the load: RCs, PODs, photos of the truck. Nothing personal.']] },
    { id: 'rules', icon: 'check', label: 'Rules', title: 'Phone Terms — what you accepted', lead: pts.length ? 'This is the live version of the LoadBoot Phone Terms you accepted in this phone. Calls and messages are logged and reviewed.' : 'The LoadBoot Phone Terms you accepted when the phone opened. Calls and messages are logged and reviewed.',
      how: pts.length ? pts.map((p) => typeof p === 'string' ? p : (p && (p.text || p.title || p.body)) || '').filter(Boolean)
                      : ['Only the LoadBoot line and mailbox, never a personal channel.', 'No re-brokering, no touching freight money, no bank details by phone or text.', 'Every call gets a wrap-up; every text and WhatsApp has consent or an approved template.', 'Reasonable hours, no harassment, no auto-dialling.', 'Everything is logged; a confirmed report ends the trial.'],
      rules: [['ok', 'When in doubt, put it in the Messages thread and let LoadBoot decide.'], ['no', 'The rules do not bend for a “good” load. A violation is a permanent block, no re-application.']] },
    { id: 'day', icon: 'clock', label: 'Your day', title: 'A dispatcher’s day, in ET', lead: 'All times in the workspace are US Eastern — brokers, rate confirmations and appointments run on it.',
      how: ['07–08 ET · Check-in: availability for every truck, callbacks from overnight, yesterday’s open items.', '08–11 · Booking: the board, calls to brokers, offers to the carrier. Best hours of the day — protect them.', '11–13 · Confirm: rate confirmations in, bookings logged, pickup details to the driver.', '13–15 · Exceptions: detention, delays, check calls every 4 hours while loaded.', '15–18 · Reloads: tomorrow’s truck, backhauls, post the availability.', 'After hours: on call for the driver — emergencies only, summary in the thread.'],
      rules: [['ok', 'Trial rule: the carrier judges you by daily, genuine offers and a booking by day 4. Log everything here — it is your evidence.']] },
  ];
}

// ctx: { h, ic, pretty, line, terms, onClose, onGo(tab) }
export function guideView(ctx) {
  if (!cssDone) { cssDone = true; document.head.appendChild(el('style', { id: 'lbg-css' }, CSS)); }
  const h = ctx.h, ic = ctx.ic;
  const CH = chapters(ctx); let i = Math.max(0, Math.min(CH.length - 1, ctx.start || 0)); const seen = new Set();
  const root = h('div', { class: 'lbg', role: 'region', 'aria-label': 'How to use the phone' });
  const paint = () => {
    const c = CH[i]; seen.add(c.id);
    root.replaceChildren(
      h('div', { class: 'lbg-rail', role: 'tablist' }, CH.map((x, k) => h('button', { type: 'button', role: 'tab', 'aria-selected': String(k === i), class: (k === i ? 'on' : '') + (seen.has(x.id) && k !== i ? ' done' : ''), onClick: () => { i = k; paint(); } }, [ic(x.icon, 13), x.label]))),
      h('div', { class: 'lbg-hero' }, [h('div', { class: 'orb' }, ic(c.icon, 22)), h('div', null, [h('b', null, c.title), h('span', null, c.lead)])]),
      h('div', { class: 'lbg-sec' }, [h('b', null, [ic('check', 13), c.id === 'rules' ? 'The terms' : c.id === 'day' ? 'The rhythm' : 'How it works']), h('ol', { class: 'lbg-steps' }, c.how.map((s, n) => h('li', null, [h('i', null, String(n + 1)), h('span', null, s)])))]),
      c.rules && c.rules.length ? h('div', { class: 'lbg-sec' }, [h('b', null, [ic('x', 13), 'Do / don’t']), h('div', { class: 'lbg-rules' }, c.rules.map(([k, t]) => h('div', null, [h('span', { class: k }, k === 'ok' ? '✓' : '✕'), h('span', null, t)])))]) : null,
      c.id === 'calls' ? h('div', { class: 'lbg-tip' }, 'Tip: on a carrier’s page the owner’s and driver’s numbers each have Call and Copy right next to them — use those, never retype a number.') : null,
      c.id === 'wa' ? h('div', { class: 'lbg-tip' }, 'Tip: the fastest way to open a window is to have the owner message the LoadBoot number first — the assignment e-mail and the carrier app both carry the “WhatsApp me” link.') : null,
      h('div', { class: 'lbg-nav' }, [
        h('button', { class: 'lbd-btn ghost', type: 'button', disabled: i === 0, onClick: () => { i = Math.max(0, i - 1); paint(); } }, '‹ Back'),
        h('div', { class: 'dots' }, CH.map((_, k) => h('i', { class: k === i ? 'on' : '' }))),
        i < CH.length - 1 ? h('button', { class: 'lbd-btn', type: 'button', onClick: () => { i = Math.min(CH.length - 1, i + 1); paint(); } }, 'Next ›')
                          : h('button', { class: 'lbd-btn', type: 'button', onClick: () => { guideMarkSeen(); ctx.onClose && ctx.onClose(); } }, 'Got it — open the keypad'),
      ]),
      h('button', { class: 'lbd-btn ghost', type: 'button', style: 'width:100%', onClick: () => { guideMarkSeen(); ctx.onClose && ctx.onClose(); } }, 'Close guide — I can reopen it from the ? in the header'),
    );
  };
  paint();
  return root;
}
