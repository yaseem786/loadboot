# -*- coding: utf-8 -*-
# dispatch_os_module.py — "The Operating System for Trucking" layer + the dispatcher model AS THE CODE RUNS IT
# (25 Sep 2026). Every claim below maps to a shipped mechanism; see docs/MARKETING-REPOSITION-PLAN-2026-09-24.md §1.
#
# What this module gives build_site.py:
#   DOS_CSS            scoped .dos-* styles (include once per page that uses a dos_* section)
#   dos_steps(mode)    the 8-step "how LoadBoot dispatch works" strip — 'short' (home), 'full' (services / deep page),
#                      'equipment' (svc_page template, takes the equipment name)
#   dos_layers()       brand / platform / dispatch network — the three layers in one picture
#   dos_roles()        who the operating system serves: carrier, driver, dispatcher, broker, broker agent, shipper, partner
#   dos_who()          three columns: your dispatcher does / the platform does / you do
#   dos_pages()        bodies + schema for the new URLs (how-loadboot-dispatch-works, dedicated-truck-dispatcher,
#                      ai-dispatch-for-owner-operators, truck-dispatcher-vs-dispatch-software, broker-agents)
#
# Vocabulary rules (owner, 25 Sep 2026): "dedicated dispatcher" / "LoadBoot-vetted dispatcher", never "independent
# dispatcher" for the person who books loads; the referral program is "Referral Partner"; fee = "flat 5% of line-haul,
# earned at delivery — fuel surcharge and accessorials are yours"; "no long-term contract"; "business-hours dispatch
# desk, Riley answers the phone 24/7"; assignment SLA = 3 business days (disp_desk_config.assign_sla_business_days);
# never a dispatcher commission %; never "zero ghost loads" as a headline; never "always-on" GPS numbers.

DOS_CSS = '''<style>
.dos-wrap{max-width:1160px;margin:0 auto}
.dos-eyebrow{display:inline-flex;align-items:center;gap:8px;font-weight:800;font-size:.76rem;letter-spacing:.12em;text-transform:uppercase;color:#0883F7}
.dos-eyebrow i{width:8px;height:8px;border-radius:50%;background:#FC5305;display:inline-block;box-shadow:0 0 0 4px rgba(252,83,5,.18)}
.dos-h2{font-size:clamp(1.6rem,3.2vw,2.35rem);line-height:1.12;letter-spacing:-.015em;margin:10px 0 12px}
.dos-lead{color:#475569;font-size:1.06rem;line-height:1.7;max-width:64ch}
/* --- 8-step rail (short) --- */
.dos-rail{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:30px;position:relative}
.dos-rail:before{content:"";position:absolute;left:4%;right:4%;top:34px;border-top:2px dashed #cbd5e1;z-index:0}
.dos-tile{position:relative;z-index:1;background:#fff;border:1px solid #e2e8f0;border-radius:18px;padding:22px 18px 18px;text-decoration:none;color:inherit;display:block;transition:transform .18s,box-shadow .18s,border-color .18s}
.dos-tile:hover{transform:translateY(-3px);box-shadow:0 18px 40px -22px rgba(15,23,42,.35);border-color:#93c5fd}
.dos-tile .n{width:34px;height:34px;border-radius:11px;background:linear-gradient(135deg,#0883F7,#1e40af);color:#fff;font-weight:800;display:flex;align-items:center;justify-content:center;font-size:.95rem;box-shadow:0 8px 18px -8px rgba(8,131,247,.7)}
.dos-tile .n.o{background:linear-gradient(135deg,#FC5305,#c2410c);box-shadow:0 8px 18px -8px rgba(252,83,5,.7)}
.dos-tile b{display:block;margin:12px 0 4px;font-size:1rem;color:#10223B}
.dos-tile span{display:block;color:#64748b;font-size:.88rem;line-height:1.5}
.dos-tile em{display:inline-block;margin-top:10px;font-style:normal;color:#0883F7;font-weight:700;font-size:.82rem}
@media(max-width:900px){.dos-rail{grid-template-columns:repeat(2,1fr)}.dos-rail:before{display:none}}
@media(max-width:480px){.dos-rail{grid-template-columns:1fr}}
/* --- 8-step full (alternating rows) --- */
.dos-row{display:grid;grid-template-columns:72px 1fr 1fr;gap:22px;align-items:start;padding:26px 0;border-top:1px solid #e6ebf3}
.dos-row:first-child{border-top:0}
.dos-row .big{width:64px;height:64px;border-radius:20px;background:linear-gradient(135deg,#10223B,#1e3a5f);color:#fff;display:flex;align-items:center;justify-content:center;font-family:Manrope,sans-serif;font-weight:800;font-size:1.35rem;box-shadow:0 14px 30px -14px rgba(16,34,59,.7)}
.dos-row h3{margin:4px 0 8px;font-size:1.2rem}
.dos-row p{margin:0;color:#475569;line-height:1.7}
.dos-row .who{display:inline-block;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;border-radius:999px;padding:4px 11px;font-size:.74rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;margin-bottom:8px}
.dos-row .who.o{background:#fff7ed;color:#c2410c;border-color:#fed7aa}
.dos-row .who.g{background:#ecfdf5;color:#047857;border-color:#a7f3d0}
.dos-proof{background:#f8fafc;border:1px solid #e2e8f0;border-radius:16px;padding:16px 18px}
.dos-proof b{display:block;font-size:.78rem;letter-spacing:.08em;text-transform:uppercase;color:#64748b;margin-bottom:8px}
.dos-proof ul{margin:0;padding:0;list-style:none}
.dos-proof li{padding:6px 0;border-top:1px dashed #e2e8f0;font-size:.92rem;color:#334155}
.dos-proof li:first-child{border-top:0;padding-top:0}
.dos-proof li a{color:#0883F7;font-weight:600;text-decoration:none}
.dos-proof li a:hover{text-decoration:underline}
@media(max-width:860px){.dos-row{grid-template-columns:52px 1fr}.dos-row .big{width:48px;height:48px;font-size:1.1rem;border-radius:15px}.dos-proof{grid-column:2}}
/* --- three layers --- */
.dos-layers{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:30px}
.dos-layer{border-radius:22px;padding:28px 24px;position:relative;overflow:hidden;min-height:260px}
.dos-layer.l1{background:linear-gradient(160deg,#0b1220,#12304f);color:#fff}
.dos-layer.l2{background:#fff;border:1px solid #e2e8f0}
.dos-layer.l3{background:linear-gradient(160deg,#fff7ed,#ffedd5);border:1px solid #fed7aa}
.dos-layer .k{font-size:.72rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase;opacity:.75}
.dos-layer h3{margin:8px 0 10px;font-size:1.25rem}
.dos-layer.l1 h3{color:#fff}
.dos-layer p{margin:0 0 12px;font-size:.95rem;line-height:1.65;color:#475569}
.dos-layer.l1 p{color:#c7d5ea}
.dos-layer ul{margin:0;padding:0;list-style:none}
.dos-layer li{display:flex;gap:8px;align-items:flex-start;font-size:.9rem;padding:5px 0;color:#334155}
.dos-layer.l1 li{color:#e2e8f0}
.dos-layer li svg{flex:none;margin-top:3px}
.dos-layer li a{color:inherit;text-decoration:underline;text-decoration-color:rgba(8,131,247,.45);text-underline-offset:3px}
@media(max-width:900px){.dos-layers{grid-template-columns:1fr}}
/* --- roles --- */
.dos-roles{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:30px}
.dos-role{background:#fff;border:1px solid #e2e8f0;border-radius:18px;padding:22px 20px;text-decoration:none;color:inherit;display:flex;flex-direction:column;transition:transform .18s,box-shadow .18s}
.dos-role:hover{transform:translateY(-3px);box-shadow:0 18px 40px -22px rgba(15,23,42,.35)}
.dos-role .ic{width:46px;height:46px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:1.4rem;background:#eff6ff}
.dos-role b{display:block;margin:12px 0 4px;font-size:1.02rem;color:#10223B}
.dos-role p{margin:0 0 12px;color:#64748b;font-size:.9rem;line-height:1.55;flex:1}
.dos-role small{color:#0883F7;font-weight:700;font-size:.82rem}
.dos-role .free{display:inline-block;background:#ecfdf5;color:#047857;border-radius:999px;padding:3px 9px;font-size:.7rem;font-weight:800;letter-spacing:.06em;margin-left:6px;vertical-align:middle}
@media(max-width:1000px){.dos-roles{grid-template-columns:repeat(2,1fr)}}
@media(max-width:520px){.dos-roles{grid-template-columns:1fr}}
/* --- who does what --- */
.dos-who{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:30px}
.dos-col{border-radius:20px;padding:26px 22px;border:1px solid #e2e8f0;background:#fff}
.dos-col.d{background:linear-gradient(160deg,#0b1220,#12304f);color:#fff;border-color:transparent}
.dos-col .t{display:flex;align-items:center;gap:10px;font-family:Manrope,sans-serif;font-weight:800;font-size:1.1rem;margin-bottom:6px}
.dos-col .t span{width:38px;height:38px;border-radius:12px;display:flex;align-items:center;justify-content:center;background:#eff6ff;font-size:1.2rem}
.dos-col.d .t span{background:rgba(255,255,255,.1)}
.dos-col .s{font-size:.84rem;color:#64748b;margin-bottom:14px}
.dos-col.d .s{color:#9fb3cc}
.dos-col ul{margin:0;padding:0;list-style:none}
.dos-col li{display:flex;gap:9px;align-items:flex-start;padding:7px 0;border-top:1px solid #eef2f7;font-size:.93rem;color:#334155;line-height:1.5}
.dos-col.d li{border-top-color:rgba(255,255,255,.1);color:#e2e8f0}
.dos-col li:first-child{border-top:0}
.dos-col li svg{flex:none;margin-top:4px}
.dos-col li a{color:inherit;text-decoration:underline;text-decoration-color:rgba(8,131,247,.45);text-underline-offset:3px}
@media(max-width:900px){.dos-who{grid-template-columns:1fr}}
/* --- misc --- */
.dos-note{background:#fffbeb;border:1px solid #fde68a;border-radius:14px;padding:14px 18px;color:#78350f;font-size:.9rem;line-height:1.6;margin-top:22px}
.dos-cmp{width:100%;border-collapse:separate;border-spacing:0;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden;font-size:.93rem}
.dos-cmp th,.dos-cmp td{padding:13px 14px;text-align:left;vertical-align:top;border-top:1px solid #eef2f7}
.dos-cmp thead th{background:#10223B;color:#fff;border-top:0;font-size:.86rem;letter-spacing:.03em}
.dos-cmp td:first-child{font-weight:700;color:#10223B;width:24%}
.dos-cmp .us{background:#f0f9ff}
.dos-cmp-wrap{overflow-x:auto;margin-top:26px}
.dos-kpi{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:26px}
.dos-kpi div{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:18px 16px;text-align:center}
.dos-kpi b{display:block;font-family:Manrope,sans-serif;font-size:1.5rem;color:#10223B}
.dos-kpi span{color:#64748b;font-size:.84rem}
@media(max-width:760px){.dos-kpi{grid-template-columns:repeat(2,1fr)}}
</style>'''

