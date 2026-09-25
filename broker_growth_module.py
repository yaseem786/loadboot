# broker_growth_module.py — new-broker SEO cluster (13 Sep 2026).
# Pages that answer what a NEW freight broker searches for (authority granted, no plan yet).
# Rules: information, not customer claims; no invented prices or rate numbers; every LoadBoot
# claim is on the live site (brokers.html, free-load-board-for-brokers.html, create-broker-account.html).
# Consumed by build_site.py via BROKER_GROWTH_ARTICLES (rich_article kwargs) + BROKER_GROWTH_RELATED.

_CTA = ('<div class="cta-band" style="margin:28px 0;padding:22px 24px;border-radius:14px;background:#10223B;color:#fff">'
        '<div style="font-weight:800;font-size:1.15rem;margin-bottom:6px">Post your first load free</div>'
        '<div style="opacity:.85;margin-bottom:14px">Your broker MC and a live FMCSA authority check &mdash; no document packet, no subscription. Brokers are never billed; LoadBoot is funded by a flat 5% dispatch fee on the carrier side.</div>'
        '<a class="btn" href="create-broker-account.html" style="background:#0883F7;color:#fff;padding:12px 20px;border-radius:10px;font-weight:700;text-decoration:none;display:inline-block">Create a free broker account &rarr;</a></div>')

FBS_FEAT = ('<svg viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="fbsg" x1="0" y1="0" x2="1" y2="1">'
            '<stop offset="0" stop-color="#10223B"/><stop offset="1" stop-color="#0b1220"/></linearGradient></defs><rect width="400" height="200" fill="url(#fbsg)"/>'
            '<text x="24" y="50" font-family="Manrope,Arial" font-weight="800" font-size="22" fill="#fff">What a brokerage really pays for</text>'
            '<g font-family="Manrope,Arial" font-weight="700" font-size="14" fill="#94a3b8"><text x="24" y="92">TMS</text><text x="24" y="120">Carrier vetting</text><text x="24" y="148">Tracking</text><text x="24" y="176">Load board</text></g>'
            '<g><rect x="150" y="78" width="120" height="18" rx="4" fill="#64748b"/><rect x="150" y="106" width="150" height="18" rx="4" fill="#64748b"/><rect x="150" y="134" width="100" height="18" rx="4" fill="#64748b"/><rect x="150" y="162" width="130" height="18" rx="4" fill="#64748b"/></g>'
            '<text x="330" y="125" font-family="Manrope,Arial" font-weight="800" font-size="30" fill="#FC5305">4&times;</text></svg>')

FBS_TOC = [('stack', 'The four tools every brokerage ends up buying'),
           ('pricing', 'How broker software is actually priced'),
           ('hidden', 'The costs that never appear on the quote'),
           ('need', 'What a new brokerage needs in year one (and what it does not)'),
           ('free', 'Which parts of the stack can be free'),
           ('worksheet', 'A ten-minute cost worksheet'),
           ('honest', 'Where LoadBoot fits &mdash; and where it does not')]

