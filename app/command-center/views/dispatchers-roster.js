// dispatchers-roster.js — the CC Dispatchers console (bl_disp_0313 → v3, bl_disp_0316).
//
// Yaseen 15 Sep 2026: the approved v3 mock, built for real — an operations console, not a list.
// Four tabs own the whole screen: Roster (paged, server-side search), Pipeline board (stage
// columns), Work queue (the live cross-dispatcher queue, mounted from dispatchers.js) and Payouts.
//
// Every number on screen comes from a real RPC. cc_dispatchers_stats returns the KPI row and the
// pipeline strip; cc_dispatchers_page returns 50 rows at a time with last activity, money owed and
// the latest skills-test attempt; cc_dispatchers_board fills the board; cc_dispatcher_payouts the
// money tab. Nothing is computed from a full in-memory list, so the screen behaves the same at 38
// dispatchers and at a million.
//
// Contract with dispatchers.js:
//   ctx.open360(row)          open the 360 drawer
//   ctx.pill(status)          the existing stage pill (kept for the drawer's own markup)
//   ctx.signals(row)          extra pill nodes the live queue knows about (unread threads)
//   ctx.onRows(rows)          hands visible rows back for deep links
//   ctx.queueNodes            { presence, queue, feed } — detached nodes for the Work queue tab
//   ctx.refreshQueue()        repaints those nodes
import { el, mount } from '../../shared/ui/dom.js';
import { fmtDate, fmtDateTime, money, askConfirm } from '../../shared/ui/components.js';
import { ccDispatchersPage, ccDispatchersStats, ccDispatchersBoard, ccDispatcherPayouts,
         ccDispatcherTestInvite, ccDispatcherCommissionStatus } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { icon } from '../../shared/ui/icons.js';
import { ccDispatcherQueue } from '../../shared/api.js';

const STAGES = [
  ['applied', 'Applied', '#64748b'], ['screening', 'Screening', '#d97706'], ['skills_test', 'Skills test', '#7c3aed'],
  ['trial', 'Trial', '#0883F7'], ['verified', 'Verified', '#059669'], ['active', 'Active', '#10223B'],
];
const EXTRA = [['suspended', 'Suspended', '#b45309'], ['rejected', 'Rejected', '#9f1239']];
const ALL = STAGES.concat(EXTRA);
const LABEL = Object.fromEntries(ALL.map((s) => [s[0], s[1]]));
const COLOR = Object.fromEntries(ALL.map((s) => [s[0], s[2]]));
const PAGE = 50;

