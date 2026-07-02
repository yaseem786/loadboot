# -*- coding: utf-8 -*-
# FLAGSHIP TOOL v2: "Should You Take This Load?" — an advanced Load Score decision engine.
# Beyond a calculator: scores any load (0-100), gives a TAKE / NEGOTIATE / PASS verdict,
# a suggested counter-offer, plain-English insights, a built-in cost-per-mile estimator,
# accessorial pay/costs, a multi-load COMPARE tray, and a copy-to-clipboard summary.
# Shared by load-score.html, the home page, and the client dashboard.

LS_CSS = r'''
.ls-tool{background:#fff;border:1px solid var(--border);border-radius:24px;box-shadow:0 40px 90px -50px rgba(15,23,42,.45);overflow:hidden;max-width:1080px;margin:0 auto}
.ls-grid{display:grid;grid-template-columns:1fr 1.05fr}
.ls-inputs{padding:32px 30px}
.ls-inputs h3{font-family:'Manrope';font-size:1.05rem;margin:0 0 4px}
.ls-inputs .ls-cap{color:var(--muted);font-size:.86rem;margin:0 0 18px}
.ls-f{display:flex;flex-direction:column;gap:7px;margin-bottom:14px}
.ls-row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.ls-f label{font-weight:600;font-size:.84rem;color:var(--navy);display:flex;align-items:center;gap:6px}
.ls-f .q{display:inline-flex;width:16px;height:16px;border-radius:50%;background:#e2e8f0;color:#475569;font-size:.68rem;align-items:center;justify-content:center;cursor:help;font-weight:700}
.ls-f input,.ls-f select{padding:12px 14px;border:1.5px solid var(--border);border-radius:11px;font-family:inherit;font-size:1rem;color:var(--navy);background:#fff;width:100%}
.ls-f input:focus,.ls-f select:focus{outline:none;border-color:var(--blue);box-shadow:0 0 0 4px #EFF6FF}
.ls-est-toggle{background:none;border:none;color:var(--blue);font-weight:600;font-size:.8rem;cursor:pointer;padding:0;margin:-6px 0 14px;text-align:left;display:inline-flex;align-items:center;gap:5px}
.ls-est{display:none;margin:-4px 0 16px;padding:15px;border:1px dashed #cbd5e1;border-radius:13px;background:#F8FAFC}
.ls-est.open{display:block}
.ls-est .ls-row{margin-bottom:11px}
.ls-est .ls-f{margin-bottom:11px}
.ls-est-out{font-size:.86rem;color:var(--navy);background:#fff;border:1px solid var(--border);border-radius:9px;padding:9px 12px;margin-top:2px}
.ls-est-out b{color:var(--blue);font-family:'Manrope'}
.ls-result{background:linear-gradient(165deg,#0b1220,#15233f 60%,#0b1220);color:#fff;padding:32px 30px;display:flex;flex-direction:column;gap:18px}
.ls-score-wrap{display:flex;align-items:center;gap:22px}
.ls-gauge{width:116px;height:116px;border-radius:50%;background:conic-gradient(#64748b 0deg,#1f2b45 0deg);display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:background .5s}
.ls-gauge .in{width:90px;height:90px;border-radius:50%;background:#0b1220;display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1}
.ls-gauge .sc{font-family:'Manrope';font-weight:800;font-size:2.25rem}
.ls-gauge .of{font-size:.72rem;color:#94a3b8;margin-top:2px}
.ls-vbox .vlabel{font-size:.74rem;letter-spacing:.14em;text-transform:uppercase;color:#94a3b8;margin-bottom:6px}
.ls-verdict{display:inline-flex;align-items:center;gap:9px;font-family:'Manrope';font-weight:800;font-size:1.4rem;padding:8px 16px;border-radius:12px;background:#1f2b45}
.ls-verdict .dot{width:11px;height:11px;border-radius:50%;background:#94a3b8}
.ls-verdict.take{color:#4ade80}.ls-verdict.take .dot{background:#4ade80;box-shadow:0 0 0 5px rgba(74,222,128,.18)}
.ls-verdict.neg{color:#fbbf24}.ls-verdict.neg .dot{background:#fbbf24;box-shadow:0 0 0 5px rgba(251,191,36,.18)}
.ls-verdict.pass{color:#f87171}.ls-verdict.pass .dot{background:#f87171;box-shadow:0 0 0 5px rgba(248,113,113,.18)}
.ls-metrics{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:rgba(255,255,255,.08);border-radius:14px;overflow:hidden}
.ls-metrics div{background:#101b30;padding:13px 16px}
.ls-metrics span{display:block;font-size:.75rem;color:#94a3b8;margin-bottom:4px}
.ls-metrics b{font-family:'Manrope';font-size:1.2rem}
.ls-metrics b.pos{color:#4ade80}.ls-metrics b.neg{color:#f87171}
.ls-counter{background:rgba(37,99,235,.16);border:1px solid rgba(96,165,250,.35);border-radius:13px;padding:13px 16px;font-size:.92rem}
.ls-counter b{color:#93c5fd;font-family:'Manrope'}
.ls-insights{display:flex;flex-direction:column;gap:9px}
.ls-insights .ins{display:flex;gap:10px;font-size:.9rem;color:#dbe4f0;line-height:1.5}
.ls-insights .ins .b{width:8px;height:8px;border-radius:50%;margin-top:6px;flex-shrink:0;background:#64748b}
.ls-insights .ins.good .b{background:#4ade80}.ls-insights .ins.warn .b{background:#fbbf24}.ls-insights .ins.bad .b{background:#f87171}
.ls-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:2px}
.ls-btn{flex:1;min-width:140px;display:inline-flex;align-items:center;justify-content:center;gap:8px;border-radius:11px;padding:12px 14px;font-weight:700;font-family:'Manrope';font-size:.9rem;cursor:pointer;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08);color:#fff;transition:.2s}
.ls-btn:hover{background:rgba(255,255,255,.16)}
.ls-btn.primary{background:#0883F7;border-color:#0883F7}.ls-btn.primary:hover{background:#1d4ed8}
.ls-btn svg{width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.ls-compare{max-width:1080px;margin:26px auto 0;display:none}
.ls-compare.show{display:block}
.ls-cmp-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;gap:12px;flex-wrap:wrap}
.ls-cmp-head h3{margin:0;font-family:'Manrope';font-size:1.15rem}
.ls-cmp-clear{background:none;border:none;color:var(--blue);font-weight:600;font-size:.86rem;cursor:pointer}
.ls-cmp-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:16px}
.ls-cmp-card{border:1.5px solid var(--border);border-radius:16px;padding:18px;background:#fff;position:relative}
.ls-cmp-card.best{border-color:#16a34a;box-shadow:0 0 0 4px rgba(22,163,74,.12)}
.ls-cmp-badge{position:absolute;top:-11px;left:18px;background:#16a34a;color:#fff;font-size:.7rem;font-weight:700;padding:3px 10px;border-radius:20px}
.ls-cmp-card .nm{font-weight:700;font-family:'Manrope';margin-bottom:8px;padding-right:18px}
.ls-cmp-card .cs{font-family:'Manrope';font-weight:800;font-size:1.9rem;line-height:1}
.ls-cmp-card .cs small{font-size:.8rem;color:var(--muted);font-weight:600}
.ls-cmp-card .cv{font-weight:700;font-size:.86rem;margin:4px 0 10px}
.ls-cmp-card .cv.take{color:#16a34a}.ls-cmp-card .cv.neg{color:#d97706}.ls-cmp-card .cv.pass{color:#dc2626}
.ls-cmp-card .cr{font-size:.84rem;color:var(--muted)}.ls-cmp-card .cr b{color:var(--navy)}
.ls-cmp-x{position:absolute;top:11px;right:13px;cursor:pointer;color:#94a3b8;font-size:1.15rem;line-height:1;background:none;border:none}
.ls-advisor{max-width:1080px;margin:22px auto 0;background:#fff;border:1px solid var(--border);border-radius:20px;padding:26px 28px;box-shadow:0 30px 70px -50px rgba(15,23,42,.4);position:relative;overflow:hidden}
.ls-advisor::before{content:"";position:absolute;inset:0 0 auto 0;height:4px;background:linear-gradient(90deg,#0883F7,#7c3aed,#FC5305)}
.ls-adv-head{display:flex;align-items:center;gap:13px;margin-bottom:16px}
.ls-adv-ic{width:44px;height:44px;border-radius:12px;background:linear-gradient(150deg,#0883F7,#7c3aed);color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 8px 18px -8px rgba(124,58,237,.6)}
.ls-adv-ic svg{width:23px;height:23px}
.ls-adv-head h3{margin:0;font-family:'Manrope';font-size:1.12rem}
.ls-adv-head p{margin:2px 0 0;color:var(--muted);font-size:.85rem}
.ls-adv-rec{font-size:1.02rem;line-height:1.6;color:var(--navy);background:#F8FAFC;border-radius:13px;padding:16px 18px;margin-bottom:18px}
.ls-adv-rec b{color:var(--blue)}
.ls-adv-cols{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.ls-adv-box{border:1px solid var(--border);border-radius:14px;padding:16px 18px}
.ls-adv-t{font-size:.74rem;letter-spacing:.12em;text-transform:uppercase;color:var(--muted);font-weight:700;margin-bottom:10px}
.ls-adv-script{font-size:.95rem;line-height:1.6;color:var(--navy);font-style:italic;margin:0 0 12px}
.ls-adv-copy{display:inline-flex;align-items:center;gap:7px;background:var(--blue);color:#fff;border:none;border-radius:9px;padding:9px 14px;font-weight:700;font-family:'Manrope';font-size:.84rem;cursor:pointer}
.ls-adv-copy:hover{background:#1d4ed8}
.ls-adv-move{display:flex;gap:10px;font-size:.92rem;color:var(--navy);line-height:1.5;margin-bottom:10px}
.ls-adv-move:last-child{margin-bottom:0}
.ls-adv-move .m{width:24px;height:24px;border-radius:7px;background:#EFF6FF;color:var(--blue);display:flex;align-items:center;justify-content:center;flex-shrink:0;font-weight:800;font-size:.8rem}
@media(max-width:880px){.ls-grid{grid-template-columns:1fr}.ls-result{order:-1}.ls-adv-cols{grid-template-columns:1fr}}
@media(max-width:520px){.ls-row{grid-template-columns:1fr}.ls-metrics{grid-template-columns:1fr}}
'''