FBS_BODY = (
'<p>Search for &ldquo;freight broker software&rdquo; and you get a wall of TMS vendors, each promising to run your whole brokerage. What none of the listings tell a new broker is that the TMS is only one of <em>four</em> subscriptions a working brokerage ends up paying for &mdash; and that the other three are where most of the monthly cost and most of the operational risk actually sit. This page lays out the full stack, how each piece is priced, what a brand-new authority genuinely needs in its first year, and which parts you can run at zero cost while you find your footing.</p>'
'<p>Nothing here quotes a vendor price. Software pricing changes every quarter, is negotiated per seat, and is almost never published honestly. What does not change is the <em>structure</em> of the bill, and once you see the structure you can price your own stack in ten minutes with the worksheet at the end.</p>'

'<h2 id="stack">The four tools every brokerage ends up buying</h2>'
'<p>A brokerage moves a load through five moments: a shipper hands you freight, you find a carrier you can trust with it, you agree a rate and paper it, you watch the truck until it delivers, and you invoice one side and pay the other. Established brokerages cover those five moments with four separate products, usually from four separate vendors:</p>'
'<ul>'
'<li><strong>A transportation management system (TMS).</strong> The system of record: customers, loads, rate confirmations, carrier payables, customer invoicing, reporting. Examples in the market are well known &mdash; every one of them charges per user, per month, and most add an onboarding or implementation fee.</li>'
'<li><strong>A carrier vetting or compliance service.</strong> Pulls FMCSA authority and safety data, tracks insurance certificates, flags identity mismatches and double-brokering patterns, and stores the carrier packet. Sold as a subscription, sometimes with a per-carrier-onboarded charge.</li>'
'<li><strong>A tracking or visibility platform.</strong> Gets a location from the driver&rsquo;s phone or the truck&rsquo;s ELD and shows it to you and your customer. Priced per load tracked, per month, or both &mdash; and the driver has to consent and install something.</li>'
'<li><strong>A load board.</strong> Where you post freight to find capacity and where carriers find you. Priced per seat per month, with the well-documented pattern of renewal increases and paid add-ons for the features that actually matter (see our <a href="load-board-subscription-cost.html">load board subscription cost breakdown</a>).</li>'
'</ul>'
'<p>Four products, four logins, four invoices, and &mdash; the part that hurts on a Friday afternoon &mdash; four places where the same load has to be typed in. A carrier vetted in one system is not automatically trusted in another. A load posted on the board is not automatically tracked by the visibility tool. The brokerage owner is the integration layer, and that layer is unpaid.</p>'

'<h2 id="pricing">How broker software is actually priced</h2>'
'<p>Across all four categories the same pricing mechanics repeat, and knowing them lets you read any quote correctly:</p>'
'<ul>'
'<li><strong>Per seat, per month.</strong> The headline number is for one user. A two-person brokerage doubles it before adding anything. Seats are rarely shareable by contract.</li>'
'<li><strong>Tiers that hide the feature you need.</strong> The entry tier is priced to appear in comparison tables. The feature a working broker uses daily &mdash; carrier search filters, tracking, document storage, API access &mdash; tends to sit one or two tiers up.</li>'
'<li><strong>Onboarding and implementation fees.</strong> Common with TMS vendors; charged once, non-refundable, and often the largest single line in year one.</li>'
'<li><strong>Annual contracts with renewal escalators.</strong> Month-to-month is usually offered at a premium; the discounted annual plan locks you in through the exact period when a new brokerage is most likely to change its mind about what it needs.</li>'
'<li><strong>Usage charges layered on subscriptions.</strong> Per load tracked, per carrier onboarded, per document parsed, per API call. Low at launch, meaningful once you are moving freight.</li>'
'</ul>'
'<p>The practical consequence: the quote you are shown in month one is a floor, not a ceiling. Most brokerages find their real software bill in month seven, when the seats, tiers, add-ons and usage charges have all settled in.</p>'

'<h2 id="hidden">The costs that never appear on the quote</h2>'
'<p>Three costs are larger than any subscription and appear on no invoice.</p>'
'<p><strong>Re-keying.</strong> Every time a load is typed into a second system, someone is paid to do it and a transcription error becomes possible. A rate confirmation with the wrong delivery date is not a software cost on paper; it is a claim, a lost customer, or both.</p>'
'<p><strong>The unvetted carrier.</strong> If the vetting service is the thing you skipped to save money, the cost arrives as a double-brokered load, a cargo claim on a carrier whose insurance had lapsed, or a truck that simply never shows up. One incident routinely exceeds a year of the subscription you avoided. Our guide to <a href="ghost-loads-load-board-problems.html">ghost loads and fake carriers</a> covers the failure modes.</p>'
'<p><strong>The check call.</strong> Without tracking, someone phones the driver &mdash; and the dispatcher, and the driver again &mdash; every few hours on every load. Multiply by the loads you run in a week and it is a salary, spent finding out what a phone in the cab already knew.</p>'

'<h2 id="need">What a new brokerage needs in year one (and what it does not)</h2>'
'<p>A brokerage with a fresh MC, a bond, and a handful of shippers does not have the problems a fifty-person brokerage has, and should not buy the software built for those problems. In the first year you need, in this order:</p>'
'<ol>'
'<li><strong>A way to trust a carrier you have never met.</strong> This is not optional and it is not a spreadsheet. Authority must be checked live, insurance must be on file and matched to the truck, and there must be a signed agreement before a load moves.</li>'
'<li><strong>A place to post freight where real, dispatchable carriers see it.</strong> Volume matters less than quality: ten verified carriers who answer are worth more than a thousand listings that are ghosts.</li>'
'<li><strong>Proof you can hand to a customer.</strong> A shipper who can see the truck moving does not call you; one who cannot, calls constantly. Proof of delivery attached to the load record ends the &ldquo;did it deliver?&rdquo; thread.</li>'
'<li><strong>Clean paperwork per load.</strong> A rate confirmation generated from the load, a place for the carrier&rsquo;s documents, and a record of accessorials agreed before dispatch.</li>'
'</ol>'
'<p>What you do <em>not</em> need yet: EDI connections to enterprise shippers, multi-branch accounting, custom reporting, and a full customer invoicing and receivables module you will use for four invoices a month. Those are real needs at scale. Buying them on day one is paying for the brokerage you hope to be while starving the one you are.</p>'

'<h2 id="free">Which parts of the stack can be free</h2>'
'<p>Here is the part the vendor listings will not say: three of the four categories above can be run at zero software cost by a new brokerage, if the load board itself does the vetting and the tracking.</p>'
'<p>On LoadBoot, every carrier passes four gates before it can be offered your freight &mdash; FMCSA authority checked live, a certificate of insurance matched to the VIN of the truck that will run the load, a W-9 on file, and a signed dispatch agreement. That is the job of the vetting service, built into the board. The carrier&rsquo;s app posts GPS milestones against the load &mdash; en route, arrived at a geofenced dock, loaded, delivered, proof of delivery attached &mdash; and the timeline is a link you can forward to your customer. That is the job of the visibility platform, included with the post. Every posting carries a <a href="detention-pay-policy.html">published accessorial rate card</a>, so detention is filed from the GPS clock rather than argued from memory. And the board is free for brokers because the fee sits on the carrier side: a flat 5% dispatch fee, invoiced to the carrier at delivery. Brokers are never billed.</p>'
'<p>Posting takes a broker MC and a live FMCSA authority check; there is no document packet to assemble first. Your posting allowance starts small and grows with delivered loads &mdash; three, then ten, then unlimited &mdash; which protects the carriers on the board from brokers who have not yet proved they pay.</p>'
+ _CTA +

'<h2 id="worksheet">A ten-minute cost worksheet</h2>'
'<p>Take any vendor quote &mdash; or your current bills &mdash; and fill in seven lines. No rate numbers are supplied here on purpose; use the ones on your own quotes.</p>'
'<table class="bg-tbl" style="width:100%;border-collapse:collapse;font-size:.95rem;margin:12px 0 18px"><style>.bg-tbl td,.bg-tbl th{border:1px solid #d7dfea;padding:8px 10px;text-align:left;vertical-align:top}.bg-tbl th{background:#eaf1fa}</style><thead><tr><th>Line</th><th>What to write down</th><th>Why it matters</th></tr></thead><tbody>'
'<tr><td>1. Seats</td><td>Monthly price &times; number of people who will log in</td><td>The headline price is for one user</td></tr>'
'<tr><td>2. Tier</td><td>The tier that includes carrier search, tracking and documents</td><td>The entry tier rarely does</td></tr>'
'<tr><td>3. One-time fees</td><td>Onboarding, implementation, training</td><td>Often the largest year-one line</td></tr>'
'<tr><td>4. Usage</td><td>Per load tracked, per carrier onboarded, per document</td><td>Grows with your success</td></tr>'
'<tr><td>5. Contract term</td><td>Monthly or annual; renewal escalator if annual</td><td>Locks in during your most uncertain year</td></tr>'
'<tr><td>6. Re-keying</td><td>Hours per week typing loads into a second system &times; hourly cost</td><td>The invisible salary</td></tr>'
'<tr><td>7. Incident reserve</td><td>What one unvetted-carrier incident would cost you</td><td>Compare it to line 2 before cutting vetting</td></tr>'
'</tbody></table>'
'<p>Add lines 1&ndash;5 for the twelve-month software bill; add line 6 for the true operating cost; keep line 7 beside it as the reason not to save money in the wrong place.</p>'

'<h2 id="honest">Where LoadBoot fits &mdash; and where it does not</h2>'
'<p>LoadBoot is a verified load board with carrier vetting, tracking, documents, claims and a published rate card built in, free for brokers. It replaces the vetting service, the tracking platform and the paid board for a new brokerage, and it gives you a rate confirmation, document storage and an API so a load is entered once.</p>'
'<p>It is not a full TMS. It does not run your customer-side invoicing and receivables, it does not manage a shipper CRM or produce quotes to shippers, it has no EDI, it does not auto-post to other boards, and it does not pay carriers on your behalf. If you are a brokerage with dozens of enterprise customers and a finance team, you will still buy a TMS &mdash; and you can connect it to LoadBoot through the API so posting, vetting and tracking stop being three more subscriptions.</p>'
'<p>For a brokerage in its first year, the honest advice is simpler: cover the four things you need with what is free, keep the money for the bond, the phone bill and the first slow month, and buy the system of record when you have enough loads to need one. The related guides below walk through <a href="how-new-freight-brokers-find-carriers.html">finding carriers as a new broker</a> and the <a href="how-to-become-a-freight-broker.html">steps from application to first post</a>.</p>'
)