let cssDone = false;
function css() {
  if (cssDone) return; cssDone = true;
  document.head.appendChild(el('style', null, `
.dv{--n:var(--lb-navy,#10223B);--b:var(--lb-blue,#0883F7);--o:var(--lb-orange,#FC5305);--ink:#0f172a;--mut:#64748b;--line:#e5e9f0;--soft:#f8fafc;--ok:#12803c;--warn:#b45309;--bad:#b91c1c;color:var(--ink);font-family:var(--lb-font,Inter,system-ui,sans-serif)}
.dv-hdr h2,.dv-kpi b,.dv-stg b,.dv-col h5 b{font-family:var(--lb-head,var(--lb-font,inherit))}
.dv *{box-sizing:border-box}
.dv-top{display:flex;align-items:center;gap:12px;padding:10px 0 14px;border-bottom:1px solid var(--line);margin-bottom:16px;flex-wrap:wrap}
.dv-search{position:relative;flex:1;min-width:260px;max-width:540px}
.dv-search input{width:100%;padding:9px 12px 9px 36px;border:1px solid var(--line);border-radius:9px;font:inherit;background:#fff;outline:none}
.dv-search input:focus{border-color:var(--b);box-shadow:0 0 0 3px rgba(8,131,247,.13)}
.dv-search svg{position:absolute;left:11px;top:50%;transform:translateY(-50%);width:16px;height:16px;color:var(--mut)}
.dv-kbd{border:1px solid var(--line);border-radius:5px;padding:2px 6px;font:700 11px/1 ui-monospace,monospace;color:var(--mut);background:var(--soft)}
.dv-btn{border:1px solid var(--line);background:#fff;border-radius:9px;padding:8px 13px;font:inherit;font-weight:600;cursor:pointer;color:var(--ink);white-space:nowrap}
.dv-btn:hover{background:var(--soft)}.dv-btn[disabled]{opacity:.45;cursor:not-allowed}
.dv-btn.p{background:var(--n);color:#fff;border-color:var(--n)}.dv-btn.p:hover{background:#17335a}
.dv-btn.o{background:var(--o);color:#fff;border-color:var(--o)}.dv-btn.o:hover{filter:brightness(1.06)}
.dv-btn.sm{padding:5px 10px;font-size:12.5px}
.dv-hdr{display:flex;align-items:flex-end;justify-content:space-between;gap:18px;margin-bottom:18px;flex-wrap:wrap}
.dv-hdr h2{font-size:22px;margin:0;font-weight:800;letter-spacing:-.015em}
.dv-hdr p{margin:5px 0 0;color:var(--mut);max-width:62ch}
.dv-tabs{display:flex;gap:2px;background:#e9edf3;padding:3px;border-radius:10px}
.dv-tabs button{border:0;background:transparent;padding:7px 15px;border-radius:8px;font:inherit;font-weight:600;color:var(--mut);cursor:pointer}
.dv-tabs button.on{background:#fff;color:var(--ink);box-shadow:0 1px 2px rgba(16,34,59,.12)}
.dv-kpis{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px;margin-bottom:14px}
.dv-kpi{background:#fff;border:1px solid var(--line);border-radius:13px;padding:13px 15px;min-width:0}
.dv-kpi small{display:block;color:var(--mut);font-weight:600;font-size:11px;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dv-kpi b{display:block;font-size:25px;font-weight:800;letter-spacing:-.025em;margin-top:5px;font-variant-numeric:tabular-nums;line-height:1.1}
.dv-kpi i{display:block;font-style:normal;font-size:11.5px;font-weight:600;color:var(--mut);margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dv-kpi i.up{color:var(--ok)}.dv-kpi i.down{color:var(--bad)}
.dv-kpi.hot{border-color:#fdba74;background:#fff8f3}.dv-kpi.hot b{color:var(--o)}.dv-kpi.hot i{color:var(--o)}
.dv-pipe{background:#fff;border:1px solid var(--line);border-radius:13px;padding:13px 15px;margin-bottom:14px}
.dv-pipe .h{display:flex;justify-content:space-between;gap:12px;margin-bottom:10px;flex-wrap:wrap}
.dv-pipe .h b{font-size:11px;letter-spacing:.09em;color:var(--mut);text-transform:uppercase}
.dv-pipe .h span{color:var(--mut);font-size:12px}
.dv-stages{display:flex;gap:7px}
.dv-stg{flex:1;min-width:0;padding:9px 11px;border-radius:9px;background:var(--soft);border:1px solid var(--line);position:relative;cursor:pointer;text-align:left}
.dv-stg:hover{background:#f1f5fb}.dv-stg.on{border-color:var(--b);background:#eff7ff;box-shadow:0 0 0 2px rgba(8,131,247,.1)}
.dv-stg u{display:flex;justify-content:space-between;gap:6px;text-decoration:none;color:var(--mut);font-weight:600;font-size:11px;letter-spacing:.04em;text-transform:uppercase}
.dv-stg u i{font-style:normal;font-weight:500;text-transform:none;letter-spacing:0;white-space:nowrap}
.dv-stg b{display:block;font-size:19px;font-weight:800;margin-top:2px;font-variant-numeric:tabular-nums}
.dv-stg:after{content:"›";position:absolute;right:-8px;top:50%;transform:translateY(-50%);color:#c3ccd8;font-size:15px;z-index:1}
.dv-stg:last-child:after{display:none}
.dv-need{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:16px}
.dv-card{background:#fff;border:1px solid var(--line);border-radius:13px;padding:13px 15px;min-width:0}
.dv-card h4{margin:0 0 8px;font-size:11px;letter-spacing:.09em;color:var(--mut);text-transform:uppercase;display:flex;justify-content:space-between;gap:8px}
.dv-card h4 span{color:var(--o);font-weight:700}
.dv-it{display:flex;align-items:center;gap:10px;padding:8px 0;border-top:1px solid #f1f4f8}
.dv-it:first-of-type{border-top:0}
.dv-it b{font-weight:600;display:block;font-size:13px}.dv-it small{color:var(--mut)}
.dv-it .dv-btn{margin-left:auto}
.dv-empty{color:var(--mut);padding:6px 0}
.dv-av{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;color:#fff;font-weight:800;font-size:11px;flex:none}
.dv-filters{display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap}
.dv-chip{border:1px solid var(--line);background:#fff;border-radius:999px;padding:6px 13px;font:inherit;font-weight:600;font-size:12.5px;color:var(--ink);cursor:pointer}
.dv-chip:hover{background:var(--soft)}.dv-chip.on{background:var(--n);color:#fff;border-color:var(--n)}
.dv-filters .r{margin-left:auto;color:var(--mut);font-size:12.5px;display:flex;gap:6px;align-items:center}
.dv-wrap{overflow-x:auto;border:1px solid var(--line);border-radius:13px;background:#fff}
.dv-tbl{width:100%;border-collapse:separate;border-spacing:0;min-width:1040px}
.dv-tbl th{text-align:left;font-size:11px;letter-spacing:.07em;text-transform:uppercase;color:var(--mut);font-weight:700;padding:10px 14px;background:var(--soft);border-bottom:1px solid var(--line);white-space:nowrap}
.dv-tbl td{padding:10px 14px;border-bottom:1px solid #f1f4f8;vertical-align:middle;white-space:nowrap}
.dv-tbl tbody tr:last-child td{border-bottom:0}
.dv-tbl tbody tr{cursor:pointer}
.dv-tbl tbody tr:hover td,.dv-tbl tbody tr.cur td{background:#f5f9ff}
.dv-tbl tbody tr.cur td:first-child{box-shadow:inset 3px 0 0 var(--b)}
.dv-tbl tbody tr.sel td{background:#fff7f2}
.dv-who{display:flex;gap:11px;align-items:center;min-width:0}
.dv-who .dv-av{width:34px;height:34px;border-radius:10px;font-size:12px}
.dv-who b{display:block;font-weight:700}
.dv-who small{display:block;color:var(--mut);font-size:12px}
.dv-st{display:inline-flex;align-items:center;gap:7px;font-weight:600;font-size:12.5px;padding:4px 11px;border-radius:999px;background:#f1f5f9;color:#334155}
.dv-st:before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor;flex:none}
.dv-sc{display:inline-flex;align-items:center;gap:8px;font-weight:700;font-size:13px}
.dv-ring{width:30px;height:30px;border-radius:50%;display:grid;place-items:center;flex:none}
.dv-ring i{width:22px;height:22px;border-radius:50%;background:#fff;display:grid;place-items:center;font-style:normal;font-size:10.5px;font-weight:800;color:var(--n)}
.dv-sigs{display:flex;flex-direction:column;gap:3px}
.dv-sig{display:inline-flex;align-items:center;gap:6px;font-size:12px;font-weight:600;color:#334155;white-space:nowrap}
.dv-sig:before{content:"";width:6px;height:6px;border-radius:50%;background:#94a3b8;flex:none}
.dv-sig.r:before{background:var(--bad)}.dv-sig.a:before{background:#d97706}.dv-sig.g:before{background:var(--ok)}.dv-sig.b:before{background:var(--b)}
.dv-mut{color:var(--mut)}
.dv-act{display:flex;gap:6px;justify-content:flex-end;opacity:0;transition:opacity .12s}
.dv-tbl tbody tr:hover .dv-act,.dv-tbl tbody tr.cur .dv-act{opacity:1}
.dv-foot{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:11px 14px;color:var(--mut);background:#fff;border:1px solid var(--line);border-top:0;border-radius:0 0 13px 13px;flex-wrap:wrap}
.dv-bulk{display:flex;gap:9px;align-items:center;padding:9px 14px;background:#fff7f2;border:1px solid #fed7aa;border-bottom:0;border-radius:13px 13px 0 0;font-size:13px}
.dv-chk{width:16px;height:16px;accent-color:var(--o);cursor:pointer}
.dv-board{display:grid;grid-template-columns:repeat(6,minmax(210px,1fr));gap:12px;overflow-x:auto;padding-bottom:6px}
.dv-col{background:var(--soft);border:1px solid var(--line);border-radius:13px;padding:10px;min-width:210px}
.dv-col h5{margin:0 0 9px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--mut);display:flex;justify-content:space-between;align-items:center}
.dv-col h5 b{font-size:15px;color:var(--ink);letter-spacing:-.02em}
.dv-cc{background:#fff;border:1px solid var(--line);border-radius:10px;padding:10px 11px;margin-bottom:8px;cursor:pointer}
.dv-cc:hover{border-color:var(--b);box-shadow:0 2px 10px rgba(16,34,59,.07)}
.dv-cc b{display:block;font-weight:700;font-size:13px}
.dv-cc small{display:block;color:var(--mut);font-size:11.5px;margin-top:2px}
.dv-cc .tags{display:flex;gap:5px;flex-wrap:wrap;margin-top:7px}
.dv-tag{font-size:11px;font-weight:700;padding:2px 7px;border-radius:6px;background:#f1f5f9;color:#334155}
.dv-tag.g{background:#e7f6ec;color:var(--ok)}.dv-tag.a{background:#fef3c7;color:#92400e}.dv-tag.r{background:#fee2e2;color:var(--bad)}.dv-tag.b{background:#e8f2ff;color:#0b5cad}
.dv-state{padding:34px;text-align:center;color:var(--mut)}
.dv-money{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-bottom:14px}
@media (max-width:1180px){.dv-kpis{grid-template-columns:repeat(3,minmax(0,1fr))}.dv-need{grid-template-columns:1fr}}
@media (max-width:760px){.dv-kpis{grid-template-columns:repeat(2,minmax(0,1fr))}.dv-stages{flex-wrap:wrap}.dv-stg{min-width:44%}.dv-stg:after{display:none}.dv-money{grid-template-columns:1fr}}
/* ---- bl_disp_0317: Pipeline board v2 + Work queue v2 ---- */
.dv-flow{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:14px}
.dv-fl{background:#fff;border:1px solid var(--line);border-radius:12px;padding:11px 14px;position:relative}
.dv-fl b{font:800 20px/1 var(--lb-head,inherit);font-variant-numeric:tabular-nums}
.dv-fl span{display:flex;gap:5px;align-items:center;font-size:10.3px;letter-spacing:.07em;text-transform:uppercase;color:#9aa8ba;font-weight:800;margin-top:4px}
.dv-fl em{font-style:normal;font-size:11px;color:var(--mut);font-weight:700;display:block;margin-top:3px}
.dv-fl:after{content:"›";position:absolute;right:-9px;top:14px;color:#c3cede;font-size:18px;font-weight:800}.dv-fl:last-child:after{display:none}
.dv-tools{display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap;font-size:12px;color:var(--mut)}
.dv-tools .cc-ico{color:#9aa8ba}
.dv-chip{display:inline-flex;align-items:center;gap:5px;padding:4px 10px;border-radius:999px;font-size:11.5px;font-weight:800;background:#fff;border:1px solid var(--line);color:#334155;cursor:pointer;white-space:nowrap}
.dv-chip.on{background:var(--n);color:#fff;border-color:var(--n)}.dv-chip.hot{background:rgba(252,83,5,.12);color:#c2410c;border-color:#f5cbb0}
.dv-board2{display:grid;gap:12px;align-items:start}
.dv-col2{background:#eef1f6;border:1px solid #e3e8ef;border-radius:15px;padding:10px;min-height:320px;min-width:0}
.dv-col2.hot{background:#fdf3ec;border-color:#f3d2ba}
.dv-col2 .ch{display:flex;align-items:center;gap:7px;padding:2px 4px 6px}.dv-col2 .ch .cc-ico{color:#9aa8ba}
.dv-col2 .ch b{font-size:12.4px;font-weight:800;font-family:var(--lb-head,inherit)}
.dv-col2 .ch i{font-style:normal;background:#fff;border:1px solid var(--line);border-radius:999px;padding:1px 7px;font-size:11px;font-weight:800;color:#475569}
.dv-col2 .ch i.hot{background:var(--o);border-color:var(--o);color:#fff}
.dv-col2 .sub{font-size:10.5px;color:#7b8ca3;font-weight:800;letter-spacing:.06em;text-transform:uppercase;padding:0 4px 10px}
.dv-c{background:#fff;border:1px solid var(--line);border-radius:12px;padding:11px;margin-bottom:9px;box-shadow:0 1px 2px rgba(16,34,59,.05);cursor:pointer;position:relative}
.dv-c:hover{box-shadow:0 8px 20px -10px rgba(16,34,59,.4);transform:translateY(-1px);border-color:var(--b)}
.dv-c.stuck{border-color:#f0b48c;background:linear-gradient(180deg,#fffaf6,#fff)}.dv-c.new{border-left:3px solid var(--b)}
.dv-c .t{display:flex;gap:9px;align-items:center}
.dv-av{width:30px;height:30px;border-radius:9px;display:grid;place-items:center;font:800 10.5px var(--lb-head,inherit);color:#fff;flex:none}
.dv-c .t>div{min-width:0}.dv-c .nm{font-size:12.7px;display:block;line-height:1.25;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding-right:22px}
.dv-c .lo{font-size:10.9px;color:var(--mut);font-weight:600;display:flex;gap:4px;align-items:center}.dv-c .lo .cc-ico{color:#9aa8ba}
.dv-c .op{position:absolute;right:8px;top:9px;width:22px;height:22px;border-radius:6px;display:grid;place-items:center;color:#9aa8ba;background:var(--soft)}
.dv-c .chips{display:flex;gap:4px;flex-wrap:wrap;margin-top:8px}
.dv-c .chips span{display:inline-flex;gap:3px;align-items:center;font-size:10.2px;font-weight:800;padding:2px 6px;border-radius:6px;background:#eef2f7;color:#475569}
.dv-c .chips span.g{background:rgba(22,163,74,.12);color:#15803d}.dv-c .chips span.o{background:rgba(252,83,5,.13);color:#c2410c}
.dv-c .chips span.r{background:rgba(220,38,38,.1);color:#b91c1c}.dv-c .chips span.b{background:rgba(8,131,247,.11);color:#0466c8}
.dv-c .age{display:flex;align-items:center;gap:6px;margin-top:9px;font-size:10.8px;color:var(--mut);font-weight:700}
.dv-c .age .cc-ico{color:#9aa8ba}.dv-c .age .tr{flex:1;height:4px;border-radius:3px;background:#eef2f7;overflow:hidden}.dv-c .age .tr i{display:block;height:100%}
.dv-c .na{margin-top:8px;border-top:1px dashed var(--line);padding-top:8px;font-size:11.3px;font-weight:800;color:var(--n);display:flex;align-items:center;gap:6px}
.dv-c .na .cc-ico{color:var(--b)}.dv-c.stuck .na .cc-ico{color:var(--o)}
.dv-more{text-align:center;font-size:11.4px;font-weight:800;color:var(--mut);padding:7px;border-radius:9px;background:rgba(255,255,255,.75)}
.dv-qg{display:grid;grid-template-columns:240px minmax(0,1fr) 320px;gap:18px;align-items:start}
.dv-qcard{background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:0 1px 1px rgba(16,34,59,.04),0 2px 6px rgba(16,34,59,.04)}
.dv-qh{display:flex;align-items:center;gap:9px;padding:13px 18px;border-bottom:1px solid #eef1f5}
.dv-qh .ico{width:30px;height:30px;border-radius:9px;background:var(--soft);display:grid;place-items:center;color:var(--n)}
.dv-qh h3{margin:0;font-size:13.5px;font-weight:800;font-family:var(--lb-head,inherit)}.dv-qh .s{font-size:11.8px;color:var(--mut);font-weight:600}
.dv-qh .sp{margin-left:auto;display:flex;gap:6px;align-items:center}
.dv-ql{padding:8px}.dv-ql a{display:flex;gap:9px;align-items:center;padding:8px 10px;border-radius:10px;font-size:12.8px;font-weight:700;color:#334155;cursor:pointer}
.dv-ql a .cc-ico{color:#9aa8ba}.dv-ql a.on{background:var(--n);color:#fff}.dv-ql a.on .cc-ico{color:#5db2ff}
.dv-ql a i{font-style:normal;margin-left:auto;font-size:11px;font-weight:800;background:#eef2f7;color:#475569;border-radius:999px;padding:1px 7px}
.dv-ql a.on i{background:rgba(255,255,255,.18);color:#fff}.dv-ql a i.hot{background:var(--o);color:#fff}
.dv-sum{display:grid;grid-template-columns:repeat(4,1fr);gap:11px;margin-bottom:16px}
.dv-sum div{background:#fff;border:1px solid var(--line);border-radius:13px;padding:12px 14px}
.dv-sum b{display:block;font:800 22px/1 var(--lb-head,inherit);font-variant-numeric:tabular-nums}
.dv-sum span{font-size:10.3px;letter-spacing:.06em;text-transform:uppercase;color:#9aa8ba;font-weight:800;display:flex;gap:5px;align-items:center;margin-top:5px}
.dv-sum div.o{border-color:#f3d2ba;background:linear-gradient(180deg,#fffaf6,#fff)}.dv-sum div.o b{color:#c2410c}
.dv-it{display:flex;gap:13px;padding:14px 16px;border-top:1px solid #eef1f5;align-items:flex-start}
.dv-it:first-of-type{border-top:0}.dv-it.p1{background:linear-gradient(90deg,#fff8f3,#fff 40%);border-left:3px solid var(--o)}
.dv-it .pr{width:24px;height:24px;border-radius:7px;display:grid;place-items:center;font:800 11px var(--lb-head,inherit);flex:none;margin-top:6px;background:#eef2f7;color:#475569}
.dv-it .pr.hot{background:var(--o);color:#fff}
.dv-it .h{font-size:13.6px;display:block;font-weight:800}.dv-it .d{font-size:12.3px;color:var(--mut);margin-top:2px;line-height:1.55}
.dv-it .m{display:flex;gap:7px;flex-wrap:wrap;margin-top:8px;align-items:center}
.dv-sla{display:inline-flex;gap:4px;align-items:center;font-size:10.6px;font-weight:800;letter-spacing:.03em;padding:2px 7px;border-radius:6px;background:#eef2f7;color:#475569}
.dv-sla .cc-ico{width:11px;height:11px}.dv-sla.r{background:rgba(220,38,38,.1);color:#b91c1c}.dv-sla.o{background:rgba(252,83,5,.13);color:#c2410c}.dv-sla.g{background:rgba(22,163,74,.12);color:#15803d}
.dv-it .act{margin-left:auto;display:flex;gap:7px;align-items:center;flex:none}
.dv-lnk{display:inline-flex;align-items:center;gap:5px;font:600 11px ui-monospace,monospace;color:var(--mut);background:var(--soft);border:1px solid var(--line);border-radius:7px;padding:2px 7px;white-space:nowrap}
.dv-qside{display:flex;flex-direction:column;gap:16px}
@media (max-width:1180px){.dv-qg{grid-template-columns:220px minmax(0,1fr)}.dv-qside.right{grid-column:1/-1}}
@media (max-width:760px){
  .dv-flow{grid-template-columns:1fr 1fr;gap:8px}.dv-fl:after{display:none}
  .dv-board2{display:flex;overflow-x:auto;gap:10px;scroll-snap-type:x mandatory;margin:0 -14px;padding:0 14px 20px}.dv-col2{flex:0 0 82vw;scroll-snap-align:start;min-height:0}
  .dv-qg{grid-template-columns:1fr;gap:14px}.dv-qside.left{order:2}.dv-qside.right{order:3}
  .dv-ql{display:flex;flex-wrap:wrap;gap:6px}.dv-ql a{padding:6px 10px;border:1px solid var(--line);border-radius:999px;font-size:12px}.dv-ql a i{margin-left:4px}
  .dv-sum{grid-template-columns:1fr 1fr;gap:8px}
  .dv-it{flex-wrap:wrap;padding:13px 14px}.dv-it .pr{display:none}.dv-it>div[style*="flex:1"]{flex-basis:calc(100% - 50px)}
  .dv-it .act{margin-left:0;width:100%}.dv-it .act .dv-btn{flex:1}
}

`));
}