_CHK = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>'
_CHKW = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>'

def _head(eyebrow, h2, lead='', center=True, light=False):
    st = ' style="text-align:center"' if center else ''
    ld = ('<p class="dos-lead"%s>%s</p>' % (' style="margin:0 auto;color:#c7d5ea"' if light else (' style="margin:0 auto"' if center else ''), lead)) if lead else ''
    return ('<div class="reveal"%s><div class="dos-eyebrow"><i></i>%s</div><h2 class="dos-h2"%s>%s</h2>%s</div>'
            % (st, eyebrow, ' style="color:#fff"' if light else '', h2, ld))

# ---------------------------------------------------------------------------------------------
# THE 8 STEPS — one source of truth. (who, title, short, long, proof-links)
# who: 'you' | 'lb' (LoadBoot / Command Center) | 'disp' (your dispatcher) | 'plat' (the platform)
STEPS = [
 ('you', 'You apply, we verify',
  'Authority, insurance, W-9 and a short dispatch agreement. AI pre-checks every document; a person reviews it.',
  'You keep your MC/DOT and your insurance. The six-step setup (company &amp; authority, equipment, factoring &amp; payment, dispatch preferences, documents, review) '
  'takes minutes, or you can do it inside the chat window. Every upload gets an instant AI pre-check that tells you what to fix before it costs you a load; '
  'the Command Center then verifies it against FMCSA and tracks every expiry date so nothing lapses quietly.',
  [('create-carrier-account.html','The exact setup checklist'),('compliance.html','How verification works'),('carrier-application.html','Apply as a carrier')]),
 ('lb', 'We match you by hand &mdash; within 3 business days',
  'A written SOP from your lanes, floor rate, equipment and home time. One dedicated dispatcher, assigned by the Command Center.',
  'No pool, no round-robin. LoadBoot staff write a one-page operating brief for your truck &mdash; scope, lanes, minimum rate, equipment, home time &mdash; and assign '
  'one dispatcher who carries a fixed number of trucks. The promise is an assignment within 3 business days of approval; if we run late, your Dispatcher tab shows '
  'exactly why (new authority, documents pending, capacity) instead of silence. Your dispatcher&rsquo;s LoadBoot line and mailbox are released to you by compliance &mdash; never a personal number.',
  [('dedicated-truck-dispatcher.html','Why one dedicated dispatcher'),('us-truck-dispatcher.html','The US dispatcher desk')]),
 ('lb', 'Your dispatcher passed our test',
  'A timed exam on compliance, negotiation and load sourcing, a voice negotiation drill, then a 10-working-day paid trial with KPIs.',
  'Every LoadBoot dispatcher applies, is screened, sits a timed 18-question exam (compliance thresholds are hard gates &mdash; a candidate who would book an illegal-hours plan or miss a '
  'double-brokering set-up does not pass), records a voice negotiation drill, and then runs a 10-working-day trial on real trucks with measurable KPIs: loads per truck per week, rates above the '
  'carrier&rsquo;s floor, every rate confirmation attached, check calls on every load, zero dispatcher-caused cancellations. Only then are they verified and active. They work remotely on US Eastern hours, as LoadBoot contractors &mdash; you never pay them; we do.',
  [('careers.html#dispatcher-job','What we require of a dispatcher'),('how-much-does-a-truck-dispatcher-cost.html','What a dispatcher costs')]),
 ('you', 'You confirm you&rsquo;re empty, they go to work',
  'One tap: empty or backhaul, refreshed every 24 hours. Your dispatcher works DAT, Truckstop, 123Loadboard, broker networks, direct shippers and the LoadBoot board.',
  'Your dispatcher only sources freight while you have a confirmed availability post in the last 24 hours &mdash; so nobody books a truck that is not actually free. From there they work the boards they '
  'know (DAT, Truckstop, 123Loadboard), broker e-mail networks, direct shippers and LoadBoot&rsquo;s own verified board where brokers and shippers post with the rate card in writing. Every offer comes to you with rate, miles and rate-per-mile already worked out.',
  [('load-board.html','The verified load board'),('load-score.html','Load Score: take, negotiate or pass'),('market-rates.html','Live market rates per mile')]),
 ('disp', 'Every rate confirmation gets two approvals',
  'Yours, against your floor rate. Then LoadBoot&rsquo;s, before the truck moves. Booked under your authority, as your agent &mdash; never re-brokered.',
  'Nothing books without your approval, and your dispatcher cannot approve their own booking: they log it with the rate confirmation attached, LoadBoot&rsquo;s desk checks it against your SOP and floor, '
  'and only then does it become a booked load and a live trip. Every rate con names your company, not LoadBoot &mdash; your dispatcher acts as your bona fide agent under FMCSA guidance (88 FR 39368), never as a broker.',
  [('how-to-read-a-rate-confirmation.html','How to read a rate con'),('truck-dispatcher-vs-freight-broker.html','Dispatcher vs freight broker'),('book-truck-loads.html','How booking works')]),
 ('plat', 'The platform tracks and proves',
  'Phone GPS or your Samsara / Motive ELD. Geofenced arrive and depart stamps, a detention clock at the dock, the POD in your vault.',
  'Your phone (or driver&rsquo;s phone, in driver mode) or your existing ELD feeds the trip. 800-metre geofences stamp arrival and departure server-side, the detention clock runs from the stamp, '
  'and a claim drafts itself with the evidence attached. TONU drafts on cancellation. The POD goes straight into your document vault and through review. No hardware to buy, no ELD contract required.',
  [('gps-tracking.html','GPS tracking &amp; proof'),('detention-pay-policy.html','Detention: $60/hr after 2 h'),('tonu-policy.html','TONU: $250')]),
 ('you', 'You get paid directly',
  'The broker or your factor pays you, bank to bank. LoadBoot never holds your money. One 5% invoice per delivered load, Net-30.',
  'LoadBoot is not a factor and not a bank. Freight money moves from the broker to you or to your factoring company (your NOA routes the remit-to automatically). What we bill is our own fee: '
  'a flat 5% of gross line-haul on loads booked through your dispatcher and delivered, invoiced after delivery on Net-30 terms. Fuel surcharge, detention, TONU, layover and lumper are 100% yours &mdash; we take nothing from accessorials.',
  [('pricing.html','Pricing, in the open'),('payments-settlements.html','Payments &amp; settlements'),('factoring-noa.html','Factoring &amp; NOA')]),
 ('you', 'Not happy? Pause or switch',
  'One tap in the app to pause, or ask for a different dispatcher. 30 days&rsquo; notice to leave. No long-term contract.',
  'The Dispatcher tab in your carrier app has two buttons that most dispatch companies would never give you: <b>Pause</b> and <b>Ask for a different dispatcher</b>. The desk reviews the request and reassigns. '
  'The dispatch agreement is month-to-month with 30 days&rsquo; written notice; loads already booked finish under it. We earn your business load by load.',
  [('apps.html','The carrier app'),('faq.html','Carrier FAQ'),('contact.html','Talk to the desk')]),
]

_WHO_LABEL = {'you': ('You', ''), 'lb': ('LoadBoot desk', 'o'), 'disp': ('Your dispatcher', 'o'), 'plat': ('The platform', 'g')}