FBS_FAQ = [
 ('How much does freight broker software cost?', 'There is no single number. Broker TMS products are priced per user per month, usually in tiers, often with a one-time onboarding fee and an annual contract. Carrier vetting, tracking and load boards are separate subscriptions on top. The worksheet on this page shows how to price your own stack from real quotes rather than a published average.'),
 ('What is freight broker software?', 'The software a brokerage runs its loads on, from quote to payment. In practice it is four tools, not one: a TMS (the system of record for customers, loads, rate confirmations and invoicing), a carrier vetting service, a tracking platform and a load board. Most listings mean only the TMS.'),
 ('Does a new freight broker need a TMS on day one?', 'Usually not. In year one a brokerage needs carrier vetting, a place to post freight to real carriers, proof it can hand a customer, and clean per-load paperwork. A full TMS &mdash; customer receivables, EDI, multi-branch reporting &mdash; becomes worth its price once load volume justifies it.'),
 ('Is there free freight broker software?', 'Parts of the stack can be free. LoadBoot gives licensed brokers a verified load board with carrier vetting, GPS tracking, documents, claims and a published rate card at no charge, funded by a flat 5% dispatch fee on the carrier side. It is not a full TMS: customer invoicing, CRM, EDI and carrier payments are not included.'),
 ('What is the difference between a TMS and a load board?', 'A TMS is the brokerage&rsquo;s system of record &mdash; customers, loads, rate confirmations, invoicing. A load board is where freight is posted to find carriers. Most brokerages use both, plus separate vetting and tracking tools; the cost and the re-keying come from running all four.'),
 ('Is a TMS cheaper than using a freight broker?', 'They are not substitutes. A shipper&rsquo;s TMS organises its own freight &mdash; tenders, rates, tracking &mdash; but the loads still need carriers. A broker finds, vets and manages the carrier and is paid the margin on each load. A TMS starts to pay off once a shipper has the volume and its own carrier relationships to use it.'),
 ('Can I connect LoadBoot to my existing TMS?', 'Yes. Every broker account includes an API key under API &amp; Keys, so loads can be posted from your own system and the vetting, tracking and documents attach to the same load record.'),
]

BROKER_GROWTH_ARTICLES = [
 dict(fname='freight-broker-software-cost.html',
      title='Freight Broker Software Cost in 2026: The Four-Tool Stack, Priced Honestly | LoadBoot',
      desc='Freight broker software cost in 2026: you pay for four tools, not one \u2014 TMS, carrier vetting, tracking, load board. How each is priced, which can be free.',
      eyebrow='Freight Broker Costs', h1='Freight Broker Software Cost in 2026: The Four-Tool Stack, Priced Honestly',
      deck='A brokerage does not buy one piece of software. It buys four &mdash; and the other three are where the money and the risk sit. Here is the full structure of the bill, what a new authority needs in year one, and which parts can be free.',
      read_min=9, hero='', hero_alt='Freight broker comparing the cost of TMS, carrier vetting, tracking and load board software',
      toc=FBS_TOC, body_html=FBS_BODY, faqs=FBS_FAQ, feat_svg=FBS_FEAT, pub='2026-09-13'),
]

BROKER_GROWTH_RELATED = {
 'freight-broker-software-cost.html': [('load-board-subscription-cost.html','Load Board Subscription Costs'),('free-load-board-for-brokers.html','Free Load Board for Brokers'),('create-broker-account.html','Create a Broker Account'),('brokers.html','For Brokers'),('ghost-loads-load-board-problems.html','Ghost Loads &amp; Fake Freight'),('detention-pay-policy.html','Detention Pay Policy'),('how-to-become-a-freight-broker.html','How to Become a Freight Broker')],
}

# ---------- Page 2: how-new-freight-brokers-find-carriers.html ----------
def _feat(title, accent):
    return ('<svg viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="g'+accent[1:]+'" x1="0" y1="0" x2="1" y2="1">'
            '<stop offset="0" stop-color="#10223B"/><stop offset="1" stop-color="#0b1220"/></linearGradient></defs><rect width="400" height="200" fill="url(#g'+accent[1:]+')"/>'
            '<rect x="24" y="130" width="352" height="6" rx="3" fill="#1e3a5f"/><rect x="24" y="130" width="200" height="6" rx="3" fill="'+accent+'"/>'
            '<text x="24" y="60" font-family="Manrope,Arial" font-weight="800" font-size="22" fill="#fff">'+title+'</text>'
            '<text x="24" y="100" font-family="Manrope,Arial" font-weight="700" font-size="13" fill="#94a3b8">LoadBoot &middot; guides for new brokers</text></svg>')

FC_TOC = [('why','Why a new broker has no carriers &mdash; and why that is normal'),
          ('sources','The six places carriers actually come from'),
          ('vet','Vetting a carrier you have never met'),
          ('first','Your first ten carriers: a working method'),
          ('keep','Keeping the carriers you find'),
          ('lb','How LoadBoot changes the order of operations')]
