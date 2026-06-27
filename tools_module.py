# -*- coding: utf-8 -*-
# Shared "free tools" calculators — used by both the website (tools.html) and the dashboard.
# All markup uses inline SVGs (no HTML entities) so it is safe to drop into either context.

TOOLS_CSS = r'''
.tk-wrap{max-width:1100px;margin:0 auto}
.tk-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:22px}
.tk-card{background:#fff;border:1px solid var(--border);border-radius:18px;padding:24px;scroll-margin-top:90px;transition:.25s}
.tk-card:hover{box-shadow:0 24px 50px -30px rgba(37,99,235,.4)}
.tk-head{display:flex;align-items:center;gap:13px;margin-bottom:6px}
.tk-ic{width:46px;height:46px;border-radius:13px;background:linear-gradient(150deg,#3b82f6,#1e40af);color:#fff;display:flex;align-items:center;justify-content:center;flex-shrink:0;box-shadow:0 8px 18px -8px rgba(37,99,235,.6),inset 0 1px 0 rgba(255,255,255,.3)}
.tk-ic svg{width:23px;height:23px;stroke:#fff;stroke-width:2;fill:none;stroke-linecap:round;stroke-linejoin:round}
.tk-card.o .tk-ic{background:linear-gradient(150deg,#fb923c,#ea6a0c);box-shadow:0 8px 18px -8px rgba(249,115,22,.6),inset 0 1px 0 rgba(255,255,255,.3)}
.tk-head h2{font-size:1.08rem;margin:0;font-family:'Manrope'}
.tk-sub{color:var(--muted);font-size:.86rem;margin:0 0 16px}
.tk-row{display:grid;grid-template-columns:1fr 1fr;gap:13px;margin-bottom:13px}
.tk-in{display:flex;flex-direction:column;gap:6px}
.tk-in.full{grid-column:1/-1}
.tk-in label{font-weight:600;font-size:.82rem;color:var(--navy)}
.tk-in input,.tk-in select{padding:11px 13px;border:1px solid var(--border);border-radius:10px;font-family:inherit;font-size:.95rem;color:var(--navy);background:#fff;width:100%}
.tk-in input:focus,.tk-in select:focus{outline:none;border-color:var(--blue);box-shadow:0 0 0 3px #EFF6FF}
.tk-out{margin-top:8px;background:#F8FAFC;border:1px solid var(--border);border-left:4px solid var(--blue);border-radius:14px;padding:16px 18px;display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap}
.tk-card.o .tk-out{border-left-color:var(--orange)}
.tk-out .big{font-family:'Manrope';font-weight:800;font-size:1.85rem;line-height:1;color:var(--navy)}
.tk-out .big.pos{color:#16a34a}.tk-out .big.neg{color:#dc2626}
.tk-out .lbl{font-size:.78rem;color:var(--muted);margin-top:5px}
.tk-out .side{text-align:right;font-size:.82rem;color:var(--muted)}
.tk-out .side b{display:block;color:var(--navy);font-size:1.02rem;font-family:'Manrope'}
.tk-note{font-size:.8rem;color:var(--muted);margin-top:10px}
@media(max-width:820px){.tk-grid{grid-template-columns:1fr}}
'''

