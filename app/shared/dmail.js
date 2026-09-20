// dmail.js — Dispatcher Mailbox UI (bl_dmail_0356). A Gmail-standard inbox for the ONE mailbox LoadBoot staff
// assigned to this dispatcher. No login here: the mailbox password lives in Supabase Vault and only the `dmail`
// edge function ever reads it. The same module is the staff oversight view in the Command Center (opts.accountId).
//
// TWO RULES:
//   1. INBOUND HTML IS HOSTILE. It is never parsed into this document. It renders in a sandboxed iframe with
//      NO allow-scripts (nothing in it can ever run), a CSP that blocks every remote fetch until the reader
//      asks for images, and <script>/<meta>/<base>/<link>/<iframe>/<object>/<form> stripped first. allow-same-origin
//      is set ONLY so this page can measure the frame's height — with scripts off the content cannot use it.
//   2. OUTGOING HTML IS REBUILT from an allow-list (cleanHtml) — pasted junk never leaves the building.
//      The signature is added by the SERVER from the account record; the dispatcher sees it but cannot edit it.
import { el as h, mount, clear } from './ui/dom.js';
// api.js is imported lazily (boot) so the preview harness can inject a mock without loading the Supabase client.

const IC = {
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13l3.5 7v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/>',
  star: '<polygon points="12 2 15.1 8.3 22 9.3 17 14.1 18.2 21 12 17.8 5.8 21 7 14.1 2 9.3 8.9 8.3"/>',
  send: '<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>',
  draft: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  spam: '<path d="M7.9 2h8.2L22 7.9v8.2L16.1 22H7.9L2 16.1V7.9z"/><path d="M12 8v4M12 16h.01"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
  back: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
  reply: '<path d="m9 14-5-5 5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v4"/>',
  replyall: '<path d="m7 14-5-5 5-5"/><path d="m12 14-5-5 5-5"/><path d="M7 9h8a6 6 0 0 1 6 6v4"/>',
  forward: '<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0-6 6v4"/>',
  clip: '<path d="m21.4 11.1-9.2 9.2a6 6 0 0 1-8.5-8.5l9.2-9.2a4 4 0 0 1 5.7 5.7l-9.2 9.2a2 2 0 0 1-2.8-2.8l8.5-8.5"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>', min: '<path d="M5 19h14"/>', max: '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>',
  mailopen: '<path d="M21.2 8.4A2 2 0 0 1 22 10v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V10a2 2 0 0 1 .8-1.6l8-6a2 2 0 0 1 2.4 0z"/><path d="m22 10-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 10"/>',
  mail: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>',
  restore: '<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  img: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
  bold: '<path d="M6 4h8a4 4 0 0 1 0 8H6zM6 12h9a4 4 0 0 1 0 8H6z"/>', italic: '<path d="M19 4h-9M14 20H5M15 4 9 20"/>',
  under: '<path d="M6 4v6a6 6 0 0 0 12 0V4M4 21h16"/>', ul: '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  ol: '<path d="M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.700 1.700"/><path d="M14 11a5 5 0 0 0-7.500-.5l-3 3a5 5 0 0 0 7 7l1.700-1.700"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.700 3h17a2 2 0 0 0 1.700-3L13.700 3.900a2 2 0 0 0-3.400 0z"/><path d="M12 9v4M12 17h.01"/>',
};
const ic = (n, s = 18, fill) => h('span', { class: 'dm-ic', 'aria-hidden': 'true', html: '<svg xmlns="http://www.w3.org/2000/svg" width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="' + (fill || 'none') + '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + (IC[n] || '') + '</svg>' });

const CSS = `
.dm{--bg:#0b1626;--panel:#0f1e33;--panel2:#13263f;--line:rgba(255,255,255,.08);--ink:#eaf1fb;--ink2:#9db0c9;--ink3:#6f84a1;--blue:#0883F7;--orange:#FC5305;--navy:#10223B;
  position:relative;display:grid;grid-template-columns:232px minmax(0,1fr);gap:14px;min-height:72vh;color:var(--ink);font-size:.92rem;-webkit-font-smoothing:antialiased}
.dm *{box-sizing:border-box}.dm-ic{display:inline-flex;flex:0 0 auto}.dm button{font:inherit;color:inherit;cursor:pointer;-webkit-tap-highlight-color:transparent}
.dm-rail{display:flex;flex-direction:column;gap:4px;padding:4px 0}
.dm-compose{display:flex;align-items:center;gap:10px;justify-content:center;border:0;border-radius:16px;padding:14px 18px;margin:0 0 12px;font-weight:800;color:#fff;background:linear-gradient(135deg,#0883F7,#0a6fd6);box-shadow:0 14px 28px -14px rgba(8,131,247,.75);transition:transform .12s,box-shadow .12s}
.dm-compose:hover{transform:translateY(-1px);box-shadow:0 18px 32px -14px rgba(8,131,247,.9)}
.dm-f{display:flex;align-items:center;gap:12px;border:0;background:transparent;border-radius:999px;padding:9px 14px;color:var(--ink2);font-weight:700;text-align:left;transition:background .12s}
.dm-f:hover{background:rgba(255,255,255,.05);color:var(--ink)}.dm-f.on{background:rgba(8,131,247,.16);color:#fff}
.dm-f .n{margin-left:auto;font-size:.76rem;font-weight:800;color:var(--ink)}.dm-f.on .n{color:#fff}
.dm-who{margin-top:auto;padding:12px 14px;border:1px solid var(--line);border-radius:14px;background:var(--panel);font-size:.78rem;color:var(--ink3);overflow:hidden}
.dm-who b{display:block;color:var(--ink);font-size:.84rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dm-who .s{display:flex;align-items:center;gap:6px;margin-top:6px}.dm-dot{width:7px;height:7px;border-radius:50%;background:#22c55e;box-shadow:0 0 0 3px rgba(34,197,94,.16)}.dm-dot.bad{background:#f59e0b;box-shadow:0 0 0 3px rgba(245,158,11,.16)}
.dm-main{min-width:0;display:flex;flex-direction:column;border:1px solid var(--line);border-radius:18px;background:var(--panel);overflow:hidden}
.dm-top{display:flex;align-items:center;gap:10px;padding:12px 14px;border-bottom:1px solid var(--line);background:linear-gradient(180deg,rgba(255,255,255,.03),transparent)}
.dm-search{flex:1;display:flex;align-items:center;gap:10px;background:var(--bg);border:1px solid var(--line);border-radius:999px;padding:9px 16px;color:var(--ink3);transition:border-color .12s,box-shadow .12s}
.dm-search:focus-within{border-color:rgba(8,131,247,.6);box-shadow:0 0 0 3px rgba(8,131,247,.15)}
.dm-search input{flex:1;min-width:0;border:0;outline:0;background:transparent;color:var(--ink);font:inherit}.dm-search input::placeholder{color:var(--ink3)}
.dm-ib{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border:0;border-radius:50%;background:transparent;color:var(--ink2);transition:background .12s,color .12s}
.dm-ib:hover{background:rgba(255,255,255,.08);color:#fff}.dm-ib:disabled{opacity:.4;cursor:default}.dm-ib.spin .dm-ic{animation:dmspin .8s linear infinite}@keyframes dmspin{to{transform:rotate(360deg)}}
.dm-bar{display:flex;align-items:center;gap:4px;padding:6px 10px;border-bottom:1px solid var(--line);min-height:48px;color:var(--ink3);font-size:.8rem}
.dm-bar .sp{flex:1}.dm-chk{width:18px;height:18px;accent-color:#0883F7;cursor:pointer;margin:0 9px}
.dm-list{flex:1;overflow:auto}.dm-row{position:relative;display:grid;grid-template-columns:auto auto minmax(120px,210px) minmax(0,1fr) auto;align-items:center;gap:6px;padding:0 14px 0 6px;min-height:46px;border-bottom:1px solid rgba(255,255,255,.045);cursor:pointer;color:var(--ink2);transition:background .1s,box-shadow .1s}
.dm-row:hover{background:rgba(255,255,255,.035);box-shadow:inset 3px 0 0 var(--blue)}.dm-row.un{background:rgba(8,131,247,.06);color:var(--ink)}.dm-row.un .who,.dm-row.un .sub{font-weight:800;color:#fff}.dm-row.sel{background:rgba(8,131,247,.16)}
.dm-row .who{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dm-row .who i{font-style:normal;color:var(--ink3);font-weight:600;font-size:.8rem;margin-left:5px}.dm-row .who .dr{color:var(--orange);font-weight:800}
.dm-row .txt{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}.dm-row .txt .sn{color:var(--ink3);font-weight:500}
.dm-row .meta{display:flex;align-items:center;gap:8px;font-size:.78rem;color:var(--ink3);white-space:nowrap}.dm-row.un .meta{color:#fff;font-weight:800}
.dm-row .acts{display:none;gap:0}.dm-row:hover .acts{display:flex}.dm-row:hover .meta .d{display:none}
.dm-starb{border:0;background:transparent;padding:6px;color:var(--ink3);display:inline-flex;border-radius:50%}.dm-starb:hover{background:rgba(255,255,255,.08)}.dm-starb.on{color:#fbbf24}
.dm-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:70px 20px;color:var(--ink3);text-align:center}.dm-empty .big{width:64px;height:64px;border-radius:20px;display:flex;align-items:center;justify-content:center;background:rgba(8,131,247,.12);color:#5fb0ff}.dm-empty b{color:var(--ink);font-size:1.02rem}
.dm-sk{height:46px;border-bottom:1px solid rgba(255,255,255,.045);background:linear-gradient(90deg,transparent,rgba(255,255,255,.04),transparent);background-size:200% 100%;animation:dmsk 1.2s infinite}@keyframes dmsk{to{background-position:-200% 0}}
.dm-more{display:block;margin:14px auto;border:1px solid var(--line);background:transparent;border-radius:999px;padding:8px 18px;color:var(--ink2);font-weight:700}.dm-more:hover{background:rgba(255,255,255,.05)}
.dm-banner{display:flex;align-items:center;gap:10px;padding:9px 14px;font-size:.82rem;background:rgba(245,158,11,.1);color:#fcd34d;border-bottom:1px solid rgba(245,158,11,.2)}.dm-banner.info{background:rgba(8,131,247,.1);color:#9ccbff;border-color:rgba(8,131,247,.2)}
.dm-thread{flex:1;overflow:auto;padding:6px 22px 28px}.dm-subj{font-size:1.32rem;font-weight:800;margin:14px 0 14px 50px;line-height:1.3;color:#fff;overflow-wrap:anywhere}
.dm-msg{border:1px solid var(--line);border-radius:16px;background:var(--panel2);margin-bottom:10px;overflow:hidden}
.dm-mh{display:flex;align-items:center;gap:12px;padding:12px 14px;cursor:pointer}.dm-av{width:38px;height:38px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;color:#fff;flex:0 0 auto;font-size:.95rem}
.dm-mh .nm{font-weight:800;color:#fff}.dm-mh .em{color:var(--ink3);font-size:.8rem;font-weight:500;margin-left:6px}.dm-mh .to{color:var(--ink3);font-size:.79rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dm-mh .mid{flex:1;min-width:0}.dm-mh .dt{color:var(--ink3);font-size:.78rem;white-space:nowrap}
.dm-mb{padding:0 14px 14px 64px}.dm-frame{width:100%;border:0;border-radius:12px;background:#fff;display:block;min-height:60px}
.dm-plain{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;margin:0;color:var(--ink);line-height:1.6}
.dm-imgbar{display:flex;align-items:center;flex-wrap:wrap;gap:10px;font-size:.84rem;color:#cfe0f5;margin:0 0 10px;padding:9px 12px;border-radius:12px;background:rgba(8,131,247,.12);border:1px solid rgba(8,131,247,.35)}.dm-imgbar .dm-link{margin-left:auto;border:0;border-radius:999px;padding:6px 14px;background:#0883F7;color:#fff;font-weight:800;text-decoration:none}.dm-link{border:0;background:transparent;color:#5fb0ff;font-weight:700;padding:0}.dm-link:hover{text-decoration:underline}
.dm-atts{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.dm-att{display:flex;align-items:center;gap:9px;border:1px solid var(--line);background:var(--bg);border-radius:12px;padding:8px 12px;max-width:260px;color:var(--ink)}
.dm-att:hover{border-color:rgba(8,131,247,.6)}.dm-att .an{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:700;font-size:.82rem}.dm-att .as{color:var(--ink3);font-size:.74rem}
.dm-rbtns{display:flex;gap:10px;margin:16px 0 0 50px;flex-wrap:wrap}.dm-btn{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line);background:transparent;border-radius:999px;padding:9px 20px;font-weight:700;color:var(--ink2)}
.dm-btn:hover{background:rgba(255,255,255,.06);color:#fff}.dm-btn.pri{border:0;color:#fff;background:linear-gradient(135deg,#0883F7,#0a6fd6);box-shadow:0 10px 22px -12px rgba(8,131,247,.8)}.dm-btn.pri:disabled{opacity:.55;cursor:default}
.dm-draftcard{display:flex;align-items:center;gap:10px;border:1px dashed rgba(252,83,5,.5);border-radius:14px;padding:12px 14px;margin-bottom:10px;color:var(--ink2);cursor:pointer}.dm-draftcard b{color:var(--orange)}
.dm-cw{position:fixed;right:26px;bottom:0;z-index:4000;width:min(580px,calc(100vw - 32px));display:flex;flex-direction:column;max-height:min(640px,calc(100vh - 40px));background:#0f1e33;border:1px solid rgba(255,255,255,.12);border-bottom:0;border-radius:16px 16px 0 0;box-shadow:0 -10px 60px -10px rgba(0,0,0,.7);color:#eaf1fb;font-size:.92rem;animation:dmup .18s ease-out}
@keyframes dmup{from{transform:translateY(24px);opacity:0}}.dm-cw.full{inset:4vh 6vw;width:auto;max-height:none;border-radius:16px;border-bottom:1px solid rgba(255,255,255,.12)}.dm-cw.mini{max-height:46px;width:300px}.dm-cw.mini .dm-cbody{display:none}
.dm-ch{display:flex;align-items:center;gap:4px;padding:8px 8px 8px 16px;background:#10223B;border-radius:16px 16px 0 0;font-weight:800;cursor:pointer;flex:0 0 auto}.dm-ch .t{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dm-ch .dm-ib{width:30px;height:30px}
.dm-cbody{display:flex;flex-direction:column;min-height:0;flex:1}.dm-fl{display:flex;align-items:flex-start;gap:8px;padding:7px 16px;border-bottom:1px solid rgba(255,255,255,.07);color:#6f84a1;position:relative}
.dm-fl>label{padding-top:5px;font-size:.84rem;flex:0 0 auto}.dm-chips{flex:1;display:flex;flex-wrap:wrap;gap:5px;min-width:0}.dm-chips input,.dm-fl>input{flex:1;min-width:120px;border:0;outline:0;background:transparent;color:#eaf1fb;font:inherit;padding:5px 0}
.dm-chip{display:inline-flex;align-items:center;gap:5px;background:rgba(8,131,247,.16);border:1px solid rgba(8,131,247,.35);color:#d6e9ff;border-radius:999px;padding:2px 4px 2px 10px;font-size:.82rem;max-width:100%}.dm-chip.bad{background:rgba(239,68,68,.15);border-color:rgba(239,68,68,.5);color:#fecaca}
.dm-chip span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dm-chip button{border:0;background:transparent;display:inline-flex;padding:2px;border-radius:50%;color:inherit}.dm-chip button:hover{background:rgba(255,255,255,.15)}
.dm-sug{position:absolute;left:50px;right:16px;top:100%;z-index:5;background:#13263f;border:1px solid rgba(255,255,255,.12);border-radius:12px;overflow:hidden;box-shadow:0 18px 40px -12px rgba(0,0,0,.7)}.dm-sug button{display:block;width:100%;text-align:left;border:0;background:transparent;padding:9px 14px;color:#eaf1fb}.dm-sug button:hover,.dm-sug button.on{background:rgba(8,131,247,.2)}.dm-sug small{color:#6f84a1;margin-left:8px}
.dm-ed{flex:1;min-height:150px;overflow:auto;padding:14px 16px;outline:0;line-height:1.55;color:#eaf1fb;overflow-wrap:anywhere}.dm-ed:empty:before{content:attr(data-ph);color:#6f84a1}.dm-ed a{color:#5fb0ff}.dm-ed blockquote{border-left:3px solid rgba(255,255,255,.2);margin:6px 0;padding-left:12px;color:#9db0c9}
.dm-sig{margin:0 16px 8px;padding:10px 12px;border:1px dashed rgba(255,255,255,.14);border-radius:12px;font-size:.84rem;color:#9db0c9;max-height:170px;overflow:auto;position:relative;flex:0 0 auto}.dm-sig .lk{display:flex;align-items:center;gap:6px;font-size:.7rem;text-transform:uppercase;letter-spacing:.06em;color:#6f84a1;margin-bottom:4px}.dm-sig a{color:#5fb0ff}
.dm-q{margin:0 16px 8px}.dm-q .qb{max-height:130px;overflow:auto;border-left:3px solid rgba(255,255,255,.18);padding:4px 0 4px 12px;color:#6f84a1;font-size:.82rem;white-space:pre-wrap;margin-top:6px}
.dm-cf{display:flex;align-items:center;gap:6px;padding:10px 12px;border-top:1px solid rgba(255,255,255,.07);flex:0 0 auto}.dm-cf .sv{margin-left:auto;font-size:.76rem;color:#6f84a1}
.dm-tb{display:flex;gap:0;margin-left:6px}.dm-tb .dm-ib{width:32px;height:32px}
.dm-toast{position:fixed;left:24px;bottom:24px;z-index:5000;display:flex;align-items:center;gap:14px;background:#1b2f4d;color:#fff;border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:12px 16px;box-shadow:0 18px 50px -12px rgba(0,0,0,.8);font-weight:600;animation:dmup .18s ease-out}.dm-toast button{border:0;background:transparent;color:#5fb0ff;font-weight:800}
.dm-off{grid-column:1/-1}
@media(max-width:860px){.dm{grid-template-columns:1fr;gap:10px;min-height:0}.dm-rail{flex-direction:row;overflow-x:auto;padding:2px 0 6px;scrollbar-width:none}.dm-rail::-webkit-scrollbar{display:none}.dm-f{flex:0 0 auto;border:1px solid var(--line);padding:8px 14px;gap:8px}.dm-f .n{margin-left:4px}
 .dm-compose{position:fixed;right:18px;bottom:calc(84px + env(safe-area-inset-bottom));z-index:3000;margin:0;border-radius:18px;padding:15px 20px}.dm-who{display:none}
 .dm-row{grid-template-columns:auto minmax(0,1fr) auto;grid-template-areas:"star who meta" "star txt txt";padding:9px 12px 9px 4px;row-gap:2px}.dm-row .dm-chk{display:none}.dm-row .dm-starb{grid-area:star}.dm-row .who{grid-area:who}.dm-row .txt{grid-area:txt}.dm-row .meta{grid-area:meta}.dm-row:hover .acts{display:none}.dm-row:hover .meta .d{display:inline}
 .dm-thread{padding:4px 10px 90px}.dm-subj{margin-left:4px;font-size:1.12rem}.dm-mb{padding:0 12px 12px}.dm-rbtns{margin-left:0}.dm-mh .em{display:none}
 .dm-cw,.dm-cw.full{inset:0;width:auto;max-height:none;border-radius:0;border:0}.dm-cw.mini{inset:auto 0 0 0;width:auto}.dm-ch{border-radius:0}.dm-toast{left:12px;right:12px;bottom:calc(84px + env(safe-area-inset-bottom))}}
/* ---- premium pass (bl_dmail_0357): app-like panel, date groups, glass bars, mobile = native-mail feel ---- */
.dm-main{height:calc(100vh - 190px);min-height:540px;background:linear-gradient(180deg,#11223b,#0d1b30);box-shadow:0 24px 60px -30px rgba(0,0,0,.7),inset 0 1px 0 rgba(255,255,255,.04)}
.dm-top{position:sticky;top:0;z-index:3;backdrop-filter:saturate(1.4) blur(14px);-webkit-backdrop-filter:saturate(1.4) blur(14px)}
.dm-list,.dm-thread{scrollbar-width:thin;scrollbar-color:rgba(255,255,255,.16) transparent}.dm-list::-webkit-scrollbar,.dm-thread::-webkit-scrollbar{width:8px}.dm-list::-webkit-scrollbar-thumb,.dm-thread::-webkit-scrollbar-thumb{background:rgba(255,255,255,.14);border-radius:8px}
.dm-grp{padding:14px 18px 6px;font-size:.7rem;font-weight:800;letter-spacing:.09em;text-transform:uppercase;color:var(--ink3)}
.dm-row{animation:dmfade .22s ease-out both}@keyframes dmfade{from{opacity:0;transform:translateY(3px)}}
.dm-row.un{box-shadow:inset 3px 0 0 var(--orange)}.dm-row.un:hover{box-shadow:inset 3px 0 0 var(--orange)}
.dm-rav{display:none}.dm-msg{box-shadow:0 10px 30px -18px rgba(0,0,0,.6)}.dm-ch .mob-send{display:none}
.dm-ib:active,.dm-btn:active,.dm-f:active,.dm-compose:active{transform:scale(.96)}
.dm-who{background:linear-gradient(160deg,rgba(8,131,247,.12),rgba(255,255,255,.02))}
@media(max-width:860px){
 .dm-main{height:auto;min-height:60vh;border-radius:20px}.dm.reading .dm-rail,.dm.reading .dm-top{display:none}
 .dm-rail{position:sticky;top:0;z-index:4;background:linear-gradient(180deg,#0b1626 70%,transparent);margin:0 -2px;padding:4px 2px 10px}
 .dm-f{min-height:40px;background:rgba(255,255,255,.04)}.dm-f.on{background:linear-gradient(135deg,#0883F7,#0a6fd6);border-color:transparent;box-shadow:0 8px 18px -10px rgba(8,131,247,.8)}
 .dm-search{padding:11px 16px}.dm-bar{min-height:42px}.dm-bar .dm-chk{display:none}.dm-grp{padding:14px 14px 4px}
 .dm-row{grid-template-columns:44px minmax(0,1fr) auto;grid-template-areas:"av who meta" "av txt star";padding:11px 12px;min-height:68px;column-gap:10px;row-gap:3px;font-size:.93rem}
 .dm-rav{display:flex;grid-area:av;width:42px;height:42px;border-radius:50%;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:1rem;align-self:center}
 .dm-row .dm-starb{grid-area:star;justify-self:end;padding:2px}.dm-row .txt{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;line-height:1.35}
 .dm-row .txt .sub{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dm-row .txt .sn{font-size:.85rem}
 .dm-thread{padding:4px 8px 16px}.dm-msg{border-radius:18px}.dm-mh{padding:12px}.dm-mh .dm-ib{display:none}.dm-frame{border-radius:14px}
 .dm-rbtns{position:sticky;bottom:0;margin:12px -8px -16px;padding:10px 12px calc(10px + env(safe-area-inset-bottom));background:rgba(11,22,38,.86);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-top:1px solid var(--line);flex-wrap:nowrap;z-index:2}
 .dm-rbtns .dm-btn{flex:1;justify-content:center;padding:12px 8px;border-radius:14px;background:rgba(255,255,255,.05)}
 .dm-cw,.dm-cw.full{padding-top:env(safe-area-inset-top)}.dm-ch{padding:10px 8px 10px 16px;cursor:default}.dm-ch .desk{display:none}.dm-ch .mob-send{display:inline-flex;width:40px;height:40px;color:#fff;background:linear-gradient(135deg,#0883F7,#0a6fd6);margin-right:4px}.dm-ch .dm-ib{width:40px;height:40px}
 .dm-ed{font-size:1rem;min-height:34vh}.dm-cf{padding-bottom:calc(10px + env(safe-area-inset-bottom))}.dm-cf .dm-btn.pri{display:none}.dm-tb .dm-ib{width:38px;height:38px}
 .dm-fl input,.dm-chips input{font-size:16px}.dm-search input{font-size:16px}
}
/* phone pill (dialer.js .lbd) is fixed bottom-right: keep the compose Send bar clear of it */
body:has(.lbd) .dm-cw:not(.mini){bottom:calc(84px + env(safe-area-inset-bottom));border-bottom:1px solid rgba(255,255,255,.12);border-radius:16px;max-height:min(640px,calc(100vh - 124px))}
body:has(.lbd) .dm-cw.full{bottom:calc(84px + env(safe-area-inset-bottom));max-height:none}
@media(max-width:860px){body:has(.lbd) .dm-cw:not(.mini),body:has(.lbd) .dm-cw.full{bottom:0;border-radius:0;border:0;max-height:none}body:has(.lbd) .dm-cf{padding-bottom:calc(84px + env(safe-area-inset-bottom))}}
@media(prefers-reduced-motion:reduce){.dm-row{animation:none}.dm-cw,.dm-toast,.dm-sk,.dm-ib.spin .dm-ic{animation:none}}
`;
function injectCss() { if (document.getElementById('dm-css')) return; const s = document.createElement('style'); s.id = 'dm-css'; s.textContent = CSS; document.head.appendChild(s); }

// ---------- small helpers ----------
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const AVC = ['#0883F7', '#FC5305', '#7c3aed', '#059669', '#db2777', '#0891b2', '#ca8a04', '#4f46e5'];
const avColor = (s) => { let n = 0; for (const c of String(s || '?')) n = (n * 31 + c.charCodeAt(0)) >>> 0; return AVC[n % AVC.length]; };
const nameOf = (m) => (m.from_name || '').trim() || (m.from_email || '').split('@')[0] || 'Unknown';
const fmtSize = (n) => n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round((n || 0) / 1024)) + ' KB';
function fmtDate(iso, long) {
  const d = new Date(iso), now = new Date(); if (isNaN(+d)) return '';
  const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (long) return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' }) + ', ' + t;
  if (d.toDateString() === now.toDateString()) return t;
  return d.toLocaleDateString([], d.getFullYear() === now.getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: '2-digit' });
}
function agoShort(iso) { if (!iso) return 'never'; const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000); return s < 50 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' d ago'; }
function groupOf(iso) { const d = new Date(iso), n = new Date(); const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime(); const diff = Math.round((day(n) - day(d)) / 86400000); return diff <= 0 ? 'Today' : diff === 1 ? 'Yesterday' : diff < 7 ? 'This week' : diff < 31 ? 'This month' : 'Older'; }
const escHtml = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// OUTGOING: rebuild from an allow-list. Anything not listed is unwrapped to its text.
const OK_TAGS = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, BR: 1, P: 1, DIV: 1, UL: 1, OL: 1, LI: 1, BLOCKQUOTE: 1, A: 1, SPAN: 1 };
export function cleanHtml(root) {
  const out = [];
  (function walk(n) {
    n.childNodes.forEach((c) => {
      if (c.nodeType === 3) { out.push(escHtml(c.nodeValue)); return; }
      if (c.nodeType !== 1) return;
      const t = c.tagName; if (t === 'SCRIPT' || t === 'STYLE') return;
      if (!OK_TAGS[t]) { walk(c); return; }
      if (t === 'BR') { out.push('<br>'); return; }
      let attrs = '';
      if (t === 'A') { const u = c.getAttribute('href') || ''; if (/^(https?:|mailto:|tel:)/i.test(u)) attrs = ' href="' + escHtml(u) + '" target="_blank" rel="noopener"'; }
      const tag = t.toLowerCase(); out.push('<' + tag + attrs + '>'); walk(c); out.push('</' + tag + '>');
    });
  })(root);
  return out.join('');
}
// INBOUND: defence in depth before the sandbox — the frame would refuse these anyway.
const stripHostile = (html) => String(html || '').replace(/<(script|iframe|object|embed|form|link|meta|base)\b[\s\S]*?(<\/\1>|\/?>)/gi, '').replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
// The company signature is staff/system-authored brand HTML (table + logo), so it is shown as-is — but still inside a
// script-less sandbox whose CSP only lets the LoadBoot logo load.
export function sigFrame(html) {
  const f = h('iframe', { sandbox: 'allow-same-origin', title: 'Signature preview', style: 'width:100%;border:0;border-radius:10px;background:#fff;display:block;height:84px' });
  f.addEventListener('load', () => { try { f.style.height = Math.min(Math.max(f.contentDocument.documentElement.scrollHeight, 40), 260) + 'px'; } catch (_) {} });
  f.srcdoc = '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src https://loadboot.com data:"><style>html,body{margin:0}body{padding:12px 14px;font:13px Arial,sans-serif;color:#1f2937}</style></head><body>' + stripHostile(html) + '</body></html>';
  return f;
}
const hasRemote = (html) => /<img[^>]+src\s*=\s*["']?https?:/i.test(html || '') || /url\(\s*["']?https?:/i.test(html || '');

const FOLDERS = [['inbox', 'Inbox', 'inbox'], ['starred', 'Starred', 'star'], ['sent', 'Sent', 'send'], ['drafts', 'Drafts', 'draft'], ['spam', 'Spam', 'spam'], ['trash', 'Trash', 'trash']];
const EMPTY = { inbox: ['Inbox zero', 'New email lands here within a minute of arriving.'], starred: ['No starred email', 'Star the threads you need to come back to.'], sent: ['Nothing sent yet', 'Email you send shows up here.'], drafts: ['No drafts', 'Anything you start writing is saved here automatically.'], spam: ['No spam', 'Good.'], trash: ['Trash is empty', 'Deleted email stays here until it is deleted forever.'] };

export function mountDispatcherMail(host, opts) {
  opts = opts || {}; let api = opts.api || null; injectCss();
  const S = { acc: null, staff: false, folder: 'inbox', q: '', rows: [], more: false, loading: true, sel: new Set(), counts: {}, open: null, msgs: [], lastSync: null, problem: false, latest: null, dead: false, syncing: false };
  let root = h('div', { class: 'dm' }); mount(host, root);
  let pollT = null, syncT = null, toastEl = null, toastT = null; const composers = [];

  function toast(msg, action, onAction, ms) {
    if (toastEl) toastEl.remove(); clearTimeout(toastT);
    toastEl = h('div', { class: 'dm-toast', role: 'status' }, [msg, action ? h('button', { onClick: () => { toastEl && toastEl.remove(); onAction && onAction(); } }, action) : null]);
    document.body.appendChild(toastEl); toastT = setTimeout(() => toastEl && toastEl.remove(), ms || 4000);
  }
  const fail = (e) => toast((e && e.message) || 'Something went wrong');
  const btn = (icn, label, fn, extra) => h('button', Object.assign({ class: 'dm-ib', title: label, 'aria-label': label, onClick: (ev) => { ev.stopPropagation(); fn(ev); } }, extra || {}), ic(icn, 18));

  // ---------- data ----------
  async function boot() {
    try {
      if (!api) api = await import('./api.js');
      const b = await api.dmailBootstrap(opts.accountId || null); if (S.dead) return;
      if (!b || !b.enabled) return renderOff(b && b.reason);
      S.acc = b.account; S.staff = !!b.staff_view; S.canDel = !!b.can_delete;   // bl_dmail_0357: only staff can delete — the server enforces it, this only hides the buttons
      if (opts.open && opts.open.folder && opts.open.folder !== 'drafts') S.folder = opts.open.folder; S.counts = b.counts || {}; S.lastSync = b.account.last_sync_at; S.problem = !!b.account.sync_problem;
      paint(); await loadList(); syncNow(true);
      if (opts.open && opts.open.thread) openRow({ thread: opts.open.thread, subject: opts.open.subject || '', ids: [], id: null, folder: S.folder });
      pollT = setInterval(poll, 20000); syncT = setInterval(() => { if (!document.hidden) syncNow(true); }, 45000);
      document.addEventListener('keydown', onKey);
    } catch (e) { renderOff('error', e); }
  }
  function renderOff(reason, e) {
    const M = { no_mailbox: ['No mailbox assigned yet', 'LoadBoot will assign you a company email address. It appears here the moment it is assigned — nothing to set up on your side.'], paused: ['Mailbox paused', 'LoadBoot staff have paused this mailbox. Message your coordinator if you need it back.'], not_active: ['Mailbox not available', 'Your dispatcher account is not active right now.'], error: ['Could not load your mailbox', (e && e.message) || 'Try again in a moment.'] }[reason] || ['Mailbox not available', ''];
    mount(root, h('div', { class: 'dm-main dm-off' }, h('div', { class: 'dm-empty' }, [h('div', { class: 'big' }, ic('mail', 30)), h('b', null, M[0]), h('div', null, M[1])])));
    try { opts.onUnread && opts.onUnread(0); } catch (_) {}
  }
  async function loadList(append) {
    if (!append) { S.loading = true; S.sel.clear(); paintMain(); }
    try {
      const before = append && S.rows.length ? S.rows[S.rows.length - 1].date : null;
      const r = await api.dmailList({ account: S.acc.id, folder: S.folder, q: S.q, before, limit: 40 }); if (S.dead) return;
      if (r && r.error) throw new Error(r.error);
      const rows = r.rows || []; S.rows = append ? S.rows.concat(rows) : rows; S.more = rows.length === 40; setCounts(r.counts); S.lastSync = r.last_sync_at || S.lastSync;
    } catch (e) { fail(e); }
    S.loading = false; paintRail(); if (!S.open) paintMain();
  }
  function setCounts(c) { if (!c) return; const prev = S.counts.inbox || 0; S.counts = c; try { opts.onUnread && opts.onUnread(c.inbox || 0); } catch (_) {} return (c.inbox || 0) > prev; }
  async function poll() {
    if (S.dead || document.hidden || !S.acc) return;
    try { const p = await api.dmailPoll(S.acc.id); if (!p || p.error) return; const grew = setCounts(p.counts); S.lastSync = p.last_sync_at; S.problem = !!p.sync_problem;
      if (p.latest && p.latest !== S.latest) { const first = S.latest === null; S.latest = p.latest; if (!first) { if (grew) toast('New email'); if (!S.open && !S.sel.size) await quietReload(); } }
      paintRail(); } catch (_) {}
  }
  async function quietReload() { try { const r = await api.dmailList({ account: S.acc.id, folder: S.folder, q: S.q, limit: Math.max(40, S.rows.length) }); if (r && r.rows) { S.rows = r.rows; setCounts(r.counts); if (!S.open) paintMain(); paintRail(); } } catch (_) {} }
  async function syncNow(quiet) {
    if (S.syncing || !S.acc) return; S.syncing = true; if (!quiet) paintMain();
    try { const r = await api.dmailAct({ action: 'sync', account: S.acc.id }); S.problem = !(r && r.ok); if (r && r.ok) S.lastSync = new Date().toISOString(); if (!quiet || (r && r.added)) await quietReload(); if (!quiet && r && !r.ok) toast('Mail server: ' + (r.error || 'not reachable')); }
    catch (e) { if (!quiet) fail(e); }
    S.syncing = false; if (!quiet) paintMain(); paintRail();
  }
  // optimistic: change the screen now, tell the mail server in the background, put it back if that fails
  async function act(body, local) { try { local && local(); await api.dmailAct(Object.assign({ account: S.acc.id }, body)); poll(); } catch (e) { fail(e); await quietReload(); } }
  const idsOf = (rows) => rows.reduce((a, r) => a.concat(r.ids || [r.id]), []);
  const selectedRows = () => S.rows.filter((r) => S.sel.has(r.thread));
  function moveRows(rows, to, verb) { const ids = idsOf(rows), keys = new Set(rows.map((r) => r.thread)); act({ action: 'move', ids, to }, () => { S.rows = S.rows.filter((r) => !keys.has(r.thread)); S.sel.clear(); S.open = null; paintMain(); toast(verb); }); }
  function deleteForever(rows) { const ids = idsOf(rows), keys = new Set(rows.map((r) => r.thread)); act({ action: 'delete', ids }, () => { S.rows = S.rows.filter((r) => !keys.has(r.thread)); S.sel.clear(); S.open = null; paintMain(); toast('Deleted forever'); }); }
  function markRows(rows, seen) { act({ action: 'mark', ids: idsOf(rows), seen }, () => { rows.forEach((r) => { r.unread = !seen; }); S.sel.clear(); if (!S.open) paintMain(); }); }
  function starRow(r) { const on = !r.starred; act({ action: 'mark', ids: [r.id], starred: on }, () => { r.starred = on; if (!S.open) paintMain(); }); }
  async function discardDrafts(rows) { try { for (const r of rows) await api.dmailDraftDiscard(r.id); toast('Draft discarded'); } catch (e) { fail(e); } await loadList(); }

  // ---------- chrome ----------
  let railEl, mainEl;
  function paint() { railEl = h('nav', { class: 'dm-rail', 'aria-label': 'Mail folders' }); mainEl = h('section', { class: 'dm-main' }); mount(root, [railEl, mainEl]); paintRail(); paintMain(); }
  function paintRail() {
    if (!railEl) return;
    mount(railEl, [
      h('button', { class: 'dm-compose', onClick: () => compose({}) }, [ic('pen', 18), 'Compose']),
      ...FOLDERS.filter(([id]) => id !== 'trash' || S.canDel).map(([id, label, icn]) => { const n = id === 'inbox' ? S.counts.inbox : id === 'drafts' ? S.counts.drafts : id === 'spam' ? S.counts.spam : 0;
        return h('button', { class: 'dm-f' + (S.folder === id && !S.q ? ' on' : ''), onClick: () => { S.folder = id; S.q = ''; S.open = null; loadList(); } }, [ic(icn, 18), label, n ? h('span', { class: 'n' }, String(n)) : null]); }),
      h('div', { class: 'dm-who' }, [h('b', { title: S.acc.address }, S.acc.address), S.acc.display_name, h('div', { class: 's' }, [h('span', { class: 'dm-dot' + (S.problem ? ' bad' : '') }), S.problem ? 'Reconnecting…' : 'Synced ' + agoShort(S.lastSync)])]),
    ]);
  }
  function paintMain() { if (!mainEl) return; root.classList.toggle('reading', !!S.open); if (S.open) return paintThread(); paintList(); }

  function topBar() {
    let t = null; const inp = h('input', { type: 'search', placeholder: 'Search mail', value: S.q, 'aria-label': 'Search mail', onInput: () => { clearTimeout(t); t = setTimeout(() => { S.q = inp.value.trim(); S.open = null; loadList(); }, 350); } });
    return h('div', { class: 'dm-top' }, [h('label', { class: 'dm-search' }, [ic('search', 17), inp]), btn('refresh', 'Check for new mail', () => syncNow(false), { class: 'dm-ib' + (S.syncing ? ' spin' : ''), disabled: S.syncing })]);
  }
  function banners() {
    return [S.staff ? h('div', { class: 'dm-banner info' }, [ic('lock', 15), 'Staff view of ' + S.acc.address + (S.acc.assigned_name ? ' · assigned to ' + S.acc.assigned_name : ' · not assigned') + ' — anything you do here happens in the dispatcher\'s real mailbox.']) : null,
      S.problem ? h('div', { class: 'dm-banner' }, [ic('alert', 15), 'The mail server is not answering right now. Your email is safe — this reconnects on its own. LoadBoot staff can see the problem.']) : null];
  }

  // ---------- list ----------
  function paintList() {
    const sel = selectedRows(), f = S.folder, all = S.rows.length && sel.length === S.rows.length;
    const bar = h('div', { class: 'dm-bar' }, [
      h('input', { type: 'checkbox', class: 'dm-chk', 'aria-label': 'Select all', checked: all || null, onChange: (e) => { S.sel = new Set(e.target.checked ? S.rows.map((r) => r.thread) : []); paintList(); } }),
      ...(sel.length ? [
        f === 'drafts' ? btn('trash', 'Discard drafts', () => discardDrafts(sel)) : null,
        f === 'trash' || f === 'spam' ? btn('restore', f === 'spam' ? 'Not spam' : 'Move to inbox', () => moveRows(sel, 'inbox', f === 'spam' ? 'Moved to inbox' : 'Restored')) : null,
        S.canDel && (f === 'trash' || f === 'spam') ? btn('trash', 'Delete forever', () => deleteForever(sel)) : null,
        S.canDel && f !== 'trash' && f !== 'spam' && f !== 'drafts' ? btn('trash', 'Delete', () => moveRows(sel, 'trash', 'Moved to Trash')) : null,
        f === 'inbox' ? btn('spam', 'Report spam', () => moveRows(sel, 'spam', 'Marked as spam')) : null,
        f !== 'drafts' ? btn('mailopen', 'Mark as read', () => markRows(sel, true)) : null,
        f !== 'drafts' ? btn('mail', 'Mark as unread', () => markRows(sel, false)) : null,
        h('span', null, sel.length + ' selected')] : [h('span', null, S.q ? 'Search results' : (FOLDERS.find((x) => x[0] === f) || [])[1])]),
      h('span', { class: 'sp' }), h('span', null, S.rows.length ? S.rows.length + (S.more ? '+' : '') + ' conversation' + (S.rows.length === 1 ? '' : 's') : '')]);
    const list = h('div', { class: 'dm-list', role: 'list' });
    if (S.loading) for (let i = 0; i < 9; i++) list.appendChild(h('div', { class: 'dm-sk' }));
    else if (!S.rows.length) { const E = S.q ? ['No results', 'Nothing matches “' + S.q + '”.'] : EMPTY[f]; list.appendChild(h('div', { class: 'dm-empty' }, [h('div', { class: 'big' }, ic(S.q ? 'search' : (FOLDERS.find((x) => x[0] === f) || [])[2], 30)), h('b', null, E[0]), h('div', null, E[1])])); }
    else { let g0 = null; S.rows.forEach((r) => { const g = S.q ? null : groupOf(r.date); if (g && g !== g0) { g0 = g; list.appendChild(h('div', { class: 'dm-grp' }, g)); } list.appendChild(rowEl(r)); }); if (S.more) list.appendChild(h('button', { class: 'dm-more', onClick: () => loadList(true) }, 'Load older')); }
    mount(mainEl, [topBar(), ...banners(), bar, list]);
  }
  function rowEl(r) {
    const f = r.folder, isDraft = f === 'drafts', outgoing = f === 'sent' || isDraft;
    const toNames = (r.to || []).map((t) => t.name || t.email).join(', ');
    const who = isDraft ? [h('span', { class: 'dr' }, 'Draft'), toNames ? ' ' + toNames : ''] : outgoing ? 'To: ' + (toNames || '(no recipient)') : ((r.names && r.names.length ? r.names : [nameOf(r)]).map((n) => n === S.acc.address || n === S.acc.display_name ? 'me' : n).slice(-3).join(', '));
    return h('div', { class: 'dm-row' + (r.unread ? ' un' : '') + (S.sel.has(r.thread) ? ' sel' : ''), role: 'listitem', tabindex: '0', onClick: () => openRow(r), onKeydown: (e) => { if (e.key === 'Enter') openRow(r); } }, [
      h('input', { type: 'checkbox', class: 'dm-chk', 'aria-label': 'Select conversation', checked: S.sel.has(r.thread) || null, onClick: (e) => e.stopPropagation(), onChange: (e) => { e.target.checked ? S.sel.add(r.thread) : S.sel.delete(r.thread); paintList(); } }),
      isDraft ? h('span', { style: 'width:30px' }) : h('button', { class: 'dm-starb' + (r.starred ? ' on' : ''), 'aria-label': r.starred ? 'Remove star' : 'Add star', onClick: (e) => { e.stopPropagation(); starRow(r); } }, ic('star', 17, r.starred ? 'currentColor' : 'none')),
      h('div', { class: 'dm-rav', style: 'background:' + avColor(outgoing ? ((r.to || [])[0] || {}).email : r.from_email) }, ((outgoing ? (toNames || '?') : nameOf(r))[0] || '?').toUpperCase()),
      h('div', { class: 'who' }, [who, r.total > 1 ? h('i', null, String(r.total)) : null]),
      h('div', { class: 'txt' }, [h('span', { class: 'sub' }, r.subject || '(no subject)'), h('span', { class: 'sn' }, r.snippet ? ' — ' + r.snippet : '')]),
      h('div', { class: 'meta' }, [r.has_attach ? ic('clip', 15) : null, h('span', { class: 'd' }, fmtDate(r.date)),
        h('span', { class: 'acts' }, isDraft ? [btn('trash', 'Discard draft', () => discardDrafts([r]))] : f === 'trash' || f === 'spam' ? [btn('restore', 'Move to inbox', () => moveRows([r], 'inbox', 'Moved to inbox')), S.canDel ? btn('trash', 'Delete forever', () => deleteForever([r])) : null]
          : [S.canDel ? btn('trash', 'Delete', () => moveRows([r], 'trash', 'Moved to Trash')) : null, btn(r.unread ? 'mailopen' : 'mail', r.unread ? 'Mark as read' : 'Mark as unread', () => markRows([r], !!r.unread))])]),
    ]);
  }
  async function openRow(r) {
    if (r.folder === 'drafts' && (r.total || 1) <= 1) return openDraft(r.id, r.thread);
    S.open = r; S.msgs = null; paintThread();
    try { const t = await api.dmailThread(S.acc.id, r.thread, S.folder === 'trash' || S.folder === 'spam' ? S.folder : null); if (S.open !== r) return; if (t && t.error) throw new Error(t.error); S.msgs = t.messages || []; if (!r.ids || !r.ids.length) { r.ids = S.msgs.map((m) => m.id); r.id = r.id || (S.msgs[S.msgs.length - 1] || {}).id; r.subject = r.subject || (S.msgs[0] || {}).subject; } paintThread();
      const unseen = S.msgs.filter((m) => !m.seen && m.folder !== 'drafts').map((m) => m.id); if (unseen.length) act({ action: 'mark', ids: unseen, seen: true }, () => { r.unread = false; });
    } catch (e) { fail(e); S.open = null; paintMain(); }
  }
  async function openDraft(id, thread) { try { const t = await api.dmailThread(S.acc.id, thread, null); const d = (t.messages || []).find((m) => m.id === id); if (d) compose({ draft: d }); } catch (e) { fail(e); } }

  // ---------- thread ----------
  function paintThread() {
    root.classList.add('reading');
    const r = S.open, f = S.folder, inBin = f === 'trash' || f === 'spam';
    const bar = h('div', { class: 'dm-bar' }, [btn('back', 'Back to list', closeThread),
      inBin ? btn('restore', 'Move to inbox', () => moveRows([r], 'inbox', 'Moved to inbox')) : (S.canDel ? btn('trash', 'Delete', () => moveRows([r], 'trash', 'Moved to Trash')) : null),
      inBin ? (S.canDel ? btn('trash', 'Delete forever', () => deleteForever([r])) : null) : btn('spam', 'Report spam', () => moveRows([r], 'spam', 'Marked as spam')),
      btn('mail', 'Mark as unread', () => { markRows([r], false); closeThread(); })]);
    const body = h('div', { class: 'dm-thread' });
    if (!S.msgs) for (let i = 0; i < 3; i++) body.appendChild(h('div', { class: 'dm-sk', style: 'border-radius:14px;margin:10px 0;height:64px' }));
    else {
      body.appendChild(h('h2', { class: 'dm-subj' }, r.subject || '(no subject)'));
      const real = S.msgs.filter((m) => m.folder !== 'drafts'), drafts = S.msgs.filter((m) => m.folder === 'drafts');
      real.forEach((m, i) => body.appendChild(msgEl(m, i === real.length - 1)));
      drafts.forEach((d) => body.appendChild(h('div', { class: 'dm-draftcard', onClick: () => compose({ draft: d }) }, [ic('pen', 16), h('b', null, 'Draft'), d.snippet || '(empty)', h('span', { style: 'margin-left:auto' }, 'Continue writing')])));
      const last = real[real.length - 1];
      if (last && !inBin) body.appendChild(h('div', { class: 'dm-rbtns' }, [
        h('button', { class: 'dm-btn', onClick: () => compose({ reply: last, mode: 'reply' }) }, [ic('reply', 16), 'Reply']),
        (last.to || []).length + (last.cc || []).length > 1 ? h('button', { class: 'dm-btn', onClick: () => compose({ reply: last, mode: 'replyall' }) }, [ic('replyall', 16), 'Reply all']) : null,
        h('button', { class: 'dm-btn', onClick: () => compose({ reply: last, mode: 'forward' }) }, [ic('forward', 16), 'Forward'])]));
    }
    mount(mainEl, [topBar(), ...banners(), bar, body]);
  }
  function closeThread() { S.open = null; paintMain(); }
  function msgEl(m, expanded) {
    const mine = (m.from_email || '') === S.acc.address; const nm = mine ? 'me' : nameOf(m);
    const toLine = 'to ' + ((m.to || []).concat(m.cc || []).map((t) => t.email === S.acc.address ? 'me' : (t.name || t.email)).join(', ') || '—') + ((m.bcc || []).length ? ', bcc: ' + m.bcc.map((t) => t.name || t.email).join(', ') : '');
    const wrap = h('article', { class: 'dm-msg' }); let open = expanded;
    const bodyHost = h('div', { class: 'dm-mb' });
    const head = h('div', { class: 'dm-mh', onClick: () => { open = !open; draw(); } });
    function draw() {
      mount(head, [h('div', { class: 'dm-av', style: 'background:' + avColor(m.from_email) }, (nm[0] || '?').toUpperCase()),
        h('div', { class: 'mid' }, [h('div', null, [h('span', { class: 'nm' }, nm), mine ? null : h('span', { class: 'em' }, '<' + (m.from_email || '') + '>')]), h('div', { class: 'to' }, open ? toLine : (m.snippet || ''))]),
        m.attachments && m.attachments.length && !open ? ic('clip', 15) : null, h('span', { class: 'dt' }, fmtDate(m.date, open)),
        open ? btn('reply', 'Reply', () => compose({ reply: m, mode: 'reply' })) : null, open ? btn('forward', 'Forward', () => compose({ reply: m, mode: 'forward' })) : null]);
      if (!open) { clear(bodyHost); bodyHost.style.display = 'none'; return; }
      bodyHost.style.display = ''; if (!bodyHost.firstChild) fillBody(bodyHost, m);
    }
    wrap.appendChild(head); wrap.appendChild(bodyHost); draw(); return wrap;
  }
  function fillBody(hostEl, m) {
    const parts = [];
    if (m.html) {
      const safe = stripHostile(m.html); let remote = false;
      const frame = h('iframe', { class: 'dm-frame', sandbox: 'allow-same-origin allow-popups allow-popups-to-escape-sandbox', referrerpolicy: 'no-referrer', title: 'Email content' });
      const fit = () => { try { const d = frame.contentDocument; if (d && d.documentElement) frame.style.height = Math.min(Math.max(d.documentElement.scrollHeight, 60), 6000) + 'px'; } catch (_) {} };
      const setDoc = () => { frame.srcdoc = '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; img-src data: https://loadboot.com' + (remote ? ' https: http:' : '') + '; font-src data:"><base target="_blank"><style>html,body{margin:0}body{padding:16px;font:14px/1.55 Arial,Helvetica,sans-serif;color:#1f2937;overflow-wrap:anywhere;background:#fff}img{max-width:100%;height:auto}table{max-width:100%}blockquote{border-left:3px solid #d1d5db;margin:8px 0;padding-left:12px;color:#6b7280}a{color:#0a6fd6}</style></head><body>' + safe + '</body></html>'; };
      frame.addEventListener('load', () => { fit(); setTimeout(fit, 400); setTimeout(fit, 1500); });
      if (hasRemote(safe)) { const barEl = h('div', { class: 'dm-imgbar' }, [ic('img', 14), 'Images are hidden to protect your privacy.', h('button', { class: 'dm-link', onClick: () => { remote = true; setDoc(); barEl.remove(); } }, 'Show images')]); parts.push(barEl); }
      setDoc(); parts.push(frame);
    } else parts.push(h('pre', { class: 'dm-plain' }, m.text || '(empty message)'));
    const atts = (m.attachments || []).filter((a) => !a.inline || !m.html);
    if (atts.length) parts.push(h('div', { class: 'dm-atts' }, atts.map((a) => h('button', { class: 'dm-att', title: 'Download ' + a.name, onClick: (e) => download(m, a, e.currentTarget) }, [ic(/^image\//.test(a.type) ? 'img' : 'draft', 20), h('div', { style: 'min-width:0;text-align:left' }, [h('div', { class: 'an' }, a.name), h('div', { class: 'as' }, fmtSize(a.size))]), ic('download', 16)]))));
    mount(hostEl, parts);
  }
  async function download(m, a, el) {
    el.disabled = true; el.style.opacity = '.6';
    try { const data = await api.dmailAct({ action: 'attachment', account: S.acc.id, id: m.id, idx: a.idx }); if (!(data instanceof Blob)) throw new Error('Could not download that file');
      const url = URL.createObjectURL(new Blob([data], { type: a.type || 'application/octet-stream' })); const link = h('a', { href: url, download: a.name }); document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (e) { fail(e); }
    el.disabled = false; el.style.opacity = '';
  }

  // ---------- compose ----------
  function compose(o) {
    if (composers.length >= 2) { toast('Finish or close a draft first'); return; }
    const d = o.draft || null, src = o.reply || null, mode = d ? ((d.draft_meta && d.draft_meta.mode) || 'new') : (o.mode || 'new');
    const C = { id: d ? d.id : null, to: [], cc: [], bcc: [], files: [], replyTo: null, forwardOf: null, quoteHtml: '', quoteText: '', dirty: false, saving: null, closed: false };
    const me = S.acc.address, uniq = (l) => { const seen = new Set(); return l.filter((x) => x.email && x.email !== me && !seen.has(x.email) && seen.add(x.email)); };
    let subject = d ? (d.subject || '') : '';
    if (d) { C.to = (d.to || []).slice(); C.cc = (d.cc || []).slice(); C.bcc = (d.bcc || []).slice(); if (d.draft_meta && d.draft_meta.reply_to) { if (mode === 'forward') C.forwardOf = d.draft_meta.reply_to; else C.replyTo = d.draft_meta.reply_to; } }
    const quoteFrom = src || (d && S.msgs ? S.msgs.find((x) => x.id === (d.draft_meta || {}).reply_to) : null);
    if (src) {
      const base = (src.subject || '').replace(/^\s*((re|fwd?|fw):\s*)+/i, '');
      if (mode === 'forward') { subject = 'Fwd: ' + base; C.forwardOf = src.id; }
      else { subject = 'Re: ' + base; C.replyTo = src.id; const mineMsg = src.from_email === me;
        C.to = uniq(mineMsg ? (src.to || []) : [{ email: src.from_email, name: src.from_name || '' }]);
        if (mode === 'replyall') C.cc = uniq((src.to || []).concat(src.cc || [])).filter((x) => !C.to.some((t) => t.email === x.email)); }
    }
    if (quoteFrom) {
      const hdr = mode === 'forward' ? '---------- Forwarded message ----------<br>From: ' + escHtml(nameOf(quoteFrom)) + ' &lt;' + escHtml(quoteFrom.from_email) + '&gt;<br>Date: ' + escHtml(fmtDate(quoteFrom.date, true)) + '<br>Subject: ' + escHtml(quoteFrom.subject || '') + '<br>To: ' + escHtml((quoteFrom.to || []).map((t) => t.email).join(', ')) + '<br><br>'
        : 'On ' + escHtml(fmtDate(quoteFrom.date, true)) + ', ' + escHtml(nameOf(quoteFrom)) + ' &lt;' + escHtml(quoteFrom.from_email) + '&gt; wrote:<br>';
      const qt = (quoteFrom.text || '').slice(0, 20000);
      C.quoteText = qt; C.quoteHtml = '<div style="color:#6b7280">' + hdr + '</div><blockquote style="border-left:3px solid #d1d5db;margin:6px 0 0;padding-left:12px;color:#6b7280">' + escHtml(qt).replace(/\n/g, '<br>') + '</blockquote>';
    }
    const win = h('div', { class: 'dm-cw', role: 'dialog', 'aria-label': 'New message' });
    const title = h('span', { class: 't' }, subject || 'New message'), saved = h('span', { class: 'sv' });
    const subj = h('input', { type: 'text', placeholder: 'Subject', value: subject, 'aria-label': 'Subject', onInput: () => { title.textContent = subj.value || 'New message'; touch(); } });
    const ed = h('div', { class: 'dm-ed', contenteditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Message', 'data-ph': 'Write your message…', onInput: touch });
    if (d && d.html) { const tmp = document.createElement('template'); tmp.innerHTML = d.html; ed.innerHTML = cleanHtml(tmp.content); }   // a draft is our own cleaned HTML; cleaned again anyway
    ed.addEventListener('paste', (e) => { e.preventDefault(); const t = (e.clipboardData || window.clipboardData).getData('text/plain'); document.execCommand('insertText', false, t); });
    const exec = (cmd, val) => { ed.focus(); document.execCommand(cmd, false, val); touch(); };
    const tbtn = (icn, label, fn) => h('button', { class: 'dm-ib', type: 'button', title: label, 'aria-label': label, onMousedown: (e) => e.preventDefault(), onClick: fn }, ic(icn, 16));
    const fileInp = h('input', { type: 'file', multiple: true, style: 'display:none', onChange: () => { addFiles(fileInp.files); fileInp.value = ''; } });
    const attHost = h('div', { class: 'dm-atts', style: 'margin:0 16px 8px' });
    function addFiles(list) { for (const f of list) { const total = C.files.reduce((s, x) => s + x.size, 0) + f.size; if (total > 15 * 1048576) { toast('Attachments are limited to 15 MB per email'); break; } C.files.push(f); } drawAtts(); }
    function drawAtts() { mount(attHost, C.files.map((f, i) => h('div', { class: 'dm-att' }, [ic('clip', 16), h('div', { style: 'min-width:0' }, [h('div', { class: 'an' }, f.name), h('div', { class: 'as' }, fmtSize(f.size))]), h('button', { class: 'dm-ib', style: 'width:26px;height:26px', 'aria-label': 'Remove ' + f.name, onClick: () => { C.files.splice(i, 1); drawAtts(); } }, ic('x', 14))]))); attHost.style.display = C.files.length ? '' : 'none'; }
    win.addEventListener('dragover', (e) => e.preventDefault()); win.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });

    const ccRow = chipField('Cc', C.cc), bccRow = chipField('Bcc', C.bcc); ccRow.el.style.display = C.cc.length ? '' : 'none'; bccRow.el.style.display = C.bcc.length ? '' : 'none';
    const toRow = chipField('To', C.to, h('span', { style: 'display:flex;gap:8px;padding-top:5px' }, [h('button', { class: 'dm-link', type: 'button', onClick: () => { ccRow.el.style.display = ''; ccRow.focus(); } }, 'Cc'), h('button', { class: 'dm-link', type: 'button', onClick: () => { bccRow.el.style.display = ''; bccRow.focus(); } }, 'Bcc')]));
    function chipField(label, arr, extra) {
      const inp = h('input', { type: 'text', 'aria-label': label, autocomplete: 'off' }), chips = h('div', { class: 'dm-chips' }), sug = h('div', { class: 'dm-sug', style: 'display:none' }); let st = null, found = [], hi = 0;
      const row = h('div', { class: 'dm-fl' }, [h('label', null, label), chips, extra || null, sug]);
      const draw = () => { mount(chips, [...arr.map((c, i) => h('span', { class: 'dm-chip' + (EMAIL_RE.test(c.email) ? '' : ' bad'), title: c.email }, [h('span', null, c.name || c.email), h('button', { type: 'button', 'aria-label': 'Remove ' + c.email, onClick: () => { arr.splice(i, 1); draw(); touch(); } }, ic('x', 12))])), inp]); };
      const hide = () => { sug.style.display = 'none'; found = []; };
      const add = (raw, name) => { String(raw || '').split(/[,;\s]+/).map((x) => x.trim().replace(/^<|>$/g, '')).filter(Boolean).forEach((e) => { e = e.toLowerCase(); if (!arr.some((c) => c.email === e)) arr.push({ email: e, name: name || '' }); }); inp.value = ''; hide(); draw(); touch(); inp.focus(); };
      const showSug = () => { if (!found.length) return hide(); mount(sug, found.map((c, i) => h('button', { type: 'button', class: i === hi ? 'on' : '', onMousedown: (e) => { e.preventDefault(); add(c.email, c.name); } }, [c.name || c.email, c.name ? h('small', null, c.email) : null]))); sug.style.display = ''; };
      inp.addEventListener('input', () => { clearTimeout(st); const q = inp.value.trim(); if (q.length < 2) return hide(); st = setTimeout(async () => { try { const r = await api.dmailContacts(S.acc.id, q); found = ((r && r.rows) || []).filter((c) => c.email !== me && !arr.some((a) => a.email === c.email)); hi = 0; showSug(); } catch (_) {} }, 200); });
      inp.addEventListener('keydown', (e) => {
        if (found.length && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); hi = (hi + (e.key === 'ArrowDown' ? 1 : found.length - 1)) % found.length; showSug(); }
        else if (e.key === 'Enter' || e.key === 'Tab') { if (found.length) { e.preventDefault(); add(found[hi].email, found[hi].name); } else if (inp.value.trim()) { e.preventDefault(); add(inp.value); } }
        else if (e.key === ',' || e.key === ';' || e.key === ' ') { if (inp.value.trim()) { e.preventDefault(); add(inp.value); } }
        else if (e.key === 'Backspace' && !inp.value && arr.length) { arr.pop(); draw(); touch(); }
      });
      inp.addEventListener('blur', () => setTimeout(() => { if (inp.value.trim() && !C.closed) { const v = inp.value; inp.value = ''; String(v).split(/[,;\s]+/).filter(Boolean).forEach((e) => { e = e.toLowerCase(); if (!arr.some((c) => c.email === e)) arr.push({ email: e, name: '' }); }); draw(); touch(); } hide(); }, 150));
      inp.addEventListener('paste', (e) => { const t = (e.clipboardData || window.clipboardData).getData('text'); if (/[,;\s]/.test(t.trim())) { e.preventDefault(); add(t); } });
      draw(); return { el: row, focus: () => inp.focus() };
    }

    const sigBox = S.acc.signature_html ? (() => { const b = h('div', { class: 'dm-sig' }, h('div', { class: 'lk' }, [ic('lock', 11), 'Company signature — added automatically'])); b.appendChild(sigFrame(S.acc.signature_html)); return b; })() : null;
    let showQ = mode === 'forward';
    const qBox = C.quoteHtml ? h('div', { class: 'dm-q' }) : null;
    const drawQ = () => { if (!qBox) return; mount(qBox, [h('button', { class: 'dm-link', type: 'button', onClick: () => { showQ = !showQ; drawQ(); } }, showQ ? 'Hide quoted text' : '••• Show quoted text'), showQ ? h('div', { class: 'qb' }, C.quoteText) : null]); };
    const sendBtn = h('button', { class: 'dm-btn pri', type: 'button', onClick: send }, ['Send', ic('send', 15)]);

    function payload() { return { id: C.id, account: S.acc.id, to: C.to, cc: C.cc, bcc: C.bcc, subject: subj.value, html: cleanHtml(ed), text: ed.innerText || '', reply_to: C.replyTo || C.forwardOf || null, mode }; }
    const isEmpty = () => !C.to.length && !C.cc.length && !C.bcc.length && !subj.value.trim() && !(ed.innerText || '').trim() && !C.files.length;
    let saveT = null;
    function touch() { C.dirty = true; clearTimeout(saveT); saveT = setTimeout(save, 1800); saved.textContent = ''; }
    async function save() { clearTimeout(saveT); if (!C.dirty || C.closed || isEmpty()) return; C.dirty = false; if (C.saving) await C.saving;
      C.saving = (async () => { try { saved.textContent = 'Saving…'; const r = await api.dmailDraftSave(payload()); if (r && r.error) throw new Error(r.error); if (r && r.id) C.id = r.id; saved.textContent = 'Draft saved'; } catch (_) { saved.textContent = 'Draft not saved'; C.dirty = true; } })(); await C.saving; C.saving = null; }
    function remove() { C.closed = true; clearTimeout(saveT); win.remove(); const i = composers.indexOf(handle); if (i >= 0) composers.splice(i, 1); }
    async function close() { await save(); remove(); if (S.folder === 'drafts' && !S.open) loadList(); else poll(); }
    async function discard() { const id = C.id; remove(); if (id) { try { await api.dmailDraftDiscard(id); } catch (_) {} } toast('Draft discarded'); if (S.folder === 'drafts' && !S.open) loadList(); else poll(); }
    async function send() {
      const all = C.to.concat(C.cc, C.bcc); if (!all.length) { toast('Add at least one recipient'); toRow.focus(); return; }
      const bad = all.find((c) => !EMAIL_RE.test(c.email)); if (bad) { toast('“' + bad.email + '” is not a valid email address'); return; }
      if (!subj.value.trim() && !window.confirm('Send this message without a subject?')) return;
      await save();
      const body = { action: 'send', account: S.acc.id, to: C.to, cc: C.cc, bcc: C.bcc, subject: subj.value, html: cleanHtml(ed), draft_id: C.id, reply_to: C.replyTo, forward_of: C.forwardOf, quote_html: C.quoteHtml || '' };
      const files = C.files.slice(); win.style.display = 'none'; let cancelled = false;
      toast('Sending…', 'Undo', () => { cancelled = true; win.style.display = ''; }, 5200);
      setTimeout(async () => {
        if (cancelled) return;
        try { body.attachments = await Promise.all(files.map(async (f) => ({ name: f.name, type: f.type, b64: await toB64(f) })));
          await api.dmailAct(body); remove(); toast('Message sent'); if (S.open) openRow(S.open); else quietReload(); poll();
        } catch (e) { win.style.display = ''; toast('Not sent — ' + ((e && e.message) || 'try again'), null, null, 7000); }
      }, 5000);
    }
    const toggleMini = () => { if (window.matchMedia('(max-width:860px)').matches) return; win.classList.toggle('mini'); win.classList.remove('full'); };
    const head = h('div', { class: 'dm-ch', onClick: toggleMini }, [title, btn('send', 'Send', send, { class: 'dm-ib mob-send' }), btn('min', 'Minimise', toggleMini, { class: 'dm-ib desk' }), btn('max', 'Full screen', () => { win.classList.toggle('full'); win.classList.remove('mini'); }, { class: 'dm-ib desk' }), btn('x', 'Save and close', close)]);
    const foot = h('div', { class: 'dm-cf' }, [sendBtn, h('div', { class: 'dm-tb' }, [tbtn('bold', 'Bold', () => exec('bold')), tbtn('italic', 'Italic', () => exec('italic')), tbtn('under', 'Underline', () => exec('underline')), tbtn('ul', 'Bulleted list', () => exec('insertUnorderedList')), tbtn('ol', 'Numbered list', () => exec('insertOrderedList')),
      tbtn('link', 'Insert link', () => { const u = window.prompt('Link address (https://…)'); if (u && /^(https?:|mailto:)/i.test(u.trim())) exec('createLink', u.trim()); }), tbtn('clip', 'Attach files', () => fileInp.click())]), saved, btn('trash', 'Discard draft', discard)]);
    const handle = { close, win };
    mount(win, [head, h('div', { class: 'dm-cbody' }, [toRow.el, ccRow.el, bccRow.el, h('div', { class: 'dm-fl' }, subj), ed, attHost, sigBox, qBox, fileInp, foot])]);
    drawAtts(); drawQ(); document.body.appendChild(win);
    composers.push(handle); if (composers.length === 2) win.style.right = 'min(626px, 52vw)';
    setTimeout(() => { if (C.to.length) ed.focus(); else toRow.focus(); }, 60);
  }
  const toB64 = (f) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(new Error('Could not read ' + f.name)); r.readAsDataURL(f); });

  // ---------- keyboard: c compose · / search · Esc/u back · r reply · # delete ----------
  function onKey(e) {
    if (S.dead || !root.isConnected) return; const t = e.target; if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return; if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'c') { e.preventDefault(); compose({}); }
    else if (e.key === '/') { const i = root.querySelector('.dm-search input'); if (i) { e.preventDefault(); i.focus(); } }
    else if ((e.key === 'Escape' || e.key === 'u') && S.open) closeThread();
    else if (e.key === 'r' && S.open && S.msgs) { const real = S.msgs.filter((m) => m.folder !== 'drafts'); if (real.length) { e.preventDefault(); compose({ reply: real[real.length - 1], mode: 'reply' }); } }
    else if (e.key === '#' && S.canDel && S.open && S.folder !== 'trash') moveRows([S.open], 'trash', 'Moved to Trash');
  }

  boot();
  return { destroy() { S.dead = true; clearInterval(pollT); clearInterval(syncT); document.removeEventListener('keydown', onKey); composers.slice().forEach((c) => c.win.remove()); if (toastEl) toastEl.remove(); }, refresh: () => syncNow(false), compose: (o) => compose(o || {}) };
}
export default { mountDispatcherMail, cleanHtml, sigFrame };