FC_BODY = (
'<p>A brokerage with a new MC number has a bond, a phone, and no carriers. That is not a failure of planning; it is the starting state of every brokerage in the country. The question is not whether you will build a carrier base but how quickly you can move a load safely while you do &mdash; because a shipper who gives a new broker one load will judge the relationship entirely on that load.</p>'
'<p>This guide covers where carriers actually come from, how to vet a carrier you have never met, a working method for your first ten, and how to keep the good ones once you have found them. It is written for the broker with authority in hand and no list.</p>'
'<h2 id="why">Why a new broker has no carriers &mdash; and why that is normal</h2>'
'<p>Established brokerages run on relationships: carriers who answer the phone, know the lanes, and trust that the invoice will be paid. Those relationships took years and were built on hundreds of loads. A new authority cannot buy them, and every carrier who has been burned by a double-broker or a slow-paying startup is right to be cautious about an MC number issued last month.</p>'
'<p>So the early carrier relationship is asymmetric. You need the carrier more than the carrier needs you, and the carrier is taking the larger risk. Everything that follows &mdash; paying on time, papering the load properly, not wasting a driver&rsquo;s afternoon &mdash; is how a new broker earns the right to be called back.</p>'
'<h2 id="sources">The six places carriers actually come from</h2>'
'<ul>'
'<li><strong>Load boards.</strong> Post the load, carriers call. Fast and broad; quality depends entirely on the board&rsquo;s gatekeeping. Boards with no vetting are where fake carriers hunt new brokers. Boards that verify authority, insurance and identity before a carrier can bid remove most of the risk before the phone rings.</li>'
'<li><strong>FMCSA data.</strong> The public register lists every carrier with active authority, its equipment count, safety record and domicile. It is free, it is authoritative, and it is a list of names, not relationships. Useful for checking a carrier; slow as a source.</li>'
'<li><strong>Lane targeting.</strong> Carriers who run a lane want backhauls on it. If your shipper is in Dallas and ships to Atlanta, the carriers who deliver <em>into</em> Dallas from Atlanta are your natural partners. Finding them means watching who is actually moving on that lane.</li>'
'<li><strong>Referrals.</strong> One good owner-operator knows five. Ask, explicitly, after a clean load and a fast payment.</li>'
'<li><strong>Dispatchers and dispatch services.</strong> A dispatcher represents several carriers and is paid to keep them loaded. A dispatcher who trusts you can cover lanes you have never touched. Understand the difference: a dispatcher works for the carrier, not for you. Our guide to <a href="truck-dispatcher-vs-freight-broker.html">dispatchers vs brokers</a> explains the roles.</li>'
'<li><strong>Your own postings.</strong> Every load you post attracts carriers who then exist in your records. A brokerage that posts consistently builds a list as a side effect of moving freight.</li>'
'</ul>'
'<h2 id="vet">Vetting a carrier you have never met</h2>'
'<p>Vetting is the part new brokers skip under pressure and regret at leisure. The minimum standard, on every carrier, before every first load:</p>'
'<ol>'
'<li><strong>Authority is active today.</strong> Not issued once &mdash; active now. Authority is revoked for insurance lapses and the carrier is not always the first to know.</li>'
'<li><strong>Insurance is in force and covers this truck.</strong> A certificate of insurance names scheduled vehicles. The truck that arrives should be one of them. A certificate with the wrong holder, or an edited PDF, is a warning.</li>'
'<li><strong>The identity matches the record.</strong> The phone, email and address you are dealing with should match the FMCSA record. A five-year-old docket answered from a brand-new free email address is worth a question.</li>'
'<li><strong>Safety record is acceptable for the freight.</strong> Out-of-service orders and conditional ratings are public.</li>'
'<li><strong>A signed agreement exists.</strong> Your broker&ndash;carrier agreement, signed before dispatch, is what makes the rate confirmation enforceable.</li>'
'</ol>'
'<p>Checks 1, 2 and 3 are where double-brokering is caught. A carrier who re-posts your load to another truck cannot pass a VIN-to-certificate match at the dock. Our guide to <a href="ghost-loads-load-board-problems.html">ghost loads and fake carriers</a> covers what the failures look like in practice.</p>'
'<h2 id="first">Your first ten carriers: a working method</h2>'
'<p>Pick two lanes you can actually feed &mdash; the ones your first shippers move on. Post real loads on a verified board, take the offers, and vet every carrier that answers against the five checks above. Move the load. Pay on the day you promised, or earlier. Then do the one thing most brokers forget: write down who ran it, how the pickup went, whether the driver communicated, and whether you would use them again.</p>'
'<p>After ten loads on two lanes you will have five to eight carriers you trust and two or three you would not use again. That is a carrier base. It is small, it is real, and it grows the same way &mdash; one clean load at a time.</p>'
'<p>Two disciplines make this work. First, never hand a new carrier your best shipper&rsquo;s most sensitive load; start them on the freight where a bad day costs the least. Second, treat the driver&rsquo;s time as your cost. A carrier who waits four hours at your shipper&rsquo;s dock with no detention paid will not answer next time, and neither will the five carriers they talk to.</p>'
'<h2 id="keep">Keeping the carriers you find</h2>'
'<p>Carriers stay with brokers who pay quickly, paper loads correctly, publish their accessorials and do not argue about detention that the record supports. None of that requires software; all of it is easier with a record. A rate confirmation generated from the load rather than retyped, a proof of delivery attached to the load rather than lost in a text thread, and an accessorial policy the carrier read before booking take most of the friction out of the relationship.</p>'
'<p>Pay attention to communication before booking. A carrier who confirms in writing, asks the right questions about the freight and gives an honest ETA is a carrier you want on the next load too.</p>'
'<h2 id="lb">How LoadBoot changes the order of operations</h2>'
'<p>On a conventional board, you post, the phone rings, and then you vet. On LoadBoot the vetting has already happened: a carrier passes four gates before your load can be offered to it &mdash; FMCSA authority checked live, a certificate of insurance matched to the VIN of the truck that will run the load, a W-9 on file, and a signed dispatch agreement. The offers you receive are from carriers who can be dispatched today. Each has a LoadBoot dispatcher who negotiates for the carrier, which means the person on the other end is used to papering loads properly.</p>'
'<p>The load record does the rest: rate confirmation from the load, GPS milestones you can forward to your shipper, proof of delivery attached, detention filed from the geofence against a <a href="detention-pay-policy.html">published rate card</a>. Posting is free for brokers &mdash; LoadBoot is funded by a flat 5% dispatch fee on the carrier side &mdash; and it takes your broker MC plus a live FMCSA check to start, with an allowance that grows from three open loads as you deliver.</p>'
+ _CTA +
'<p>Related: <a href="freight-broker-software-cost.html">what broker software really costs</a>, <a href="free-load-board-for-brokers.html">the free verified board for brokers</a>, and <a href="load-board.html">how carriers see the board</a>.</p>'
)
FC_FAQ = [
 ('How do new freight brokers find carriers?','Mostly from load boards, FMCSA data, lane targeting, referrals and dispatchers &mdash; and, over time, from their own postings. The fastest safe route is a verified board where authority, insurance and identity are checked before a carrier can bid.'),
 ('How do I vet a carrier before the first load?','Confirm authority is active today, insurance is in force and covers the specific truck (VIN on the certificate), the phone and email match the FMCSA record, the safety record is acceptable, and a broker&ndash;carrier agreement is signed before dispatch.'),
 ('How many carriers does a new brokerage need?','Fewer than you think. Five to eight reliable carriers on two lanes is a working base. It grows with every clean load and every on-time payment.'),
 ('Is it safe to use carriers from a load board?','Only as safe as the board&rsquo;s vetting. Boards with no gatekeeping are where double-brokers target new authorities. LoadBoot verifies authority, insurance-to-VIN, W-9 and a signed agreement before a carrier can be offered a load.'),
]

# ---------- Page 3: how-to-become-a-freight-broker.html ----------
BB_TOC = [('what','What a freight broker actually does'),
          ('legal','The legal requirements, in order'),
          ('money','What it costs to open the door'),
          ('setup','The setup most guides skip'),
          ('first','From authority to your first posted load'),
          ('mistakes','Five mistakes that end new brokerages')]