# Each card has an id anchor so home-page / nav links can deep-link (tools.html#profit, etc.)
TOOLS_HTML = r'''<div class="tk-wrap"><div class="tk-grid">

<div class="tk-card" id="profit">
 <div class="tk-head"><span class="tk-ic"><svg viewBox="0 0 24 24"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg></span><h2>Truck Load Profit Calculator</h2></div>
 <p class="tk-sub">Know exactly what a load nets you before you accept it.</p>
 <div class="tk-row">
  <div class="tk-in"><label>Load pays ($)</label><input type="number" id="p_rate" value="2640" oninput="tkProfit()"></div>
  <div class="tk-in"><label>Total miles</label><input type="number" id="p_mi" value="781" oninput="tkProfit()"></div>
  <div class="tk-in"><label>Fuel price ($/gal)</label><input type="number" id="p_fuel" value="3.85" step="0.01" oninput="tkProfit()"></div>
  <div class="tk-in"><label>Truck MPG</label><input type="number" id="p_mpg" value="6.5" step="0.1" oninput="tkProfit()"></div>
  <div class="tk-in full"><label>Other costs &mdash; tolls, food, maintenance ($)</label><input type="number" id="p_other" value="150" oninput="tkProfit()"></div>
 </div>
 <div class="tk-out"><div><div class="big pos" id="p_net">$0</div><div class="lbl">Net profit on this load</div></div>
  <div class="side"><b id="p_rpm">$0.00</b>rate / mile<br><b id="p_fuelc">$0</b>fuel cost</div></div>
</div>

<div class="tk-card o" id="rpm">
 <div class="tk-head"><span class="tk-ic"><svg viewBox="0 0 24 24"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg></span><h2>Rate Per Mile Calculator</h2></div>
 <p class="tk-sub">The number every dispatcher quotes. Is the rate any good?</p>
 <div class="tk-row">
  <div class="tk-in"><label>Load pays ($)</label><input type="number" id="r_rate" value="2190" oninput="tkRpm()"></div>
  <div class="tk-in"><label>Loaded miles</label><input type="number" id="r_mi" value="665" oninput="tkRpm()"></div>
 </div>
 <div class="tk-out"><div><div class="big" id="r_rpm">$0.00</div><div class="lbl">Per loaded mile</div></div>
  <div class="side"><b id="r_verdict">&mdash;</b>vs ~$2.00 break-even</div></div>
 <p class="tk-note">Rule of thumb: under ~$1.80/mi rarely covers costs; $2.50+ is healthy for most dry van.</p>
</div>

<div class="tk-card" id="cpm">
 <div class="tk-head"><span class="tk-ic"><svg viewBox="0 0 24 24"><path d="M2 7h12v9H2z"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="6.5" cy="18" r="1.7"/><circle cx="17.5" cy="18" r="1.7"/></svg></span><h2>Cost Per Mile Calculator</h2></div>
 <p class="tk-sub">Your true cost to turn a wheel &mdash; the foundation of every rate.</p>
 <div class="tk-row">
  <div class="tk-in"><label>Fixed costs / month ($)</label><input type="number" id="c_fixed" value="4200" oninput="tkCpm()"></div>
  <div class="tk-in"><label>Miles / month</label><input type="number" id="c_miles" value="10000" oninput="tkCpm()"></div>
  <div class="tk-in full"><label>Variable cost / mile &mdash; fuel, tires, maint. ($)</label><input type="number" id="c_var" value="0.72" step="0.01" oninput="tkCpm()"></div>
 </div>
 <div class="tk-out"><div><div class="big" id="c_cpm">$0.00</div><div class="lbl">Total cost per mile</div></div>
  <div class="side"><b id="c_fixedpm">$0.00</b>fixed / mi<br><b id="c_break">$0.00</b>break-even rate</div></div>
 <p class="tk-note">Fixed = truck payment, insurance, permits. Any rate below your cost-per-mile loses money.</p>
</div>

<div class="tk-card o" id="fuel">
 <div class="tk-head"><span class="tk-ic"><svg viewBox="0 0 24 24"><path d="M3 22h12V4a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2z"/><path d="M15 9h2.5a2 2 0 0 1 2 2v6a1.5 1.5 0 0 0 3 0V8l-3-3"/><line x1="6" y1="7" x2="12" y2="7"/></svg></span><h2>Truck Fuel Cost Calculator</h2></div>
 <p class="tk-sub">Fuel cost for any lane in seconds.</p>
 <div class="tk-row">
  <div class="tk-in"><label>Trip miles</label><input type="number" id="f_mi" value="781" oninput="tkFuel()"></div>
  <div class="tk-in"><label>Truck MPG</label><input type="number" id="f_mpg" value="6.5" step="0.1" oninput="tkFuel()"></div>
  <div class="tk-in full"><label>Diesel price ($/gal)</label><input type="number" id="f_price" value="3.85" step="0.01" oninput="tkFuel()"></div>
 </div>
 <div class="tk-out"><div><div class="big" id="f_cost">$0</div><div class="lbl">Total fuel for this trip</div></div>
  <div class="side"><b id="f_gal">0</b>gallons<br><b id="f_permi">$0.00</b>fuel / mile</div></div>
</div>

<div class="tk-card" id="breakeven">
 <div class="tk-head"><span class="tk-ic"><svg viewBox="0 0 24 24"><path d="M12 3v18M3 12h18"/><path d="M5 7l14 10M19 7L5 17"/></svg></span><h2>Break-Even Rate Calculator</h2></div>
 <p class="tk-sub">The lowest rate you can accept and still hit your margin.</p>
 <div class="tk-row">
  <div class="tk-in"><label>Your cost / mile ($)</label><input type="number" id="b_cpm" value="1.55" step="0.01" oninput="tkBreak()"></div>
  <div class="tk-in"><label>Target profit margin (%)</label><input type="number" id="b_margin" value="25" oninput="tkBreak()"></div>
 </div>
 <div class="tk-out"><div><div class="big" id="b_rate">$0.00</div><div class="lbl">Minimum rate / mile to accept</div></div>
  <div class="side"><b id="b_profit">$0.00</b>profit / mile</div></div>
 <p class="tk-note">Don&rsquo;t book below this number. Plug your cost-per-mile in from the calculator above.</p>
</div>

<div class="tk-card o" id="takehome">
 <div class="tk-head"><span class="tk-ic"><svg viewBox="0 0 24 24"><rect x="2" y="5" width="20" height="14" rx="2"/><circle cx="12" cy="12" r="3"/><line x1="2" y1="10" x2="22" y2="10"/></svg></span><h2>Owner-Operator Take-Home Pay Calculator</h2></div>
 <p class="tk-sub">What actually lands in your pocket after every cost.</p>
 <div class="tk-row">
  <div class="tk-in"><label>Gross / week ($)</label><input type="number" id="t_gross" value="6000" oninput="tkHome()"></div>
  <div class="tk-in"><label>Dispatch fee (%)</label><input type="number" id="t_fee" value="5" step="0.5" oninput="tkHome()"></div>
  <div class="tk-in"><label>Fuel / week ($)</label><input type="number" id="t_fuel" value="1600" oninput="tkHome()"></div>
  <div class="tk-in"><label>Other expenses ($)</label><input type="number" id="t_other" value="900" oninput="tkHome()"></div>
 </div>
 <div class="tk-out"><div><div class="big pos" id="t_take">$0</div><div class="lbl">Your weekly take-home</div></div>
  <div class="side"><b id="t_feeamt">$0</b>dispatch fee<br><b id="t_year">$0</b>/yr (est.)</div></div>
 <p class="tk-note">At a flat 5%, Loadboot only earns when we book you a paying load.</p>
</div>

<div class="tk-card" id="detention">
 <div class="tk-head"><span class="tk-ic"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 16 14"/></svg></span><h2>Truck Detention Pay Calculator</h2></div>
 <p class="tk-sub">Stuck at the dock? Here&rsquo;s what they owe you.</p>
 <div class="tk-row">
  <div class="tk-in"><label>Hours waited</label><input type="number" id="d_wait" value="5" step="0.5" oninput="tkDet()"></div>
  <div class="tk-in"><label>Free hours allowed</label><input type="number" id="d_free" value="2" step="0.5" oninput="tkDet()"></div>
  <div class="tk-in full"><label>Detention rate ($/hr)</label><input type="number" id="d_rate" value="50" oninput="tkDet()"></div>
 </div>
 <div class="tk-out"><div><div class="big pos" id="d_owed">$0</div><div class="lbl">Detention you should bill</div></div>
  <div class="side"><b id="d_hrs">0</b>billable hours</div></div>
 <p class="tk-note">Always get detention in writing on the rate con. We handle the claim for you.</p>
</div>

<div class="tk-card o" id="deadhead">
 <div class="tk-head"><span class="tk-ic"><svg viewBox="0 0 24 24"><path d="M2 7h12v9H2z"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="6.5" cy="18" r="1.7"/><circle cx="17.5" cy="18" r="1.7"/></svg></span><h2>Deadhead Miles Calculator</h2></div>
 <p class="tk-sub">Empty miles quietly eat your rate. See the real number.</p>
 <div class="tk-row">
  <div class="tk-in"><label>Load pays ($)</label><input type="number" id="h_rate" value="2640" oninput="tkDead()"></div>
  <div class="tk-in"><label>Loaded miles</label><input type="number" id="h_loaded" value="781" oninput="tkDead()"></div>
  <div class="tk-in full"><label>Deadhead (empty) miles to pickup</label><input type="number" id="h_dead" value="120" oninput="tkDead()"></div>
 </div>
 <div class="tk-out"><div><div class="big" id="h_eff">$0.00</div><div class="lbl">True rate / mile (all miles)</div></div>
  <div class="side"><b id="h_paid">$0.00</b>paid-mile rate<br><b id="h_loss">$0.00</b>lost to deadhead</div></div>
</div>

</div></div>'''

