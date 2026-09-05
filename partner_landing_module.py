# partner_landing_module.py — premium, SEO-focused landing pages for the demand side
# (4 Sep 2026). Two pages, built to the same grade as the carrier home page:
#   free-load-board-for-brokers.html   — "free load board for brokers / post loads free"
#   shipper-solutions.html             — "ship freight with verified carriers / truckload quotes"
# Every number on these pages is either a LoadBoot product fact (from the live build:
# bl_bp_0312–0319) or an external figure with its source linked in the section. Nothing invented.
# Links stay on the poster's side of the site: never to carrier sales/dispatch pages.

# ---------- shared premium styles (scoped with pl-) ----------
PL_CSS = """<style>
.pl-hero{padding:104px 0 96px;position:relative;overflow:hidden;color:#fff;background:radial-gradient(120% 110% at 78% -8%,#1e2f55 0%,#10223B 52%,#0b1220 100%);border-bottom:1px solid #1e293b}
.pl-hero .wrap{position:relative;z-index:1}
.pl-hero-grid{display:grid;grid-template-columns:1.08fr .92fr;gap:54px;align-items:center}
@media(max-width:960px){.pl-hero-grid{grid-template-columns:1fr}.pl-hero{padding:76px 0 64px}}
.pl-kicker{display:inline-flex;align-items:center;gap:8px;font-size:.8rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#bfdbfe;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);border-radius:999px;padding:8px 14px}
.pl-kicker .dot{width:8px;height:8px;border-radius:50%;background:#4ade80;box-shadow:0 0 0 4px rgba(74,222,128,.22)}
.pl-hero h1{font-size:clamp(2.1rem,4.2vw,3.35rem);line-height:1.08;letter-spacing:-.02em;margin:22px 0 16px;color:#fff}
.pl-hero .lead{color:#cbd5e1;font-size:1.12rem;line-height:1.7;max-width:600px}
.pl-hero .hero-btns{display:flex;gap:12px;flex-wrap:wrap;margin-top:28px}
.pl-trust{display:flex;gap:22px;flex-wrap:wrap;margin-top:26px;color:#e2e8f0;font-size:.9rem;font-weight:600}
.pl-trust span{display:inline-flex;align-items:center;gap:7px}
.pl-trust i{font-style:normal;color:#4ade80;font-weight:900}
.pl-mock{position:relative}
.pl-card{background:linear-gradient(160deg,#111d3a,#0b1220 75%);border:1px solid rgba(255,255,255,.1);border-radius:22px;padding:24px;box-shadow:0 40px 80px -36px rgba(0,0,0,.7);color:#e2e8f0;font-size:.92rem}
.pl-card .top{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px}
.pl-card .live{display:inline-flex;align-items:center;gap:7px;font-size:.76rem;font-weight:700;color:#4ade80;background:rgba(74,222,128,.1);border:1px solid rgba(74,222,128,.3);border-radius:999px;padding:5px 11px}
.pl-card .live b{width:7px;height:7px;border-radius:50%;background:#4ade80;display:inline-block;animation:plPulse 1.6s infinite}
@keyframes plPulse{0%,100%{box-shadow:0 0 0 0 rgba(74,222,128,.5)}60%{box-shadow:0 0 0 7px rgba(74,222,128,0)}}
.pl-card .row{display:flex;justify-content:space-between;gap:12px;padding:11px 0;border-bottom:1px solid rgba(255,255,255,.08)}
.pl-card .row span:first-child{color:#94a3b8}
.pl-card .row span:last-child{font-weight:700;color:#fff;text-align:right}
.pl-card .rate{color:#4ade80;font-family:Manrope,Inter,sans-serif;font-size:1.05rem}
.pl-card .offers{margin-top:14px;display:flex;flex-direction:column;gap:8px}
.pl-card .of{display:flex;align-items:center;gap:10px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:9px 12px;font-size:.84rem}
.pl-card .of .av{width:28px;height:28px;border-radius:9px;background:linear-gradient(135deg,#0883F7,#1d4ed8);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:.72rem;color:#fff;flex:none}
.pl-card .of .ok{margin-left:auto;color:#4ade80;font-weight:800;font-size:.76rem}
.pl-card .of .wait{margin-left:auto;color:#94a3b8;font-size:.76rem}
.pl-float{position:absolute;background:#fff;color:#10223B;border-radius:14px;padding:12px 16px;box-shadow:0 22px 44px -18px rgba(15,23,42,.45);font-size:.84rem;font-weight:700;display:flex;align-items:center;gap:9px;animation:plFloat 6s ease-in-out infinite}
.pl-float .ic{width:26px;height:26px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;background:#e0f2fe;color:#0883F7;font-size:.9rem}
.pl-f1{top:-18px;right:-14px}.pl-f2{bottom:-16px;left:-14px;animation-delay:-3s}
@keyframes plFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-8px)}}
@media(max-width:600px){.pl-float{position:static;margin-top:10px;animation:none}.pl-f1,.pl-f2{display:inline-flex}}
.pl-stats{background:#10223B;color:#fff;padding:46px 0;border-bottom:1px solid #1e293b}
.pl-stats .wrap{display:grid;grid-template-columns:repeat(4,1fr);gap:20px}
@media(max-width:860px){.pl-stats .wrap{grid-template-columns:repeat(2,1fr)}}
.pl-stat .n{font-family:Manrope,Inter,sans-serif;font-weight:800;font-size:clamp(1.9rem,3.8vw,2.6rem);line-height:1;background:linear-gradient(120deg,#fff,#93c5fd);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.pl-stat .l{color:#94a3b8;font-size:.9rem;margin-top:8px;line-height:1.45}
.pl-sec{padding:88px 0}
.pl-sec.soft{background:#f6f9fd}
.pl-sec.dark{background:#0b1220;color:#fff}
.pl-sec.dark .eyebrow{color:#7cc0ff}.pl-sec.dark h2{color:#fff}.pl-sec.dark p{color:#cbd5e1}
.pl-head{max-width:720px;margin-bottom:44px}.pl-head.center{margin-left:auto;margin-right:auto;text-align:center}
.pl-head h2{font-size:clamp(1.7rem,3vw,2.35rem);line-height:1.15;letter-spacing:-.015em;margin:0}
.pl-head p{color:#475569;font-size:1.08rem;line-height:1.7;margin:14px 0 0}
.pl-grid{display:grid;gap:22px}.pl-g2{grid-template-columns:repeat(2,1fr)}.pl-g3{grid-template-columns:repeat(3,1fr)}.pl-g4{grid-template-columns:repeat(4,1fr)}
@media(max-width:960px){.pl-g3,.pl-g4{grid-template-columns:repeat(2,1fr)}}
@media(max-width:640px){.pl-g2,.pl-g3,.pl-g4{grid-template-columns:1fr}}
.pl-tile{background:#fff;border:1px solid #e6ebf3;border-radius:20px;padding:26px;position:relative;transition:transform .25s,box-shadow .25s}
.pl-tile:hover{transform:translateY(-3px);box-shadow:0 26px 50px -30px rgba(15,23,42,.35)}
.pl-tile .ic{width:46px;height:46px;border-radius:14px;background:linear-gradient(135deg,#0883F7,#1d4ed8);color:#fff;display:flex;align-items:center;justify-content:center;font-size:1.3rem;margin-bottom:16px;box-shadow:0 12px 24px -12px rgba(8,131,247,.7)}
.pl-tile h3{margin:0 0 8px;font-size:1.08rem}
.pl-tile p{margin:0;color:#475569;line-height:1.7;font-size:.97rem}
.pl-tile .was{display:inline-block;font-size:.74rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#b91c1c;background:#fef2f2;border-radius:999px;padding:4px 10px;margin-bottom:12px}
.pl-tile .now{display:inline-block;font-size:.74rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#166534;background:#dcfce7;border-radius:999px;padding:4px 10px;margin-bottom:12px}
.pl-dark .pl-tile{background:rgba(255,255,255,.05);border-color:rgba(255,255,255,.1)}
.pl-dark .pl-tile h3{color:#fff}.pl-dark .pl-tile p{color:#cbd5e1}
.pl-steps{display:grid;grid-template-columns:repeat(5,1fr);gap:16px;counter-reset:pl}
@media(max-width:1000px){.pl-steps{grid-template-columns:repeat(2,1fr)}}
@media(max-width:560px){.pl-steps{grid-template-columns:1fr}}
.pl-step{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:18px;padding:22px;position:relative}
.pl-step .num{width:40px;height:40px;border-radius:12px;background:linear-gradient(135deg,#0883F7,#7c3aed);color:#fff;font-family:Manrope,Inter,sans-serif;font-weight:800;display:flex;align-items:center;justify-content:center;margin-bottom:14px}
.pl-step h3{color:#fff;font-size:1rem;margin:0 0 6px}.pl-step p{color:#aab6cf;font-size:.9rem;line-height:1.6;margin:0}
.pl-step .t{position:absolute;top:18px;right:18px;font-size:.72rem;font-weight:800;color:#4ade80;background:rgba(74,222,128,.1);border-radius:999px;padding:4px 9px}
.pl-split{display:grid;grid-template-columns:1.05fr .95fr;gap:48px;align-items:center}
@media(max-width:900px){.pl-split{grid-template-columns:1fr}}
.pl-li{display:flex;gap:12px;margin:12px 0;line-height:1.65;color:#334155}
.pl-li b{color:#10223B}
.pl-tick{flex:none;width:22px;height:22px;border-radius:7px;background:#dcfce7;color:#16a34a;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:.78rem;margin-top:2px}
.pl-cmp{width:100%;border-collapse:separate;border-spacing:0;background:#fff;border:1px solid #e6ebf3;border-radius:18px;overflow:hidden}
.pl-cmp th{background:#10223B;color:#fff;text-align:left;padding:14px 16px;font-size:.9rem}
.pl-cmp th.hi{background:linear-gradient(135deg,#0883F7,#1d4ed8)}
.pl-cmp td{padding:13px 16px;border-bottom:1px solid #eef2f7;font-size:.94rem;vertical-align:top;color:#334155}
.pl-cmp td:first-child{font-weight:700;color:#10223B}
.pl-cmp td.hi{background:#f0f7ff;font-weight:600;color:#0b3d91}
.pl-cmp tr:last-child td{border-bottom:0}
.pl-cmp-wrap{overflow-x:auto}
.pl-ladder{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
@media(max-width:760px){.pl-ladder{grid-template-columns:1fr}}
.pl-rung{background:#fff;border:1px solid #e6ebf3;border-radius:18px;padding:24px;position:relative;overflow:hidden}
.pl-rung .lv{font-size:.74rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#0883F7}
.pl-rung .big{font-family:Manrope,Inter,sans-serif;font-weight:800;font-size:2rem;margin:6px 0 4px;color:#10223B}
.pl-rung p{color:#475569;font-size:.93rem;line-height:1.65;margin:8px 0 0}
.pl-rung.hi{border-color:#0883F7;box-shadow:0 20px 40px -26px rgba(8,131,247,.6)}
.pl-src{font-size:.82rem;color:#64748b;margin-top:22px;line-height:1.7}
.pl-src a{color:#0883F7;text-decoration:underline}
.pl-num{font-family:Manrope,Inter,sans-serif;font-weight:800;font-size:2.1rem;color:#10223B;line-height:1}
.pl-num small{font-size:.9rem;color:#64748b;font-weight:600;display:block;margin-top:6px}
.pl-ind{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
@media(max-width:900px){.pl-ind{grid-template-columns:repeat(2,1fr)}}@media(max-width:560px){.pl-ind{grid-template-columns:1fr}}
.pl-ind a{display:block;background:#fff;border:1px solid #e6ebf3;border-radius:16px;padding:20px;text-decoration:none;color:#10223B;transition:.25s}
.pl-ind a:hover{border-color:#0883F7;transform:translateY(-2px)}
.pl-ind a b{display:block;font-size:1.02rem;margin-bottom:6px}.pl-ind a span{color:#64748b;font-size:.9rem;line-height:1.5;display:block}
.pl-ind a em{display:block;margin-top:10px;color:#0883F7;font-style:normal;font-weight:700;font-size:.86rem}
.pl-faq details{background:#fff;border:1px solid #e6ebf3;border-radius:14px;padding:16px 20px;margin-bottom:10px}
.pl-faq summary{font-weight:700;color:#10223B;cursor:pointer;font-size:1.02rem}
.pl-faq p{color:#475569;line-height:1.75;margin:10px 0 0}
.pl-cta{background:linear-gradient(135deg,#0b1220 0%,#12304f 60%,#3b1a0e 100%);color:#fff;border-radius:28px;padding:64px 40px;text-align:center;position:relative;overflow:hidden}
.pl-cta h2{color:#fff;font-size:clamp(1.8rem,3.4vw,2.6rem);margin:0 0 12px}
.pl-cta p{color:#cbd5e1;max-width:640px;margin:0 auto 26px;font-size:1.08rem;line-height:1.7}
.pl-cta .btn-secondary{background:rgba(255,255,255,.08);color:#fff;border-color:rgba(255,255,255,.28)}
.pl-tag{display:inline-block;font-size:.72rem;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:#0b3d91;background:#e0f2fe;border-radius:999px;padding:4px 10px;margin-left:8px;vertical-align:middle}
</style>"""