BB_BODY = (
'<p>Becoming a freight broker is one of the few ways into trucking that does not require a truck. It does require federal authority, a surety bond, a process agent in every state, and &mdash; the part the licensing guides leave out &mdash; a way to find carriers and shippers before the bond premium comes due again. This guide walks the whole path in order, from what the job is to your first posted load.</p>'
'<p>It is information, not legal advice. Fees and forms change; confirm the current figures on FMCSA&rsquo;s own site before you file.</p>'
'<h2 id="what">What a freight broker actually does</h2>'
'<p>A freight broker arranges transportation of someone else&rsquo;s freight by a motor carrier, for compensation, without taking possession of the goods. The shipper is your customer; the carrier does the hauling; you sit in the middle, paid by the margin between what the shipper pays and what the carrier accepts. You are legally responsible for arranging the move, for paying the carrier, and for not doing things brokers may not do &mdash; such as re-brokering a load you have already accepted as a carrier, or operating without authority.</p>'
'<p>It is a sales job first, an operations job second, and a credit-management job always. Brokers fail on the third far more often than the first.</p>'
'<h2 id="legal">The legal requirements, in order</h2>'
'<ol>'
'<li><strong>A business entity and an EIN.</strong> Most brokers form an LLC or corporation before applying so the authority is held by the company.</li>'
'<li><strong>USDOT number and broker operating authority (MC number).</strong> Filed with FMCSA through its Unified Registration System. You apply as a property broker; there is an application fee, and the application is public during a protest period before authority is granted.</li>'
'<li><strong>A $75,000 surety bond (BMC-84) or trust fund (BMC-85).</strong> This is the statutory financial responsibility a broker must keep on file. You pay a premium to a surety, priced on your credit; the surety files the form. Authority is not granted without it, and it is revoked if the bond is cancelled.</li>'
'<li><strong>Process agents in every state (BOC-3).</strong> A blanket process-agent service files this for you, naming someone to accept legal papers on your behalf in each state.</li>'
'<li><strong>Unified Carrier Registration (UCR).</strong> An annual state-administered registration required of brokers as well as carriers.</li>'
'<li><strong>State business requirements.</strong> Registration, local licences and any state tax obligations follow your entity, not FMCSA.</li>'
'</ol>'
'<p>Authority becomes active once the protest period passes and the bond and BOC-3 are on file. From that day you may arrange freight &mdash; and from that day your bond premium, UCR and insurance are running costs whether you move a load or not.</p>'
'<h2 id="money">What it costs to open the door</h2>'
'<p>The published numbers are the application fee, the bond premium (a percentage of the $75,000 face value, set by your credit), the process-agent fee and UCR. Together, for a broker with good credit, they are modest next to the real cost of the first year: the months of cash flow between paying carriers and being paid by shippers. Shippers pay on terms; carriers expect to be paid quickly. A brokerage that cannot fund that gap &mdash; from savings, a line of credit, or factoring &mdash; will run out of carriers before it runs out of shippers.</p>'
'<p>Software is the other line people over-budget on day one. Our <a href="freight-broker-software-cost.html">guide to freight broker software cost</a> explains the four-tool stack and which parts a new brokerage can run free.</p>'
'<h2 id="setup">The setup most guides skip</h2>'
'<p>Between authority and the first load there is a set of documents and decisions that make the difference between a brokerage and a phone number:</p>'
'<ul>'
'<li><strong>A broker&ndash;carrier agreement.</strong> The contract every carrier signs before their first load with you. It sets payment terms, insurance requirements, claims procedure and the no-re-brokering clause. Have a transportation attorney review it once; then use it every time.</li>'
'<li><strong>A rate confirmation template.</strong> Load details, rate, accessorials, and reference to the agreement. Generated per load, signed before dispatch.</li>'
'<li><strong>A shipper credit policy.</strong> Who you will extend terms to and how much. Broker failures are shipper non-payment failures more often than anything else.</li>'
'<li><strong>An accessorial policy.</strong> Detention, layover, truck-ordered-not-used, lumpers &mdash; decided and written down before the first argument, not during it.</li>'
'<li><strong>A carrier vetting checklist.</strong> Authority active, insurance in force and matched to the truck, identity matched to the FMCSA record, safety record acceptable, agreement signed. See <a href="how-new-freight-brokers-find-carriers.html">how new brokers find and vet carriers</a>.</li>'
'</ul>'
'<h2 id="first">From authority to your first posted load</h2>'
'<p>You will have a shipper before you have a carrier, or a carrier before you have a shipper; rarely both. Either way the first load follows the same path: confirm the freight details in writing, post it where verified carriers will see it, take the best offer from a carrier who passes the checklist, paper it with a rate confirmation, watch it move, collect proof of delivery, pay the carrier on the day you promised, and invoice the shipper with the paperwork attached.</p>'
'<p>On LoadBoot the posting step takes your broker MC and a live FMCSA authority check &mdash; no document packet &mdash; and every carrier on the board has already passed four gates: authority checked live, insurance matched to the VIN, W-9 on file, dispatch agreement signed. GPS milestones, proof of delivery and a published accessorial rate card ride with the load, and the board is free for brokers. Your first three open loads are the allowance; it grows as loads deliver.</p>'
+ _CTA +
'<h2 id="mistakes">Five mistakes that end new brokerages</h2>'
'<ol>'
'<li><strong>Extending credit to a shipper you have not checked.</strong> One large unpaid invoice can exceed a year of margin.</li>'
'<li><strong>Skipping carrier vetting on a Friday afternoon.</strong> The double-brokered load always arrives when you are in a hurry.</li>'
'<li><strong>Paying carriers late.</strong> Word travels. Carriers who are paid slowly stop answering, and the ones who keep answering are the ones you least want.</li>'
'<li><strong>Arguing accessorials with no record.</strong> Decide the policy in advance, put timestamps on arrivals, and pay what the record supports.</li>'
'<li><strong>Buying software for the brokerage you hope to be.</strong> Cover vetting, posting, tracking and paperwork with what is free, and buy the system of record when volume needs it.</li>'
'</ol>'
'<p>Related: the <a href="freight-broker-startup-checklist.html">freight broker startup checklist</a> puts all of this in order for your first ninety days, and <a href="where-freight-brokers-get-loads.html">where freight brokers get loads</a> covers the shipper side.</p>'
)
BB_FAQ = [
 ('What do you need to become a freight broker?','A business entity, a USDOT number and broker operating authority from FMCSA, a $75,000 surety bond (BMC-84) or trust fund (BMC-85), process agents in every state (BOC-3), UCR registration, and whatever your state requires of the business itself.'),
 ('How much does a freight broker bond cost?','You pay an annual premium to a surety, priced on your credit, for a bond with a $75,000 face value. The premium is a fraction of the face value; the surety files the bond with FMCSA and cancels it if you stop paying, which revokes your authority.'),
 ('Do freight brokers need a truck or a warehouse?','No. A broker arranges transportation and never takes possession of the freight. You need authority, a bond, an office &mdash; which can be a phone and a laptop &mdash; and a way to find carriers and shippers.'),
 ('How long does it take to get broker authority?','After filing with FMCSA there is a public protest period before authority is granted, and the bond and BOC-3 must be on file. Confirm current timelines on FMCSA&rsquo;s site; they change.'),
 ('Can a new freight broker post loads on LoadBoot?','Yes. Posting needs a broker MC and passes a live FMCSA authority check; there is no document packet. The board is free for brokers, and your open-load allowance grows from three as loads deliver.'),
]

# ---------- Page 4: where-freight-brokers-get-loads.html ----------
WL_TOC = [('truth','The uncomfortable truth about &ldquo;getting loads&rdquo;'),
          ('sources','Where a broker&rsquo;s freight actually comes from'),
          ('prospect','Prospecting shippers as a new brokerage'),
          ('credit','The credit check that saves the company'),
          ('keep','Keeping a shipper after the first load'),
          ('lb','Shipper-direct freight on LoadBoot')]