def dos_steps(mode='short', equipment=None, eyebrow=None, h2=None, lead=None):
    """The 8-step strip. mode: 'short' (tiles), 'full' (rows + proof links), 'equipment' (4 tiles, equipment-specific)."""
    if mode == 'full':
        rows = ''
        for i, (who, t, s, l, proof) in enumerate(STEPS):
            lab, cls = _WHO_LABEL[who]
            pl = ''.join('<li><a href="%s">%s &rarr;</a></li>' % (h, x) for h, x in proof)
            rows += ('<div class="dos-row reveal"><div class="big">%d</div><div><span class="who %s">%s</span><h3>%s</h3><p>%s</p></div>'
                     '<div class="dos-proof"><b>What backs this step</b><ul>%s</ul></div></div>') % (i + 1, cls, lab, t, l, pl)
        return ('<section><div class="wrap dos-wrap">' + _head(eyebrow or 'How LoadBoot dispatch works, A to Z', h2 or 'Eight steps. Every one of them is a real mechanism, not a promise.',
                lead or 'This is the whole loop from the day you apply to the day you decide to stay or go. Each step names who does it and links to the screen, policy or page that makes it true.') +
                '<div style="margin-top:26px">%s</div></div></section>' % rows)
    if mode == 'equipment':
        eq = equipment or 'your'
        picks = [STEPS[1], STEPS[3], STEPS[4], STEPS[6]]
        tiles = ''
        for j, (who, t, s, l, proof) in enumerate(picks):
            n = STEPS.index(picks[j]) + 1
            tiles += ('<a class="dos-tile reveal" href="how-loadboot-dispatch-works.html#step-%d"><div class="n%s">%d</div><b>%s</b><span>%s</span><em>See the full step &rarr;</em></a>'
                      % (n, ' o' if who in ('lb', 'disp') else '', n, t, s))
        return ('<section class="bg-soft"><div class="wrap dos-wrap">' + _head('Your dispatcher, and how they are chosen', 'How a %s truck actually gets dispatched here' % eq,
                'No call centre, no freelancer roulette. A LoadBoot-vetted dispatcher is assigned to your truck by hand, books under your authority, and the platform proves every mile. The full eight steps are on <a href="how-loadboot-dispatch-works.html">how LoadBoot dispatch works</a>.') +
                '<div class="dos-rail" style="grid-template-columns:repeat(4,1fr)">%s</div></div></section>' % tiles)
    # short
    tiles = ''
    for i, (who, t, s, l, proof) in enumerate(STEPS):
        tiles += ('<a class="dos-tile reveal" href="how-loadboot-dispatch-works.html#step-%d"><div class="n%s">%d</div><b>%s</b><span>%s</span></a>'
                  % (i + 1, ' o' if who in ('lb', 'disp') else '', i + 1, t, s))
    return ('<section><div class="wrap dos-wrap">' + _head(eyebrow or 'How dispatch works here', h2 or 'A dedicated dispatcher, a platform that proves every mile &mdash; in eight steps',
            lead or 'Orange steps are LoadBoot&rsquo;s desk and your dispatcher. Blue steps are yours. Tap any step for the full mechanism.') +
            '<div class="dos-rail">%s</div><div class="reveal" style="text-align:center;margin-top:22px"><a href="how-loadboot-dispatch-works.html" class="btn btn-secondary">Read all eight steps in detail &rarr;</a></div></div></section>' % tiles)

# ---------------------------------------------------------------------------------------------
def dos_layers(light_intro=False):
    return ('<section class="bg-soft"><div class="wrap dos-wrap">' + _head('The Operating System for Trucking', 'One platform. A dispatch network that runs on it. And you stay in charge.',
        'LoadBoot is not a two-person dispatch agency, and it is not a marketplace where you pick a freelancer. It is three layers that only work together.') +
        '<div class="dos-layers">'
        '<div class="dos-layer l1 reveal"><div class="k">Layer 1 &middot; the platform</div><h3>The rails every load runs on</h3><p>Verified board, carrier app, documents, tracking and the money trail &mdash; the same record for the carrier, the broker, the shipper and the dispatcher.</p><ul>'
        '<li>%s<span>Verified load board with the rate card in writing &middot; <a href="load-board.html">board</a></span></li>'
        '<li>%s<span>Carrier app on Google Play, driver mode, phone or ELD GPS &middot; <a href="apps.html">app</a> &middot; <a href="gps-tracking.html">tracking</a></span></li>'
        '<li>%s<span>Document vault with AI pre-check and expiry reminders &middot; <a href="compliance.html">compliance</a></span></li>'
        '<li>%s<span>Settlements ledger, factoring NOA routing, QuickBooks &middot; <a href="payments-settlements.html">payments</a></span></li>'
        '<li>%s<span>Account health score, market rates, Load Score &middot; <a href="market-rates.html">rates</a> &middot; <a href="load-score.html">Load Score</a></span></li>'
        '<li>%s<span>Riley answers the phone 24/7; live chat can open your account &middot; <a href="contact.html">contact</a></span></li>'
        '</ul></div>'
        '<div class="dos-layer l2 reveal d1"><div class="k" style="color:#c2410c">Layer 2 &middot; LoadBoot Dispatch</div><h3>A dedicated, vetted dispatcher on your truck</h3><p>Screened, tested and trialled by LoadBoot, assigned by hand within 3 business days, supervised by the Command Center, paid by LoadBoot &mdash; never by you.</p><ul>'
        '<li>%s<span>One dispatcher per carrier, fixed truck count &middot; <a href="dedicated-truck-dispatcher.html">why dedicated</a></span></li>'
        '<li>%s<span>Timed exam + voice drill + 10-day trial with KPIs &middot; <a href="how-loadboot-dispatch-works.html#step-3">the test</a></span></li>'
        '<li>%s<span>Sources on DAT, Truckstop, 123LB, broker networks, direct shippers</span></li>'
        '<li>%s<span>Every rate con approved by you and by LoadBoot &middot; <a href="how-loadboot-dispatch-works.html#step-5">two approvals</a></span></li>'
        '<li>%s<span>Business-hours desk, on-call while your load is moving</span></li>'
        '<li>%s<span>Pause or switch dispatcher from your app</span></li>'
        '</ul></div>'
        '<div class="dos-layer l3 reveal d2"><div class="k" style="color:#9a3412">Layer 3 &middot; you</div><h3>Your authority, your money, your call</h3><p>The layers above exist to serve one thing: a carrier who keeps control and pays only when a load delivers.</p><ul>'
        '<li>%s<span>You stay the motor carrier of record &mdash; your MC, your insurance</span></li>'
        '<li>%s<span>Brokers pay you or your factor directly; LoadBoot never holds freight money</span></li>'
        '<li>%s<span>Flat 5%% of line-haul, earned at delivery &middot; <a href="pricing.html">pricing</a></span></li>'
        '<li>%s<span>Fuel surcharge, detention, TONU, layover, lumper: 100%% yours</span></li>'
        '<li>%s<span>No long-term contract &mdash; 30 days&rsquo; notice</span></li>'
        '<li>%s<span>Every load approved by you before it books</span></li>'
        '</ul></div>'
        '</div></div></section>') % tuple([_CHKW] * 6 + [_CHK] * 12)

# ---------------------------------------------------------------------------------------------
def dos_roles():
    roles = [
     ('&#128666;', 'Carriers &amp; owner-operators', 'A dedicated dispatcher, the verified board, GPS proof, documents and settlements in one app. Flat 5% of line-haul, only at delivery.', 'carriers.html', 'For carriers', ''),
     ('&#129333;', 'Drivers', 'Driver mode inside the same app: the owner invites you, picks your permissions, and your trips, GPS and PODs run from your phone.', 'apps.html', 'The carrier app', 'Free'),
     ('&#128222;', 'Dispatchers', 'Remote US-hours seats with a mailbox, softphone and a workspace built for the job. Screened, tested, trialled &mdash; then paid by LoadBoot.', 'careers.html', 'Become a dispatcher', ''),
     ('&#127970;', 'Freight brokers', 'Post loads free with the rate card in writing, cover them with verified, health-scored carriers, watch live GPS, settle with receipts.', 'brokers.html', 'For brokers', 'Free'),
     ('&#129309;', 'Broker agents', 'No MC of your own? Post under the brokerage that confirmed you &mdash; or several. Each posting shows whose authority it is under.', 'broker-agents.html', 'For broker agents', 'Free'),
     ('&#127981;', 'Shippers &amp; facilities', 'Request freight, schedule docks, get geofenced proof at your own doors. Moves under licensed brokerage where the law requires it.', 'shipper-solutions.html', 'For shippers', 'Free'),
     ('&#128227;', 'Referral partners', 'Bring carriers, brokers or shippers with one link and earn 1% of gross on every delivered load they move &mdash; paid from LoadBoot&rsquo;s own fee.', 'agents.html', 'Referral program', 'Free'),
     ('&#128104;&#8205;&#128187;', 'Developers &amp; TMS', 'API keys, webhooks and inbound load posting so your TMS and LoadBoot speak the same language.', 'integrations.html', 'Integrations &amp; API', 'Free'),
    ]
    cards = ''.join('<a class="dos-role reveal" href="%s"><div class="ic">%s</div><b>%s%s</b><p>%s</p><small>%s &rarr;</small></a>'
                    % (h, ic, t, ('<span class="free">%s</span>' % f) if f else '', d, lab) for ic, t, d, h, lab, f in roles)
    return ('<section><div class="wrap dos-wrap">' + _head('Who the operating system serves', 'Every seat in freight, on the same verified record',
            'Eight roles, one truth. The carrier, the driver, the dispatcher, the broker, the broker&rsquo;s agent, the shipper, the referral partner and the developer each see their own screen of the same load.') +
            '<div class="dos-roles">%s</div></div></section>' % cards)

