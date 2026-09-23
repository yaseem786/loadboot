// dispatcher-360.js — the Dispatcher 360 PAGE (bl_disp_0317, 17 Sep 2026).
//
// Yaseen: "jo drawer open hota hai dispatcher pe click karne pe … driver ki jagah agar 360 page open ho
// dispatcher ka, premium advance, proper function bhi kar sake." The drawer in dispatchers.js is retired;
// every dispatcher now opens at  #/dispatcher?id=<user_id>&tab=<overview|test|carriers|performance|loads|money|messages|timeline|documents>
// and every card carries the deep link it would open, so a notification, a board card or a queue row
// lands on the exact thing.
//
// Honesty rules baked in: every number is computed from RPC data (nothing hand-typed); readiness shows
// its own formula; a value we do not have renders as "—" with the reason, never a placeholder.
//
// ctx contract: renderDispatcher360(host, query)   — query: URLSearchParams (id, tab, booking)
import { el, mount } from '../../shared/ui/dom.js';
import { icon } from '../../shared/ui/icons.js';
import { money, fmtDate, fmtDateTime, askReason, askConfirm, openDrawer } from '../../shared/ui/components.js';
import { ccDispatcher360, ccDispatcherDecide, ccDispatcherAssign, ccDispatcherSop, ccDispatcherUnassign,
         getCarriersDirectory, ccCarrierPrefs, ccDispatcherSetTerms, ccDispatcherBookings, ccDispatcherBookingDecide,
         ccDispatcherCommissionStatus, ccDispatcherCommissionList, ccDispatcherCommissionPay, ccDispatcherResendIntro, ccDispatcherContactRelease,
         ccDispatcherTestInvite, ccDispatcherTestReview, dispatcherThreadList, dispatcherThreadSend, dispatcherThreadMarkRead,
         ccDispatcherKpis, ccDispatcherActivity } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { ccDispatcherSetRejectReasons } from '../../shared/api.js';
import { REASONS } from '../../agent/dispatcher-gaps.js';
import { signedDocumentUrl } from '../../shared/storage.js';
import { renderTestPanel } from './dispatcher-test.js';