const initials = (n) => { const p = String(n || '').trim().split(/\s+/).filter(Boolean).slice(0, 2); return p.length ? p.map((w) => w[0]).join('').toUpperCase() : '?'; };
const hue = (k) => { let h = 0; const s = String(k || ''); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h % 360; };
const num = (n) => Number(n || 0).toLocaleString('en-US');
const usd = (n) => '$' + Math.round(Number(n || 0)).toLocaleString('en-US');
const days = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 864e5) : null);
const ago = (iso) => {
  if (!iso) return '—';
  const m = (Date.now() - new Date(iso).getTime()) / 6e4;
  if (m < 2) return 'just now';
  if (m < 60) return Math.floor(m) + ' min ago';
  if (m < 1440) return Math.floor(m / 60) + ' h ago';
  const d = Math.floor(m / 1440);
  if (d === 1) return 'yesterday';
  if (d < 30) return d + ' d ago';
  return fmtDate(iso);
};
const SEARCH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>';

export function renderRoster(host, ctx) {
  css();
  const initTab = (() => { try { const t = new URLSearchParams((location.hash.split('?')[1] || '')).get('tab'); return ['roster', 'board', 'queue', 'payouts'].includes(t) ? t : 'roster'; } catch (_) { return 'roster'; } })();
  const st = { tab: initTab, q: '', stage: 'all', rows: [], more: false, loading: false,
               stats: null, board: null, pay: null, cur: -1, sel: new Set(), seq: 0 };

  const input = el('input', { placeholder: 'Search dispatchers by name, e-mail or country', value: '' });
  const bulkBtn = el('button', { class: 'dv-btn o', disabled: true, onClick: sendTests }, 'Send skills test');
  const csvBtn = el('button', { class: 'dv-btn', onClick: exportCsv }, 'Export CSV');
  const panel = el('div');
  const tabBar = el('div', { class: 'dv-tabs' });
  let tmr = null;
  input.oninput = () => { clearTimeout(tmr); tmr = setTimeout(() => { st.q = input.value.trim(); fetchFirst(); }, 260); };

  mount(host, el('div', { class: 'dv' }, [
    el('div', { class: 'dv-top' }, [
      el('div', { class: 'dv-search' }, [el('span', { html: SEARCH }), input]),
      el('span', { class: 'dv-kbd' }, '/'),
      el('span', { style: 'flex:1' }),
      csvBtn, bulkBtn,
    ]),
    el('div', { class: 'dv-hdr' }, [
      el('div', null, [
        el('h2', null, 'Dispatchers'),
        el('p', null, 'Hiring pipeline → live workforce. One dedicated dispatcher per carrier; nothing moves until the rate confirmation is approved.'),
      ]),
      tabBar,
    ]),
    panel,
  ]));
  paintTabs();
  document.addEventListener('keydown', onKey);

  // ------------------------------------------------------------------ keyboard
  function onKey(e) {
    if (!document.body.contains(host)) { document.removeEventListener('keydown', onKey); return; }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName);
    if (e.key === '/' && !typing) { e.preventDefault(); input.focus(); return; }
    if (st.tab !== 'roster' || (typing && document.activeElement !== input)) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); st.cur = Math.max(0, Math.min(st.rows.length - 1, st.cur + (e.key === 'ArrowDown' ? 1 : -1)));
      paintRoster(); const r = panel.querySelector('tr.cur'); if (r) r.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && st.cur >= 0 && st.rows[st.cur]) { e.preventDefault(); ctx.open360(st.rows[st.cur]); }
    else if (e.key === 'Escape' && document.activeElement === input) { input.value = ''; st.q = ''; input.blur(); fetchFirst(); }
  }

  // ------------------------------------------------------------------ data
  async function fetchStats() { const s = await ccDispatchersStats().catch(() => null); if (s && !s.error) { st.stats = s; if (st.tab === 'roster') paintRoster(); } }
  async function fetchFirst() { st.rows = []; st.more = false; st.cur = -1; st.sel.clear(); syncBulk(); await fetchPage(); }
  async function fetchPage() {
    if (st.loading) return; st.loading = true; const seq = ++st.seq;
    const last = st.rows[st.rows.length - 1];
    if (!st.rows.length && st.tab === 'roster') mount(panel, el('div', { class: 'dv-state' }, 'Loading dispatchers…'));
    let r;
    try { r = await ccDispatchersPage({ q: st.q, status: st.stage, before: last ? last.applied_at : null, beforeId: last ? last.user_id : null, limit: PAGE }); }
    catch (e) { r = { error: humanizeError(e) }; }
    st.loading = false;
    if (seq !== st.seq) return;
    if (!r || r.error) { mount(panel, el('div', { class: 'dv-state' }, (r && r.error) || 'Could not load')); return; }
    st.rows = st.rows.concat(r.rows || []); st.more = !!r.has_more;
    if (ctx.onRows) ctx.onRows(st.rows);
    if (st.tab === 'roster') paintRoster();
  }
  async function fetchBoard() { const b = await ccDispatchersBoard(14).catch(() => null); st.board = (b && !b.error) ? b : {}; if (st.tab === 'board') paintBoard(); }
  async function fetchPay() { const p = await ccDispatcherPayouts(null, 200).catch(() => null); st.pay = (p && !p.error) ? p : { totals: {}, rows: [] }; if (st.tab === 'payouts') paintPayouts(); }

  // ------------------------------------------------------------------ actions
  function syncBulk() { bulkBtn.disabled = st.sel.size === 0; bulkBtn.textContent = st.sel.size ? 'Send skills test · ' + st.sel.size : 'Send skills test'; }
  async function sendTests() {
    const ids = [...st.sel]; if (!ids.length) return;
    const who = st.rows.filter((r) => st.sel.has(r.user_id));
    const ok = await askConfirm('Send the skills test to ' + ids.length + ' candidate' + (ids.length === 1 ? '' : 's') + '?',
      { body: '45 minutes, one attempt, must be started within 48 hours. Each candidate receives the invitation e-mail immediately: ' + who.map((w) => w.name || w.email).join(', ') });
    if (!ok) return;
    let sent = 0, failed = 0;
    for (const id of ids) { const r = await ccDispatcherTestInvite(id, 45, 48).catch(() => ({ error: 1 })); if (r && r.error) failed++; else sent++; }
    toast('✓ ' + sent + ' invitation' + (sent === 1 ? '' : 's') + ' sent' + (failed ? ' · ' + failed + ' failed' : ''));
    st.sel.clear(); syncBulk(); refresh();
  }
  function exportCsv() {
    const head = ['Name', 'E-mail', 'Country', 'Years', 'Stage', 'Applied', 'Last activity', 'Test', 'Score', 'Carriers', 'Trucks', 'Open RC', 'Delivered', 'Owed USD'];
    const line = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const body = st.rows.map((r) => [r.name, r.email, r.country, r.years_exp, LABEL[r.status] || r.status,
      r.applied_at ? fmtDate(r.applied_at) : '', r.last_activity ? fmtDateTime(r.last_activity) : '',
      r.test ? (r.test.decision || r.test.status) : '', r.test ? (r.test.score == null ? '' : r.test.score) : '',
      r.carriers, r.active_trucks, r.open_rc, r.delivered, Math.round(Number(r.owed || 0))].map(line).join(','));
    const csv = head.map(line).join(',') + '\n' + body.join('\n');
    const a = el('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'loadboot-dispatchers-' + new Date().toISOString().slice(0, 10) + '.csv' });
    document.body.appendChild(a); a.click(); a.remove();
  }

  // ------------------------------------------------------------------ tabs
  function paintTabs() {
    const tabs = [['roster', 'Roster'], ['board', 'Pipeline board'], ['queue', 'Work queue'], ['payouts', 'Payouts']];
    mount(tabBar, tabs.map(([k, label]) => el('button', { class: st.tab === k ? 'on' : '', onClick: () => go(k) }, label)));
  }
  function go(tab) {
    st.tab = tab; paintTabs();
    try { history.replaceState(null, '', '#/dispatchers' + (tab === 'roster' ? '' : '?tab=' + tab)); } catch (_) {}
    if (tab === 'roster') { paintRoster(); if (!st.rows.length) fetchFirst(); }
    else if (tab === 'board') { paintBoard(); if (!st.board) fetchBoard(); }
    else if (tab === 'queue') paintQueueTab();
    else { paintPayouts(); if (!st.pay) fetchPay(); }
  }

  // ------------------------------------------------------------------ roster tab
  function kpis() {
    const s = st.stats || {}; const by = s.by_status || {};
    const pipeline = ['applied', 'screening', 'skills_test'].reduce((a, k) => a + Number(by[k] || 0), 0);
    const needs = Number(s.tests_to_review || 0) + Number(s.tests_scored_untold || 0) + Number(s.rc_open || 0) + Number(s.trials_ending_3d || 0);
    const needBits = [];
    if (s.tests_to_review) needBits.push(s.tests_to_review + ' test to review');
    if (s.tests_scored_untold) needBits.push(s.tests_scored_untold + ' result to send');
    if (s.rc_open) needBits.push(s.rc_open + ' RC to approve');
    if (s.trials_ending_3d) needBits.push(s.trials_ending_3d + ' trial ending');
    const tile = (label, value, note, cls, onClick) => el('div', { class: 'dv-kpi' + (cls ? ' ' + cls : ''), style: onClick ? 'cursor:pointer' : '', onClick: onClick || undefined },
      [el('small', null, label), el('b', null, value), el('i', { class: cls === 'hot' ? '' : 'm' }, note)]);
    return el('div', { class: 'dv-kpis' }, [
      tile('Total dispatchers', num(s.total), (s.applied_7d ? '+' + s.applied_7d + ' this week' : 'no new applications')),
      tile('In pipeline', num(pipeline), num(by.screening || 0) + ' screening · ' + num(by.skills_test || 0) + ' test', '', () => { st.stage = 'screening'; fetchFirst(); }),
      tile('On trial', num(by.trial || 0), s.trials_ending_7d ? s.trials_ending_7d + ' ending in 7 days' : 'none ending this week', '', () => { st.stage = 'trial'; fetchFirst(); }),
      tile('Active on carriers', num(Number(by.active || 0) + Number(by.verified || 0)), num(s.active_trucks) + ' trucks · ' + num(s.carriers_covered) + ' carriers'),
      tile('Needs you now', num(needs), needBits.join(' · ') || 'nothing waiting', needs ? 'hot' : ''),
      tile('Commission owed', usd(s.owed_total), s.paid_30d ? usd(s.paid_30d) + ' paid in 30 days' : 'nothing paid in 30 days', '', () => go('payouts')),
    ]);
  }
  function pipeStrip() {
    const s = st.stats || {}; const by = s.by_status || {};
    const conv = s.conversion_pct == null ? 'no data yet' : 'conversion applied → active: ' + s.conversion_pct + '%';
    const med = s.median_days_screening == null ? '' : ' · median age in screening ' + s.median_days_screening + ' d';
    const tiles = STAGES.map(([k, label]) => el('button', { class: 'dv-stg' + (st.stage === k ? ' on' : ''), onClick: () => { st.stage = k; fetchFirst(); } }, [
      el('u', null, [label, el('i', null, k === 'skills_test' && s.tests_to_review ? s.tests_to_review + ' to review' : (k === 'trial' && s.trials_ending_7d ? s.trials_ending_7d + ' ending' : ''))]),
      el('b', { style: 'color:' + COLOR[k] }, num(by[k] || 0)),
    ]));
    EXTRA.forEach(([k, label]) => { if (by[k]) tiles.push(el('button', { class: 'dv-stg' + (st.stage === k ? ' on' : ''), style: 'flex:.6;background:#fff5f5', onClick: () => { st.stage = k; fetchFirst(); } },
      [el('u', null, label), el('b', { style: 'color:' + COLOR[k] }, num(by[k]))])); });
    return el('div', { class: 'dv-pipe' }, [
      el('div', { class: 'h' }, [el('b', null, 'Pipeline · click a stage to filter'), el('span', null, conv + med)]),
      el('div', { class: 'dv-stages' }, tiles),
    ]);
  }
  function needCards() {
    const s = st.stats || {};
    const tests = st.rows.filter((r) => r.test && (r.test.status === 'submitted' || (r.test.status === 'scored' && !r.test.told))).slice(0, 3);
    const trials = st.rows.filter((r) => r.status === 'trial' && r.trial_end).slice(0, 3);
    const rc = st.rows.filter((r) => Number(r.open_rc) > 0).slice(0, 3);
    const item = (r, note, label) => el('div', { class: 'dv-it' }, [
      el('div', { class: 'dv-av', style: 'background:hsl(' + hue(r.user_id) + ' 55% 42%)' }, initials(r.name)),
      el('div', { style: 'min-width:0' }, [el('b', null, r.name || r.email || '—'), el('small', null, note)]),
      el('button', { class: 'dv-btn sm', onClick: (e) => { e.stopPropagation(); ctx.open360(r); } }, label),
    ]);
    return el('div', { class: 'dv-need' }, [
      el('div', { class: 'dv-card' }, [
        el('h4', null, ['Tests to review', el('span', null, (Number(s.tests_to_review || 0) + Number(s.tests_scored_untold || 0)) ? (Number(s.tests_to_review || 0) + Number(s.tests_scored_untold || 0)) + ' waiting' : '')]),
        tests.length ? tests.map((r) => item(r, r.test.status === 'submitted' ? 'submitted ' + ago(r.test.submitted_at) + ' · not yet marked'
          : (r.test.score + ' / ' + (r.test.max || 100) + ' · ' + (r.test.decision || 'scored') + ' · candidate not told'), 'Review'))
          : el('div', { class: 'dv-empty' }, 'Nothing waiting — every submitted test is marked and sent.'),
      ]),
      el('div', { class: 'dv-card' }, [
        el('h4', null, ['RC approvals', el('span', null, s.rc_open ? s.rc_open + ' open' : '')]),
        rc.length ? rc.map((r) => item(r, r.open_rc + ' rate confirmation' + (r.open_rc > 1 ? 's' : '') + ' waiting', 'Open'))
          : el('div', { class: 'dv-empty' }, 'Nothing waiting — every rate confirmation is approved.'),
      ]),
      el('div', { class: 'dv-card' }, [
        el('h4', null, ['Trials ending', el('span', null, s.trials_ending_7d ? String(s.trials_ending_7d) : '')]),
        trials.length ? trials.map((r) => { const d = Math.ceil((new Date(r.trial_end) - Date.now()) / 864e5);
          const el0 = r.trial_start ? Math.floor((Date.now() - new Date(r.trial_start).getTime()) / 864e5) + 1 : null;
          const head = d >= 0 ? (el0 ? 'day ' + el0 + ' · ends in ' + d + ' d' : 'ends in ' + d + ' d') : 'trial overdue by ' + Math.abs(d) + ' d';
          return item(r, head + ' · ' + num(r.delivered) + ' delivered', 'Review'); })
          : el('div', { class: 'dv-empty' }, 'No trial is running.'),
      ]),
    ]);
  }
  function testCell(x) {
    const t = x.test; if (!t) return el('span', { class: 'dv-mut' }, x.status === 'screening' ? 'not invited' : '—');
    if (t.status === 'scored' && t.score != null) {
      const pct = Math.round(100 * Number(t.score) / (Number(t.max) || 100));
      const c = t.decision === 'pass' ? '#12803c' : t.decision === 'fail' ? '#b91c1c' : '#d97706';
      return el('span', { class: 'dv-sc', title: (t.decision || 'scored') + (t.told ? ' · candidate told' : ' · candidate NOT told') }, [
        el('span', { class: 'dv-ring', style: 'background:conic-gradient(' + c + ' ' + pct + '%,#e5e9f0 0)' }, el('i', null, String(t.score))),
        el('span', { style: 'color:' + c }, t.decision === 'pass' ? 'Pass' : t.decision === 'fail' ? 'Fail' : 'Scored'),
        t.told ? '' : el('span', { title: 'Result not sent yet', style: 'width:7px;height:7px;border-radius:50%;background:#FC5305;display:inline-block' }),
      ]);
    }
    const m = { invited: ['Invited', '#64748b'], in_progress: ['Live now', '#0883F7'], submitted: ['To review', '#FC5305'], expired: ['Expired', '#b91c1c'] }[t.status] || [t.status, '#64748b'];
    return el('span', { class: 'dv-sc', style: 'color:' + m[1] }, m[0]);
  }
  function rowActions(x) {
    const b = [];
    if (x.status === 'screening') b.push(el('button', { class: 'dv-btn sm o', onClick: async (e) => {
      e.stopPropagation();
      if (!(await askConfirm('Send the skills test to ' + (x.name || 'this candidate') + '?', { body: '45 minutes, one attempt, must start within 48 hours. The invitation e-mail goes out immediately.' }))) return;
      const r = await ccDispatcherTestInvite(x.user_id, 45, 48).catch((err) => ({ error: humanizeError(err) }));
      if (r && r.error) { toast(r.error); return; } toast('✓ invitation sent'); refresh();
    } }, 'Send test'));
    if (x.test && x.test.status === 'submitted') b.push(el('button', { class: 'dv-btn sm o', onClick: (e) => { e.stopPropagation(); ctx.open360(x); } }, 'Mark test'));
    if (x.test && x.test.status === 'scored' && !x.test.told) b.push(el('button', { class: 'dv-btn sm o', onClick: (e) => { e.stopPropagation(); ctx.open360(x); } }, 'Send result'));
    if (x.status === 'skills_test' && x.test && x.test.told && x.test.decision === 'pass') b.push(el('button', { class: 'dv-btn sm o', onClick: (e) => { e.stopPropagation(); ctx.open360(x); } }, 'Set up trial'));
    b.push(el('button', { class: 'dv-btn sm', onClick: (e) => { e.stopPropagation(); ctx.open360(x); } }, 'Open'));
    return el('div', { class: 'dv-act' }, b);
  }
  function rowNode(x, i) {
    const checked = st.sel.has(x.user_id);
    const sig = [];
    if (Number(x.open_rc)) sig.push(el('span', { class: 'dv-sig r' }, x.open_rc + ' RC to approve'));
    if (Number(x.moving)) sig.push(el('span', { class: 'dv-sig b' }, x.moving + ' load' + (x.moving > 1 ? 's' : '') + ' moving'));
    if (Number(x.carriers)) sig.push(el('span', { class: 'dv-sig g' }, x.carriers + ' carrier' + (x.carriers > 1 ? 's' : '') + ' · ' + num(x.active_trucks) + ' truck' + (Number(x.active_trucks) === 1 ? '' : 's')));
    if (x.status === 'trial') sig.push(el('span', { class: 'dv-sig a' }, num(x.delivered) + ' delivered'));
    if (Number(x.owed) > 0) sig.push(el('span', { class: 'dv-sig a' }, money(x.owed) + ' to pay'));
    if (x.referral_opted) sig.push(el('span', { class: 'dv-sig', title: 'Also a Referral Partner (1%) — same account' }, '⚡ Referral partner' + (Number(x.referred_n) > 0 ? ' · ' + x.referred_n + ' referred' : '')));  // bl_agent_0405
    try { (ctx.signals ? ctx.signals(x) : []).forEach((n) => { if (n) sig.push(n); }); } catch (_) {}
    const sd = days(x.stage_since);
    return el('tr', { class: (i === st.cur ? 'cur' : '') + (checked ? ' sel' : ''), onClick: () => { st.cur = i; ctx.open360(x); } }, [
      el('td', null, el('input', { type: 'checkbox', class: 'dv-chk', checked: checked ? '' : undefined,
        onClick: (e) => { e.stopPropagation(); if (e.target.checked) st.sel.add(x.user_id); else st.sel.delete(x.user_id); syncBulk(); paintRoster(); } })),
      el('td', null, el('div', { class: 'dv-who' }, [
        el('div', { class: 'dv-av', style: 'background:hsl(' + hue(x.user_id) + ' 55% 42%)' }, initials(x.name)),
        el('div', { style: 'min-width:0' }, [el('b', null, x.name || '(no name)'), el('small', null, x.email || '')]),
      ])),
      el('td', null, [el('div', null, x.country || '—'),
        el('small', { class: 'dv-mut' }, (x.years_exp == null ? '—' : x.years_exp + (Number(x.years_exp) === 1 ? ' yr' : ' yrs')) + (Number(x.commission_pct) > 0 ? ' · ' + x.commission_pct + '%' : ''))]),
      el('td', null, [el('span', { class: 'dv-st', style: 'color:' + COLOR[x.status] + ';background:' + COLOR[x.status] + '14' }, LABEL[x.status] || x.status),
        sd != null && sd > 0 ? el('small', { class: 'dv-mut', style: 'display:block;margin-top:3px' }, sd + ' d in stage') : '']),
      el('td', null, testCell(x)),
      el('td', null, sig.length ? el('div', { class: 'dv-sigs' }, sig) : el('span', { class: 'dv-mut' }, '—')),
      el('td', { class: 'dv-mut', title: x.applied_at ? fmtDateTime(x.applied_at) : '' }, x.applied_at ? fmtDate(x.applied_at) : '—'),
      el('td', { class: 'dv-mut', title: x.last_activity ? fmtDateTime(x.last_activity) : 'never signed in' }, ago(x.last_activity)),
      el('td', null, rowActions(x)),
    ]);
  }
  function paintRoster() {
    const s = st.stats || {}; const by = s.by_status || {};
    const chips = [['all', 'All stages', s.total]].concat(STAGES.filter(([k]) => by[k] || k === st.stage).map(([k, l]) => [k, l, by[k] || 0]))
      .concat(EXTRA.filter(([k]) => by[k]).map(([k, l]) => [k, l, by[k]]));
    const head = ['', 'Dispatcher', 'Location · exp', 'Stage', 'Skills test', 'Signals', 'Applied', 'Last activity', ''];
    const tbody = el('tbody', null, st.rows.length ? st.rows.map(rowNode)
      : [el('tr', null, el('td', { colspan: 9 }, el('div', { class: 'dv-state' }, st.loading ? 'Loading…' : (st.q || st.stage !== 'all' ? 'No dispatchers match this filter.' : 'No dispatchers yet.'))))]);
    const more = st.more ? el('button', { class: 'dv-btn', onClick: fetchPage }, st.loading ? 'Loading…' : 'Load ' + PAGE + ' more') : null;
    const shownTotal = st.stage === 'all' ? s.total : by[st.stage];
    mount(panel, el('div', null, [
      kpis(), pipeStrip(), needCards(),
      el('div', { class: 'dv-filters' }, chips.map(([k, l, n]) => el('button', { class: 'dv-chip' + (st.stage === k ? ' on' : ''), onClick: () => { st.stage = k; fetchFirst(); } }, l + (n == null ? '' : ' · ' + num(n))))
        .concat([el('span', { class: 'r' }, ['Sorted by newest', el('span', { class: 'dv-kbd' }, '↑↓'), 'move', el('span', { class: 'dv-kbd' }, '↵'), 'open'])])),
      st.sel.size ? el('div', { class: 'dv-bulk' }, [
        el('b', null, st.sel.size + ' selected'),
        el('button', { class: 'dv-btn sm', onClick: () => { const em = st.rows.filter((r) => st.sel.has(r.user_id)).map((r) => r.email).filter(Boolean).join(', '); if (navigator.clipboard) navigator.clipboard.writeText(em); toast('✓ e-mails copied'); } }, 'Copy e-mails'),
        el('button', { class: 'dv-btn sm', onClick: () => { st.sel.clear(); syncBulk(); paintRoster(); } }, 'Clear'),
      ]) : '',
      el('div', { class: 'dv-wrap', style: st.sel.size ? 'border-radius:0' : '' }, el('table', { class: 'dv-tbl' }, [
        el('thead', null, el('tr', null, head.map((h, i) => el('th', null, i === 0
          ? el('input', { type: 'checkbox', class: 'dv-chk', checked: st.sel.size && st.sel.size === st.rows.length ? '' : undefined,
              onClick: (e) => { if (e.target.checked) st.rows.forEach((r) => st.sel.add(r.user_id)); else st.sel.clear(); syncBulk(); paintRoster(); } })
          : h)))),
        tbody,
      ])),
      el('div', { class: 'dv-foot' }, [
        el('span', null, 'Showing ' + num(st.rows.length) + (shownTotal != null ? ' of ' + num(shownTotal) : '') + ' · ' + PAGE + ' per page · server-side search and paging'),
        more || el('span', null, st.rows.length ? 'End of list' : ''),
      ]),
    ]));
  }

  // ------------------------------------------------------------------ board tab
  function paintBoard() {
    if (!st.board) { mount(panel, el('div', { class: 'dv-state' }, 'Loading board…')); return; }
    const S = st.stats || {}; const by = S.by_status || {};
    const all = []; Object.keys(st.board).forEach((k) => (st.board[k] || []).forEach((c) => all.push(Object.assign({ status: k }, c))));
    const t = (c) => c.test || {};
    // Columns are STAGES of work, not just profile statuses: the test states split "skills test" into three.
    const COLS = [
      { k: 'applied', label: 'Applied', ic: 'user', sub: 'screen or reject', budget: 3, pick: (c) => c.status === 'applied', na: (c) => (!c.has_id ? ['Ask for ID', 'id'] : ['Screen the application', 'arrow']) },
      { k: 'screening', label: 'Screened', ic: 'eye', sub: 'ready for a test', budget: 3, pick: (c) => c.status === 'screening' && !t(c).status, na: () => ['Send skills test', 'send'] },
      { k: 'sent', label: 'Test sent', ic: 'send', sub: '48 h to start', budget: 2, pick: (c) => ['invited', 'in_progress'].includes(t(c).status) && !['trial', 'verified', 'active', 'suspended', 'rejected'].includes(c.status), na: (c) => (t(c).status === 'in_progress' ? ['Watch — no action', 'eye'] : (t(c).start_by && new Date(t(c).start_by) - Date.now() < 12 * 36e5 ? ['Nudge or let it lapse', 'alert'] : ['Waiting on the candidate', 'clock'])) },
      { k: 'scoring', label: 'Needs scoring', ic: 'flame', sub: 'waiting on you', budget: 1, hot: true, pick: (c) => t(c).status === 'submitted' || (t(c).status === 'scored' && t(c).decision && !(t(c).told && t(c).score_told) && !['trial', 'verified', 'active'].includes(c.status)), na: (c) => (t(c).status === 'submitted' ? ['Grade the test', 'clipboard'] : ['Tell him — send the result', 'mail']) },
      { k: 'placing', label: 'Passed · placing', ic: 'handshake', sub: 'choosing a carrier', budget: 3, pick: (c) => (t(c).status === 'scored' && t(c).decision === 'pass' && t(c).told && t(c).score_told && ['skills_test', 'screening'].includes(c.status)) || (c.status === 'verified' && !Number(c.carriers)), na: (c) => (c.status === 'verified' ? ['Assign a carrier', 'handshake'] : ['Set terms → trial', 'play']) },
      { k: 'trial', label: 'Paid trial', ic: 'timer', sub: 'commission-only', budget: null, pick: (c) => c.status === 'trial', na: (c) => { const d = c.trial_end ? Math.ceil((new Date(c.trial_end) - Date.now()) / 864e5) : null; return d == null ? ['Set the trial window', 'cal'] : d < 0 ? ['Overdue — decide', 'alert'] : ['Decide by ' + fmtDate(c.trial_end), 'zap']; } },
      { k: 'active', label: 'Active', ic: 'star', sub: 'earning', budget: null, pick: (c) => c.status === 'active' || (c.status === 'verified' && Number(c.carriers)), na: (c) => (Number(c.owed) > 0 ? [usd(c.owed) + ' owed · approve', 'wallet'] : c.last_booking_at && days(c.last_booking_at) >= 2 ? ['Quiet ' + days(c.last_booking_at) + ' d — check the truck', 'truck'] : ['Earning', 'check']) },
    ];
    const rest = all.filter((c) => !COLS.some((col) => col.pick(c)));
    ['suspended', 'rejected'].forEach((k) => { if (rest.some((c) => c.status === k)) COLS.push({ k, label: LABEL[k], ic: k === 'rejected' ? 'x' : 'pause', sub: 'newest', budget: null, pick: (c) => c.status === k, na: () => [k === 'suspended' ? 'Reinstate or end' : 'Closed', 'flag'] }); });
    if (!all.some((c) => c.status === 'applied')) { COLS.splice(0, 1); COLS[0].label = 'Applied · screening'; COLS[0].sub = 'screen, then send the test'; COLS[0].na = (c) => (!c.has_id ? ['Ask for ID', 'id'] : ['Screen, then send the test', 'send']); }
    const seen = new Set();
    const colCards = COLS.map((col) => { const cs = all.filter((c) => !seen.has(c.user_id) && col.pick(c)); cs.forEach((c) => seen.add(c.user_id)); return cs; });
    const stuckOnly = st.boardStuck === true;
    const nTested = all.filter((c) => t(c).status).length; const nScored = all.filter((c) => t(c).status === 'scored').length; const nPassed = all.filter((c) => t(c).status === 'scored' && t(c).decision === 'pass').length;
    const flow = el('div', { class: 'dv-flow' }, [
      [S.total, 'Applied', 'user', 'all time · ' + num(S.applied_7d || 0) + ' this week'],
      [(by.screening || 0) + (by.applied || 0), 'In screening', 'eye', S.median_days_screening != null ? 'median ' + S.median_days_screening + ' d waiting' : ''],
      [nTested, 'Test sent', 'send', nScored ? nScored + ' scored · ' + (nScored ? Math.round(100 * nPassed / nScored) : 0) + '% pass' : 'none scored yet'],
      [(by.trial || 0) + (by.verified || 0) + (by.active || 0), 'Carrier stage', 'handshake', S.carriers_covered != null ? S.carriers_covered + ' carriers covered' : ''],
      [by.trial || 0, 'In trial', 'timer', S.trials_ending_3d ? S.trials_ending_3d + ' end within 3 d' : 'none ending this week'],
      [by.active || 0, 'Active', 'star', (S.active_trucks != null ? S.active_trucks + ' trucks' : '') + (S.conversion_pct != null ? ' · ' + S.conversion_pct + '% end-to-end' : '')],
    ].map(([v, l, ic, e]) => el('div', { class: 'dv-fl' }, [el('b', null, num(v)), el('span', null, [icon(ic, 11), l]), e ? el('em', null, e) : ''])));
    const tools = el('div', { class: 'dv-tools' }, [
      el('span', { class: 'dv-chip' + (stuckOnly ? ' hot on' : ''), onClick: () => { st.boardStuck = !stuckOnly; paintBoard(); } }, [icon('alert', 12), 'Stuck past budget only']),
      el('span', null, 'Newest 14 per stage · budget bar = days in stage against the target for that stage · '), icon('layers', 13), el('span', null, 'every card opens its 360 at '), el('span', { class: 'dv-lnk' }, '#/dispatcher?id=…'),
    ]);
    const board = el('div', { class: 'dv-board2', style: 'grid-template-columns:repeat(' + COLS.length + ',minmax(0,1fr))' }, COLS.map((col, ci) => {
      let cs = colCards[ci];
      const stuck = (c) => { const d = days(col.k === 'trial' ? c.trial_start : c.stage_since); return col.budget != null && d != null && d > col.budget; };
      if (stuckOnly) cs = cs.filter(stuck);
      const shown = cs.slice(0, 12);
      return el('div', { class: 'dv-col2' + (col.hot ? ' hot' : '') }, [
        el('div', { class: 'ch' }, [icon(col.ic, 14), el('b', null, col.label), el('i', { class: col.hot && cs.length ? 'hot' : '' }, num(cs.length))]),
        el('div', { class: 'sub' }, col.sub),
        shown.length ? shown.map((c) => {
          const tt = t(c); const chips = [];
          const chip = (txt, cls, ic) => chips.push(el('span', { class: cls || '' }, [ic ? icon(ic, 10) : '', txt]));
          if (col.k === 'applied' || col.k === 'screening') { chip(c.has_cv ? 'CV' : 'No CV', c.has_cv ? 'b' : 'r', 'doc'); chip(c.has_id ? 'ID' : 'No ID', c.has_id ? 'g' : 'r', 'id'); if (c.own_board) chip('Own board', 'g'); if (!c.us_overlap) chip('No US overlap', 'o'); (c.equipment || []).slice(0, 2).forEach((e) => chip(e)); }
          if (col.k === 'sent') { chip(tt.status === 'in_progress' ? 'In progress' : 'Not started', tt.status === 'in_progress' ? 'b' : 'o', tt.status === 'in_progress' ? 'play' : 'clock'); if (tt.attempt_no > 1) chip('Attempt ' + tt.attempt_no); }
          if (col.k === 'scoring') { if (tt.auto != null) chip('auto ' + tt.auto + '/' + (tt.max || 100), 'b'); if (tt.status === 'scored') chip((tt.decision === 'pass' ? 'passed' : 'failed') + ' ' + (tt.score != null ? tt.score : ''), tt.decision === 'pass' ? 'g' : 'r'); if (tt.status === 'scored' && !tt.told) chip('result not sent', 'o', 'mail'); else if (tt.status === 'scored' && !tt.score_told) chip('score not sent', 'o', 'mail'); if (Number(tt.pastes) > 0) chip(tt.pastes + ' pastes', 'r'); if (Number(tt.blur) > 5) chip(tt.blur + ' tab leaves', 'r'); }
          if (col.k === 'placing') { if (tt.score != null) chip('passed ' + tt.score, 'g', 'award'); if (c.status === 'verified') chip('verified', 'g'); if (!c.commission_pct) chip('no % set', 'o'); }
          if (col.k === 'trial' || col.k === 'active' || col.k === 'suspended') { chip(num(c.carriers) + ' carrier' + (Number(c.carriers) === 1 ? '' : 's'), 'b', 'truck'); if (Number(c.trucks)) chip(num(c.trucks) + ' truck' + (Number(c.trucks) === 1 ? '' : 's')); if (c.commission_pct) chip(c.commission_pct + '%', 'g'); if (Number(c.owed) > 0) chip(usd(c.owed) + ' owed', 'o', 'wallet'); }
          let ageTxt, pct, tone;
          if (col.k === 'trial' && c.trial_start && c.trial_end) { const tot = Math.max(1, days(c.trial_start) + Math.max(0, Math.ceil((new Date(c.trial_end) - Date.now()) / 864e5))); const d = days(c.trial_start); ageTxt = 'day ' + Math.min(d + 1, tot) + ' of ' + tot; pct = Math.min(100, Math.round(100 * (d + 1) / tot)); tone = pct >= 80 ? 'var(--o)' : 'var(--b)'; }
          else if (col.k === 'sent' && tt.start_by && tt.status === 'invited') { const h = Math.round((new Date(tt.start_by) - Date.now()) / 36e5); ageTxt = h >= 0 ? 'expires in ' + h + ' h' : 'expired'; pct = Math.min(100, Math.max(0, 100 - Math.round(100 * h / 48))); tone = h < 12 ? 'var(--o)' : 'var(--b)'; }
          else if (col.k === 'scoring' && tt.submitted_at) { const h = Math.round((Date.now() - new Date(tt.submitted_at)) / 36e5); ageTxt = 'submitted ' + (h < 48 ? h + ' h ago' : Math.round(h / 24) + ' d ago'); pct = Math.min(100, Math.round(100 * h / 24)); tone = h > 24 ? 'var(--o)' : 'var(--b)'; }
          else if (col.k === 'active') { const d = c.last_booking_at ? days(c.last_booking_at) : null; ageTxt = d == null ? 'no booking yet' : d === 0 ? 'booked today' : 'last booking ' + d + ' d ago'; pct = d == null ? 0 : Math.min(100, d * 25); tone = d != null && d >= 3 ? 'var(--o)' : 'var(--ok)'; }
          else { const d = days(c.stage_since); ageTxt = d == null ? '—' : d === 0 ? 'today' : d + ' d in stage'; pct = col.budget ? Math.min(100, Math.round(100 * d / col.budget)) : 0; tone = col.budget && d > col.budget ? 'var(--o)' : 'var(--ok)'; }
          const [naTxt, naIc] = col.na(c);
          return el('div', { class: 'dv-c' + (stuck(c) ? ' stuck' : days(c.applied_at) <= 1 && col.k === 'applied' ? ' new' : ''), onClick: () => ctx.open360({ user_id: c.user_id, name: c.name, status: c.status }, null, col.k === 'scoring' ? 'test' : col.k === 'active' ? 'overview' : null) }, [
            el('div', { class: 'op' }, icon('ext', 12)),
            el('div', { class: 't' }, [el('div', { class: 'dv-av', style: 'background:hsl(' + hue(c.user_id) + ' 55% 40%)' }, initials(c.name)), el('div', { style: 'min-width:0' }, [el('span', { class: 'nm' }, c.name || '(no name)'), el('span', { class: 'lo' }, [icon('pin', 10), [c.city, c.country].filter(Boolean).join(', ') || '—', c.years_exp != null ? ' · ' + c.years_exp + ' yr' + (Number(c.years_exp) === 1 ? '' : 's') : ''])])]),
            chips.length ? el('div', { class: 'chips' }, chips) : '',
            el('div', { class: 'age' }, [icon('clock', 11), ageTxt, el('div', { class: 'tr' }, el('i', { style: 'width:' + pct + '%;background:' + tone }))]),
            el('div', { class: 'na' }, [icon(naIc, 13), naTxt]),
          ]);
        }) : el('div', { class: 'dv-empty', style: 'font-size:12.5px;padding:12px 4px' }, stuckOnly ? 'Nothing stuck' : 'Empty'),
        cs.length > shown.length ? el('div', { class: 'dv-more' }, '+ ' + (cs.length - shown.length) + ' more in the roster') : '',
      ]);
    }));
    mount(panel, el('div', null, [flow, tools, board]));
  }

  // ------------------------------------------------------------------ work queue tab (bl_disp_0317 v2)
  // One ranked list: what costs money or trust first, not by date. Sources: cc_dispatcher_queue (RC approvals,
  // tests, trials, threads, commission) + the board (untold results, invites about to expire, stale applicants).
  async function paintQueueTab() {
    const nodes = ctx.queueNodes || {};
    if (!st.board) fetchBoard();
    if (!st.queue || (Date.now() - (st.queueAt || 0)) > 20000) { st.queue = await ccDispatcherQueue().catch(() => null); st.queueAt = Date.now(); }
    if (st.tab !== 'queue') return;
    const q = (st.queue && !st.queue.error) ? st.queue : {};
    const board = st.board || {}; const all = []; Object.keys(board).forEach((k) => (board[k] || []).forEach((c) => all.push(Object.assign({ status: k }, c))));
    const items = [];
    const push = (rank, cat, avKey, avName, title, body, sla, slaTone, chips, href, actLabel) => items.push({ rank, cat, avKey, avName, title, body, sla, slaTone, chips: chips || [], href, actLabel });
    const hrs = (m) => { m = Number(m || 0); return m < 60 ? Math.round(m) + ' min' : m < 2880 ? Math.round(m / 60) + ' h' : Math.round(m / 1440) + ' d'; };
    (q.awaiting_approval || []).forEach((b) => push(1, 'rc', b.dispatcher_user_id, b.dispatcher, (b.dispatcher || 'Dispatcher') + ' booked ' + (b.lane || '') + ' — RC is in, approve?', [b.carrier, b.broker, usd(b.gross), b.hours_to_pickup != null ? 'pickup in ' + b.hours_to_pickup + ' h' : null].filter(Boolean).join(' · ') + (b.below_min ? ' · under the floor' : '') + (b.driver_set ? '' : ' · no driver set'), hrs(b.age_min) + ' waiting', Number(b.age_min) > 120 ? 'r' : 'o', [b.below_min ? ['below floor', 'r'] : null].filter(Boolean), '#/dispatcher?id=' + b.dispatcher_user_id + '&tab=loads&booking=' + b.id, 'Review RC'));
    (q.tests_to_score || []).forEach((x) => push(2, 'tests', x.user_id, x.name, (x.name || 'Candidate') + "'s skills test is waiting to be graded", 'Auto-scored ' + (x.auto_score != null ? x.auto_score : '—') + ' / ' + (x.max_score || '—') + ' on the number and multiple-choice items.' + (x.attempt_no > 1 ? ' Attempt ' + x.attempt_no + '.' : ''), Math.round(Number(x.waiting_hours || 0)) + ' h', Number(x.waiting_hours) > 24 ? 'r' : 'o', [], '#/dispatcher?id=' + x.user_id + '&tab=test', 'Grade now'));
    all.filter((c) => c.test && c.test.status === 'scored' && c.test.decision && !(c.test.told && c.test.score_told) && !['trial', 'verified', 'active'].includes(c.status)).forEach((c) => push(2, 'untold', c.user_id, c.name, (c.name || 'Candidate') + ' ' + (c.test.decision === 'pass' ? 'passed' : 'was scored') + ' and has not been told', 'Scored ' + (c.test.score != null ? c.test.score + ' / ' + (c.test.max || 100) : '') + (c.test.submitted_at ? ' · submitted ' + fmtDate(c.test.submitted_at) : '') + '. ' + (!c.test.told ? 'The result e-mail has not gone out.' : 'The score e-mail has not gone out.'), c.test.submitted_at ? days(c.test.submitted_at) + ' d' : '—', 'r', [[c.test.decision, c.test.decision === 'pass' ? 'g' : 'r']], '#/dispatcher?id=' + c.user_id + '&tab=test', 'Open test'));
    (q.trials_ending || []).forEach((x) => push(3, 'trials', x.user_id, x.name, (x.name || 'Dispatcher') + "'s trial " + (x.days_left < 0 ? 'ended ' + (-x.days_left) + ' d ago' : x.days_left === 0 ? 'ends today' : 'ends in ' + x.days_left + ' d') + ' — no decision recorded', 'Open the scorecard: ≥3 loads/wk/truck, above floor, 100% RC, ≥2 check calls, deadhead ≤15%, 0 cancels.', x.days_left < 0 ? 'overdue' : x.days_left + ' d left', x.days_left <= 1 ? 'r' : 'o', [], '#/dispatcher?id=' + x.user_id + '&tab=performance', 'Decide'));
    (q.unread_threads || []).filter((x) => Number(x.unread) > 0).forEach((x) => push(4, 'threads', x.dispatcher_user_id, x.carrier, x.unread + ' unread in the ' + (x.carrier || 'carrier') + ' thread', 'Dispatcher or carrier wrote and nobody from LoadBoot has read it.', x.unread + ' unread', 'o', [], '#/dispatcher?id=' + x.dispatcher_user_id + '&tab=messages', 'Open thread'));
    all.filter((c) => c.test && c.test.status === 'invited' && c.test.start_by && (new Date(c.test.start_by) - Date.now()) < 12 * 36e5 && !['trial', 'verified', 'active', 'rejected'].includes(c.status)).forEach((c) => { const h = Math.round((new Date(c.test.start_by) - Date.now()) / 36e5); push(4, 'invites', c.user_id, c.name, (c.name || 'Candidate') + "'s test invite " + (h >= 0 ? 'expires in ' + h + ' h' : 'has expired'), 'Never started. Either a nudge now or the invite lapses — a lapsed invite is itself a signal.', h >= 0 ? h + ' h left' : 'lapsed', 'r', [], '#/dispatcher?id=' + c.user_id + '&tab=test', 'Open'); });
    (q.awaiting_rc || []).filter((b) => Number(b.age_min) > 1440).forEach((b) => push(5, 'rc', null, b.dispatcher, (b.dispatcher || 'Dispatcher') + ' booked ' + (b.lane || '') + ' with no rate confirmation for ' + hrs(b.age_min), [b.carrier, b.broker, usd(b.gross)].filter(Boolean).join(' · ') + '. Nothing moves until the RC is attached.', hrs(b.age_min), 'o', [], '#/dispatchers', 'Roster'));
    (q.moving || []).filter((b) => Number(b.last_touch_min) > 240).forEach((b) => push(6, 'moving', null, b.dispatcher, (b.lane || 'Load') + ' — no check call for ' + hrs(b.last_touch_min), (b.dispatcher || '') + ' · ' + (b.carrier || '') + ' · ' + (b.status || '') + (b.delivery_at ? ' · delivers ' + fmtDate(b.delivery_at) : ''), hrs(b.last_touch_min) + ' quiet', 'o', [], b.trip_id ? '#/trips?id=' + b.trip_id : '#/dispatchers', b.trip_id ? 'Trip' : 'Roster'));
    if (Number(q.commission_to_approve)) push(7, 'money', null, 'Commission', q.commission_to_approve + ' commission line' + (q.commission_to_approve > 1 ? 's' : '') + ' waiting for approval', 'Delivered loads. Approve once the broker has been invoiced; the dispatcher is notified.', num(q.commission_to_approve) + ' lines', 'o', [], '#/dispatchers?tab=payouts', 'Payouts');
    if (Number(q.commission_to_pay)) push(7, 'money', null, 'Commission', q.commission_to_pay + ' approved line' + (q.commission_to_pay > 1 ? 's' : '') + ' not paid yet', 'Record what actually left the account — amount, currency, FX, reference.', num(q.commission_to_pay) + ' lines', 'o', [], '#/dispatchers?tab=payouts', 'Payouts');
    all.filter((c) => c.status === 'applied' && days(c.stage_since) >= 5).forEach((c) => push(8, 'stale', c.user_id, c.name, (c.name || 'Applicant') + ' has been sitting in Applied for ' + days(c.stage_since) + ' days', [c.has_id ? 'ID on file' : 'no ID', c.us_overlap ? 'US-hours overlap' : 'no US overlap stated', c.years_exp != null ? c.years_exp + ' yrs' : null].filter(Boolean).join(' · ') + '. If the answer is no, it costs nothing to say so today.', days(c.stage_since) + ' d', 'r', [], '#/dispatcher?id=' + c.user_id, 'Screen'));
    all.filter((c) => !c.has_id && ['screening', 'skills_test'].includes(c.status)).forEach((c) => push(9, 'docs', c.user_id, c.name, (c.name || 'Candidate') + ' has no government ID on file', 'Identity and country unverified — the ID is what stops a rejected candidate re-applying.', days(c.stage_since) + ' d', 'o', [], '#/dispatcher?id=' + c.user_id + '&tab=documents', 'Documents'));
    items.sort((a, b) => a.rank - b.rank);
    const CATS = [['all', 'Needs you now', 'flame'], ['rc', 'RC approvals', 'doc'], ['tests', 'Tests to grade', 'clipboard'], ['untold', 'Results not told', 'mail'], ['trials', 'Trials ending', 'timer'], ['threads', 'Unread threads', 'chat'], ['invites', 'Invites expiring', 'cal'], ['moving', 'Loads gone quiet', 'truck'], ['money', 'Commission', 'wallet'], ['stale', 'Stale applicants', 'user'], ['docs', 'Missing ID', 'id']];
    const cat = st.queueCat || 'all';
    const list = items.filter((x) => cat === 'all' || x.cat === cat);
    const oldest = items.reduce((m, x) => Math.max(m, /(\d+) d/.test(x.sla) ? Number(RegExp.$1) : 0), 0);
    const left = el('div', { class: 'dv-qside left' }, [
      el('div', { class: 'dv-qcard' }, [el('div', { class: 'dv-qh' }, [el('div', { class: 'ico' }, icon('inbox', 15)), el('div', null, [el('h3', null, 'Queues'), el('div', { class: 's' }, 'Each one is a filter')])]),
        el('div', { class: 'dv-ql' }, CATS.map(([k, l, ic]) => { const n = k === 'all' ? items.length : items.filter((x) => x.cat === k).length; if (k !== 'all' && !n) return ''; return el('a', { class: cat === k ? 'on' : '', onClick: () => { st.queueCat = k; paintQueueTab(); } }, [icon(ic, 14), l, el('i', { class: n && ['rc', 'untold', 'invites', 'all'].includes(k) ? 'hot' : '' }, num(n))]); }))]),
      nodes.presence || '',
    ]);
    const mid = el('div', { style: 'min-width:0' }, [
      el('div', { class: 'dv-sum' }, [el('div', { class: items.length ? 'o' : '' }, [el('b', null, num(items.length)), el('span', null, [icon('flame', 11), 'Need you now'])]), el('div', null, [el('b', null, oldest ? oldest + ' d' : '—'), el('span', null, [icon('clock', 11), 'Oldest waiting'])]), el('div', null, [el('b', null, num((q.awaiting_approval || []).length)), el('span', null, [icon('doc', 11), 'RCs to approve'])]), el('div', null, [el('b', null, num((q.moving || []).length)), el('span', null, [icon('truck', 11), 'Loads moving'])])]),
      el('div', { class: 'dv-qcard' }, [el('div', { class: 'dv-qh' }, [el('div', { class: 'ico', style: 'background:rgba(252,83,5,.12);color:#c2410c' }, icon('flame', 15)), el('div', null, [el('h3', null, cat === 'all' ? 'Needs you now' : (CATS.find((c) => c[0] === cat) || [])[1]), el('div', { class: 's' }, 'Ordered by what costs money or trust first — not by date')]), el('div', { class: 'sp' }, [el('button', { class: 'dv-btn sm', onClick: () => { st.queue = null; paintQueueTab(); } }, [icon('refresh', 13), ' Refresh'])])]),
        list.length ? list.map((x, i) => el('div', { class: 'dv-it' + (i < 3 && cat === 'all' ? ' p1' : '') }, [
          el('div', { class: 'pr' + (i < 3 && cat === 'all' ? ' hot' : '') }, String(i + 1)),
          el('div', { class: 'dv-av', style: 'width:36px;height:36px;font-size:12px;border-radius:11px;background:hsl(' + hue(x.avKey || x.avName) + ' 55% 40%)' }, initials(x.avName)),
          el('div', { style: 'flex:1;min-width:0' }, [el('span', { class: 'h' }, x.title), el('div', { class: 'd' }, x.body),
            el('div', { class: 'm' }, [el('span', { class: 'dv-sla ' + (x.slaTone || '') }, [icon('clock', 11), x.sla]), ...x.chips.map(([t2, tone]) => el('span', { class: 'dv-tag ' + (tone || '') }, t2)), el('a', { class: 'dv-lnk', href: x.href }, [icon('link', 11), x.href.replace(/^#/, '').slice(0, 48)])])]),
          el('div', { class: 'act' }, [el('a', { class: 'dv-btn ' + (i < 3 && cat === 'all' ? 'o' : 'p'), href: x.href }, x.actLabel || 'Open')]),
        ])) : el('div', { class: 'dv-state' }, 'Nothing here — clear.'),
      ]),
    ]);
    const right = el('div', { class: 'dv-qside right' }, [nodes.feed || '', nodes.queue || '']);
    mount(panel, el('div', { class: 'dv-qg' }, [left, mid, right]));
    if (ctx.refreshQueue) { try { ctx.refreshQueue(); } catch (_) {} }
  }

  // ------------------------------------------------------------------ payouts tab
  function paintPayouts() {
    if (!st.pay) { mount(panel, el('div', { class: 'dv-state' }, 'Loading payouts…')); return; }
    const t = st.pay.totals || {}; const rows = st.pay.rows || [];
    const tile = (label, value, note) => el('div', { class: 'dv-kpi' }, [el('small', null, label), el('b', null, value), el('i', { class: 'm' }, note)]);
    const badge = (s) => el('span', { class: 'dv-tag ' + (s === 'paid' ? 'g' : s === 'approved' ? 'a' : s === 'void' ? 'r' : '') }, s);
    mount(panel, el('div', null, [
      el('div', { class: 'dv-money' }, [
        tile('Awaiting approval', usd(t.draft), num(t.n_draft) + ' commission line' + (Number(t.n_draft) === 1 ? '' : 's')),
        tile('Approved, unpaid', usd(t.approved), num(t.n_approved) + ' line' + (Number(t.n_approved) === 1 ? '' : 's') + ' ready to pay'),
        tile('Paid · last 30 days', usd(t.paid_30d), 'recorded against payout references'),
      ]),
      el('div', { class: 'dv-wrap' }, el('table', { class: 'dv-tbl' }, [
        el('thead', null, el('tr', null, ['Dispatcher', 'Carrier', 'Gross', '%', 'Commission', 'Status', 'Created', ''].map((h) => el('th', null, h)))),
        el('tbody', null, rows.length ? rows.map((r) => el('tr', null, [
          el('td', null, el('div', { class: 'dv-who' }, [
            el('div', { class: 'dv-av', style: 'background:hsl(' + hue(r.dispatcher_user_id) + ' 55% 42%)' }, initials(r.dispatcher)),
            el('div', null, el('b', null, r.dispatcher || '—')),
          ])),
          el('td', null, r.carrier || '—'),
          el('td', null, money(r.gross)),
          el('td', { class: 'dv-mut' }, (r.pct == null ? '—' : r.pct + '%')),
          el('td', null, el('b', null, money(r.amount))),
          el('td', null, [badge(r.status), r.paid_at ? el('small', { class: 'dv-mut', style: 'display:block;margin-top:3px' }, 'paid ' + fmtDate(r.paid_at) + (r.payout_ref ? ' · ' + r.payout_ref : '')) : '']),
          el('td', { class: 'dv-mut' }, fmtDate(r.created_at)),
          el('td', null, el('div', { class: 'dv-act', style: 'opacity:1' }, [
            r.status === 'draft' ? el('button', { class: 'dv-btn sm o', onClick: async () => {
              if (!(await askConfirm('Approve this commission?', { body: money(r.amount) + ' for ' + (r.dispatcher || 'the dispatcher') + '. Approve once the broker has been invoiced.' }))) return;
              const x = await ccDispatcherCommissionStatus(r.id, 'approved', null).catch((e) => ({ error: humanizeError(e) }));
              if (x && x.error) { toast(x.error); return; } toast('✓ approved'); fetchPay(); fetchStats();
            } }, 'Approve') : '',
            el('button', { class: 'dv-btn sm', onClick: () => { const row = st.rows.find((z) => z.user_id === r.dispatcher_user_id);
              if (row) ctx.open360(row); else ctx.open360({ user_id: r.dispatcher_user_id, name: r.dispatcher, status: 'active' }); } }, 'Open'),
          ])),
        ])) : [el('tr', null, el('td', { colspan: 8 }, el('div', { class: 'dv-state' }, 'No commission lines yet — they appear when a booked load is delivered.')))]),
      ])),
      el('div', { class: 'dv-foot' }, el('span', null, 'Payment is recorded in the dispatcher’s own Payments tab, where the amount actually sent, the currency, the FX rate and the reference are captured.')),
    ]));
  }

  // ------------------------------------------------------------------ boot
  function refresh() { fetchStats(); if (st.tab === 'board') fetchBoard(); if (st.tab === 'payouts') fetchPay(); return fetchFirst(); }
  fetchStats(); fetchFirst();
  if (st.tab !== 'roster') go(st.tab);
  return {
    refresh,
    repaint: () => { if (st.tab === 'roster') paintRoster(); },
    rows: () => st.rows,
  };
}