def _tiles(items, cols='pl-g3', dark=False):
    out = []
    for it in items:
        ic, t, d = it[0], it[1], it[2]
        tag = it[3] if len(it) > 3 else ''
        out.append('<div class="pl-tile reveal">%s<div class="ic">%s</div><h3>%s</h3><p>%s</p></div>' % (tag, ic, t, d))
    return '<div class="pl-grid %s%s">%s</div>' % (cols, ' pl-dark' if dark else '', ''.join(out))


def _faq(items):
    rows = ''.join('<details class="reveal"%s><summary>%s</summary><p>%s</p></details>' % (' open' if i == 0 else '', q, a) for i, (q, a) in enumerate(items))
    import re, json
    strip = lambda x: re.sub('<[^>]+>', '', x).replace('&mdash;', '—').replace('&rsquo;', '’').replace('&ldquo;', '“').replace('&rdquo;', '”').replace('&amp;', '&').replace('&rarr;', '→')
    sch = json.dumps({"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": strip(q), "acceptedAnswer": {"@type": "Answer", "text": strip(a)}} for q, a in items]})
    return rows, '<script type="application/ld+json">%s</script>' % sch


# =====================================================================================
# BROKER — free-load-board-for-brokers.html
# =====================================================================================
def broker_landing(ctx):
    linkcard = ctx['linkcard']; cns = ctx['carrier_network_section']
    b = PL_CSS
    # ---- HERO ----
    b += ('<section class="pl-hero"><div class="aurora"><span class="a1"></span><span class="a2"></span></div><div class="wrap pl-hero-grid"><div>'
          '<span class="pl-kicker reveal"><span class="dot"></span> For freight brokers &middot; $0 to post, forever</span>'
          '<h1 class="reveal d1">Free Load Board for Brokers &mdash; <span class="gradtext">post loads free, cover them with verified carriers</span></h1>'
          '<p class="lead reveal d2">No subscription, no per-post fee, no renewal hike. Enter your MC, we read your broker authority live from FMCSA in seconds, and your first posting reaches FMCSA-verified, health-scored carriers in minutes &mdash; with the rate card in writing, live GPS on the assigned truck and one-receipt payables built in.</p>'
          '<div class="hero-btns reveal d3"><a href="/app/partner/" class="btn btn-primary">Post a load free &rarr;</a><a href="create-broker-account.html" class="btn btn-secondary">How the MC screen works</a><a href="how-it-works.html" class="btn btn-ghost">How it works &rarr;</a></div>'
          '<div class="pl-trust reveal d3"><span><i>&#10003;</i> Licensed brokers only &mdash; carrier MCs cannot post</span><span><i>&#10003;</i> Zero ghost loads policy</span><span><i>&#10003;</i> No documents to start</span></div>'
          '</div><div class="pl-mock reveal d2"><div class="pl-card">'
          '<div class="top"><strong>Posting #LB-4471</strong><span class="live"><b></b> Live &middot; offers open</span></div>'
          '<div class="row"><span>Lane</span><span>Laredo, TX &rarr; Chicago, IL</span></div>'
          '<div class="row"><span>Equipment</span><span>Reefer &middot; 53&prime; &middot; &minus;10&deg;F</span></div>'
          '<div class="row"><span>Rate card</span><span class="rate">$3,120 &middot; detention $75/hr after 2h</span></div>'
          '<div class="row"><span>Broker authority</span><span>MC active &middot; BMC-84 on file (FMCSA live)</span></div>'
          '<div class="offers"><div class="of"><span class="av">RT</span>Rio Transport LLC &middot; verified &middot; 4.9<span class="ok">Requested to book</span></div>'
          '<div class="of"><span class="av">MK</span>MK Freight Inc &middot; verified &middot; reefer<span class="wait">Viewing</span></div>'
          '<div class="of"><span class="av">JL</span>J&amp;L Carriers &middot; verified<span class="wait">Viewing</span></div></div>'
          '</div><div class="pl-float pl-f1"><span class="ic">&#9889;</span> MC screened on FMCSA in seconds</div><div class="pl-float pl-f2"><span class="ic">&#10003;</span> You approve every carrier</div></div></div></section>')
    # ---- STATS (product facts only) ----
    b += ('<div class="pl-stats"><div class="wrap">'
          '<div class="pl-stat reveal"><div class="n">$0</div><div class="l">Per post, per seat, per month &mdash; brokers never pay LoadBoot</div></div>'
          '<div class="pl-stat reveal d1"><div class="n">Seconds</div><div class="l">MC read live from FMCSA Licensing &amp; Insurance &mdash; no PDF to upload</div></div>'
          '<div class="pl-stat reveal d2"><div class="n">15<span style="font-size:1.2rem">min</span></div><div class="l">First-accept-wins offer window &mdash; no double-booked trucks</div></div>'
          '<div class="pl-stat reveal d3"><div class="n">1</div><div class="l">Receipt per trip &mdash; freight plus approved claims, one PAY-BY date</div></div>'
          '</div></div>')
    # ---- PROBLEM -> FIX ----
    b += ('<section class="pl-sec soft"><div class="wrap"><div class="pl-head center reveal"><div class="eyebrow">Why brokers switch</div><h2>You are paying a subscription to be lied to by ghost loads</h2>'
          '<p>The big boards charge you monthly, then fill your carriers&rsquo; screens with stale and fake postings until nobody trusts a real one &mdash; including yours. LoadBoot flips both halves.</p></div>'
          + _tiles([
              ('&#128176;', 'Subscriptions and renewal hikes', 'Posting on the major boards is a monthly line item whether or not it covered your freight, and renewals climb at billing time. Here, posting is free at every volume &mdash; LoadBoot&rsquo;s only revenue is the flat dispatch fee on the carrier side.', '<span class="was">Before</span>'),
              ('&#128123;', 'Ghost and stale loads', 'Every posting is reviewed by LoadBoot dispatch before it goes live, stale postings auto-close and cancellations carry TONU exposure. Fakes cost money here, so they do not scale.', '<span class="now">On LoadBoot</span>'),
              ('&#128222;', 'Twenty check calls per load', 'Geofenced arrive/depart stamps, a live map and a milestone timeline replace &ldquo;where is my truck&rdquo;. Documents ride the load; delivery flips it into a payable.', '<span class="now">On LoadBoot</span>'),
          ]) + '</div></section>')
    # ---- FLOW ----
    b += ('<section class="pl-sec dark"><div class="wrap"><div class="pl-head center reveal"><div class="eyebrow">Signup to covered freight</div><h2>From your MC number to a booked truck &mdash; five steps, no paperwork wall</h2>'
          '<p>What used to be an eight-document packet and a human review is now a live federal-record check and one click. Documents arrive where they matter &mdash; first booking and first payment &mdash; not in front of your first post.</p></div>'
          '<div class="pl-steps reveal">'
          '<div class="pl-step"><span class="t">seconds</span><div class="num">1</div><h3>Enter your MC</h3><p>We read your broker authority live from FMCSA L&amp;I (SAFER as backup). Active authority already proves the $75K BMC-84/85 is on file.</p></div>'
          '<div class="pl-step"><span class="t">1 click</span><div class="num">2</div><h3>Confirm it is yours</h3><p>Company-domain email matches automatically; otherwise a code to your FMCSA-listed contact. One MC, one account &mdash; nobody can post as you.</p></div>'
          '<div class="pl-step"><span class="t">1 click</span><div class="num">3</div><h3>Accept the agreement</h3><p>The Master Broker Agreement, e-signed. Authority, bond and BOC-3 auto-fill from the FMCSA pass &mdash; nothing to upload.</p></div>'
          '<div class="pl-step"><span class="t">minutes</span><div class="num">4</div><h3>Post your load</h3><p>Exact pins arm the geofences; the full rate card &mdash; detention, TONU, layover &mdash; prints on the posting so disputes die young.</p></div>'
          '<div class="pl-step"><span class="t">15 min</span><div class="num">5</div><h3>Carriers request, you approve</h3><p>Verified carriers that fit the lane and equipment request to book; first acceptance wins and every other offer auto-closes.</p></div>'
          '</div><div style="text-align:center;margin-top:34px" class="reveal"><a href="create-broker-account.html" class="btn btn-secondary" style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.28)">See the full signup walkthrough &rarr;</a></div></div></section>')
    # ---- POSTING ALLOWANCE (bl_bp_0312 tiers — transparent) ----
    b += ('<section class="pl-sec"><div class="wrap"><div class="pl-head reveal"><div class="eyebrow">Tiered trust, in the open</div><h2>Your posting allowance grows with delivered loads &mdash; not with PDFs</h2>'
          '<p>This is how the board stays free of ghost loads without asking a new brokerage for a pile of documents on day one. Every tier is derived live from the federal record and your delivery history.</p></div>'
          '<div class="pl-ladder reveal">'
          '<div class="pl-rung"><div class="lv">New brokerage</div><div class="big">3 open postings</div><p>MC screened live, agreement accepted. Loads book by request-to-book or a direct offer you send &mdash; you approve the carrier before the rate confirmation goes out.</p></div>'
          '<div class="pl-rung hi"><div class="lv">After your first delivered load</div><div class="big">10 open postings</div><p>Delivered freight is the proof. The allowance lifts automatically the moment the first trip closes with a POD on file.</p></div>'
          '<div class="pl-rung"><div class="lv">Verification packet done</div><div class="big">Unlimited</div><p>Three items &mdash; W-9, bank instructions and a claims contact &mdash; lift the cap, turn on instant booking for carriers and move payables inside LoadBoot.</p></div>'
          '</div></div></section>')
    # ---- WAYS TO POST ----
    b += ('<section class="pl-sec soft"><div class="wrap"><div class="pl-head center reveal"><div class="eyebrow">Post the way your desk already works</div><h2>Portal, email, API or phone &mdash; same verified board</h2></div>'
          + _tiles([
              ('&#129513;', 'The posting wizard', 'Route with exact pins, schedule, equipment, commodity and the full rate card in one guided flow. Duplicates auto-caught; a &ldquo;posting under&rdquo; picker for agents who cover several brokerages.'),
              ('&#128231;', 'Email &mdash; loads@loadboot.com', 'Already blast your load list to a carrier network? Add loads@loadboot.com to the same send. We read lanes, equipment, dates and rate from the email and post each load under your company. <a href="integrations.html#email">How email posting works &rarr;</a>'),
              ('&#128268;', 'API &amp; webhooks', 'Post from your TMS and receive load, trip, document and delivery events back on approved endpoints. <a href="api.html">Developer API &rarr;</a>'),
              ('&#128241;', 'The LoadBoot app', 'The Partner portal on Google Play (and as a home-screen app on iPhone): post, watch offers, approve documents and track the truck from anywhere. <a href="apps.html">Get the app &rarr;</a>'),
          ], 'pl-g4') + '</div></section>')
    # ---- VERIFIED NETWORK (existing shared section) ----
    b += cns('broker')
    # ---- 2026 FRAUD REALITY (sourced) ----
    b += ('<section class="pl-sec"><div class="wrap"><div class="pl-split">'
          '<div class="reveal"><div class="eyebrow">Built for the 2026 freight-fraud reality</div><h2 style="font-size:clamp(1.7rem,3vw,2.3rem);line-height:1.15;margin:0 0 14px">The cheapest board is the one that never hands your load to a fake carrier</h2>'
          '<p style="color:#475569;line-height:1.75;font-size:1.05rem">Cargo theft is now strategic: identity theft, fictitious pickups and double-brokering rather than a cut padlock. A board that only checks a carrier once at signup cannot see it. LoadBoot checks the federal record on every load and proves the assigned truck is the one moving your freight.</p>'
          '<div class="pl-li"><span class="pl-tick">&#10003;</span><div><b>Authority read live, every load.</b> Inactive, revoked or pending authority never receives your posting &mdash; not a photocopy from onboarding.</div></div>'
          '<div class="pl-li"><span class="pl-tick">&#10003;</span><div><b>Insurance and account health tracked continuously.</b> A carrier that lapses tomorrow does not quietly stay eligible.</div></div>'
          '<div class="pl-li"><span class="pl-tick">&#10003;</span><div><b>GPS on the assigned truck.</b> Geofenced pickup and delivery stamps are server-side evidence that the carrier you booked is the carrier that hauled &mdash; double-brokering has nowhere to hide.</div></div>'
          '<div class="pl-li"><span class="pl-tick">&#10003;</span><div><b>One MC, one account.</b> Brokerage identity is claimed through the FMCSA-listed contact, so nobody can post under your name either.</div></div>'
          '</div>'
          '<div class="reveal"><div class="pl-grid pl-g2" style="gap:16px">'
          '<div class="pl-tile"><div class="pl-num">$725M<small>estimated U.S. cargo-theft losses in 2025, up ~60% on 2024</small></div></div>'
          '<div class="pl-tile"><div class="pl-num">$273,990<small>average loss per theft in 2025 (+36%) &mdash; thieves target the high-value load</small></div></div>'
          '<div class="pl-tile"><div class="pl-num">Jan 16, 2026<small>FMCSA financial-responsibility rule in force: suspension if a broker&rsquo;s $75K security stays short more than 7 days</small></div></div>'
          '<div class="pl-tile"><div class="pl-num">Identity proofing<small>FMCSA&rsquo;s new Motus registration system adds document and facial verification for registrants (portal-access deadline May 14, 2026)</small></div></div>'
          '</div><p class="pl-src">Sources: <a href="https://www.cargonet.com/news-and-events/cargonet-in-the-media/2025-theft-trends/" rel="noopener nofollow" target="_blank">Verisk CargoNet 2025 theft trends</a> &middot; <a href="https://www.fmcsa.dot.gov/registration/broker-and-freight-forwarder-financial-responsibility-rule-overview-and-compliance" rel="noopener nofollow" target="_blank">FMCSA broker &amp; freight forwarder financial responsibility rule</a> &middot; <a href="https://arktms.com/blog/fmcsa-motus-freight-brokers-2026" rel="noopener nofollow" target="_blank">FMCSA Motus for brokers (ARK TMS)</a>. External figures are theirs, not LoadBoot&rsquo;s.</p></div>'
          '</div></div></section>')
    # ---- COMPARISON ----
    b += ('<section class="pl-sec soft"><div class="wrap"><div class="pl-head center reveal"><div class="eyebrow">How it compares</div><h2>A free verified board vs a paid subscription board</h2></div>'
          '<div class="pl-cmp-wrap reveal"><table class="pl-cmp"><thead><tr><th>What you get</th><th>Typical paid board</th><th class="hi">LoadBoot &mdash; free for brokers</th></tr></thead><tbody>'
          '<tr><td>Cost to post</td><td>Monthly subscription, per-seat and add-on fees, renewal increases</td><td class="hi">$0 &mdash; at any volume, forever</td></tr>'
          '<tr><td>Who can post</td><td>Anyone with a login; carrier MCs and unlicensed posters slip through</td><td class="hi">Licensed property brokers only, authority read live from FMCSA</td></tr>'
          '<tr><td>Ghost / stale loads</td><td>Common; postings age on the board</td><td class="hi">Reviewed before going live, auto-close when stale, TONU on cancellations</td></tr>'
          '<tr><td>Carrier vetting</td><td>Self-reported profile, checked once</td><td class="hi">Authority, insurance and account health monitored continuously</td></tr>'
          '<tr><td>Booking</td><td>Phone tag; double-booked trucks</td><td class="hi">Request-to-book or direct offers; first acceptance wins, others auto-close</td></tr>'
          '<tr><td>Tracking</td><td>Separate visibility subscription</td><td class="hi">Live GPS, geofenced stamps and ETA included on every load</td></tr>'
          '<tr><td>Documents &amp; payables</td><td>Bolt-on TMS</td><td class="hi">Rate con, BOL and POD ride the load; one receipt per trip with a PAY-BY date</td></tr>'
          '<tr><td>Rate transparency</td><td>Rate tools sold separately</td><td class="hi">Buy and sell side published free &mdash; <a href="market-rates.html">market rates per mile</a></td></tr>'
          '</tbody></table></div>'
          '<p class="reveal" style="max-width:820px;margin:20px auto 0;text-align:center;color:#64748b;font-size:.95rem">Curious what a subscription really costs once add-ons and renewals land? Read <a href="load-board-subscription-cost.html">the real cost of load board subscriptions</a>.</p></div></section>')
    # ---- AGENTS ----
    b += ('<section class="pl-sec"><div class="wrap"><div class="pl-split">'
          '<div class="reveal"><div class="eyebrow">Broker agents</div><h2 style="font-size:clamp(1.7rem,3vw,2.3rem);line-height:1.15;margin:0 0 14px">No MC of your own? Post under the brokerage you work for &mdash; or several</h2>'
          '<p style="color:#475569;line-height:1.75;font-size:1.05rem">One agent account, many brokerages. We screen each brokerage&rsquo;s authority live and email its FMCSA-listed address a 6-digit code plus a confirm link; the brokerage gives you the code, you type it, done. Already on LoadBoot? Its owner approves you under Agents &amp; team. Every load you post shows which brokerage it is under, and each brokerage keeps its own posting allowance.</p>'
          '<a href="create-broker-account.html" class="btn btn-secondary">How agent confirmation works &rarr;</a></div>'
          '<div class="reveal"><div class="pl-card"><div class="top"><strong>Agents &amp; team</strong><span class="live"><b></b> 2 brokerages confirmed</span></div>'
          '<div class="of" style="margin-top:6px"><span class="av">AB</span>Atlas Brokerage LLC &middot; MC active<span class="ok">Confirmed by email code</span></div>'
          '<div class="of" style="margin-top:8px"><span class="av">NL</span>Northline Logistics &middot; MC active<span class="ok">Confirmed by owner</span></div>'
          '<div class="of" style="margin-top:8px"><span class="av">+</span>Add a brokerage<span class="wait">MC or USDOT</span></div>'
          '<div class="row" style="margin-top:14px"><span>Posting under</span><span>Atlas Brokerage LLC &middot; 2 of 10 open</span></div></div></div>'
          '</div></div></section>')
    # ---- FAQ ----
    faq_rows, faq_schema = _faq([
        ('Is the load board really free for brokers?', 'Yes. There is no subscription, no per-post fee, no per-seat fee and no charge at any posting volume. LoadBoot&rsquo;s only revenue is the flat 5% dispatch fee paid by carriers who book through us &mdash; brokers never pay LoadBoot.'),
        ('Who can post loads?', 'Licensed property brokers whose authority shows ACTIVE on FMCSA, screened live the moment you enter your MC. A carrier MC cannot post. Broker agents post under a brokerage that has confirmed them by email code or in-portal approval.'),
        ('Do I have to upload my bond, W-9 or MC letter before posting?', 'No. FMCSA only keeps broker authority active while a BMC-84/85 is on file, so the live authority check already covers the bond, and authority, bond and BOC-3 fill in from that pass. The verification packet comes later and is three items &mdash; W-9, bank instructions and a claims contact &mdash; which lift the posting limit and turn on instant booking.'),
        ('Why is there a posting limit at first?', 'New brokerages start with 3 open postings and request-to-book. The allowance rises to 10 after your first delivered load and to unlimited once the packet is done. It is how the board stays free of ghost loads without a wall of PDFs on day one.'),
        ('How are carriers vetted?', 'Authority is checked against the federal record, insurance certificates and account health are tracked continuously, and only carriers who pass hard eligibility for the lane and equipment are offered your load. GPS on the assigned truck proves the booked carrier is the one hauling.'),
        ('How fast does a load get covered?', 'Your posting reaches carriers that fit the lane and equipment immediately. Offers run on a 15-minute first-accept-wins window; a carrier requests, you approve, and LoadBoot dispatch confirms the rate confirmation before the truck rolls.'),
        ('How do I stop double-brokering on my loads?', 'One MC equals one account, carrier authority is read live on every load, first-accept-wins means a load cannot be booked twice, and geofenced GPS stamps on the assigned truck are server-side evidence of who actually moved the freight.'),
        ('Can I post by email or from my TMS?', 'Yes. Add loads@loadboot.com to the load list you already send and each load is posted under your company; or post and receive events through the API and webhooks. The Partner portal and the LoadBoot app work too.'),
        ('How do I pay carriers?', 'Payables group per trip &mdash; freight plus approved claims, one total, one PAY-BY deadline. You pay with one receipt; the carrier (or their factoring company) confirms. See <a href="payments-settlements.html">payments &amp; settlements</a>.'),
        ('What visibility do I get after booking?', 'Live load and trip status, a map with ETA, geofenced arrive/depart stamps, document status and open exceptions &mdash; without a single check call. See <a href="gps-tracking.html">GPS tracking &amp; proof</a>.'),
    ])
    b += ('<section class="pl-sec soft" id="faq"><div class="wrap"><div class="pl-head center reveal"><div class="eyebrow">Questions</div><h2>Free load board for brokers &mdash; FAQ</h2></div><div class="pl-faq" style="max-width:840px;margin:0 auto">%s</div></div></section>' % faq_rows)
    # ---- KEEP READING (broker-side only) ----
    b += ('<section class="pl-sec"><div class="wrap"><div class="pl-head center reveal"><div class="eyebrow">Keep reading</div><h2>Before you post</h2></div><div class="grid g3 reveal">'
          + linkcard('brokers.html', '&#127970;', 'The full broker program', 'Explainable carrier matching, exception handling and API &mdash; how covering freight works end to end.')
          + linkcard('create-broker-account.html', '&#128221;', 'Create a broker account', 'MC screened live on FMCSA in seconds, one-click agreement, then your first posting reaches verified carriers in minutes.')
          + linkcard('market-rates.html', '&#128200;', 'Market rates per mile', 'Buy and sell side for every equipment type, refreshed weekly &mdash; price your postings against the market, free.')
          + '</div></div></section>')
    # ---- FINAL CTA ----
    b += ('<section class="pl-sec" style="padding-top:0"><div class="wrap"><div class="pl-cta reveal"><h2>Post once. Covered in minutes &mdash; with proof.</h2>'
          '<p>Enter your MC, accept one agreement, and your first load is in front of verified carriers today. Free at every volume.</p>'
          '<div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap"><a href="/app/partner/" class="btn btn-primary">Post a load free &rarr;</a><a href="create-broker-account.html" class="btn btn-secondary">Create a broker account</a></div></div></div></section>')
    return b, faq_schema