TOOLS_JS = r'''
function _n(id){var e=document.getElementById(id);if(!e)return 0;var v=parseFloat(e.value);return isNaN(v)?0:v;}
function _m0(n){return '$'+Math.round(n).toLocaleString();}
function _m2(n){return '$'+(n||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});}
function _set(id,t){var e=document.getElementById(id);if(e)e.textContent=t;}
function tkProfit(){var rate=_n('p_rate'),mi=_n('p_mi'),fuel=_n('p_fuel'),mpg=_n('p_mpg'),other=_n('p_other');
 var fc=mpg>0?mi/mpg*fuel:0;var net=rate-fc-other;
 _set('p_net',_m0(net));var el=document.getElementById('p_net');if(el)el.className='big '+(net>=0?'pos':'neg');
 _set('p_rpm',mi>0?_m2(rate/mi):'$0.00');_set('p_fuelc',_m0(fc));}
function tkRpm(){var rate=_n('r_rate'),mi=_n('r_mi');var v=mi>0?rate/mi:0;_set('r_rpm',_m2(v));
 _set('r_verdict',v>=2.5?'Strong':(v>=2.0?'Fair':(v>=1.8?'Tight':'Too low')));}
function tkCpm(){var fx=_n('c_fixed'),mi=_n('c_miles'),va=_n('c_var');var fpm=mi>0?fx/mi:0;var cpm=fpm+va;
 _set('c_cpm',_m2(cpm));_set('c_fixedpm',_m2(fpm));_set('c_break',_m2(cpm));}
function tkFuel(){var mi=_n('f_mi'),mpg=_n('f_mpg'),pr=_n('f_price');var gal=mpg>0?mi/mpg:0;var cost=gal*pr;
 _set('f_cost',_m0(cost));_set('f_gal',Math.round(gal).toLocaleString());_set('f_permi',mi>0?_m2(cost/mi):'$0.00');}
function tkBreak(){var cpm=_n('b_cpm'),mg=_n('b_margin')/100;var rate=mg<1?cpm/(1-mg):cpm;
 _set('b_rate',_m2(rate));_set('b_profit',_m2(rate-cpm));}
function tkHome(){var g=_n('t_gross'),fee=_n('t_fee')/100,fu=_n('t_fuel'),ot=_n('t_other');
 var feeAmt=g*fee;var take=g-feeAmt-fu-ot;
 _set('t_take',_m0(take));var el=document.getElementById('t_take');if(el)el.className='big '+(take>=0?'pos':'neg');
 _set('t_feeamt',_m0(feeAmt));_set('t_year',_m0(take*50));}
function tkDet(){var w=_n('d_wait'),fr=_n('d_free'),rt=_n('d_rate');var hrs=Math.max(0,w-fr);
 _set('d_owed',_m0(hrs*rt));_set('d_hrs',hrs);}
function tkDead(){var rate=_n('h_rate'),ld=_n('h_loaded'),dd=_n('h_dead');var tot=ld+dd;
 var eff=tot>0?rate/tot:0;var paid=ld>0?rate/ld:0;
 _set('h_eff',_m2(eff));_set('h_paid',_m2(paid));_set('h_loss',_m2(paid-eff));}
function tkInitAll(){try{tkProfit();tkRpm();tkCpm();tkFuel();tkBreak();tkHome();tkDet();tkDead();}catch(e){}}
if(document.readyState!=='loading')tkInitAll();else document.addEventListener('DOMContentLoaded',tkInitAll);
'''