# ---------------------------------------------------------------------------------------------
def dos_who(equipment=None):
    eq = (equipment + ' ') if equipment else ''
    d = ['Works your lanes on DAT, Truckstop, 123Loadboard, broker networks, direct shippers and the LoadBoot board',
         'Negotiates every rate to your floor &mdash; never below it',
         'Logs each booking with the rate confirmation attached',
         'Plans the reload off your drop to cut deadhead',
         'Makes the check calls, chases the paperwork, handles exceptions',
         'Answers on the LoadBoot line and mailbox, business hours ET, on call while you are loaded']
    p = ['Verifies you, the broker and the shipper against FMCSA &middot; <a href="compliance.html">how</a>',
         'Matches you to one dispatcher by hand, within 3 business days',
         'Approves every rate confirmation before the truck moves',
         'Tracks the trip by phone or ELD, stamps the geofence, drafts detention and TONU &middot; <a href="gps-tracking.html">proof</a>',
         'Holds your documents, reminds you before anything expires',
         'Runs the ledger: invoice, factoring NOA, settlement, one receipt per trip &middot; <a href="payments-settlements.html">money</a>']
    y = ['Keep your authority, insurance and broker relationships',
         'Confirm you are empty (one tap) so nobody books a truck that is not free',
         'Approve every load against your floor rate &mdash; nothing books without you',
         'Drive, deliver, upload the POD from the app',
         'Get paid directly by the broker or your factor',
         'Pay a flat 5% of line-haul at delivery &mdash; pause or switch any time']
    li = lambda items, w: ''.join('<li>%s<span>%s</span></li>' % (w, x) for x in items)
    return ('<section><div class="wrap dos-wrap">' + _head('Who does what', 'Your dispatcher, the platform, and you',
            'The reason %sdispatch works here is that three parties each do the part they are best at &mdash; and none of them can skip the others.' % eq) +
            '<div class="dos-who">'
            '<div class="dos-col d reveal"><div class="t"><span>&#128222;</span>Your dispatcher does</div><div class="s">A LoadBoot-vetted contractor, dedicated to your truck</div><ul>%s</ul></div>'
            '<div class="dos-col reveal d1"><div class="t"><span>&#9881;&#65039;</span>The platform &amp; desk do</div><div class="s">Software prepares; a person approves anything that moves status or money</div><ul>%s</ul></div>'
            '<div class="dos-col reveal d2"><div class="t"><span>&#128666;</span>You do</div><div class="s">The part nobody can do for you</div><ul>%s</ul></div>'
            '</div></div></section>') % (li(d, _CHKW), li(p, _CHK), li(y, _CHK))

# ---------------------------------------------------------------------------------------------
# NEW PAGES
# ---------------------------------------------------------------------------------------------
def _faq_html(items, h2='Questions carriers ask'):
    rows = ''.join('<details class="reveal" style="background:#fff;border:1px solid #e6ebf3;border-radius:14px;padding:16px 20px;margin-bottom:10px"%s><summary style="font-weight:700;color:#10223B;cursor:pointer">%s</summary><p style="color:#475569;line-height:1.75;margin:10px 0 0">%s</p></details>' % (' open' if i == 0 else '', q, a) for i, (q, a) in enumerate(items))
    sch = ('<script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[' +
           ','.join('{"@type":"Question","name":"%s","acceptedAnswer":{"@type":"Answer","text":"%s"}}' % (q.replace('"', "'"), _plain(a).replace('"', "'")) for q, a in items) + ']}</script>')
    html = '<section class="bg-soft"><div class="wrap dos-wrap"><div class="sec-head center reveal"><div class="eyebrow">Questions</div><h2>%s</h2></div><div style="max-width:820px;margin:0 auto">%s</div></div></section>' % (h2, rows)
    return html, sch

def _plain(s):
    import re as _r
    return _r.sub(r'<[^>]+>', '', s).replace('&rsquo;', "'").replace('&mdash;', '-').replace('&amp;', '&').replace('&middot;', '.')

def _hero(kicker, h1, lead, cta=('carrier-application.html', 'Apply as a carrier'), cta2=('how-loadboot-dispatch-works.html', 'How dispatch works'), chips=()):
    ch = ''.join('<span style="background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.15);border-radius:12px;padding:9px 13px;font-size:.84rem;color:#e2e8f0"><b style="color:#7cc0ff;display:block;font-size:1.02rem">%s</b>%s</span>' % (a, b) for a, b in chips)
    return ('<section style="background:linear-gradient(135deg,#0b1220 0%%,#10223B 45%%,#14335c 100%%);color:#fff;padding:72px 0 54px;position:relative;overflow:hidden">'
            '<div class="wrap dos-wrap" style="position:relative">'
            '<div class="dos-eyebrow reveal" style="color:#9ed1ff"><i></i>%s</div>'
            '<h1 class="reveal d1" style="color:#fff;font-size:clamp(1.9rem,4.2vw,3.1rem);line-height:1.1;letter-spacing:-.02em;margin:12px 0 14px;max-width:22ch">%s</h1>'
            '<p class="reveal d2" style="color:#c7d5ea;font-size:1.08rem;line-height:1.7;max-width:60ch">%s</p>'
            '%s'
            '<div class="reveal d3" style="display:flex;gap:12px;flex-wrap:wrap;margin-top:24px"><a href="%s" class="btn btn-primary">%s &rarr;</a><a href="%s" class="btn btn-secondary" style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25)">%s</a></div>'
            '</div></section>') % (kicker, h1, lead, ('<div class="reveal d2" style="display:flex;flex-wrap:wrap;gap:10px;margin-top:22px">%s</div>' % ch) if ch else '', cta[0], cta[1], cta2[0], cta2[1])

def _article_schema(fname, h1, desc, pub='2026-09-25'):
    e = lambda s: _plain(s).replace('"', "'")
    return ('<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"%s","description":"%s","image":"https://loadboot.com/og-image.png",'
            '"author":{"@type":"Organization","name":"LoadBoot","url":"https://loadboot.com/"},"publisher":{"@type":"Organization","name":"LoadBoot","logo":{"@type":"ImageObject","url":"https://loadboot.com/icon-512.png"}},'
            '"datePublished":"%s","dateModified":"%s","mainEntityOfPage":"https://loadboot.com/%s"}</script>') % (e(h1), e(desc), pub, pub, fname)

def _service_schema(fname, name, stype, desc):
    e = lambda s: _plain(s).replace('"', "'")
    return ('<script type="application/ld+json">{"@context":"https://schema.org","@type":"Service","serviceType":"%s","name":"%s","description":"%s",'
            '"provider":{"@type":"Organization","name":"LoadBoot","url":"https://loadboot.com/"},"areaServed":{"@type":"Country","name":"United States"},'
            '"offers":{"@type":"Offer","description":"Flat 5%% of gross line-haul on loads booked through the dispatcher and delivered. No setup fee, no monthly fee, no long-term contract.","priceCurrency":"USD"},'
            '"url":"https://loadboot.com/%s"}</script>') % (stype, e(name), e(desc), fname)

def _cta(h2, p, href='carrier-application.html', label='Apply as a carrier', href2='contact.html#call', label2='Talk to the desk first'):
    return ('<section style="background:linear-gradient(135deg,#0b1220,#12304f);color:#fff;padding:56px 0"><div class="wrap dos-wrap" style="text-align:center">'
            '<h2 class="reveal" style="color:#fff;font-size:1.9rem;max-width:26ch;margin:0 auto 12px">%s</h2><p class="reveal" style="color:#cbd5e1;max-width:60ch;margin:0 auto 22px;line-height:1.7">%s</p>'
            '<div class="reveal" style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center"><a href="%s" class="btn btn-primary">%s &rarr;</a><a href="%s" class="btn btn-secondary" style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25)">%s</a></div>'
            '</div></section>') % (h2, p, href, label, href2, label2)

def _prose(h2, *paras, **kw):
    anchor = kw.get('id', '')
    return ('<section%s><div class="wrap dos-wrap"><div class="reveal" style="max-width:820px;margin:0 auto"><h2 class="dos-h2">%s</h2>%s</div></div></section>'
            % ((' id="%s"' % anchor) if anchor else '', h2, ''.join('<p style="color:#475569;line-height:1.75;font-size:1.02rem;margin:0 0 14px">%s</p>' % p for p in paras)))