WL_BODY = (
'<p>New brokers ask &ldquo;where do I get loads?&rdquo; as if freight were on a shelf somewhere. It is not. A broker&rsquo;s loads come from shippers who chose to give that broker their freight, and the whole craft of brokering is earning that choice. This guide covers where freight really comes from, how a brand-new brokerage prospects for it, the credit discipline that keeps you solvent, and how to keep a shipper once you have one.</p>'
'<h2 id="truth">The uncomfortable truth about &ldquo;getting loads&rdquo;</h2>'
'<p>There is no load board for brokers to <em>take</em> freight from. Load boards are where brokers <em>post</em> freight to find carriers. The freight itself comes from a manufacturer, a distributor, a grower, a retailer &mdash; someone with product that has to move &mdash; and they give it to the broker who answered the phone, quoted sensibly, covered the load, and did not make them regret it. Everything in this guide is about becoming that broker.</p>'
'<h2 id="sources">Where a broker&rsquo;s freight actually comes from</h2>'
'<ul>'
'<li><strong>Direct shipper relationships.</strong> The core of every brokerage. A shipper who ships weekly and trusts you is worth more than any lead list.</li>'
'<li><strong>Co-brokered and overflow freight.</strong> Larger brokerages and 3PLs hand off lanes they cannot cover. Lower margin, faster start, and a real way to learn lanes while you prospect.</li>'
'<li><strong>Freight agents.</strong> Some brokerages grow by signing agents who bring their own shipper relationships and work under the brokerage&rsquo;s authority. Our guide to <a href="freight-agent-vs-freight-broker.html">agents vs brokers</a> explains both sides.</li>'
'<li><strong>Industry verticals.</strong> Produce, building materials, metals, retail replenishment &mdash; each has seasons, equipment and paperwork of its own. Brokers who specialise are easier to trust than brokers who &ldquo;do everything&rdquo;. See <a href="freight-shipping-by-industry.html">freight shipping by industry</a>.</li>'
'<li><strong>Inbound from being findable.</strong> A brokerage with a clear specialty, a website that explains it, and a phone that is answered picks up shippers who are searching. Slow to build; compounding once it starts.</li>'
'</ul>'
'<h2 id="prospect">Prospecting shippers as a new brokerage</h2>'
'<p>Pick a lane or a vertical you can speak about intelligently &mdash; ideally one where you already have, or can quickly build, carrier capacity. Then prospect the shippers on it. The conversation that works is not &ldquo;we can move anything anywhere&rdquo;; it is &ldquo;we cover Dallas to Atlanta dry van three times a week, here is what our carriers look like, here is how you will see the truck.&rdquo;</p>'
'<p>Shippers give new brokers a chance for one of three reasons: the incumbent failed on a load, the incumbent&rsquo;s price drifted, or the shipper has a lane nobody wants. Ask about all three. The first load you are offered will often be the awkward one &mdash; take it, cover it properly, and it becomes the reference for the next.</p>'
'<p>What a shipper wants to see before trusting you with freight: your authority and bond, a clear answer on carrier vetting, how they will track the load, how claims are handled, and your accessorial terms in writing. Have all five ready before the first call.</p>'
'<h2 id="credit">The credit check that saves the company</h2>'
'<p>You will pay the carrier weeks before the shipper pays you. That means every shipper is a credit decision, and a brokerage that skips it is lending money to strangers. Before extending terms: confirm the entity, check payment history where you can, start with a credit limit you can absorb losing, and grow it as invoices are paid on time. A single large unpaid invoice has ended more brokerages than any competitor.</p>'
'<p>If cash is tight, factoring your shipper invoices is a legitimate tool &mdash; expensive, but cheaper than losing a carrier base because you paid late.</p>'
'<h2 id="keep">Keeping a shipper after the first load</h2>'
'<p>Shippers keep brokers who make the load boring: the truck shows up when it was booked, they can see it move without calling, the paperwork arrives complete, and accessorials are handled without a fight. A tracking link they can forward to their own customer, proof of delivery attached to the invoice, and detention documented from a timestamp rather than argued from memory turn a one-load trial into a weekly lane.</p>'
'<h2 id="lb">Shipper-direct freight on LoadBoot</h2>'
'<p>LoadBoot is built for the whole chain, not only the broker&ndash;carrier leg. Shippers can post loads on the board directly &mdash; after an automated business check on their company email domain &mdash; and carriers are vetted through four gates before any load is offered to them. For a new broker, the board is where you cover the freight you win: post it under your MC after a live FMCSA authority check, take direct offers from verified carriers, and let the load record carry the rate confirmation, GPS milestones, proof of delivery and a published accessorial rate card that your shipper can read. Brokers are never billed; LoadBoot is funded by a flat 5% dispatch fee on the carrier side.</p>'
'<p>What LoadBoot does not do is hand brokers shippers. Nobody honest will. What it does is make the first load you win look like the fiftieth &mdash; which is how you get the second.</p>'
+ _CTA +
'<p>Related: <a href="how-new-freight-brokers-find-carriers.html">how new brokers find carriers</a>, <a href="freight-broker-startup-checklist.html">the startup checklist</a>, and <a href="shipper-solutions.html">what shippers see on LoadBoot</a>.</p>'
)
WL_FAQ = [
 ('Where do freight brokers get their loads?','From shippers who choose to give them freight: direct relationships, overflow from larger brokerages, agents who bring their own customers, and inbound enquiries once the brokerage is findable. Load boards are where brokers post freight to find carriers, not where they take loads from.'),
 ('How does a new freight broker find shippers?','Pick a lane or vertical you can cover, prospect the shippers on it with a specific offer, be ready to show authority, bond, carrier vetting, tracking, claims handling and accessorial terms, and take the awkward first load when it is offered.'),
 ('Do brokers need to check a shipper&rsquo;s credit?','Yes. You pay carriers before shippers pay you, so every shipper is a credit decision. Start with a limit you can afford to lose and grow it with on-time payments.'),
 ('Can shippers post loads on LoadBoot without a broker?','Yes. Shippers post after an automated business check on their company email, and loads go only to carriers who have passed four verification gates. Brokers use the same board to cover the freight they win.'),
]

# ---------- Page 5: freight-broker-startup-checklist.html ----------
SC_TOC = [('before','Before you file'),('file','Filing and financial responsibility'),('setup','Setup week: documents and decisions'),
          ('d30','Days 1&ndash;30: first lane, first carriers'),('d60','Days 31&ndash;60: second lane, credit discipline'),('d90','Days 61&ndash;90: systems, agents, what to measure')]
SC_BODY = (
'<p>This is the checklist we would hand a friend who just decided to open a brokerage: everything from the first filing to the ninetieth day, in the order it actually needs to happen. Each item is short on purpose; the linked guides carry the detail. Confirm fees and forms on FMCSA&rsquo;s site before filing &mdash; they change, and this page is information, not legal advice.</p>'
'<h2 id="before">Before you file</h2>'
'<ul>'
'<li>Form the business entity; get an EIN and a business bank account.</li>'
'<li>Decide the lane or vertical you will start on &mdash; one you can talk about credibly.</li>'
'<li>Fund the payment gap: savings, a credit line or a factoring relationship for the weeks between paying carriers and being paid.</li>'
'<li>Read <a href="how-to-become-a-freight-broker.html">how to become a freight broker</a> once, end to end.</li>'
'</ul>'
'<h2 id="file">Filing and financial responsibility</h2>'
'<ul>'
'<li>USDOT number and broker authority (MC) via FMCSA&rsquo;s registration system.</li>'
'<li>$75,000 surety bond (BMC-84) or trust (BMC-85) filed by your surety.</li>'
'<li>BOC-3 process agents in every state.</li>'
'<li>UCR registration; state business registrations.</li>'
'<li>Calendar the renewals: bond premium, UCR, any state licences.</li>'
'</ul>'
'<h2 id="setup">Setup week: documents and decisions</h2>'
'<ul>'
'<li>Broker&ndash;carrier agreement, reviewed once by a transportation attorney.</li>'
'<li>Rate confirmation template generated per load.</li>'
'<li>Written accessorial policy: detention, layover, TONU, lumpers.</li>'
'<li>Carrier vetting checklist: authority active, insurance in force and matched to the truck, identity matched to the FMCSA record, safety acceptable, agreement signed.</li>'
'<li>Shipper credit policy and a starting credit limit per customer.</li>'
'<li>Software: cover vetting, posting, tracking and paperwork with what is free; defer the TMS. See <a href="freight-broker-software-cost.html">freight broker software cost</a>.</li>'
'<li>Create your broker account on LoadBoot: broker MC + live FMCSA check, no document packet, free for brokers.</li>'
'</ul>'
'<h2 id="d30">Days 1&ndash;30: first lane, first carriers</h2>'
'<ul>'
'<li>Prospect shippers on your one lane with a specific offer. Take the awkward first load.</li>'
'<li>Post it where verified carriers will see it; vet every carrier that answers against the checklist.</li>'
'<li>Paper the load, watch it move, collect proof of delivery, pay the carrier on the promised day.</li>'
'<li>Record who ran it and whether you would use them again. Target: five to eight carriers you trust by day 30. See <a href="how-new-freight-brokers-find-carriers.html">finding carriers as a new broker</a>.</li>'
'</ul>'
'<h2 id="d60">Days 31&ndash;60: second lane, credit discipline</h2>'
'<ul>'
'<li>Add a second lane that your existing carriers can backhaul on.</li>'
'<li>Review every open shipper invoice weekly; do not raise a credit limit until the first invoices are paid on time.</li>'
'<li>Ask your best carriers for referrals after a clean load and a fast payment.</li>'
'<li>Pay every accessorial the record supports, promptly. Reputation with carriers is built here.</li>'
'</ul>'
'<h2 id="d90">Days 61&ndash;90: systems, agents, what to measure</h2>'
'<ul>'
'<li>Decide whether volume now justifies a system of record; connect it to the board by API rather than re-keying.</li>'
'<li>If an experienced agent wants to work under your authority, read <a href="freight-agent-vs-freight-broker.html">freight agent vs freight broker</a> first and paper the split.</li>'
'<li>Measure four numbers monthly: loads covered, gross margin per load, days-to-pay from shippers, days-to-pay to carriers. The last two decide whether you survive; the first two decide whether it was worth it.</li>'
'<li>Re-read <a href="where-freight-brokers-get-loads.html">where freight brokers get loads</a> and pick the next vertical.</li>'
'</ul>'
+ _CTA +
'<p>Print this page. Ninety days from now, the items you skipped will be the ones that hurt.</p>'
)
SC_FAQ = [
 ('What does a freight broker need to start?','An entity and EIN, FMCSA broker authority, a $75,000 bond or trust, BOC-3 process agents, UCR, a broker&ndash;carrier agreement, a rate confirmation template, an accessorial policy, a carrier vetting checklist, a shipper credit policy, and funding for the gap between paying carriers and being paid.'),
 ('How long before a new brokerage is profitable?','It depends on the lane, the margin and how fast shippers pay. The checklist&rsquo;s four monthly numbers &mdash; loads, margin per load, days-to-pay in and out &mdash; tell you where you are; most failures are cash-flow failures, not sales failures.'),
 ('Should a new broker buy a TMS immediately?','Usually not. Cover carrier vetting, posting, tracking and paperwork with what is free, then buy the system of record when volume needs it and connect it by API.'),
]

