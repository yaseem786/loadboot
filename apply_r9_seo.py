# -*- coding: utf-8 -*-
"""R9 (2026-09-18) weekly SEO loop — additive, reversible edits to build_site.py.
1. flatbed-dispatch.html title/meta (svc_page layer)
2. flatbed-freight-rates.html title/meta (equipment-hub loop, per-slug override — other 7 hubs unchanged)
3. New premium article spot-market-freight-rates.html + 3 reverse links
"""
import ast, io, sys
P = sys.argv[1]
src = io.open(P, encoding='utf-8').read()
orig = src

def rep(old, new, n=1):
    global src
    c = src.count(old)
    assert c == n, ('expected %d, found %d for: %s' % (n, c, old[:90]))
    src = src.replace(old, new)

# ---------- 1. flatbed-dispatch (svc_page) ----------
rep("svc_page('flatbed-dispatch.html','Flatbed','Flatbed Dispatch Services for Owner-Operators | Loadboot',\n"
    " 'Flatbed and step-deck truck dispatch. We book high-paying steel, lumber, and machinery loads, negotiate rates, and handle brokers. Flat 5%, no contracts.',",
    "svc_page('flatbed-dispatch.html','Flatbed','Flatbed Dispatch Services 2026 \\u2014 Flatbed Truck &amp; Step-Deck Dispatch Service for Owner-Operators, Flat 5% | LoadBoot',\n"
    " 'Flatbed dispatch services for owner-operators and small fleets in 2026: flatbed truck and step-deck dispatch that books high-paying steel, lumber and machinery loads, negotiates every rate and handles the brokers. Flat 5% of gross, no contracts.',")

# ---------- 2. flatbed-freight-rates hub (per-slug title/desc override) ----------
rep("for _eq in _EQ_RATES:\n    _n, _s = _eq['name'], _eq['slug']\n    _low = _n.lower()\n",
    "# R9 (2026-09-18) SEO: per-hub <title>/<meta> overrides. Only the slugs listed here change;\n"
    "# every other equipment hub keeps the shared frame below. Keys = hub slug.\n"
    "_EQ_SEO_OVERRIDE = {\n"
    " 'flatbed': dict(\n"
    "   title='Flatbed Freight Rates Per Mile 2026 \\u2014 Current &amp; Average Flatbed Trucking Rates, Cost Per Mile for Carriers, Brokers &amp; Shippers | LoadBoot',\n"
    "   desc='Current and average flatbed trucking rates per mile in 2026, updated as new national data lands: flatbed cost per mile for the carrier, what brokers buy and sell at, what shippers pay, plus lane examples, seasonality and the accessorials that move the real number.'),\n"
    "}\n"
    "for _eq in _EQ_RATES:\n    _n, _s = _eq['name'], _eq['slug']\n    _low = _n.lower()\n")
rep("    page(_s + '-freight-rates.html',\n"
    "         _n + ' Freight Rates Per Mile 2026 \\u2014 Carrier, Broker &amp; Shipper | LoadBoot',\n"
    "         _n + ' freight rates per mile, updated as new national data lands: what the carrier is paid, what brokers buy and sell at, '\n"
    "         'what shippers pay, plus lane examples, seasonality and the accessorials that move the real number.',\n",
    "    page(_s + '-freight-rates.html',\n"
    "         _EQ_SEO_OVERRIDE.get(_s, {}).get('title') or (_n + ' Freight Rates Per Mile 2026 \\u2014 Carrier, Broker &amp; Shipper | LoadBoot'),\n"
    "         _EQ_SEO_OVERRIDE.get(_s, {}).get('desc') or (_n + ' freight rates per mile, updated as new national data lands: what the carrier is paid, what brokers buy and sell at, '\n"
    "         'what shippers pay, plus lane examples, seasonality and the accessorials that move the real number.'),\n")

# ---------- 3. reverse links (0-click pages only) ----------
rep("RELATED['fuel-surcharge-trucking.html'] = [('market-rates.html','Market Rates Per Mile'),",
    "RELATED['fuel-surcharge-trucking.html'] = [('market-rates.html','Market Rates Per Mile'),('spot-market-freight-rates.html','Spot Market Freight Rates'),")