# ---- 1. how-loadboot-dispatch-works.html --------------------------------------------------------
def _page_how():
    fname = 'how-loadboot-dispatch-works.html'
    title = 'How LoadBoot Truck Dispatch Works, A to Z — Dedicated Dispatcher, Two Approvals, Paid Direct | LoadBoot'
    desc = 'How a LoadBoot truck dispatcher works for an owner-operator, step by step: verification, hand-matched dedicated dispatcher within 3 business days, the test they pass, two approvals on every rate con, GPS proof, direct payment and a flat 5% at delivery.'
    h1 = 'How LoadBoot truck dispatch works &mdash; the whole loop, A to Z'
    body = DOS_CSS + _hero('The operating system, explained like a friend would',
        h1,
        'Most dispatch companies say &ldquo;we book, you drive.&rdquo; That sentence hides everything that matters: who the dispatcher is, who checks them, who approves the rate con, who holds your money, and what happens when you want out. Here is every step, with the mechanism behind it.',
        chips=(('3 business days', 'to a dedicated dispatcher'), ('2 approvals', 'on every rate confirmation'), ('5% of line-haul', 'earned at delivery, nothing else'), ('30 days', 'notice &mdash; no long-term contract')))
    # anchored full steps: add ids by wrapping each row (dos_steps full does not know ids) -> build here with ids
    rows = ''
    for i, (who, t, s, l, proof) in enumerate(STEPS):
        lab, cls = _WHO_LABEL[who]
        pl = ''.join('<li><a href="%s">%s &rarr;</a></li>' % (h, x) for h, x in proof)
        rows += ('<div class="dos-row reveal" id="step-%d"><div class="big">%d</div><div><span class="who %s">%s</span><h3>%s</h3><p>%s</p></div>'
                 '<div class="dos-proof"><b>What backs this step</b><ul>%s</ul></div></div>') % (i + 1, i + 1, cls, lab, t, l, pl)
    body += ('<section><div class="wrap dos-wrap">' + _head('The eight steps', 'From &ldquo;I have a truck&rdquo; to &ldquo;I got paid&rdquo; &mdash; and back again',
             'Blue tags are your moves. Orange tags are LoadBoot&rsquo;s desk and your dispatcher. Green is the software doing what software should.') +
             '<div style="margin-top:26px">%s</div>' % rows +
             '<div class="dos-note reveal">One thing you will not find above: a promise about how many loads you will get, or how fast. Freight markets move, and anyone guaranteeing volume is hiding a contract, forced dispatch or a shaved rate. What we guarantee is what we control &mdash; the rate in writing, the approvals, the evidence, the money path, and your freedom to leave.</div>'
             '</div></section>')
    body += dos_who()
    body += dos_layers()
    body += ('<section><div class="wrap dos-wrap">' + _head('What LoadBoot is, and is not', 'Not a broker. Not a factor. Not a freelancer directory.',
             'Three lines that keep every load on this platform clean under FMCSA guidance and keep your money where it belongs.') +
             '<div class="grid g3 reveal" style="margin-top:26px">'
             '<div class="card"><div class="icon">&#9878;&#65039;</div><h3>Not a freight broker</h3><p>Your dispatcher books under your authority as your bona fide agent (88 FR 39368). We never take one load and choose between carriers &mdash; that would be brokering. Where broker authority is legally required, freight moves through licensed broker partners. <a href="truck-dispatcher-vs-freight-broker.html">Dispatcher vs broker</a>.</p></div>'
             '<div class="card"><div class="icon">&#127974;</div><h3>Not a factor or a bank</h3><p>Brokers pay you or your factoring company directly. LoadBoot runs the ledger, the deadlines and the receipts around the money &mdash; it never holds it. <a href="factoring-noa.html">How factoring routes</a>.</p></div>'
             '<div class="card"><div class="icon">&#128101;</div><h3>Not a freelancer marketplace</h3><p>You do not scroll profiles and hope. LoadBoot screens, tests, trials, assigns, supervises and pays the dispatcher. If it goes wrong, you pause or switch &mdash; and it is our problem to fix, not yours to re-hire. <a href="dedicated-truck-dispatcher.html">Why dedicated</a>.</p></div>'
             '</div></div></section>')
    faq = [
     ('Who is my LoadBoot dispatcher &mdash; an employee, a freelancer, or LoadBoot itself?', 'A LoadBoot-vetted contractor, assigned to your truck by our Command Center and paid by LoadBoot. Not a freelancer you find on a directory, and not a call centre. They work remotely on US Eastern business hours, on a LoadBoot phone line and mailbox, and they are supervised by our desk &mdash; every rate confirmation they log is approved by LoadBoot before it becomes a booked load.'),
     ('How long until I have a dispatcher?', 'Our standing promise is an assignment within 3 business days of your approval. If we run late, your Dispatcher tab shows the reason (new authority, documents pending, dispatcher capacity) instead of silence, and you can call the desk.'),
     ('Do I have to use the dispatcher, or can I book loads myself?', 'Both. The verified load board is yours to browse and request loads from at any time. Your dispatcher works alongside that, and only while you have confirmed you are empty in the last 24 hours.'),
     ('What does it cost, exactly?', 'A flat 5% of gross line-haul on loads booked through your dispatcher and delivered, invoiced after delivery on Net-30. Fuel surcharge, detention, TONU, layover and lumper are 100% yours. No setup fee, no monthly fee, no long-term contract. See <a href="pricing.html">pricing</a>.'),
     ('Does LoadBoot touch my money?', 'No. The broker or your factor pays you directly, bank to bank. LoadBoot bills its own fee separately and runs the ledger and receipts around the freight money without holding it.'),
     ('Can I switch dispatchers?', 'Yes &mdash; from the Dispatcher tab in your app: Pause, or Ask for a different dispatcher. The desk reviews and reassigns. Leaving altogether is 30 days&rsquo; written notice; booked loads finish under the agreement.'),
     ('Is the dispatch desk 24/7?', 'The dispatch desk works US business hours and is on call while your load is moving. Riley, our AI front desk, answers the phone 24/7 and routes anything urgent. Live chat can open your account and check your documents at any hour.'),
     ('How is the dispatcher tested?', 'Screening, a timed 18-question exam covering compliance, negotiation and load sourcing with hard compliance gates, a recorded voice negotiation drill, and a 10-working-day paid trial on real trucks with KPIs (loads per truck per week, rates above the floor, rate cons attached, check calls, zero dispatcher-caused cancellations). Only then are they verified.'),
    ]
    fh, fs = _faq_html(faq)
    body += fh + _cta('Want this on your truck?', 'Five minutes to apply. A dedicated dispatcher within 3 business days. Flat 5% of line-haul, only when a load delivers &mdash; and the door is never locked.')
    schema = _article_schema(fname, h1, desc) + fs
    return fname, title, desc, body, schema

