// My Profile — the carrier's own profile exactly as brokers see it (contact hidden),
// plus the full live FMCSA record (7 tabs). Self-contained, scoped-dark styling so it
// renders correctly regardless of the surrounding portal theme. Read-only.
import { pocketGetProfile, pocketOverview, getDispatchPrefs, pocketCompliance, myPaymentProfile, myAvatar, setMyAvatar } from '../shared/api.js';
import { uploadDocument } from '../shared/storage.js';

var FBASE = 'https://data.transportation.gov/resource';
function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(m){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m];});}
function j(v){var n=Number(v);return (v!=null&&v!==''&&isFinite(n))?n:0;}
function d(v){var s=String(v||'').trim();if(s.length<8)return null;return s.slice(4,6)+'/'+s.slice(6,8)+'/'+s.slice(0,4);}
function ph(v){var s=String(v||'').replace(/\D/g,'');return s.length===10?('('+s.slice(0,3)+') '+s.slice(3,6)+'-'+s.slice(6)):(v||'—');}
function initials(n){return String(n||'?').trim().split(/\s+/).slice(0,2).map(function(w){return w[0];}).join('').toUpperCase();}
async function get(path){try{var r=await fetch(FBASE+'/'+path,{headers:{'Accept':'application/json'}});if(!r.ok)return null;return await r.json();}catch(e){return null;}}
var BCATS=["Unsafe Driving","Hours of Service","Vehicle Maintenance","Controlled Substances","Driver Fitness"];
var LVL={"1":"Level I - Full","2":"Level II - Walk-Around","3":"Level III - Driver Only","4":"Level IV - Special","5":"Level V - Vehicle Only","6":"Level VI - Radioactive"};
var CARGO={crgo_genfreight:"General Freight",crgo_household:"Household Goods",crgo_metalsheet:"Metal: Sheets/Coils",crgo_motorveh:"Motor Vehicles",crgo_logpole:"Logs/Poles/Lumber",crgo_bldgmat:"Building Materials",crgo_machlrg:"Machinery/Large",crgo_produce:"Produce",crgo_liqgas:"Liquids/Gases",crgo_intermodal:"Intermodal",crgo_livestock:"Livestock",crgo_grainfeed:"Grain/Feed/Hay",crgo_chem:"Chemicals",crgo_drybulk:"Dry Bulk",crgo_coldfood:"Refrigerated Food",crgo_beverages:"Beverages",crgo_construct:"Construction"};
function basicOf(p){p=String(p||'').slice(0,3);if(p==='392'||p==='397')return "Unsafe Driving";if(p==='395'||p==='398')return "Hours of Service";if(p==='391'||p==='383')return "Driver Fitness";if(p==='382')return "Controlled Substances";return "Vehicle Maintenance";}
function vinYear(vin){if(!vin||vin.length<10)return '';var c=vin.charAt(9).toUpperCase();var m={A:2010,B:2011,C:2012,D:2013,E:2014,F:2015,G:2016,H:2017,J:2018,K:2019,L:2020,M:2021,N:2022,P:2023,R:2024,S:2025,T:2026};if(m[c])return m[c];if(/[1-9]/.test(c))return 2000+parseInt(c);return '';}

