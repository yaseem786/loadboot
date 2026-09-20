// dialer.js — LoadBoot Dispatcher Dialer (bl_dial_0351). A self-contained softphone dock.
//
// What it is: every dispatcher gets ONE dedicated US number. They dial, answer, mute, hold and send DTMF
// right here in the portal (Telnyx WebRTC — no SIM, no app). Every call is a LoadBoot record: who, whom,
// when, how long, which broker / booking, the outcome, the note, the recording.
//
// Design rules (same as the dispatcher workspace): dark premium, brand palette, no alert/confirm/prompt,
// mobile-first bottom sheet, every control keyboard-reachable, nothing here decides access — the server
// does (dialer_* RPCs + the telnyx-token edge function). The Telnyx API key never reaches the browser.
//
// Integration surface (deliberately tiny):
//   mountDialer()                       idempotent; call once after the dispatcher workspace mounts
//   window.LBDialer.call(number, ctx)   ctx = { contact_name, broker_contact_id, booking_id, load_id, source }
//   any <a href="tel:…"> inside the portal is intercepted → click-to-call (long-press / right-click still native)
import { el, mount } from './ui/dom.js';
import { getClient } from './supabaseClient.js';
import { pushSupported, enablePush, isPushEnabled } from './push.js';
import {
  dialerBootstrap, dialerHeartbeat, dialerLookup, dialerCallStart, dialerCallUpdate, dialerCallTag,
  dialerCallbackSet, dialerHistory, dialerToken, dialerClaimWaiting, dialerRecordingBlob,
 dialerForwardSet, dialerSmsThreads, dialerSmsThread, dialerSmsSend,
} from './api.js';

const h = el;
const ET = 'America/New_York';
const LIVE = ['new', 'trying', 'requesting', 'recovering', 'ringing', 'answering', 'early', 'active', 'held'];
const OUTCOMES = [
  ['booked', 'Booked'], ['quoted', 'Quoted'], ['load gone', 'Load gone'], ['rate too low', 'Rate too low'],
  ['no new MC', 'No new MC'], ['setup pending', 'Setup pending'], ['voicemail left', 'Left voicemail'],
  ['check call', 'Check call / driver update'], ['no answer', 'No answer'], ['wrong number', 'Wrong number'], ['other', 'Other'],
];
const SVG = {
  phone: '<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>',
  hang: '<path d="M10.7 13.3a16 16 0 0 1-2.6-3.4l1.3-1.3a2 2 0 0 0 .4-2.1c-.3-.9-.6-1.8-.7-2.8A2 2 0 0 0 7.1 2h-3a2 2 0 0 0-2 2.2 19.8 19.8 0 0 0 3.1 8.6"/><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1"/><line x1="22" y1="2" x2="2" y2="22"/>',
  spk: '<polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>',
  mic: '<path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="22"/>',
  micoff: '<line x1="2" y1="2" x2="22" y2="22"/><path d="M9 9v3a3 3 0 0 0 5.1 2.1M15 9.3V5a3 3 0 0 0-5.7-1.3"/><path d="M19 10v2a7 7 0 0 1-.6 2.9M5 10v2a7 7 0 0 0 11 5.7"/><line x1="12" y1="19" x2="12" y2="22"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  pad: '<circle cx="5" cy="5" r="1.4"/><circle cx="12" cy="5" r="1.4"/><circle cx="19" cy="5" r="1.4"/><circle cx="5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="19" cy="12" r="1.4"/><circle cx="5" cy="19" r="1.4"/><circle cx="12" cy="19" r="1.4"/><circle cx="19" cy="19" r="1.4"/>',
  back: '<path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/>',
  out: '<line x1="7" y1="17" x2="17" y2="7"/><polyline points="8 7 17 7 17 16"/>',
  inc: '<line x1="17" y1="7" x2="7" y2="17"/><polyline points="16 17 7 17 7 8"/>',
  msg: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
  back: '<polyline points="15 18 9 12 15 6"/>',
  miss: '<polyline points="22 8 22 2 16 2"/><line x1="16" y1="8" x2="22" y2="2"/><path d="M3 12c5-5 13-5 18 0"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  min: '<polyline points="6 9 12 15 18 9"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
  check: '<polyline points="20 6 9 17 4 12"/>',
  cog: '<line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/><circle cx="9" cy="6" r="2.2" fill="currentColor"/><circle cx="15" cy="12" r="2.2" fill="currentColor"/><circle cx="8" cy="18" r="2.2" fill="currentColor"/>',
  vm: '<circle cx="6" cy="12" r="4"/><circle cx="18" cy="12" r="4"/><line x1="6" y1="16" x2="18" y2="16"/>',
};
const ic = (n, s) => h('span', { class: 'lbd-ic', 'aria-hidden': 'true', html: '<svg width="' + (s || 18) + '" height="' + (s || 18) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + SVG[n] + '</svg>' });