# ---- 2. dedicated-truck-dispatcher.html ---------------------------------------------------------
def _page_dedicated():
    fname = 'dedicated-truck-dispatcher.html'
    title = 'Dedicated Truck Dispatcher for Owner-Operators — Vetted, Hand-Matched, Flat 5% | LoadBoot'
    desc = 'Find a dedicated truck dispatcher: one LoadBoot-vetted dispatcher assigned to your truck within 3 business days, booking under your authority, supervised by our desk. Flat 5% of line-haul at delivery, pause or switch any time.'
    h1 = 'A dedicated truck dispatcher &mdash; vetted by us, assigned to you, answerable to both'
    body = DOS_CSS + _hero('Find a truck dispatcher, without the roulette', h1,
        'Searching &ldquo;find a truck dispatcher&rdquo; gets you three things: freelancers with a Facebook page, call centres that put twenty trucks on one seat, and dispatch companies that say &ldquo;dedicated&rdquo; and mean &ldquo;whoever answers.&rdquo; Here is what dedicated means on LoadBoot, and what it costs.',
        chips=(('1 dispatcher', 'per carrier &mdash; enforced, not promised'), ('Fixed truck count', 'per dispatcher'), ('Tested + trialled', 'before they touch a load'), ('Pause / switch', 'from your app')))
    body += ('<section><div class="wrap dos-wrap">' + _head('What dedicated means here', 'Five things a &ldquo;dedicated dispatcher&rdquo; must actually mean',
             'If a dispatch service cannot show you each of these, the word is decoration.') +
             '<div class="grid g3 reveal" style="margin-top:26px">'
             '<div class="card"><div class="icon">&#128100;</div><h3>One name, not a queue</h3><p>One active dispatcher per carrier &mdash; the system does not allow a second. You know who works your truck, on a LoadBoot line and mailbox that are yours to call.</p></div>'
             '<div class="card"><div class="icon">&#128203;</div><h3>A written brief for your truck</h3><p>Before assignment, our desk writes your SOP: scope, lanes, floor rate, equipment, home time. Your dispatcher books inside it and LoadBoot checks every rate con against it.</p></div>'
             '<div class="card"><div class="icon">&#9878;&#65039;</div><h3>A fixed truck count</h3><p>Every LoadBoot dispatcher carries a set number of trucks (roughly 5&ndash;8 to start). Twenty trucks on one seat is how &ldquo;dedicated&rdquo; dies.</p></div>'
             '<div class="card"><div class="icon">&#128202;</div><h3>Measured, every week</h3><p>Loads per truck, rate vs your floor, rate cons attached, check calls, cancellations. Dispatcher KPIs are computed from the platform, not from a mood.</p></div>'
             '<div class="card"><div class="icon">&#128260;</div><h3>Replaceable by you</h3><p>Pause, or ask for a different dispatcher, in one tap. Our desk reassigns. You never have to fire anyone or re-hire &mdash; that is our job.</p></div>'
             '<div class="card"><div class="icon">&#128176;</div><h3>Paid by us, not by you</h3><p>Your dispatcher&rsquo;s pay comes out of LoadBoot&rsquo;s side of the 5%. It is never added to your invoice and never negotiated with you.</p></div>'
             '</div></div></section>')
    body += dos_steps('short', eyebrow='How you get one', h2='From application to an assigned dispatcher &mdash; eight steps', lead='The same loop every LoadBoot carrier goes through. Tap a step for the mechanism behind it.')
    body += ('<section class="bg-soft"><div class="wrap dos-wrap">' + _head('Compare', 'Freelancer, call-centre agency, or a LoadBoot dedicated dispatcher',
             'The honest version of the table every dispatch company publishes.') +
             '<div class="dos-cmp-wrap reveal"><table class="dos-cmp"><thead><tr><th>What matters</th><th>Freelance dispatcher</th><th>Typical dispatch company</th><th class="us">LoadBoot dedicated dispatcher</th></tr></thead><tbody>'
             '<tr><td>Who vets them</td><td>You do, from a chat</td><td>Varies; rarely shown</td><td class="us">LoadBoot: screening, timed exam, voice drill, 10-day trial with KPIs</td></tr>'
             '<tr><td>How many trucks they run</td><td>Unknown</td><td>Often 15&ndash;30 per seat</td><td class="us">Fixed count per dispatcher; one dispatcher per carrier, enforced</td></tr>'
             '<tr><td>Who approves the rate con</td><td>Them, sometimes you</td><td>Them</td><td class="us">You (against your floor) and LoadBoot&rsquo;s desk &mdash; two approvals, every load</td></tr>'
             '<tr><td>Who they work for</td><td>Several carriers, their own terms</td><td>The agency</td><td class="us">Your agent under your authority (88 FR 39368); a LoadBoot contractor you never pay</td></tr>'
             '<tr><td>Tracking &amp; proof</td><td>Check calls</td><td>Check calls, maybe a tracking link</td><td class="us">Phone or ELD GPS, geofenced stamps, detention and TONU drafted from evidence</td></tr>'
             '<tr><td>Cost</td><td>5&ndash;10% or a flat weekly fee, often on gross</td><td>5&ndash;10%, setup fees common</td><td class="us">Flat 5% of line-haul at delivery; accessorials 100% yours; no setup or monthly fee</td></tr>'
             '<tr><td>Leaving</td><td>Stop paying</td><td>Contract terms</td><td class="us">Pause or switch in-app; 30 days&rsquo; notice to leave</td></tr>'
             '</tbody></table></div>'
             '<p class="reveal" style="color:#64748b;font-size:.85rem;margin-top:14px;max-width:820px">Freelancer and agency columns describe common market practice, not any named company; fee ranges are the ones carriers report and the ones dispatch companies publish. Your dispatcher&rsquo;s own pay terms are between them and LoadBoot.</p>'
             '</div></section>')
    body += dos_who()
    faq = [
     ('How do I find a good truck dispatcher?', 'Ask four questions: who tested them, how many trucks they run, who approves the rate confirmation, and how you leave. On LoadBoot the answers are: we did (exam, voice drill, trial); a fixed count, one per carrier; you and our desk, every load; pause or switch in-app, 30 days&rsquo; notice.'),
     ('Can I pick my own dispatcher?', 'You do not scroll profiles. Our desk matches you by hand from your SOP &mdash; lanes, equipment, floor rate, home time &mdash; and assigns one dispatcher within 3 business days. If it is not working, ask for a different one from your app and we reassign.'),
     ('Is a dedicated dispatcher worth 5% for one truck?', 'Only if they book above your floor and cut deadhead more than the fee costs. That is why nothing books without your approval, why your floor is written into the SOP, and why there is no fee on weeks you do not run. Run the numbers with the <a href="cost-per-mile-calculator.html">cost-per-mile calculator</a> and the <a href="how-much-does-a-truck-dispatcher-cost.html">dispatcher cost guide</a>.'),
     ('Where is the dispatcher located?', 'LoadBoot dispatchers work remotely on US Eastern business hours, on a LoadBoot phone line and @loadboot.com mailbox issued to them, inside a workspace our desk supervises. Your dispatcher&rsquo;s contact is released to you by compliance once assigned.'),
     ('Do they use my DAT or Truckstop login?', 'No. They source from their own board access, broker e-mail networks, direct shippers and the LoadBoot board. Your logins stay yours.'),
     ('What if my dispatcher books a bad load?', 'They cannot book without your approval, and LoadBoot approves every rate con against your SOP before the truck moves. Dispatcher-caused cancellations are a KPI that ends trials and assignments.'),
    ]
    fh, fs = _faq_html(faq)
    body += fh + _cta('Get a dedicated dispatcher on your truck', 'Apply in five minutes. Our desk matches you by hand within 3 business days. Flat 5% of line-haul, only when a load delivers.')
    schema = _service_schema(fname, 'LoadBoot dedicated truck dispatcher', 'Dedicated truck dispatch service', desc) + fs
    return fname, title, desc, body, schema

# ---- 3. ai-dispatch-for-owner-operators.html ----------------------------------------------------
def _page_ai():
    fname = 'ai-dispatch-for-owner-operators.html'
    title = 'AI Truck Dispatch for Owner-Operators — What AI Does Here, and What a Human Dispatcher Still Does | LoadBoot'
    desc = 'AI dispatch for trucking, honestly scoped: at LoadBoot AI reads your documents, parses rate confirmations, answers the phone 24/7 and onboards you in chat; a vetted human dispatcher still finds and negotiates your loads. How the two fit together.'
    h1 = 'AI truck dispatch, honestly: what the AI does here, and what a human still does'
    body = DOS_CSS + _hero('AI dispatch for trucking', h1,
        '&ldquo;AI dispatcher&rdquo; is the new banner on half the load-board apps. Some of it is real, some of it is a chatbot with a truck emoji. LoadBoot runs AI on the parts of dispatch that are pattern work, and keeps a tested human on the parts that are judgement and relationship. Here is the exact split.',
        chips=(('24/7', 'Riley answers the phone'), ('Seconds', 'to pre-check a COI or W-9'), ('Every rate con', 'parsed, then human-approved'), ('1 human', 'dedicated dispatcher on your truck')))
    body += ('<section><div class="wrap dos-wrap">' + _head('What AI actually does on LoadBoot', 'Five jobs the software does better than a person at 2 a.m.', '') +
             '<div class="grid g3 reveal" style="margin-top:26px">'
             '<div class="card"><div class="icon">&#128196;</div><h3>Reads your documents on upload</h3><p>COI, W-9, authority letters: an AI pre-check flags what is missing or expiring in seconds, before a human reviews it and before it costs you a load. <a href="compliance.html">Compliance hub</a>.</p></div>'
             '<div class="card"><div class="icon">&#129518;</div><h3>Parses every rate confirmation</h3><p>The rate con your dispatcher attaches is read by AI &mdash; lane, dates, rate, accessorial terms &mdash; so the desk approves against your SOP fast, and the trip is created with the right pins for the geofence.</p></div>'
             '<div class="card"><div class="icon">&#128222;</div><h3>Answers the phone 24/7</h3><p>Riley, our AI front desk, picks up every call, answers what it can, takes the rest for the desk, and steps in when a dispatcher cannot pick up. <a href="contact.html">Contact</a>.</p></div>'
             '<div class="card"><div class="icon">&#128172;</div><h3>Opens your account in chat</h3><p>Say &ldquo;set me up&rdquo; in the chat bubble: MC lookup, FMCSA card, document check, W-9 and dispatch agreement e-signed in the thread &mdash; English or Spanish. <a href="how-it-works.html">How it works</a>.</p></div>'
             '<div class="card"><div class="icon">&#128202;</div><h3>Scores loads and lanes</h3><p>Load Score turns a posting into TAKE, NEGOTIATE or PASS from your own cost per mile; market rates and your account health score are computed, not guessed. <a href="load-score.html">Load Score</a>.</p></div>'
             '<div class="card"><div class="icon">&#9201;&#65039;</div><h3>Drafts detention and TONU claims</h3><p>Geofenced arrive/depart stamps start the clock; a claim drafts itself with the evidence attached. <a href="detention-pay-policy.html">Detention policy</a>.</p></div>'
             '</div></div></section>')
    body += ('<section class="bg-soft"><div class="wrap dos-wrap">' + _head('What stays human', 'Four jobs we will not hand to a model',
             'Not because we cannot build it &mdash; because the mistakes are expensive and yours.') +
             '<div class="grid g2 reveal" style="margin-top:26px">'
             '<div class="card"><div class="icon">&#128100;</div><h3>Finding and negotiating your loads</h3><p>A LoadBoot-vetted dispatcher works the boards, the broker relationships and the direct shippers, negotiates to your floor and never below it, and plans your reload. AI recommends; a person books. <a href="dedicated-truck-dispatcher.html">Dedicated dispatcher</a>.</p></div>'
             '<div class="card"><div class="icon">&#9989;</div><h3>Approving the rate confirmation</h3><p>You approve every load against your floor. Then LoadBoot&rsquo;s desk approves the rate con against your SOP before the truck moves. Two humans, every time.</p></div>'
             '<div class="card"><div class="icon">&#128176;</div><h3>Anything that moves money</h3><p>Software prepares every settlement, payout and fee; a person signs it off. The maker and the checker are never the same account. <a href="payments-settlements.html">Payments</a>.</p></div>'
             '<div class="card"><div class="icon">&#128221;</div><h3>Final document decisions</h3><p>AI pre-checks; a compliance reviewer decides. A model can read a COI, but a person carries the responsibility for saying your truck is ready.</p></div>'
             '</div></div></section>')
    body += dos_steps('short', eyebrow='Where AI sits in the loop', h2='The eight steps, with the AI marked in', lead='Steps 1, 5 and 6 are where AI does the heavy reading; every other step has a person accountable for it.')
    faq = [
     ('Is LoadBoot an AI dispatcher?', 'No. LoadBoot is a platform with AI in it and a human dispatcher on your truck. AI reads documents, parses rate cons, answers the phone and scores loads. A vetted human dispatcher finds and negotiates your freight, and two humans approve every booking.'),
     ('Can AI book loads for me automatically?', 'Not on LoadBoot, on purpose. Nothing books without your approval, and every rate confirmation is approved by our desk before the truck moves. Auto-booking sounds efficient until the first load that is $400 below your floor.'),
     ('Is Riley a real person?', 'Riley is our AI front desk on the phone. It says so. It answers 24/7, takes messages for the dispatch desk, and steps in when a dispatcher cannot pick up. The dispatch desk itself is people, on US business hours and on call while your load is moving.'),
     ('Does the AI see my documents?', 'Your uploads are pre-checked by a document model and then reviewed by LoadBoot compliance staff. They are stored in your vault with expiry tracking; see the <a href="privacy.html">privacy policy</a> for how data is handled.'),
    ]
    fh, fs = _faq_html(faq)
    body += fh + _cta('AI where it helps. A person where it counts.', 'Apply in five minutes; your documents are checked before you finish typing. A dedicated human dispatcher follows within 3 business days.')
    schema = _article_schema(fname, h1, desc) + fs
    return fname, title, desc, body, schema