async function loadFmcsa(dot){
  dot=String(dot).replace(/\D/g,'');if(!dot)return null;var pad=dot.padStart(8,'0');
  var census=await get('az4n-8mr2.json?dot_number='+dot+'&$limit=1');var c=(census&&census[0])||null;if(!c)return null;
  var R=await Promise.all([get('qh9u-swkp.json?dot_number='+pad+'&$order=effective_date DESC&$limit=6'),get('fx4q-ay7w.json?dot_number='+dot+'&$order=insp_date DESC&$limit=120'),get('aayw-vxb3.json?dot_number='+dot+'&$order=report_date DESC&$limit=40'),get('rbkj-cgst.json?dot_number='+dot+'&$limit=120')]);
  var insp=R[1]||[],viol=[];
  if(insp.length){var ids=insp.map(function(x){return "'"+x.inspection_id+"'";}).filter(Boolean).join(',');var vr=await get("876r-jsdb.json?$where=inspection_id in ("+ids+")&$limit=300");viol=vr||[];}
  return {c:c,ins:R[0]||[],insp:insp,crash:R[2]||[],units:R[3]||[],viol:viol,dot:dot};
}
function agg(D){
  var insp=D.insp||[],viol=D.viol||[];var vehI=0,drvI=0,vehO=0,drvO=0,st={};
  insp.forEach(function(x){var L=String(x.insp_level_id);if(L==='1'||L==='2'||L==='5')vehI++;if(L==='1'||L==='2'||L==='3')drvI++;if(j(x.vehicle_oos_total)>0)vehO++;if(j(x.driver_oos_total)>0)drvO++;if(x.report_state)st[x.report_state]=1;});
  var byCat={};BCATS.forEach(function(b){byCat[b]={total:0,oos:0};});
  viol.forEach(function(v){var b=basicOf(v.part_no);if(!byCat[b])byCat[b]={total:0,oos:0};byCat[b].total++;if(String(v.out_of_service_indicator||'').toUpperCase()==='Y')byCat[b].oos++;});
  return {vehI:vehI,drvI:drvI,states:Object.keys(st).length,byCat:byCat,vehRate:vehI?100*vehO/vehI:0,drvRate:drvI?100*drvO/drvI:0,totalViol:viol.length,count:insp.length};
}
function F(k,v){return '<div class="f"><div class="k">'+k+'</div><div class="v">'+esc(v==null||v===''?'—':v)+'</div></div>';}
function fpanel(D,cur){
  var c=D.c,ins=D.ins,insp=D.insp,crash=D.crash,units=D.units;var A=agg(D);
  if(cur===0){
    var cargo=[];for(var k in CARGO){if(String(c[k]||'').toUpperCase()==='X')cargo.push(CARGO[k]);}
    return '<div class="cols"><div class="box"><h3>📍 Address</h3>'+F('Physical Address',(c.phy_street||'')+', '+(c.phy_city||'')+', '+(c.phy_state||'')+' '+(c.phy_zip||''))+F('Mailing Address',(c.carrier_mailing_street||'')+', '+(c.carrier_mailing_city||'')+', '+(c.carrier_mailing_state||''))+'</div>'
      +'<div class="box"><h3>🗺️ Operation</h3>'+F('Inspections recorded in',A.states+' states')+F('Operating status',String(c.status_code).toUpperCase()==='A'?'ACTIVE':'INACTIVE')+F('Entity',c.classdef)+'</div></div>'
      +'<div class="box" style="margin-top:12px"><h3>🛣️ Mileage (MCS-150)</h3><div class="cols">'+F('Annual Mileage',(c.mcs150_mileage?Number(c.mcs150_mileage).toLocaleString():'—')+' mi')+F('Reported Year',c.mcs150_mileage_year)+'</div></div>'
      +'<div class="box" style="margin-top:12px"><h3>📦 Cargo</h3><div class="chips">'+(cargo.length?cargo.map(function(x){return '<span class="chip">'+x+'</span>';}).join(''):'<span class="chip" style="opacity:.55">Not reported to FMCSA</span>')+'</div></div>';
  }
  if(cur===1){
    var trucksL=j(c.trmtruck)+j(c.trptruck);var seen={},rows=[];
    (units||[]).forEach(function(u){var vin=u.vin;if(vin&&!seen[vin]){seen[vin]=1;rows.push({type:u.unit_type_desc||'',year:vinYear(vin),make:u.unit_make||'',vin:vin});}});
    return '<div class="sec-h">Equipment Summary</div><div class="big"><div class="m"><b>'+j(c.owntract)+'</b><span>TRUCKS OWNED</span></div><div class="m"><b>'+trucksL+'</b><span>TRUCKS LEASED</span></div><div class="m"><b>'+j(c.owntrail)+'</b><span>TRAILERS</span></div><div class="m"><b>'+j(c.total_drivers)+'</b><span>DRIVERS</span></div></div>'
      +'<div class="sec-h">Drivers</div><div class="big"><div class="m"><b>'+j(c.total_cdl)+'</b><span>CDL</span></div><div class="m"><b>'+(j(c.total_drivers)-j(c.total_cdl))+'</b><span>NON-CDL</span></div><div class="m"><b>'+j(c.driver_inter_total)+'</b><span>INTERSTATE</span></div><div class="m"><b>'+j(c.total_intrastate_drivers)+'</b><span>INTRASTATE</span></div></div>'
      +(rows.length?'<div class="sec-h">Equipment seen in inspections</div><table><thead><tr><th>Type</th><th>Year</th><th>Make</th><th>VIN</th></tr></thead><tbody>'+rows.map(function(r){return '<tr><td>'+esc(r.type)+'</td><td>'+esc(r.year)+'</td><td>'+esc(r.make)+'</td><td>'+esc(r.vin)+'</td></tr>';}).join('')+'</tbody></table>':'');
  }
  if(cur===2){
    if(!ins.length)return '<div class="empty">No active insurance on FMCSA record.</div>';
    // FMCSA li-public stores max_cov_amount in THOUSANDS of dollars: 1000 => $1,000,000.
    var covTxt=function(v){var n2=Number(v); if(!n2) return '\u2014'; return '$'+(n2*1000).toLocaleString()+(n2>=750?' \u2713':' \u26a0 below federal minimum');};
    var effTxt=function(v){ if(!v) return '\u2014'; var dt=new Date(v); if(!isNaN(dt)) return dt.toLocaleDateString(); return esc(String(v)); };
    return '<div class="sec-h">Insurance policies ('+ins.length+')</div>'+ins.map(function(p,i){return '<div class="box" style="margin-bottom:10px"><h3>Policy '+(i+1)+' · '+esc(p.name_company||'—')+'</h3><div class="cols">'+F('Coverage',covTxt(p.max_cov_amount))+F('Policy #',p.policy_no)+F('Effective',effTxt(p.effective_date))+F('Type',p.mod_col_3)+'</div></div>';}).join('');
  }
  if(cur===3){
    return '<div class="cols"><div class="box"><h3>🛡️ Safety</h3>'+F('Safety Rating',c.safety_rating||'Not Rated')+F('Crash Rate',c.recordable_crash_rate||'0.000')+'</div><div class="box"><h3>🚦 Out of Service</h3>'+F('Driver OOS Rate',A.drvRate.toFixed(1)+'%')+F('Vehicle OOS Rate',A.vehRate.toFixed(1)+'%')+'</div></div><div class="sec-h">Violations by BASIC</div><div class="big" style="grid-template-columns:repeat(5,1fr)">'+BCATS.map(function(b){return '<div class="m"><b>'+A.byCat[b].total+'</b><span>'+b.toUpperCase()+'</span></div>';}).join('')+'</div>';
  }
  if(cur===4){
    if(!insp.length)return '<div class="empty">No inspections on record.</div>';
    var vByI={};(D.viol||[]).forEach(function(v){(vByI[v.inspection_id]=vByI[v.inspection_id]||[]).push(v);});
    return '<div class="sec-h">Recent Inspections ('+insp.length+')</div><table><thead><tr><th>Date</th><th>Level</th><th>State</th><th>Violations</th><th>Status</th></tr></thead><tbody>'+insp.slice(0,20).map(function(x){var oos=j(x.oos_total)>0;return '<tr><td>'+esc(d(x.insp_date)||'—')+'</td><td>'+esc((LVL[String(x.insp_level_id)]||('L'+x.insp_level_id)).replace(/ -.*/,''))+'</td><td>'+esc(x.report_state||'—')+'</td><td>'+esc(x.viol_total||'0')+'</td><td>'+(oos?'<span class="pill2 bad">OOS</span>':'<span class="pill2 ok">Clean</span>')+'</td></tr>';}).join('')+'</tbody></table>';
  }
  if(cur===5){
    return '<div class="sec-h">Violation Summary</div><div class="big" style="grid-template-columns:repeat(3,1fr)"><div class="m"><b>'+insp.length+'</b><span>INSPECTIONS</span></div><div class="m"><b>'+A.totalViol+'</b><span>VIOLATIONS</span></div><div class="m"><b>'+A.vehI+'</b><span>VEHICLE INSP</span></div></div><div class="sec-h">By BASIC Category</div><table><thead><tr><th>Category</th><th>Total</th><th>OOS</th></tr></thead><tbody>'+BCATS.map(function(b){var o=A.byCat[b];return '<tr><td>'+b+'</td><td>'+o.total+'</td><td>'+(o.oos>0?'<span class="pill2 bad">'+o.oos+'</span>':'0')+'</td></tr>';}).join('')+'</tbody></table>';
  }
  if(cur===6){
    if(!crash.length)return '<div class="banner ok">✅ No reportable crashes in the last 24 months.</div>';
    return '<div class="sec-h">Crashes ('+crash.length+')</div><table><thead><tr><th>Date</th><th>State</th><th>Fatal</th><th>Injuries</th><th>Tow</th></tr></thead><tbody>'+crash.slice(0,30).map(function(x){return '<tr><td>'+esc(d(x.report_date)||'—')+'</td><td>'+esc(x.report_state||'—')+'</td><td>'+esc(x.fatalities||'0')+'</td><td>'+esc(x.injuries||'0')+'</td><td>'+(String(x.tow_away||'').toUpperCase()==='Y'?'Yes':'No')+'</td></tr>';}).join('')+'</tbody></table>';
  }
  return '';
}