rep("RELATED['cost-per-mile-calculator.html'] = [('tools.html','All Free Trucking Calculators'),",
    "RELATED['cost-per-mile-calculator.html'] = [('tools.html','All Free Trucking Calculators'),('spot-market-freight-rates.html','Spot Market Freight Rates'),")
rep(" 'tools.html':              [('cost-per-mile-calculator.html','Cost Per Mile Calculator'),",
    " 'tools.html':              [('cost-per-mile-calculator.html','Cost Per Mile Calculator'),('spot-market-freight-rates.html','Spot Market Freight Rates'),")
rep(" 'should-i-buy-a-truck-before-2027-epa-rule.html':'2026-08-01',\n}",
    " 'should-i-buy-a-truck-before-2027-epa-rule.html':'2026-08-01',\n 'spot-market-freight-rates.html':'2026-09-18',\n}")

# ---------- 4. the article ----------
ARTICLE = r'''
# ===== PREMIUM ARTICLE : Spot market freight rates (carrier + broker + shipper + agent) — R9 2026-09-18 =====
SPOT_FEAT=('<svg viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="spg" x1="0" y1="0" x2="1" y2="1">'
 '<stop offset="0" stop-color="#10223B"/><stop offset="1" stop-color="#0883F7"/></linearGradient></defs>'
 '<rect width="400" height="200" fill="url(#spg)"/>'
 '<text x="200" y="46" text-anchor="middle" font-family="Arial,sans-serif" font-size="14" font-weight="700" fill="#93c5fd">SPOT RATE vs CONTRACT RATE</text>'
 '<polyline points="40,150 90,120 140,135 190,95 240,110 290,70 340,85" fill="none" stroke="#FC5305" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>'
 '<line x1="40" y1="112" x2="340" y2="112" stroke="#fff" stroke-width="3" stroke-dasharray="8 6" opacity=".85"/>'
 '<text x="346" y="90" font-family="Arial,sans-serif" font-size="12" font-weight="800" fill="#FC5305">spot</text>'
 '<text x="346" y="117" font-family="Arial,sans-serif" font-size="12" font-weight="800" fill="#fff">contract</text>'
 '<text x="200" y="182" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" fill="#94a3b8">one truck &#183; one lane &#183; this week &#183; 2026</text></svg>')
SPOT_TOC=[('what-is','What a spot rate actually is'),('spot-vs-contract','Spot rates vs contract rates'),
 ('rates-2026','Where truckload spot rates sit in 2026'),('spread','The spread: carrier rate, broker margin, shipper rate'),
 ('drivers','What moves spot market freight rates week to week'),('find','Where to find spot rates for loads'),
 ('carriers','For carriers: negotiating against the spot rate'),('brokers-shippers','For brokers &amp; shippers: when to go spot, and when not to')]
SPOT_BODY=(
'<p>Every load board, every rate confirmation and every &ldquo;what can you do it for?&rdquo; phone call is really about one number: the <b>spot rate</b>. It is the price of one truck, on one lane, this week &mdash; and it is the most quoted, least understood figure in trucking. Carriers accept it without knowing what it is benchmarked against. Brokers quote it as if it were fixed. Shippers discover it only when their contract carrier stops showing up. This guide explains what spot market freight rates are, how they differ from contract rates, where truckload spot rates sit in 2026, what moves them week to week, where to find them, and how each side of the load should negotiate against them.</p>'
'<div class="callout cl-info"><span class="ic">&#128161;</span><div>Quick answer: a <b>spot rate</b> is the one-time price agreed for a single load moved now, set by how many trucks and how many loads are on that lane this week. A <b>contract rate</b> is a price agreed in advance for a lane over months. In the September 2026 national snapshot on the <a href="market-rates.html">LoadBoot market rates page</a>, the spot benchmark to the carrier runs about <b>$2.97/mile dry van</b>, <b>$3.54 flatbed</b> and <b>$3.56 reefer</b> &mdash; with brokers selling the same freight to shippers roughly 15% higher. Those numbers move every week; the mechanics below do not.</div></div>'

'<h2 id="what-is">What a spot rate actually is</h2>'
'<p>&ldquo;Spot&rdquo; comes from the commodity markets: a spot price is the price for delivery <em>on the spot</em>, today, as opposed to a futures price agreed for later. In trucking the spot market is the pool of loads that are not covered by a standing agreement &mdash; freight that a shipper or broker has to place with whatever truck is available this week, at whatever that truck will accept. The rate that clears that transaction is the spot rate.</p>'
'<p>Three things follow from that definition, and they explain almost every argument about spot freight:</p>'
'<ul>'
'<li><b>It is a market price, not a list price.</b> Nobody sets it. It is the point where the number of available trucks on a lane meets the number of loads needing to move. When trucks outnumber loads, it falls. When loads outnumber trucks, it rises &mdash; sometimes by a dollar a mile in a single week.</li>'
'<li><b>It is lane-specific and direction-specific.</b> A national average is a starting point, not a quote. Outbound from a region that produces more freight than it consumes pays well (a <em>headhaul</em>); the return trip into that region pays poorly (a <em>backhaul</em>), because trucks are already heading there empty.</li>'
'<li><b>It is usually quoted all-in.</b> Most spot quotes bundle the linehaul, the <a href="fuel-surcharge-trucking.html">fuel surcharge</a> and sometimes the accessorials into one number per mile or one flat amount. That is convenient and dangerous: an all-in $3.10 with $0.43 of fuel inside it is a $2.67 linehaul, and the two are very different businesses.</li>'
'</ul>'
'<p>The spot rate is also the number that every other rate in the industry is measured against. Contract rates are negotiated as a discount or premium to it. Broker margins are the gap between two versions of it. And the <a href="how-to-read-a-rate-confirmation.html">rate confirmation</a> you sign is a spot rate frozen into writing for one load.</p>'

'<h2 id="spot-vs-contract">Spot rates vs contract rates</h2>'
'<p>A <b>contract rate</b> is a price a shipper (or a broker on the shipper&rsquo;s behalf) agrees with a carrier for a lane over a term &mdash; typically six to twelve months &mdash; usually through an annual bid. The shipper gets predictable cost and a committed truck; the carrier gets predictable freight. The catch is that a contract rate is a promise about volume and price, not a guarantee of either: when the spot market rises well above the contract, contracted carriers start rejecting tenders and the freight falls into the spot market anyway, at spot prices.</p>'
'<table class="cmp"><thead><tr><th></th><th>Spot rate</th><th>Contract rate</th></tr></thead><tbody>'
'<tr><td>Set by</td><td>This week&rsquo;s supply of trucks vs loads on the lane</td><td>An annual or quarterly bid, agreed months ahead</td></tr>'
'<tr><td>Term</td><td>One load</td><td>Months, with weekly or monthly volume expectations</td></tr>'
'<tr><td>Price in a tight market</td><td>Rises fast; can jump $0.50&ndash;$1.00/mi in weeks</td><td>Lags; carriers reject tenders and the load goes spot</td></tr>'
'<tr><td>Price in a soft market</td><td>Falls fast; brokers cover freight below contract</td><td>Holds above spot until the next bid resets it</td></tr>'
'<tr><td>Fuel</td><td>Often bundled all-in</td><td>Usually linehaul + indexed fuel surcharge</td></tr>'
'<tr><td>Who uses it</td><td>Owner-operators, small fleets, brokers, shippers with surge or one-off freight</td><td>Larger shippers, asset carriers, dedicated fleets</td></tr>'
'</tbody></table>'
'<p>The relationship between the two is a cycle. In a soft market spot sits <em>below</em> contract, brokers buy cheap capacity and shippers wonder why they agreed to their routing guide. In a tight market spot sits <em>above</em> contract, tender rejections climb, and shippers pay spot anyway on the freight their contract carriers turn down. Most owner-operators live entirely in the spot market, which means their income tracks that cycle with no cushion &mdash; the reason a <a href="cost-per-mile-calculator.html">cost-per-mile floor</a> matters more to them than to anyone else in the chain.</p>'

'<h2 id="rates-2026">Where truckload spot rates sit in 2026</h2>'
'<p>The national benchmarks below are the September 2026 snapshot published on the <a href="market-rates.html">LoadBoot market rates page</a>, which refreshes as new national data lands. The <b>carrier</b> column is what the truck is paid per loaded mile; the <b>shipper</b> column is what the freight sells for once a broker&rsquo;s margin sits on top. Treat them as the centre of a range, not a quote: the same dry van load can clear $2.40 on a backhaul and $3.50 on a tight headhaul the same week.</p>'
'<table class="cmp"><thead><tr><th>Equipment</th><th>Carrier spot rate (per mile)</th><th>Shipper rate (per mile)</th><th>Typical range to carrier</th></tr></thead><tbody>'
'<tr><td>Dry van</td><td><b>$2.97</b></td><td>$3.42</td><td>$2.38&ndash;$3.56</td></tr>'
'<tr><td>Reefer</td><td><b>$3.56</b></td><td>$4.09</td><td>$2.85&ndash;$4.27</td></tr>'
'<tr><td>Flatbed</td><td><b>$3.54</b></td><td>$4.07</td><td>$2.83&ndash;$4.25</td></tr>'
'<tr><td>Step deck</td><td><b>$3.59</b></td><td>$4.13</td><td>$2.87&ndash;$4.31</td></tr>'
'<tr><td>Conestoga</td><td><b>$3.64</b></td><td>$4.19</td><td>$2.91&ndash;$4.37</td></tr>'
'<tr><td>Power only</td><td><b>$2.52</b></td><td>$2.90</td><td>$1.80&ndash;$3.50</td></tr>'
'<tr><td>Box truck</td><td><b>$2.52</b></td><td>$2.90</td><td>$2.02&ndash;$3.02</td></tr>'
'<tr><td>Hotshot</td><td><b>$2.35</b></td><td>$2.70</td><td>$1.80&ndash;$3.50</td></tr>'
'</tbody></table>'
'<p>Two things to read out of that table. First, the <b>equipment premium</b>: reefer, flatbed and step deck sit roughly $0.55&ndash;$0.65 a mile above dry van, because the trailer costs more, the freight needs more skill (tarping, securement, temperature control) and fewer trucks compete for it. Second, the <b>range is wider than the average</b>: a $1.20 spread between low and high on dry van means the lane, the day of the week and the negotiation matter as much as the market. Each equipment type has its own live hub &mdash; <a href="dry-van-freight-rates.html">dry van</a>, <a href="reefer-freight-rates.html">reefer</a>, <a href="flatbed-freight-rates.html">flatbed</a>, <a href="hotshot-freight-rates.html">hotshot</a>, <a href="power-only-freight-rates.html">power only</a> &mdash; with lane examples and seasonality.</p>'
+svc_banner('See this week&rsquo;s spot benchmark before you quote or accept',
  'The LoadBoot market rates page shows the carrier rate, the broker buy and sell, and the shipper rate for every equipment type &mdash; free, no login, refreshed as national data lands.',
  'Open live market rates','market-rates.html')+

'<h2 id="spread">The spread: carrier rate, broker margin, shipper rate</h2>'
'<p>There is never one spot rate on a load; there are at least two. The <b>buy rate</b> is what the broker pays the carrier. The <b>sell rate</b> is what the broker charges the shipper. The gap is the broker&rsquo;s gross margin, and it is where most of the mistrust in spot freight lives &mdash; because the carrier only ever sees one side of it.</p>'
'<p>On the LoadBoot benchmark the shipper rate sits about <b>15% above the carrier rate</b>. On a 500-mile dry van load at the September 2026 figures, that looks like this:</p>'
'<table class="cmp"><thead><tr><th>Line</th><th>Per mile</th><th>500-mile load</th></tr></thead><tbody>'
'<tr><td>Shipper pays (sell rate)</td><td>$3.42</td><td><b>$1,710</b></td></tr>'
'<tr><td>Broker gross margin (~15%)</td><td>$0.45</td><td>$225</td></tr>'
'<tr><td>Carrier is paid (buy rate)</td><td>$2.97</td><td><b>$1,485</b></td></tr>'
'<tr><td>Carrier operating cost (ATRI $2.20&ndash;$2.30/mi, incl. 100 mi deadhead = 600 mi)</td><td>~$2.25</td><td>~$1,350</td></tr>'
'<tr><td>Carrier margin before accessorials</td><td>&mdash;</td><td><b>~$135</b></td></tr>'
'</tbody></table>'
'<p>Read the bottom row twice. At an average spot rate, on an average lane, with a normal amount of deadhead, the truck clears about $135 on a $1,710 load &mdash; and that is before a single hour of <a href="detention-pay-policy.html">detention</a>, a <a href="lumper-policy.html">lumper</a> or a cancelled pickup. It is why accessorials are not extras in the spot market; they are the margin. A single unpaid two-hour detention at $60/hour, or one <a href="tonu-policy.html">TONU</a> the broker &ldquo;forgets&rdquo;, wipes out the profit on the whole trip.</p>'
'<p>Broker margins in the wider market are not fixed at 15%. On contract freight they tend to sit in the low-to-mid teens; on spot freight they swing much wider, because the broker committed a sell rate to the shipper before knowing what a truck would cost that day. A broker who priced a load at $3.42 on Monday and can only find a truck at $3.20 on Thursday made 6%. A broker who finds one at $2.60 made 24% &mdash; and the carrier who took $2.60 will never know. The LoadBoot benchmark exists to close exactly that information gap: both sides see the same buy and sell figures before anyone commits. Referral partners who introduce a carrier or a broker earn <a href="agents.html">1% of the freight that follows</a>, which only works if the freight is priced so that everyone stays in business.</p>'

'<h2 id="drivers">What moves spot market freight rates week to week</h2>'
'<p>The spot rate is a supply-and-demand price, so anything that changes the number of trucks or the number of loads on a lane moves it. The recurring drivers, in rough order of how much they matter:</p>'
'<ul>'
'<li><b>Tender rejections.</b> When contracted carriers start turning down loads, that freight spills into the spot market and spot prices rise. Rejection rates are the earliest signal that the market is tightening &mdash; they move before the rate does.</li>'
'<li><b>Seasonality.</b> Produce season lifts reefer rates from spring through summer, starting in the south and moving north; construction season lifts flatbed through summer; retail peak lifts dry van from October into December; January is the annual trough for almost everything. Holiday weeks and the annual roadside inspection blitz in May pull trucks off the road and spike short-term rates.</li>'
'<li><b>Diesel.</b> Fuel moves the all-in spot quote directly through the <a href="fuel-surcharge-trucking.html">fuel surcharge</a> &mdash; roughly $0.23&ndash;$0.47 a mile at $3.85/gal depending on the peg &mdash; and moves the linehaul indirectly, because carriers who cannot cover fuel park trucks, which tightens supply.</li>'
'<li><b>Regional imbalance.</b> Lanes out of freight-heavy regions pay more than lanes into them. Weather, port volumes, a plant shutdown or a harvest can flip a lane&rsquo;s balance in a week.</li>'
'<li><b>Capacity entering and leaving.</b> Trucks are added when rates are high and cut when rates are low, always with a lag. Carrier exits during a long soft market are what eventually turn it: fewer trucks, same freight, higher spot rate.</li>'
'<li><b>Day of the week.</b> Loads posted late Friday for a Monday delivery, or on the day of pickup, pay a premium because the pool of available trucks is smallest. The same lane midweek with a two-day lead pays less.</li>'
'</ul>'
'<p>None of these are secrets. What separates carriers and brokers who earn a living on spot freight from those who do not is simply that they watch these signals before the rate moves rather than after.</p>'

'<h2 id="find">Where to find spot rates for loads</h2>'
'<p>&ldquo;Where do you find spot rates for loads?&rdquo; is one of the most searched questions in the industry, and the honest answer is that there is no single official number &mdash; there are several sources, each showing a different slice of the market:</p>'
'<ul>'
'<li><b>Load boards.</b> The posted rate on a load board is an <em>asking</em> rate, not a market rate: it is what the broker hopes to pay, usually set low and negotiated up. Boards that show a lane average alongside the posting are more useful than boards that only show the ask. Beware of <a href="ghost-loads-load-board-problems.html">ghost loads</a> &mdash; postings with no real freight behind them exist to harvest calls and drag the perceived rate down.</li>'
'<li><b>Paid rate indexes.</b> Subscription rate tools aggregate actual paid invoices and quotes by lane and equipment. They are the closest thing to a true spot benchmark and they cost money; many brokers and larger carriers run one. Their weakness is lag and thin data on minor lanes.</li>'
'<li><b>Free national benchmarks.</b> The <a href="market-rates.html">LoadBoot market rates page</a> publishes the national carrier, broker buy/sell and shipper rates by equipment, plus per-equipment hubs and <a href="freight-market-reports.html">weekly market reports</a>, without a login. Use it to set a floor and a ceiling before a negotiation, not to quote a specific lane.</li>'
'<li><b>The DOE diesel index.</b> Not a freight rate, but the fuel component of one. The weekly EIA/DOE on-highway diesel price is what most fuel surcharges point at, and it tells you how much of an all-in quote is fuel.</li>'
'<li><b>Your own rate confirmations.</b> The best lane data any carrier owns is the stack of rate cons it has already signed. A dispatcher who logs every lane, date and rate builds a private index that beats any national average for the lanes the truck actually runs.</li>'
'<li><b>The phone.</b> Two or three calls to brokers who regularly post the lane will reveal the real clearing rate faster than any tool. Ask what the lane paid last week, not what it pays today.</li>'
'</ul>'
'<p>The mistake is not using the wrong source; it is using one source. A load board ask, a national benchmark and last week&rsquo;s rate con on the same lane triangulate a number nobody can argue with. That is what the <a href="load-score.html">LoadBoot Load Score</a> does automatically: it grades a posted load against the benchmark, the deadhead and the accessorial terms before the carrier calls.</p>'
+svc_banner('Every LoadBoot load is posted against the benchmark, with the terms in writing',
  'Rate, fuel basis, detention, layover, TONU and lumper terms sit on the posting before the truck moves. Carriers pay a flat 5% dispatch fee, no contracts; brokers and shippers post free.',
  'See how it works','how-it-works.html')+

'<h2 id="carriers">For carriers: negotiating against the spot rate</h2>'
'<p>An owner-operator lives on spot rates, so the negotiation is the job. The discipline is not &ldquo;get the highest number&rdquo; &mdash; it is <em>know your floor, know the market, and never confuse the two</em>.</p>'
'<ol>'
'<li><b>Know your cost per mile before you look at a board.</b> Fuel, truck payment, insurance, maintenance, driver pay (or your own), and the empty miles to reach the pickup. The <a href="cost-per-mile-calculator.html">cost-per-mile calculator</a> does this in a minute; the industry average sits around $2.20&ndash;$2.30 per mile, but yours is the only one that matters.</li>'
'<li><b>Price every load on all miles, not loaded miles.</b> A $2.97 load with 100 miles of deadhead on a 500-mile haul pays $2.48 for every mile the truck actually turns. That is the number to compare with your cost, and it is why a $2.75 load with no deadhead can beat a $3.10 load with 150.</li>'
'<li><b>Separate fuel from linehaul.</b> Ask whether the quote is all-in. If it is, subtract the surcharge to see the real linehaul &mdash; that is the part you are negotiating.</li>'
'<li><b>Negotiate the accessorials before the rate.</b> Detention after two hours, layover, TONU and lumper terms decide whether an average load is profitable. Get them on the <a href="how-to-read-a-rate-confirmation.html">rate confirmation</a> in numbers, not &ldquo;per industry standard.&rdquo;</li>'
'<li><b>Use the benchmark as a floor, the lane as a ceiling.</b> A national dry van average of $2.97 is where the conversation starts on an average lane. A tight headhaul out of a busy region should clear well above it; do not accept the average on a lane that is paying a premium this week.</li>'
'<li><b>Walk away from the backhaul trap.</b> Taking a cheap load home is sometimes right and sometimes the most expensive decision of the month. Run the numbers on waiting a day, repositioning fifty miles, or booking a triangle instead of an out-and-back.</li>'
'</ol>'
'<p>A good dispatcher does all six of these on every load, which is what a <a href="how-much-does-a-truck-dispatcher-cost.html">flat 5% dispatch fee</a> buys: on a $1,485 load the fee is about $74, and a single well-negotiated accessorial pays it back. Carriers who prefer to run their own board can apply for a <a href="carrier-application.html">LoadBoot carrier account</a> and use the benchmark and Load Score for free.</p>'

'<h2 id="brokers-shippers">For brokers &amp; shippers: when to go spot, and when not to</h2>'
'<p>For a shipper, spot freight is not good or bad; it is a tool with a cost profile. It is the right tool for surge volume, one-off moves, lanes too thin to bid, and any week the contract carriers are rejecting tenders. It is the wrong tool for steady, predictable lanes in a rising market, where it will cost more every week and the service will get worse as capacity tightens. A routing guide with a spot backstop &mdash; contracted primaries, a broker or a direct carrier pool for the overflow &mdash; is how most freight actually moves.</p>'
'<p>For a broker, the spot market is the whole business, and the risk runs the other way: the sell rate is committed before the buy rate is known. Three habits protect the margin without squeezing the carrier into a service failure:</p>'
'<ul>'
'<li><b>Quote from the benchmark, not from hope.</b> A sell rate built on the actual carrier rate plus a stated margin survives a tight week. A sell rate built on last month&rsquo;s cheap truck does not.</li>'
'<li><b>Publish the accessorial terms with the posting.</b> A load posted with detention, layover, TONU and lumper terms in writing gets covered faster and disputed less. On LoadBoot a load cannot post without its accessorial rate card, so the argument is settled before the truck is dispatched.</li>'
'<li><b>Pay on the record.</b> GPS-stamped arrival and departure times settle detention in minutes; a signed, dated rate confirmation settles everything else. Brokers who pay accessorials promptly get first call on capacity when the market turns &mdash; which is when it matters.</li>'
'</ul>'
'<p>Shippers who want to skip the spread entirely can <a href="ship-direct-to-carrier.html">post freight directly to verified carriers</a>; brokers can post to the same carrier network free and see the buy/sell benchmark on every posting. Either way the spot rate is still the number in the room &mdash; the difference is whether both sides can see it.</p>'
'<p class="small">Rates are national planning references from the LoadBoot market rates snapshot (September 2026), not quotes. Spot rates vary by lane, direction, equipment, season and week &mdash; check the live benchmark and your own rate confirmation before pricing or accepting a load. LoadBoot is a dispatch and carrier-operations platform, not a financial advisor.</p>')
SPOT_FAQ=[
 ('What is the spot rate in trucking?','The spot rate is the one-time price agreed to move a single load now, set by how many trucks and how many loads are on that lane this week. It is different from a contract rate, which is agreed in advance for a lane over a term of months. Most owner-operators and small fleets run almost entirely on spot rates, which is why their income rises and falls with the freight market.'),
 ('What are current spot market freight rates per mile?','In the September 2026 national snapshot on the LoadBoot market rates page, the spot benchmark paid to the carrier is about $2.97 per mile for dry van, $3.56 reefer, $3.54 flatbed, $3.59 step deck, $2.52 power only and $2.35 hotshot, with shippers paying roughly 15% more once a broker margin is added. Those figures move weekly and vary widely by lane and direction &mdash; check the live page and the per-equipment hubs before quoting or accepting.'),
 ('Are spot rates higher than contract rates?','Sometimes. In a tight market, when trucks are scarce, spot rates rise above contract rates and contracted carriers start rejecting tenders, which pushes even more freight into the spot market. In a soft market, when trucks are plentiful, spot rates fall below contract and brokers cover freight cheaply. The two trade places over the freight cycle, which is why shippers keep a contract routing guide with a spot backstop.'),
 ('Where do you find spot rates for loads?','There is no single official number. Load boards show asking rates (usually low), paid subscription indexes aggregate real invoices by lane, free national benchmarks like the LoadBoot market rates page show the carrier, broker buy/sell and shipper rate by equipment, and your own past rate confirmations are the best data for the lanes you actually run. Use at least two sources on the same lane before you negotiate.'),
 ('What is the difference between a spot rate and the linehaul?','A spot quote is usually all-in: it bundles the linehaul (the price for the truck, driver and trailer) with the fuel surcharge and sometimes accessorials. The linehaul is the part you negotiate. An all-in $3.10 per mile with a $0.43 fuel surcharge inside it is a $2.67 linehaul &mdash; always ask whether a quote is all-in before comparing it with another.'),
 ('How do freight brokers make money on spot freight?','A broker sells the load to the shipper at one rate and buys a truck at a lower rate; the gap is the gross margin. On the LoadBoot benchmark that gap is about 15% (for example $3.42 to the shipper versus $2.97 to the carrier on dry van). In the wider spot market it swings from single digits to well over 20%, because the broker commits the sell rate before knowing what a truck will cost that day.')]
PREMIUM_ARTICLES.add('spot-market-freight-rates.html')
BLOGPOSTS += [
 ('spot-market-freight-rates.html',
  'Spot Market Freight Rates 2026: Trucking Spot Rates vs Contract &amp; Where to Find Them',
  'What a spot rate is, how truckload spot rates differ from contract rates, where they sit in 2026 by equipment, what moves them, and where to find spot rates for loads.',
  'The spot rate is the price of one truck, on one lane, this week &mdash; the number every load board and rate con is really about. Here is what it is, what moves it, and how carriers, brokers and shippers should negotiate against it.', ''),
]
RELATED['spot-market-freight-rates.html'] = [('market-rates.html','Live Market Rates Per Mile'),('fuel-surcharge-trucking.html','Fuel Surcharge Guide'),('cost-per-mile-calculator.html','Cost Per Mile Calculator'),('how-to-read-a-rate-confirmation.html','How to Read a Rate Con'),('freight-market-reports.html','Weekly Market Reports'),('ghost-loads-load-board-problems.html','Ghost Loads Explained'),('carrier-application.html','Apply as Carrier')]
rich_article('spot-market-freight-rates.html',
 'Spot Market Freight Rates 2026: Trucking Spot Rates vs Contract &amp; Where to Find Them | LoadBoot',
 'Spot market freight rates explained for 2026: what a trucking spot rate is, how truckload spot rates differ from contract rates, where they sit right now by equipment, what moves them week to week, where to find spot rates for loads, and how carriers, brokers and shippers negotiate against them.',
 'Freight Rates &amp; Spot Market','Spot Market Freight Rates 2026: What Trucking Spot Rates Are, How They Compare to Contract &amp; Where to Find Them',
 'A spot rate is the price of one truck, on one lane, this week. It is the number every load board, rate confirmation and broker phone call is really about &mdash; and the number most carriers negotiate without ever seeing. Here is what it is, where it sits in 2026, what moves it and how to find it before you say yes.',
 10,'spot-market-freight-rates-hero.jpg','Truck on an interstate lane with a weekly spot rate chart overlaid, illustrating spot market freight rates versus contract rates',
 SPOT_TOC, SPOT_BODY, SPOT_FAQ, feat_svg=SPOT_FEAT)
THUMBS['spot-market-freight-rates.html']=SPOT_FEAT
READTIME['spot-market-freight-rates.html']=10
'''
anchor = "\n# ===== ARTICLE : Should an owner-operator buy a truck before the 2027 EPA rule? ====="
assert src.count(anchor) == 1
src = src.replace(anchor, ARTICLE + anchor)

ast.parse(src)
io.open(P, 'w', encoding='utf-8', newline='\n').write(src)
print('OK: build_site.py patched; +%d chars' % (len(src) - len(orig)))