# ---- 4. truck-dispatcher-vs-dispatch-software.html ----------------------------------------------
def _page_vs():
    fname = 'truck-dispatcher-vs-dispatch-software.html'
    title = 'Truck Dispatcher vs Dispatch Software (TMS) for Owner-Operators — Which One Do You Need? | LoadBoot'
    desc = 'Truck dispatcher vs dispatch software: what a TMS for owner-operators does, what a human dispatcher does, what each costs, and why LoadBoot puts both on one platform at a flat 5% of line-haul with no software fee.'
    h1 = 'Truck dispatcher vs dispatch software: which one does an owner-operator actually need?'
    body = DOS_CSS + _hero('Dispatcher, TMS, or both', h1,
        'A TMS for owner-operators costs $30&ndash;$150 a month and gives you screens. A dispatcher costs 5&ndash;10% and gives you loads. Most one-truck carriers end up paying for both and using half of each. This page lays out what each one does, what it costs, and how LoadBoot collapses the two.',
        cta2=('pricing.html', 'See pricing'),
        chips=(('$0', 'software fee on LoadBoot'), ('5%', 'of line-haul, at delivery'), ('1', 'login for dispatch, docs, GPS, money')))
    body += ('<section><div class="wrap dos-wrap">' + _head('Side by side', 'What each one does for a one-truck carrier', '') +
             '<div class="dos-cmp-wrap reveal"><table class="dos-cmp"><thead><tr><th>Job</th><th>Dispatch software / TMS</th><th>Human dispatcher</th><th class="us">LoadBoot (both, one platform)</th></tr></thead><tbody>'
             '<tr><td>Finding loads</td><td>Load-board integrations; you search</td><td>They search, call, negotiate</td><td class="us">Dedicated dispatcher sources; verified board for you to browse</td></tr>'
             '<tr><td>Negotiating the rate</td><td>No</td><td>Yes, to your floor if they are good</td><td class="us">Yes, to a floor written in your SOP; you approve every load</td></tr>'
             '<tr><td>Rate confirmation</td><td>You upload it</td><td>They send it to you</td><td class="us">Parsed by AI, approved by you and by our desk</td></tr>'
             '<tr><td>Tracking &amp; detention proof</td><td>Sometimes, with an ELD contract</td><td>Check calls</td><td class="us">Phone or ELD GPS, geofenced stamps, claims drafted from evidence</td></tr>'
             '<tr><td>Documents &amp; compliance</td><td>Folders and reminders</td><td>They chase paperwork</td><td class="us">Vault with AI pre-check, expiry reminders, human review</td></tr>'
             '<tr><td>Invoicing &amp; settlements</td><td>Templates; QuickBooks export</td><td>Rarely</td><td class="us">Ledger, factoring NOA routing, one receipt per trip, QuickBooks</td></tr>'
             '<tr><td>Cost</td><td>$30&ndash;$150 / month, per seat, always</td><td>5&ndash;10% of gross, sometimes setup fees</td><td class="us">Flat 5% of line-haul at delivery; $0 on weeks you do not run; no software fee</td></tr>'
             '<tr><td>When it fails</td><td>You stop using it and keep paying</td><td>They vanish when a load goes wrong</td><td class="us">Pause or switch dispatcher in-app; 30 days&rsquo; notice to leave</td></tr>'
             '</tbody></table></div>'
             '<p class="reveal" style="color:#64748b;font-size:.85rem;margin-top:14px;max-width:820px">TMS price range reflects published owner-operator plans across the category in 2026; dispatcher fee range is what carriers report and dispatch companies publish. Neither column names a specific vendor.</p>'
             '</div></section>')
    body += _prose('When you only need software',
        'If you have your own broker relationships, enjoy working the board, and mainly need somewhere to keep rate cons, PODs and invoices straight, a TMS is the right buy &mdash; and on LoadBoot that part costs nothing: the board, the document vault, GPS tracking, settlements and QuickBooks sync are free to a carrier whether or not you ever use a dispatcher. <a href="features.html">Every feature</a>.')
    body += _prose('When you need a dispatcher',
        'If the board is eating your evenings, if you are new authority and brokers are not calling back, or if you run more than one truck and cannot be on the phone for all of them, a dispatcher pays for itself the first week they book above your floor. The catch with most dispatch services is everything this site is about: who they are, who checks them, who approves the rate con, and how you leave. <a href="how-loadboot-dispatch-works.html">How LoadBoot dispatch works, A to Z</a>.')
    body += dos_layers()
    faq = [
     ('What is the best TMS for owner-operators?', 'The one you will actually open. For a one-truck carrier the jobs that matter are documents, rate cons, tracking proof and invoicing. LoadBoot gives a carrier those for free, with a dispatcher available on the same login at a flat 5% of line-haul when you want one.'),
     ('Do I need dispatch software if I have a dispatcher?', 'You need the records: rate cons, GPS stamps, PODs, invoices. On LoadBoot the dispatcher and the records live on the same platform, so the question goes away.'),
     ('Is 5% cheaper than a TMS subscription?', 'They are different things. A TMS bills every month whether you run or not; LoadBoot bills 5% of line-haul only on loads your dispatcher books and you deliver, and nothing for the software. Run your own numbers with the <a href="cost-per-mile-calculator.html">cost-per-mile calculator</a>.'),
    ]
    fh, fs = _faq_html(faq)
    body += fh + _cta('Both, on one login', 'Create a carrier account in five minutes. Use the platform free; add a dedicated dispatcher whenever you want one.', href='create-carrier-account.html', label='Create a carrier account')
    schema = _article_schema(fname, h1, desc) + fs
    return fname, title, desc, body, schema