# ---------- Page 6: freight-agent-vs-freight-broker.html ----------
AB_TOC = [('def','Definitions that matter legally'),('money','How each is paid'),('risk','Who carries which risk'),
          ('which','Which path fits you'),('multi','Working with more than one brokerage'),('lb','How agents post on LoadBoot')]
AB_BODY = (
'<p><strong>A freight broker holds FMCSA broker authority and the $75,000 bond in its own name and is the legal party arranging the load. A freight agent has no authority of its own: it works under a broker&rsquo;s MC for a share of the margin.</strong></p>'
'<p>&ldquo;Freight agent&rdquo; and &ldquo;freight broker&rdquo; are used interchangeably in job ads and almost never in law. The difference decides who holds the bond, who is liable when a load goes wrong, who is paid what, and whether you can work with more than one company. This guide sets the two apart plainly and ends with the arrangement most guides miss: an agent who represents several brokerages at once.</p>'
'<h2 id="def">Definitions that matter legally</h2>'
'<p>A <strong>freight broker</strong> holds FMCSA broker operating authority in its own name, keeps the $75,000 bond or trust on file, and is the party legally arranging transportation. Shippers contract with the broker; carriers are paid by the broker.</p>'
'<p>A <strong>freight agent</strong> works under a broker&rsquo;s authority. The agent finds shippers and carriers and works the loads, but the loads move under the broker&rsquo;s MC, the broker&rsquo;s bond and the broker&rsquo;s contracts. The agent has no authority of its own and cannot arrange freight except through a licensed broker.</p>'
'<p>That single fact &mdash; whose MC the load moves under &mdash; is the whole distinction. Everything else follows from it.</p>'
'<h2 id="money">How each is paid</h2>'
'<p>The broker earns the margin between the shipper&rsquo;s rate and the carrier&rsquo;s rate on every load, and pays everything: bond, insurance, software, staff, and the carrier while waiting for the shipper. The agent is paid a share of the margin on the loads the agent brings, by the broker, usually after the shipper pays. Agent splits vary by brokerage and by what the brokerage provides &mdash; back office, credit, claims handling, software. There is no standard number and anyone quoting one is describing their own deal.</p>'
'<h2 id="risk">Who carries which risk</h2>'
'<ul>'
'<li><strong>Shipper non-payment:</strong> the broker&rsquo;s loss. The agent typically loses the commission.</li>'
'<li><strong>Cargo claims and carrier fraud:</strong> the broker&rsquo;s liability under its contracts and bond; the agent&rsquo;s reputation.</li>'
'<li><strong>Bond, authority and compliance:</strong> entirely the broker&rsquo;s.</li>'
'<li><strong>Losing the customer:</strong> the agent&rsquo;s. Agent agreements are explicit about who owns the shipper relationship; read that clause before signing.</li>'
'</ul>'
'<h2 id="which">Which path fits you</h2>'
'<p>Become an <strong>agent</strong> if you have shipper relationships or sales ability and do not want to fund a bond, credit exposure and a back office &mdash; or if you want to learn the trade under an established authority first. Become a <strong>broker</strong> if you want to own the customer relationships outright, keep the whole margin, and are prepared to carry the risk and the cash-flow gap. Many brokers started as agents; the reverse is rarer.</p>'
'<h2 id="multi">Working with more than one brokerage</h2>'
'<p>Most agent agreements are exclusive, but not all, and an experienced agent with strong relationships is sometimes best served by placing freight through whichever brokerage suits a given customer &mdash; one for produce credit, another for a lane it already covers. The complication has always been operational: each brokerage has its own onboarding, its own systems, and its own way of confirming that you are authorised to post under it.</p>'
'<h2 id="lb">How agents post on LoadBoot</h2>'
'<p>LoadBoot treats the agent as a real role. One agent account can be linked to one brokerage or several. Each brokerage confirms the link with a six-digit code sent to its FMCSA-listed email address (or an owner or same-domain address) &mdash; no phone calls, no per-brokerage document packet. Once confirmed, the agent posts loads under the chosen brokerage&rsquo;s MC with that brokerage&rsquo;s posting allowance, and the load carries the same verified carriers, GPS milestones, proof of delivery and published rate card as any broker posting. If a brokerage has no email on its FMCSA record, the fix is on the FMCSA side (an MCS-150 update); LoadBoot re-checks once it is there.</p>'
'<p>For the brokerage, this is a controlled way to let agents work: every post is under a confirmed link, and the brokerage sees its agents in the portal. Posting is free for brokers and agents alike; LoadBoot is funded by a flat 5% dispatch fee on the carrier side.</p>'
+ _CTA +
'<p>Related: <a href="how-to-become-a-freight-broker.html">how to become a freight broker</a>, <a href="freight-broker-startup-checklist.html">the startup checklist</a>, and <a href="create-agent-account.html">create an agent account</a>.</p>'
)
AB_FAQ = [
 ('What is the difference between a freight agent and a freight broker?','A broker holds FMCSA authority and the $75,000 bond and is the legal party arranging freight. An agent works under a broker&rsquo;s authority, bringing shippers and carriers, and is paid a share of the margin by the broker.'),
 ('What is a freight agent?','A freight agent is a freight professional, usually an independent contractor, who works under a licensed broker&rsquo;s authority. The agent brings shippers and carriers and works the loads; the loads move under the broker&rsquo;s MC, bond and contracts, and the broker pays the agent a share of the margin.'),
 ('Can a freight agent work for more than one brokerage?','Only if the agent agreements allow it. Where they do, LoadBoot lets one agent account post under several brokerages, each confirmed by a code emailed to the brokerage&rsquo;s FMCSA-listed address.'),
 ('Does a freight agent need a bond or an MC number?','No. The loads move under the broker&rsquo;s MC and bond. The agent needs a brokerage willing to take them on and an agreement that sets the commission split and who owns the customer.'),
 ('How do I post loads as an agent on LoadBoot?','Create an agent account, link it to a brokerage, and have the brokerage confirm the link with the emailed six-digit code. You then post under that brokerage&rsquo;s MC with its allowance.'),
]