LS_HTML = r'''<div class="ls-tool" id="loadscore">
 <div class="ls-grid">
  <div class="ls-inputs">
   <h3>Load details</h3>
   <p class="ls-cap">Punch in the offer. We score it against your real costs &mdash; instantly.</p>
   <div class="ls-f"><label for="ls_label">Nickname this load <span style="color:var(--muted);font-weight:500">(optional)</span></label><input type="text" id="ls_label" placeholder="e.g. Dallas &rarr; Atlanta" oninput="lsRun()"></div>
   <div class="ls-f"><label for="ls_rate">What does the load pay? ($)</label><input type="number" id="ls_rate" value="2640" oninput="lsRun()"></div>
   <div class="ls-row">
    <div class="ls-f"><label for="ls_loaded">Loaded miles</label><input type="number" id="ls_loaded" value="781" oninput="lsRun()"></div>
    <div class="ls-f"><label for="ls_dead">Deadhead miles <span class="q" title="Empty miles you drive to reach the pickup. They cost fuel and time but earn nothing.">?</span></label><input type="number" id="ls_dead" value="120" oninput="lsRun()"></div>
   </div>
   <div class="ls-row">
    <div class="ls-f"><label for="ls_cpm">Your cost / mile ($) <span class="q" title="All-in: truck payment, insurance, fuel, maintenance, food. Most owner-ops run $1.40-$1.80.">?</span></label><input type="number" id="ls_cpm" value="1.55" step="0.01" oninput="lsRun()"></div>
    <div class="ls-f"><label for="ls_days">Days to run it</label><input type="number" id="ls_days" value="2" step="0.5" oninput="lsRun()"></div>
   </div>
   <button type="button" class="ls-est-toggle" onclick="lsToggleEst()"><span id="ls_est_caret">+</span> Not sure of your cost per mile? Estimate it</button>
   <div class="ls-est" id="ls_est">
    <div class="ls-row">
     <div class="ls-f"><label for="ls_e_fixed">Fixed costs / month ($) <span class="q" title="Truck payment, insurance, permits, ELD, parking.">?</span></label><input type="number" id="ls_e_fixed" value="4200" oninput="lsEstimate()"></div>
     <div class="ls-f"><label for="ls_e_miles">Miles / month</label><input type="number" id="ls_e_miles" value="10000" oninput="lsEstimate()"></div>
    </div>
    <div class="ls-row">
     <div class="ls-f"><label for="ls_e_fuel">Diesel ($/gal)</label><input type="number" id="ls_e_fuel" value="3.85" step="0.01" oninput="lsEstimate()"></div>
     <div class="ls-f"><label for="ls_e_mpg">Truck MPG</label><input type="number" id="ls_e_mpg" value="6.5" step="0.1" oninput="lsEstimate()"></div>
    </div>
    <div class="ls-est-out" id="ls_e_out">Estimated cost per mile: <b>$0.00</b></div>
   </div>
   <div class="ls-row">
    <div class="ls-f"><label for="ls_xpay">Extra pay &mdash; detention, FSC ($) <span class="q" title="Detention, fuel surcharge, layover or other accessorial pay you expect to collect.">?</span></label><input type="number" id="ls_xpay" value="0" oninput="lsRun()"></div>
    <div class="ls-f"><label for="ls_xcost">Extra costs &mdash; tolls, lumper ($)</label><input type="number" id="ls_xcost" value="0" oninput="lsRun()"></div>
   </div>
   <div class="ls-f"><label>Where does it drop you? <span class="q" title="A weak market means you may sit or run cheap/empty to your next load.">?</span></label>
    <select id="ls_market" aria-label="Freight market strength at delivery" oninput="lsRun()"><option value="strong">Strong freight area (easy reload)</option><option value="avg" selected>Average area</option><option value="weak">Weak / dead market</option></select></div>
   <div class="ls-f"><label for="ls_margin">Target profit margin (%)</label><input type="number" id="ls_margin" value="25" oninput="lsRun()"></div>
  </div>
  <div class="ls-result">
   <div class="ls-score-wrap">
    <div class="ls-gauge" id="ls_gauge"><div class="in"><div class="sc" id="ls_score">0</div><div class="of">/ 100</div></div></div>
    <div class="ls-vbox"><div class="vlabel">The verdict</div><div class="ls-verdict" id="ls_verdict"><span class="dot"></span> &mdash;</div></div>
   </div>
   <div class="ls-metrics">
    <div><span>Net profit</span><b id="ls_profit">$0</b></div>
    <div><span>True rate / mile (all miles)</span><b id="ls_rpm">$0.00</b></div>
    <div><span>Profit / day</span><b id="ls_pday">$0</b></div>
    <div><span>Lost to deadhead</span><b id="ls_drag">$0</b></div>
   </div>
   <div class="ls-counter" id="ls_counter">&mdash;</div>
   <div class="ls-insights" id="ls_insights"></div>
   <div class="ls-actions">
    <button type="button" class="ls-btn primary" onclick="lsAddCompare()"><svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add to compare</button>
    <button type="button" class="ls-btn" id="ls_copybtn" onclick="lsCopy()"><svg viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy summary</button>
   </div>
  </div>
 </div>
</div>
<div class="ls-advisor" id="ls_advisor">
 <div class="ls-adv-head"><span class="ls-adv-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8L19 15z"/></svg></span>
  <div><h3>Smart Advisor</h3><p>Your dispatcher's read on this exact load &mdash; in plain English.</p></div></div>
 <div class="ls-adv-rec" id="ls_adv_rec"></div>
 <div class="ls-adv-cols">
  <div class="ls-adv-box"><div class="ls-adv-t">What to tell the broker</div><p class="ls-adv-script" id="ls_adv_script"></p><button type="button" class="ls-adv-copy" id="ls_adv_copybtn" onclick="lsCopyScript()"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy script</button></div>
  <div class="ls-adv-box"><div class="ls-adv-t">Smart moves</div><div id="ls_adv_whatif"></div></div>
 </div>
</div>
<div class="ls-compare" id="ls_compare">
 <div class="ls-cmp-head"><h3>Comparing your loads &mdash; pick the winner</h3><button type="button" class="ls-cmp-clear" onclick="lsClearCmp()">Clear all</button></div>
 <div class="ls-cmp-grid" id="ls_cmp_grid"></div>
</div>'''