var STYLE = '<style>'
+'#lbmp{--a:#3b9dff;--ok:#34d399;color:#eaf1fb;font-family:Inter,system-ui,Arial,sans-serif}'
+'#lbmp .card{background:#0d1526;border:1px solid rgba(255,255,255,.09);border-radius:18px;padding:20px;margin-bottom:14px}'
+'#lbmp h1{font-size:1.5rem;font-weight:900;margin:0}'
+'#lbmp .av{width:56px;height:56px;border-radius:15px;background:linear-gradient(135deg,#0b6fe0,#0883F7);display:grid;place-items:center;font-weight:900;font-size:1.2rem;color:#fff;flex:none}'
+'#lbmp .sub{color:#7f92b3;font-size:.9rem;margin:2px 0 0}'
+'#lbmp .badge{display:inline-block;padding:4px 11px;border-radius:99px;font-size:.7rem;font-weight:800}'
+'#lbmp .b-rev{background:rgba(251,191,36,.14);color:#fbbf24}#lbmp .b-ok{background:rgba(52,211,153,.14);color:#34d399}'
+'#lbmp .note{display:flex;gap:12px;align-items:center;background:rgba(59,157,255,.08);border:1px solid rgba(255,255,255,.09);border-radius:14px;padding:14px 16px;margin:14px 0}'
+'#lbmp .big{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:8px}'
+'#lbmp .m{background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.09);border-radius:14px;padding:14px;text-align:center}'
+'#lbmp .m b{display:block;font-size:1.5rem;font-weight:900;color:#3b9dff}#lbmp .m span{font-size:.62rem;color:#7f92b3;font-weight:800;letter-spacing:.04em}'
+'#lbmp .chips{display:flex;flex-wrap:wrap;gap:8px}'
+'#lbmp .chip{background:rgba(59,157,255,.1);color:#9fd0ff;border:1px solid rgba(59,157,255,.25);border-radius:99px;padding:6px 12px;font-size:.8rem;font-weight:700}'
+'#lbmp .chip.ok{background:rgba(52,211,153,.13);color:#34d399;border-color:rgba(52,211,153,.3)}'
+'#lbmp .chip.bad{background:rgba(248,113,113,.13);color:#f87171;border-color:rgba(248,113,113,.3)}'
+'#lbmp .sec-h{font-size:.95rem;font-weight:800;margin:16px 0 10px}'
+'#lbmp .cols{display:grid;grid-template-columns:1fr 1fr;gap:14px}'
+'#lbmp .box{border:1px solid rgba(255,255,255,.09);border-radius:14px;padding:15px;background:rgba(255,255,255,.02)}'
+'#lbmp .box h3{margin:0 0 10px;font-size:.92rem}'
+'#lbmp .f{padding:7px 0;border-bottom:1px solid rgba(255,255,255,.07)}#lbmp .f:last-child{border-bottom:0}'
+'#lbmp .f .k{font-size:.64rem;text-transform:uppercase;letter-spacing:.04em;color:#7f92b3;font-weight:800}#lbmp .f .v{font-weight:600;font-size:.92rem}'
+'#lbmp table{width:100%;border-collapse:collapse;font-size:.82rem}#lbmp th{text-align:left;color:#7f92b3;font-size:.62rem;text-transform:uppercase;padding:8px;border-bottom:1px solid rgba(255,255,255,.16)}#lbmp td{padding:8px;border-bottom:1px solid rgba(255,255,255,.07);color:#c3d1e6}'
+'#lbmp .pill2{padding:2px 8px;border-radius:99px;font-size:.68rem;font-weight:800}#lbmp .pill2.ok{background:rgba(52,211,153,.13);color:#34d399}#lbmp .pill2.bad{background:rgba(248,113,113,.13);color:#f87171}'
+'#lbmp .tabs{display:flex;gap:2px;border-bottom:1px solid rgba(255,255,255,.09);overflow:auto;margin-bottom:14px}'
+'#lbmp .tab{padding:11px 13px;font-weight:700;font-size:.84rem;color:#7f92b3;cursor:pointer;border-bottom:2px solid transparent;white-space:nowrap}#lbmp .tab.on{color:#3b9dff;border-bottom-color:#3b9dff}'
+'#lbmp .empty{text-align:center;color:#7f92b3;padding:30px}#lbmp .banner{background:rgba(52,211,153,.1);border-radius:12px;padding:14px}'
+'#lbmp .verified{background:rgba(52,211,153,.14);color:#34d399;font-weight:800;font-size:.62rem;padding:3px 8px;border-radius:99px}'
+'</style>';