# =====================================================================================
# SHIPPER — shipper-solutions.html
# =====================================================================================
def shipper_landing(ctx):
    linkcard = ctx['linkcard']; cns = ctx['carrier_network_section']
    b = PL_CSS
    b += ('<section class="pl-hero"><div class="aurora"><span class="a1"></span><span class="a2"></span></div><div class="wrap pl-hero-grid"><div>'
          '<span class="pl-kicker reveal"><span class="dot"></span> For shippers &amp; facilities &middot; free to use</span>'
          '<h1 class="reveal d1">Ship Freight With Verified Carriers &mdash; <span class="gradtext">truckload quotes in minutes, GPS proof on every mile</span></h1>'
          '<p class="lead reveal d2">Request a shipment, get quotes from licensed brokers backed by FMCSA-verified carriers, and watch the truck on the same live map the carrier sees. Business confirmed from your company email in under a minute &mdash; no documents, no authority, no contract to request a quote.</p>'
          '<div class="hero-btns reveal d3"><a href="/app/partner/" class="btn btn-primary">Request a quote &rarr;</a><a href="create-shipper-account.html" class="btn btn-secondary">What we ask for &mdash; and when</a><a href="how-it-works.html" class="btn btn-ghost">How it works &rarr;</a></div>'
          '<div class="pl-trust reveal d3"><span><i>&#10003;</i> Licensed brokerage on every move</span><span><i>&#10003;</i> Geofenced pickup &amp; delivery stamps</span><span><i>&#10003;</i> Published accessorial standards</span></div>'
          '</div><div class="pl-mock reveal d2"><div class="pl-card">'
          '<div class="top"><strong>Shipment #SH-2093</strong><span class="live"><b></b> In transit &middot; on time</span></div>'
          '<div class="row"><span>Lane</span><span>Fresno, CA &rarr; Denver, CO</span></div>'
          '<div class="row"><span>Equipment</span><span>Reefer &middot; 34&deg;F &middot; produce</span></div>'
          '<div class="row"><span>Pickup</span><span>Geofence arrive 06:52 &middot; depart 08:10</span></div>'
          '<div class="row"><span>Carrier</span><span>Verified &middot; authority &amp; COI current</span></div>'
          '<div class="row"><span>ETA</span><span class="rate">Tomorrow 11:40 &middot; 1,196 mi</span></div>'
          '<div class="offers"><div class="of"><span class="av">Q</span>Quote &middot; Atlas Brokerage LLC<span class="ok">Accepted</span></div>'
          '<div class="of"><span class="av">Q</span>Quote &middot; Northline Logistics<span class="wait">Declined</span></div></div>'
          '</div><div class="pl-float pl-f1"><span class="ic">&#127970;</span> Business confirmed &middot; company email</div><div class="pl-float pl-f2"><span class="ic">&#128205;</span> Dock stamp recorded server-side</div></div></div></section>')
    b += ('<div class="pl-stats"><div class="wrap">'
          '<div class="pl-stat reveal"><div class="n">&lt;1<span style="font-size:1.2rem">min</span></div><div class="l">Business confirmed from your company email &mdash; no upload</div></div>'
          '<div class="pl-stat reveal d1"><div class="n">0</div><div class="l">Documents to request a quote &mdash; no authority, no bond, no contract</div></div>'
          '<div class="pl-stat reveal d2"><div class="n">3</div><div class="l">Items before your first booking: agreement, claims contact, billing instructions</div></div>'
          '<div class="pl-stat reveal d3"><div class="n">$0</div><div class="l">To use LoadBoot &mdash; you pay only the broker&rsquo;s quoted rate</div></div>'
          '</div></div>')
    b += ('<section class="pl-sec soft"><div class="wrap"><div class="pl-head center reveal"><div class="eyebrow">The four questions your customers ask</div><h2>Answered by the record, not by a phone call</h2>'
          '<p>Where is it, did it really arrive at 8, who is hauling it, and why is there a detention bill &mdash; every one of them ends against server-side evidence instead of somebody&rsquo;s word.</p></div>'
          + _tiles([
              ('&#128205;', 'Where is my freight?', 'A live map and ETA on every shipment, the same feed your carrier sees. Stale positions flag themselves &mdash; you are never comforted by an old dot.'),
              ('&#9201;', 'Did it really arrive at 8?', 'Geofenced arrive/depart stamps are recorded server-side at your dock. Disputes about time end against the record, in everyone&rsquo;s favor.'),
              ('&#128737;', 'Who is hauling it?', 'Vetted, health-scored carriers under licensed brokerage &mdash; authority and insurance tracked continuously, not photocopied once at setup.'),
              ('&#128203;', 'Why this detention bill?', 'Published standards ride every posting and claims arrive with their GPS evidence attached, so you approve documented time, never an invented number after the fact.'),
          ], 'pl-g4') + '</div></section>')
    b += ('<section class="pl-sec dark"><div class="wrap"><div class="pl-head center reveal"><div class="eyebrow">How it works for shippers</div><h2>Company email to moving freight &mdash; four steps</h2>'
          '<p>We treat a quote request as what it is &mdash; a non-binding ask. Nothing about your business has to be proven with paperwork before you can see what a lane costs.</p></div>'
          '<div class="pl-steps reveal" style="grid-template-columns:repeat(4,1fr)">'
          '<div class="pl-step"><span class="t">&lt;1 min</span><div class="num">1</div><h3>Business confirmed</h3><p>Sign up with a company email; we confirm the business from the domain itself (it receives mail, it has a website). Personal Gmail? Enter your company address and type the code we send it.</p></div>'
          '<div class="pl-step"><span class="t">minutes</span><div class="num">2</div><h3>Request the shipment</h3><p>Route with exact pins, schedule, equipment, commodity, facility rules. Licensed brokers quote it; you see a &ldquo;business confirmed&rdquo; badge on your side, they see it on theirs.</p></div>'
          '<div class="pl-step"><span class="t">1 click</span><div class="num">3</div><h3>Accept a quote &mdash; then the 3 items</h3><p>Shipper Agreement, a claims contact and billing instructions, asked once, when you accept your first quote. Payment terms are agreed at the same point.</p></div>'
          '<div class="pl-step"><span class="t">live</span><div class="num">4</div><h3>Watch it move, settle clean</h3><p>Live map, milestone timeline, ETA and document status. Delivery generates the paperwork trail; payments run receipt-verified with confirmations.</p></div>'
          '</div><div style="text-align:center;margin-top:34px" class="reveal"><a href="create-shipper-account.html" class="btn btn-secondary" style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.28)">See the signup walkthrough &rarr;</a></div></div></section>')
    b += ('<section class="pl-sec"><div class="wrap"><div class="pl-split">'
          '<div class="reveal"><div class="eyebrow">Visibility that holds up in a dispute</div><h2 style="font-size:clamp(1.7rem,3vw,2.3rem);line-height:1.15;margin:0 0 14px">Live GPS, geofenced docks and a milestone timeline &mdash; included, not upsold</h2>'
          '<p style="color:#475569;line-height:1.75;font-size:1.05rem">Other platforms sell visibility as a separate subscription. On LoadBoot it is how the freight is run: the assigned truck reports position, your facility pins arm the geofences, and every arrival and departure is stamped server-side.</p>'
          '<div class="pl-li"><span class="pl-tick">&#10003;</span><div><b>Live map and ETA</b> &mdash; your freight, the truck, the road ahead; stale feeds are flagged, never hidden.</div></div>'
          '<div class="pl-li"><span class="pl-tick">&#10003;</span><div><b>Geofenced arrive/depart stamps</b> at pickup and delivery &mdash; the same evidence used to settle detention.</div></div>'
          '<div class="pl-li"><span class="pl-tick">&#10003;</span><div><b>Documents on the load</b> &mdash; rate confirmation, BOL and POD ride the shipment; delivery flips it to the payables view.</div></div>'
          '<div class="pl-li"><span class="pl-tick">&#10003;</span><div><b>Facility role</b> &mdash; warehouses schedule dock appointments and manage geofenced check-ins even when someone else books the truck.</div></div>'
          '<a href="gps-tracking.html" class="btn btn-secondary" style="margin-top:8px">How GPS tracking &amp; proof works &rarr;</a></div>'
          '<div class="reveal"><div class="pl-card"><div class="top"><strong>Dock 3 &middot; Denver DC</strong><span class="live"><b></b> Truck at gate</span></div>'
          '<div class="row"><span>Appointment</span><span>11:30 &middot; FCFS window 11:00&ndash;13:00</span></div>'
          '<div class="row"><span>Geofence arrive</span><span>11:24 &middot; server stamp</span></div>'
          '<div class="row"><span>Free time</span><span>2h &middot; clock started 11:24</span></div>'
          '<div class="row"><span>Detention</span><span class="rate">$0 so far &middot; $75/hr after 13:24</span></div>'
          '<div class="row"><span>POD</span><span>Pending &middot; driver scan</span></div></div></div>'
          '</div></div></section>')
    b += ('<section class="pl-sec soft"><div class="wrap"><div class="pl-split">'
          '<div class="reveal"><div class="pl-grid pl-g2" style="gap:16px">'
          '<div class="pl-tile"><div class="pl-num">$725M<small>estimated U.S. cargo-theft losses in 2025, up ~60% on 2024</small></div></div>'
          '<div class="pl-tile"><div class="pl-num">2,646<small>confirmed cargo thefts in 2025 (+18%); average loss $273,990 per event</small></div></div>'
          '<div class="pl-tile"><div class="pl-num">708<small>food &amp; beverage thefts in 2025 (+47%) &mdash; the most-targeted commodity</small></div></div>'
          '<div class="pl-tile"><div class="pl-num">+77%<small>metals thefts in 2025, driven by copper demand</small></div></div>'
          '</div><p class="pl-src">Source: <a href="https://www.cargonet.com/news-and-events/cargonet-in-the-media/2025-theft-trends/" rel="noopener nofollow" target="_blank">Verisk CargoNet, 2025 supply-chain theft trends</a>. Their figures, not LoadBoot&rsquo;s.</p></div>'
          '<div class="reveal"><div class="eyebrow">Protection built into the move</div><h2 style="font-size:clamp(1.7rem,3vw,2.3rem);line-height:1.15;margin:0 0 14px">Strategic theft targets the paperwork gap. We closed it.</h2>'
          '<p style="color:#475569;line-height:1.75;font-size:1.05rem">Fictitious pickups and double-brokered loads work because nobody checks who is actually at the dock. On LoadBoot the carrier is verified against the federal record, the assigned truck is the one reporting GPS, and your gate stamp is recorded by the server &mdash; not typed in later.</p>'
          '<div class="pl-li"><span class="pl-tick">&#10003;</span><div><b>Licensed brokerage on every shipment</b> &mdash; your freight moves under a property broker whose authority is read live from FMCSA.</div></div>'
          '<div class="pl-li"><span class="pl-tick">&#10003;</span><div><b>Carrier authority and COI tracked continuously</b>, with account-health scoring before a truck is ever offered your load.</div></div>'
          '<div class="pl-li"><span class="pl-tick">&#10003;</span><div><b>The truck you see is the truck that hauls</b> &mdash; GPS on the assigned unit, geofence proof at both ends.</div></div>'
          '<a href="protect-freight-from-loss-damage-and-fraud.html" class="btn btn-secondary" style="margin-top:8px">The shipper&rsquo;s guide to loss, damage &amp; fraud &rarr;</a></div>'
          '</div></div></section>')
    b += ('<section class="pl-sec"><div class="wrap"><div class="pl-head center reveal"><div class="eyebrow">Accessorials, in writing</div><h2>Published standards ride every posting &mdash; so the bill is never a surprise</h2>'
          '<p>Detention, TONU, layover, lumper, driver assist and FCFS rules are agreed before the truck rolls and settled against GPS evidence, measured identically for every carrier at your docks.</p></div>'
          '<div class="pl-ind reveal">'
          '<a href="detention-pay-policy.html"><b>Detention</b><span>Free time, the clock start, the hourly rate &mdash; and the geofence stamp that proves it.</span><em>Read the standard &rarr;</em></a>'
          '<a href="fcfs-policy.html"><b>FCFS &amp; scheduling</b><span>First-come-first-served vs appointment, and what a missed window means.</span><em>Read the standard &rarr;</em></a>'
          '<a href="lumper-policy.html"><b>Lumper fees</b><span>Who pays at the dock, receipts, and how reimbursement is settled.</span><em>Read the standard &rarr;</em></a>'
          '<a href="tonu-policy.html"><b>TONU</b><span>Truck ordered, not used &mdash; the cancellation exposure that keeps postings honest.</span><em>Read the standard &rarr;</em></a>'
          '<a href="layover-policy.html"><b>Layover</b><span>When a truck has to wait overnight, and what that costs in writing.</span><em>Read the standard &rarr;</em></a>'
          '<a href="driver-assist-policy.html"><b>Driver assist</b><span>When the driver works the dock &mdash; agreed before, not argued after.</span><em>Read the standard &rarr;</em></a>'
          '</div></div></section>')
    b += ('<section class="pl-sec soft"><div class="wrap"><div class="pl-head center reveal"><div class="eyebrow">Know the price before you ask</div><h2>Truckload rates per mile &mdash; the buy and sell side, published free</h2>'
          '<p>Most shippers negotiate blind against a broker looking at a rate screen. Ours is public: carrier, broker and shipper sides for every equipment type, refreshed weekly, plus what your industry&rsquo;s freight actually needs.</p></div>'
          '<div class="pl-ind reveal">'
          '<a href="market-rates.html"><b>Market rates per mile</b><span>Dry van, reefer, flatbed, step deck, power only, hotshot, box truck &mdash; all three sides.</span><em>See live rates &rarr;</em></a>'
          '<a href="freight-market-reports.html"><b>Weekly market reports</b><span>What moved, what tightened, what it did to rates this week.</span><em>Read this week &rarr;</em></a>'
          '<a href="freight-shipping-by-industry.html"><b>Freight shipping by industry</b><span>Produce, food &amp; beverage, building materials, metals, manufacturing, retail &mdash; the trailer, the rules, the dock reality.</span><em>Find your industry &rarr;</em></a>'
          '<a href="full-truckload-vs-ltl.html"><b>FTL vs LTL vs partial</b><span>Which mode pays for your freight, and when a partial beats both.</span><em>Compare modes &rarr;</em></a>'
          '<a href="fuel-surcharge-trucking.html"><b>Fuel surcharge</b><span>How FSC per mile is calculated and audited.</span><em>See the formula &rarr;</em></a>'
          '<a href="how-to-ship-without-a-broker.html"><b>Shipping without a broker</b><span>What going direct really involves &mdash; and where licensed brokerage still protects you.</span><em>Read the guide &rarr;</em></a>'
          '</div></div></section>')
    b += cns('shipper')
    faq_rows, faq_schema = _faq([
        ('How fast can I get a truckload quote?', 'Minutes. Sign up with a company email and the business is confirmed automatically in under a minute (the domain receives mail and has a website); the request form opens right away and licensed brokers quote it. Signed up with Gmail? Enter your company address and type the 6-digit code we email it.'),
        ('Do I need a broker authority, a bond or a contract to ship with LoadBoot?', 'No. You bring the freight and the facilities; movement runs under licensed brokerage and LoadBoot&rsquo;s verified carrier network. No authority, no bond, no long-term contract on your side.'),
        ('What do I have to provide before a booking?', 'Once, when you accept your first quote: the Shipper Agreement (one click), a claims contact and billing instructions, and payment terms agreed at the same point. Quote requests never wait on any of it.'),
        ('How do I know the carrier on my load is legitimate?', 'Every carrier passes authority, insurance and account-health checks before freight is offered to them, credentials are tracked continuously, and GPS on the assigned truck plus geofenced dock stamps prove the carrier you were told about is the one hauling. See <a href="compliance.html">how verification works</a>.'),
        ('What visibility do I get without check calls?', 'A live map with ETA, a milestone timeline and geofenced arrive/depart stamps recorded server-side at your own docks &mdash; the same record your carrier sees. Stale feeds flag themselves.'),
        ('Who controls accessorial charges like detention and lumper?', 'Published standards ride every posting and claims arrive with their GPS evidence attached, so you approve documented time, never an invented number after the fact. Dwell at your docks is measured identically for every carrier.'),
        ('Can my warehouse use LoadBoot without booking freight?', 'Yes &mdash; the Facility / Warehouse role handles dock appointments and geofenced check-ins so your gate has an accurate arrival record even when someone else books the truck.'),
        ('What does it cost a shipper?', 'Nothing to use the platform &mdash; requesting, tracking, documents and the payables view are free. You pay the broker&rsquo;s quoted rate for the move; LoadBoot&rsquo;s only revenue is the flat 5% dispatch fee on the carrier side.'),
        ('Can I ship direct to a carrier instead of through a broker?', 'You can post freight to the verified carrier network directly; where the law requires it, the move still runs under licensed brokerage so you keep the protection. See <a href="ship-direct-to-carrier.html">ship direct to carriers</a>.'),
        ('What kinds of freight can I ship?', 'Full truckload and partial across dry van, reefer, flatbed, step deck, power only, hotshot and box truck. Industry pages cover the rules for produce, food &amp; beverage, building materials, metals, manufacturing and retail freight.'),
    ])
    b += ('<section class="pl-sec soft" id="faq"><div class="wrap"><div class="pl-head center reveal"><div class="eyebrow">Questions</div><h2>Shipping with LoadBoot &mdash; FAQ</h2></div><div class="pl-faq" style="max-width:840px;margin:0 auto">%s</div></div></section>' % faq_rows)
    b += ('<section class="pl-sec"><div class="wrap"><div class="pl-head center reveal"><div class="eyebrow">Keep reading</div><h2>Before you post your freight</h2></div><div class="grid g3 reveal">'
          + linkcard('create-shipper-account.html', '&#128221;', 'Create a shipper account', 'Business confirmed from your company email in under a minute, then request your first quote.')
          + linkcard('ship-direct-to-carrier.html', '&#128666;', 'Ship direct to carriers', 'Post freight to the verified network and keep licensed-brokerage protection where it matters.')
          + linkcard('protect-freight-from-loss-damage-and-fraud.html', '&#128737;', 'Loss, damage &amp; fraud guide', 'Seven things to do on every load, and how a verified platform does them for you.')
          + '</div></div></section>')
    b += ('<section class="pl-sec" style="padding-top:0"><div class="wrap"><div class="pl-cta reveal"><h2>Your freight. Moved on the record.</h2>'
          '<p>Sign up with your company email, request a shipment, and watch verified carriers move it with proof at every mile.</p>'
          '<div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap"><a href="/app/partner/" class="btn btn-primary">Request a quote &rarr;</a><a href="create-shipper-account.html" class="btn btn-secondary">Create a shipper account</a></div></div></div></section>')
    return b, faq_schema
