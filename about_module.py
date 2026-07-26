# about_module.py — World-class About page sections (Uber/Amazon-pattern: mission-first,
# pain → ecosystem → per-role solutions → comparison → trust engine → story → CTA).
# Self-contained HTML + scoped CSS (.ab2-*), inline animated SVG only (no external JS/images),
# mobile-responsive, conversion-focused for all 4 audiences.

ABOUT_CSS = '''<style>
.ab2-hero{background:linear-gradient(135deg,#0b1220 0%,#10223B 45%,#14335c 100%);border-radius:26px;padding:56px 40px;color:#fff;position:relative;overflow:hidden}
.ab2-hero:before{content:"";position:absolute;inset:0;background:radial-gradient(700px 300px at 85% 15%,rgba(8,131,247,.25),transparent 60%),radial-gradient(500px 260px at 10% 90%,rgba(252,83,5,.16),transparent 60%)}
.ab2-hero-in{position:relative;display:grid;grid-template-columns:1.15fr .85fr;gap:36px;align-items:center}
.ab2-hero h1{font-size:clamp(1.9rem,4.4vw,3.3rem);line-height:1.08;margin:12px 0 14px;letter-spacing:-.02em}
.ab2-hero h1 em{font-style:normal;color:#7cc0ff}
.ab2-kick{display:inline-flex;align-items:center;gap:8px;background:rgba(8,131,247,.16);border:1px solid rgba(124,192,255,.35);color:#9ed1ff;font-weight:800;font-size:.78rem;letter-spacing:.12em;text-transform:uppercase;padding:7px 14px;border-radius:999px}
.ab2-lead{color:#c7d5ea;font-size:1.08rem;line-height:1.7;max-width:56ch}
.ab2-chips{display:flex;flex-wrap:wrap;gap:10px;margin:22px 0 26px}
.ab2-chip{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.15);border-radius:12px;padding:10px 14px;font-size:.86rem;color:#e2e8f0}
.ab2-chip b{color:#7cc0ff;font-size:1.05rem;display:block}
.ab2-cta{display:inline-block;background:linear-gradient(135deg,#FC5305,#e34a02);color:#fff;font-weight:800;padding:14px 26px;border-radius:13px;text-decoration:none;box-shadow:0 14px 34px rgba(252,83,5,.4);transition:transform .18s}
.ab2-cta:hover{transform:translateY(-2px)}
.ab2-cta.ghost{background:rgba(255,255,255,.08);border:1.5px solid rgba(255,255,255,.25);box-shadow:none;margin-left:10px}
@keyframes ab2Float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
@keyframes ab2Spin{to{transform:rotate(360deg)}}
@keyframes ab2SpinR{to{transform:rotate(-360deg)}}
@keyframes ab2Pulse{0%,100%{opacity:1}50%{opacity:.35}}
@keyframes ab2Dash{to{stroke-dashoffset:-240}}
.ab2-orbit{animation:ab2Float 5s ease-in-out infinite}
.ab2-ring{transform-origin:210px 210px;animation:ab2Spin 26s linear infinite}
.ab2-ring2{transform-origin:210px 210px;animation:ab2SpinR 40s linear infinite}
.ab2-blink{animation:ab2Pulse 2.2s ease-in-out infinite}
.ab2-road{stroke-dasharray:14 10;animation:ab2Dash 6s linear infinite}
.ab2-manif{background:#0b1220;border-radius:22px;padding:44px 40px;text-align:center;color:#fff}
.ab2-manif p{font-size:clamp(1.15rem,2.5vw,1.7rem);line-height:1.55;max-width:34ch;margin:0 auto;font-weight:700}
.ab2-manif p b{color:#FC5305}.ab2-manif p em{font-style:normal;color:#7cc0ff}
.ab2-pain{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px}
.ab2-pcard{background:#fff;border:1px solid #e6edf5;border-radius:18px;padding:22px;box-shadow:0 10px 30px -18px rgba(2,12,30,.25);position:relative;overflow:hidden}
.ab2-pcard:before{content:"";position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,#dc2626,#f97316)}
.ab2-pcard .n{font-size:1.9rem;font-weight:800;color:#dc2626;letter-spacing:-.02em}
.ab2-pcard h3{margin:6px 0 6px;font-size:1.02rem}.ab2-pcard p{font-size:.9rem;color:#475569;margin:0;line-height:1.6}
.ab2-role{display:grid;grid-template-columns:1fr 1fr;gap:34px;align-items:center;background:#fff;border:1px solid #e6edf5;border-radius:22px;padding:34px;box-shadow:0 16px 44px -26px rgba(2,12,30,.3);margin-top:18px}
.ab2-role.dark{background:linear-gradient(135deg,#0b1220,#12304f);border:none;color:#fff}
.ab2-role.dark h3{color:#fff}.ab2-role.dark li{color:#c7d5ea}.ab2-role.dark .ab2-quote{color:#9fb3cc}
.ab2-role .tag{display:inline-block;font-weight:800;font-size:.74rem;letter-spacing:.1em;text-transform:uppercase;padding:6px 12px;border-radius:999px;margin-bottom:10px}
.ab2-role h3{font-size:1.55rem;margin:0 0 10px;letter-spacing:-.01em}
.ab2-role ul{list-style:none;margin:0 0 14px;padding:0}
.ab2-role li{padding:7px 0 7px 30px;position:relative;font-size:.97rem;line-height:1.55;color:#334155}
.ab2-role li:before{content:"✓";position:absolute;left:0;top:7px;width:20px;height:20px;border-radius:7px;background:#e8f4ff;color:#0883F7;font-weight:800;font-size:.8rem;display:flex;align-items:center;justify-content:center}
.ab2-role.dark li:before{background:rgba(124,192,255,.18);color:#7cc0ff}
.ab2-quote{font-style:italic;color:#64748b;font-size:.92rem;border-left:3px solid #0883F7;padding-left:12px;margin:0 0 16px}
.ab2-viz{background:linear-gradient(160deg,#0d1b31,#153055);border-radius:18px;padding:18px;display:flex;justify-content:center}
.ab2-cmp{width:100%;border-collapse:separate;border-spacing:0;background:#fff;border-radius:18px;overflow:hidden;box-shadow:0 16px 44px -26px rgba(2,12,30,.3);font-size:.92rem}
.ab2-cmp th{background:#10223B;color:#fff;padding:14px 12px;text-align:left;font-size:.86rem}
.ab2-cmp th.lb{background:linear-gradient(135deg,#0883F7,#065fb8)}
.ab2-cmp td{padding:12px;border-bottom:1px solid #eef2f7;color:#334155;vertical-align:top;line-height:1.5}
.ab2-cmp td.lb{background:#f2f8ff;font-weight:600;color:#0b3a66}
.ab2-cmp tr:last-child td{border-bottom:none}
.ab2-doors{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px}
.ab2-door{background:linear-gradient(160deg,#0d1b31,#153055);border-radius:18px;padding:24px;color:#fff;text-decoration:none;display:block;transition:transform .2s,box-shadow .2s;border:1px solid rgba(124,192,255,.15)}
.ab2-door:hover{transform:translateY(-5px);box-shadow:0 22px 50px -22px rgba(8,131,247,.55)}
.ab2-door .ic{font-size:1.9rem}.ab2-door b{display:block;font-size:1.08rem;margin:8px 0 5px}
.ab2-door p{color:#9fb3cc;font-size:.86rem;margin:0 0 12px;line-height:1.55}
.ab2-door span{color:#FC5305;font-weight:800;font-size:.9rem}
@media(max-width:900px){.ab2-hero-in,.ab2-role{grid-template-columns:1fr}.ab2-hero{padding:38px 22px}.ab2-role{padding:24px}.ab2-viz{order:-1}.ab2-cta.ghost{margin-left:0;margin-top:10px}.ab2-cmp{font-size:.82rem}.ab2-cmp th,.ab2-cmp td{padding:9px 8px}}
</style>'''