var PTABS=["General Information","Fleet","Insurance","Safety","Inspections","Violations","Crashes"];

function wireAvatar(host){
  var av=host.querySelector('#lbmp-av'); var fi=host.querySelector('#lbmp-avafile'); if(!av||!fi) return;
  var pick=function(){ fi.click(); };
  av.addEventListener('click',pick);
  var setImg=function(url){ av.style.background='url('+url+') center/cover no-repeat'; av.style.color='transparent'; };
  fi.addEventListener('change',async function(){ var f=fi.files&&fi.files[0]; if(!f) return; if(!/^image\//.test(f.type||'')) return;
    setImg(URL.createObjectURL(f));
    try{ var m=await uploadDocument(f,'avatar'); await setMyAvatar(m.path); }catch(_){}
    try{ var s2=await import('../shared/storage.js'); var a2=await import('../shared/api.js'); var m2=await s2.uploadOrgLogo(f); await a2.setOrgLogo(m2.path); }catch(_){}
  });
  (async function(){ try{ var a0=await myAvatar(); var p0=a0&&a0.avatar_path; if(!p0) return;
    var sc=await import('../shared/supabaseClient.js'); var sb=await sc.getClient();
    var r=await sb.storage.from('documents').createSignedUrl(p0,3600);
    if(r&&r.data&&r.data.signedUrl) setImg(r.data.signedUrl);
  }catch(_){}})();
}
// CC/staff reuse: the exact 7-tab FMCSA profile, by DOT. opts.light = light (CC) theme.
var LIGHT_CSS = '<style>'
 +'#lbmp{color:#10223B !important}'
 +'#lbmp .card{background:#fff !important;border-color:#e5eaf2 !important;box-shadow:0 1px 3px rgba(16,34,59,.06)}'
 +'#lbmp .box,#lbmp .m{background:#f7fafd !important;border-color:#e5eaf2 !important}'
 +'#lbmp .m b{color:#0883F7 !important}#lbmp .m span,#lbmp .sub,#lbmp .f .k,#lbmp th{color:#64748b !important}'
 +'#lbmp .f{border-color:#eef2f7 !important}#lbmp td{color:#334155 !important;border-color:#eef2f7 !important}'
 +'#lbmp .tabs{border-color:#e5eaf2 !important}#lbmp .tab{color:#64748b !important}#lbmp .tab.on{color:#0883F7 !important;border-bottom-color:#0883F7 !important}'
 +'#lbmp .sec-h,#lbmp .box h3,#lbmp .f .v{color:#10223B !important}'
 +'</style>';
export async function renderFmcsaOnly(host, dot, opts){
  opts = opts || {};
  var SK = STYLE + (opts.light ? LIGHT_CSS : '');
  host.innerHTML = SK + '<div id="lbmp"><div class="card"><div class="sub">Loading FMCSA record for DOT '+esc(String(dot||''))+'\u2026</div></div></div>';
  var D=null; try{ D=await loadFmcsa(String(dot||'').trim()); }catch(_){ }
  if(!D){ host.innerHTML = SK + '<div id="lbmp"><div class="card"><div class="sub">Could not load FMCSA data for DOT '+esc(String(dot||''))+' right now.</div></div></div>'; return; }
  var A=agg(D); var c=D.c||{};
  var cur=0;
  function fullReport(){
    var w2=window.open('','_blank');
    w2.document.write('<html><head><title>FMCSA report \u2014 '+esc(c.legal_name||('DOT '+dot))+'</title>'
      +'<style>body{font-family:Arial,sans-serif;max-width:860px;margin:30px auto;color:#111}h1{font-size:20px;border-bottom:3px solid #10223B;padding-bottom:8px}h2{font-size:15px;background:#f1f5f9;padding:8px 12px;border-radius:8px;margin:26px 0 10px}table{width:100%;border-collapse:collapse;font-size:12.5px}th{text-align:left;color:#555;font-size:10px;text-transform:uppercase;padding:6px;border-bottom:2px solid #ccc}td{padding:6px;border-bottom:1px solid #e5e5e5}.cols{display:block}.box{border:1px solid #ddd;border-radius:10px;padding:12px;margin-bottom:10px}.box h3{margin:0 0 8px;font-size:13px}.f{padding:4px 0;font-size:12.5px}.f .k{color:#666;font-size:9.5px;text-transform:uppercase;display:block}.big{display:flex;gap:10px;flex-wrap:wrap}.m{border:1px solid #ddd;border-radius:10px;padding:10px 14px;text-align:center}.m b{display:block;font-size:18px}.m span{font-size:9px;color:#666}.sec-h{font-weight:800;margin:14px 0 8px}.pill2{font-size:10px;padding:1px 6px;border:1px solid #999;border-radius:99px}.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{border:1px solid #bbb;border-radius:99px;padding:3px 10px;font-size:11px}.tabs,.tab{display:none}.foot{margin-top:28px;font-size:10px;color:#777}</style></head><body>'
      +'<h1>FMCSA Carrier Report \u2014 '+esc(c.legal_name||'')+' (DOT '+esc(String(dot))+')</h1>'
      +'<div>Generated '+new Date().toLocaleString()+' \u00b7 Source: FMCSA/SAFER public datasets \u00b7 via LoadBoot Command Center</div>'
      +PTABS.map(function(t,i){return '<h2>'+t+'</h2>'+fpanel(D,i);}).join('')
      +'<div class="foot">This report reproduces live public FMCSA data at the time of generation. LoadBoot does not alter government records.</div>'
      +'</body></html>');
    w2.document.close(); w2.print();
  }
  function draw(){
    host.innerHTML = SK + '<div id="lbmp"><div class="card">'
      +'<div style="display:flex;justify-content:space-between;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:8px">'
      +'<div><div class="sec-h" style="margin:0">\ud83d\udcc2 '+esc(c.legal_name||'FMCSA profile')+'</div><div class="sub">DOT '+esc(String(dot))+(c.mc_number?' \u00b7 MC '+esc(c.mc_number):'')+(c.phy_city?' \u00b7 '+esc(c.phy_city+', '+(c.phy_state||'')):'')+' \u00b7 '+(String(c.status_code).toUpperCase()==='A'?'<b style=\"color:#16a34a\">AUTHORITY ACTIVE</b>':'<b style=\"color:#dc2626\">INACTIVE</b>')+'</div></div>'
      +'<button id="lbmp-report" style="border:0;border-radius:10px;padding:10px 14px;font-weight:800;cursor:pointer;background:#0883F7;color:#fff">\u2b07 Download full report</button>'
      +'</div>'
      +'<div class="big"><div class="m"><b>'+j(c.power_units)+'</b><span>TRUCKS</span></div><div class="m"><b>'+j(c.total_drivers)+'</b><span>DRIVERS</span></div><div class="m"><b>'+A.drvRate.toFixed(1)+'%</b><span>DRIVER OOS</span></div><div class="m"><b>'+A.vehRate.toFixed(1)+'%</b><span>VEHICLE OOS</span></div><div class="m"><b>'+(D.crash||[]).length+'</b><span>CRASHES 24mo</span></div></div>'
      +'<div class="tabs">'+PTABS.map(function(t,i){return '<div class="tab'+(i===cur?' on':'')+'" data-tab="'+i+'">'+t+'</div>';}).join('')+'</div>'
      +'<div id="lbmp-panel">'+fpanel(D,cur)+'</div>'
      +'</div></div>';
    host.querySelectorAll('.tab').forEach(function(t2){ t2.addEventListener('click',function(){ cur=Number(t2.getAttribute('data-tab'))||0; draw(); }); });
    var rb=host.querySelector('#lbmp-report'); if(rb) rb.addEventListener('click',fullReport);
  }
  draw();
}

export async function renderMyProfile(host){
  host.innerHTML = STYLE + '<div id="lbmp"><div class="card"><div class="sub">Loading your profile…</div></div></div>';
  var prof={},ov={},dp={},comp=null,pay=null;
  try{prof=(await pocketGetProfile())||{};}catch(_){}
  try{ov=(await pocketOverview())||{};}catch(_){}
  try{dp=(await getDispatchPrefs())||{};}catch(_){}
  try{comp=await pocketCompliance();}catch(_){}
  try{pay=await myPaymentProfile();}catch(_){}

  var name=prof.company||ov.carrier||'Your Carrier';
  var dot=String(prof.dot||ov.dot||'').replace(/\D/g,'');
  var mc=prof.mc||'';
  var equip=(prof.equipment_types&&prof.equipment_types.length?prof.equipment_types:(dp.preferred_equipment||[]));
  var lanes=(dp.preferred_lanes||[]);
  var _stApproved=['approved','active','completed'].indexOf(String(ov.onboarding_stage||'').toLowerCase())>=0;
  var verified=!!(ov.compliance_ok)&&_stApproved;
  var statusBadge=(String(ov.account_status||'')==='paused')?'<span class="badge b-rev" style="background:rgba(239,68,68,.16);color:#f87171">⏸ Account paused</span>':(ov.poa_required)?'<span class="badge b-rev" style="background:rgba(217,119,6,.16);color:#fbbf24">📋 Plan of action required</span>':verified?'<span class="badge b-ok">✓ VERIFIED</span>':(ov.compliance_ok?'<span class="badge b-rev">Docs verified — approval pending</span>':'<span class="badge b-rev">Under review</span>');

  // compliance badges from the doc list
  function has(re){try{return ((comp&&comp.requirements)||[]).some(function(r){return re.test(String(r.name||''))&&/valid|verified|approv|on file|active/i.test(String(r.status||''));});}catch(_){return false;}}
  function rev(re){try{return ((comp&&comp.requirements)||[]).some(function(r){return re.test(String(r.name||''))&&/pending|review|submitted/i.test(String(r.status||''));});}catch(_){return false;}}
  var cCoi=has(/insur|coi/i), cW9=has(/w-?9/i), cAgr=has(/agreement/i), cAuth=has(/authorit|mc\/dot|operating/i);
  var isFactoring=String(prof.factoring_status||'')==='yes';
  var cBank=!!(pay&&pay.exists!==false&&pay.bank_name&&pay.verified===true);
  var cBankPending=!!(pay&&pay.exists!==false&&pay.bank_name&&pay.verified!==true);
  function badge(ok,label){return '<span class="chip'+(ok?' ok':' bad')+'">'+(ok?'✓ ':'✗ ')+label+'</span>';}

  var D=null;
  if(dot){try{D=await loadFmcsa(dot);}catch(_){}}
  var A=D?agg(D):null;var c=D?D.c:{};

  var cur=0;
  function draw(){
    var stats = D?('<div class="big"><div class="m"><b>'+j(c.power_units)+'</b><span>TRUCKS</span></div><div class="m"><b>'+j(c.total_drivers)+'</b><span>DRIVERS</span></div><div class="m"><b>'+A.drvRate.toFixed(1)+'%</b><span>DRIVER OOS</span></div><div class="m"><b>'+(D.crash||[]).length+'</b><span>CRASHES 24mo</span></div></div>'):'';
    var fmcsa = D?('<div class="sec-h">📂 Full FMCSA profile</div><div class="tabs">'+PTABS.map(function(t,i){return '<div class="tab'+(i===cur?' on':'')+'" data-tab="'+i+'">'+t+'</div>';}).join('')+'</div><div id="lbmp-panel">'+fpanel(D,cur)+'</div>'):'<div class="card"><div class="sub">'+(dot?'Could not load FMCSA data for DOT '+esc(dot)+' right now.':'Add your USDOT number in onboarding to show your full FMCSA profile here.')+'</div></div>';
    host.innerHTML = STYLE + '<div id="lbmp">'
      +'<div class="card"><div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap"><div class="av" id="lbmp-av" style="position:relative;overflow:visible;cursor:pointer" title="Change photo">'+esc(initials(name))+'<span id="lbmp-cam" style="position:absolute;right:-6px;bottom:-6px;width:26px;height:26px;border-radius:50%;background:#FC5305;color:#fff;display:flex;align-items:center;justify-content:center;font-size:13px;border:2.5px solid #0d1526;cursor:pointer">&#128247;</span></div><input type="file" id="lbmp-avafile" accept="image/*" hidden>'
      +'<div><h1>'+esc(name)+' '+statusBadge+'</h1><div class="sub">'+(dot?'DOT '+esc(dot):'DOT not set')+(mc?' · MC '+esc(mc):'')+(c&&c.phy_city?' · '+esc(c.phy_city+', '+c.phy_state):'')+'</div></div></div>'
      +'<div class="note"><div style="font-size:1.5rem">👁️</div><div><b>This is how brokers see you</b><div class="sub">Your phone &amp; email stay hidden from brokers — LoadBoot dispatch handles all contact. Only your verified profile &amp; documents are visible.</div></div></div>'
      +stats
      +'<div class="sec-h">Equipment</div><div class="chips">'+(equip.length?equip.map(function(e){return '<span class="chip">'+esc(e)+'</span>';}).join(''):'<span class="chip" style="opacity:.55">Not set yet \u2014 add equipment in onboarding</span>')+'</div>'
      +'<div class="sec-h">Lanes</div><div class="chips">'+(lanes.length?lanes.map(function(e){return '<span class="chip">'+esc(e)+'</span>';}).join(''):'<span class="chip" style="opacity:.55">Not set yet \u2014 add lanes in dispatch preferences</span>')+'</div>'
      +'<div class="sec-h">Compliance <span class="verified">on file</span></div><div class="chips">'+badge(cCoi,'COI')+badge(cW9,'W-9')+badge(cAgr,'Signed Agreement')+badge(cAuth,'FMCSA Authority')+(isFactoring?badge(true,'Factoring'):'')+(cBankPending?'<span class="badge b-rev" style="background:rgba(217,119,6,.16);color:#fbbf24">&#9203; Banking &mdash; in review</span>':((cBank||!isFactoring)?badge(cBank,'Banking'):''))+'</div>'
      +'</div>'
      +'<div class="card">'+fmcsa+'</div>'
      +'</div>';
    // wire tabs
    var tabs=host.querySelectorAll('#lbmp .tab');
    for(var i=0;i<tabs.length;i++){tabs[i].addEventListener('click',function(e){cur=Number(e.currentTarget.getAttribute('data-tab'))||0;var p=host.querySelector('#lbmp-panel');if(p)p.innerHTML=fpanel(D,cur);var all=host.querySelectorAll('#lbmp .tab');for(var k=0;k<all.length;k++)all[k].classList.toggle('on',Number(all[k].getAttribute('data-tab'))===cur);});}
    wireAvatar(host);
  }
  draw();
}