# ---- 5. broker-agents.html -----------------------------------------------------------------------
def _page_broker_agents():
    fname = 'broker-agents.html'
    title = 'Freight Broker Agents — Post Loads Under Your Brokerage, Free | LoadBoot'
    desc = 'For freight broker agents: post loads free under the brokerage that authorized you (or several), with the brokerage confirmed by FMCSA-listed email code or in-portal approval. Verified carriers, live GPS, documents and settlements on one platform.'
    h1 = 'Freight broker agents: post under the brokerage that authorized you &mdash; or several'
    body = DOS_CSS + _hero('For broker agents', h1,
        'You do not hold the MC; the brokerage does. Most boards make that awkward: shared logins, one brokerage per account, and nobody able to tell whose authority a load is really under. LoadBoot gives an agent one account, many confirmed brokerages, and a posting that always shows whose it is.',
        cta=('create-broker-account.html', 'Create a broker agent account'), cta2=('brokers.html', 'For brokerages'),
        chips=(('$0', 'to post, for agents and brokerages'), ('6-digit code', 'to the brokerage&rsquo;s FMCSA email'), ('Many', 'brokerages on one agent account')))
    body += ('<section><div class="wrap dos-wrap">' + _head('How authorization works', 'The brokerage confirms you. Then you post under it.',
             'Authorization is a record, not a screenshot. Every load you post carries the confirmed brokerage it is under.') +
             '<div class="grid g3 reveal" style="margin-top:26px">'
             '<div class="card"><div class="icon">1</div><h3>Choose Broker Agent at signup</h3><p>Company email, your name, and the MC or USDOT of the brokerage you work for. We screen that authority live on FMCSA the moment you type it. <a href="create-broker-account.html">The signup, step by step</a>.</p></div>'
             '<div class="card"><div class="icon">2</div><h3>The brokerage confirms you</h3><p>Either we e-mail the brokerage&rsquo;s FMCSA-listed address a 6-digit code and a confirm link and the brokerage hands you the code, or &mdash; if the brokerage is already on LoadBoot &mdash; its owner approves you under Agents &amp; team.</p></div>'
             '<div class="card"><div class="icon">3</div><h3>Post, tracked to the brokerage</h3><p>Every posting shows which brokerage it is under; each brokerage keeps its own posting allowance and its own trust tier. Add a second brokerage the same way. Revocation is one click for the brokerage owner.</p></div>'
             '</div></div></section>')
    body += ('<section class="bg-soft"><div class="wrap dos-wrap">' + _head('What you get', 'The same board brokerages get &mdash; free',
             'No subscription, no per-post fee, no per-seat fee. LoadBoot&rsquo;s only revenue is the flat 5% dispatch fee on the carrier side.') +
             '<div class="grid g3 reveal" style="margin-top:26px">'
             '<div class="card"><div class="icon">&#128203;</div><h3>Post with the rate card in writing</h3><p>Lane, dates, equipment, and detention / TONU / layover terms printed on the posting. Duplicates are caught. <a href="free-load-board-for-brokers.html">The free board</a>.</p></div>'
             '<div class="card"><div class="icon">&#128737;&#65039;</div><h3>Verified, health-scored carriers</h3><p>Authority checked against the federal record, insurance and account health tracked continuously; only carriers who pass hard eligibility for the lane see your load. <a href="compliance.html">Verification</a>.</p></div>'
             '<div class="card"><div class="icon">&#128752;&#65039;</div><h3>Live GPS and dock proof</h3><p>The assigned truck on the map, geofenced arrive/depart stamps, milestone timeline, document status &mdash; and webhooks to the brokerage&rsquo;s TMS. <a href="gps-tracking.html">Tracking</a>.</p></div>'
             '<div class="card"><div class="icon">&#9878;&#65039;</div><h3>Claims on evidence</h3><p>Detention, TONU and layover claims arrive GPS-stamped with the rate card they were agreed under. Approve facts, not phone arguments.</p></div>'
             '<div class="card"><div class="icon">&#129534;</div><h3>Payables per trip</h3><p>One receipt settles the trip; PAY-BY deadlines on both sides; the carrier or their factor confirms receipt. <a href="payments-settlements.html">Payables</a>.</p></div>'
             '<div class="card"><div class="icon">&#128101;</div><h3>Agents &amp; team, for the brokerage</h3><p>The brokerage owner sees every agent, every posting and every allowance under its authority, and can approve or revoke in the portal. <a href="brokers.html">For brokerages</a>.</p></div>'
             '</div></div></section>')
    body += _prose('Agent, broker, dispatcher: three different seats',
        'A <b>freight broker agent</b> arranges freight under a licensed brokerage&rsquo;s authority and bond &mdash; the brokerage is the principal. A <b>freight broker</b> holds the authority and the $75,000 bond. A <b>truck dispatcher</b> works for the carrier, under the carrier&rsquo;s authority, and is never the broker. LoadBoot keeps these seats separate on purpose: agents post under confirmed brokerages, brokerages keep their own identity and allowance, and LoadBoot dispatchers book for carriers only. <a href="freight-agent-vs-freight-broker.html">Freight agent vs freight broker</a> &middot; <a href="truck-dispatcher-vs-freight-broker.html">Dispatcher vs broker</a>.')
    faq = [
     ('Can I post loads on LoadBoot without my own MC?', 'Yes, as a broker agent under a brokerage that has confirmed you &mdash; by the 6-digit code we e-mail to the brokerage&rsquo;s FMCSA-listed address, or by its owner approving you in the portal. A carrier MC cannot post.'),
     ('Can one agent work under more than one brokerage?', 'Yes. One agent account, many confirmed brokerages. Every posting shows which brokerage it is under and each brokerage keeps its own posting allowance and trust tier.'),
     ('What does it cost the agent or the brokerage?', 'Nothing. Posting, matching, tracking, documents, claims and payables are free. LoadBoot&rsquo;s revenue is the flat 5% dispatch fee on the carrier side.'),
     ('Why is there a posting limit at first?', 'New brokerages start with 3 open postings and request-to-book. The allowance rises after the first delivered load and again once the verification packet (W-9, bank instructions, claims contact) is done. It keeps the board free of ghost postings without a wall of PDFs on day one.'),
     ('Is this the same as the referral partner program?', 'No. Referral partners bring people to LoadBoot and earn 1% of gross on the loads those people move. Broker agents arrange freight under a brokerage. Different seats, different portals; you can hold both.'),
    ]
    fh, fs = _faq_html(faq, h2='Questions broker agents ask')
    body += fh + _cta('Post under your brokerage, today', 'Create a broker agent account, enter the brokerage&rsquo;s MC, get the code from them, and you are posting to verified carriers.', href='create-broker-account.html', label='Create a broker agent account', href2='contact.html', label2='Ask the desk')
    schema = _service_schema(fname, 'LoadBoot free load board for broker agents', 'Freight load posting for broker agents', desc).replace('"offers":{"@type":"Offer","description":"Flat 5% of gross line-haul on loads booked through the dispatcher and delivered. No setup fee, no monthly fee, no long-term contract.","priceCurrency":"USD"}', '"offers":{"@type":"Offer","price":"0","priceCurrency":"USD","description":"Free to post, for agents and brokerages"}') + fs
    return fname, title, desc, body, schema

def dos_pages():
    return [_page_how(), _page_dedicated(), _page_ai(), _page_vs(), _page_broker_agents()]

# Related-link cards (deep linking; page() appends them before the footer)
DOS_RELATED = {
 'how-loadboot-dispatch-works.html': [('dedicated-truck-dispatcher.html','Dedicated Truck Dispatcher'),('services.html','All Dispatch Services'),('pricing.html','Pricing'),('how-much-does-a-truck-dispatcher-cost.html','What a Dispatcher Costs'),('truck-dispatcher-vs-freight-broker.html','Dispatcher vs Broker'),('owner-operator-dispatch.html','Owner-Operator Dispatch'),('carrier-application.html','Apply as Carrier'),('ai-dispatch-for-owner-operators.html','AI Dispatch for Owner-Operators'),('truck-dispatcher-vs-dispatch-software.html','Dispatcher vs Dispatch Software')],
 'dedicated-truck-dispatcher.html': [('how-loadboot-dispatch-works.html','How LoadBoot Dispatch Works'),('us-truck-dispatcher.html','US Truck Dispatcher'),('owner-operator-dispatch.html','Owner-Operator Dispatch'),('new-authority-dispatch.html','New Authority Dispatch'),('how-much-does-a-truck-dispatcher-cost.html','What a Dispatcher Costs'),('pricing.html','Pricing'),('carrier-application.html','Apply as Carrier'),('truck-dispatcher-in-texas.html','Texas Dispatch'),('truck-dispatcher-in-georgia.html','Georgia &amp; Southeast Dispatch'),('truck-dispatcher-in-california.html','California Dispatch')],
 'ai-dispatch-for-owner-operators.html': [('how-loadboot-dispatch-works.html','How LoadBoot Dispatch Works'),('truck-dispatcher-vs-dispatch-software.html','Dispatcher vs Dispatch Software'),('dedicated-truck-dispatcher.html','Dedicated Truck Dispatcher'),('load-score.html','Load Score Tool'),('gps-tracking.html','GPS Tracking &amp; Proof'),('compliance.html','Compliance &amp; Verification'),('features.html','All Features'),('carrier-application.html','Apply as Carrier')],
 'truck-dispatcher-vs-dispatch-software.html': [('how-loadboot-dispatch-works.html','How LoadBoot Dispatch Works'),('ai-dispatch-for-owner-operators.html','AI Dispatch for Owner-Operators'),('features.html','All Features'),('fleet-management.html','Fleet Management Software'),('integrations.html','QuickBooks &amp; ELD Integrations'),('how-much-does-a-truck-dispatcher-cost.html','What a Dispatcher Costs'),('pricing.html','Pricing'),('create-carrier-account.html','Create a Carrier Account')],
 'broker-agents.html': [('brokers.html','For Brokers'),('free-load-board-for-brokers.html','Free Load Board for Brokers'),('create-broker-account.html','Create a Broker Account'),('freight-agent-vs-freight-broker.html','Freight Agent vs Freight Broker'),('gps-tracking.html','GPS Tracking &amp; Proof'),('payments-settlements.html','Payments &amp; Settlements'),('agents.html','Referral Partner Program')],
}