const ET = 'America/New_York';
const et = (v) => { if (!v) return '—'; const d = new Date(v); return isNaN(d) ? String(v) : d.toLocaleString('en-US', { timeZone: ET, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET'; };
// A bare YYYY-MM-DD (trial_start/trial_end are Postgres `date`) carries NO time zone, and new Date()
// reads it as UTC midnight. West of UTC that is the PREVIOUS local day, which made dates render a day
// early AND made getDay() test the wrong weekday — the trial window counted 8 working days instead of 9.
// dAt() builds those as a local date; full timestamps still go through Date() untouched.
const dAt = (v) => { const m = typeof v === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(v); };
const dShort = (v) => { if (!v) return '—'; const d = dAt(v);
  return isNaN(d) ? String(v) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
const ago = (v) => { if (!v) return '—'; const s = Math.max(0, (Date.now() - new Date(v).getTime()) / 1000); if (s < 3600) return Math.max(1, Math.round(s / 60)) + ' min ago'; if (s < 86400) return Math.round(s / 3600) + ' h ago'; return Math.round(s / 86400) + ' d ago'; };
const daysBetween = (a, b) => Math.round((dAt(b) - dAt(a)) / 86400000);
const workingDays = (a, b) => { let n = 0; const x = dAt(a); const e = dAt(b); while (x <= e) { const d = x.getDay(); if (d !== 0 && d !== 6) n++; x.setDate(x.getDate() + 1); } return n; };
const initials = (n) => { const p = String(n || '').trim().split(/\s+/).filter(Boolean).slice(0, 2); return p.length ? p.map((w) => w[0]).join('').toUpperCase() : '?'; };
const hue = (k) => { let h = 0; const s = String(k || ''); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return ['#7c3aed', '#0e7490', '#b45309', '#0f766e', '#9333ea', '#1d4ed8'][h % 6]; };
const STL = { applied: ['Applied', 'violet'], screening: ['Screening', 'amber'], skills_test: ['Skills test', 'amber'], trial: ['Trial', 'blue'], verified: ['Verified', 'green'], active: ['Active', 'green'], suspended: ['Suspended', 'red'], rejected: ['Rejected', 'red'], withdrawn: ['Withdrawn', 'violet'] };
const pill = (txt, tone, ic) => el('span', { class: 'd3-pill ' + (tone || '') }, [ic ? icon(ic, 12) : '', txt]);
const stPill = (st) => { const m = STL[st] || [st || '—', '']; return pill(m[0], m[1]); };
// deep-link chip: the href is the full route, the label is the short form (#/dispatcher/…/money)
const lnk = (href, label) => el('a', { class: 'd3-lnk', href, title: href }, [icon('link', 12), label || href.replace(/^#\/dispatcher\?id=[^&]+&tab=/, '#/dispatcher/…/').replace(/^#/, '')]);
const kbd = (k) => el('kbd', null, k);
const btn = (label, onClick, tone, ic, extra) => el('button', Object.assign({ class: 'd3-btn ' + (tone || ''), type: 'button', onClick }, extra || {}), [ic ? icon(ic, 15) : '', label]);
const addWorkingDays = (d, n) => { const x = dAt(d); let c = 0;
  while (c < n) { x.setDate(x.getDate() + 1); if (x.getDay() !== 0 && x.getDay() !== 6) c++; }
  return [x.getFullYear(), String(x.getMonth() + 1).padStart(2, '0'), String(x.getDate()).padStart(2, '0')].join('-'); };

function style() {
  if (document.getElementById('d360-css')) return;
  const s = document.createElement('style'); s.id = 'd360-css';
  s.textContent = `
/* openDrawer() appends to document.body, OUTSIDE .d3 — without this the drawer's
   .d3-btn.p had an unresolved var(--b): transparent background + white text = invisible button. */
.d3,#cc-drawer-root{--n:var(--lb-navy,#10223B);--b:var(--lb-blue,#0883F7);--o:var(--lb-orange,#FC5305);--ink:#0b1626;--ink2:#334155;--mut:#6b7a90;--faint:#9aa8ba;--line:#e6eaf0;--line2:#eef1f5;--bg:#f6f8fb;--ok:#16a34a;--warn:#d97706;--bad:#dc2626;--vio:#7c3aed}
.d3{margin:-18px -22px 0;color:var(--ink);font-family:var(--lb-font,Inter,system-ui,sans-serif);font-size:13.5px;line-height:1.5}
.d3 h1,.d3 h2,.d3 h3{margin:0;font-family:var(--lb-head,var(--lb-font,inherit));font-weight:800;letter-spacing:-.02em}
.d3 a{color:inherit;text-decoration:none}
.d3 .cc-ico{display:inline-flex;vertical-align:-3px;flex:none}
.d3 kbd{font:600 10.5px ui-monospace,monospace;background:#fff;border:1px solid var(--line);border-radius:5px;padding:1px 6px;color:var(--mut)}
.d3-top{height:52px;background:#fff;border-bottom:1px solid var(--line);display:flex;align-items:center;gap:10px;padding:0 22px}
.d3-crumb{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;color:var(--mut);min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
.d3-crumb b{color:var(--ink)}.d3-crumb .cc-ico{color:var(--faint)}
.d3-url{margin-left:12px;display:flex;align-items:center;gap:7px;background:var(--bg);border:1px solid var(--line);border-radius:9px;padding:5px 10px;font:600 11.5px ui-monospace,monospace;color:var(--mut);cursor:pointer}
.d3-url em{font-style:normal;color:var(--b)}.d3-url .cc-ico{color:var(--faint)}
.d3-top .sp{margin-left:auto;display:flex;gap:8px;align-items:center}
.d3-hero{background:linear-gradient(120deg,#0b1a2e 0%,#10223B 50%,#152d4c 100%);color:#fff;padding:20px 22px 0;position:relative;overflow:hidden}
.d3-hero:after{content:"";position:absolute;right:-120px;top:-160px;width:520px;height:520px;border-radius:50%;background:radial-gradient(circle,rgba(8,131,247,.26),transparent 60%);pointer-events:none}
.d3-hrow{display:flex;gap:18px;align-items:flex-start;position:relative;z-index:2}
.d3-ava{width:68px;height:68px;border-radius:20px;display:grid;place-items:center;font:800 23px var(--lb-head,inherit);color:#fff;flex:none;position:relative;box-shadow:0 14px 30px -12px rgba(8,131,247,.9)}
.d3-ava i{position:absolute;right:-4px;bottom:-4px;width:20px;height:20px;border-radius:50%;border:3px solid #10223B;background:#94a3b8}
.d3-ava i.on{background:#16a34a}
.d3-hname{display:flex;gap:9px;align-items:center;flex-wrap:wrap}.d3-hname h1{font-size:25px;color:#fff}
.d3-hsub{color:#9db3cf;font-size:12.5px;margin-top:6px;display:flex;gap:14px;flex-wrap:wrap;align-items:center}
.d3-hsub span{display:inline-flex;gap:5px;align-items:center}.d3-hsub .cc-ico{color:#5f7a9c}
.d3-hstats{display:flex;margin-top:16px;border:1px solid rgba(255,255,255,.1);border-radius:12px;background:rgba(255,255,255,.04);overflow:hidden}
.d3-hstats a{padding:9px 16px;border-right:1px solid rgba(255,255,255,.08);display:block;cursor:pointer}.d3-hstats a:last-child{border-right:0}
.d3-hstats b{display:block;font:800 18px/1.1 var(--lb-head,inherit);color:#fff;font-variant-numeric:tabular-nums}
.d3-hstats span{font-size:10.3px;letter-spacing:.07em;text-transform:uppercase;color:#7f95b3;font-weight:800;display:flex;gap:4px;align-items:center}
.d3-hact{margin-left:auto;display:flex;gap:18px;align-items:center}
.d3-ring{position:relative;width:92px;height:92px;flex:none}
.d3-ring b{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;font:800 24px/1 var(--lb-head,inherit);color:#fff}
.d3-ring b em{font-style:normal;font-size:7.5px;letter-spacing:.09em;color:#8fa6c2;margin-top:4px;font-weight:800}
.d3-hbtns{display:flex;flex-direction:column;gap:8px}
.d3-rail{display:flex;margin:18px -22px 0;padding:0 22px;background:rgba(255,255,255,.035);border-top:1px solid rgba(255,255,255,.08);position:relative;z-index:2}
.d3-st{flex:1;padding:12px 0 13px;position:relative;display:flex;gap:9px;align-items:flex-start}
.d3-st .d{width:24px;height:24px;border-radius:8px;background:rgba(22,163,74,.2);color:#4ade80;display:grid;place-items:center;flex:none}
.d3-st.now .d{background:var(--o);color:#fff;box-shadow:0 0 0 4px rgba(252,83,5,.22)}
.d3-st.todo .d{background:rgba(255,255,255,.07);color:#5f7a9c}
.d3-st.bad .d{background:rgba(220,38,38,.25);color:#fca5a5}
.d3-st:before{content:"";position:absolute;left:30px;right:10px;top:23px;height:2px;background:#22385a;z-index:-1}
.d3-st:last-child:before{display:none}.d3-st.done:before{background:rgba(22,163,74,.5)}
.d3-st b{display:block;font-size:12.3px;color:#fff}.d3-st.todo b{color:#7f95b3}
.d3-st span{font-size:10.8px;color:#7f95b3;font-weight:600}
.d3-tabs{display:flex;gap:2px;border-bottom:1px solid var(--line);background:#fff;padding:0 22px;position:sticky;top:0;z-index:10;overflow-x:auto;white-space:nowrap;scrollbar-width:none}
.d3-tabs::-webkit-scrollbar{display:none}
.d3-tabs a{display:flex;align-items:center;gap:7px;padding:13px 11px;font-weight:700;font-size:13px;color:var(--mut);border-bottom:2.5px solid transparent;margin-bottom:-1px;flex:none;cursor:pointer}
.d3-tabs a .cc-ico{color:var(--faint)}.d3-tabs a.on{color:var(--n);border-color:var(--b)}.d3-tabs a.on .cc-ico{color:var(--b)}
.d3-tabs a i{font-style:normal;background:#eef2f7;border-radius:999px;padding:1px 7px;font-size:10.5px;color:#475569;font-weight:800}
.d3-tabs a i.hot{background:rgba(252,83,5,.14);color:#c2410c}
.d3-tabs .kb{margin-left:auto;display:flex;gap:8px;align-items:center;font-size:11px;color:var(--faint);font-weight:600;flex:none;padding-left:12px}
.d3-body{padding:18px 22px 44px;background:var(--bg)}
.d3-grid{display:grid;grid-template-columns:minmax(0,1fr) 352px;gap:18px}
.d3-col{display:flex;flex-direction:column;gap:16px;min-width:0}
.d3-card{background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:0 1px 1px rgba(16,34,59,.04),0 2px 6px rgba(16,34,59,.04)}
.d3-ch{display:flex;align-items:center;gap:9px;padding:13px 18px;border-bottom:1px solid var(--line2)}
.d3-ch .ico{width:30px;height:30px;border-radius:9px;background:var(--bg);display:grid;place-items:center;color:var(--n);flex:none}
.d3-ch>div:nth-child(2){flex:1;min-width:0}.d3-ch h3{font-size:13.5px;white-space:nowrap}.d3-ch .sub{font-size:11.8px;color:var(--mut);font-weight:600}
.d3-ch .sp{margin-left:auto;display:flex;gap:6px;align-items:center;flex:none}
.d3-pad{padding:16px 18px}
.d3-lnk{display:inline-flex;align-items:center;gap:5px;font:600 11.5px ui-monospace,monospace;color:var(--mut);background:var(--bg);border:1px solid var(--line);border-radius:7px;padding:3px 8px;white-space:nowrap;cursor:pointer}
.d3-lnk .cc-ico{color:var(--faint)}.d3-lnk:hover{color:var(--b);border-color:var(--b)}
.d3-pill{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:999px;font-size:11px;font-weight:800;background:#eef2f7;color:#334155;white-space:nowrap;line-height:1.5}
.d3-pill.blue{background:rgba(8,131,247,.11);color:#0466c8}.d3-pill.green{background:rgba(22,163,74,.12);color:#15803d}
.d3-pill.amber{background:rgba(217,119,6,.12);color:#b45309}.d3-pill.red{background:rgba(220,38,38,.1);color:#b91c1c}
.d3-pill.violet{background:rgba(124,58,237,.11);color:#6d28d9}.d3-pill.orange{background:rgba(252,83,5,.12);color:#c2410c}
.d3-pill.dark{background:rgba(255,255,255,.12);color:#fff}.d3-pill.line{background:#fff;border:1px solid var(--line);color:var(--ink2)}
.d3-btn{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line);background:#fff;color:var(--ink);border-radius:10px;padding:8px 13px;font:700 12.5px/1 var(--lb-font,inherit);cursor:pointer;white-space:nowrap;box-shadow:0 1px 1px rgba(16,34,59,.04)}
.d3-btn:disabled{opacity:.55;pointer-events:none}
.d3-btn.p{background:var(--b);border-color:var(--b);color:#fff;box-shadow:0 8px 18px -8px rgba(8,131,247,.75)}
.d3-btn.o{background:var(--o);border-color:var(--o);color:#fff;box-shadow:0 8px 18px -8px rgba(252,83,5,.7)}
.d3-btn.danger{background:#fff;border-color:#fecaca;color:#b91c1c}
.d3-btn.g{background:transparent;box-shadow:none}.d3-btn.dk{background:rgba(255,255,255,.1);border-color:rgba(255,255,255,.2);color:#fff;box-shadow:none}
.d3-btn.sm{padding:6px 10px;font-size:12px}.d3-btn kbd{background:rgba(0,0,0,.08);border:0;color:inherit;font-size:10px;padding:1px 5px}
.d3-btn.p kbd,.d3-btn.o kbd,.d3-btn.dk kbd{background:rgba(255,255,255,.2)}
.d3-sec{font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;font-weight:800;color:var(--faint)}
.d3-mut{color:var(--mut)}.d3-mono{font-family:ui-monospace,monospace;font-variant-numeric:tabular-nums}
.d3-tr{height:6px;border-radius:5px;background:#edf1f6;overflow:hidden}.d3-tr i{display:block;height:100%;border-radius:5px}
.d3-nba{border-left:3px solid var(--o)}
.d3-nba .row{display:flex;gap:13px;align-items:center;padding:13px 18px;border-top:1px solid var(--line2)}
.d3-nba .ic{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;flex:none}
.d3-nba .row b{font-size:13.3px}.d3-nba .row p{margin:2px 0 0;font-size:12.2px;color:var(--mut)}
.d3-bars .b{display:grid;grid-template-columns:196px 1fr 44px 110px;gap:12px;align-items:center;padding:8px 0;border-top:1px solid var(--line2);white-space:nowrap}
.d3-bars .b:first-child{border-top:0}.d3-bars .b>span:first-child{font-weight:700;display:flex;gap:8px;align-items:center}.d3-bars .b .cc-ico{color:var(--faint)}
.d3-cc{border:1px solid var(--line);border-radius:12px;padding:14px 15px;background:#fff}
.d3-cc.warn{border-color:#f5cbb0;background:linear-gradient(180deg,#fff9f5,#fff)}.d3-cc.pause{border-color:#fde68a;background:#fffdf2}
.d3-cc .h{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.d3-cc .lg{width:36px;height:36px;border-radius:10px;color:#fff;display:grid;place-items:center;font:800 12.5px var(--lb-head,inherit);flex:none}
.d3-spec{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin-top:12px;padding-top:11px;border-top:1px solid var(--line2);font-size:12.2px;font-weight:600}
.d3-spec b{display:flex;gap:4px;align-items:center;font-size:10px;letter-spacing:.07em;text-transform:uppercase;color:var(--faint);margin-bottom:2px}
.d3-tbl{width:100%;border-collapse:collapse}.d3-tbl th{font-size:10.5px;letter-spacing:.09em;text-transform:uppercase;color:var(--faint);text-align:left;font-weight:800;padding:0 12px 9px}
.d3-tbl td{padding:11px 12px;border-top:1px solid var(--line2);vertical-align:middle}
.d3-dot{width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:6px}
.d3-tl{position:relative;padding-left:22px}.d3-tl:before{content:"";position:absolute;left:7px;top:8px;bottom:8px;width:2px;background:var(--line)}
.d3-tl .e{position:relative;padding:0 0 14px}.d3-tl .e:before{content:"";position:absolute;left:-20px;top:5px;width:10px;height:10px;border-radius:50%;background:#fff;border:2.5px solid var(--b)}
.d3-tl .e.g:before{border-color:var(--ok)}.d3-tl .e.o:before{border-color:var(--o)}.d3-tl .e.m:before{border-color:#cbd5e1}
.d3-tl .e b{display:block;font-size:12.5px}.d3-tl .e span{font-size:11.4px;color:var(--mut)}
.d3-doc{display:flex;gap:11px;align-items:center;padding:10px 12px;border:1px solid var(--line);border-radius:11px}.d3-doc+.d3-doc{margin-top:8px}
.d3-doc .x{width:32px;height:32px;border-radius:9px;display:grid;place-items:center;background:var(--bg);color:var(--n);flex:none}
.d3-doc.ok{border-color:#bfe3cd;background:#f5fcf7}.d3-doc.ok .x{background:rgba(22,163,74,.12);color:#15803d}
.d3-doc.miss{border-color:#f5cbb0;background:#fff9f5}.d3-doc.miss .x{background:rgba(252,83,5,.12);color:#c2410c}
.d3-flag{display:flex;gap:10px;padding:9px 0;font-size:12.3px;align-items:flex-start;border-top:1px solid var(--line2)}.d3-flag:first-child{border-top:0}.d3-flag .cc-ico{margin-top:2px}
.d3-mini{display:grid;grid-template-columns:repeat(2,1fr);gap:9px}.d3-mini>div{border:1px solid var(--line);border-radius:11px;padding:10px 12px}
.d3-mini b{display:block;font:800 18px var(--lb-head,inherit);font-variant-numeric:tabular-nums}.d3-mini span{font-size:10.3px;letter-spacing:.07em;text-transform:uppercase;color:var(--faint);font-weight:800}
.d3-kpis{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.d3-kpi{border:1px solid var(--line);border-radius:12px;padding:11px 13px;background:#fff}.d3-kpi.ok{border-color:#bfe3cd}.d3-kpi.bad{border-color:#f5cbb0}
.d3-kpi b{display:block;font:800 19px var(--lb-head,inherit);font-variant-numeric:tabular-nums}.d3-kpi span{font-size:11px;color:var(--mut);font-weight:700}
.d3-in{border:1px solid var(--line);border-radius:10px;padding:8px 11px;font:inherit;color:var(--ink);background:#fff;min-width:0}
.d3-in:focus{outline:none;border-color:var(--b);box-shadow:0 0 0 3px rgba(8,131,247,.15)}
.d3-msgs{max-height:340px;overflow:auto;background:var(--bg);border:1px solid var(--line);border-radius:12px;padding:10px 12px}
.d3-msg{padding:6px 0;border-bottom:1px solid var(--line2);font-size:12.6px}.d3-msg.sys{color:var(--mut);font-style:italic}
.d3-empty{padding:18px;text-align:center;color:var(--mut);font-size:12.6px}
.d3-mnav{display:none}
@media (max-width:760px){
  .d3{margin:-12px -14px 0}
  .d3-top{height:auto;padding:9px 14px;flex-wrap:wrap;gap:8px}.d3-url{display:none}
  .d3-hero{padding:16px 14px 0}.d3-hrow{flex-wrap:wrap;gap:12px}.d3-ava{width:54px;height:54px;font-size:18px;border-radius:16px}.d3-hname h1{font-size:21px}
  .d3-hsub{gap:8px 12px;font-size:12px}
  .d3-hstats{overflow-x:auto;scrollbar-width:none;margin-left:-14px;margin-right:-14px;border-radius:0;border-left:0;border-right:0}.d3-hstats a{flex:none;padding:8px 13px}
  .d3-hact{margin-left:0;width:100%;justify-content:space-between;padding-bottom:14px}.d3-hbtns{flex:1}.d3-hbtns .d3-btn{width:100%;justify-content:center}
  .d3-rail{margin:0 -14px;padding:0 14px;overflow-x:auto;scrollbar-width:none}.d3-st{flex:none;min-width:150px;padding-right:14px}
  .d3-tabs{padding:0 8px}.d3-tabs .kb{display:none}
  .d3-body{padding:14px 14px 90px}.d3-grid{grid-template-columns:1fr;gap:14px}
  .d3-ch{padding:12px 14px}.d3-ch h3{white-space:normal}.d3-ch .sp .d3-lnk{display:none}.d3-ch .ico{display:none}
  .d3-pad{padding:14px}
  .d3-nba .row{flex-wrap:wrap}.d3-nba .row .d3-btn{width:100%;justify-content:center}
  .d3-bars .b{grid-template-columns:1fr 40px;grid-template-areas:"l v" "t t" "k k";white-space:normal}
  .d3-bars .b>span:first-child{grid-area:l}.d3-bars .b .d3-tr{grid-area:t}.d3-bars .b .d3-mono{grid-area:v;text-align:right}.d3-bars .b .d3-lnk{grid-area:k;justify-self:start}
  .d3-cc .h .d3-lnk{display:none}
  .d3-scroll{overflow-x:auto}.d3-tbl{min-width:640px}
  .d3-mnav{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:40;background:#fff;border-top:1px solid var(--line);padding:8px 10px calc(8px + env(safe-area-inset-bottom,0px));gap:6px;box-shadow:0 -8px 24px -14px rgba(16,34,59,.35)}
  .d3-mnav .d3-btn{flex:1;justify-content:center}
}`;
  document.head.appendChild(s);
}

// ---------------------------------------------------------------- readiness (formula shown to the user)
function readiness(dd, test, k, bookings, comm) {
  const pp = dd.profile || {}; const s = pp.skills || {};
  const parts = [];
  // identity 20: CV 8, ID 12 (identity is what stops a rejected candidate re-applying)
  const idPts = (s.cv_doc ? 8 : 0) + (s.id_doc ? 12 : 0);
  parts.push({ k: 'identity', label: 'Identity & documents', pts: idPts, max: 20, ic: 'id', tab: 'documents', note: !s.id_doc ? 'no government ID on file' : null });
  // test 20: scored → score% × 20; submitted → 0 with note; none → 0
  const st = test && test.state; let tPts = 0; let tNote = null;
  if (st === 'scored' && test.max_score) tPts = Math.round(20 * Number(test.staff_score || 0) / Number(test.max_score));
  else if (st === 'submitted') tNote = 'submitted, not graded yet'; else if (!st || st === 'none') tNote = 'not sent'; else tNote = st.replace('_', ' ');
  parts.push({ k: 'test', label: 'Skills test', pts: tPts, max: 20, ic: 'clipboard', tab: 'test', note: tNote });
  // coverage 20: 10 for an active carrier, +5 per truck up to 2
  const live = (dd.assignments || []).filter((a) => a.status === 'active');
  const trucks = live.reduce((a, x) => a + Number(x.trucks || 0), 0);
  parts.push({ k: 'coverage', label: 'Coverage capacity', pts: Math.min(20, (live.length ? 10 : 0) + Math.min(2, trucks) * 5), max: 20, ic: 'truck', tab: 'carriers', note: !live.length ? 'no active carrier' : null });
  // trial performance 20: bars cleared / 6 × 20 (only when there are bookings in the window)
  const bars = k && !k.error && Number(k.bookings || 0) > 0 ? scorecardRows(k) : null;
  const cleared = bars ? bars.filter((r) => r.ok === true).length : 0;
  parts.push({ k: 'perf', label: 'Trial performance', pts: bars ? Math.round(20 * cleared / bars.length) : 0, max: 20, ic: 'trend', tab: 'performance', note: bars ? cleared + ' of ' + bars.length + ' bars' : 'no bookings in the window' });
  // compliance 20: RC attach 8 · RC turnaround ≤4h 6 · below-floor share 0 6
  let cPts = 0; const cNotes = [];
  if (k && !k.error && Number(k.bookings || 0) > 0) {
    if (Number(k.rc_attach_rate) >= 100) cPts += 8; else cNotes.push('RC attached ' + (k.rc_attach_rate != null ? k.rc_attach_rate + '%' : '—'));
    if (k.rc_turnaround_h == null || Number(k.rc_turnaround_h) <= 4) cPts += 6; else cNotes.push('RC turnaround ' + k.rc_turnaround_h + ' h');
    if (!Number(k.below_min_share)) cPts += 6; else cNotes.push(k.below_min_share + '% booked under floor');
  } else cNotes.push('no bookings yet');
  parts.push({ k: 'sop', label: 'Compliance & SOP', pts: cPts, max: 20, ic: 'shield', tab: 'loads', note: cNotes.join(' · ') || null });
  const total = parts.reduce((a, p) => a + p.pts, 0);
  return { total, parts };
}

// The trial pass bar (mirrors the KPI RPC + the copy in dispatchers.js)
function scorecardRows(k) {
  const n = (v) => (v == null ? null : Number(v));
  return [
    { label: 'Loads / wk / truck', bar: '≥ 3.0', val: n(k.loads_per_week_per_truck), fmt: (v) => v.toFixed(1), ok: n(k.loads_per_week_per_truck) == null ? null : n(k.loads_per_week_per_truck) >= 3 },
    { label: 'Avg $/mi', bar: 'above floor', val: n(k.avg_rpm), fmt: (v) => '$' + v.toFixed(2), ok: n(k.below_min_share) == null ? null : n(k.below_min_share) === 0, sub: k.below_min_share != null ? k.below_min_share + '% under floor' : null },
    { label: 'RC attached', bar: '100%', val: n(k.rc_attach_rate), fmt: (v) => v + '%', ok: n(k.rc_attach_rate) == null ? null : n(k.rc_attach_rate) >= 100, sub: k.rc_turnaround_h != null ? 'avg ' + k.rc_turnaround_h + ' h' : null },
    { label: 'Check calls / load', bar: '≥ 2', val: n(k.check_calls_per_load), fmt: (v) => v.toFixed(1), ok: n(k.check_calls_per_load) == null ? null : n(k.check_calls_per_load) >= 2 },
    { label: 'Deadhead', bar: '≤ 15%', val: n(k.deadhead_pct), fmt: (v) => v + '%', ok: n(k.deadhead_pct) == null ? null : n(k.deadhead_pct) <= 15 },
    { label: 'Dispatch-caused cancels', bar: '0', val: n(k.cancelled), fmt: (v) => String(v), ok: n(k.cancelled) == null ? null : n(k.cancelled) === 0 },
  ];
}

// ---------------------------------------------------------------- next best action (rules, ranked)
function nextActions(dd, test, k, bookings, comm, go, act) {
  const pp = dd.profile || {}; const s = pp.skills || {}; const out = [];
  const st = pp.status; const ts = test && test.state;
  const push = (rank, ic, tone, title, body, label, fn) => out.push({ rank, ic, tone, title, body, label, fn });
  if (st === 'trial' && pp.trial_end) {
    const left = daysBetween(new Date().toISOString().slice(0, 10), pp.trial_end);
    if (left <= 4) push(1, 'timer', 'o', left < 0 ? 'Trial ended ' + (-left) + ' day' + (left === -1 ? '' : 's') + ' ago — no decision recorded' : 'Trial ends in ' + left + ' day' + (left === 1 ? '' : 's') + ' — no decision recorded',
      (k && !k.error && Number(k.bookings) > 0 ? 'At ' + Number(k.loads_per_week_per_truck || 0).toFixed(1) + ' loads/wk/truck against a bar of 3, RC attached ' + (k.rc_attach_rate != null ? k.rc_attach_rate + '%' : '—') + '.' : 'No bookings in the trial window yet.'), 'Review & decide', () => go('performance'));
  }
  if (ts === 'submitted') push(2, 'clipboard', 'o', 'Skills test is waiting to be graded', 'Submitted ' + ago(test.submitted_at) + (test.auto_score != null ? ' · auto-scored ' + test.auto_score + '/' + test.max_score + ' on the number and multiple-choice items.' : '.'), 'Grade now', () => go('test'));
  if (ts === 'scored' && test.decision === 'pass' && !test.score_email_at) push(3, 'mail', 'o', 'Passed, but the score has not been e-mailed', 'Pass e-mail ' + (test.passed_email_at ? 'went out ' + ago(test.passed_email_at) : 'not sent') + '. The number goes out when every question carries a mark.', 'Open test', () => go('test'));
  if (ts === 'invited' && test.start_by && (new Date(test.start_by) - Date.now()) < 12 * 3600e3) push(4, 'cal', 'o', 'Test invite expires ' + (new Date(test.start_by) > Date.now() ? 'in ' + Math.max(1, Math.round((new Date(test.start_by) - Date.now()) / 3600e3)) + ' h' : 'expired'), 'Sent ' + ago(test.invited_at) + ', never started. A lapsed invite is itself a signal.', 'Open test', () => go('test'));
  const draft = (comm || []).filter((c) => c.status === 'draft').reduce((a, c) => a + Number(c.amount || 0), 0);
  const approved = (comm || []).filter((c) => c.status === 'approved').reduce((a, c) => a + Number(c.amount || 0), 0);
  if (approved > 0) push(5, 'wallet', 'b', money(approved) + ' approved and not paid', 'Record the payout (amount, currency, FX, reference) — the dispatcher is e-mailed the reference.', 'Pay', () => go('money'));
  if (draft > 0) push(6, 'wallet', 'b', money(draft) + ' in commission is sitting on pending', 'Approve once the broker has been invoiced for each delivered load.', 'Open ledger', () => go('money'));
  const rc = (bookings || []).filter((b) => b.status === 'rc_received');
  if (rc.length) push(2, 'doc', 'o', rc.length + ' booking' + (rc.length === 1 ? '' : 's') + ' with an RC waiting for approval', rc.map((b) => b.origin + ' → ' + b.destination + ' · ' + money(b.gross)).slice(0, 2).join(' · '), 'Approve', () => go('loads'));
  (dd.assignments || []).filter((a) => a.status === 'active').forEach((a) => {
    const last = (bookings || []).filter((b) => b.carrier_org_id === a.carrier_org_id || b.carrier === a.carrier).map((b) => b.created_at).sort().pop();
    const quiet = last ? daysBetween(last, new Date()) : daysBetween(a.assigned_at, new Date());
    if (quiet >= 3) push(7, 'truck', 'v', (a.carrier || 'Carrier') + ' — no load booked for ' + quiet + ' days', last ? 'Last booking ' + dShort(last) + '.' : 'Nothing booked since the assignment on ' + dShort(a.assigned_at) + '.', 'Open carrier', () => go('carriers'));
    if (Number(a.unread || 0) > 0) push(8, 'chat', 'b', a.unread + ' unread in the ' + (a.carrier || 'carrier') + ' thread', 'Dispatcher or carrier wrote and nobody from LoadBoot has read it.', 'Open thread', () => go('messages'));
    if (!a.carrier_ack_at) push(9, 'mail', 'b', (a.carrier || 'Carrier') + ' has not confirmed the assignment', a.carrier_notified_at ? 'Intro e-mail sent ' + dShort(a.carrier_notified_at) + ', no "Got it" yet.' : 'Intro e-mail never sent.', 'Open carrier', () => go('carriers'));
  });
  if (st === 'applied') push(3, 'eye', 'b', 'Application not screened yet', 'Applied ' + ago(pp.created_at) + '. Start screening or reject — a candidate left in Applied costs trust.', 'Start screening', () => act('screening'));
  if (st === 'screening' && (!ts || ts === 'none')) push(3, 'send', 'b', 'Screened — skills test not sent', 'The candidate gets one e-mail with a button into the portal. ' + 'Bank v2 draws a fresh set per candidate.', 'Send skills test', () => go('test'));
  if (st === 'verified' && !(dd.assignments || []).some((a) => a.status === 'active')) push(4, 'handshake', 'b', 'Verified with no carrier assigned', 'Nothing activates until a carrier is assigned with an SOP.', 'Assign a carrier', () => go('carriers'));
  if (!s.id_doc && !['rejected', 'withdrawn'].includes(st)) push(10, 'id', 'v', 'No government ID on file', 'Identity and country are unverified — this is what stops a rejected candidate re-applying.', 'Documents', () => go('documents'));
  out.sort((a, b) => a.rank - b.rank);
  return out;
}

// ---------------------------------------------------------------- page
export async function renderDispatcher360(host, query) {
  style();
  const id = query && query.get('id');
  const focusBooking = query && query.get('booking');
  let tab = (query && query.get('tab')) || 'overview';
  if (!id) { mount(host, el('div', { class: 'cc-deny' }, [el('h2', null, 'No dispatcher selected'), el('p', null, [el('a', { href: '#/dispatchers' }, '← Back to the roster')])])); return; }

  const root = el('div', { class: 'd3' }, el('div', { class: 'd3-empty' }, 'Loading dispatcher…'));
  mount(host, root);

  const state = { dd: null, test: null, kpi: null, kpiDays: 30, bookings: null, comm: null, activity: null, carriers: [] };
  const load = async (what) => {
    const all = !what;
    const jobs = [];
    if (all || what === 'dd') jobs.push(ccDispatcher360(id).then((r) => { state.dd = r; }));
    if (all || what === 'test') jobs.push(ccDispatcherTestReview(id).then((r) => { state.test = r; }).catch((e) => { state.test = { error: humanizeError(e) }; }));
    if (all || what === 'kpi') jobs.push(ccDispatcherKpis(id, state.kpiDays).then((r) => { state.kpi = r; }).catch((e) => { state.kpi = { error: humanizeError(e) }; }));
    if (all || what === 'bookings') jobs.push(ccDispatcherBookings({ user: id, limit: 200 }).then((r) => { state.bookings = Array.isArray(r) ? r : []; }).catch(() => { state.bookings = []; }));
    if (all || what === 'comm') jobs.push(ccDispatcherCommissionList(id).then((r) => { state.comm = Array.isArray(r) ? r : []; }).catch(() => { state.comm = []; }));
    if (all || what === 'activity') jobs.push(ccDispatcherActivity(id, 60).then((r) => { state.activity = Array.isArray(r) ? r : []; }).catch(() => { state.activity = []; }));
    await Promise.all(jobs);
  };
  try { await load(); } catch (e) { mount(root, el('div', { class: 'd3-empty' }, humanizeError(e))); return; }
  if (!state.dd || state.dd.error || !state.dd.profile) { mount(root, el('div', { class: 'd3-empty' }, (state.dd && state.dd.error) || 'This dispatcher does not exist.')); return; }

  const rerender = async (what) => { await load(what); paint(); };
  const go = (t) => { tab = t; try { history.replaceState(null, '', '#/dispatcher?id=' + encodeURIComponent(id) + '&tab=' + t); } catch (_) {} paint(); window.scrollTo({ top: 0 }); };

  async function decide(action, note) {
    const r = await ccDispatcherDecide(id, action, note).catch((e) => ({ error: humanizeError(e) }));
    if (r && r.error) { toast(r.error); return null; }
    toast('✓ ' + (r.status || 'updated')); if (r.warning) toast('⚠ ' + r.warning); rerender(); return r;
  }
  async function act(action, confirmMsg, body, danger) {
    if (confirmMsg && !(await askConfirm(confirmMsg, { body, danger }))) return;
    let note = null;
        if (action === 'reject') {
          // bl_disp_0378 — the reject dialog collects BOTH the candidate-facing note (which IS the
          // e-mail body) and the machine-readable gaps. The gaps are stored first, so the portal
          // already has them by the time the applicant opens the rejection.
          const r9 = await askReason('Reason for rejecting — this text IS the e-mail the applicant receives', { reasons: REASONS });
          if (!r9) return;
          note = r9.note;
          const sr9 = await ccDispatcherSetRejectReasons(id, r9.reasons).catch((e) => ({ error: humanizeError(e) }));
          if (sr9 && sr9.error) { toast('Reasons not saved: ' + sr9.error); return; }
        } else if (action === 'suspend') { note = await askReason('Reason for suspending (the dispatcher sees this)'); if (note === null) return; }
    decide(action, note);
  }
  // Move to trial = terms first (commission % + working-day window). No 0% trials by accident.
  function trialForm() {
    const pp = state.dd.profile;
    const pct = el('input', { class: 'd3-in', type: 'number', step: '0.25', min: '0', max: '5', value: pp.commission_pct != null && Number(pp.commission_pct) > 0 ? pp.commission_pct : 2.5, style: 'max-width:110px' });
    const today = new Date().toISOString().slice(0, 10);
    const ts = el('input', { class: 'd3-in', type: 'date', value: pp.trial_start || today });
    const te = el('input', { class: 'd3-in', type: 'date', value: pp.trial_end || addWorkingDays(today, 10) });
    // app_private.disp_trial_email renders p_note as the orange "A note from LoadBoot" block.
    const note = el('textarea', { class: 'd3-in', rows: '3', style: 'width:100%;resize:vertical',
      placeholder: 'Optional — e.g. Start with GABE LOGISTICS (2 dry vans). First check-in call Monday 9am CT.' });
    const err = el('div', { class: 'cc-sub', style: 'color:#dc2626;min-height:18px' });
    const goBtn = btn('Start the trial', async () => {
      const p = Number(pct.value); if (!(p > 0 && p <= 5)) { err.textContent = 'Commission must be above 0 and at most 5%.'; return; }
      if (!ts.value || !te.value || te.value < ts.value) { err.textContent = 'Set a valid trial window.'; return; }
      const r = await ccDispatcherSetTerms(id, p, ts.value, te.value).catch((e) => ({ error: humanizeError(e) }));
      if (r && r.error) { err.textContent = r.error; return; }
      dr.close(); await decide('trial', note.value.trim() || null);
    }, 'p', 'play');
    const dr = openDrawer('Trial terms — ' + (pp.full_name || ''), el('div', { class: 'cc-form' }, [
      el('p', { class: 'cc-sub', style: 'margin:0 0 10px;line-height:1.6' }, 'Commission-only trial: the dispatcher earns this % of gross on every load they book that reaches Delivered inside the window. LoadBoot keeps 5% from the carrier, so the cap is 5. Ten working days is the standard. The dispatcher is e-mailed the terms and the workspace opens once a carrier is assigned.'),
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, [el('span', { class: 'cc-sub' }, '% of gross'), pct, el('span', { class: 'cc-sub' }, 'from'), ts, el('span', { class: 'cc-sub' }, 'to'), te]),
      el('div', { class: 'cc-sub', style: 'margin:13px 0 5px' }, 'A note from LoadBoot — optional. Whatever you write here is printed in the trial e-mail as its own block.'),
      note,
      err, el('div', { style: 'display:flex;gap:8px;margin-top:12px' }, [goBtn, btn('Cancel', () => dr.close())]),
    ]), { subtitle: 'Recorded in the terms log · the dispatcher is notified' });
  }
  function termsForm() {
    const pp = state.dd.profile;
    const pct = el('input', { class: 'd3-in', type: 'number', step: '0.25', min: '0', max: '5', value: pp.commission_pct != null ? pp.commission_pct : 0, style: 'max-width:110px' });
    const ts = el('input', { class: 'd3-in', type: 'date', value: pp.trial_start || '' });
    const te = el('input', { class: 'd3-in', type: 'date', value: pp.trial_end || '' });
    const save = btn('Save terms', async () => {
      if (!(await askConfirm('Update terms?', { body: 'Commission ' + pct.value + '% of gross' + (ts.value ? ', trial ' + ts.value + ' → ' + te.value : '') + '. Already-approved loads keep the % frozen at approval; the dispatcher is e-mailed the new terms.' }))) return;
      const r = await ccDispatcherSetTerms(id, Number(pct.value), ts.value || null, te.value || null).catch((e) => ({ error: humanizeError(e) }));
      if (r && r.error) { toast(r.error); return; } dr.close(); toast('✓ terms saved'); rerender();
    }, 'p', 'check');
    const dr = openDrawer('Commission & trial window', el('div', { class: 'cc-form' }, [
      el('p', { class: 'cc-sub', style: 'margin:0 0 10px;line-height:1.6' }, 'Per-load commission = this % of gross line-haul on every load the dispatcher books that reaches Delivered. Frozen per load at approval time. LoadBoot keeps 5% from the carrier, so this is capped at 5. Trial dates drive the countdown and the KPI window.'),
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, [el('span', { class: 'cc-sub' }, '% of gross'), pct, el('span', { class: 'cc-sub' }, 'trial'), ts, el('span', { class: 'cc-sub' }, '→'), te]),
      el('div', { style: 'display:flex;gap:8px;margin-top:12px' }, [save, btn('Cancel', () => dr.close())]),
    ]), { subtitle: 'Recorded in the terms log' });
  }

  // ---- primary pipeline action for the hero (mirrors the old "Verification pipeline" card, one button at a time)
  function primaryAction() {
    const pp = state.dd.profile; const st = pp.status; const ts = state.test && state.test.state;
    if (st === 'applied') return btn('Start screening', () => act('screening'), 'o', 'eye');
    if (st === 'screening') return ts === 'submitted' ? btn('Grade the test', () => go('test'), 'o', 'clipboard') : btn(ts && ts !== 'none' ? 'Open the test' : 'Send skills test', () => go('test'), 'o', 'send');
    if (st === 'skills_test') return btn('Move to trial — set terms', () => trialForm(), 'o', 'play');
    if (st === 'trial') return btn('Verify — passed trial', () => act('verify', 'Verify ' + (pp.full_name || 'this dispatcher') + '?', 'Check the scorecard first: ≥3 loads/week/truck, avg $/mi above the floor, 100% RC attached, ≥2 check calls per load, no dispatch-caused cancellations.'), 'o', 'award');
    if (st === 'verified') return btn('Assign a carrier', () => go('carriers'), 'o', 'handshake');
    if (st === 'suspended') return btn('Reinstate', () => act('reinstate', 'Reinstate?', 'Paused assignments resume; returns to trial if the trial window is still open.'), 'o', 'play');
    if (st === 'active') return btn('Message', () => go('messages'), 'o', 'chat');
    return null;
  }
  function moreMenu() {
    const pp = state.dd.profile; const st = pp.status;
    return btn('', () => {
      const items = [];
      if (['active', 'verified', 'trial'].includes(st)) items.push(['Suspend', () => act('suspend', 'Suspend this dispatcher?', 'Every active assignment is PAUSED immediately: the workspace, documents, thread and bookings close. Carriers are told LoadBoot dispatch covers them.', true)]);
      if (!['rejected', 'active'].includes(st)) items.push(['Reject application', () => act('reject', 'Reject this applicant?', 'Active assignments end. This is final for the application. The reason you type next is the e-mail the applicant receives.', true)]);
      items.push(['Edit terms', termsForm]);
      items.push(['Copy link to this page', () => { try { navigator.clipboard.writeText(location.origin + location.pathname + '#/dispatcher?id=' + id + '&tab=' + tab); toast('Link copied'); } catch (_) { toast(location.hash); } }]);
      const dr = openDrawer('More — ' + (pp.full_name || ''), el('div', { style: 'display:flex;flex-direction:column;gap:8px' }, items.map(([l, fn]) => btn(l, () => { dr.close(); fn(); }, /Suspend|Reject/.test(l) ? 'danger' : ''))));
    }, 'dk', 'more', { title: 'More actions' });
  }

  // ---- hero + rail
  function hero() {
    const dd = state.dd; const pp = dd.profile; const s = pp.skills || {}; const t = state.test || {}; const k = state.kpi && !state.kpi.error ? state.kpi : null;
    const live = (dd.assignments || []).filter((a) => a.status === 'active');
    const trucks = live.reduce((a, x) => a + Number(x.trucks || 0), 0);
    const owed = (state.comm || []).filter((c) => c.status === 'approved' || c.status === 'draft').reduce((a, c) => a + Number(c.amount || 0), 0);
    const rd = readiness(dd, state.test, state.kpi, state.bookings, state.comm);
    const trialDay = pp.status === 'trial' && pp.trial_start && pp.trial_end ? { d: workingDays(pp.trial_start, new Date().toISOString().slice(0, 10)), n: workingDays(pp.trial_start, pp.trial_end) } : null;
    const dash = 2 * Math.PI * 39; const off = dash * (1 - Math.max(0, Math.min(100, rd.total)) / 100);
    const stat = (v, l, ic, t2) => el('a', { onClick: () => go(t2) }, [el('b', null, v == null ? '—' : String(v)), el('span', null, [icon(ic, 11), l])]);
    return el('div', { class: 'd3-hero' }, [
      el('div', { class: 'd3-hrow' }, [
        el('div', { class: 'd3-ava', style: 'background:linear-gradient(140deg,' + hue(pp.user_id) + ',#5b3df7)' }, initials(pp.full_name)),
        el('div', { style: 'min-width:0' }, [
          el('div', { class: 'd3-hname' }, [el('h1', null, pp.full_name || '(no name)'), stPill(pp.status),
            trialDay ? pill('Trial · day ' + Math.min(trialDay.d, trialDay.n) + ' of ' + trialDay.n, 'blue', 'timer') : '',
            pp.commission_pct != null && Number(pp.commission_pct) > 0 ? pill(pp.commission_pct + '% of gross', 'green', 'dollar') : (['trial', 'verified', 'active'].includes(pp.status) ? pill('No commission % set', 'red', 'alert') : ''),
            s.id_doc ? pill('ID on file', 'dark', 'shield') : pill('No ID', 'red', 'alert')]),
          el('div', { class: 'd3-hsub' }, [
            dd.email ? el('span', null, [icon('mail', 14), dd.email]) : '',
            el('span', null, [icon('globe', 14), [pp.city, pp.country].filter(Boolean).join(', ') || '—', s.timezone ? ' · ' + s.timezone : '']),
            s.us_hours_overlap ? el('span', null, [icon('clock', 14), 'US-hours overlap']) : el('span', { style: 'color:#fbbf24' }, [icon('alert', 14), 'no US-hours overlap stated']),
            el('span', null, [icon('award', 14), (pp.years_exp || 0) + ' yrs experience']),
            pp.phone ? el('span', null, [icon('phone', 14), pp.phone]) : '',
            el('span', null, [icon('cal', 14), 'applied ' + dShort(pp.created_at)]),
          ]),
          el('div', { class: 'd3-hstats' }, [
            stat(live.length, 'Carriers', 'truck', 'carriers'), stat(trucks, 'Trucks', 'truck', 'carriers'),
            stat(k ? k.bookings : (state.bookings ? state.bookings.length : null), 'Loads booked', 'route', 'loads'),
            stat(k && k.avg_rpm != null ? '$' + Number(k.avg_rpm).toFixed(2) : null, 'Avg $/mi', 'trend', 'performance'),
            stat(k && k.deadhead_pct != null ? k.deadhead_pct + '%' : null, 'Deadhead', 'fuel', 'performance'),
            stat(money(owed), 'Owed', 'wallet', 'money'),
          ]),
        ]),
        el('div', { class: 'd3-hact' }, [
          el('div', { class: 'd3-ring', title: 'Readiness = identity 20 · skills test 20 · coverage 20 · trial performance 20 · compliance 20' }, [
            el('div', { html: '<svg width="92" height="92" viewBox="0 0 92 92"><circle cx="46" cy="46" r="39" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="8"/><circle cx="46" cy="46" r="39" fill="none" stroke="#0883F7" stroke-width="8" stroke-linecap="round" stroke-dasharray="' + dash.toFixed(1) + '" stroke-dashoffset="' + off.toFixed(1) + '" transform="rotate(-90 46 46)"/></svg>' }),
            el('b', null, [String(rd.total), el('em', null, 'READINESS')]),
          ]),
          el('div', { class: 'd3-hbtns' }, [primaryAction() || '', btn('Message', () => go('messages'), 'dk', 'chat'),
            el('div', { style: 'display:flex;gap:8px' }, [el('a', { class: 'd3-btn dk', style: 'flex:1;justify-content:center', href: '/app/agent/', target: '_blank', rel: 'noopener' }, [icon('ext', 15), 'Portal']), moreMenu()])]),
        ]),
      ]),
      rail(),
    ]);
  }
  function rail() {
    const dd = state.dd; const pp = dd.profile; const t = state.test || {}; const st = pp.status;
    const order = ['applied', 'screening', 'skills_test', 'trial', 'verified', 'active'];
    const idx = order.indexOf(st);
    const firstAssign = (dd.assignments || []).map((a) => a.assigned_at).sort()[0];
    const steps = [
      { l: 'Applied', s: dShort(pp.created_at) + ((pp.skills || {}).cv_doc ? ' · CV' : '') + ((pp.skills || {}).id_doc ? ' + ID' : ''), done: true },
      { l: 'Screened', s: idx >= 2 ? dShort(pp.reviewed_at) : (st === 'screening' ? 'in progress' : '—'), done: idx >= 2, now: st === 'screening' },
      { l: 'Skills test', s: t.state === 'scored' ? dShort(t.reviewed_at) + ' · ' + (t.staff_score != null ? t.staff_score + ' / ' + t.max_score : t.decision) : t.state === 'submitted' ? 'submitted · grade it' : t.state === 'in_progress' ? 'in progress now' : t.state === 'invited' ? 'invited · not started' : t.state === 'expired' ? 'invite expired' : '—', done: t.state === 'scored' && t.decision === 'pass', now: ['submitted', 'in_progress', 'invited'].includes(t.state) || st === 'skills_test', bad: t.state === 'scored' && t.decision === 'fail' },
      { l: 'Carrier agreed', s: firstAssign ? dShort(firstAssign) + ' · ' + (dd.assignments || []).filter((a) => a.status === 'active').length + ' active' : '—', done: !!firstAssign },
      { l: 'Paid trial', s: pp.trial_start ? dShort(pp.trial_start) + ' → ' + dShort(pp.trial_end) : '—', done: idx >= 4, now: st === 'trial' },
      { l: 'Active', s: st === 'active' ? 'earning' : st === 'verified' ? 'verified · assign a carrier' : '—', done: st === 'active', now: st === 'verified' },
    ];
    if (['suspended', 'rejected', 'withdrawn'].includes(st)) steps.push({ l: STL[st][0], s: dShort(pp.reviewed_at), bad: true });
    return el('div', { class: 'd3-rail' }, steps.map((x) => el('div', { class: 'd3-st ' + (x.bad ? 'bad' : x.now ? 'now' : x.done ? 'done' : 'todo') }, [
      el('div', { class: 'd' }, icon(x.bad ? 'x' : x.now ? 'timer' : x.done ? 'check' : 'dot', 13)), el('div', null, [el('b', null, x.l), el('span', null, x.s)])])));
  }

  const TABS = [['overview', 'Overview', 'grid'], ['test', 'Skills test', 'clipboard'], ['carriers', 'Carriers & trucks', 'truck'], ['performance', 'Performance', 'trend'], ['loads', 'Loads', 'route'], ['money', 'Money', 'wallet'], ['messages', 'Messages', 'chat'], ['timeline', 'Timeline', 'activity'], ['documents', 'Documents', 'doc']];
  function tabCounts() {
    const t = state.test || {}; const live = (state.dd.assignments || []).filter((a) => a.status === 'active');
    const owed = (state.comm || []).filter((c) => c.status === 'approved' || c.status === 'draft').reduce((a, c) => a + Number(c.amount || 0), 0);
    const unread = (state.dd.assignments || []).reduce((a, x) => a + Number(x.unread || 0), 0);
    const open = (state.bookings || []).filter((b) => ['pending_rc', 'rc_received', 'approved', 'dispatched', 'picked_up'].includes(b.status)).length;
    return { test: t.state === 'scored' && t.staff_score != null ? [String(t.staff_score), false] : t.state === 'submitted' ? ['grade', true] : null, carriers: [String(live.length), false], loads: open ? [String(open), (state.bookings || []).some((b) => b.status === 'rc_received')] : null, money: owed ? [money(owed), true] : null, messages: unread ? [String(unread), true] : null };
  }
  function tabs() {
    const c = tabCounts();
    return el('div', { class: 'd3-tabs' }, TABS.map(([k2, l, ic]) => el('a', { class: k2 === tab ? 'on' : '', onClick: () => go(k2) }, [icon(ic, 15), l, c[k2] ? el('i', { class: c[k2][1] ? 'hot' : '' }, c[k2][0]) : '']))
      .concat([el('div', { class: 'kb' }, [kbd('←'), kbd('→'), ' tabs · ', kbd('Esc'), ' roster'])]));
  }

  // ---- shared card builders
  const card = (title, sub, ic, body, actions, link) => el('div', { class: 'd3-card' }, [
    el('div', { class: 'd3-ch' }, [el('div', { class: 'ico' }, icon(ic, 15)), el('div', null, [el('h3', null, title), sub ? el('div', { class: 'sub' }, sub) : '']),
      el('div', { class: 'sp' }, [link ? lnk('#/dispatcher?id=' + id + '&tab=' + link) : ''].concat(actions || []))]), body]);

  function nbaCard() {
    const acts = nextActions(state.dd, state.test, state.kpi, state.bookings, state.comm, go, act);
    const TONE = { o: ['rgba(252,83,5,.12)', '#c2410c'], b: ['rgba(8,131,247,.12)', '#0466c8'], v: ['rgba(124,58,237,.12)', '#6d28d9'] };
    const rows = acts.slice(0, 4).map((a) => el('div', { class: 'row' }, [el('div', { class: 'ic', style: 'background:' + TONE[a.tone][0] + ';color:' + TONE[a.tone][1] }, icon(a.ic, 16)),
      el('div', { style: 'flex:1;min-width:0' }, [el('b', null, a.title), el('p', null, a.body)]), btn(a.label, a.fn, a.rank <= 2 ? 'p' : '', 'arrow')]));
    return el('div', { class: 'd3-card d3-nba' }, [
      el('div', { class: 'd3-ch', style: 'border-bottom:0;padding-bottom:6px' }, [el('div', { class: 'ico', style: 'background:rgba(252,83,5,.12);color:#c2410c' }, icon('flame', 15)),
        el('div', null, [el('h3', null, 'Next best action'), el('div', { class: 'sub' }, acts.length ? 'Ranked by what unblocks money or a decision today' : 'Nothing is waiting on you for this dispatcher')]),
        el('div', { class: 'sp' }, [acts.length > 4 ? pill('+' + (acts.length - 4) + ' more', 'line') : ''])]),
      rows.length ? el('div', null, rows) : el('div', { class: 'd3-empty', style: 'padding:6px 18px 16px;text-align:left' }, 'All clear.'),
    ]);
  }
  function readinessCard() {
    const rd = readiness(state.dd, state.test, state.kpi, state.bookings, state.comm);
    const weakest = rd.parts.slice().sort((a, b) => (a.pts / a.max) - (b.pts / b.max))[0];
    return card('Readiness breakdown', 'Identity 20 · skills test 20 · coverage 20 · trial performance 20 · compliance 20 — computed, nothing hand-typed', 'target',
      el('div', { class: 'd3-pad d3-bars', style: 'padding-top:6px' }, rd.parts.map((p) => el('div', { class: 'b' }, [
        el('span', null, [icon(p.ic, 14), p.label]),
        el('div', { class: 'd3-tr' }, el('i', { style: 'width:' + Math.round(100 * p.pts / p.max) + '%;background:' + (p.pts / p.max >= .8 ? 'var(--ok)' : p.pts / p.max >= .5 ? 'var(--b)' : 'var(--o)') })),
        el('span', { class: 'd3-mono d3-mut' }, p.pts + '/' + p.max),
        el('a', { class: 'd3-lnk', onClick: () => go(p.tab) }, [p.note || p.tab, icon('chev', 12)]),
      ])).concat([weakest && weakest.note ? el('div', { style: 'display:flex;gap:9px;align-items:flex-start;margin-top:10px;padding:10px 12px;border-radius:10px;background:#fff7f2;font-size:12.2px;color:#7c2d12' }, [el('span', { style: 'color:#c2410c;margin-top:2px' }, icon('alert', 15)), el('div', null, [el('b', null, weakest.label + ' is holding the score down. '), weakest.note])]) : ''])),
      [], 'overview');
  }
  function carrierCard(a) {
    const sop = a.sop || {}; const quiet = (() => { const last = (state.bookings || []).filter((b) => b.carrier_org_id === a.carrier_org_id || b.carrier === a.carrier).map((b) => b.created_at).sort().pop(); return last ? { last, d: daysBetween(last, new Date()) } : null; })();
    const warn = a.status === 'active' && (!quiet || quiet.d >= 3);
    const bk = (state.bookings || []).filter((b) => b.carrier_org_id === a.carrier_org_id || b.carrier === a.carrier);
    const delivered = bk.filter((b) => ['delivered', 'invoiced', 'paid'].includes(b.status)).length;
    const rpm = bk.filter((b) => b.miles > 0).map((b) => Number(b.gross) / Number(b.miles)); const avgRpm = rpm.length ? rpm.reduce((x, y) => x + y, 0) / rpm.length : null;
    const under = bk.filter((b) => b.below_min).length;
    return el('div', { class: 'd3-cc ' + (a.status === 'paused' ? 'pause' : warn ? 'warn' : '') }, [
      el('div', { class: 'h' }, [el('div', { class: 'lg', style: 'background:' + hue(a.carrier_org_id) }, initials(a.carrier)),
        el('div', { style: 'flex:1;min-width:0' }, [el('b', { style: 'font-size:14px' }, a.carrier || a.carrier_org_id), ' ', a.status === 'active' ? (warn ? pill('Needs attention', 'orange', 'alert') : pill('Active', 'green')) : pill(a.status, 'amber'), ' ', a.carrier_mc ? pill('MC ' + a.carrier_mc, 'line') : '',
          el('div', { class: 'd3-mut', style: 'font-size:11.8px;margin-top:2px' }, 'Assigned ' + dShort(a.assigned_at) + (a.carrier_ack_at ? ' · owner confirmed ' + dShort(a.carrier_ack_at) : a.carrier_notified_at ? ' · intro sent ' + dShort(a.carrier_notified_at) + ', not confirmed yet' : ' · intro e-mail not sent') + (a.end_reason && a.status === 'paused' ? ' · ' + a.end_reason : ''))]),
        lnk('#/carriers?id=' + encodeURIComponent(a.carrier_org_id), 'carrier 360'),
        btn('SOP', () => editSop(a), 'sm g', 'doc'), btn('Thread' + (a.unread ? ' · ' + a.unread : ''), () => go('messages'), 'sm g', 'chat'),
        // bl_disp_0408 — release / withdraw the dispatcher's LoadBoot line + mailbox + WhatsApp in the carrier's Dispatcher tab
        a.status !== 'ended' ? btn(a.contact_released_at ? 'Contact released ✓' : 'Release contact', async () => {
          const rel = !a.contact_released_at;
          if (!(await askConfirm(rel ? 'Release contact details to ' + (a.carrier || 'the carrier') + '?' : 'Hide the contact details again?', { body: rel ? 'The carrier\'s Dispatcher tab shows the LoadBoot line, the @loadboot.com mailbox and the company WhatsApp, plus the call log and loads. The owner gets an in-app notice and one e-mail (dispatcher.contact.released). Only do this once the line and mailbox are provisioned.' : 'The carrier loses the call / WhatsApp / e-mail buttons and the call log until you release again. No e-mail is sent.', danger: !rel }))) return;
          const note = await askReason(rel ? 'Note for the audit log (optional)' : 'Why hide it? (audit log)'); if (note === null) return;
          const r = await ccDispatcherContactRelease(a.id, rel, note || null).catch((e) => ({ error: humanizeError(e) })); if (r && r.error) { toast(r.error); return; }
          toast(rel ? 'Released — carrier notified.' : 'Contact details hidden.'); await load(); rerender('dd');
        }, 'sm ' + (a.contact_released_at ? 'g' : ''), a.contact_released_at ? 'check' : 'phone') : null,
        btn(a.carrier_notified_at ? 'Re-send intro' : 'Send intro', async () => { if (!(await askConfirm('Send the intro e-mail to ' + (a.carrier || 'the carrier') + '?', { body: 'Branded e-mail to the owner: what the dispatcher can and cannot see, how a load moves, the one-channel rule, the SOP rules, and a one-tap "Got it" link.' }))) return; const r = await ccDispatcherResendIntro(a.id).catch((e) => ({ error: humanizeError(e) })); if (r && r.error) { toast(r.error); return; } toast('✓ intro sent to ' + r.to); rerender('dd'); }, 'sm g', 'send'),
        a.status === 'active' ? btn('Pause', async () => { const reason = await askReason('Pause this assignment — why? (dispatcher + carrier see it)'); if (reason === null) return; const r = await ccDispatcherUnassign(a.id, reason, true).catch((e) => ({ error: humanizeError(e) })); if (r && r.error) { toast(r.error); return; } toast('✓ paused'); rerender('dd'); }, 'sm g', 'pause') : '',
        btn('End', async () => { if (!(await askConfirm('End this assignment?', { body: 'The carrier frees up for reassignment and is told LoadBoot dispatch covers the truck. Blocked while loads are moving unless you add "force".', danger: true }))) return; const reason = await askReason('Reason (dispatcher + carrier see it)'); if (reason === null) return; const r = await ccDispatcherUnassign(a.id, reason, false).catch((e) => ({ error: humanizeError(e) })); if (r && r.error) { toast(r.error); return; } toast('✓ ended'); rerender('dd'); }, 'sm danger', 'x')]),
      el('div', { class: 'd3-spec' }, [
        el('div', null, [el('b', null, [icon('truck', 11), 'Trucks']), String(a.trucks || 0) + ' active']),
        el('div', null, [el('b', null, [icon('user', 11), 'Contact']), a.carrier_contact || '—']),
        el('div', null, [el('b', null, [icon('dollar', 11), 'Floor']), sop.min_rate ? '$' + Number(sop.min_rate).toFixed(2) + '/mi' + (sop.min_rate_note ? ' · ' + sop.min_rate_note : '') : el('span', { style: 'color:#b45309' }, 'no floor set')]),
        el('div', null, [el('b', null, [icon('layers', 11), 'Scope']), sop.scope_value || (sop.scope_type ? sop.scope_type : '—')]),
        el('div', null, [el('b', null, [icon('route', 11), 'Lanes / equipment']), [sop.lanes, sop.equipment].filter(Boolean).join(' · ') || '—']),
        el('div', null, [el('b', null, [icon('cal', 11), 'Last load']), quiet ? dShort(quiet.last) + (quiet.d >= 3 ? ' · ' + quiet.d + ' days quiet' : '') : 'none since assignment']),
      ]),
      el('div', { style: 'display:flex;gap:6px;margin-top:10px;flex-wrap:wrap' }, [pill(bk.length + ' loads booked', 'blue'), delivered ? pill(delivered + ' delivered', 'green') : '', avgRpm != null ? pill('avg $' + avgRpm.toFixed(2) + '/mi', '') : '', under ? pill(under + ' booked under floor', 'amber') : '', !sop.min_rate ? pill('No SOP floor', 'red', 'alert') : '']),
    ]);
  }
  async function loadCarriers(sel) {
    try { const r = await getCarriersDirectory({}); const arr = Array.isArray(r) ? r : (r && r.rows) || [];
      state.carriers = arr.map((c) => ({ id: c.id || c.org_id || c.carrier_id, name: c.name || c.company || c.legal_name })).filter((c) => c.id);
      if (sel) state.carriers.forEach((c) => sel.appendChild(el('option', { value: c.id }, c.name || c.id)));
    } catch (e) { /* leave empty */ }
  }
  function editSop(a, onSave) {
    const s = a.sop || {};
    const prefsHint = el('div', { class: 'cc-sub', style: 'display:none;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:8px 10px;margin-bottom:10px;color:#1d4ed8;font-weight:600' });
    (async () => { try {
      const pr = await ccCarrierPrefs(a.carrier_org_id);
      if (!pr || pr.error || pr.none) return;
      const eb = pr.external_boards || {}; const bits = [];
      if (eb.dat === 'active' || eb.truckstop === 'active') bits.push('Carrier has ' + [eb.dat === 'active' ? 'DAT' : null, eb.truckstop === 'active' ? 'Truckstop' : null].filter(Boolean).join(' + ') + ' — the dispatcher still uses their OWN board login, never the carrier’s');
      if (!lanes.value && Array.isArray(pr.preferred_lanes) && pr.preferred_lanes.length) lanes.value = pr.preferred_lanes.join(', ');
      if (!minRate.value && pr.min_rpm != null) { minRate.value = String(pr.min_rpm); bits.push('Floor pre-filled from the carrier’s own preference ($' + Number(pr.min_rpm).toFixed(2) + '/mi)'); }
      if (!equipment.value && Array.isArray(pr.preferred_equipment) && pr.preferred_equipment.length) equipment.value = pr.preferred_equipment.join('/');
      if (!homeTime.value && pr.home_time) homeTime.value = pr.home_time;
      if (pr.weekend_ok === false) bits.push('No weekends'); if (pr.load_size) bits.push(pr.load_size + ' loads');
      if (bits.length) { prefsHint.textContent = bits.join('  ·  '); prefsHint.style.display = 'block'; }
    } catch (_) {} })();
    const scopeType = el('select', { class: 'd3-in' }, [['geography', 'Geography (origin region)'], ['equipment', 'Equipment type'], ['commodity', 'Commodity / hazmat'], ['single', 'Single-carrier (no others)']].map(([v9, l9]) => el('option', { value: v9, selected: (s.scope_type || 'geography') === v9 ? '' : undefined }, l9)));
    const scopeVal = el('input', { class: 'd3-in', value: s.scope_value || '', placeholder: 'e.g. "Origins in TX/OK/LA" or "Reefer only"' });
    const lanes = el('input', { class: 'd3-in', value: s.lanes || '', placeholder: 'Preferred lanes (e.g. TX↔CA)' });
    const minRate = el('input', { class: 'd3-in', type: 'number', step: '0.05', min: '0', value: s.min_rate != null && s.min_rate !== '' ? s.min_rate : '', placeholder: 'e.g. 2.10', style: 'max-width:140px' });
    const minNote = el('input', { class: 'd3-in', value: s.min_rate_note || '', placeholder: 'e.g. $2.10/mi loaded, radius 1,000 mi, weekends home', style: 'flex:1' });
    const equipment = el('input', { class: 'd3-in', value: s.equipment || '', placeholder: 'Equipment (van/reefer/flatbed)' });
    const homeTime = el('input', { class: 'd3-in', value: s.home_time || '', placeholder: 'Home-time rule' });
    const rules = el('textarea', { class: 'd3-in', style: 'min-height:70px' }, s.rules || '');
    const err = el('div', { class: 'cc-sub', style: 'color:#dc2626;min-height:18px' });
    const save = btn(onSave ? 'Save SOP & assign' : 'Save SOP', async () => {
      const mr = minRate.value === '' ? null : Number(minRate.value);
      if (mr != null && !(mr >= 0 && mr < 20)) { err.textContent = 'Floor rate must be a number per mile (e.g. 2.10).'; return; }
      if (mr == null && !(await askConfirm('No floor rate?', { body: 'Without a floor every booking passes the rate check. Continue?', danger: true }))) return;
      const sop = { scope_type: scopeType.value, scope_value: scopeVal.value.trim(), lanes: lanes.value.trim(), min_rate: mr, min_rate_note: minNote.value.trim(), equipment: equipment.value.trim(), home_time: homeTime.value.trim(), rules: rules.value.trim(), rc_to_staff_first: true, driver_moves_only_after_approval: true };
      if (onSave) { const ok = await onSave(sop); if (ok) dr.close(); return; }
      const r = await ccDispatcherSop(a.id, sop).catch((e) => ({ error: humanizeError(e) }));
      if (r && r.error) { err.textContent = r.error; return; }
      dr.close(); toast('✓ SOP saved — the dispatcher sees it in Trucks'); rerender('dd');
    }, 'p', 'check');
    const lab = (t) => el('label', { class: 'cc-sub', style: 'margin-top:8px;display:block' }, t);
    const dr = openDrawer('SOP — ' + (a.carrier || 'carrier'), el('div', { class: 'cc-form', style: 'display:flex;flex-direction:column;gap:4px' }, [
      el('div', { class: 'cc-sub', style: 'margin-bottom:6px;line-height:1.5' }, 'Scope basis keeps this carrier’s loads NON-overlapping with your other carriers — no load is ever "allocated" between carriers (FMCSA 88 FR 39371). The floor is what the rate check uses: a booking under it needs your written reason to approve.'),
      prefsHint, lab('Scope basis (required for compliance)'), scopeType, scopeVal,
      lab('Floor rate $/loaded mile (number)'), el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [minRate, minNote]),
      lab('Lanes'), lanes, lab('Equipment'), equipment, lab('Home-time'), homeTime, lab('Do’s / don’ts'), rules, err,
      el('div', { style: 'display:flex;gap:8px;margin-top:12px' }, [save, btn('Cancel', () => dr.close())]),
    ]), { subtitle: onSave ? 'Assignment is created only after the SOP is saved' : 'The dispatcher sees the SOP in Trucks' });
  }
  function assignPicker() {
    const pp = state.dd.profile;
    if (!['trial', 'verified', 'active'].includes(pp.status)) return el('div', { class: 'd3-mut', style: 'font-size:12.3px' }, 'Carriers can be assigned once the dispatcher is on trial, verified or active.');
    const sel = el('select', { class: 'd3-in', style: 'min-width:240px' }, [el('option', { value: '' }, 'Choose a carrier…')].concat(state.carriers.map((c) => el('option', { value: c.id }, c.name || c.id))));
    if (!state.carriers.length) loadCarriers(sel);
    const b = btn('Assign — SOP first', () => {
      if (!sel.value) { toast('Pick a carrier'); return; }
      const c = state.carriers.find((k2) => k2.id === sel.value) || { id: sel.value };
      editSop({ carrier_org_id: c.id, carrier: c.name, sop: {} }, async (sop) => {
        const r = await ccDispatcherAssign(id, c.id, sop).catch((e) => ({ error: humanizeError(e) }));
        if (r && r.error) { toast(r.error); return false; }
        toast('✓ assigned — carrier and dispatcher notified'); rerender(); return true;
      });
    }, 'p', 'handshake');
    return el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, [sel, b, el('span', { class: 'd3-mut', style: 'font-size:11.8px' }, 'The carrier gets an e-mail + a confirm card in their portal saying exactly what the dispatcher can see — never bank details. They can pause the dispatcher themselves.')]);
  }
  function carriersCard(full) {
    const live = (state.dd.assignments || []).filter((a) => a.status !== 'ended');
    const ended = (state.dd.assignments || []).filter((a) => a.status === 'ended');
    return card('Assigned carriers', 'One dedicated dispatcher per carrier · the owner can pause him from their portal', 'truck',
      el('div', { class: 'd3-pad', style: 'display:flex;flex-direction:column;gap:10px' }, (live.length ? live.map(carrierCard) : [el('div', { class: 'd3-empty' }, 'No active carriers assigned.')])
        .concat(full ? [el('div', { style: 'margin-top:4px' }, assignPicker())] : [])
        .concat(full && ended.length ? [el('details', null, [el('summary', { class: 'd3-mut', style: 'cursor:pointer;font-weight:700;font-size:12.3px' }, ended.length + ' ended assignment' + (ended.length === 1 ? '' : 's')),
          el('div', { style: 'margin-top:8px;font-size:12.3px' }, ended.map((a) => el('div', { style: 'padding:6px 0;border-top:1px solid var(--line2)' }, [el('b', null, a.carrier || a.carrier_org_id), ' · ' + dShort(a.assigned_at) + ' → ' + dShort(a.ended_at) + (a.end_reason ? ' · ' + a.end_reason : '')])))])] : [])),
      full ? [] : [btn('All carriers', () => go('carriers'), 'sm g', 'arrow')], 'carriers');
  }
  function scorecardCard(full) {
    const k = state.kpi; const pp = state.dd.profile;
    const trialDays = pp.trial_start && pp.trial_end ? Math.max(1, daysBetween(pp.trial_start, pp.trial_end) + 1) : null;
    const opts = [trialDays ? [trialDays, 'Trial window (' + pp.trial_start + ' → ' + pp.trial_end + ')'] : null, [7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days']].filter(Boolean);
    const sel = el('select', { class: 'd3-in', style: 'font-size:12px;padding:5px 9px' }, opts.map(([v, l]) => el('option', { value: v, selected: Number(v) === state.kpiDays ? '' : undefined }, l)));
    sel.addEventListener('change', async () => { state.kpiDays = Number(sel.value); await rerender('kpi'); });
    let body;
    if (!k || k.error) body = el('div', { class: 'd3-empty' }, (k && k.error) || 'KPIs unavailable');
    else if (!Number(k.bookings)) body = el('div', { class: 'd3-empty' }, 'No bookings in this window — nothing to score yet.');
    else {
      const rows = scorecardRows(k); const cleared = rows.filter((r) => r.ok === true).length;
      body = el('div', null, [
        el('div', { class: 'd3-scroll', style: 'padding:8px 6px 6px' }, el('table', { class: 'd3-tbl' }, [el('thead', null, el('tr', null, [el('th', null, 'Measure'), el('th', null, 'Pass bar'), el('th', null, 'Actual'), el('th', { style: 'width:110px' }, '')])),
          el('tbody', null, rows.map((r) => el('tr', null, [el('td', null, el('b', null, r.label)), el('td', { class: 'd3-mut d3-mono' }, r.bar), el('td', { class: 'd3-mono' }, [el('b', null, r.val == null ? '—' : r.fmt(r.val)), r.sub ? el('span', { class: 'd3-mut' }, ' ' + r.sub) : '']),
            el('td', null, [el('span', { class: 'd3-dot', style: 'background:' + (r.ok === true ? 'var(--ok)' : r.ok === false ? 'var(--bad)' : '#cbd5e1') }), r.ok === true ? 'Pass' : r.ok === false ? 'Below bar' : 'No data'])])))])),
        full ? el('div', { class: 'd3-pad d3-kpis', style: 'padding-top:4px' }, [['Bookings', k.bookings], ['Delivered', k.delivered], ['Cancelled', k.cancelled], ['Gross', money(k.gross)], ['Gross / truck / wk', money(k.gross_per_truck_week)], ['On-time', k.on_time_pct != null ? k.on_time_pct + '%' : null], ['RC turnaround', k.rc_turnaround_h != null ? k.rc_turnaround_h + ' h' : null], ['Below floor', k.below_min_share != null ? k.below_min_share + '%' : null], ['Brokers used', k.brokers_used], ['Trucks', k.trucks]].map(([l, v]) => el('div', { class: 'd3-kpi' }, [el('b', null, v == null ? '—' : String(v)), el('span', null, l)]))) : '',
      ]);
      body.dataset.cleared = cleared;
    }
    const clearedPill = k && !k.error && Number(k.bookings) ? pill(scorecardRows(k).filter((r) => r.ok === true).length + ' of 6 bars cleared', 'green') : '';
    return card('Trial scorecard', 'Computed from bookings and events — nothing hand-typed', 'trend', body, [clearedPill, sel], 'performance');
  }
  function termsCard() {
    const pp = state.dd.profile;
    const trialDay = pp.trial_start && pp.trial_end ? { d: workingDays(pp.trial_start, new Date().toISOString().slice(0, 10)), n: workingDays(pp.trial_start, pp.trial_end) } : null;
    const left = pp.trial_end ? daysBetween(new Date().toISOString().slice(0, 10), pp.trial_end) : null;
    return card('Terms', pp.commission_pct != null && Number(pp.commission_pct) > 0 ? 'Set ' + dShort((state.dd.terms_log || [])[0] && state.dd.terms_log[0].set_at) : 'No commission set — set it before any trial', 'dollar',
      el('div', { class: 'd3-pad' }, [
        el('div', { class: 'd3-mini', style: 'margin-bottom:12px' }, [el('div', null, [el('b', null, pp.commission_pct != null ? pp.commission_pct + '%' : '—'), el('span', null, 'of gross')]), el('div', null, [el('b', null, trialDay ? trialDay.n + ' d' : '—'), el('span', null, 'trial window')])]),
        trialDay ? el('div', { class: 'd3-tr', style: 'height:9px' }, el('i', { style: 'width:' + Math.min(100, Math.round(100 * trialDay.d / Math.max(1, trialDay.n))) + '%;background:linear-gradient(90deg,#0883F7,#FC5305)' })) : '',
        el('div', { class: 'd3-mut', style: 'font-size:11.8px;margin-top:7px;display:flex;gap:6px;align-items:center' }, [icon('cal', 13), pp.trial_start ? dShort(pp.trial_start) + ' → ' + dShort(pp.trial_end) + (left != null && pp.status === 'trial' ? ' · ' : '') : 'No trial window', left != null && pp.status === 'trial' ? el('b', { style: 'color:' + (left <= 2 ? '#c2410c' : 'inherit') }, left < 0 ? 'ended ' + (-left) + ' d ago' : left + ' day' + (left === 1 ? '' : 's') + ' left') : '']),
        pp.status === 'trial' ? el('div', { style: 'display:flex;gap:8px;margin-top:12px' }, [btn('Verify', () => act('verify', 'Verify ' + (pp.full_name || 'this dispatcher') + '?', 'Check the scorecard first.'), 'p', 'check', { style: 'flex:1;justify-content:center' }), btn('Extend', termsForm, '', 'cal', { style: 'flex:1;justify-content:center' })]) : '',
      ]), [btn('', termsForm, 'sm g', 'pen', { title: 'Edit terms' })], 'money');
  }
  function docBtn(path, label) { return btn(label || 'Open', async () => { try { const u = await signedDocumentUrl(path, 600); window.open(u, '_blank', 'noopener'); } catch (e) { toast(humanizeError(e)); } }, 'sm g', 'ext'); }
  function documentsCard(full) {
    const s = state.dd.profile.skills || {};
    const rows = [
      el('div', { class: 'd3-doc ' + (s.cv_doc ? '' : 'miss') }, [el('div', { class: 'x' }, icon('doc', 15)), el('div', { style: 'flex:1;min-width:0' }, [el('b', { style: 'font-size:12.6px' }, 'CV / résumé'), el('div', { class: 'd3-mut', style: 'font-size:11.4px' }, s.cv_doc ? (s.cv_name || 'uploaded') + ' · ' + dShort(state.dd.profile.created_at) : 'No CV uploaded')]), s.cv_doc ? docBtn(s.cv_doc) : '']),
      el('div', { class: 'd3-doc ' + (s.id_doc ? 'ok' : 'miss') }, [el('div', { class: 'x' }, icon('shield', 15)), el('div', { style: 'flex:1;min-width:0' }, [el('b', { style: 'font-size:12.6px' }, 'Government ID'), el('div', { class: 'd3-mut', style: 'font-size:11.4px' }, s.id_doc ? 'On file' + (s.id_uploaded_at ? ' · sent ' + dShort(s.id_uploaded_at) + ' (after applying)' : '') : 'Not on file — identity and country unverified')]), s.id_doc ? docBtn(s.id_doc) : '']),
    ];
    if (full) rows.push(el('div', { class: 'd3-mut', style: 'font-size:11.8px;margin-top:10px;line-height:1.6' }, 'The Independent Dispatcher Service Agreement is exchanged by e-mail during the trial and is not tracked here yet.'));
    return card('Identity & documents', null, 'id', el('div', { class: 'd3-pad' }, rows), [], 'documents');
  }
  function signalsCard() {
    const dd = state.dd; const s = dd.profile.skills || {}; const k = state.kpi && !state.kpi.error ? state.kpi : null; const t = state.test || {}; const ig = t.integrity || {};
    const rows = [];
    const F = (ok, title, body, ic) => rows.push(el('div', { class: 'd3-flag' }, [el('span', { style: 'color:' + (ok === true ? 'var(--ok)' : ok === false ? 'var(--warn)' : 'var(--faint)') }, icon(ic || (ok === true ? 'check' : 'alert'), 15)), el('div', null, [el('b', null, title), el('div', { class: 'd3-mut' }, body)])]));
    if (k && Number(k.bookings)) {
      if (Number(k.below_min_share)) F(false, k.below_min_share + '% of loads booked under the floor', 'Every under-floor booking needs your written reason at approval.'); else F(true, 'Nothing booked under floor', 'Floor discipline holds across the window.');
      if (k.rc_turnaround_h != null && Number(k.rc_turnaround_h) > 4) F(false, 'RC turnaround ' + k.rc_turnaround_h + ' h', 'Target is same-hour attachment.', 'clock'); else if (k.rc_turnaround_h != null) F(true, 'RC turnaround ' + k.rc_turnaround_h + ' h', 'Inside the same-hour target.', 'clock');
    }
    if (ig && (Number(ig.pastes) > 0 || Number(ig.blur) > 5)) F(false, 'Test integrity: ' + (ig.pastes || 0) + ' pastes · ' + (ig.blur || 0) + ' tab leaves', 'Signals, not proof — the broker call is the real check.', 'eye');
    else if (t.state === 'scored' || t.state === 'submitted') F(true, 'Test integrity clean', (ig.pastes || 0) + ' pastes · ' + (ig.blur || 0) + ' tab leaves', 'eye');
    if (s.us_hours_overlap) F(true, 'US-hours overlap', (s.availability_hours || '—') + ' hrs/wk' + (s.timezone ? ' · ' + s.timezone : '')); else F(false, 'No US-hours overlap stated', 'Brokers work ET; confirm his working window before a trial.');
    const boards = (s.own_board_access || []).filter((b) => !/^no\b/i.test(String(b)));
    if (boards.length) F(true, 'Board access', boards.join(', ')); else F(false, 'No load-sourcing route on file', 'Owner rule 21 Sep 2026: the board need not be in their name. Any route counts — a board login (their own, an employer\u2019s or a carrier\u2019s), Facebook/WhatsApp freight groups, their own brokers or direct shippers. Ask how they find and book loads.');
    if (!s.id_doc) F(false, 'No government ID on file', 'Identity and country unverified.', 'id');
    return card('Signals & risk', 'Auto-detected from the test, the profile and the bookings', 'shield', el('div', { class: 'd3-pad', style: 'padding-top:4px' }, rows.length ? rows : el('div', { class: 'd3-empty' }, 'Nothing flagged.')));
  }
  const AICON = { booking: ['route', 'o'], event: ['activity', ''], message: ['chat', ''], assign: ['handshake', 'g'], test: ['clipboard', 'g'], mail: ['mail', 'g'], apply: ['user', 'm'], status: ['flag', ''], terms: ['dollar', ''], money: ['wallet', 'g'], signin: ['eye', 'm'] };
  function activityList(limit) {
    const rows = (state.activity || []).slice(0, limit || 1e9);
    if (!rows.length) return el('div', { class: 'd3-empty' }, 'No activity recorded yet.');
    return el('div', { class: 'd3-tl' }, rows.map((e) => { const m = AICON[e.kind] || ['dot', '']; return el('div', { class: 'e ' + m[1] }, [el('b', null, e.txt), el('span', null, [e.sub ? e.sub + ' · ' : '', et(e.at), e.ref_kind === 'load' && e.ref ? [' · ', el('a', { class: 'd3-lnk', href: '#/dispatcher?id=' + id + '&tab=loads&booking=' + e.ref, style: 'padding:1px 6px' }, 'load')] : ''])]); }));
  }
  function activityCard() {
    return card('Activity', 'Bookings, events, messages, test, money', 'activity', el('div', { class: 'd3-pad' }, [activityList(7), btn('Full timeline', () => go('timeline'), 'g', 'arrow', { style: 'width:100%;justify-content:center' })]), [pill('Live', 'green', 'dot')], 'timeline');
  }
  function noteCard() {
    const pp = state.dd.profile;
    return card('Last decision note', 'Never shown to the dispatcher · written when a status changes', 'lock', el('div', { class: 'd3-pad' }, [
      pp.review_note ? el('div', { style: 'border:1px solid var(--line);border-radius:11px;padding:10px 12px;font-size:12.4px;background:#fcfdff;white-space:pre-wrap' }, pp.review_note) : el('div', { class: 'd3-mut', style: 'font-size:12.3px' }, 'No note on file.'),
      pp.reviewed_at ? el('div', { class: 'd3-mut', style: 'font-size:11.4px;margin-top:6px' }, dShort(pp.reviewed_at)) : '']));
  }

  // ---- loads (bookings) — approve creates load + trip; every server guard surfaced as a flow
  async function previewRc(b) {
    let u; try { u = await signedDocumentUrl(b.rc_doc_path, 600); } catch (e) { toast(humanizeError(e)); return; }
    const isImg = /\.(png|jpe?g|webp)$/i.test(b.rc_doc_name || b.rc_doc_path || '');
    openDrawer('Rate confirmation — ' + (b.origin + ' → ' + b.destination), el('div', null, [
      el('div', { class: 'cc-sub', style: 'margin-bottom:8px' }, ['Check: carrier name + MC on the RC · rate ' + money(b.gross) + ' · pickup ' + et(b.pickup_at) + ' · broker ' + (b.broker || '') + (b.rc_number ? ' · RC # ' + b.rc_number : ''), ' ', el('a', { href: u, target: '_blank', rel: 'noopener' }, 'open in new tab ↗')]),
      isImg ? el('img', { src: u, style: 'max-width:100%;border-radius:8px;border:1px solid #e6edf5' }) : el('iframe', { src: u, style: 'width:100%;height:70vh;border:1px solid #e6edf5;border-radius:8px;background:#fff', title: 'Rate confirmation' }),
    ]), { subtitle: 'Signed link, 10 minutes' });
  }
  async function approveFlow(b, opts = {}) {
    if (!b.rc_doc_path) { toast('No rate confirmation attached — ask the dispatcher for the RC first.'); return false; }
    let note = opts.note || null;
    if (b.below_min && !note) { note = await askReason('Below the carrier’s floor — why approve?', { note: 'This load pays under the floor rate agreed with the carrier. The carrier sees this reason on the load.', placeholder: 'e.g. repositioning toward home, owner OK’d in the group at 9:40 ET' }); if (note === null) return false; }
    if (!opts.skipConfirm && !(await askConfirm('Approve ' + (b.origin + ' → ' + b.destination) + ' at ' + money(b.gross) + '?', { body: 'This creates the CC load + trip under ' + (b.carrier || 'the carrier') + '’s MC, registers the RC as a carrier document, tells the carrier and the dispatcher, and freezes the commission at today’s %. Did you read the RC?', confirmLabel: 'Yes — RC checked, approve' }))) return false;
    const r = await ccDispatcherBookingDecide(b.id, 'approve', note).catch((e) => ({ error: humanizeError(e) }));
    if (r && r.error) {
      if (/override/.test(r.error) && !(note || '').includes('override')) {
        if (await askConfirm('Truck already has a load in that window', { body: r.error, confirmLabel: 'Approve anyway (override)', danger: true })) return approveFlow(b, { note: (note ? note + ' — ' : '') + 'override', skipConfirm: true });
        return false;
      }
      toast(r.error); return false;
    }
    toast('✓ approved' + (r.trip ? ' · trip created' : '')); return true;
  }
  function loadsCard() {
    const BST = { pending_rc: ['awaiting RC', 'amber'], rc_received: ['RC in — approve?', 'orange'], approved: ['approved', 'green'], dispatched: ['dispatched', 'green'], picked_up: ['in transit', 'green'], delivered: ['delivered', 'green'], invoiced: ['invoiced', 'green'], paid: ['paid', 'green'], cancelled: ['cancelled', 'violet'], rejected: ['rejected', 'red'] };
    const filt = el('select', { class: 'd3-in', style: 'font-size:12px;padding:5px 9px' }, [['open', 'Open'], ['all', 'All'], ['rc_received', 'RC to approve'], ['moving', 'Moving'], ['done', 'Delivered / closed']].map(([v, l]) => el('option', { value: v, selected: v === (focusBooking ? 'all' : 'open') ? '' : undefined }, l)));
    const box = el('div');
    const reject = async (b) => { const note = await askReason('Why not? (the dispatcher sees this)'); if (note === null) return; const r = await ccDispatcherBookingDecide(b.id, 'reject', note).catch((e) => ({ error: humanizeError(e) })); if (r && r.error) { toast(r.error); return; } toast('✓ rejected'); rerender('bookings'); };
    const paintRows = () => {
      let rows = state.bookings || []; const v = filt.value; const OPEN = ['pending_rc', 'rc_received', 'approved', 'dispatched', 'picked_up'];
      rows = rows.filter((b) => v === 'all' || (v === 'open' ? OPEN.includes(b.status) : v === 'rc_received' ? b.status === 'rc_received' : v === 'moving' ? ['approved', 'dispatched', 'picked_up'].includes(b.status) : !OPEN.includes(b.status)));
      mount(box, rows.length ? rows.map((b) => {
        const rpm = b.miles > 0 ? (Number(b.gross) / Number(b.miles)).toFixed(2) : null; const hot = focusBooking === b.id; const m = BST[b.status] || [b.status, 'violet'];
        const node = el('div', { id: 'ccb-' + b.id, style: 'padding:12px 18px;border-top:1px solid var(--line2)' + (hot ? ';background:#fffbeb' : '') }, [
          el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [el('b', { style: 'flex:1;min-width:200px;font-size:13.4px' }, b.origin + ' → ' + b.destination), pill(m[0], m[1]), b.below_min ? pill('below floor', 'red', 'alert') : '', b.source === 'loadboot' ? pill('LoadBoot board', 'violet') : '', el('span', { class: 'd3-mono', style: 'font-weight:800' }, money(b.gross)), rpm ? el('span', { class: 'd3-mut d3-mono' }, '$' + rpm + '/mi') : '']),
          el('div', { class: 'd3-mut', style: 'font-size:12px;margin-top:3px' }, [b.carrier || '', b.truck ? ' · unit ' + b.truck : '', b.broker ? ' · ' + b.broker : '', b.broker_mc ? ' (MC ' + b.broker_mc + ')' : '', b.miles ? ' · ' + b.miles + ' mi' : '', b.pickup_at ? ' · PU ' + et(b.pickup_at) : '', b.delivery_at ? ' · DEL ' + et(b.delivery_at) : '', b.rc_number ? ' · RC ' + b.rc_number : '', b.commodity ? ' · ' + b.commodity : '', b.weight_lbs ? ' · ' + Number(b.weight_lbs).toLocaleString() + ' lb' : ''].join('')),
          b.notes ? el('div', { class: 'd3-mut', style: 'font-size:12px' }, b.notes) : '', b.decision_note ? el('div', { class: 'd3-mut', style: 'font-size:12px' }, 'Decision: ' + b.decision_note) : '', b.cancel_reason ? el('div', { style: 'font-size:12px;color:#b91c1c' }, 'Cancelled: ' + b.cancel_reason) : '',
          el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:8px' }, [
            b.rc_doc_path ? btn('View RC', () => previewRc(b), 'sm g', 'doc') : pill('No RC attached — cannot approve', 'amber', 'alert'),
            b.status === 'rc_received' ? btn('Approve → create trip', async () => { if (await approveFlow(b)) rerender('bookings'); }, 'sm p', 'check') : '',
            ['pending_rc', 'rc_received'].includes(b.status) ? btn('Reject', () => reject(b), 'sm danger', 'x') : '',
            b.trip_id ? el('a', { class: 'd3-lnk', href: '#/trips?id=' + encodeURIComponent(b.trip_id) }, [icon('ext', 12), 'trip']) : '', b.load_id ? el('a', { class: 'd3-lnk', href: '#/loads?id=' + encodeURIComponent(b.load_id) }, [icon('ext', 12), 'load']) : '',
            b.commission ? pill('commission ' + money(b.commission.amount) + ' · ' + b.commission.status, b.commission.status === 'paid' ? 'green' : 'amber') : '']),
        ]);
        if (hot) setTimeout(() => { try { node.scrollIntoView({ block: 'center' }); } catch (_) {} }, 80);
        return node;
      }) : el('div', { class: 'd3-empty' }, 'No bookings here.'));
    };
    filt.addEventListener('change', paintRows); paintRows();
    return card('Bookings logged by this dispatcher', 'Approve only from the rate confirmation. Approving creates the CC load + trip, registers the RC, freezes the commission % and tells both sides.', 'route', box, [filt], 'loads');
  }
  // ---- money
  function moneyCard() {
    const pp = state.dd.profile; const rows = state.comm || [];
    const tot = (st) => rows.filter((r) => r.status === st).reduce((a, r) => a + Number(r.amount || 0), 0);
    const approved = rows.filter((r) => r.status === 'approved');
    const payDialog = (lines) => {
      const total = lines.reduce((a, r) => a + Number(r.amount || 0), 0);
      const amt = el('input', { class: 'd3-in', type: 'number', step: '0.01', placeholder: 'amount sent', style: 'max-width:160px' });
      const cur = el('input', { class: 'd3-in', value: pp.currency || 'PKR', style: 'max-width:90px' });
      const fx = el('input', { class: 'd3-in', type: 'number', step: '0.0001', placeholder: 'FX rate (1 USD = ?)', style: 'max-width:170px' });
      const ref = el('input', { class: 'd3-in', placeholder: 'transfer id / receipt no. *', style: 'width:100%' });
      const method = el('select', { class: 'd3-in' }, [['wise', 'Wise'], ['payoneer', 'Payoneer'], ['bank', 'Bank transfer'], ['jazzcash', 'JazzCash / Easypaisa'], ['other', 'Other']].map(([v, l]) => el('option', { value: v }, l)));
      const note = el('input', { class: 'd3-in', placeholder: 'note (optional)', style: 'flex:1' });
      const err = el('div', { class: 'cc-sub', style: 'color:#dc2626;min-height:18px' });
      [amt, fx, cur].forEach((i) => i.addEventListener('input', () => { if (fx.value && !amt.value) amt.placeholder = (total * Number(fx.value)).toFixed(2); }));
      const goBtn = btn('Record payout', async () => {
        if (!ref.value.trim()) { err.textContent = 'Payout reference is required — it is what the dispatcher sees.'; return; }
        if (!(Number(amt.value) > 0) || !cur.value.trim()) { err.textContent = 'Enter the amount that actually left the account and its currency.'; return; }
        const r = await ccDispatcherCommissionPay(lines.map((l) => l.id), { paid_amount: Number(amt.value), paid_currency: cur.value.trim().toUpperCase(), fx_rate: fx.value ? Number(fx.value) : null, payout_ref: ref.value.trim(), payout_method: method.value, note: note.value.trim() || null }).catch((e) => ({ error: humanizeError(e) }));
        if (r && r.error) { err.textContent = r.error; return; }
        dr.close(); toast('✓ paid ' + r.paid + ' line' + (r.paid === 1 ? '' : 's') + ' · $' + Number(r.total_usd).toFixed(2)); rerender('comm');
      }, 'p', 'check');
      const dr = openDrawer('Pay commission — ' + money(total) + ' (' + lines.length + ' line' + (lines.length === 1 ? '' : 's') + ')', el('div', { class: 'cc-form' }, [
        el('div', { class: 'cc-sub', style: 'margin-bottom:8px' }, lines.map((l) => money(l.amount) + ' · ' + (l.lane || '')).join(' · ')),
        el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, [amt, cur, fx]), el('div', { style: 'margin-top:8px' }, ref), el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px' }, [method, note]), err,
        el('div', { style: 'display:flex;gap:8px;margin-top:12px' }, [goBtn, btn('Cancel', () => dr.close())]),
      ]), { subtitle: 'Recorded on every line and e-mailed to the dispatcher' });
    };
    const body = el('div', null, [
      el('div', { class: 'd3-pad d3-mini', style: 'grid-template-columns:repeat(3,1fr)' }, [['Pending', tot('draft'), 'delivered · approve once invoiced'], ['Approved · owed', tot('approved'), 'pay and record the reference'], ['Paid', tot('paid'), 'closed']].map(([l, v, s2]) => el('div', null, [el('b', null, money(v)), el('span', null, l), el('div', { class: 'd3-mut', style: 'font-size:11px;margin-top:2px' }, s2)]))),
      rows.length ? el('div', { class: 'd3-scroll' }, el('table', { class: 'd3-tbl' }, [el('thead', null, el('tr', null, [el('th', null, 'Load'), el('th', null, 'Basis'), el('th', null, 'Amount'), el('th', null, 'Status'), el('th', null, '')])),
        el('tbody', null, rows.map((r) => el('tr', null, [
          el('td', null, [el('b', null, r.lane || '—'), el('div', { class: 'd3-mut', style: 'font-size:11.5px' }, dShort(r.created_at) + (r.note ? ' · ' + r.note : ''))]),
          el('td', { class: 'd3-mut d3-mono' }, r.pct + '% of ' + money(r.gross)),
          el('td', { class: 'd3-mono' }, [el('b', null, money(r.amount)), r.paid_at ? el('div', { class: 'd3-mut', style: 'font-size:11.5px' }, 'paid ' + dShort(r.paid_at) + (r.paid_amount != null ? ' · ' + Number(r.paid_amount).toLocaleString() + ' ' + (r.paid_currency || '') : '') + (r.fx_rate ? ' @ ' + r.fx_rate : '') + (r.payout_ref ? ' · ref ' + r.payout_ref : '')) : '']),
          el('td', null, pill(r.status === 'draft' ? 'pending' : r.status, r.status === 'paid' ? 'green' : r.status === 'approved' ? 'amber' : r.status === 'void' ? 'red' : 'violet')),
          el('td', null, el('div', { style: 'display:flex;gap:6px;justify-content:flex-end' }, [
            r.status === 'draft' ? btn('Approve', async () => { if (!(await askConfirm('Approve this commission?', { body: 'Approve once the broker has been invoiced for the load. The dispatcher is notified.' }))) return; const q = await ccDispatcherCommissionStatus(r.id, 'approved').catch((e) => ({ error: humanizeError(e) })); if (q && q.error) { toast(q.error); return; } toast('✓ approved'); rerender('comm'); }, 'sm', 'check') : '',
            r.status === 'approved' ? btn('Pay', () => payDialog([r]), 'sm p', 'wallet') : '',
            ['draft', 'approved'].includes(r.status) ? btn('Void', async () => { const why = await askReason('Void this commission line — why?'); if (why === null) return; const q = await ccDispatcherCommissionStatus(r.id, 'void', why).catch((e) => ({ error: humanizeError(e) })); if (q && q.error) { toast(q.error); return; } toast('voided'); rerender('comm'); }, 'sm danger', 'x') : ''])),
        ])))])) : el('div', { class: 'd3-empty' }, 'No commission lines yet — they appear when a booking is marked Delivered.'),
    ]);
    return card('Per-load commission ledger', 'Pending (delivered) → Approve (broker invoiced) → Pay (records what left the account). Paid lines cannot be changed.', 'wallet', body, [approved.length ? btn('Pay all approved · ' + money(tot('approved')), () => payDialog(approved), 'sm p', 'wallet') : ''], 'money');
  }
  // ---- messages (3-way threads)
  function messagesCard() {
    const live = (state.dd.assignments || []).filter((a) => a.status !== 'ended');
    if (!live.length) return card('Shared thread', 'Dispatcher · carrier · LoadBoot', 'chat', el('div', { class: 'd3-empty' }, 'No assignment, so no thread yet.'));
    const wrap = el('div', { class: 'd3-pad', style: 'display:flex;flex-direction:column;gap:16px' });
    live.forEach((a) => {
      const list = el('div', { class: 'd3-msgs' }, el('span', { class: 'd3-mut' }, 'Loading…'));
      const inp = el('input', { class: 'd3-in', style: 'flex:1', placeholder: 'Message dispatcher + carrier… (both see it; urgent words e-mail them)' });
      const send = btn('Send', async () => { if (!inp.value.trim()) return; const r = await dispatcherThreadSend(a.id, inp.value).catch((e) => ({ error: humanizeError(e) })); if (r && r.error) { toast(r.error); return; } inp.value = ''; paintT(); }, 'p', 'send');
      inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') send.click(); });
      async function paintT() {
        try { const r = await dispatcherThreadList(a.id, 100); const ms = (r && r.messages) || []; const P = (r && r.participants) || {};
          mount(list, [el('div', { class: 'd3-mut', style: 'margin-bottom:4px;font-size:11.5px' }, 'Participants: ' + [P.dispatcher, P.carrier, 'LoadBoot'].filter(Boolean).join(' · ')), ...(ms.length ? ms.map((m) => el('div', { class: 'd3-msg' + (m.role === 'system' ? ' sys' : '') }, [el('span', { class: 'd3-mut' }, (m.role === 'system' ? 'system' : (m.by || m.role)) + ' · ' + et(m.at) + ' — '), m.body])) : [el('span', { class: 'd3-mut' }, 'No messages yet.')])]);
          list.scrollTop = list.scrollHeight; dispatcherThreadMarkRead(a.id).catch(() => {});
        } catch (e) { mount(list, el('span', { class: 'd3-mut' }, humanizeError(e))); }
      }
      paintT();
      wrap.appendChild(el('div', null, [el('div', { style: 'font-weight:800;display:flex;gap:8px;align-items:center;margin-bottom:6px' }, [el('div', { class: 'd3-cc', style: 'padding:0;border:0;width:26px;height:26px;border-radius:8px;background:' + hue(a.carrier_org_id) + ';color:#fff;display:grid;place-items:center;font-size:10px' }, initials(a.carrier)), a.carrier || 'carrier', a.status === 'paused' ? pill('paused', 'amber') : '', a.unread ? pill(a.unread + ' unread', 'orange') : '']), list, el('div', { style: 'display:flex;gap:6px;margin-top:8px' }, [inp, send])]));
    });
    return card('Shared thread', 'Dispatcher · carrier · LoadBoot — both sides see everything you write here', 'chat', wrap, [], 'messages');
  }
  function applicationCard() {
    const pp = state.dd.profile; const s = pp.skills || {};
    const kv = (k2, v) => el('div', { style: 'display:grid;grid-template-columns:150px 1fr;gap:10px;padding:6px 0;border-top:1px solid var(--line2);font-size:12.6px' }, [el('span', { class: 'd3-mut', style: 'font-weight:600' }, k2), el('span', null, v == null || v === '' ? '—' : String(v))]);
    return card('Application & screening', 'What the candidate told us', 'user', el('div', { class: 'd3-pad', style: 'padding-top:4px' }, [
      kv('English', pp.english_level), kv('Experience', (pp.years_exp || 0) + ' yrs · trucks handled: ' + (s.trucks_handled || '—')),
      kv('Availability', (s.availability_hours || '—') + ' hrs/wk · ' + (s.timezone || '') + (s.us_hours_overlap ? ' · US-hours overlap' : ' · no US-hours overlap stated')),
      kv('Can source loads', s.can_source_loads === 'yes_independent' ? 'Yes — independently' : s.can_source_loads === 'yes_with_board' ? 'Yes — needs board access' : s.can_source_loads === 'learning' ? 'Not yet — learning' : '—'),
      kv('Load boards', (pp.load_boards || []).join(', ')), kv('Board access', (s.own_board_access || []).join(', ') || 'none stated \u2014 ask how they source loads (any route counts)'),
      kv('Freight network', s.network_desc), kv('Equipment', (s.equipment || []).join(', ')),
      kv('Skills', 'negotiation ' + (s.negotiation || '—') + ' · FMCSA/HOS ' + (s.fmcsa_hos || '—') + ' · geography ' + (s.us_geography || '—')),
      kv('Tools', s.tools), kv('Payout pref', s.payout_pref), kv('LinkedIn', s.linkedin), kv('References', (pp.refs || []).join('  |  ')), s.note ? kv('Why hire', s.note) : '',
    ]));
  }

  // ---- compose
  function body() {
    const left = []; const right = [];
    if (tab === 'overview') { left.push(nbaCard(), readinessCard(), carriersCard(false), scorecardCard(false)); right.push(termsCard(), documentsCard(false), signalsCard(), activityCard(), noteCard()); }
    else if (tab === 'test') { const h = el('div'); renderTestPanel(h, { userId: id, name: state.dd.profile.full_name, onChange: () => rerender('test') }); left.push(h); right.push(signalsCard(), applicationCard()); }
    else if (tab === 'carriers') { left.push(carriersCard(true)); right.push(termsCard(), signalsCard(), activityCard()); }
    else if (tab === 'performance') { left.push(scorecardCard(true), readinessCard()); right.push(termsCard(), signalsCard()); }
    else if (tab === 'loads') { left.push(loadsCard()); right.push(carriersCard(false), termsCard()); }
    else if (tab === 'money') { left.push(moneyCard()); right.push(termsCard(), activityCard()); }
    else if (tab === 'messages') { left.push(messagesCard()); right.push(carriersCard(false), activityCard()); }
    else if (tab === 'timeline') { left.push(card('Timeline', 'Everything the system recorded, newest first', 'activity', el('div', { class: 'd3-pad' }, activityList()), [], 'timeline')); right.push(termsCard(), noteCard()); }
    else if (tab === 'documents') { left.push(documentsCard(true), applicationCard()); right.push(signalsCard(), noteCard()); }
    return el('div', { class: 'd3-body' }, el('div', { class: 'd3-grid' }, [el('div', { class: 'd3-col' }, left), el('div', { class: 'd3-col' }, right)]));
  }
  function top() {
    const pp = state.dd.profile;
    const href = '#/dispatcher?id=' + id + '&tab=' + tab;
    return el('div', { class: 'd3-top' }, [
      el('div', { class: 'd3-crumb' }, [icon('users', 15), el('a', { href: '#/dispatchers' }, 'Dispatchers'), icon('chev', 13), el('a', { href: '#/dispatchers' }, 'Roster'), icon('chev', 13), el('b', null, pp.full_name || '—')]),
      el('div', { class: 'd3-url', onClick: () => { try { navigator.clipboard.writeText(location.origin + location.pathname + href); toast('Link copied'); } catch (_) {} } }, [icon('link', 12), 'command-center/', el('em', null, href), icon('copy', 12)]),
      el('div', { class: 'sp' }, [el('a', { class: 'd3-btn sm g', href: '#/dispatchers' }, [icon('back', 14), 'Roster', kbd('Esc')])]),
    ]);
  }
  function paint() {
    mount(root, [top(), hero(), tabs(), body(), el('div', { class: 'd3-mnav' }, [btn('Message', () => go('messages'), '', 'chat'), btn('Test', () => go('test'), '', 'clipboard'), primaryAction() || btn('Overview', () => go('overview'), 'o', 'grid')])]);
  }
  paint();

  // keyboard: ← → switch tabs, Esc back to the roster (ignored while typing)
  const onKey = (e) => {
    if (!document.body.contains(root)) { document.removeEventListener('keydown', onKey); return; }
    const tag = (e.target && e.target.tagName) || ''; if (/INPUT|TEXTAREA|SELECT/.test(tag) || e.metaKey || e.ctrlKey) return;
    if (document.getElementById('cc-drawer-root')) return;
    const i = TABS.findIndex((t) => t[0] === tab);
    if (e.key === 'ArrowRight' && i < TABS.length - 1) go(TABS[i + 1][0]);
    else if (e.key === 'ArrowLeft' && i > 0) go(TABS[i - 1][0]);
    else if (e.key === 'Escape') location.hash = '#/dispatchers';
  };
  document.addEventListener('keydown', onKey);
}

export default { renderDispatcher360 };