# Animated ecosystem/orbit SVG for the hero — LoadBoot hub with 4 orbiting roles.
_HERO_SVG = '''<svg class="ab2-orbit" width="340" height="340" viewBox="0 0 420 420" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Carriers, brokers, shippers and dispatchers connected on one LoadBoot platform">
<defs><radialGradient id="abg" cx="50%" cy="50%" r="55%"><stop offset="0%" stop-color="#0883F7" stop-opacity=".35"/><stop offset="100%" stop-color="#0883F7" stop-opacity="0"/></radialGradient></defs>
<circle cx="210" cy="210" r="180" fill="url(#abg)"/>
<g class="ab2-ring" stroke="#3f6ea6" stroke-dasharray="3 7" fill="none"><circle cx="210" cy="210" r="150"/></g>
<g class="ab2-ring2" stroke="#33597f" stroke-dasharray="2 9" fill="none"><circle cx="210" cy="210" r="105"/></g>
<g class="ab2-ring"><g transform="translate(210,60)"><circle r="26" fill="#12304f" stroke="#7cc0ff"/><text y="6" text-anchor="middle" font-size="20">🚚</text></g>
<g transform="translate(360,210)"><circle r="26" fill="#12304f" stroke="#7cc0ff"/><text y="6" text-anchor="middle" font-size="20">🏢</text></g>
<g transform="translate(210,360)"><circle r="26" fill="#12304f" stroke="#7cc0ff"/><text y="6" text-anchor="middle" font-size="20">📦</text></g>
<g transform="translate(60,210)"><circle r="26" fill="#12304f" stroke="#7cc0ff"/><text y="6" text-anchor="middle" font-size="20">🧑‍✈️</text></g></g>
<circle cx="210" cy="210" r="58" fill="#0b1220" stroke="#0883F7" stroke-width="2.5"/>
<circle class="ab2-blink" cx="210" cy="164" r="4" fill="#22c55e"/>
<text x="210" y="205" text-anchor="middle" font-size="15" font-weight="800" fill="#fff" font-family="Inter,Arial">Load<tspan fill="#FC5305">Boot</tspan></text>
<text x="210" y="226" text-anchor="middle" font-size="9.5" fill="#7cc0ff" font-family="Inter,Arial">ONE PLATFORM</text></svg>'''