BROKER_GROWTH_ARTICLES += [
 dict(fname='how-new-freight-brokers-find-carriers.html',
      title='How New Freight Brokers Find Carriers (and Vet Them Before the First Load) | LoadBoot',
      desc='Where carriers actually come from for a new freight brokerage, the five checks to run on a carrier you have never met, a working method for your first ten carriers, and how to keep them.',
      eyebrow='New Broker Guides', h1='How New Freight Brokers Find Carriers &mdash; and Vet Them Before the First Load',
      deck='A new MC comes with a bond, a phone and no carriers. Here is where they come from, how to check one you have never met, and a method for your first ten.',
      read_min=8, hero='', hero_alt='New freight broker building a verified carrier base',
      toc=FC_TOC, body_html=FC_BODY, faqs=FC_FAQ, feat_svg=_feat('Where carriers come from','#0883F7'), pub='2026-09-13'),
 dict(fname='how-to-become-a-freight-broker.html',
      title='How to Become a Freight Broker in 2026: Authority, Bond, Setup and Your First Load | LoadBoot',
      desc='The full path to becoming a freight broker: what the job is, the legal requirements in order (MC, $75,000 bond, BOC-3, UCR), what it costs, the setup most guides skip, and the road from authority to your first posted load.',
      eyebrow='New Broker Guides', h1='How to Become a Freight Broker in 2026',
      deck='Authority, bond, process agents, UCR &mdash; and then the part the licensing guides leave out: finding carriers and shippers before the premium comes due again.',
      read_min=9, hero='', hero_alt='Steps to become a licensed freight broker',
      toc=BB_TOC, body_html=BB_BODY, faqs=BB_FAQ, feat_svg=_feat('Authority to first load','#FC5305'), pub='2026-09-13'),
 dict(fname='where-freight-brokers-get-loads.html',
      title='Where Freight Brokers Get Loads: How New Brokerages Find Shippers | LoadBoot',
      desc='There is no shelf of loads. A broker&rsquo;s freight comes from shippers who chose them. Where that freight really comes from, how a new brokerage prospects, the credit discipline that keeps it solvent, and how to keep a shipper.',
      eyebrow='New Broker Guides', h1='Where Freight Brokers Get Loads',
      deck='Load boards are where brokers post freight, not where they take it from. Here is where a brokerage&rsquo;s loads really come from and how a new one earns them.',
      read_min=7, hero='', hero_alt='Freight broker prospecting shippers for loads',
      toc=WL_TOC, body_html=WL_BODY, faqs=WL_FAQ, feat_svg=_feat('Where the freight comes from','#0883F7'), pub='2026-09-13'),
 dict(fname='freight-broker-startup-checklist.html',
      title='Freight Broker Startup Checklist: Filing to Day 90 | LoadBoot',
      desc='A freight broker startup checklist in the order it actually happens: before filing, authority and bond, setup week documents, and a 30/60/90-day plan for lanes, carriers, credit and systems.',
      eyebrow='New Broker Guides', h1='Freight Broker Startup Checklist: From Filing to Day 90',
      deck='Everything a new brokerage has to do, in order, from the first filing to the ninetieth day &mdash; with the four numbers to measure at the end.',
      read_min=6, hero='', hero_alt='Freight broker startup checklist',
      toc=SC_TOC, body_html=SC_BODY, faqs=SC_FAQ, feat_svg=_feat('Filing to day 90','#FC5305'), pub='2026-09-13'),
 dict(fname='freight-agent-vs-freight-broker.html',
      title='Freight Agent vs Freight Broker: Authority, Pay, Risk and Working Under Several Brokerages | LoadBoot',
      desc='Freight broker vs agent: the broker holds FMCSA authority and the $75,000 bond; the agent works under its MC for a share of the margin. Pay and risk.',
      eyebrow='New Broker Guides', h1='Freight Agent vs Freight Broker',
      deck='Whose MC the load moves under decides the bond, the liability, the pay and whether you can work with more than one company. The plain version.',
      read_min=7, hero='', hero_alt='Freight agent and freight broker roles compared',
      toc=AB_TOC, body_html=AB_BODY, faqs=AB_FAQ, feat_svg=_feat('Agent or broker?','#0883F7'), pub='2026-09-13'),
]

BROKER_GROWTH_RELATED.update({
 'how-new-freight-brokers-find-carriers.html': [('how-to-become-a-freight-broker.html','How to Become a Freight Broker'),('freight-broker-software-cost.html','Freight Broker Software Cost'),('ghost-loads-load-board-problems.html','Ghost Loads &amp; Fake Freight'),('free-load-board-for-brokers.html','Free Load Board for Brokers'),('create-broker-account.html','Create a Broker Account'),('truck-dispatcher-vs-freight-broker.html','Dispatcher vs Broker')],
 'how-to-become-a-freight-broker.html': [('freight-broker-startup-checklist.html','Startup Checklist'),('how-new-freight-brokers-find-carriers.html','Finding Carriers'),('where-freight-brokers-get-loads.html','Where Brokers Get Loads'),('freight-broker-software-cost.html','Freight Broker Software Cost'),('create-broker-account.html','Create a Broker Account'),('brokers.html','For Brokers')],
 'where-freight-brokers-get-loads.html': [('how-to-become-a-freight-broker.html','How to Become a Freight Broker'),('how-new-freight-brokers-find-carriers.html','Finding Carriers'),('freight-shipping-by-industry.html','Freight by Industry'),('shipper-solutions.html','For Shippers'),('freight-agent-vs-freight-broker.html','Agent vs Broker'),('create-broker-account.html','Create a Broker Account')],
 'freight-broker-startup-checklist.html': [('how-to-become-a-freight-broker.html','How to Become a Freight Broker'),('how-new-freight-brokers-find-carriers.html','Finding Carriers'),('where-freight-brokers-get-loads.html','Where Brokers Get Loads'),('freight-broker-software-cost.html','Freight Broker Software Cost'),('freight-agent-vs-freight-broker.html','Agent vs Broker'),('create-broker-account.html','Create a Broker Account')],
 'freight-agent-vs-freight-broker.html': [('how-to-become-a-freight-broker.html','How to Become a Freight Broker'),('create-agent-account.html','Create an Agent Account'),('freight-broker-startup-checklist.html','Startup Checklist'),('brokers.html','For Brokers'),('agents.html','Agent Program'),('create-broker-account.html','Create a Broker Account')],
})