// ---------------------------------------------------------------- formatting
const digits = (s) => String(s || '').replace(/[^0-9]/g, '');
function pretty(n) {
  const d = digits(n); const k = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
  if (k.length === 10) return '(' + k.slice(0, 3) + ') ' + k.slice(3, 6) + '-' + k.slice(6);
  return String(n || '');
}
function prettyTyping(v) {
  const plus = String(v).trim()[0] === '+'; let d = digits(v);
  if (plus && d[0] !== '1') return '+' + d;
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  if (d.length > 10) return (plus ? '+' : '') + d;
  if (d.length <= 3) return d; if (d.length <= 6) return '(' + d.slice(0, 3) + ') ' + d.slice(3);
  return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
}
const mmss = (s) => { s = Math.max(0, Math.round(Number(s || 0))); const m = Math.floor(s / 60); return (m >= 60 ? Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0') : String(m)) + ':' + String(s % 60).padStart(2, '0'); };
const talk = (s) => { s = Number(s || 0); if (s < 60) return s + 's'; const m = Math.round(s / 60); return m < 60 ? m + ' min' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm'; };
const ago = (v) => { if (!v) return ''; const m = Math.round((Date.now() - new Date(v).getTime()) / 60000); if (m < 1) return 'now'; if (m < 60) return m + 'm'; const x = Math.round(m / 60); if (x < 24) return x + 'h'; return new Date(v).toLocaleDateString('en-US', { timeZone: ET, month: 'short', day: 'numeric' }); };
const whenET = (v) => new Date(v).toLocaleString('en-US', { timeZone: ET, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET';

// ---------------------------------------------------------------- sounds (WebAudio — no asset files)
let actx = null;
const audioCtx = () => { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); if (actx.state === 'suspended') actx.resume(); } catch (_) {} return actx; };
const DTMF = { 1: [697, 1209], 2: [697, 1336], 3: [697, 1477], 4: [770, 1209], 5: [770, 1336], 6: [770, 1477], 7: [852, 1209], 8: [852, 1336], 9: [852, 1477], '*': [941, 1209], 0: [941, 1336], '#': [941, 1477] };
function tone(freqs, ms, vol) {
  const c = audioCtx(); if (!c) return;
  const g = c.createGain(); g.gain.value = vol || 0.06; g.connect(c.destination);
  freqs.forEach((f) => { const o = c.createOscillator(); o.frequency.value = f; o.connect(g); o.start(); o.stop(c.currentTime + ms / 1000); });
  setTimeout(() => { try { g.disconnect(); } catch (_) {} }, ms + 60);
}
let ringTimer = null;
function ringStart() { ringStop(); const burst = () => { tone([440, 480], 900, 0.09); }; burst(); ringTimer = setInterval(burst, 2600); }
function ringStop() { if (ringTimer) { clearInterval(ringTimer); ringTimer = null; } }

// ---------------------------------------------------------------- styles
const CSS = `
.lbd,.lbd *{box-sizing:border-box}
.lbd{--nv:#10223B;--nv2:#0b1830;--bl:#0883F7;--or:#FC5305;--ok:#22c55e;--bad:#ef4444;--tx:#e8eefc;--mu:#93a4c3;--ln:rgba(255,255,255,.09);
 position:fixed;right:104px;bottom:calc(18px + env(safe-area-inset-bottom));z-index:2147483000;font:14px/1.4 Inter,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--tx)}
.lbd-ic{display:inline-flex;vertical-align:middle}
.lbd-fab{display:flex;align-items:center;gap:10px;height:52px;padding:0 18px 0 14px;border-radius:999px;border:1px solid var(--ln);cursor:pointer;color:#fff;
 background:linear-gradient(135deg,#132a4a,#0b1830);box-shadow:0 10px 30px rgba(3,10,24,.55),inset 0 1px 0 rgba(255,255,255,.06);transition:transform .15s ease,box-shadow .15s ease}
.lbd-fab:hover{transform:translateY(-1px);box-shadow:0 14px 36px rgba(3,10,24,.6)}
.lbd-fab:focus-visible,.lbd button:focus-visible,.lbd input:focus-visible,.lbd textarea:focus-visible,.lbd select:focus-visible{outline:2px solid var(--bl);outline-offset:2px}
.lbd-fab .orb{width:34px;height:34px;border-radius:50%;display:grid;place-items:center;background:var(--bl);box-shadow:0 0 0 0 rgba(8,131,247,.5)}
.lbd-fab.live .orb{background:var(--ok);animation:lbdPulse 1.6s infinite}
.lbd-fab.ring .orb{background:var(--or);animation:lbdShake .5s infinite}
.lbd-fab.off .orb{background:#475569}
.lbd-fab .t{display:flex;flex-direction:column;align-items:flex-start;line-height:1.15}
.lbd-fab .t b{font-size:13px;font-weight:650;letter-spacing:.2px}
.lbd-fab .t span{font-size:11px;color:var(--mu)}
.lbd-badge{min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--or);color:#fff;font-size:11px;font-weight:700;display:grid;place-items:center}
@keyframes lbdPulse{0%{box-shadow:0 0 0 0 rgba(34,197,94,.55)}70%{box-shadow:0 0 0 12px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}
@keyframes lbdShake{0%,100%{transform:rotate(0)}25%{transform:rotate(-12deg)}75%{transform:rotate(12deg)}}
@keyframes lbdUp{from{opacity:0;transform:translateY(14px) scale(.98)}to{opacity:1;transform:none}}
.lbd-panel{width:372px;max-height:min(680px,calc(100vh - 40px));display:flex;flex-direction:column;border-radius:22px;overflow:hidden;border:1px solid var(--ln);
 background:linear-gradient(180deg,#12284a 0%,#0b1830 46%,#08111f 100%);box-shadow:0 30px 80px rgba(2,8,20,.7),inset 0 1px 0 rgba(255,255,255,.07)}
.lbd-panel.in{animation:lbdUp .18s ease}
.lbd-hd{display:flex;align-items:center;gap:10px;padding:14px 14px 10px 16px}
.lbd-hd .who{flex:1;min-width:0}
.lbd-hd .who b{display:block;font-size:15px;letter-spacing:.2px}
.lbd-hd .who span{font-size:11.5px;color:var(--mu);display:flex;align-items:center;gap:6px}
.lbd-dot{width:8px;height:8px;border-radius:50%;background:#64748b;flex:none}
.lbd-dot.ok{background:var(--ok);box-shadow:0 0 8px rgba(34,197,94,.8)}.lbd-dot.warn{background:#f59e0b}.lbd-dot.bad{background:var(--bad)}
.lbd-ib{width:34px;height:34px;border-radius:10px;border:1px solid transparent;background:transparent;color:var(--mu);display:grid;place-items:center;cursor:pointer}
.lbd-ib:hover{background:rgba(255,255,255,.06);color:#fff}
.lbd-ib.on{color:#fff;background:var(--bl)}
.lbd-tabs .lbd-tab{font-size:12px;gap:5px;padding:0 4px}
.lbd-th{display:flex;align-items:center;gap:8px;margin-bottom:8px}.lbd-th .who{flex:1;min-width:0}.lbd-th .who b{display:block;color:#fff;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.lbd-th .who span{font-size:11.5px;color:var(--mu)}
.lbd-msgs{display:flex;flex-direction:column;gap:6px;max-height:300px;min-height:140px;overflow-y:auto;padding:4px 2px 8px}
.lbd-bub{max-width:82%;padding:8px 11px;border-radius:14px;font-size:13px;line-height:1.4;white-space:pre-wrap;word-break:break-word;background:rgba(255,255,255,.08);color:#e8eefc;align-self:flex-start;border-bottom-left-radius:4px}
.lbd-bub.out{align-self:flex-end;background:var(--bl);color:#fff;border-radius:14px;border-bottom-right-radius:4px}
.lbd-bub.fail{background:rgba(239,68,68,.22);color:#fecaca}
.lbd-bub small{display:block;margin-top:3px;font-size:10px;opacity:.7}
.lbd-comp{display:flex;gap:8px;align-items:flex-end;margin-top:8px}.lbd-comp textarea{flex:1;min-height:42px;max-height:120px;resize:none}
.lbd-send{width:44px;height:42px;border-radius:12px;border:0;background:var(--bl);color:#fff;display:grid;place-items:center;cursor:pointer;flex:none}.lbd-send[disabled]{opacity:.45;cursor:not-allowed}
.lbd-tpl{display:flex;gap:6px;overflow-x:auto;padding:2px 0 4px;scrollbar-width:none}.lbd-tpl button{flex:none;border:1px solid var(--ln);background:rgba(255,255,255,.04);color:#dbe6fb;border-radius:999px;padding:5px 10px;font-size:11.5px;cursor:pointer;white-space:nowrap}
.lbd-dotn{width:8px;height:8px;border-radius:50%;background:var(--or);flex:none}
.lbd-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;margin:0 14px 10px;border-radius:12px;overflow:hidden;background:var(--ln)}
.lbd-stats div{background:rgba(8,17,31,.75);padding:7px 4px;text-align:center}
.lbd-stats b{display:block;font-size:14px}.lbd-stats span{font-size:10px;color:var(--mu);text-transform:uppercase;letter-spacing:.6px}
.lbd-tabs{display:flex;gap:4px;padding:0 14px 8px}
.lbd-stats,.lbd-tabs{flex:none}.lbd-stats span{display:block;line-height:1.3}
.lbd-tab{flex:1;height:34px;border-radius:10px;border:1px solid transparent;background:transparent;color:var(--mu);font-weight:600;font-size:12.5px;cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px}
.lbd-tab.on{background:rgba(8,131,247,.14);color:#fff;border-color:rgba(8,131,247,.35)}
.lbd-body{flex:1;overflow:auto;padding:4px 14px 16px;scrollbar-width:thin}
.lbd-num{width:100%;height:54px;border-radius:14px;border:1px solid var(--ln);background:rgba(5,12,24,.7);color:#fff;font-size:24px;font-weight:600;letter-spacing:.6px;text-align:center;padding:0 44px}
.lbd-num::placeholder{color:#55688a;font-size:15px;font-weight:500;letter-spacing:0}
.lbd-numwrap{position:relative}.lbd-numwrap .lbd-ib{position:absolute;right:6px;top:10px}
.lbd-match{min-height:40px;margin:8px 0 6px;padding:8px 12px;border-radius:12px;font-size:12.5px;color:var(--mu);display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.035)}
.lbd-match b{color:#fff;font-weight:600}.lbd-match.bad{color:#fecaca;background:rgba(239,68,68,.12)}
.lbd-keys{display:grid;grid-template-columns:repeat(3,1fr);gap:9px;margin-top:6px}
.lbd-key{height:56px;border-radius:16px;border:1px solid var(--ln);background:rgba(255,255,255,.04);color:#fff;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;transition:background .1s,transform .06s}
.lbd-key:hover{background:rgba(255,255,255,.085)}.lbd-key:active{transform:scale(.96);background:rgba(8,131,247,.25)}
.lbd-key b{font-size:21px;font-weight:600;line-height:1}.lbd-key span{font-size:9px;color:var(--mu);letter-spacing:1.6px;margin-top:3px;min-height:10px}
.lbd-call{width:100%;height:56px;margin-top:12px;border-radius:18px;border:0;cursor:pointer;color:#fff;font-size:16px;font-weight:700;display:flex;align-items:center;justify-content:center;gap:10px;
 background:linear-gradient(135deg,#22c55e,#16a34a);box-shadow:0 10px 26px rgba(34,197,94,.35)}
.lbd-call:disabled{opacity:.45;cursor:not-allowed;box-shadow:none}
.lbd-call.end{background:linear-gradient(135deg,#ef4444,#dc2626);box-shadow:0 10px 26px rgba(239,68,68,.35)}
.lbd-stage{text-align:center;padding:18px 6px 8px}
.lbd-ava{width:84px;height:84px;margin:0 auto 12px;border-radius:50%;display:grid;place-items:center;font-size:30px;font-weight:700;color:#fff;background:linear-gradient(135deg,var(--bl),#0657a8);box-shadow:0 0 0 8px rgba(8,131,247,.12),0 0 0 18px rgba(8,131,247,.05)}
.lbd-stage.ring .lbd-ava{animation:lbdPulse 1.4s infinite;background:linear-gradient(135deg,var(--or),#c43d00)}
.lbd-stage h3{margin:0;font-size:19px;font-weight:700;color:#fff}.lbd-stage .n{color:var(--mu);font-size:13.5px;margin-top:2px}
.lbd-stage .s{margin-top:10px;font-size:15px;font-weight:600;color:#cfe3ff;font-variant-numeric:tabular-nums}
.lbd-rec{display:inline-flex;align-items:center;gap:6px;margin-top:8px;padding:3px 9px;border-radius:999px;font-size:10.5px;font-weight:700;letter-spacing:1px;color:#fecaca;background:rgba(239,68,68,.14)}
.lbd-rec i{width:7px;height:7px;border-radius:50%;background:var(--bad);animation:lbdBlink 1.2s infinite}
@keyframes lbdBlink{50%{opacity:.25}}
.lbd-ctx{margin:10px 0 0;padding:9px 12px;border-radius:12px;background:rgba(255,255,255,.04);font-size:12.5px;color:var(--mu);text-align:left}
.lbd-ctx b{color:#fff}
.lbd-ctrls{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:16px 0 4px}
.lbd-ctrl{height:64px;border-radius:18px;border:1px solid var(--ln);background:rgba(255,255,255,.04);color:#fff;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;font-size:11.5px;font-weight:600}
.lbd-ctrl.on{background:rgba(8,131,247,.22);border-color:rgba(8,131,247,.5)}.lbd-ctrl:disabled{opacity:.4;cursor:not-allowed}
.lbd-two{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px}
.lbd-ans{height:58px;border-radius:18px;border:0;cursor:pointer;color:#fff;font-weight:700;font-size:15px;display:flex;align-items:center;justify-content:center;gap:8px}
.lbd-ans.y{background:linear-gradient(135deg,#22c55e,#16a34a)}.lbd-ans.n{background:linear-gradient(135deg,#ef4444,#dc2626)}
.lbd-ta,.lbd-in,.lbd-sel{width:100%;border-radius:12px;border:1px solid var(--ln);background:rgba(5,12,24,.7);color:#fff;padding:10px 12px;font:inherit}
.lbd-ta{min-height:64px;resize:vertical}.lbd-lbl{display:block;font-size:11px;color:var(--mu);text-transform:uppercase;letter-spacing:.7px;margin:12px 0 5px}
.lbd-chips{display:flex;flex-wrap:wrap;gap:6px}
.lbd-chip{height:32px;padding:0 12px;border-radius:999px;border:1px solid var(--ln);background:rgba(255,255,255,.04);color:#dbe6fb;font-size:12.5px;font-weight:600;cursor:pointer}
.lbd-chip.on{background:var(--bl);border-color:var(--bl);color:#fff}
.lbd-btn{height:44px;padding:0 16px;border-radius:13px;border:0;background:var(--bl);color:#fff;font-weight:700;cursor:pointer}
.lbd-btn.ghost{background:transparent;border:1px solid var(--ln);color:#dbe6fb}.lbd-btn.or{background:var(--or)}.lbd-btn.sm{height:32px;padding:0 11px;font-size:12px;border-radius:10px}
.lbd-row{display:flex;align-items:center;gap:10px;padding:10px 4px;border-bottom:1px solid var(--ln)}
.lbd-row:last-child{border-bottom:0}
.lbd-row .d{width:32px;height:32px;border-radius:10px;display:grid;place-items:center;flex:none;background:rgba(255,255,255,.05);color:#9fc3ff}
.lbd-row .d.in{color:#86efac}.lbd-row .d.miss{color:#fca5a5;background:rgba(239,68,68,.12)}
.lbd-row .m{flex:1;min-width:0}.lbd-row .m b{display:block;font-size:13.5px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lbd-row .m span{font-size:11.5px;color:var(--mu);display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lbd-pill{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:999px;background:rgba(8,131,247,.16);color:#9fc3ff;white-space:nowrap}
.lbd-pill.warn{background:rgba(252,83,5,.16);color:#ffb38a}
.lbd-empty{text-align:center;color:var(--mu);padding:34px 10px;font-size:13px}
.lbd-note{margin:0 14px 10px;padding:9px 12px;border-radius:12px;font-size:12.5px;background:rgba(245,158,11,.12);color:#fde68a;display:flex;gap:8px;align-items:flex-start}
.lbd-note.bad{background:rgba(239,68,68,.13);color:#fecaca}
.lbd-toast{position:fixed;left:50%;bottom:calc(88px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:2147483001;background:#0b1830;border:1px solid var(--ln);color:#fff;padding:10px 16px;border-radius:12px;font:600 13px Inter,system-ui,sans-serif;box-shadow:0 12px 30px rgba(0,0,0,.5)}
.lbd-audio{position:fixed;width:0;height:0;opacity:0;pointer-events:none}
@media (max-width:560px){
 .lbd{right:88px;bottom:calc(84px + env(safe-area-inset-bottom))}
 .lbd.open{left:0;right:0;bottom:0}
 .lbd-panel{width:100%;max-height:92vh;border-radius:22px 22px 0 0;padding-bottom:env(safe-area-inset-bottom)}
 .lbd-fab .t{display:none}.lbd-fab{padding:0 9px;height:52px}
 .lbd-key{height:60px}
}
@media (prefers-reduced-motion:reduce){.lbd *,.lbd{animation:none!important;transition:none!important}}
`;

// ---------------------------------------------------------------- the dialer (singleton)
let inst = null;
export function mountDialer() { if (inst) return inst; inst = createDialer(); return inst; }
export default mountDialer;

function createDialer() {
  if (!document.getElementById('lbd-css')) { const s = document.createElement('style'); s.id = 'lbd-css'; s.textContent = CSS; document.head.appendChild(s); }
  const root = h('div', { class: 'lbd', role: 'region', 'aria-label': 'Phone' });
  const audio = h('audio', { class: 'lbd-audio', autoplay: true, id: 'lbd-remote' });
  const live = h('div', { 'aria-live': 'polite', style: 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)' });
  document.body.append(root, audio);

  const S = {
    boot: null, open: false, tab: 'keypad', conn: 'idle',            // idle | connecting | ready | offline | error | elsewhere
    connMsg: '', number: '', look: null, lookSeq: 0,
    call: null,                                                      // { sdk, row, dir, state, muted, held, pad, since, note, name, number, ctx }
    wrap: null,                                                      // after-call disposition { row, outcome, note, … }
    history: null, histQ: '', micId: localStorage.getItem('lbd_mic') || '', mics: [], showSettings: false, pushOn: null, sms: null, smsTo: null, smsThread: null, smsDraft: '', smsBusy: false,
  };
  let client = null, SDK = null, hbTimer = null, tickTimer = null, retry = 0, retryTimer = null, lockRelease = null;

  const toast = (msg) => { const t = h('div', { class: 'lbd-toast', role: 'status' }, msg); document.body.appendChild(t); setTimeout(() => t.remove(), 3600); };
  const say = (msg) => { live.textContent = ''; setTimeout(() => { live.textContent = msg; }, 30); };

  // ------------------------------------------------------------ data
  async function refresh() {
    try { const b = await dialerBootstrap(); if (b && !b.error) { S.boot = b; } } catch (_) {}
    try { const t = await dialerSmsThreads(); if (t && !t.error) S.sms = t; } catch (_) {}
    paint();
  }
  // never leave S.history null after a load (an empty result used to come back null → vRecent asked again on every paint →
  // an endless load/paint loop: the dock blinked and hammered the API), and never run two loads at once
  let histBusy = false;
  async function loadHistory() {
    if (histBusy) return; histBusy = true;
    try { const r = await dialerHistory(80, null, S.histQ || null); S.history = Array.isArray(r) ? r : (r && Array.isArray(r.calls) ? r.calls : []); }
    catch (_) { S.history = S.history || []; }
    finally { histBusy = false; }
    paint();
  }

  // ------------------------------------------------------------ Telnyx connection
  async function connect(force) {
    if (!S.boot || !S.boot.enabled || !S.boot.line) return;
    if (client && !force) return;
    // one live softphone per browser: a second tab must not register the same line and double-ring
    if (navigator.locks && !lockRelease) {
      const got = await new Promise((res) => {
        navigator.locks.request('lb-dialer', { ifAvailable: !force, steal: !!force }, (lock) => {
          if (!lock) { res(false); return undefined; }
          res(true); return new Promise((rel) => { lockRelease = rel; });
        }).catch(() => { lockRelease = null; if (client) { teardown(); S.conn = 'elsewhere'; paint(); } });
      });
      if (!got) { S.conn = 'elsewhere'; paint(); return; }
    }
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    S.conn = 'connecting'; S.connMsg = ''; paint();
    try {
      if (!SDK) SDK = await import('./vendor/telnyx-webrtc.js');
      const t = await dialerToken();
      if (!t || !t.token) throw new Error((t && t.error) || 'Could not get a phone token.');
      teardown(true);
      client = new SDK.TelnyxRTC({ login_token: t.token });
      const me = client;   // events from a client we already replaced (its socket closing during a reconnect) must not touch the new one — that looped 'Connecting…'
      client.remoteElement = 'lbd-remote';
      client.on('telnyx.ready', () => {
        if (client !== me) return;
        retry = 0; S.conn = 'ready'; S.connMsg = ''; heartbeat(); paint();
        // came here from an "Incoming call" push? a caller may still be ringing for us — take the call now (bl_dial_0351c)
        if (!S.call) dialerClaimWaiting().then((r) => { if (r && r.claimed) { S.open = true; paint(); } }).catch(() => {});
      });
      client.on('telnyx.error', (e) => { if (client !== me) return; S.connMsg = (e && e.error && e.error.message) || (e && e.message) || 'Phone service error'; if (S.conn !== 'ready') S.conn = 'error'; paint(); });
      client.on('telnyx.socket.close', () => { if (client !== me) return; S.conn = 'offline'; paint(); scheduleRetry(); });
      client.on('telnyx.socket.error', () => { if (client !== me) return; S.conn = 'offline'; paint(); scheduleRetry(); });
      client.on('telnyx.notification', (n) => { if (client === me) onNotification(n); });
      client.connect();
    } catch (e) { S.conn = 'error'; S.connMsg = String((e && e.message) || e); paint(); scheduleRetry(); }
  }
  function teardown(keepLock) {
    try { if (client) { client.off && client.off('telnyx.notification'); client.disconnect(); } } catch (_) {}
    client = null;
    if (!keepLock && lockRelease) { try { lockRelease(); } catch (_) {} lockRelease = null; }
  }
  function scheduleRetry() {
    if (retryTimer || (S.call && LIVE.includes(S.call.state))) return;
    const wait = Math.min(30000, 2000 * Math.pow(2, retry++));
    retryTimer = setTimeout(() => { retryTimer = null; if (navigator.onLine === false) { scheduleRetry(); return; } connect(true); }, wait);
  }
  function heartbeat() {
    if (hbTimer) clearInterval(hbTimer);
    const beat = () => { if (S.conn === 'ready' && document.visibilityState !== 'unloaded') dialerHeartbeat().catch(() => {}); };
    beat(); hbTimer = setInterval(beat, 60000);
  }
  window.addEventListener('online', () => { if (S.conn !== 'ready') connect(true); });

  // ------------------------------------------------------------ call events
  function ids(sdk) { try { const t = sdk.telnyxIDs || {}; return { call_control_id: t.telnyxCallControlId, session_id: t.telnyxSessionId, leg_id: t.telnyxLegId }; } catch (_) { return {}; } }
  function report(state, extra) {
    const c = S.call; if (!c || !c.row || !c.row.id) return;
    dialerCallUpdate(c.row.id, Object.assign({ state }, ids(c.sdk), extra || {})).catch(() => {});
  }
  async function onNotification(n) {
    if (!n || n.type !== 'callUpdate' || !n.call) { if (n && n.type === 'userMediaError') { S.connMsg = 'Microphone blocked — allow it in the browser address bar, then try again.'; endLocal('failed'); } return; }
    const sdk = n.call; const st = sdk.state;
    // ---- a new inbound call
    if (!S.call && sdk.direction === 'inbound' && st === 'ringing') {
      const num = (sdk.options && (sdk.options.remoteCallerNumber || sdk.options.callerNumber)) || '';
      S.call = { sdk, dir: 'in', state: 'ringing', number: num, name: '', row: null, since: null, note: '', muted: false, held: false, pad: false };
      S.open = true; ringStart(); notifyIncoming(num); paint(); say('Incoming call');
      try { const b = await dialerBootstrap(); if (b && !b.error) { S.boot = b; const row = (b.calls || []).find((x) => x.direction === 'inbound' && ['ringing', 'active'].includes(x.status)); if (row && S.call && S.call.sdk === sdk) { S.call.row = row; S.call.name = row.contact_name || ''; if (!S.call.number) S.call.number = row.number; } } } catch (_) {}
      if (S.call && !S.call.name && S.call.number) { try { const l = await dialerLookup(S.call.number); if (S.call && l && l.match) S.call.name = l.match.contact_name || ''; } catch (_) {} }
      paint(); return;
    }
    if (S.call && !S.call.sdk && S.call.dir === 'out' && sdk.direction !== 'inbound') S.call.sdk = sdk;   // events can fire before newCall() returns
    if (!S.call || S.call.sdk !== sdk) { if (S.call && sdk.direction === 'inbound' && st === 'ringing') { try { sdk.hangup(); } catch (_) {} } return; }   // busy: second call is declined → voicemail
    const c = S.call; c.state = st;
    if (st === 'early' || (st === 'ringing' && c.dir === 'out')) report('ringing');
    // make sure the far side is actually audible: bind the remote stream ourselves and start playback (the SDK's own
    // remoteElement hook can miss it, and a paused <audio> stays silent) — one-way audio seen in the first live test
    if (st === 'early' || st === 'active') { try { const rs = sdk.remoteStream; if (rs && audio.srcObject !== rs) audio.srcObject = rs; audio.muted = false; audio.volume = 1; const p = audio.play(); if (p && p.catch) p.catch(() => {}); } catch (_) {} }
    if (st === 'active') { ringStop(); if (!c.since) { c.since = Date.now(); report('active'); say('Call connected'); startTick(); wakeOn(); } c.held = false; }
    if (st === 'held') c.held = true;
    if (st === 'hangup' || st === 'destroy' || st === 'purge') { finish(sdk); return; }
    paint();
  }
  function finish(sdk) {
    const c = S.call; if (!c) return;
    ringStop(); stopTick(); wakeOff();
    report('hangup', { cause: sdk && sdk.cause, sip_code: sdk && sdk.sipCode, by_me: !!c.byMe });
    const answered = !!c.since; const dur = answered ? Math.round((Date.now() - c.since) / 1000) : 0;
    S.call = null; clearTitle();
    if (c.row && c.row.id && (answered || c.dir === 'out')) {
      S.wrap = { id: c.row.id, number: c.number, name: c.name, dur, answered, dir: c.dir, outcome: answered ? '' : (c.dir === 'out' ? 'no answer' : ''), note: c.note || '', known: !!(c.row.broker_contact_id || (c.ctx && c.ctx.broker_contact_id) || (c.match && ['carrier', 'driver'].includes(c.match.kind))), broker: '', rep: '', save: false, cb: '' };
      S.open = true;
    }
    say('Call ended'); refresh(); if (S.conn !== 'ready') scheduleRetry();
  }
  function endLocal() { ringStop(); stopTick(); wakeOff(); if (S.call) { report('hangup', { cause: 'client_error' }); S.call = null; } paint(); }
  // keep a phone's screen awake while a call is up — a sleeping screen suspends the tab and drops the audio
  let wake = null;
  async function wakeOn() { try { if ('wakeLock' in navigator && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (_) { wake = null; } }
  function wakeOff() { try { if (wake) wake.release(); } catch (_) {} wake = null; }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (S.call && S.call.since) wakeOn();                                  // the lock is dropped whenever the tab is hidden
    if (!S.call) { refresh(); if (S.boot && S.boot.enabled && S.boot.line && S.conn !== 'ready' && S.conn !== 'connecting' && S.conn !== 'elsewhere') { retry = 0; connect(true); } }
  });
  function startTick() { stopTick(); tickTimer = setInterval(() => { const n = root.querySelector('[data-tick]'); if (n && S.call && S.call.since) n.textContent = mmss((Date.now() - S.call.since) / 1000); }, 1000); }
  function stopTick() { if (tickTimer) { clearInterval(tickTimer); tickTimer = null; } }

  // ------------------------------------------------------------ actions
  async function dial(number, ctx) {
    ctx = ctx || {};
    if (S.call) { toast('Finish the current call first.'); S.open = true; paint(); return; }
    if (!S.boot || !S.boot.enabled) { toast('The phone is not available on your account yet.'); return; }
    if (S.conn !== 'ready') { S.open = true; paint(); toast(S.conn === 'elsewhere' ? 'The phone is active in another tab.' : 'Phone is still connecting — try again in a moment.'); if (S.conn !== 'connecting' && S.conn !== 'elsewhere') connect(true); return; }
    audioCtx();
    S.open = true; S.wrap = null;
    S.call = { sdk: null, dir: 'out', state: 'new', number, name: ctx.contact_name || '', row: null, since: null, note: '', muted: false, held: false, pad: false, ctx };
    paint();
    let r;
    try { r = await dialerCallStart(Object.assign({ to: number, source: ctx.source || 'keypad' }, ctx)); } catch (e) { r = { error: String((e && e.message) || e) }; }
    if (!r || r.error) { S.call = null; S.connMsg = ''; paint(); toast((r && r.error) || 'Could not start the call.'); return; }
    if (!S.call) return;
    S.call.row = { id: r.id, broker_contact_id: r.match && r.match.broker_contact_id }; S.call.number = r.to; S.call.name = r.contact_name || S.call.name; S.call.match = r.match || {};
    try {
      const o = { destinationNumber: r.to, callerNumber: r.from, callerName: 'LoadBoot', clientState: r.client_state, audio: true, video: false, remoteElement: 'lbd-remote' };
      if (S.micId) o.micId = S.micId;
      S.call.sdk = client.newCall(o);
      S.number = ''; S.look = null;
    } catch (e) { report('hangup', { cause: 'newCall_failed' }); S.call = null; toast('Could not place the call: ' + ((e && e.message) || e)); }
    paint();
  }
  function answer() { const c = S.call; if (!c || !c.sdk) return; ringStop(); audioCtx(); try { const o = { remoteElement: 'lbd-remote' }; if (S.micId) o.micId = S.micId; c.sdk.answer(o); } catch (e) { toast('Could not answer: ' + ((e && e.message) || e)); } }
  function hangup() { const c = S.call; if (!c) return; c.byMe = true; ringStop(); try { c.sdk && c.sdk.hangup(); } catch (_) {} if (!c.sdk) { S.call = null; paint(); } }
  // Speaker / audio output. Browsers only allow this where HTMLMediaElement.setSinkId exists (Chrome desktop + recent Chrome Android;
  // NOT iOS Safari). Phone with a speakerphone + earpiece pair → a true toggle; otherwise step through the outputs (headset, speakers…).
  async function toggleSpeaker() {
    if (typeof audio.setSinkId !== 'function') { toast('This browser does not let a web page switch the speaker. Use the phone\u2019s volume keys, or a headset.'); return; }
    let outs = [];
    try { outs = (await navigator.mediaDevices.enumerateDevices()).filter((x) => x.kind === 'audiooutput' && x.deviceId); } catch (_) {}
    if (outs.length < 2) { toast('Only one audio output is available on this device.'); return; }
    const loud = outs.find((x) => /speaker/i.test(x.label) && !/earpiece|handset/i.test(x.label));
    const ear = outs.find((x) => /earpiece|handset/i.test(x.label));
    const cur = audio.sinkId || 'default';
    let next;
    if (loud && ear) next = (S.spkOn ? ear : loud);
    else { const real = outs.filter((x) => x.deviceId !== 'default' && x.deviceId !== 'communications'); const list = real.length > 1 ? real : outs; const i = list.findIndex((x) => x.deviceId === cur); next = list[(i + 1) % list.length]; }
    try { await audio.setSinkId(next.deviceId); S.spkOn = loud ? next === loud : !S.spkOn; toast('Sound: ' + (next.label || 'next output')); }
    catch (e) { toast('Could not switch the speaker: ' + ((e && e.message) || e)); }
    paint();
  }
  function toggleMute() { const c = S.call; if (!c || !c.sdk) return; try { c.muted ? c.sdk.unmuteAudio() : c.sdk.muteAudio(); c.muted = !c.muted; } catch (_) {} paint(); }
  function toggleHold() { const c = S.call; if (!c || !c.sdk) return; try { c.held ? c.sdk.unhold() : c.sdk.hold(); c.held = !c.held; } catch (_) {} paint(); }
  function press(k) {
    tone(DTMF[k] || [941, 1336], 110);
    if (S.call && S.call.sdk && S.call.state === 'active') { try { S.call.sdk.dtmf(String(k)); } catch (_) {} return; }
    setNumber(S.number + k);
  }
  function setNumber(v) {
    S.number = String(v).replace(/[^0-9+*#]/g, '').slice(0, 18);
    const inp = root.querySelector('.lbd-num'); if (inp && inp.value !== prettyTyping(S.number)) inp.value = prettyTyping(S.number);
    const seq = ++S.lookSeq; const d = digits(S.number);
    if (d.length < 10) { S.look = null; paintMatch(); paintCallBtn(); return; }
    paintCallBtn();
    dialerLookup(S.number).then((l) => { if (seq === S.lookSeq) { S.look = l; paintMatch(); paintCallBtn(); } }).catch(() => {});
  }
  async function saveWrap(skip) {
    const w = S.wrap; if (!w) return;
    S.wrap = null; paint();
    if (skip && !w.note && !w.outcome) return;
    const p = { outcome: w.outcome || null, note: w.note || '' };
    if (w.save && w.broker.trim()) { p.save_broker = true; p.broker = w.broker.trim(); p.rep = w.rep.trim(); }
    if (w.cb) p.callback_at = new Date(Date.now() + Number(w.cb) * 60000).toISOString();
    try { const r = await dialerCallTag(w.id, p); if (r && r.error) toast(r.error); else toast('Call saved'); } catch (_) { toast('Could not save the call note.'); }
    refresh();
  }

  // ------------------------------------------------------------ attention (incoming call while the tab is hidden)
  let titleTimer = null; const baseTitle = document.title;
  function notifyIncoming(num) {
    clearTitle(); let f = false; titleTimer = setInterval(() => { document.title = (f = !f) ? '📞 Incoming call…' : baseTitle; }, 900);
    try { if ('Notification' in window && Notification.permission === 'granted' && document.hidden) { const n = new Notification('Incoming call — LoadBoot', { body: pretty(num) || 'Unknown caller', tag: 'lbd-call', requireInteraction: true }); n.onclick = () => { window.focus(); n.close(); }; } } catch (_) {}
  }
  function clearTitle() { if (titleTimer) { clearInterval(titleTimer); titleTimer = null; document.title = baseTitle; } }
  window.addEventListener('beforeunload', (e) => { if (S.call && LIVE.includes(S.call.state)) { e.preventDefault(); e.returnValue = ''; } });
  window.addEventListener('pagehide', () => { teardown(); });

  // ------------------------------------------------------------ click-to-call: every tel: link in the portal
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target && e.target.closest && e.target.closest('a[href^="tel:"]');
    if (!a || root.contains(a) || !S.boot || !S.boot.enabled || !S.boot.line) return;
    e.preventDefault();
    const ds = a.dataset || {};
    dial(decodeURIComponent(a.getAttribute('href').slice(4)), { source: 'click', contact_name: ds.name || '', broker_contact_id: ds.broker || '', booking_id: ds.booking || '', load_id: ds.load || '' });
  }, true);
  document.addEventListener('keydown', (e) => {
    if (!S.open || S.wrap || e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target; const typing = t && (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && !t.classList.contains('lbd-num')));
    if (typing || !root.contains(document.activeElement)) return;
    if (S.call && S.call.state === 'active' && /^[0-9*#]$/.test(e.key)) { press(e.key); e.preventDefault(); }
    else if (e.key === 'Escape' && !S.call) { S.open = false; paint(); }
  });

  // ------------------------------------------------------------ views
  const initial = (name, num) => { const s = String(name || '').trim(); return s ? s[0].toUpperCase() : (digits(num).slice(-2) || '#'); };
  function connLine() {
    const m = { ready: ['ok', 'Ready'], connecting: ['warn', 'Connecting…'], offline: ['bad', 'Reconnecting…'], error: ['bad', 'Not connected'], elsewhere: ['warn', 'Active in another tab'], idle: ['', 'Idle'] }[S.conn] || ['', ''];
    return [h('i', { class: 'lbd-dot ' + m[0] }), m[1]];
  }
  function paintMatch() {
    const box = root.querySelector('[data-match]'); if (!box) return;
    const l = S.look;
    if (!l) { box.className = 'lbd-match'; mount(box, digits(S.number).length ? 'Keep typing — 10 digits for a US number.' : 'Type or paste any number from DAT, 123Loadboard, an email…'); return; }
    if (l.blocked) { box.className = 'lbd-match bad'; mount(box, l.blocked); return; }
    box.className = 'lbd-match';
    const m = l.match || {};
    if (m.contact_name) mount(box, [ic('check', 15), h('span', null, [h('b', null, m.contact_name), m.mc ? ' · MC ' + m.mc : '', l.count ? ' · ' + l.count + ' call' + (l.count > 1 ? 's' : '') : '', l.last && l.last.outcome ? ' · last: ' + l.last.outcome : '', m.new_authority_ok === false ? ' · no new MCs' : ''])]);
    else mount(box, l.count ? ['Called ' + l.count + '× before', l.last && l.last.outcome ? ' · last: ' + l.last.outcome : ''] : 'New number — you can save it to your broker book after the call.');
  }
  function paintCallBtn() { const b = root.querySelector('[data-callbtn]'); if (b) b.disabled = digits(S.number).length < 10 || !!(S.look && S.look.blocked) || S.conn !== 'ready'; }

  function vKeypad() {
    const inp = h('input', { class: 'lbd-num', type: 'tel', inputmode: 'tel', autocomplete: 'off', placeholder: 'Enter or paste a number', 'aria-label': 'Phone number', value: prettyTyping(S.number),
      onInput: (e) => setNumber(e.target.value), onKeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); if (digits(S.number).length >= 10) dial(S.number, { source: 'keypad' }); } },
      onPaste: (e) => { const t = (e.clipboardData || window.clipboardData).getData('text'); if (t) { e.preventDefault(); setNumber(t); } } });
    const keys = [['1', ''], ['2', 'ABC'], ['3', 'DEF'], ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'], ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ'], ['*', ''], ['0', '+'], ['#', '']];
    const node = h('div', null, [
      h('div', { class: 'lbd-numwrap' }, [inp, S.number ? h('button', { class: 'lbd-ib', 'aria-label': 'Delete last digit', onClick: () => { setNumber(S.number.slice(0, -1)); } }, ic('back', 20)) : null]),
      h('div', { class: 'lbd-match', 'data-match': '' }),
      h('div', { class: 'lbd-keys' }, keys.map(([k, s]) => h('button', { class: 'lbd-key', 'aria-label': k, onClick: () => press(k) }, [h('b', null, k), h('span', null, s)]))),
      h('button', { class: 'lbd-call', 'data-callbtn': '', onClick: () => dial(S.number, { source: 'keypad' }) }, [ic('phone', 20), 'Call']),
    ]);
    setTimeout(() => { paintMatch(); paintCallBtn(); }, 0);
    return node;
  }
  function vCall() {
    const c = S.call; const ringingIn = c.dir === 'in' && c.state === 'ringing';
    const label = ringingIn ? 'Incoming call' : c.state === 'active' ? null : c.state === 'held' ? 'On hold' : (c.state === 'early' || c.state === 'ringing') ? 'Ringing…' : 'Calling…';
    const m = c.match || {};
    return h('div', null, [
      h('div', { class: 'lbd-stage' + (ringingIn ? ' ring' : '') }, [
        h('div', { class: 'lbd-ava' }, initial(c.name, c.number)),
        h('h3', null, c.name || pretty(c.number) || 'Unknown caller'),
        c.name ? h('div', { class: 'n' }, pretty(c.number)) : null,
        h('div', { class: 's' }, label || h('span', { 'data-tick': '' }, mmss(c.since ? (Date.now() - c.since) / 1000 : 0))),
        (c.since && S.boot && S.boot.record_calls) ? h('div', { class: 'lbd-rec' }, [h('i'), 'REC']) : null,
        (m.lane || m.last_outcome || m.mc) ? h('div', { class: 'lbd-ctx' }, [m.mc ? ['MC ', h('b', null, m.mc), ' '] : null, m.lane ? ['· last load ', h('b', null, m.lane), ' '] : null, m.last_outcome ? ['· last outcome ', h('b', null, m.last_outcome)] : null]) : null,
      ]),
      ringingIn
        ? h('div', { class: 'lbd-two' }, [h('button', { class: 'lbd-ans n', onClick: hangup }, [ic('hang', 20), 'Decline']), h('button', { class: 'lbd-ans y', onClick: answer }, [ic('phone', 20), 'Answer'])])
        : h('div', null, [
          h('div', { class: 'lbd-ctrls' }, [
            h('button', { class: 'lbd-ctrl' + (c.muted ? ' on' : ''), disabled: !c.since, 'aria-pressed': String(!!c.muted), onClick: toggleMute }, [ic(c.muted ? 'micoff' : 'mic', 20), c.muted ? 'Unmute' : 'Mute']),
            h('button', { class: 'lbd-ctrl' + (c.pad ? ' on' : ''), disabled: !c.since, 'aria-pressed': String(!!c.pad), onClick: () => { c.pad = !c.pad; paint(); } }, [ic('pad', 20), 'Keypad']),
            h('button', { class: 'lbd-ctrl' + (c.held ? ' on' : ''), disabled: !c.since, 'aria-pressed': String(!!c.held), onClick: toggleHold }, [ic(c.held ? 'play' : 'pause', 20), c.held ? 'Resume' : 'Hold']),
            h('button', { class: 'lbd-ctrl' + (S.spkOn ? ' on' : ''), 'aria-pressed': String(!!S.spkOn), onClick: toggleSpeaker }, [ic('spk', 20), 'Speaker']),
          ]),
          c.pad ? h('div', { class: 'lbd-keys' }, ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'].map((k) => h('button', { class: 'lbd-key', 'aria-label': 'Send ' + k, onClick: () => press(k) }, h('b', null, k))))
            : [h('label', { class: 'lbd-lbl', for: 'lbd-livenote' }, 'Call notes (saved with the call)'), h('textarea', { class: 'lbd-ta', id: 'lbd-livenote', placeholder: 'Rate, pickup, reference #, who you spoke to…', onInput: (e) => { c.note = e.target.value; } }, c.note || '')],
          h('button', { class: 'lbd-call end', onClick: hangup }, [ic('hang', 20), 'End call']),
        ]),
    ]);
  }
  function vWrap() {
    const w = S.wrap;
    const chips = h('div', { class: 'lbd-chips', role: 'group', 'aria-label': 'Outcome' }, OUTCOMES.map(([v, l]) => h('button', { class: 'lbd-chip' + (w.outcome === v ? ' on' : ''), 'aria-pressed': String(w.outcome === v), onClick: () => { w.outcome = w.outcome === v ? '' : v; paint(); } }, l)));
    const cbs = [['', 'No'], ['15', '15 min'], ['60', '1 hour'], ['180', '3 hours'], ['1440', 'Tomorrow']];
    return h('div', null, [
      h('div', { class: 'lbd-stage', style: 'padding-top:6px' }, [h('h3', null, w.name || pretty(w.number)), h('div', { class: 'n' }, [w.name ? pretty(w.number) + ' · ' : '', w.answered ? 'Talked ' + mmss(w.dur) : 'Not connected'])]),
      h('span', { class: 'lbd-lbl' }, 'How did it go?'), chips,
      h('label', { class: 'lbd-lbl', for: 'lbd-wnote' }, 'Notes'), h('textarea', { class: 'lbd-ta', id: 'lbd-wnote', placeholder: 'Rate quoted, load details, next step…', onInput: (e) => { w.note = e.target.value; } }, w.note || ''),
      h('span', { class: 'lbd-lbl' }, 'Remind me to call back'), h('div', { class: 'lbd-chips' }, cbs.map(([v, l]) => h('button', { class: 'lbd-chip' + (w.cb === v ? ' on' : ''), 'aria-pressed': String(w.cb === v), onClick: () => { w.cb = v; paint(); } }, l))),
      w.known ? null : h('div', null, [
        h('label', { class: 'lbd-lbl', style: 'display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:0;font-size:13px;color:#dbe6fb;cursor:pointer' }, [h('input', { type: 'checkbox', checked: w.save, onChange: (e) => { w.save = e.target.checked; paint(); } }), 'Save this number to my broker book']),
        w.save ? h('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:8px' }, [h('input', { class: 'lbd-in', placeholder: 'Broker company *', 'aria-label': 'Broker company', value: w.broker, onInput: (e) => { w.broker = e.target.value; } }), h('input', { class: 'lbd-in', placeholder: 'Rep name', 'aria-label': 'Rep name', value: w.rep, onInput: (e) => { w.rep = e.target.value; } })]) : null,
      ]),
      h('div', { style: 'display:flex;gap:10px;margin-top:16px' }, [h('button', { class: 'lbd-btn ghost', style: 'flex:1', onClick: () => saveWrap(true) }, 'Skip'), h('button', { class: 'lbd-btn', style: 'flex:2', onClick: () => saveWrap(false) }, 'Save call')]),
    ]);
  }
  const STAT = { missed: 'Missed', voicemail: 'Voicemail', forwarded: 'Went to Riley', busy: 'Busy', no_answer: 'No answer', canceled: 'Canceled', failed: 'Failed' };
  function callRow(c) {
    const missed = ['missed', 'voicemail', 'forwarded'].includes(c.status);
    const sub = [c.contact_name ? pretty(c.number) : null, ago(c.started_at), c.duration_sec ? mmss(c.duration_sec) : (STAT[c.status] || null), c.note ? '“' + c.note + '”' : null].filter(Boolean).join(' · ');
    return h('div', { class: 'lbd-row' }, [
      h('div', { class: 'd' + (missed ? ' miss' : c.direction === 'inbound' ? ' in' : ''), title: c.direction }, ic(missed ? 'miss' : c.direction === 'inbound' ? 'inc' : 'out', 16)),
      h('div', { class: 'm' }, [h('b', null, c.contact_name || pretty(c.number)), h('span', null, sub)]),
      c.outcome ? h('span', { class: 'lbd-pill' }, c.outcome) : (c.answered_at ? h('button', { class: 'lbd-btn ghost sm', onClick: () => { S.wrap = { id: c.id, number: c.number, name: c.contact_name, dur: c.duration_sec, answered: true, dir: c.direction, outcome: '', note: c.note || '', known: !!c.broker_contact_id || ['carrier', 'driver'].includes(c.contact_kind), broker: '', rep: '', save: false, cb: '' }; paint(); } }, 'Tag') : null),
      c.has_recording ? h('button', { class: 'lbd-ib' + (isPlaying(c.id) ? ' on' : ''), 'aria-label': isPlaying(c.id) ? 'Pause recording' : 'Play recording', onClick: (e) => playRecording(c.id, e.currentTarget) }, ic(isPlaying(c.id) ? 'pause' : 'play', 16)) : null,
      h('button', { class: 'lbd-ib', 'aria-label': 'Text ' + pretty(c.number), onClick: () => openThread(c.number, c.contact_name || '') }, ic('msg', 16)),
      h('button', { class: 'lbd-ib', 'aria-label': 'Call ' + pretty(c.number), onClick: () => dial(c.number, { source: 'history', contact_name: c.contact_name || '' }) }, ic('phone', 17)),
    ]);
  }
  function vRecent() {
    const rows = S.history || (S.boot && S.boot.calls) || [];
    if (S.history == null) loadHistory();
    return h('div', null, [
      h('input', { class: 'lbd-in', type: 'search', placeholder: 'Search name, number or note', 'aria-label': 'Search calls', value: S.histQ, onInput: (e) => { S.histQ = e.target.value; clearTimeout(vRecent.t); vRecent.t = setTimeout(async () => { await loadHistory(); const i = root.querySelector('input[type=search]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 350); } }),
      rows.length ? h('div', { style: 'margin-top:6px' }, rows.map(callRow)) : h('div', { class: 'lbd-empty' }, S.histQ ? 'No calls match that search.' : 'No calls yet. Your call log builds itself as you dial.'),
    ]);
  }
  // ------------------------------------------------------------ text messages (bl_dial_0352)
  const SMS_TPL = ['Hi, this is LoadBoot dispatch following up on our call.', 'Please send the rate confirmation when you can. Thank you!', 'Can you share the pickup number and address?', 'Driver is on the way — I will send an ETA shortly.', 'Delivered. Please confirm and send the signed POD. Thank you!'];
  let smsTimer = null;
  function closeThread() { if (smsTimer) { clearInterval(smsTimer); smsTimer = null; } S.smsTo = null; S.smsThread = null; }
  async function loadThread(quiet) {
    if (!S.smsTo) return;
    try {
      const t = await dialerSmsThread(S.smsTo);
      if (!t || t.error || !S.smsTo) return;
      const had = S.smsThread && S.smsThread.messages ? S.smsThread.messages.length : -1;
      const sig = (x) => (x && x.messages ? x.messages.map((m) => m.id + m.status).join() : '');
      const changed = sig(t) !== sig(S.smsThread);
      S.smsThread = t;
      if (!quiet) { paint(); return; }
      if (changed) { paintMsgs(t.messages.length !== had); dialerSmsThreads().then((r) => { if (r && !r.error) S.sms = r; }).catch(() => {}); }   // only the bubbles: the composer keeps its focus and caret
    } catch (_) {}
  }
  function openThread(number, name) {
    closeThread();
    S.tab = 'texts'; S.open = true; S.showSettings = false; S.smsTo = number; S.smsName = name || ''; S.smsThread = null; S.smsDraft = '';
    paint(); loadThread(false);
    smsTimer = setInterval(() => { if (S.open && S.tab === 'texts' && S.smsTo && document.visibilityState === 'visible') loadThread(true); }, 8000);
  }
  function bubble(m) {
    const st = m.direction === 'outbound' ? ({ queued: 'Sending…', sent: 'Sent', delivered: 'Delivered', failed: 'Not sent' + (m.error ? ' — ' + m.error : '') })[m.status] || '' : '';
    return h('div', { class: 'lbd-bub' + (m.direction === 'outbound' ? ' out' : '') + (m.status === 'failed' ? ' fail' : '') }, [m.body || (m.media ? '[picture]' : ''), h('small', null, [ago(m.at), st ? ' · ' + st : ''].join(''))]);
  }
  function paintMsgs(toEnd) {
    const box = root.querySelector('[data-smslist]'); if (!box) return;
    const ms = (S.smsThread && S.smsThread.messages) || [];
    const near = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    mount(box, ms.length ? ms.map(bubble) : h('div', { class: 'lbd-empty' }, S.smsThread ? 'No messages yet. Say hello.' : 'Loading…'));
    if (toEnd || near) box.scrollTop = box.scrollHeight;
  }
  async function sendText() {
    const body = (S.smsDraft || '').trim(); if (!body || S.smsBusy || !S.smsTo) return;
    S.smsBusy = true; paint();
    try {
      const r = await dialerSmsSend(S.smsTo, body);
      if (r && r.ok) { S.smsDraft = ''; } else toast((r && r.error) || 'Could not send that text.');
    } catch (e) { toast((e && e.message) || 'Could not send that text.'); }
    S.smsBusy = false; await loadThread(false);
    const ta = root.querySelector('#lbd-sms'); if (ta) ta.focus();
  }
  function vTexts() {
    const sm = S.sms || { enabled: false, threads: [] };
    const off = !sm.enabled ? h('div', { class: 'lbd-note', style: 'margin:0 0 10px' }, 'Text messaging switches on once LoadBoot’s carrier registration (10DLC) is approved. Texts people send you still arrive here.') : null;
    if (S.smsTo) {
      const t = S.smsThread; const name = (t && t.match && t.match.contact_name) || S.smsName || '';
      const out = t && t.opted_out;
      const view = h('div', null, [
        h('div', { class: 'lbd-th' }, [
          h('button', { class: 'lbd-ib', 'aria-label': 'Back to all texts', onClick: () => { closeThread(); refresh(); } }, ic('back', 18)),
          h('div', { class: 'who' }, [h('b', null, name || pretty(S.smsTo)), h('span', null, name ? pretty(S.smsTo) : 'Text message')]),
          h('button', { class: 'lbd-ib', 'aria-label': 'Call ' + pretty(S.smsTo), onClick: () => dial(S.smsTo, { source: 'texts', contact_name: name }) }, ic('phone', 17)),
        ]),
        off,
        h('div', { class: 'lbd-msgs', 'data-smslist': '1', role: 'log', 'aria-live': 'polite' }),
        out ? h('div', { class: 'lbd-note', style: 'margin:6px 0 0' }, 'This number replied STOP. It cannot be texted until it sends START.') : [
          h('div', { class: 'lbd-tpl' }, SMS_TPL.map((x) => h('button', { type: 'button', onClick: () => { S.smsDraft = (S.smsDraft ? S.smsDraft.replace(/\s*$/, ' ') : '') + x; const ta = root.querySelector('#lbd-sms'); if (ta) { ta.value = S.smsDraft; ta.focus(); } paintSend(); } }, x.length > 34 ? x.slice(0, 32) + '…' : x))),
          h('div', { class: 'lbd-comp' }, [
            h('textarea', { class: 'lbd-in', id: 'lbd-sms', rows: '2', maxlength: '1000', placeholder: 'Write a text…', 'aria-label': 'Message', onInput: (e) => { S.smsDraft = e.target.value; paintSend(); }, onKeydown: (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); } } }, S.smsDraft),
            h('button', { class: 'lbd-send', 'data-smssend': '1', 'aria-label': 'Send text', disabled: S.smsBusy || !(S.smsDraft || '').trim() || !sm.enabled, onClick: sendText }, ic('send', 17)),
          ]),
        ],
      ]);
      setTimeout(() => paintMsgs(true), 0);
      return view;
    }
    const rows = sm.threads || [];
    const start = h('div', { class: 'lbd-comp', style: 'margin:0 0 8px' }, [
      h('input', { class: 'lbd-in', id: 'lbd-smsnew', type: 'tel', inputmode: 'tel', placeholder: 'Text a new number…', 'aria-label': 'Number to text', onKeydown: (e) => { if (e.key === 'Enter') { const v = digits(e.target.value); if (v.length >= 10) openThread(e.target.value, ''); } } }),
      h('button', { class: 'lbd-send', 'aria-label': 'Start text', onClick: () => { const el2 = root.querySelector('#lbd-smsnew'); const v = el2 ? el2.value : ''; if (digits(v).length >= 10) openThread(v, ''); else toast('Enter a 10-digit US number.'); } }, ic('msg', 17)),
    ]);
    return h('div', null, [off, start,
      rows.length ? h('div', null, rows.map((r) => h('div', { class: 'lbd-row', style: 'cursor:pointer', role: 'button', tabindex: '0', onClick: () => openThread(r.number, r.contact_name || ''), onKeydown: (e) => { if (e.key === 'Enter') openThread(r.number, r.contact_name || ''); } }, [
        h('div', { class: 'd' + (r.direction === 'inbound' ? ' in' : '') }, ic('msg', 16)),
        h('div', { class: 'm' }, [h('b', null, r.contact_name || pretty(r.number)), h('span', null, (r.direction === 'outbound' ? 'You: ' : '') + (r.body || '[picture]'))]),
        h('span', { style: 'font-size:11px;color:var(--mu);flex:none' }, ago(r.at)),
        r.unread ? h('span', { class: 'lbd-badge' }, String(r.unread)) : null,
      ]))) : h('div', { class: 'lbd-empty' }, 'No texts yet. Brokers, carriers and drivers you text show up here, one thread each.'),
    ]);
  }
  function paintSend() { const b = root.querySelector('[data-smssend]'); if (b) b.disabled = S.smsBusy || !(S.smsDraft || '').trim() || !(S.sms && S.sms.enabled); }

  function vCallbacks() {
    const rows = (S.boot && S.boot.callbacks) || [];
    if (!rows.length) return h('div', { class: 'lbd-empty' }, 'Nothing waiting. Missed calls, voicemails and the reminders you set land here.');
    return h('div', null, rows.map((b) => {
      const due = new Date(b.due_at).getTime() <= Date.now();
      return h('div', { class: 'lbd-row' }, [
        h('div', { class: 'd ' + (b.reason === 'scheduled' ? '' : 'miss') }, ic(b.reason === 'voicemail' ? 'vm' : b.reason === 'scheduled' ? 'clock' : 'miss', 16)),
        h('div', { class: 'm' }, [h('b', null, b.contact_name || pretty(b.number)), h('span', null, [b.reason === 'scheduled' ? (due ? 'Due now' : 'Due ' + whenET(b.due_at)) : ({ missed: 'Missed call', voicemail: 'Left a voicemail', forwarded: 'Riley took the call' }[b.reason]) + ' · ' + ago(b.due_at), b.note ? ' · ' + b.note : ''])]),
        (b.reason === 'voicemail' && b.call_id) ? h('button', { class: 'lbd-ib' + (isPlaying(b.call_id) ? ' on' : ''), 'aria-label': isPlaying(b.call_id) ? 'Pause voicemail' : 'Play voicemail', onClick: (e) => playRecording(b.call_id, e.currentTarget) }, ic(isPlaying(b.call_id) ? 'pause' : 'play', 16)) : null,
        h('button', { class: 'lbd-ib', 'aria-label': 'Mark done', onClick: async () => { await dialerCallbackSet(b.id, 'done').catch(() => {}); refresh(); } }, ic('check', 17)),
        h('button', { class: 'lbd-btn or sm', onClick: async () => { dialerCallbackSet(b.id, 'done').catch(() => {}); dial(b.number, { source: 'callback', contact_name: b.contact_name || '' }); } }, 'Call back'),
      ]);
    }));
  }
  let playing = null;
  const isPlaying = (id) => !!(playing && playing.id === id && !playing.a.paused);
  function stopPlaying() { if (!playing) return; try { playing.a.pause(); URL.revokeObjectURL(playing.u); } catch (_) {} playing = null; }
  // one recording at a time: the same row toggles pause / resume, another row stops the first and starts its own
  async function playRecording(callId, btn) {
    if (playing && playing.id === callId) {
      try { if (playing.a.paused) await playing.a.play(); else playing.a.pause(); } catch (_) {}
      paint(); return;
    }
    stopPlaying();
    try {
      if (btn) btn.disabled = true;
      const blob = await dialerRecordingBlob(callId);
      stopPlaying();                                   // another row may have been tapped while this one was loading
      const u = URL.createObjectURL(blob); const a = new Audio(u); playing = { a, u, id: callId };
      a.onended = () => { try { URL.revokeObjectURL(u); } catch (_) {} if (playing && playing.a === a) playing = null; paint(); };
      await a.play();
    } catch (e) { toast('Recording is not ready yet — try again in a minute.'); } finally { if (btn) btn.disabled = false; paint(); }
  }
  async function loadMics() { try { const d = await navigator.mediaDevices.enumerateDevices(); S.mics = d.filter((x) => x.kind === 'audioinput'); } catch (_) { S.mics = []; } }
  function vSettings() {
    return h('div', null, [
      h('button', { class: 'lbd-btn ghost', style: 'width:100%;margin-bottom:12px', onClick: () => { S.showSettings = false; paint(); } }, '\u2190 Back to dialer'),
      h('label', { class: 'lbd-lbl', for: 'lbd-mic' }, 'Microphone'),
      h('select', { class: 'lbd-sel', id: 'lbd-mic', onChange: (e) => { S.micId = e.target.value; try { localStorage.setItem('lbd_mic', S.micId); } catch (_) {} } }, [h('option', { value: '' }, 'System default')].concat(S.mics.map((m, i) => h('option', { value: m.deviceId, selected: m.deviceId === S.micId }, m.label || 'Microphone ' + (i + 1))))),
      h('div', { class: 'lbd-match', style: 'margin-top:12px' }, 'Use a headset. Laptop speakers echo and brokers hear it.'),
      pushSupported() ? (S.pushOn
        ? h('div', { class: 'lbd-match', style: 'margin-top:6px' }, [ic('check', 15), 'Call alerts are ON for this device — you get a notification for incoming and missed calls even when LoadBoot is closed.'])
        : h('button', { class: 'lbd-btn or', style: 'width:100%;margin-top:6px', onClick: async (e) => { const b = e.currentTarget; b.disabled = true; try { await enablePush('Dispatcher phone'); S.pushOn = true; toast('Call alerts are on for this device.'); } catch (err) { toast((err && err.message) || 'Could not turn on alerts.'); } paint(); } }, 'Turn on call alerts on this device'))
        : h('div', { class: 'lbd-match', style: 'margin-top:6px' }, 'This browser cannot show call alerts. On iPhone: Share → Add to Home Screen, then open LoadBoot from the icon.'),
      // bl_dial_0351e — the dispatcher's own "ring my mobile" number (US / Canada only; empty = off, the chain skips it at once)
      h('label', { class: 'lbd-lbl', for: 'lbd-fwd', style: 'margin-top:14px;display:block' }, 'Ring my mobile when I do not answer here'),
      h('div', { style: 'display:flex;gap:8px' }, [
        h('input', { class: 'lbd-sel', id: 'lbd-fwd', type: 'tel', inputmode: 'tel', autocomplete: 'tel', placeholder: 'US mobile, e.g. (214) 555-0123', value: (S.boot && S.boot.line && S.boot.line.forward_number) || '', style: 'flex:1;min-width:0' }),
        h('button', { class: 'lbd-btn', onClick: async (e) => { const b = e.currentTarget; const v = (root.querySelector('#lbd-fwd') || {}).value || ''; b.disabled = true;
          try { const r = await dialerForwardSet(v); if (r && r.ok) { if (S.boot && S.boot.line) S.boot.line.forward_number = r.forward_number; toast(r.forward_number ? 'Unanswered calls will ring ' + r.forward_number + '.' : 'Mobile forwarding is off.'); paint(); } else toast((r && r.error) || 'Could not save that number.'); }
          catch (err) { toast((err && err.message) || 'Could not save that number.'); } finally { b.disabled = false; } } }, 'Save'),
      ]),
      h('div', { class: 'lbd-match', style: 'margin-top:6px' }, 'US or Canada numbers only. Leave empty to turn it off — calls then go straight to the backup line / voicemail.'),
      h('button', { class: 'lbd-btn ghost', style: 'width:100%;margin-top:10px', onClick: () => { S.showSettings = false; connect(true); paint(); } }, 'Reconnect phone'),
      h('button', { class: 'lbd-btn', style: 'width:100%;margin-top:10px', onClick: () => { S.showSettings = false; paint(); } }, 'Done'),
    ]);
  }

  // ------------------------------------------------------------ paint
  let wasOpen = false;
  function paint() {
    const b = S.boot;
    if (!b || b.reason === 'off' || b.reason === 'not_active') { mount(root, null); root.className = 'lbd'; return; }
    root.className = 'lbd' + (S.open ? ' open' : '');
    const justOpened = S.open && !wasOpen; wasOpen = !!S.open;
    const cbN = (b.callbacks || []).length;
    const smsN = (S.sms && S.sms.unread) || 0;
    const c = S.call; const ringing = c && c.dir === 'in' && c.state === 'ringing';
    if (!S.open) {
      const cls = ringing ? ' ring' : c ? ' live' : (S.conn === 'ready' ? '' : ' off');
      mount(root, [live, h('button', { class: 'lbd-fab' + cls, 'aria-label': 'Open phone', onClick: () => { S.open = true; audioCtx(); paint(); } }, [
        h('span', { class: 'orb' }, ic('phone', 17)),
        h('span', { class: 't' }, [h('b', null, c ? (c.name || pretty(c.number)) : (b.line ? pretty(b.line.number) : 'Phone')), h('span', null, c ? (ringing ? 'Incoming call' : c.since ? 'On call' : 'Calling…') : (b.line ? connLine()[1] : 'No line yet'))]),
        (cbN + smsN) && !c ? h('span', { class: 'lbd-badge', 'aria-label': cbN + ' callbacks, ' + smsN + ' unread texts' }, String(cbN + smsN)) : null,
      ])]);
      return;
    }
    const t = b.today || {};
    const head = h('div', { class: 'lbd-hd' }, [
      h('div', { class: 'who' }, [h('b', null, b.line ? pretty(b.line.number) : 'LoadBoot Phone'), h('span', null, b.line ? connLine() : 'No line assigned')]),
      b.line ? h('button', { class: 'lbd-ib', 'aria-label': 'Copy my number', title: 'Copy my number', onClick: async () => { try { await navigator.clipboard.writeText(b.line.number); toast('Number copied — give this to brokers and load boards.'); } catch (_) {} } }, ic('copy', 17)) : null,
      h('button', { class: 'lbd-ib', 'aria-label': 'Phone settings', onClick: async () => { S.showSettings = !S.showSettings; paint(); if (S.showSettings) { loadMics().then(() => { if (S.showSettings) paint(); }); isPushEnabled().then((v) => { S.pushOn = !!v; }).catch(() => { S.pushOn = false; }).then(() => { if (S.showSettings) paint(); }); } } }, ic('cog', 17)),
      h('button', { class: 'lbd-ib', 'aria-label': 'Minimise phone', onClick: () => { S.open = false; paint(); } }, ic('min', 19)),
    ]);
    let note = null;
    if (!b.line) note = h('div', { class: 'lbd-note' }, 'Your dedicated LoadBoot number has not been assigned yet. LoadBoot staff assign it from the Command Center — you will be able to call as soon as it is set.');
    else if (S.conn === 'elsewhere') note = h('div', { class: 'lbd-note' }, ['The phone is active in another tab. ', h('button', { class: 'lbd-btn sm', style: 'margin-left:auto', onClick: () => connect(true) }, 'Use it here')]);
    else if (S.pushOn === false && pushSupported() && !sessionStorage.getItem('lbd_nopush')) note = h('div', { class: 'lbd-note' }, ['Turn on call alerts so a call reaches you when this tab is in the background. ', h('button', { class: 'lbd-btn sm', style: 'margin-left:auto;flex:none', onClick: async () => { try { await enablePush('Dispatcher phone'); S.pushOn = true; toast('Call alerts are on.'); } catch (err) { try { sessionStorage.setItem('lbd_nopush', '1'); } catch (_) {} toast((err && err.message) || 'Could not turn on alerts.'); } paint(); } }, 'Turn on')]);
    else if ((S.conn === 'error' || S.conn === 'offline') && S.connMsg) note = h('div', { class: 'lbd-note bad' }, S.connMsg);
    else if (S.connMsg && /icrophone/.test(S.connMsg)) note = h('div', { class: 'lbd-note bad' }, S.connMsg);
    const body = S.showSettings ? vSettings() : c ? vCall() : S.wrap ? vWrap() : !b.line ? h('div', { class: 'lbd-empty' }, 'No phone line yet.') : S.tab === 'recent' ? vRecent() : S.tab === 'texts' ? vTexts() : S.tab === 'callbacks' ? vCallbacks() : vKeypad();
    const showChrome = !c && !S.wrap && !S.showSettings && b.line;
    mount(root, [live, h('div', { class: 'lbd-panel' + (justOpened ? ' in' : ''), role: 'dialog', 'aria-label': 'LoadBoot phone' }, [
      head, note,
      showChrome ? h('div', { class: 'lbd-stats' }, [['calls', 'Calls'], ['connected', 'Connected'], ['talk_sec', 'Talk'], ['missed', 'Missed']].map(([k, l]) => h('div', null, [h('b', null, k === 'talk_sec' ? talk(t[k]) : String(t[k] || 0)), h('span', null, l)]))) : null,
      showChrome ? h('div', { class: 'lbd-tabs', role: 'tablist' }, [['keypad', 'Keypad', 'pad'], ['recent', 'Recent', 'clock'], ['texts', 'Texts', 'msg'], ['callbacks', 'Callbacks', 'miss']].map(([id, l, i]) => h('button', { class: 'lbd-tab' + (S.tab === id ? ' on' : ''), role: 'tab', 'aria-selected': String(S.tab === id), onClick: () => { S.tab = id; if (id === 'recent') S.history = null; if (id !== 'texts') closeThread(); paint(); } }, [ic(i, 14), l, id === 'callbacks' && cbN ? h('span', { class: 'lbd-badge' }, String(cbN)) : null, id === 'texts' && S.sms && S.sms.unread ? h('span', { class: 'lbd-badge' }, String(S.sms.unread)) : null]))) : null,
      h('div', { class: 'lbd-body' }, body),
    ])]);
    if (showChrome && S.tab === 'keypad' && window.matchMedia('(min-width:561px)').matches) { const i = root.querySelector('.lbd-num'); if (i && document.activeElement !== i && !root.contains(document.activeElement)) { try { i.focus({ preventScroll: true }); } catch (_) {} } }
  }

  // ------------------------------------------------------------ boot
  (async () => {
    await refresh();
    if (S.boot && S.boot.enabled && S.boot.line) { connect(false); isPushEnabled().then((v) => { S.pushOn = !!v; paint(); }).catch(() => {}); }
    setInterval(() => { if (!S.call && document.visibilityState === 'visible') refresh(); }, 45000);
    try { const sb = await getClient(); sb.auth.onAuthStateChange((ev) => { if (ev === 'SIGNED_OUT') { teardown(); S.boot = null; paint(); } }); } catch (_) {}
  })();

  const api = { call: (n, ctx) => dial(n, ctx), open: () => { S.open = true; paint(); }, refresh };
  window.LBDialer = api;
  return api;
}

// ---------------------------------------------------------------- hover tooltips (desktop / mouse only)
// One floating label for every control inside the dock. Delegated on document, so repaint-proof and additive:
// text = data-tip → TIPS[visible label] → aria-label → title. Keypad digits are skipped. Touch devices never see it.
const TIPS = {
  'Call': 'Call this number from your LoadBoot line',
  'Answer': 'Answer the incoming call',
  'Decline': 'Decline — the caller goes to your mobile, Riley or voicemail',
  'End call': 'Hang up',
  'Mute': 'Mute your microphone — the other side cannot hear you',
  'Unmute': 'Turn your microphone back on',
  'Hold': 'Put the caller on hold',
  'Speaker': 'Switch the sound: loudspeaker, earpiece or headset',
  'Resume': 'Take the caller off hold',
  'Keypad': 'Dial a number, or send digits during a call (menus, extensions)',
  'Recent': 'Your call history — redial, text, play recordings',
  'Texts': 'Text messages from your LoadBoot number',
  'Callbacks': 'Missed calls, voicemails and call-back reminders',
  'Call back': 'Call this number now and clear the reminder',
  'Skip': 'Close without saving an outcome',
  'Reconnect phone': 'Re-register this browser as your phone',
  'Done': 'Close settings',
  'Use it here': 'Move the phone from the other tab to this one',
  'Open phone': 'Open your phone',
  'Minimise phone': 'Minimise — calls still ring',
  'Phone settings': 'Microphone, call alerts, ring my mobile',
  'Copy my number': 'Copy your LoadBoot number — give it to brokers and load boards',
  'Mark done': 'Mark this callback as done',
  'Play recording': 'Play the call recording',
  'Pause recording': 'Pause the recording',
  'Play voicemail': 'Play the voicemail',
  'Pause voicemail': 'Pause the voicemail',
  'Delete last digit': 'Delete the last digit',
  'Send text': 'Send (Enter)',
  'Start text': 'Start a text to this number',
  'Back to all texts': 'Back to all conversations',
};
(function installTips() {
  if (typeof window === 'undefined' || window.__lbdTips || !window.matchMedia || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  window.__lbdTips = true;
  let tip = null, cur = null, timer = 0;
  const hide = () => { clearTimeout(timer); cur = null; if (tip) tip.style.opacity = '0'; };
  const textFor = (b) => {
    if (b.title) { b.setAttribute('data-tip', b.title); b.removeAttribute('title'); }   // never show the native tooltip as well
    const d = b.getAttribute('data-tip'); if (d) return d;
    const lbl = (b.textContent || '').trim(), a = b.getAttribute('aria-label') || '';
    return TIPS[lbl] || TIPS[a] || a || '';
  };
  const show = (b) => {
    const t = textFor(b); if (!t || !b.isConnected) return;
    if (!tip) {
      tip = document.createElement('div'); tip.setAttribute('role', 'tooltip');
      tip.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;max-width:240px;padding:6px 10px;border-radius:8px;background:#0A1628;color:#F3F6FA;font:500 12px/1.35 Inter,system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.10);opacity:0;transition:opacity .12s';
      document.body.appendChild(tip);
    }
    tip.textContent = t;
    const r = b.getBoundingClientRect(), w = tip.offsetWidth, hh = tip.offsetHeight;
    let top = r.top - hh - 8; if (top < 6) top = r.bottom + 8;
    const left = Math.min(Math.max(6, r.left + r.width / 2 - w / 2), window.innerWidth - w - 6);
    tip.style.top = top + 'px'; tip.style.left = left + 'px'; tip.style.opacity = '1';
  };
  document.addEventListener('mouseover', (e) => {
    const b = e.target && e.target.closest ? e.target.closest('.lbd button, .lbd [data-tip]') : null;
    if (b === cur) return;
    hide();
    if (!b || b.classList.contains('lbd-key')) return;
    cur = b; timer = setTimeout(() => { if (cur === b) show(b); }, 350);
  }, true);
  ['mousedown', 'keydown', 'wheel', 'blur'].forEach((ev) => window.addEventListener(ev, hide, true));
})();