LS_JS = r'''
function lsNum(id){var e=document.getElementById(id);if(!e)return 0;var v=parseFloat(e.value);return isNaN(v)?0:v;}
function lsM0(n){return (n<0?'-$':'$')+Math.abs(Math.round(n)).toLocaleString();}
function lsM2(n){return (n<0?'-$':'$')+Math.abs(n).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});}
function lsClamp(x){return Math.max(0,Math.min(1,x));}
function lsToggleEst(){var p=document.getElementById('ls_est');if(!p)return;p.classList.toggle('open');var c=document.getElementById('ls_est_caret');if(c)c.textContent=p.classList.contains('open')?'−':'+';if(p.classList.contains('open'))lsEstimate();}
function lsEstimate(){var fx=lsNum('ls_e_fixed'),mi=lsNum('ls_e_miles'),fuel=lsNum('ls_e_fuel'),mpg=lsNum('ls_e_mpg');
 var fpm=mi>0?fx/mi:0;var fuelpm=mpg>0?fuel/mpg:0;var maint=0.15;var cpm=fpm+fuelpm+maint;
 var out=document.getElementById('ls_e_out');if(out)out.innerHTML='Estimated cost per mile: <b>'+lsM2(cpm)+'</b> &nbsp;(applied above)';
 var f=document.getElementById('ls_cpm');if(f){f.value=cpm.toFixed(2);}lsRun();}
var lsLast=null;
function lsRun(){
 var rate=lsNum('ls_rate'),loaded=lsNum('ls_loaded'),dead=lsNum('ls_dead'),cpm=lsNum('ls_cpm');
 var days=Math.max(0.5,lsNum('ls_days')),mkt=(document.getElementById('ls_market')||{}).value||'avg';
 var xpay=lsNum('ls_xpay'),xcost=lsNum('ls_xcost');
 var margin=lsNum('ls_margin')/100; if(margin<0)margin=0; if(margin>0.9)margin=0.9;
 var total=loaded+dead; if(total<=0)total=1;
 var cost=total*cpm+xcost;
 var revenue=rate+xpay;
 var profit=revenue-cost;
 var rpmAll=revenue/total;
 var pday=profit/days;
 var deadCost=dead*cpm;
 var rev=revenue>0?revenue:1;
 var realMargin=profit/rev;
 var dh=total>0?dead/total:0;
 var sM=lsClamp(realMargin/0.35)*42;
 var sR=lsClamp((rpmAll-1.2)/(2.5-1.2))*22;
 var sD=lsClamp(1-dh/0.30)*14;
 var sP=lsClamp(pday/600)*14;
 var sK=(mkt==='strong'?8:(mkt==='avg'?4:0));
 var score=Math.round(sM+sR+sD+sP+sK);
 if(profit<=0)score=Math.min(score,18);
 score=Math.max(0,Math.min(100,score));
 var col,cls,label;
 if(score>=72){col='#4ade80';cls='take';label='TAKE IT';}
 else if(score>=48){col='#fbbf24';cls='neg';label='NEGOTIATE';}
 else{col='#f87171';cls='pass';label='PASS';}
 document.getElementById('ls_score').textContent=score;
 var g=document.getElementById('ls_gauge');if(g)g.style.background='conic-gradient('+col+' '+(score*3.6)+'deg,#1f2b45 0deg)';
 var v=document.getElementById('ls_verdict');if(v){v.className='ls-verdict '+cls;v.innerHTML='<span class="dot"></span> '+label;}
 var pe=document.getElementById('ls_profit');pe.textContent=lsM0(profit);pe.className=profit>=0?'pos':'neg';
 document.getElementById('ls_rpm').textContent=lsM2(rpmAll);
 var pd=document.getElementById('ls_pday');pd.textContent=lsM0(pday);pd.className=pday>=0?'pos':'neg';
 document.getElementById('ls_drag').textContent=lsM0(deadCost);
 var counterTotal=(total*cpm+xcost)/(1-margin)-xpay;
 var counterRpm=loaded>0?(counterTotal+xpay)/loaded:0;
 var ce=document.getElementById('ls_counter');
 if(realMargin>=margin){ce.innerHTML='Rate already clears your '+Math.round(margin*100)+'% margin target &mdash; <b>lock it in.</b>';}
 else{ce.innerHTML='Counter at <b>'+lsM0(counterTotal)+'</b> ('+lsM2(counterRpm)+'/loaded mi) to hit your '+Math.round(margin*100)+'% margin.';}
 var ins=[];
 if(score>=72)ins.push(['good','The numbers work in your favor &mdash; this is a load worth taking.']);
 if(profit<=0)ins.push(['bad','You lose '+lsM0(-profit)+' after your costs. Only run it to reposition &mdash; or counter hard.']);
 else if(realMargin<margin*0.6)ins.push(['warn','Thin margin: just '+lsM0(profit)+' profit across '+Math.round(total).toLocaleString()+' miles.']);
 if(dh>=0.15)ins.push(['warn','Deadhead is '+Math.round(dh*100)+'% of the trip &mdash; it costs ~'+lsM0(deadCost)+' and drags your real rate to '+lsM2(rpmAll)+'/mi.']);
 else if(dead>0)ins.push(['good','Low deadhead &mdash; only '+Math.round(dead).toLocaleString()+' empty miles to pickup.']);
 if(pday<500)ins.push(['warn','At '+lsM0(pday)+'/day this sits below a healthy ~$500/day target.']);
 else ins.push(['good','Solid '+lsM0(pday)+' per day for your truck.']);
 if(mkt==='weak')ins.push(['warn','It drops you in a weak market &mdash; line up a reload or add money for the empty miles back out.']);
 else if(mkt==='strong')ins.push(['good','Leaves you in a strong freight area, so your reload should be easy.']);
 var box=document.getElementById('ls_insights');
 box.innerHTML=ins.slice(0,5).map(function(x){return '<div class="ins '+x[0]+'"><span class="b"></span><span>'+x[1]+'</span></div>';}).join('');
 // ---- Smart Advisor (AI-style recommendation, script, what-if) ----
 var rec;
 if(cls==='take'){rec='<b>Take it.</b> At '+lsM2(rpmAll)+'/mi all-in, this load clears your costs with <b>'+lsM0(profit)+'</b> to spare'+(mkt==='strong'?' and leaves you in a strong freight area':'')+'. Lock it in before the broker hands it to the next driver.';}
 else if(cls==='neg'){rec='<b>Don&rsquo;t say yes yet.</b> The bones are okay, but the margin is thin at '+lsM0(profit)+'. Counter to <b>'+lsM0(counterTotal)+'</b> and you turn a so-so load into a solid one. If they won&rsquo;t budge, you can walk.';}
 else{rec='<b>Pass on this one.</b> After your real costs it nets <b>'+lsM0(profit)+'</b>'+(profit<=0?' &mdash; it actually loses money':'')+'. The only reason to touch it is to reposition out of a dead market.';}
 var recEl=document.getElementById('ls_adv_rec');if(recEl)recEl.innerHTML=rec;
 var script;
 if(realMargin>=margin){script='Appreciate it &mdash; I can cover that load at '+lsM0(rate)+'. Send the rate con over and I&rsquo;ll get it booked.';}
 else{script='Thanks for the offer. With the miles and where it delivers, I need '+lsM0(counterTotal)+' to make it work &mdash; about '+lsM2(counterRpm)+' a mile. Can you get me there?';}
 window.lsScript=script.replace(/&mdash;/g,'—').replace(/&rsquo;/g,'’');
 var scEl=document.getElementById('ls_adv_script');if(scEl)scEl.innerHTML='&ldquo;'+script+'&rdquo;';
 var moves=[];
 if(cls!=='take'&&(counterTotal-rate)>0)moves.push(['+$','Get <b>'+lsM0(counterTotal-rate)+'</b> more ('+lsM0(counterTotal)+' total) and it hits your '+Math.round(margin*100)+'% margin target.']);
 if(dh>=0.12&&dead>0)moves.push(['DH','Find a closer pickup &mdash; those '+Math.round(dead).toLocaleString()+' empty miles cost you about '+lsM0(deadCost)+'.']);
 if(pday<500&&days>1)moves.push(['T','Run it in '+(days-0.5)+' days instead of '+days+' and your day-rate climbs to '+lsM0(profit/Math.max(0.5,days-0.5))+'/day.']);
 if(mkt==='weak')moves.push(['M','It ends in a weak market &mdash; book your reload before you roll, or add fuel money for the empty miles out.']);
 if(!moves.length)moves.push(['OK','Numbers are clean and there are no red flags &mdash; book it and keep the truck moving.']);
 var wf=document.getElementById('ls_adv_whatif');if(wf)wf.innerHTML=moves.slice(0,4).map(function(m){return '<div class="ls-adv-move"><span class="m">'+m[0]+'</span><span>'+m[1]+'</span></div>';}).join('');
 var lbl=(document.getElementById('ls_label')||{}).value||'';
 lsLast={label:lbl,score:score,cls:cls,vlabel:label,profit:profit,rpm:rpmAll,pday:pday,rate:rate,total:total,dead:dead,col:col};
}
var lsCmp=[];
function lsRenderCmp(){
 var wrap=document.getElementById('ls_compare'),grid=document.getElementById('ls_cmp_grid');
 if(!wrap||!grid)return;
 if(!lsCmp.length){wrap.classList.remove('show');grid.innerHTML='';return;}
 wrap.classList.add('show');
 var best=Math.max.apply(null,lsCmp.map(function(c){return c.score;}));
 var order=lsCmp.map(function(c,i){return {c:c,i:i};}).sort(function(a,b){return b.c.score-a.c.score;});
 grid.innerHTML=order.map(function(o){var c=o.c;var isBest=(c.score===best);
  return '<div class="ls-cmp-card'+(isBest?' best':'')+'">'+(isBest?'<span class="ls-cmp-badge">Best pick</span>':'')+
   '<button class="ls-cmp-x" onclick="lsRemoveCmp('+o.i+')" aria-label="Remove">&times;</button>'+
   '<div class="nm">'+(c.label||'Untitled load')+'</div>'+
   '<div class="cs">'+c.score+'<small> / 100</small></div>'+
   '<div class="cv '+c.cls+'">'+c.vlabel+'</div>'+
   '<div class="cr">Profit <b>'+lsM0(c.profit)+'</b> &middot; <b>'+lsM2(c.rpm)+'</b>/mi &middot; <b>'+lsM0(c.pday)+'</b>/day</div>'+
   '</div>';}).join('');
}
function lsAddCompare(){if(!lsLast)lsRun();if(!lsLast)return;
 var snap=JSON.parse(JSON.stringify(lsLast));
 if(!snap.label)snap.label='Load '+(lsCmp.length+1);
 lsCmp.push(snap);if(lsCmp.length>6)lsCmp.shift();lsRenderCmp();
 var w=document.getElementById('ls_compare');if(w)w.scrollIntoView({behavior:'smooth',block:'nearest'});}
function lsRemoveCmp(i){lsCmp.splice(i,1);lsRenderCmp();}
function lsClearCmp(){lsCmp=[];lsRenderCmp();}
function lsCopy(){if(!lsLast)lsRun();if(!lsLast)return;var c=lsLast;
 var t='Loadboot Load Score'+(c.label?' ('+c.label+')':'')+': '+c.score+'/100 — '+c.vlabel+'. '+
  'Net profit '+lsM0(c.profit)+', true rate '+lsM2(c.rpm)+'/mi over '+Math.round(c.total).toLocaleString()+' miles, '+lsM0(c.pday)+'/day. Scored free at loadboot.com/load-score';
 var btn=document.getElementById('ls_copybtn');
 function ok(){if(btn){var o=btn.innerHTML;btn.innerHTML='Copied ✓';setTimeout(function(){btn.innerHTML=o;},1600);}}
 if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(ok).catch(function(){window.prompt('Copy this load summary:',t);});}
 else{window.prompt('Copy this load summary:',t);}
}
function lsCopyScript(){var t=window.lsScript||'';var btn=document.getElementById('ls_adv_copybtn');
 function ok(){if(btn){var o=btn.innerHTML;btn.innerHTML='Copied ✓';setTimeout(function(){btn.innerHTML=o;},1600);}}
 if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(t).then(ok).catch(function(){window.prompt('Copy this script:',t);});}
 else{window.prompt('Copy this script:',t);}
}
if(document.getElementById('ls_rate')){lsRun();}else{document.addEventListener('DOMContentLoaded',function(){if(document.getElementById('ls_rate'))lsRun();});}
'''