# Mini dashboard SVGs per role panel.
def _viz(rows, accent):
    bars = ''.join('<rect x="26" y="%d" width="%d" height="10" rx="5" fill="%s" opacity="%s"/>' % (46+i*24, w, accent, o) for i,(w,o) in enumerate(rows))
    return ('<svg width="290" height="180" viewBox="0 0 320 200" xmlns="http://www.w3.org/2000/svg">'
      '<rect x="10" y="10" width="300" height="180" rx="16" fill="#0b1830" stroke="#2b4a71"/>'
      '<circle class="ab2-blink" cx="34" cy="32" r="5" fill="#22c55e"/><text x="48" y="36" font-size="11" fill="#9fb3cc" font-family="Inter,Arial">LIVE</text>'
      '<path class="ab2-road" d="M26 168 H 294" stroke="#3f6ea6" stroke-width="3" fill="none"/>'
      '<text x="294" y="36" text-anchor="end" font-size="11" fill="#7cc0ff" font-weight="700" font-family="Inter,Arial">loadboot.com</text>'
      + bars + '</svg>')

def about_sections():
    S = []
    # 1 — HERO
    S.append('<section><div class="wrap"><div class="ab2-hero reveal"><div class="ab2-hero-in"><div>'
      '<span class="ab2-kick">⚡ About LoadBoot</span>'
      '<h1>The Operating System <em>for Trucking.</em></h1>'
      '<p class="ab2-lead">Freight runs on trust — and trust was broken. Ghost loads, unpaid detention, stacked margins, contracts built to trap. LoadBoot rebuilt the whole chain on one platform where <b style="color:#fff">every load is real, every promise is written, and every mile is proven.</b></p>'
      '<div class="ab2-chips"><div class="ab2-chip"><b>0</b>ghost loads — ever</div><div class="ab2-chip"><b>5%</b>flat, only when we book you</div><div class="ab2-chip"><b>$0</b>for brokers to post</div><div class="ab2-chip"><b>24/7</b>humans + AI on standby</div></div>'
      '<div><a class="ab2-cta" href="get-started.html">Find your seat →</a><a class="ab2-cta ghost" href="how-it-works.html">See how it works</a></div>'
      '</div><div style="display:flex;justify-content:center">' + _HERO_SVG + '</div></div></div></div></section>')
    # 2 — MANIFESTO
    S.append('<section><div class="wrap"><div class="ab2-manif reveal"><div class="eyebrow" style="color:#7cc0ff">Our mission</div>'
      '<p>Make moving freight in America <b>honest</b>, <em>provable</em>, and profitable — for the people who actually move it.</p></div></div></section>')
    # 3 — THE PROBLEM
    S.append('<section class="bg-soft"><div class="wrap"><div class="sec-head center reveal"><div class="eyebrow">Why we exist</div>'
      '<h2>The problems we refuse to accept</h2><p>These are not "industry quirks." They are the reasons small trucking businesses die. We built LoadBoot to kill each one.</p></div>'
      '<div class="ab2-pain reveal">'
      '<div class="ab2-pcard"><div class="n">30–50%</div><h3>Ghost loads</h3><p>Of postings on major load boards are reposted or fake — bait to fish your rate. On LoadBoot a load cannot post without being verified real. <a href="ghost-loads-load-board-problems.html">See the proof →</a></p></div>'
      '<div class="ab2-pcard"><div class="n">&lt;50%</div><h3>Detention never paid</h3><p>Most detention invoices die in an inbox. Here, detention, TONU and layover are pre-agreed in writing on every posting — and filed automatically from GPS records.</p></div>'
      '<div class="ab2-pcard"><div class="n">15–25%</div><h3>Margins stacked in the dark</h3><p>Every middleman takes a slice you never see. Our fee is one number, printed on the pricing page: 5% flat when we book you. That is the entire fee schedule.</p></div>'
      '<div class="ab2-pcard"><div class="n">180d</div><h3>Contracts built to trap</h3><p>Long lock-ins and exclusivity are how bad service survives. LoadBoot has no long-term contracts — we have to earn your truck every single week.</p></div>'
      '</div></div></section>')
    # 4 — ECOSYSTEM
    S.append('<section><div class="wrap"><div class="sec-head center reveal"><div class="eyebrow">One platform, every seat</div>'
      '<h2>Four sides of freight. One set of rails.</h2>'
      '<p>Most software serves one side and fights the rest. LoadBoot puts the carrier, the broker, the shipper and the dispatcher on the <b>same verified record</b> — the same load, rate, GPS trail, documents and money. When everyone sees the same truth, nobody gets played.</p></div>'
      '<div class="grid g3 reveal">'
      '<div class="card"><div class="icon">🔎</div><h3>Verified in, verified out</h3><p>Carriers are checked live against FMCSA before they can book. Brokers are vetted before they can post. Identity fraud and double-brokering have nowhere to hide.</p></div>'
      '<div class="card"><div class="icon">🛰️</div><h3>Proof, not promises</h3><p>Geofenced arrive/depart stamps, photo PODs, e-signed rate cons and agreements. Every claim traces to a record — which is why claims actually get paid.</p></div>'
      '<div class="card"><div class="icon">💸</div><h3>Money that moves right</h3><p>Itemized settlements, detention auto-filed, QuickBooks sync, and a human approving every payout. Software prepares; people sign off.</p></div>'
      '</div></div></section>')
    # 5 — CARRIERS
    S.append('<section class="bg-soft"><div class="wrap"><div class="sec-head center reveal"><div class="eyebrow">Who we serve</div><h2>Whatever seat you sit in — this is yours</h2></div>'
      '<div class="ab2-role reveal"><div>'
      '<span class="tag" style="background:#e8f4ff;color:#0883F7">🚚 For Carriers &amp; Owner-Operators</span>'
      '<h3>Stop hunting. Start hauling.</h3>'
      '<p class="ab2-quote">"I spent 20 hours a week on load boards fighting over freight that didn\'t exist."</p>'
      '<ul><li><b>Zero ghost loads</b> — every posting verified real before you ever see it</li>'
      '<li>Detention, TONU &amp; layover <b>pre-agreed in writing</b> on every load, filed automatically from your GPS trail</li>'
      '<li>Flat <b>5% only when we book you</b> — $0 monthly, no contract, fire us any week</li>'
      '<li>Dispatch, docs, settlements, fuel &amp; IFTA, even QuickBooks — one login</li></ul>'
      '<a class="ab2-cta" href="create-carrier-account.html">Create carrier account →</a></div>'
      '<div class="ab2-viz">' + _viz([(180,'1'),(230,'.75'),(140,'.55'),(250,'.9')],'#0883F7') + '</div></div>')
    # 6 — BROKERS
    S.append('<div class="ab2-role dark reveal"><div class="ab2-viz">' + _viz([(210,'1'),(160,'.7'),(240,'.9'),(120,'.5')],'#FC5305') + '</div><div>'
      '<span class="tag" style="background:rgba(252,83,5,.18);color:#ff9c66">🏢 For Freight Brokers</span>'
      '<h3>Post free. Cover with carriers you can prove.</h3>'
      '<p class="ab2-quote">"Half my day was chasing check calls and praying the carrier was who they said they were."</p>'
      '<ul><li>Post loads <b>100% free — forever</b>. No subscription, no per-post fee</li>'
      '<li>Every carrier <b>FMCSA-verified</b> (authority, insurance, safety) before they can book</li>'
      '<li>Live GPS + geofenced arrive/depart on every load — check calls are dead</li>'
      '<li>Documents collected automatically; zero double-brokering by design</li></ul>'
      '<a class="ab2-cta" href="create-broker-account.html">Create broker account →</a></div></div>')
    # 7 — SHIPPERS
    S.append('<div class="ab2-role reveal"><div>'
      '<span class="tag" style="background:#ecfdf5;color:#059669">📦 For Shippers</span>'
      '<h3>Your freight, direct to the truck.</h3>'
      '<p class="ab2-quote">"I paid three margins and still couldn\'t tell you where my freight was."</p>'
      '<ul><li><b>No margin stacking</b> — direct-to-carrier rates, one transparent number</li>'
      '<li>Watch your freight live: which truck, which driver, where — 24/7 GPS</li>'
      '<li>Photo proof of delivery and a full paper trail on every shipment</li>'
      '<li>Only FMCSA-verified, insured carriers ever touch your freight</li></ul>'
      '<a class="ab2-cta" href="create-shipper-account.html">Create shipper account →</a></div>'
      '<div class="ab2-viz">' + _viz([(150,'.6'),(240,'1'),(190,'.8'),(130,'.5')],'#22c55e') + '</div></div>')
    # 8 — DISPATCHERS / PARTNERS
    S.append('<div class="ab2-role dark reveal"><div class="ab2-viz">' + _viz([(200,'.9'),(140,'.6'),(250,'1'),(170,'.7')],'#a78bfa') + '</div><div>'
      '<span class="tag" style="background:rgba(167,139,250,.2);color:#c4b5fd">🧑‍✈️ For Dispatchers &amp; Referral Partners</span>'
      '<h3>Build your book on honest rails.</h3>'
      '<p class="ab2-quote">"I wanted to dispatch the right way — I just needed the platform that does too."</p>'
      '<ul><li>US dispatcher seats with real tooling — matching, rate cons, tracking, settlements (<a href="careers.html" style="color:#c4b5fd">careers</a>)</li>'
      '<li>Referral partners earn <b>1% of gross on every load</b> their carriers run — for as long as they run</li>'
      '<li>Transparent statements in the platform; no clawback games</li></ul>'
      '<a class="ab2-cta" href="create-agent-account.html">Become a partner →</a></div></div></div></section>')
    # 9 — COMPARISON
    S.append('<section><div class="wrap"><div class="sec-head center reveal"><div class="eyebrow">The honest comparison</div>'
      '<h2>The old way vs. LoadBoot</h2><p>We win on the boring things: verification, written terms, and proof. Here is the difference in one table.</p></div>'
      '<div class="reveal" style="overflow-x:auto"><table class="ab2-cmp">'
      '<thead><tr><th style="width:22%"></th><th>Load boards<br><span style="font-weight:400;color:#9fb3cc">DAT · Truckstop · 123LB</span></th><th>Old-school dispatcher</th><th class="lb">🚀 LoadBoot</th></tr></thead><tbody>'
      '<tr><td><b>Cost</b></td><td>$45–$185/month whether you book or not</td><td>5–10% + hidden fees, long contracts</td><td class="lb">5% flat, only when we book you · brokers post $0</td></tr>'
      '<tr><td><b>Load quality</b></td><td>30–50% ghost/reposted loads</td><td>Whatever keeps their margin</td><td class="lb">Every load verified real — zero ghost loads policy</td></tr>'
      '<tr><td><b>Detention &amp; TONU</b></td><td>Your problem</td><td>"We\'ll ask" — under 50% ever paid</td><td class="lb">Pre-agreed in writing on every posting, auto-filed from GPS</td></tr>'
      '<tr><td><b>Verification</b></td><td>Pay-to-list; fraud rampant</td><td>Manual, maybe</td><td class="lb">Live FMCSA checks both directions, identity verified at booking</td></tr>'
      '<tr><td><b>Proof</b></td><td>None — screenshots &amp; phone calls</td><td>Fax machines &amp; trust</td><td class="lb">GPS stamps, photo POD, e-signed docs — a court-grade paper trail</td></tr>'
      '<tr><td><b>Getting out</b></td><td>Annual billing traps</td><td>90–180 day exclusivity</td><td class="lb">No contract. Leave any week — we have to earn it</td></tr>'
      '</tbody></table></div></div></section>')
    # 10 — TRUST ENGINE (dark)
    S.append('<section class="bg-soft"><div class="wrap"><div class="sec-head center reveal"><div class="eyebrow">The trust engine</div>'
      '<h2>Rules we run the company by</h2></div><div class="grid g3 reveal">'
      '<div class="card"><div class="icon">📜</div><h3>If it isn\'t written, it doesn\'t exist</h3><p>Rates, accessorials, agreements — everything is e-signed and stored. Nobody\'s memory decides who gets paid.</p></div>'
      '<div class="card"><div class="icon">🧾</div><h3>Explainable, always</h3><p>Every match, every detention minute, every settlement line traces to a record. If we can\'t explain it, we don\'t ship it.</p></div>'
      '<div class="card"><div class="icon">🔐</div><h3>Your data is yours</h3><p>Tenant-isolated accounts, role-based access, audited actions. Drivers never see company finances; brokers never see your margins.</p></div>'
      '<div class="card"><div class="icon">🧑‍⚖️</div><h3>Humans control money</h3><p>Software prepares invoices and settlements; a person approves every payout. Maker and checker are never the same.</p></div>'
      '<div class="card"><div class="icon">⚡</div><h3>Answers in seconds, 24/7</h3><p>Our AI assistant answers instantly — pricing, documents, setup — and can even open your account in chat. Humans stay on standby.</p></div>'
      '<div class="card"><div class="icon">🇺🇸</div><h3>Built for US trucking law</h3><p>Per-carrier dispatch agreements, FMCSA compliance workflows, and policies published where everyone can read them.</p></div>'
      '</div></div></section>')
    # 11 — STORY + NUMBERS
    S.append('<section><div class="wrap"><div class="sec-head center reveal"><div class="eyebrow">Our story</div>'
      '<h2>Built by people who lived the problem</h2>'
      '<p style="max-width:74ch;margin:0 auto">LoadBoot started with a phone that wouldn\'t stop ringing — carriers stranded by dispatchers who vanished the moment a load went wrong. We rebuilt the workflow around the load instead of the contract: verification first, written terms on everything, GPS proof by default, and money that moves on records instead of arguments. Then we opened the same rails to brokers, shippers and dispatchers — because a fair market needs every seat at the same table.</p></div></div></section>')
    # 12 — FINAL DOORS + CTA
    S.append('<section class="bg-soft"><div class="wrap"><div class="sec-head center reveal"><div class="eyebrow">Take your seat</div>'
      '<h2>This is what you were searching for. Pick your door.</h2>'
      '<p>Five minutes, right now — or just open the chat bubble and say <b>"set me up"</b> and our assistant does it with you, step by step.</p></div>'
      '<div class="ab2-doors reveal">'
      '<a class="ab2-door" href="create-carrier-account.html"><span class="ic">🚚</span><b>Carrier / Owner-Op</b><p>Verified loads, written detention, flat 5% when we book you.</p><span>Start free →</span></a>'
      '<a class="ab2-door" href="create-broker-account.html"><span class="ic">🏢</span><b>Freight Broker</b><p>Post free forever to FMCSA-verified, GPS-tracked capacity.</p><span>Post loads $0 →</span></a>'
      '<a class="ab2-door" href="create-shipper-account.html"><span class="ic">📦</span><b>Shipper</b><p>Direct-to-carrier rates with live tracking and photo proof.</p><span>Ship direct →</span></a>'
      '<a class="ab2-door" href="create-agent-account.html"><span class="ic">📣</span><b>Dispatcher / Partner</b><p>Careers and a 1%-of-gross referral program that pays forever.</p><span>Join us →</span></a>'
      '</div></div></section>')
    return ''.join(S)
