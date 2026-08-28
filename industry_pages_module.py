# -*- coding: utf-8 -*-
"""
Workstream 02 -- shipper-by-industry pages.

Why these exist (supply-side SEO audit, 25 Aug 2026): no load board on the market
publishes shipper-by-industry pages. DAT, Truckstop, 123Loadboard and TruckSmarter
have none; only the 3PLs do (Uber Freight 8 verticals, C.H. Robinson). That is the
largest unclaimed page-type in load-board search, and every query in it is a
BROKER/SHIPPER query -- the exact demand side that returned zero queries in GSC.

WRITING RULE FOR THIS FILE -- do not break it:
  These are INFORMATION pages about how freight in an industry actually moves --
  equipment fit, temperature and securement law, dock reality, accessorial exposure,
  what belongs on the posting. They are NOT customer-claim pages. LoadBoot has no
  vertical customers yet, so "we serve leading food manufacturers" would be both
  false and, to Google, thin filler. Every factual line here must survive a reader
  who does this for a living. Regulation citations are to the CFR and are checked;
  if you cannot cite it, write the operational reality instead of inventing a rule.

Structure mirrors the layer-1 equipment hubs (build_site.py) so the two link
two-way: each industry page points at the equipment rate hubs its freight rides on,
and the hubs carry the industry pages in RELATED.

build_industry_pages(eq_rates, faq_schema) -> list of page dicts:
  {fname, title, desc, body, schema, related}
Adding a vertical = adding a dict to INDUSTRIES. No other file changes.
"""

INDEX_FNAME = 'freight-shipping-by-industry.html'

_IND_CSS = ('<style>'
 '.ind-hero-note{background:linear-gradient(160deg,#0b1220,#10223B);border:1px solid rgba(8,131,247,.28);'
   'border-radius:16px;padding:20px 22px;margin:26px 0;color:#dbe6f5;font-size:.97rem;line-height:1.75}'
 '.ind-hero-note b{color:#7dd3fc}'
 '.ind-t{width:100%;border-collapse:collapse;margin:20px 0;font-size:.95rem}'
 '.ind-t th{text-align:left;background:#10223B;color:#fff;padding:11px 13px;font-weight:700}'
 '.ind-t td{padding:11px 13px;border-bottom:1px solid #e2e8f0;vertical-align:top}'
 '.ind-t tbody tr:nth-child(even){background:#f8fafc}'
 '.ind-faq{border-left:3px solid #0883F7;padding:2px 0 2px 16px;margin:20px 0}'
 '.ind-faq h3{margin:0 0 6px;font-size:1.05rem}'
 '.ind-faq p{margin:0;color:#475569}'
 '.ind-other{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:22px}'
 '.ind-other a{background:#10223B;color:#fff;padding:8px 14px;border-radius:999px;font-size:.88rem;'
   'text-decoration:none;display:inline-block}'
 '.ind-other a:hover{background:#0883F7}'
 '.ind-eqcard{border:1px solid #e2e8f0;border-radius:14px;padding:18px 20px;margin:14px 0;background:#fff}'
 '.ind-eqcard h3{margin:0 0 8px;font-size:1.06rem}'
 '.ind-eqcard h3 a{color:#0883F7}'
 '.ind-eqcard p{margin:0;color:#475569;font-size:.95rem;line-height:1.7}'
 '.ind-rate{font-size:.86rem;color:#64748b;margin-top:9px;display:block}'
 '</style>')


INDUSTRIES = [

 # =========================================================================
 dict(
  slug='food-and-beverage',
  name='Food &amp; Beverage',
  low='food and beverage',
  title_kw='Food &amp; Beverage Freight Shipping',
  desc="How food and beverage truckload actually moves: the temperature spec that belongs on the load, FSMA duties, reefer vs dry van, lumper fees and dock rejection risk.",
  h1='Food &amp; beverage freight shipping &mdash; <span style="color:#4ade80">what the load actually needs</span>',
  lead="Temperature in writing, a pre-cooled trailer, a washout the receiver will accept, and a dock appointment that does not turn into six hours of detention. This is how food and beverage truckload actually moves in the US, and what to put on the posting so it covers.",
  note=("Food and beverage is the most rejection-prone freight in truckload. A receiver can refuse an entire trailer on a "
        "temperature record alone, and the shipper &mdash; not the carrier &mdash; is the one holding the claim conversation. "
        "Almost all of that risk is decided <b>before the truck is booked</b>, by four things: the operating temperature you "
        "specified, the trailer condition you required, the appointment you gave, and whether the driver was told who unloads."),

  intro=[
   "Food and beverage covers a much wider range of truckload than most posting screens suggest. It runs from frozen protein "
   "at -10&deg;F through fresh produce in the mid-30s, to shelf-stable canned goods and packaged snacks that never see a "
   "reefer at all, to beverages that weigh out a trailer long before they fill it. Those four profiles need different "
   "equipment, different paperwork and different rate expectations, and treating them as one category is the single most "
   "common reason a food load sits on a board.",
   "The other thing that makes this freight distinct is that the regulatory duty runs to the shipper. Under the FDA's "
   "Sanitary Transportation of Human and Animal Food rule (21 CFR Part 1, Subpart O), the shipper is responsible for "
   "specifying in writing the temperature and sanitary conditions the load requires, and for making sure the carrier is "
   "capable of meeting them. The carrier is responsible for supplying suitable equipment, for pre-cooling, and for keeping "
   "records when required. A load posted without a temperature spec has not just been posted badly &mdash; it has been "
   "posted incompletely.",
  ],

  commodities=[
   ('Frozen', 'Protein, seafood, ice cream, frozen prepared meals, frozen bakery. Typically -10&deg;F to 0&deg;F, run in continuous mode.', 'Reefer'),
   ('Fresh / chilled', 'Dairy, deli, fresh protein, prepared salads, eggs. Typically 32&deg;F to 40&deg;F, with a tight tolerance band.', 'Reefer'),
   ('Produce', 'Seasonal fruit and vegetables. Temperature varies by commodity, and many items are ethylene-sensitive or cannot be mixed.', 'Reefer'),
   ('Beverage', 'Bottled water, soft drinks, beer, juice, canned drinks. Usually ambient, and almost always weight-limited rather than space-limited.', 'Dry van'),
   ('Shelf-stable / grocery', 'Canned goods, dry pasta and rice, snacks, cereal, pet food, condiments. Palletised dry van freight moving into DCs.', 'Dry van'),
   ('Protected ambient', 'Chocolate, cooking oils, some baked goods, wine. No refrigeration, but a summer trailer at 130&deg;F will ruin it &mdash; a reefer run on cycle or as a heater.', 'Reefer (protective service)'),
   ('Local distribution', 'Restaurant and convenience-store resupply, farmers-market and specialty routes, multi-stop urban delivery.', 'Box truck'),
  ],

  equip=[
   ('reefer', 'Reefer',
    "The default for anything with a temperature spec, and also for anything that simply must not freeze or cook. Modern "
    "units run either continuous (compressor runs constantly, tightest control, used for fresh and most frozen) or cycle / "
    "start-stop (unit cycles on demand, saves fuel, acceptable for deep-frozen product that will not suffer from swing). "
    "Which mode you need is part of the spec, not a detail to leave to the driver."),
   ('dry-van', 'Dry Van',
    "Beverage, canned goods, dry grocery and pet food. On beverage you will hit the weight ceiling long before the cube "
    "ceiling &mdash; a 53-foot van tops out around 44,000&ndash;45,000&nbsp;lb of payload against an 80,000&nbsp;lb gross "
    "limit, so a full-cube beverage load is usually an illegal load. Post the actual weight."),
   ('box-truck', 'Box Truck',
    "Restaurant resupply, specialty distribution and urban multi-stop work where the economics are stops per day rather "
    "than miles. Liftgate availability and dock height are the two questions that decide whether the delivery happens at all."),
  ],

  spec_h='The temperature spec &mdash; what belongs on the load, in writing',
  spec_intro=("This is the section that decides whether a rejected trailer is your problem or the carrier's. Vague "
              "instructions default the risk back to whoever wrote them."),
  spec=[
   ('Set point, as a number', "Not 'keep cold' or 'refrigerated'. A number with a unit. The reefer is set to what you write down."),
   ('Continuous or cycle mode', "Say which. Fresh and most chilled product needs continuous. Deep-frozen usually tolerates cycle. This changes the carrier's fuel cost and therefore the rate."),
   ('Acceptable tolerance', "The band the receiver will actually accept on the download, not the aspiration. If QA rejects at 41&deg;F, a 38&deg;F set point with no stated band is an argument waiting to happen."),
   ('Pre-cool requirement', "State the temperature the trailer must be at on arrival. A reefer cools air, not product &mdash; a warm trailer loaded with 34&deg;F product will not pull it back down in transit."),
   ('Download / recorder requirement', "Whether you need a printed download at delivery, a portable recorder in the load, or both, and who pays for it."),
   ('Washout standard', "Food-grade washout, wash ticket required, or a broom-clean trailer. Say which, and whether the previous commodity matters &mdash; many receivers will not take a trailer that last hauled raw protein or non-food chemicals."),
   ('Allergen and cross-contamination rules', "Any commodity that cannot ride with this load, and whether the trailer must be sealed and by whom."),
   ('Seal policy', "Who applies the seal, whether the seal number goes on the BOL, and what the driver does if it is broken at a scale or a DOT inspection."),
  ],

  season=[
   ('Jan&ndash;Feb', "The floor for almost everything. Post-holiday grocery volume collapses and reefer capacity is abundant. It is also the hardest stretch for freeze protection in the northern half of the country &mdash; ambient loads that must not freeze quietly need a reefer."),
   ('Mar&ndash;May', "Produce season begins pulling reefers into the growing regions &mdash; Florida, then the Rio Grande Valley, Georgia and the Carolinas. Reefer capacity for everything else starts thinning in those markets first."),
   ('Jun&ndash;Aug', "Peak produce and peak beverage together. This is the tightest reefer stretch of the year and the point where a poorly specified food load simply does not cover. Heat also turns protected-ambient freight into reefer freight."),
   ('Sep&ndash;Nov', "Produce eases, grocery builds hard for the holidays. Volume is high but capacity is returning, so it is generally the most predictable stretch for food shippers."),
   ('Dec', "Sharp drop after the second week, once holiday grocery is in position. Receiving appointments also get scarce &mdash; DCs go into inventory and reduce dock hours."),
  ],

  dock_h='Where food loads lose money at the dock',
  dock=[
   ('Live unload is the norm, and it is slow', "Grocery DCs unload by the pallet with their own crews or a lumper service. Two to four hours is routine; a missed appointment can mean waiting until the next open slot the following day."),
   ('Lumper fees are a food-industry fixture', "Most grocery and foodservice DCs require a third-party lumper to unload, paid at the dock. Say up front who pays and how &mdash; an unfunded driver at a lumper window stops the delivery cold. See the <a href='lumper-policy.html'>lumper fee policy</a>."),
   ('Appointment windows are hard, not advisory', "Grocery receiving runs on scheduled slots. A truck that arrives outside its window may be turned away entirely rather than worked in, which is a TONU on a loaded trailer. See the <a href='tonu-policy.html'>TONU policy</a>."),
   ('Rejection risk sits at the door', "A temperature download outside spec, a broken seal, a pallet-height or pallet-condition failure, or a short-dated product code can reject part or all of a trailer. This is the one industry where the load can be turned away after arriving on time and in good order."),
   ('Detention starts before anyone admits it', "Because live unloads are expected to be slow, food shippers habitually under-count detention. Agree the free-time clock and the rate in writing. See the <a href='detention-pay-policy.html'>detention pay policy</a>."),
   ('Overnight and re-delivery', "A load that misses its window at a DC often has to sit until the next day. That is layover, not detention, and it is priced differently. See the <a href='layover-policy.html'>layover policy</a>."),
  ],

  compliance_h='The rules that actually apply',
  compliance=[
   "<b>FSMA Sanitary Transportation rule (21 CFR Part 1, Subpart O).</b> This is the one that governs food in transit. "
   "It puts the duty to specify sanitary and temperature conditions on the shipper, the duty to supply and operate "
   "suitable equipment on the carrier, and requires that the parties keep the relevant written agreements and records. "
   "It applies to most human and animal food moving in the US, with exemptions including very small businesses, "
   "shelf-stable food fully enclosed by a container, and food that is transhipped through the US. If your posting does "
   "not state a temperature and sanitary requirement, you have not met your side of it.",
   "<b>Bill of lading and the temperature record.</b> The BOL is where the set point, the seal number and the "
   "responsibility for unloading should be written. In a rejection, the download from the reefer unit and the BOL are "
   "the two documents that decide the outcome. Anything agreed only by phone is not evidence.",
   "<b>Carmack and food claims.</b> Interstate truckload freight claims run under the Carmack Amendment, and the "
   "practical effect on food is that condition on delivery is what matters. A carrier that can show a correct set point, "
   "a clean download and an unbroken seal has a strong position; a shipper who never specified a temperature has a weak one.",
   "<b>Weight law on beverage.</b> The federal gross limit is 80,000&nbsp;lb, with 34,000&nbsp;lb on a tandem axle. "
   "Beverage and canned goods reach that before they fill the trailer. Posting a beverage load by pallet count without "
   "a weight is how a truck ends up overweight at the first scale.",
  ],

  post=[
   ('Set point, mode and tolerance', "One line: the number, continuous or cycle, and the band the receiver accepts. This is the single highest-value thing on a food posting."),
   ('Pre-cool and washout requirement', "Trailer temperature on arrival, and the washout standard &mdash; food-grade with a ticket, or broom-clean."),
   ('Actual weight, not pallet count alone', "Especially on beverage, canned goods and pet food. Pallet count without weight is not a spec."),
   ('Who unloads, and who pays the lumper', "Driver-assist, live unload by the receiver's crew, or a lumper service &mdash; and the payment method. Say it before the truck is booked, not at the dock."),
   ('The real appointment window and what happens if it is missed', "Hard appointment or FCFS, the free time, and whether a missed window means a next-day slot. See the <a href='fcfs-policy.html'>FCFS policy</a>."),
   ('Seal, recorder and paperwork requirements', "Who seals, whether a portable recorder rides in the load, and what documents the receiver needs at the door."),
  ],

  faq=[
   ('What temperature should a food load be set to?',
    "There is no single answer &mdash; it is set by the commodity and by the receiver's own QA specification, so it has to "
    "come from the shipper. As a rough map: frozen product typically runs -10&deg;F to 0&deg;F, fresh protein and dairy "
    "32&deg;F to 40&deg;F, and most produce in the mid-30s to low-40s with meaningful variation by item. The number that "
    "matters is the one written on the bill of lading, because that is the number the reefer is set to and the number the "
    "download is judged against."),
   ('Does food freight always need a reefer?',
    "No. Beverage, canned goods, dry grocery, snacks and pet food move in dry vans every day. A reefer is needed when the "
    "product has a temperature spec, and also for protective service &mdash; freeze protection in winter or heat protection "
    "in summer for things like chocolate, wine and cooking oils. That second case is where shippers most often under-spec "
    "and lose product."),
   ('What is FSMA and does it apply to my shipment?',
    "The FDA's Sanitary Transportation of Human and Animal Food rule, at 21 CFR Part 1, Subpart O, covers most human and "
    "animal food moving by truck in the US. It requires the shipper to specify sanitary and temperature requirements in "
    "writing, the carrier to provide suitable equipment and meet those requirements, and both to keep records. There are "
    "exemptions &mdash; very small businesses, shelf-stable food fully enclosed by a container, food transhipped through "
    "the US &mdash; but if you are moving temperature-controlled food domestically you should assume it applies."),
   ('Why do food loads get charged lumper fees?',
    "Most grocery and foodservice distribution centres do not let drivers unload, and use a third-party lumper crew "
    "instead. The fee is charged at the dock, typically to the driver, and reimbursed. It is a normal cost of this freight "
    "rather than an accessorial dispute &mdash; the only thing that goes wrong is when nobody said in advance who pays it. "
    "See the <a href='lumper-policy.html'>lumper fee policy</a>."),
   ('Can a receiver reject a load that arrived on time?',
    "Yes, and this is what makes food different from most truckload. A temperature download outside the accepted band, a "
    "broken or missing seal, damaged pallets, or product with insufficient remaining shelf life can all result in a partial "
    "or full rejection at the door. That is why the spec, the pre-cool and the seal policy are worth more attention than "
    "the rate."),
   ('How much does food and beverage freight cost per mile?',
    "It follows equipment, not industry. Reefer freight carries a premium over dry van because of the unit's fuel and "
    "maintenance cost and because reefer capacity is thinner, and that premium widens sharply during produce season. "
    "Current national benchmarks for both are on the <a href='reefer-freight-rates.html'>reefer rate page</a> and the "
    "<a href='dry-van-freight-rates.html'>dry van rate page</a>."),
  ],

  related=[
   ('reefer-freight-rates.html', 'Reefer Freight Rates'),
   ('dry-van-freight-rates.html', 'Dry Van Freight Rates'),
   ('shipper-solutions.html', 'Shipper Solutions'),
   ('lumper-policy.html', 'Lumper Fee Policy'),
   ('detention-pay-policy.html', 'Detention Pay Policy'),
   ('reefer-dispatch.html', 'Reefer Dispatch'),
  ],
 ),

 # =========================================================================
 dict(
  slug='building-materials',
  name='Building Materials &amp; Construction',
  low='building materials',
  title_kw='Building Materials Freight Shipping',
  desc="How building material freight moves: federal cargo securement rules, flatbed vs step deck deck height, tarping, oversize permits and job-site delivery reality.",
  h1='Building materials freight shipping &mdash; <span style="color:#4ade80">securement, permits and the job-site reality</span>',
  lead="Lumber, drywall, steel, roofing, block, pipe and equipment. What legally holds it down, which deck height keeps you out of permit territory, and why a job-site delivery is not a dock delivery.",
  note=("Building materials is the freight where the <b>law is specific</b>. Cargo securement for lumber, coils, pipe, "
        "boulders and heavy equipment is written commodity by commodity in 49 CFR 393.100&ndash;393.136, and a driver who "
        "gets it wrong is placed out of service at the scale with your material on the deck. The second thing that decides "
        "the price is height: a flatbed deck sits around 60&nbsp;inches, which leaves roughly 8&nbsp;feet 6&nbsp;inches of "
        "legal cargo height before you are into permits. A step-deck buys back about 20 inches of that."),

  intro=[
   "Building materials cover a much wider spread of handling problems than most freight categories. The same posting "
   "screen has to cope with banded lumber that needs tarping, drywall that is heavy and fragile at once, steel coils that "
   "have their own federal securement rule, roof trusses that are long before they are heavy, and excavators that are "
   "neither. What they share is that almost none of it fits in a van, most of it is loaded and unloaded by machine rather "
   "than by dock, and a meaningful share of it delivers to a site rather than a building.",
   "That changes what a good posting looks like. On dry freight the questions are weight, pallet count and appointment. "
   "Here they are dimensions, deck height, tarping, who has the forklift or the crane, and whether the truck can physically "
   "reach the delivery point. A load that is priced right and specified badly still fails &mdash; usually at the site, "
   "with the material on the trailer and nothing to unload it.",
  ],

  commodities=[
   ('Dimensional lumber &amp; panels', 'Banded units of framing lumber, plywood, OSB, engineered joists. Almost always tarped; length drives the tiedown count.', 'Flatbed'),
   ('Drywall &amp; board', 'Gypsum board, cement board, sheathing. Heavy for its cube, easily damaged by weather and by strap pressure without edge protection.', 'Flatbed / Conestoga'),
   ('Steel &amp; metals', 'Coils, plate, structural beams, rebar, tube and pipe. Coils have their own securement rule; beams and rebar are length-driven.', 'Flatbed / Step deck'),
   ('Roofing &amp; insulation', 'Shingle pallets, membrane rolls, batt and rigid insulation. Shingles weigh out fast; insulation cubes out fast.', 'Flatbed / Dry van'),
   ('Masonry &amp; aggregate', 'Block, brick, pavers, bagged cement, cultured stone. Dense, palletised, and usually a forklift delivery.', 'Flatbed'),
   ('Concrete pipe &amp; precast', 'Pipe, vaults, barriers, precast panels. Covered by commodity-specific securement rules and frequently over-dimension.', 'Step deck / Flatbed'),
   ('Trusses, joists &amp; long stock', 'Roof and floor trusses, long-span steel, poles. Length and height rather than weight decide the equipment and the permits.', 'Step deck / Conestoga'),
   ('Construction equipment', 'Excavators, skid steers, lifts, compactors. Ramps or a ramped deck, and securement under the heavy-equipment rule.', 'Step deck / Power only'),
  ],

  equip=[
   ('flatbed', 'Flatbed',
    "The default. Roughly a 60-inch deck height, 48 or 53 feet long, loaded from either side or overhead by forklift or "
    "crane. Because the deck sits high, legal cargo height is only about 8 feet 6 inches before permits &mdash; which is "
    "why tall freight moves to a step deck rather than paying for a permit. Nearly all flatbed building material is tarped."),
   ('step-deck', 'Step Deck',
    "A drop in the deck behind the tractor lowers the main deck to roughly 38&ndash;42 inches, buying back about 20 inches "
    "of legal cargo height &mdash; enough for around 10 feet of freight without a permit. Step decks also usually carry "
    "their own ramps, which is what makes them the standard for wheeled and tracked equipment."),
   ('conestoga', 'Conestoga',
    "A rolling tarp system on a flatbed or step-deck frame. It gives weather protection without manual tarping, which "
    "matters for drywall, finished metal, insulation and anything a tarp can scuff. It costs more per mile and cuts "
    "usable width and height slightly &mdash; the trade is load and unload time and a much lower damage rate."),
   ('hotshot', 'Hotshot',
    "A pickup or medium-duty truck with a gooseneck trailer, generally under about 16,500&nbsp;lb of payload. Its place in "
    "construction is the short-notice shortfall &mdash; the missing bundle, the replacement part, the piece the job needs "
    "tomorrow morning. Priced by urgency far more than by lane."),
  ],

  spec_h='Securement &mdash; what the law actually requires',
  spec_intro=("These are federal rules, not carrier preferences, and they are enforced at roadside. Knowing them changes "
              "how you post the load, because the securement requirement is what sets the loading time and part of the rate."),
  spec=[
   ('The general rule', "Under 49 CFR 393.100&ndash;393.114, the aggregate working load limit of the tiedowns must be at least half the weight of the cargo secured, and cargo must be immobilised or secured against shifting in any direction."),
   ('Tiedown counts by length', "One tiedown for an article up to 5&nbsp;ft and 1,100&nbsp;lb; two if it is up to 5&nbsp;ft but heavier, or between 5 and 10&nbsp;ft at any weight; and for anything over 10&nbsp;ft, two plus one more for every additional 10&nbsp;ft or part of it."),
   ('Commodity-specific rules', "Federal securement is written out separately for logs, dressed lumber, metal coils, paper rolls, concrete pipe, intermodal containers, vehicles, heavy equipment, flattened vehicles, roll-on containers and large boulders &mdash; 49 CFR 393.116 through 393.136. Steel coils and concrete pipe are the two that most often surprise a shipper."),
   ('Edge protection', "Required wherever a strap would be cut or the load crushed. Drywall, finished metal, banded panel goods and painted product all need it, and a shipper who does not supply it should say so."),
   ('Tarping', "Lumber, drywall, insulation and most finished goods are tarped. It is physical work, it takes 30&ndash;60 minutes and it is an accessorial &mdash; state whether the load is tarped, how many tarps, and whether the shipper's crew helps."),
   ('Legal dimensions', "Standard limits are 8&nbsp;ft 6&nbsp;in wide and, in most states, 13&nbsp;ft 6&nbsp;in high overall &mdash; higher in parts of the West. Length limits vary by state and configuration. Anything beyond needs a permit, and often escorts."),
   ('Permits and escorts', "Oversize permits are issued per state, per route, and take time. Escort requirements, curfews and travel-hour restrictions vary widely. A load that is one inch over is a different product with a different lead time. See <a href='oversize-load-rates-per-mile.html'>oversize load rates</a>."),
   ('Weight distribution', "Dense material &mdash; block, brick, coils, bagged cement &mdash; can be legal in gross weight and illegal on an axle. Where the load sits on the deck is a shipper decision as much as a driver one."),
  ],

  season=[
   ('Jan&ndash;Feb', "The annual low. Northern construction is largely frozen out, and flatbed capacity is abundant and cheap. This is the cheapest stretch of the year to reposition material into a Northern yard for spring."),
   ('Mar&ndash;May', "The turn. Construction restarts in the North, spring residential building begins, and flatbed capacity tightens quickly. Rates move faster in this window than at any other point in the year."),
   ('Jun&ndash;Aug', "Peak season for both flatbed and step deck. Construction, infrastructure and roofing all run at once, and it is also the peak of open-deck agricultural and equipment movement. Expect the least give on rate and the least available capacity."),
   ('Sep&ndash;Nov', "Still strong, with a hard push to close out projects before winter. Hurricane and storm activity along the Gulf and Southeast can pull large volumes of roofing, plywood and generators into a region within days."),
   ('Dec', "Falls off quickly after the first two weeks as job sites shut down for the holidays and the Northern building season ends."),
  ],

  dock_h='Job sites are not docks &mdash; what that changes',
  dock=[
   ('There may be no dock at all', "Site deliveries are unloaded by forklift, telehandler, boom truck or crane. Say what is on site and who operates it. A truck arriving where nothing can lift the material off is a wasted day for everyone."),
   ('Ground conditions decide access', "Mud, soft fill, grade, overhead lines and turning radius all decide whether a 53-foot trailer physically reaches the drop point. This is worth a sentence on the posting and, on a difficult site, a phone number."),
   ('Site hours are not business hours', "Many sites take deliveries only in a morning window, and many close entirely in bad weather. A load that misses the window usually waits until the next day &mdash; a layover, not detention. See the <a href='layover-policy.html'>layover policy</a>."),
   ('Driver assist is a real question here', "Whether the driver helps unstrap, untarp or hand-unload is not a courtesy detail on this freight &mdash; it is labour, and it should be priced. See the <a href='driver-assist-policy.html'>driver assist policy</a>."),
   ('Tarping time is unloading time', "Untarping and re-folding tarps on a windy site is 30 to 60 minutes at each end. If your free time does not account for it, you are budgeting detention you did not intend to pay. See the <a href='detention-pay-policy.html'>detention pay policy</a>."),
   ('Cancelled sites happen', "Weather, an inspection failure or a crane that did not show can cancel a site delivery after the truck has already loaded. Agree in advance what that costs. See the <a href='tonu-policy.html'>TONU policy</a>."),
  ],

  compliance_h='The rules that actually apply',
  compliance=[
   "<b>Cargo securement, 49 CFR 393.100&ndash;393.136.</b> This is the governing body of rules for open-deck freight. "
   "The general requirements cover working load limit, tiedown counts and immobilisation; the commodity-specific "
   "sections cover logs, dressed lumber, metal coils, paper rolls, concrete pipe, intermodal containers, automobiles and "
   "light vehicles, heavy vehicles and equipment, flattened vehicles, roll-on/roll-off containers and large boulders. "
   "A securement violation is an out-of-service condition, which means your material stops moving at the roadside.",
   "<b>Size and weight.</b> The federal gross vehicle weight limit on the Interstate system is 80,000&nbsp;lb, with "
   "34,000&nbsp;lb on a tandem axle and bridge-formula limits on spacing. Width is generally 8&nbsp;ft 6&nbsp;in; height "
   "and length limits are set by the states, commonly 13&nbsp;ft 6&nbsp;in high in the East and 14&nbsp;ft in much of the "
   "West. Exceeding any of these moves the load into the permit process.",
   "<b>Oversize and overweight permits.</b> Permits are issued state by state, are route-specific, and can carry curfews, "
   "daylight-only restrictions, escort or pilot-car requirements and holiday blackouts. Lead time is real &mdash; from "
   "same-day in some states to several days in others for a superload. Build it into the schedule rather than the rate "
   "negotiation.",
   "<b>Damage and the tarp question.</b> Most building-material claims are weather and abrasion, not accident. Whether "
   "the load was required to be tarped, and whether edge protection was supplied, is usually the deciding fact in the "
   "claim &mdash; so it should be written on the load, not agreed verbally at pickup.",
  ],

  post=[
   ('Dimensions, not just weight', "Length, width and height of the material as it will sit on the deck, plus total weight. Height is what decides flatbed versus step deck, and therefore whether you are in permit territory."),
   ('Equipment and deck height required', "Say flatbed, step deck or Conestoga and why. If the material is 9 or 10 feet tall, a step deck is not an upgrade &mdash; it is the only legal option without a permit."),
   ('Tarping requirement and tarp count', "Tarped or open, how many tarps, and whether the shipper supplies edge protection. This is a priced accessorial and a common source of dispute."),
   ('How it loads and how it unloads', "Forklift, crane, overhead, side-load, or driven on and off by ramp. Name the equipment available at each end and who operates it."),
   ('Site access details', "Address plus the practical reality: ground conditions, turning space, overhead clearance, delivery window, and a site contact number that will actually be answered."),
   ('Permit status if over-dimension', "Whether permits are already in hand, who is pulling them, and whether escorts are required. Do not leave this to be discovered after booking."),
  ],

  faq=[
   ('Flatbed or step deck &mdash; how do I know which one I need?',
    "Measure the material's height. A flatbed deck sits about 60 inches off the ground, so against a common 13&nbsp;ft "
    "6&nbsp;in overall height limit you have roughly 8&nbsp;ft 6&nbsp;in of legal cargo height. A step deck's main deck "
    "sits around 38&ndash;42 inches, which gives you about 10 feet. If your material is taller than roughly 8&nbsp;ft "
    "6&nbsp;in, a step deck is not a preference &mdash; it is what keeps the load legal without a permit. Step decks also "
    "generally carry ramps, which is why equipment moves on them."),
   ('When is a Conestoga worth paying for?',
    "When the material is damage-sensitive and the tarping is what damages it. Drywall, finished and coated metal, "
    "insulation, and anything with a painted or milled surface are the usual candidates. A Conestoga costs more per mile "
    "and gives up a little usable width and height, but it removes an hour of manual tarping at each end and a large share "
    "of the abrasion claims."),
   ('Who is responsible if the load is not secured properly?',
    "The driver and the carrier carry the regulatory responsibility &mdash; they are the ones cited and placed out of "
    "service under 49 CFR 393. But the shipper controls a great deal of the outcome by how the material is presented: "
    "banding quality, whether edge protection is supplied, how the material is blocked on the deck, and whether the "
    "commodity-specific rule was flagged at all. On coils and pipe in particular, saying what the freight is changes how "
    "it must legally be tied down."),
   ('What makes a load oversize, and how long do permits take?',
    "Generally anything over 8&nbsp;ft 6&nbsp;in wide, over the state height limit &mdash; commonly 13&nbsp;ft 6&nbsp;in, "
    "14&nbsp;ft in much of the West &mdash; or beyond the state length limit for the configuration. Permits are issued per "
    "state and per route, so a multi-state move needs several. Turnaround ranges from same-day in some states to several "
    "days for a genuinely large load, and escorts, curfews and daylight-only restrictions are common. Rates for this work "
    "are on the <a href='oversize-load-rates-per-mile.html'>oversize load rate page</a>."),
   ('Why do building material rates swing so much through the year?',
    "Because the demand is seasonal and the supply is not. Open-deck capacity is roughly constant, but construction "
    "activity collapses in the North in January and February and runs flat out from May through October. The spring turn "
    "is the sharpest move of the year, and a regional storm can pull hundreds of trucks' worth of roofing and plywood into "
    "one market within a week. Current national benchmarks are on the "
    "<a href='flatbed-freight-rates.html'>flatbed rate page</a> and the "
    "<a href='step-deck-freight-rates.html'>step deck rate page</a>."),
   ('Can I ship building materials in a dry van?',
    "Some of it. Palletised shingles, insulation, fasteners, fixtures and boxed finished goods all move in vans, and a van "
    "removes the tarping problem entirely. What rules a van out is anything that has to be loaded or unloaded from the "
    "side or overhead, anything longer than the door opening allows, and any site delivery with no dock &mdash; which is "
    "most job sites. See the <a href='dry-van-freight-rates.html'>dry van rate page</a>."),
  ],

  related=[
   ('flatbed-freight-rates.html', 'Flatbed Freight Rates'),
   ('step-deck-freight-rates.html', 'Step Deck Freight Rates'),
   ('conestoga-freight-rates.html', 'Conestoga Freight Rates'),
   ('oversize-load-rates-per-mile.html', 'Oversize Load Rates'),
   ('shipper-solutions.html', 'Shipper Solutions'),
   ('flatbed-dispatch.html', 'Flatbed Dispatch'),
  ],
 ),

 # =========================================================================
 dict(
  slug='retail-and-ecommerce',
  name='Retail &amp; E-commerce',
  low='retail and e-commerce',
  title_kw='Retail &amp; E-commerce Freight Shipping',
  desc="How retail truckload works: MABD and OTIF windows, ASN and pallet-label requirements, DC appointment portals, drop-trailer programs and where retail chargebacks actually come from.",
  h1='Retail &amp; e-commerce freight shipping &mdash; <span style="color:#4ade80">the window is the product</span>',
  lead="In retail truckload the delivery window is enforced harder than the rate. MABD dates, OTIF scorecards, ASN and label requirements, appointment portals and chargebacks &mdash; how the freight side of a retail programme actually works.",
  note=("Retail is the one vertical where <b>the rules are contractual, not federal</b>. There is no CFR section to cite; "
        "there is the retailer's routing guide, and it is the law of the load. It sets the delivery window, the labelling "
        "and ASN requirements, the appointment process and the penalty for missing any of them &mdash; and it is enforced "
        "with deductions rather than arguments. <b>Early is a violation too.</b> A load that arrives three days before the "
        "must-arrive-by date can be refused or fined exactly like a late one."),

  intro=[
   "Retail and e-commerce freight looks simple from the outside &mdash; palletised goods in a dry van, DC to DC. What "
   "makes it its own discipline is that the receiving side is instrumented. Large retailers score their suppliers on "
   "on-time and in-full performance, publish a routing guide that dictates how freight must be presented, and deduct "
   "against the invoice when it is not. The truckload decision therefore has consequences well beyond the linehaul: a "
   "cheap truck that misses the window can cost more in deductions than the rate saved.",
   "The second thing that shapes this freight is that its volume is violently seasonal and its shape changes with the "
   "channel. Store replenishment is steady, palletised and appointment-driven. E-commerce fulfilment is spikier, often "
   "moves in floor-loaded or mixed configurations, and pulls hard into a handful of weeks a year. Returns run the other "
   "direction entirely, in January, on the same network. Treating all of it as 'retail freight' is how a shipper ends up "
   "with the wrong equipment programme going into Q4.",
  ],

  commodities=[
   ('Store replenishment', 'Palletised general merchandise moving DC to store or DC to DC on a scheduled cadence. Appointment-driven and scorecarded.', 'Dry van'),
   ('Softlines &amp; apparel', 'Hanging garments, cartoned apparel, footwear. Cubes out long before it weighs out; damage and cleanliness matter more than weight.', 'Dry van'),
   ('Hardlines &amp; general merchandise', 'Housewares, tools, electronics, toys, sporting goods. Mixed pallets and high SKU counts, so labelling accuracy is what keeps it moving.', 'Dry van'),
   ('E-commerce fulfilment', 'Inbound to fulfilment centres and parcel injection into carrier hubs. Tighter windows, more floor-loaded freight, sharper peaks.', 'Dry van / Power only'),
   ('Seasonal &amp; promotional', 'Holiday, back-to-school, garden, and dated promotional sets. Value is time-bound &mdash; late is often worse than not at all.', 'Dry van'),
   ('Reverse logistics / returns', 'Store and customer returns consolidating back to processing centres, heavily concentrated in January.', 'Dry van'),
   ('Urban &amp; final-mile resupply', 'Small-format stores, convenience and city-centre locations where a 53-foot trailer cannot legally or physically deliver.', 'Box truck'),
  ],

  equip=[
   ('dry-van', 'Dry Van',
    "The workhorse of retail. A 53-foot van takes 26 pallets floor-loaded or up to 52 double-stacked when the freight "
    "allows, against roughly 44,000&ndash;45,000&nbsp;lb of payload. Most retail freight cubes out first, which is why "
    "pallet configuration and stack height matter more here than weight."),
   ('power-only', 'Power Only',
    "The equipment behind drop-trailer programmes. A preloaded trailer sitting at the dock removes live-load time from "
    "both ends and takes the truck out of the detention queue entirely, which is why high-volume retail lanes drift "
    "towards it. It requires trailer pool capacity at both ends &mdash; that is the real constraint, not the tractor."),
   ('box-truck', 'Box Truck',
    "Small-format and urban stores where a 53-foot trailer cannot turn, park or legally deliver. Dock height and liftgate "
    "availability decide whether the delivery happens; the economics are stops per day rather than miles."),
   ('reefer', 'Reefer',
    "Used in retail as protective service rather than refrigeration: chocolate and confectionery, cosmetics, some "
    "electronics and batteries, and anything travelling through the northern tier in winter that must not freeze. A "
    "summer trailer can exceed 130&deg;F, which ruins more retail freight than cold does."),
  ],

  spec_h='The routing guide &mdash; what retail actually enforces',
  spec_intro=("None of this is federal. All of it is contractual, it varies by retailer, and it is where retail freight "
              "money is actually won and lost. Read the current routing guide; do not work from last year's."),
  spec=[
   ('MABD &mdash; must arrive by date', "The date the purchase order must be delivered by. It is a hard boundary, and on most programmes there is also a not-before boundary. Early delivery is a violation, not a favour."),
   ('OTIF scorecards', "Major retailers score suppliers on on-time and in-full delivery and apply deductions below threshold. The threshold, the measurement method and the fine all vary by retailer and change over time &mdash; treat the current supplier agreement as the only source."),
   ('Appointment portals', "Most large DCs schedule receiving through their own portal. Slots are finite and fill up, so the appointment is often the real constraint on the ship date, not the truck."),
   ('ASN / EDI 856', "The advance ship notice tells the DC what is arriving before it arrives. A missing or inaccurate ASN is one of the most common chargeback causes, and it is a data failure rather than a freight failure."),
   ('Pallet and carton labelling', "GS1-128 pallet licence plates and carton labels in the specified format and position. A correct pallet with an unreadable label is treated as an unidentified pallet."),
   ('Pallet standard and exchange', "Whether the programme runs on pooled pallets, exchange, or one-way pallets, and who owns the balance. This is a real cost line that is frequently left undefined."),
   ('Stack height and overhang', "Maximum pallet height, whether double-stacking is permitted, and no overhang past the pallet edge. Overhang is both a damage cause and a receiving rejection."),
   ('Trailer condition standards', "Many retail programmes specify a clean, dry, odour-free trailer and reject on trailer condition alone &mdash; especially for apparel, food-adjacent goods and anything absorbent."),
  ],

  season=[
   ('Jan&ndash;Feb', "Returns season and the annual volume floor. Freight flows backwards through the network while new inbound volume collapses. Capacity is abundant and cheap."),
   ('Mar&ndash;May', "Spring resets, garden and outdoor sets, and the first serious promotional calendar of the year. Volume climbs steadily and predictably."),
   ('Jun&ndash;Aug', "Back-to-school builds through July and August, and it competes for capacity with peak produce and peak flatbed season. Van capacity is tighter than the retail volume alone would suggest."),
   ('Sep&ndash;Nov', "The hard peak. Q4 inventory has to be in position before the selling season, so this is the stretch with the least schedule flexibility and the highest cost of missing a window. Book capacity ahead rather than in the spot market."),
   ('Dec', "Falls away sharply once holiday inventory is in position, usually after the second week. Receiving appointments also thin out as DCs move into inventory counts."),
  ],

  dock_h='Where retail loads lose money',
  dock=[
   ('The appointment, not the truck, sets the date', "If the DC's portal has no slot until Thursday, the load delivers Thursday regardless of how fast the truck is. Build the appointment into the plan, not into the transit time."),
   ('Early is a violation', "Arriving before the not-before date can mean refusal, a return trip or a deduction. A driver who runs hard and arrives two days early has not helped."),
   ('Live unload queues at big DCs', "High-volume receiving docks run long. Where the volume justifies it, drop-trailer or power-only removes this problem outright rather than managing it."),
   ('Detention is systematically under-counted', "Because slow receiving is normal in retail, free time and detention rates get treated as boilerplate. Agree them explicitly. See the <a href='detention-pay-policy.html'>detention pay policy</a>."),
   ('Chargebacks are mostly data, not driving', "A missing ASN, a mislabelled pallet or a wrong pallet count generates a deduction even on a load that delivered perfectly on time. Fix the data side before renegotiating the rate."),
   ('Reschedules and refusals', "A missed window usually means a new appointment, which is a layover or a redelivery rather than detention. See the <a href='layover-policy.html'>layover policy</a> and the <a href='tonu-policy.html'>TONU policy</a>."),
  ],

  compliance_h='What governs this freight',
  compliance=[
   "<b>The routing guide is the governing document.</b> Unlike food or open-deck freight, retail truckload has no "
   "commodity-specific federal rule. What it has is the retailer's supplier and routing requirements, which cover "
   "delivery windows, appointment procedure, labelling, ASN transmission, pallet standards, trailer condition and the "
   "financial consequence of missing any of them. It is contractual, it differs between retailers, and it is revised "
   "&mdash; the current version is the only one worth reading.",
   "<b>OTIF and chargebacks.</b> On-time-in-full programmes measure the supplier, not the carrier, which is why the "
   "freight decision sits with whoever owns the PO. The practical consequence is that transport cost and deduction cost "
   "have to be looked at together: on a scorecarded programme, the cheapest truck is frequently not the cheapest outcome.",
   "<b>Carmack still applies to the freight itself.</b> Damage, shortage and delay claims on interstate truckload run "
   "under the Carmack Amendment. Retail's contractual penalties sit on top of that, not instead of it &mdash; and the "
   "two are settled through completely different processes.",
   "<b>Urban delivery limits.</b> Small-format and city-centre stores commonly have length, height, weight and time-of-day "
   "restrictions on the streets around them, plus loading-zone rules. These are municipal and they are real: they decide "
   "the equipment before anything else does.",
  ],

  post=[
   ('MABD and the not-before date', "Both boundaries, explicitly. A window with only one end stated is the single most common cause of a refused retail delivery."),
   ('Appointment status', "Whether the appointment is already booked, who books it, and the portal or process involved. If the carrier has to book it, say so before booking the truck."),
   ('Pallet count, stack height and weight', "Pallets, whether they are stackable, the loaded height, and the actual weight. Retail freight usually cubes out, so pallet count without height is not a spec."),
   ('Labelling and ASN responsibility', "Who applies pallet labels, in what format, and who transmits the ASN and when."),
   ('Live load/unload or drop', "Live at both ends, drop at one, or a full drop-and-hook programme &mdash; and where the trailer pool sits. This changes the equipment and the price more than the mileage does."),
   ('Delivery site constraints', "For small-format and urban stores: street restrictions, delivery time windows, dock height, liftgate need and where the truck can legally stop."),
  ],

  faq=[
   ('What is MABD and why does an early delivery get penalised?',
    "MABD is the must-arrive-by date on the purchase order &mdash; the last day the load can be delivered against that PO. "
    "Most retail programmes pair it with an earliest-acceptable date, because a distribution centre schedules labour, "
    "dock doors and put-away capacity against a plan. Freight that shows up days early has no slot, no crew and no "
    "storage assigned to it, so it is refused or accepted with a deduction. Early and late are both misses against the "
    "same window."),
   ('What actually causes retail chargebacks?',
    "In freight terms, far more of them come from data than from driving. A missing or inaccurate ASN, a pallet label in "
    "the wrong format or the wrong position, a pallet count that does not match the paperwork, overhang past the pallet "
    "edge, or a stack height above the programme's maximum will all generate deductions on a load that arrived on time "
    "and undamaged. Fixing the labelling and ASN side is usually cheaper and faster than renegotiating the linehaul."),
   ('When does a drop-trailer or power-only programme make sense?',
    "When the same lane runs often enough that trailer pool capacity at both ends is cheaper than the live-load and "
    "detention time it removes. Drop-and-hook takes the truck out of the receiving queue entirely, which on a slow dock "
    "is worth more than any rate negotiation. The constraint is the trailers, not the tractors &mdash; see the "
    "<a href='power-only-freight-rates.html'>power only rate page</a>."),
   ('Does retail freight ever need a reefer?',
    "Yes, as protective service rather than refrigeration. Chocolate and confectionery, cosmetics, candles, some "
    "electronics and battery products, and anything that must not freeze crossing the northern tier in winter are all "
    "routinely moved in a reefer running on cycle or as a heater. Heat is the more common loss: an unventilated dry van "
    "in summer can exceed 130&deg;F."),
   ('How far ahead should Q4 capacity be booked?',
    "Far enough ahead that you are not competing for it in September. The Q4 build is the least flexible stretch of the "
    "retail year &mdash; the inventory has to be in position before the selling season, so a missed week cannot be made up "
    "later. The spot market during that window prices exactly that inflexibility."),
   ('What does retail truckload cost per mile?',
    "It prices as dry van, because that is what it is &mdash; the retail programme adds requirements, not a different rate "
    "basis. Where retail freight does cost more is in the accessorial tail: detention at slow docks, layover after a "
    "missed appointment, and redelivery. Current dry van benchmarks are on the "
    "<a href='dry-van-freight-rates.html'>dry van rate page</a>."),
  ],

  related=[
   ('dry-van-freight-rates.html', 'Dry Van Freight Rates'),
   ('power-only-freight-rates.html', 'Power Only Freight Rates'),
   ('shipper-solutions.html', 'Shipper Solutions'),
   ('detention-pay-policy.html', 'Detention Pay Policy'),
   ('fcfs-policy.html', 'FCFS &amp; Scheduling'),
   ('box-truck-dispatch.html', 'Box Truck Dispatch'),
  ],
 ),

 # =========================================================================
 dict(
  slug='manufacturing-and-industrial',
  name='Manufacturing &amp; Industrial',
  low='manufacturing and industrial',
  title_kw='Manufacturing Freight Shipping',
  desc="How industrial freight moves: crating and skid design, lift points and centre of gravity, plant receiving rules, JIT window discipline, and when a machine move becomes a permit load.",
  h1='Manufacturing &amp; industrial freight shipping &mdash; <span style="color:#4ade80">crates, lift points and plant rules</span>',
  lead="Machinery, components, resins and fabricated metal. How the crate and the skid decide the equipment, why plant receiving is stricter than a DC, and the point at which a machine move stops being truckload and becomes a permit job.",
  note=("Industrial freight has an asymmetry worth understanding before you price it: <b>the freight is rarely the "
        "expensive part of the failure</b>. A late production part idles a line, and a machine damaged in transit can "
        "push a commissioning date by weeks. That is why this freight tolerates a higher rate for a specified, "
        "properly-equipped truck and almost never tolerates an improvised one."),

  intro=[
   "Manufacturing and industrial covers everything from a pallet of fasteners to a 40,000-pound press. What ties it "
   "together is that the item is usually engineered rather than packaged &mdash; it has lift points, a centre of gravity, "
   "a crate or a skid built for it, and a receiving plant with its own rules about how it may arrive. The freight "
   "decision follows the physical object, not the commodity code.",
   "Two questions settle most industrial postings. First, how does it come off the truck: forklift from the side, "
   "overhead crane, driven off a ramp, or a rigging crew. Second, does it fit inside legal dimensions once it is sitting "
   "on the deck. Get those two right and the rest is ordinary truckload. Get them wrong and you have a truck at a plant "
   "gate with a machine nobody can lift.",
  ],

  commodities=[
   ('Production components', 'Fabricated parts, castings, stampings, sub-assemblies moving between plants on a schedule. Often JIT, where the window matters more than the rate.', 'Dry van'),
   ('Machinery &amp; capital equipment', 'Presses, CNC machines, packaging lines, compressors, generators. Crated or skidded, frequently over standard height once on a deck.', 'Step deck / Flatbed'),
   ('Structural &amp; fabricated metal', 'Weldments, frames, tanks, ductwork, structural assemblies. Length and awkward geometry rather than weight decide the trailer.', 'Flatbed / Step deck'),
   ('Plastics &amp; resins', 'Bagged, boxed and gaylord-packaged resin and compounds. Dense, palletised, and usually weight-limited well before the trailer is full.', 'Dry van'),
   ('Electrical &amp; controls', 'Switchgear, transformers, control panels, cable reels. Damage-sensitive, often tall, and frequently a Conestoga candidate.', 'Conestoga / Dry van'),
   ('MRO &amp; spares', 'Maintenance parts and spares, usually small but time-critical when a line is down.', 'Hotshot / Dry van'),
   ('Plant shuttle &amp; trailer pools', 'Repetitive short moves between plants, warehouses and rail ramps on preloaded trailers.', 'Power only'),
  ],

  equip=[
   ('dry-van', 'Dry Van',
    "Components, resins, packaged parts and anything that fits through the doors and can be blocked and braced inside. "
    "Dense resin and metal parts weigh out around 44,000&ndash;45,000&nbsp;lb long before the trailer is full, so weight "
    "is the number that matters on the posting. Inside the van, dunnage, airbags and load bars are what stop an "
    "engineered part becoming a damage claim."),
   ('step-deck', 'Step Deck',
    "The default for crated machinery. The lower deck &mdash; roughly 38&ndash;42 inches against a flatbed's 60 &mdash; "
    "buys back about 20 inches of legal cargo height, which is frequently the difference between a normal load and a "
    "permit load. Step decks usually carry ramps, so wheeled and tracked equipment drives on and off."),
   ('flatbed', 'Flatbed',
    "Structural steel, tanks, weldments and anything loaded by overhead crane or from the side. Roughly 48,000&nbsp;lb of "
    "legal payload, but the practical limit on industrial freight is height: about 8&nbsp;ft 6&nbsp;in of cargo before "
    "you are into permits."),
   ('conestoga', 'Conestoga',
    "A rolling tarp on a flatbed or step-deck frame. Its place in industrial freight is machined, painted, coated and "
    "electrical equipment &mdash; anything a tarp would scuff and anything that must not be rained on while a crew "
    "figures out the rigging. Costs more per mile, removes an hour of tarping at each end and most of the abrasion risk."),
   ('power-only', 'Power Only',
    "Plant shuttles, rail-ramp drays and repetitive inter-facility moves on preloaded trailers. It takes the truck out of "
    "the loading queue, which at a plant running shift changes is worth more than the rate difference."),
  ],

  spec_h='Crating, lift points and dimensions &mdash; what to establish first',
  spec_intro=("Almost every industrial freight failure traces back to one of these being assumed rather than stated. "
              "None of them are the carrier's to guess."),
  spec=[
   ('Dimensions as it sits on the deck', "Not the machine's dimensions &mdash; the crated or skidded footprint, and the height once it is on a deck. Height plus deck height is what decides flatbed, step deck or permit."),
   ('Actual weight, and where it sits', "Total weight and how it is distributed. A concentrated load can be legal in gross weight and illegal on an axle, and where the crate sits on the deck is a shipper decision as much as a driver one."),
   ('Lift points and centre of gravity', "Marked lift and fork points, and the centre of gravity if it is not obvious. An unmarked machine gets lifted where it looks strongest, which is how frames get bent."),
   ('Crate or skid construction', "Whether the item is crated, skidded, shrink-wrapped or bare, and whether the skid is rated to be forked from all four sides. A skid that can only be lifted one way must be labelled that way."),
   ('Loading method at each end', "Forklift with a stated capacity, overhead crane, gantry, ramp, or a rigging crew. Name the equipment and the capacity, at both origin and destination."),
   ('Tarp or enclosure requirement', "Whether the item must be covered, and whether tarping is acceptable or a Conestoga is required because of the surface finish."),
   ('Securement notes for the item', "Any tie-down points, no-strap zones, or the fact that it falls under a commodity-specific rule &mdash; heavy equipment is covered separately under 49 CFR 393.130."),
   ('Permit status if over-dimension', "If it is over width, height or length: whether permits are in hand, who pulls them, and whether escorts are required. See <a href='oversize-load-rates-per-mile.html'>oversize load rates</a>."),
  ],

  season=[
   ('Jan&ndash;Feb', "Quiet. Industrial output is steady but open-deck capacity is abundant because construction is not competing for it, which makes this the cheapest window of the year to move machinery that is not urgent."),
   ('Mar&ndash;May', "Capital projects restart with the construction season and open-deck capacity tightens noticeably from March onwards."),
   ('Jun&ndash;Aug', "Peak competition for flatbed and step deck. It is also the classic plant-shutdown window &mdash; many facilities take maintenance downtime in July, which is precisely when equipment installs and machine moves get scheduled."),
   ('Sep&ndash;Nov', "Steady and busy, with a push to complete capital installs and commissioning before year end. Open-deck capacity begins easing late in the period."),
   ('Dec', "Falls off with the holiday shutdowns. Plants close, receiving stops, and a machine that arrives on the 23rd sits in a yard until January."),
  ],

  dock_h='Plants receive differently from distribution centres',
  dock=[
   ('The gate is a process, not a door', "Security check-in, safety orientation, PPE requirements and escorted movement on site are normal at industrial facilities. It takes time and it is not detention &mdash; but it should be expected in the schedule."),
   ('Shift changes stop receiving', "Many plants will not unload during a shift change or during the last part of a shift. A truck arriving at the wrong hour waits for reasons no dock schedule shows."),
   ('The forklift capacity is the real constraint', "A plant with a 5,000&nbsp;lb forklift cannot unload an 8,000&nbsp;lb crate no matter how many it has. Confirm the capacity, not just that a forklift exists."),
   ('Rigging is a separate booking', "For a machine that needs a crane or a rigging crew, that crew is booked to a time. A late truck misses a crane window that may not repeat for days &mdash; which is why this freight is scheduled, not spot-booked, whenever possible."),
   ('JIT windows are line-stoppage windows', "On production freight the cost of being late is measured in idle line time, not in freight dollars. Say on the posting when a load is line-critical &mdash; it changes how a carrier plans it."),
   ('No overnight parking on site', "Most plants will not let a truck sit on site overnight, so an early arrival becomes a layover somewhere else. See the <a href='layover-policy.html'>layover policy</a> and the <a href='detention-pay-policy.html'>detention pay policy</a>."),
  ],

  compliance_h='The rules that actually apply',
  compliance=[
   "<b>Cargo securement, 49 CFR 393.100&ndash;393.136.</b> The general rules apply to everything on an open deck: "
   "aggregate working load limit of at least half the cargo weight, and immobilisation against movement in every "
   "direction. Machinery and heavy equipment have their own section &mdash; 393.130 for heavy vehicles, equipment and "
   "machinery &mdash; which is why calling the item what it is on the posting changes how it must legally be tied down.",
   "<b>Size and weight, and where the permit line sits.</b> 80,000&nbsp;lb gross on the Interstate system, "
   "34,000&nbsp;lb on a tandem axle, generally 8&nbsp;ft 6&nbsp;in wide, and a state-set height limit that is commonly "
   "13&nbsp;ft 6&nbsp;in in the East and 14&nbsp;ft across much of the West. Crated machinery lands near that height "
   "constantly, which is the whole reason step decks exist in this vertical.",
   "<b>Oversize and superload permits.</b> Issued per state and per route, with curfews, daylight-only restrictions, "
   "escort or pilot-car requirements and holiday blackouts. Lead times range from same-day to several days, and a genuine "
   "superload can require an engineering review. This is schedule work, not rate work &mdash; start it early.",
   "<b>Hazardous materials.</b> Some industrial freight &mdash; certain resins, coatings, solvents, batteries, compressed "
   "gases &mdash; is regulated hazmat, which requires proper classification, packaging, marking, placarding, shipping "
   "papers and a carrier with the right endorsement. If there is any chance your material is regulated, establish its "
   "classification before posting it, not at the dock.",
  ],

  post=[
   ('Crated dimensions and weight', "Length, width, height as crated, plus weight. State the height explicitly &mdash; it is what decides flatbed versus step deck versus permit."),
   ('Lift points, fork points, centre of gravity', "Marked or described. This is the information that prevents damage, and only the shipper has it."),
   ('Loading and unloading equipment at both ends', "Forklift and its capacity, crane, gantry, ramp or rigging crew &mdash; named for origin and destination separately."),
   ('Cover requirement', "Open, tarped, or Conestoga because of the finish. Say which and why; tarping is priced labour."),
   ('Plant access and receiving rules', "Gate procedure, safety orientation, PPE, receiving hours and any shift-change blackout. A site contact who answers the phone is worth more than a paragraph."),
   ('Whether the load is line-critical', "If a late delivery stops production, say so. It changes routing, buffer time and whether a carrier will take the load at all."),
  ],

  faq=[
   ('How do I know whether my machine needs a step deck?',
    "Add the crated height to the deck height and compare it against the state height limit on your route. A flatbed deck "
    "sits around 60 inches, so against a common 13&nbsp;ft 6&nbsp;in limit you have roughly 8&nbsp;ft 6&nbsp;in of legal "
    "cargo height. A step deck's main deck sits about 38&ndash;42 inches, giving you roughly 10 feet. Crated industrial "
    "machinery lands between those two constantly, which is why the height on the posting matters more than the weight."),
   ('What information does the carrier actually need about a crate?',
    "Dimensions as crated, total weight, lift and fork points, centre of gravity if it is not central, whether the skid "
    "can be forked from all four sides, and any no-strap or no-chain zones on the item. None of that is guessable from "
    "the outside of a crate, and all of it changes how the load is handled and secured."),
   ('When does a machine move stop being truckload?',
    "When it exceeds legal dimensions and needs permits, escorts and a routed survey, or when it needs a rigging crew and "
    "a crane rather than a forklift. At that point the truck is one line item in a project with a schedule of its own. "
    "The transition is gradual and it is worth identifying early &mdash; permit lead times are the part that surprises "
    "people. See <a href='oversize-load-rates-per-mile.html'>oversize load rates</a>."),
   ('Why does a plant delivery take longer than a warehouse delivery?',
    "Because a plant is a controlled site. Gate security, a safety briefing, PPE, escorted movement, and receiving that "
    "stops for shift changes are all normal. Add the fact that the unloading equipment may be shared with production, and "
    "a straightforward delivery can occupy several hours without anyone doing anything wrong. Build it into the free time "
    "rather than discovering it as detention."),
   ('Is my industrial material hazmat?',
    "It may be. Certain resins and compounds, coatings and solvents, lithium batteries and compressed gases fall under the "
    "hazardous materials regulations, which govern classification, packaging, marking, placarding, shipping papers and who "
    "may haul them. This is a determination to make from the safety data sheet before the load is posted &mdash; not "
    "something to resolve while a driver waits at the dock."),
   ('What does industrial freight cost per mile?',
    "It follows the equipment. Van-legal components price as dry van; crated machinery prices as flatbed or step deck, "
    "with a premium for tarping, Conestoga or over-dimension work. Current national benchmarks are on the "
    "<a href='step-deck-freight-rates.html'>step deck</a>, <a href='flatbed-freight-rates.html'>flatbed</a> and "
    "<a href='dry-van-freight-rates.html'>dry van</a> rate pages."),
  ],

  related=[
   ('step-deck-freight-rates.html', 'Step Deck Freight Rates'),
   ('flatbed-freight-rates.html', 'Flatbed Freight Rates'),
   ('dry-van-freight-rates.html', 'Dry Van Freight Rates'),
   ('oversize-load-rates-per-mile.html', 'Oversize Load Rates'),
   ('shipper-solutions.html', 'Shipper Solutions'),
   ('gps-tracking.html', 'GPS Tracking &amp; Proof'),
  ],
 ),

 # =========================================================================
 dict(
  slug='agriculture-and-produce',
  name='Agriculture &amp; Produce',
  low='agriculture and produce',
  title_kw='Agriculture &amp; Produce Freight Shipping',
  desc="How produce and agricultural freight moves: pre-cooling method and pulp temperature, ethylene and mixing rules, the harvest migration that drains reefer capacity, and packhouse loading reality.",
  h1='Agriculture &amp; produce freight shipping &mdash; <span style="color:#4ade80">the load is already spoiling</span>',
  lead="Pre-cooling method, pulp temperature, ethylene and mixing rules, and the harvest migration that drains reefer capacity out of every other market. How agricultural freight actually books, and why the clock starts before the truck arrives.",
  note=("Produce is the only truckload freight where <b>the cargo is deteriorating from the moment it is picked</b>, and "
        "where the truck's job is to slow that down rather than stop it. A reefer cools air, not product &mdash; it "
        "<i>holds</i> a temperature that pre-cooling already achieved. Product loaded warm arrives warm, whatever the set "
        "point says, and that single misunderstanding causes more produce rejections than equipment failure does."),

  intro=[
   "Agriculture is two very different freight problems wearing one label. One is perishable: fresh produce moving from a "
   "packhouse or cooler to a distribution centre against a shelf-life clock, in a reefer, with a temperature record that "
   "will be read at the receiving door. The other is not perishable at all: hay, bagged feed and seed, fertiliser, "
   "irrigation pipe, nursery stock and farm machinery, most of which rides on an open deck and prices like construction "
   "freight.",
   "What makes the perishable half distinctive is that its capacity is seasonal and geographic at the same time. The "
   "harvest moves up the country through the year, and reefer capacity moves with it &mdash; which is why a food shipper "
   "in Ohio finds reefers scarce and expensive in July for reasons that have nothing to do with Ohio. Understanding that "
   "migration is worth more than any negotiating tactic.",
  ],

  commodities=[
   ('Fresh produce &mdash; field to cooler', 'Vegetables, berries, melons, citrus, leafy greens. Pre-cooled by hydro, forced-air, vacuum or icing depending on the item, then held.', 'Reefer'),
   ('Tree fruit &amp; storage crops', 'Apples, pears, potatoes, onions. Often moving from controlled-atmosphere storage rather than straight from harvest, which changes the season entirely.', 'Reefer'),
   ('Nursery, greenhouse &amp; floral', 'Live plants, sod, cut flowers. Temperature, ventilation and light exposure all matter, and the freight is fragile in ways pallets do not protect against.', 'Reefer / Dry van'),
   ('Hay, forage &amp; straw', 'Baled hay and forage. Bulky, light for its cube, tarped, and length-driven on securement.', 'Flatbed'),
   ('Bagged inputs &mdash; feed, seed, fertiliser', 'Palletised bags and totes. Dense, weight-limited, and moisture-sensitive.', 'Dry van / Flatbed'),
   ('Farm machinery &amp; implements', 'Tractors, harvesters, planters, irrigation equipment. Driven on and off by ramp; frequently over standard width.', 'Step deck'),
   ('Processed &amp; packaged ag', 'Milled, bagged, canned and boxed products moving out of processing plants on a normal grocery cadence.', 'Dry van'),
  ],

  equip=[
   ('reefer', 'Reefer',
    "The whole perishable side. Beyond the set point, produce reefers need airflow: air chutes, pallet configuration that "
    "lets air move through the load rather than around it, and continuous mode for most fresh items. Some commodities "
    "also ship with top ice or in a vented configuration. What a reefer cannot do is remove field heat &mdash; that is "
    "the packhouse's job, done before the truck arrives."),
   ('flatbed', 'Flatbed',
    "Hay, forage, irrigation pipe, bulk-bagged inputs and equipment. Hay is a length-and-tarp problem rather than a "
    "weight one; the tiedown count follows article length under 49 CFR 393, and tarping is real work in a field with wind."),
   ('step-deck', 'Step Deck',
    "Farm machinery. The lower deck plus ramps is what lets a tractor or harvester be driven on and off, and the extra "
    "roughly 20 inches of legal cargo height keeps a tall implement out of permit territory. Wide implements often need "
    "permits regardless of height."),
   ('dry-van', 'Dry Van',
    "Bagged feed and seed, packaged processed product, and anything that does not need temperature control but does need "
    "to stay dry. Dense bagged goods weigh out around 44,000&ndash;45,000&nbsp;lb, so post the weight, not just the pallet count."),
  ],

  spec_h='The cold chain &mdash; what has to be settled before the truck arrives',
  spec_intro=("Almost every one of these is the shipper's to state and the packhouse's to execute. A carrier cannot fix "
              "any of them once the doors are shut."),
  spec=[
   ('Pre-cooling method and completion', "Hydro, forced-air, vacuum, room or ice, and confirmation that field heat is out before loading. This is the single most consequential line in produce freight."),
   ('Pulp temperature at loading', "The product's internal temperature, taken and recorded at load. It is the number a rejection argument is settled on, and it is not the same as the air temperature in the trailer."),
   ('Set point and mode', "The hold temperature as a number, and continuous or cycle. Most fresh produce needs continuous; the set point holds what pre-cooling achieved rather than pulling temperature down."),
   ('Airflow and loading pattern', "Whether the load is pinwheeled, offset or straight-stacked, whether an air chute is required, and how far the load must sit off the rear doors. Airflow failures look exactly like equipment failures on the download."),
   ('Ethylene and mixing restrictions', "Which commodities cannot ride together. Ethylene producers accelerate ripening in ethylene-sensitive items, and some items simply share odour. State the restrictions rather than assuming a mixed load is fine."),
   ('Top ice or special packaging', "Whether the load ships iced, in vented packaging, or under a specific pallet configuration &mdash; all of which change weight, airflow and how it must be handled."),
   ('Recorder requirement', "Whether a portable recorder rides in the load in addition to the unit's own download, and who supplies and reads it."),
   ('Inspection and rejection procedure', "What happens at destination if the product is downgraded &mdash; who calls the inspection, who decides on a diversion, and who pays for the truck while that is decided."),
  ],

  season=[
   ('Jan&ndash;Mar', "Florida, southern Texas and imports through the southern border and southeastern ports carry the winter deal. Reefer capacity concentrates hard into those origins and is thin leaving them."),
   ('Apr&ndash;May', "The Rio Grande Valley, Georgia and the Carolinas come on. This is the beginning of the annual migration that pulls reefers out of general freight nationwide."),
   ('Jun&ndash;Aug', "The peak. California's Central Valley, the Pacific Northwest and the upper Midwest all run at once, and reefer capacity is at its tightest of the year for every shipper in the country, produce or not."),
   ('Sep&ndash;Nov', "Tree fruit, potatoes, onions and storage crops. Volume stays real but shifts to storage-crop origins, and general reefer capacity begins returning to the rest of the market."),
   ('Dec', "The quietest stretch. Domestic harvest is largely done, the winter deal has not fully started, and reefer capacity is abundant."),
  ],

  dock_h='Packhouses and fields do not load like docks',
  dock=[
   ('The load waits for the pick', "Produce is frequently loaded as it is packed. A truck scheduled for the morning can wait most of a day because the harvest ran slow, and nobody involved considers that unusual."),
   ('First-come is the norm at sheds', "Many packing sheds run first-come rather than appointment, so arrival order decides the day. See the <a href='fcfs-policy.html'>FCFS policy</a>."),
   ('Detention here is structural, not exceptional', "Long waits are built into how this freight loads, which is exactly why free time and detention rates must be agreed in writing rather than assumed. See the <a href='detention-pay-policy.html'>detention pay policy</a>."),
   ('Cancelled and short loads happen', "Weather, a failed grade or a slow pick can cut a load in half or cancel it after the truck has arrived. Agree in advance what that costs. See the <a href='tonu-policy.html'>TONU policy</a>."),
   ('Receiving windows are unforgiving', "Produce receivers hold tight appointment windows because their own downstream schedule is tight. A missed window on perishable freight is not simply rescheduled &mdash; it can cost the load."),
   ('Rejection is a live commercial event', "A downgraded load at the door has to be diverted, discounted or dumped within hours, and the truck is part of that decision. Know in advance who makes it and who pays for the waiting."),
  ],

  compliance_h='The rules that actually apply',
  compliance=[
   "<b>FSMA Sanitary Transportation rule (21 CFR Part 1, Subpart O).</b> It applies to produce and animal feed in transit "
   "just as it does to packaged food: the shipper specifies the sanitary and temperature requirements in writing, the "
   "carrier supplies suitable equipment and meets them, and the relevant agreements and records are kept. Exemptions "
   "exist &mdash; very small businesses, food fully enclosed by a container, food transhipped through the US &mdash; but "
   "a temperature-controlled domestic produce move should be assumed to be covered.",
   "<b>Trailer condition and prior commodity.</b> Produce receivers commonly refuse a trailer on washout grounds alone, "
   "and some will not accept one that previously hauled raw protein, animal products or non-food loads. Whether you "
   "require a food-grade washout with a ticket is a spec, not an assumption.",
   "<b>PACA and why rejections escalate fast.</b> The Perishable Agricultural Commodities Act governs the commercial "
   "relationship between produce buyers and sellers, not the carrier directly &mdash; but it is the reason a rejected or "
   "downgraded load turns into a formal dispute with a short clock. The freight documents, the pulp temperatures and the "
   "unit download are the evidence that decides where the loss lands.",
   "<b>Open-deck rules on the non-perishable half.</b> Hay, equipment and bagged inputs fall under ordinary cargo "
   "securement, 49 CFR 393.100&ndash;393.136, with tiedown counts set by article length. Farm implements are frequently "
   "over 8&nbsp;ft 6&nbsp;in wide and need permits even when they are not tall. Note also that some agricultural "
   "operations use federal hours-of-service agricultural exemptions within a set radius during planting and harvest &mdash; "
   "check whether your movement actually qualifies rather than assuming it does.",
  ],

  post=[
   ('Commodity, pulp temperature and set point', "What it is, what temperature it will be at loading, and what it must be held at. All three, in writing."),
   ('Pre-cooling status', "Whether the product is pre-cooled and by what method, and whether the truck is expected to wait for it."),
   ('Airflow and loading configuration', "Pallet pattern, air chute requirement, and clearance from the rear doors. This prevents a load that fails on the download despite a correct set point."),
   ('Mixing restrictions', "Anything that cannot ride with this commodity, and whether the trailer must be dedicated."),
   ('Realistic load time and the free-time clock', "If the load waits for the pick, say so and price it. A truck that expected two hours and waited nine will not come back."),
   ('Washout standard and prior-load restrictions', "Food-grade with a ticket, or broom-clean, and any restriction on the previous commodity."),
  ],

  faq=[
   ('Does the reefer cool the produce down?',
    "No, and this is the most expensive misunderstanding in produce freight. A refrigeration unit conditions air and holds "
    "a temperature; it is not sized to remove field heat from a full trailer of product. Pre-cooling &mdash; hydro-cooling, "
    "forced-air, vacuum cooling or icing, depending on the commodity &mdash; happens at the packhouse before loading. "
    "Product loaded warm arrives warm, and the download will show a set point that was correct the whole way."),
   ('Why does airflow matter as much as temperature?',
    "Because the unit can only hold what the air can reach. A load stacked tight against the rear doors, or blocking the "
    "return air path, will develop hot spots even with a perfect set point &mdash; and the resulting rejection looks "
    "identical to an equipment failure. Pallet pattern, air chutes and rear-door clearance are part of the temperature "
    "spec, not separate from it."),
   ('What are ethylene restrictions and why do they stop a mixed load?',
    "Some commodities release ethylene as they ripen and others are highly sensitive to it, so putting them in the same "
    "trailer accelerates ripening or causes physiological damage in the sensitive item. There are also odour-transfer "
    "pairs that ruin flavour. The restrictions are commodity-specific and the shipper is the only party who knows them "
    "&mdash; a carrier who is not told will build a legal, well-secured, commercially ruined load."),
   ('Why is reefer capacity tight in my market during the summer?',
    "Because of the harvest migration. Reefers follow the produce season up the country &mdash; Florida and south Texas in "
    "winter, the Rio Grande Valley and the Southeast in spring, California, the Pacific Northwest and the upper Midwest "
    "through the summer. When those regions are loading, reefers leave everywhere else, and every reefer shipper in the "
    "country pays for it regardless of what they haul. Current benchmarks are on the "
    "<a href='reefer-freight-rates.html'>reefer rate page</a>."),
   ('What happens if the load is rejected or downgraded at delivery?',
    "It becomes a commercial decision within hours: divert to a secondary buyer, discount, or dispose. The freight side of "
    "that is who directs the truck and who pays for the time while the decision is made &mdash; which is worth agreeing "
    "before it happens rather than during. The pulp temperatures at loading, the unit download and the bill of lading are "
    "what determine where the loss actually lands."),
   ('Does hay or farm equipment price like produce?',
    "No &mdash; it prices as open-deck freight, alongside construction material, and it competes for the same flatbed and "
    "step-deck capacity through the same summer peak. Hay is a tarping and tiedown-count problem; implements are usually "
    "a width and permit problem. See the <a href='flatbed-freight-rates.html'>flatbed</a> and "
    "<a href='step-deck-freight-rates.html'>step deck</a> rate pages."),
  ],

  related=[
   ('reefer-freight-rates.html', 'Reefer Freight Rates'),
   ('flatbed-freight-rates.html', 'Flatbed Freight Rates'),
   ('reefer-dispatch.html', 'Reefer Dispatch'),
   ('detention-pay-policy.html', 'Detention Pay Policy'),
   ('fcfs-policy.html', 'FCFS &amp; Scheduling'),
   ('shipper-solutions.html', 'Shipper Solutions'),
  ],
 ),

 # =========================================================================
 dict(
  slug='metals-and-steel',
  name='Metals &amp; Steel',
  low='metals and steel',
  title_kw='Metals &amp; Steel Freight Shipping',
  desc="How steel freight moves: the federal metal-coil securement rule, why steel weighs out on a fraction of the deck, mill loading queues, mill certs and when a single piece needs a permit.",
  h1='Metals &amp; steel freight shipping &mdash; <span style="color:#4ade80">coils, concentration and mill time</span>',
  lead="Coils, plate, structural, rebar and tube. The federal coil rule, why a legal gross weight can still be an illegal axle, what a mill queue does to a schedule, and the paperwork that travels with the metal.",
  note=("Steel breaks the normal truckload intuition in two ways. First, it <b>weighs out on a fraction of the deck</b> "
        "&mdash; a load can be perfectly legal at 80,000&nbsp;lb gross and still be illegal on an axle because of where "
        "it sits. Second, <b>metal coils have their own federal securement rule</b>, 49 CFR 393.120, written separately "
        "for eyes crosswise, eyes lengthwise and eyes vertical. Calling the freight what it is on the posting changes how "
        "it must legally be tied down."),

  intro=[
   "Metals freight is dense, concentrated and unforgiving. A flatbed's legal payload is roughly 48,000&nbsp;lb, and a "
   "steel load frequently reaches that using ten feet of a forty-eight-foot deck. That single fact drives most of what is "
   "different about this vertical: placement on the deck is a legal question, not a convenience; blocking and dunnage are "
   "load-bearing rather than protective; and a securement failure on a heavy, concentrated, high-energy load is a "
   "different category of event from a shifted pallet.",
   "The second thing that shapes it is where it loads. Mills, service centres and scrap yards run overhead cranes and "
   "queues, not dock doors and appointments. Load times measured in hours are normal, scale tickets and heat numbers "
   "travel with the metal, and the receiving end is often a fabrication shop with one crane and a schedule of its own. "
   "None of that shows up on a rate comparison, and all of it shows up on the invoice.",
  ],

  commodities=[
   ('Coils &mdash; hot and cold rolled', 'Steel and aluminium coil. Governed by their own federal securement rule; frequently a single piece heavy enough to be the whole load.', 'Flatbed / Step deck'),
   ('Plate &amp; sheet', 'Cut plate, sheet bundles, blanks. Extremely dense, so placement and blocking decide axle legality.', 'Flatbed'),
   ('Structural &mdash; beams, angle, channel', 'Wide flange, I-beam, angle and channel. Length drives the tiedown count and, past state limits, the permit.', 'Flatbed / Step deck'),
   ('Rebar &amp; mesh', 'Bundled reinforcing bar and mesh, tied to the construction cycle. Length-driven and usually untarped.', 'Flatbed'),
   ('Tube, pipe &amp; bar stock', 'Round and square tube, pipe, bar. Rolling cargo &mdash; blocking and chocking are the whole securement problem.', 'Flatbed'),
   ('Coated &amp; finished metal', 'Galvanised, pre-painted and polished product where surface finish is the value. Tarp abrasion is the main claim source.', 'Conestoga'),
   ('Castings, forgings &amp; fabricated', 'Machined and fabricated pieces, often crated or skidded, sometimes over-dimension.', 'Step deck / Flatbed'),
   ('Scrap &amp; recycled metal', 'Baled, shredded or loose scrap moving to mills. Priced off commodity markets, so volume swings with them.', 'Flatbed / Power only'),
  ],

  equip=[
   ('flatbed', 'Flatbed',
    "The default for almost all of it. Roughly 48,000&nbsp;lb of legal payload, loaded by overhead crane or from the side. "
    "On steel, the binding constraint is almost never space &mdash; it is weight distribution, coil securement and, on "
    "long structural, the tiedown count and the length limit."),
   ('step-deck', 'Step Deck',
    "For pieces that are tall as well as heavy, and for crated fabricated work. The lower deck &mdash; about "
    "38&ndash;42 inches against a flatbed's 60 &mdash; keeps roughly 10 feet of cargo legal without a permit, and shifts "
    "the centre of gravity down on an already heavy load."),
   ('conestoga', 'Conestoga',
    "The answer for galvanised, pre-painted, polished and otherwise finished metal, where a tarp is itself the damage "
    "risk. It costs more per mile and gives up a little usable width and height, and it removes both the manual tarping "
    "hour at each end and most of the abrasion claims."),
   ('power-only', 'Power Only',
    "Mill and service-centre shuttles, scrap runs and repetitive short hauls on preloaded trailers. It takes the truck "
    "out of the mill queue, which on a facility that loads by crane is often the single largest cost in the move."),
  ],

  spec_h='Securement and weight &mdash; the two things that stop this freight',
  spec_intro=("Metals is the vertical where the federal rules are most specific and the physics is least forgiving. "
              "These are the items to establish before the load is posted."),
  spec=[
   ('Metal coils &mdash; 49 CFR 393.120', "Coils have their own rule, with separate requirements for eyes crosswise, eyes lengthwise and eyes vertical, and for coils grouped in rows. Coil racks, timber cradles and chocks are part of the securement, not accessories. Say what the coil is and how it will sit."),
   ('The general securement rule still applies', "Aggregate working load limit of at least half the cargo weight, and immobilisation in every direction &mdash; 49 CFR 393.100&ndash;393.114. On dense freight this drives the number of chains, not the number of straps."),
   ('Tiedown counts by article length', "One tiedown up to 5&nbsp;ft and 1,100&nbsp;lb; two if heavier or between 5 and 10&nbsp;ft; and over 10&nbsp;ft, two plus one for every additional 10&nbsp;ft or part of it. Structural and bar stock hit this constantly."),
   ('Weight concentration and axle placement', "A load can be legal at 80,000&nbsp;lb gross and illegal on a tandem, which is capped at 34,000&nbsp;lb, purely because of where it sits. On steel, deck placement is a legal calculation."),
   ('Blocking, dunnage and chocking', "For pipe, tube and bar, blocking and chocking are the securement. Who supplies the dunnage and whether the shipper blocks the load is a real question with a cost attached."),
   ('Edge protection', "Required wherever a chain or strap would bite into product or be cut by it. On finished and coated metal it is the difference between a clean delivery and a claim."),
   ('Tarping', "Hot-rolled and structural frequently ship open; coated, painted and finished product is tarped or moved under a Conestoga. State which, and how many tarps &mdash; it is priced labour."),
   ('Paperwork that travels with the metal', "Mill test certificates, heat numbers and scale tickets. Missing certs stop the metal at receiving even when the freight was flawless."),
  ],

  season=[
   ('Jan&ndash;Feb', "The low. Construction demand is frozen out of the northern half of the country and open-deck capacity is abundant. The cheapest window of the year for steel that is not urgent."),
   ('Mar&ndash;May', "Construction restarts and flatbed capacity tightens quickly. Rebar and structural volumes move first and hardest."),
   ('Jun&ndash;Aug', "Peak open-deck competition &mdash; steel is bidding against construction material, farm equipment and machinery for the same trailers. Least give on rate all year."),
   ('Sep&ndash;Nov', "Still strong, with projects pushing to close out before winter. Service-centre inventory movement stays steady into the autumn."),
   ('Dec', "Falls away with the construction shutdown, though mill and service-centre shipping continues at a reduced level through the month."),
  ],

  dock_h='Mills, service centres and fab shops',
  dock=[
   ('Mill queues are measured in hours', "Loading is by overhead crane in a sequence you do not control. A half-day at a mill is routine, and it is the largest single cost item most steel shippers under-budget. See the <a href='detention-pay-policy.html'>detention pay policy</a>."),
   ('The crane, not the dock, is the constraint', "At both ends. If the receiving fab shop has one crane and it is busy, the truck waits regardless of the appointment. Confirm crane or forklift capacity against the heaviest single piece."),
   ('Scale tickets and heat numbers', "Weighing is part of loading, and the paperwork travels with the metal. A load that cannot be identified to a heat number can be refused at receiving on documentation alone."),
   ('Tarping a steel load takes real time', "Thirty to sixty minutes at each end, more in wind, and it is physical work on a high deck. If the free-time clock does not include it, you are budgeting detention you did not intend to pay. See the <a href='driver-assist-policy.html'>driver assist policy</a>."),
   ('Reload restrictions after certain commodities', "Some finished-metal receivers will not accept a trailer that last carried scrap or anything that could mark the product. Worth stating rather than discovering."),
   ('A cancelled crane is a cancelled day', "If the receiving crane or crew is unavailable, the load does not deliver. Agree in advance what that costs. See the <a href='tonu-policy.html'>TONU policy</a> and the <a href='layover-policy.html'>layover policy</a>."),
  ],

  compliance_h='The rules that actually apply',
  compliance=[
   "<b>Metal coils, 49 CFR 393.120.</b> This is the section that makes steel different. It sets out requirements "
   "separately for coils transported with eyes crosswise, eyes lengthwise and eyes vertical, and for coils grouped in "
   "rows, including the use of coil racks, timber and chocks. It sits inside the wider commodity-specific set at "
   "393.116&ndash;393.136, which also covers concrete pipe, paper rolls, heavy equipment and more. A coil described "
   "simply as 'steel' on the posting has not been described.",
   "<b>General securement, 49 CFR 393.100&ndash;393.114.</b> Aggregate working load limit of at least 50 percent of the "
   "cargo weight, immobilisation against movement in every direction, and tiedown counts driven by article length. A "
   "violation is an out-of-service condition &mdash; your metal stops at the roadside, not at the receiver.",
   "<b>Weight law, and why steel hits it differently.</b> 80,000&nbsp;lb gross on the Interstate system, "
   "34,000&nbsp;lb on a tandem axle, and bridge-formula limits based on axle spacing. Because dense metal occupies a "
   "small footprint, a compliant gross weight in the wrong deck position produces an illegal axle. This is a loading "
   "decision made at the shipper's yard.",
   "<b>Permits on single heavy or long pieces.</b> Long structural, large fabricated assemblies and single heavy pieces "
   "cross into overweight or over-dimension territory quickly. Permits are issued per state and per route, with curfews, "
   "escort requirements and lead times that range from same-day to several days. See "
   "<a href='oversize-load-rates-per-mile.html'>oversize load rates</a>.",
  ],

  post=[
   ('Exactly what the metal is', "Coil, plate, structural, rebar, tube, coated product &mdash; and for coils, the orientation. This is what determines which federal rule applies."),
   ('Piece weights, not just total weight', "The heaviest single piece decides the crane or forklift needed at both ends, and drives the axle-placement question."),
   ('Dimensions of the longest and tallest piece', "Length sets the tiedown count and the permit threshold; height decides flatbed versus step deck."),
   ('Tarping and edge protection', "Open, tarped or Conestoga, how many tarps, and who supplies edge protection for coated and finished product."),
   ('Blocking and dunnage responsibility', "Whether the shipper blocks and chocks the load and supplies the timber, or whether the carrier is expected to."),
   ('Loading and unloading equipment', "Overhead crane, gantry, forklift and its capacity &mdash; stated separately for origin and destination, along with realistic load and unload times."),
  ],

  faq=[
   ('Why do steel coils have their own securement rule?',
    "Because of the physics. A coil is heavy, dense, round and capable of rolling or sliding with enormous force, and the "
    "way it must be restrained depends entirely on how it sits &mdash; eyes crosswise, eyes lengthwise or eyes vertical "
    "each present a different failure direction. 49 CFR 393.120 therefore writes out the requirements separately for each "
    "orientation and for coils grouped in rows, including coil racks, timber cradles and chocks. This is also why "
    "describing your freight accurately on the posting is a safety matter, not a formality."),
   ('How can a load be legal at 80,000 lb and still get a ticket?',
    "Because gross weight and axle weight are separate limits. The federal tandem limit is 34,000&nbsp;lb, with bridge-"
    "formula limits based on axle spacing. Steel reaches full payload using a short section of deck, so putting that "
    "weight in the wrong place overloads an axle while the gross stays compliant. Deck placement on dense freight is a "
    "legal calculation, and it is made at the shipper's yard."),
   ('When should coated or finished metal move under a Conestoga?',
    "When the surface finish is the value. Galvanised, pre-painted and polished product is damaged by tarp abrasion, by "
    "strap pressure without edge protection, and by the handling that tarping itself involves. A Conestoga costs more per "
    "mile and gives up a little usable width and height, and it usually pays for itself on the claim rate alone. See the "
    "<a href='conestoga-freight-rates.html'>Conestoga rate page</a>."),
   ('Why does loading at a mill take so long?',
    "Because mills load by overhead crane in their own sequence, not by dock appointment. The crane serves the mill's "
    "production priorities first, and a truck joins a queue it cannot influence. Half a day is normal. The realistic "
    "responses are to price the free time honestly, or to move the lane onto a drop-trailer or power-only programme so "
    "the tractor is not sitting in the queue at all."),
   ('What paperwork travels with the metal?',
    "Typically mill test certificates and heat numbers identifying the material, plus scale tickets from loading. "
    "Receiving departments at fabricators and service centres match the metal to those documents, so a load that arrives "
    "on time and undamaged can still be held at the door if the certification does not match. It is worth confirming who "
    "provides what before the truck loads."),
   ('What does steel freight cost per mile?',
    "It prices as open-deck freight and follows the same seasonal curve as construction material &mdash; cheap in "
    "January and February, tight from May through October. Conestoga carries a premium over flatbed, and over-dimension "
    "or overweight single pieces price separately because of the permit and escort work. Current national benchmarks are "
    "on the <a href='flatbed-freight-rates.html'>flatbed</a>, <a href='step-deck-freight-rates.html'>step deck</a> and "
    "<a href='conestoga-freight-rates.html'>Conestoga</a> rate pages."),
  ],

  related=[
   ('flatbed-freight-rates.html', 'Flatbed Freight Rates'),
   ('step-deck-freight-rates.html', 'Step Deck Freight Rates'),
   ('conestoga-freight-rates.html', 'Conestoga Freight Rates'),
   ('oversize-load-rates-per-mile.html', 'Oversize Load Rates'),
   ('detention-pay-policy.html', 'Detention Pay Policy'),
   ('shipper-solutions.html', 'Shipper Solutions'),
  ],
 ),
]


def _rows(pairs, w='34%'):
    return ''.join("<tr><td style='width:%s'><b>%s</b></td><td>%s</td></tr>" % (w, a, b) for a, b in pairs)


def build_industry_pages(eq_rates, faq_schema):
    """Return a list of page dicts for the shipper-by-industry vertical pages.

    eq_rates is build_site.py's _EQ_RATES (used only to resolve equipment display
    names, so a renamed equipment never leaves a wrong label behind). No rate
    NUMBERS are printed on these pages on purpose -- the live figures are fetched
    client-side on the equipment hubs and a static copy here would go stale and
    start lying, which is exactly the failure the market-report guards exist to stop.
    """
    _eqname = {e['slug']: e['name'] for e in (eq_rates or [])}
    out = []
    for ind in INDUSTRIES:
        s, n, low = ind['slug'], ind['name'], ind['low']
        fname = s + '-freight-shipping.html'
        b = _IND_CSS

        # --- 1. hero + framing note
        b += ("<section class='hero'><div class='aurora'><span class='a1'></span><span class='a2'></span></div>"
              "<div class='wrap' style='position:relative;z-index:1;max-width:860px'>"
              "<span class='badge reveal'><span class='dot'></span> Freight by industry</span>"
              "<h1 class='reveal d1'>" + ind['h1'] + "</h1>"
              "<p class='lead reveal d2' style='margin:22px 0 28px'>" + ind['lead'] + "</p>"
              "<div class='hero-btns reveal d3'>"
              "<a href='/app/partner/' class='btn btn-primary'>Post a load &rarr;</a>"
              "<a href='shipper-solutions.html' class='btn btn-secondary'>Shipper solutions</a>"
              "<a href='load-board.html' class='btn btn-ghost'>See live loads &rarr;</a></div></div></section>")

        b += ("<section><div class='wrap prose'>"
              + ''.join('<p>' + p + '</p>' for p in ind['intro'])
              + "<div class='ind-hero-note'>" + ind['note'] + "</div>"
              "</div></section>")

        # --- 2. what actually moves
        b += ("<section class='bg-soft'><div class='wrap prose'>"
              "<h2>What moves as " + low + " freight</h2>"
              "<p>These profiles need different equipment, different paperwork and different rate expectations. "
              "Treating them as one category is the most common reason this freight sits on a board.</p>"
              "<table class='ind-t'><thead><tr><th style='width:20%'>Profile</th><th>What it is</th>"
              "<th style='width:20%'>Usual equipment</th></tr></thead><tbody>"
              + ''.join("<tr><td><b>%s</b></td><td>%s</td><td>%s</td></tr>" % (g, w, e)
                        for g, w, e in ind['commodities'])
              + "</tbody></table></div></section>")

        # --- 3. equipment fit (links into the layer-1 rate hubs, both directions)
        b += "<section><div class='wrap prose'><h2>Equipment that fits " + low + " freight</h2>"
        for eslug, ename, why in ind['equip']:
            label = _eqname.get(eslug, ename)
            b += ("<div class='ind-eqcard'><h3><a href='" + eslug + "-freight-rates.html'>" + label + "</a></h3>"
                  "<p>" + why + "</p>"
                  "<span class='ind-rate'>Current national benchmarks, and what carriers, brokers and shippers each pay: "
                  "<a href='" + eslug + "-freight-rates.html'>" + label.lower() + " freight rates &rarr;</a></span></div>")
        b += ("<p style='margin-top:18px'>Rates on this freight follow the <b>equipment</b>, not the industry &mdash; a "
              "pallet of canned goods and a pallet of hardware price the same in the same van. See "
              "<a href='market-rates.html'>all market rates per mile</a> or the "
              "<a href='freight-market-reports.html'>weekly market reports</a>.</p></div></section>")

        # --- 4. the technical spec section (the reason this page exists)
        b += ("<section class='bg-soft'><div class='wrap prose'>"
              "<h2>" + ind['spec_h'] + "</h2><p>" + ind['spec_intro'] + "</p>"
              "<table class='ind-t'><tbody>" + _rows(ind['spec'], '32%') + "</tbody></table></div></section>")

        # --- 5. seasonality
        b += ("<section><div class='wrap prose'>"
              "<h2>The " + low + " freight year</h2>"
              "<p>Capacity on this freight is close to constant through the year. Demand is not, and that gap is what "
              "moves the rate.</p>"
              "<table class='ind-t'><thead><tr><th style='width:18%'>Period</th><th>What happens</th></tr></thead>"
              "<tbody>" + ''.join("<tr><td><b>%s</b></td><td>%s</td></tr>" % (p, w) for p, w in ind['season'])
              + "</tbody></table></div></section>")

        # --- 6. dock / delivery reality + accessorial exposure
        b += ("<section class='bg-soft'><div class='wrap prose'>"
              "<h2>" + ind['dock_h'] + "</h2>"
              "<table class='ind-t'><tbody>" + _rows(ind['dock'], '30%') + "</tbody></table>"
              "<p>Every one of these is an accessorial with a written LoadBoot standard, agreed before the truck moves "
              "rather than argued about after: <a href='detention-pay-policy.html'>detention</a>, "
              "<a href='layover-policy.html'>layover</a>, <a href='tonu-policy.html'>TONU</a>, "
              "<a href='lumper-policy.html'>lumper fees</a>, <a href='driver-assist-policy.html'>driver assist</a> and "
              "<a href='fcfs-policy.html'>FCFS versus appointment</a>.</p></div></section>")

        # --- 7. regulation
        b += ("<section><div class='wrap prose'><h2>" + ind['compliance_h'] + "</h2>"
              + ''.join('<p>' + p + '</p>' for p in ind['compliance'])
              + "<p class='src-disc' style='margin-top:14px'>This is general operating information, not legal advice. "
              "Regulations are amended and state rules vary &mdash; confirm current requirements for your commodity and "
              "route before relying on them.</p></div></section>")

        # --- 8. the posting checklist (the supply-side action)
        b += ("<section class='bg-soft'><div class='wrap prose'>"
              "<h2>Posting a " + low + " load that actually covers</h2>"
              "<p>Rate is rarely why this freight sits. It sits because a carrier cannot tell from the posting whether the "
              "load is legal on his trailer, how long he will wait, or what he gets paid if it goes wrong. Six things fix "
              "most of that.</p>"
              "<table class='ind-t'><tbody>" + _rows(ind['post'], '34%') + "</tbody></table>"
              "<p><a href='/app/partner/'>Post a " + low + " load &rarr;</a> &middot; "
              "<a href='free-load-board-for-brokers.html'>Why posting is free for brokers and shippers &rarr;</a></p>"
              "</div></section>")

        # --- 9. FAQ
        b += ("<section><div class='wrap prose'><h2>" + n + " freight questions</h2>"
              + ''.join("<div class='ind-faq'><h3>" + q + "</h3><p>" + a + "</p></div>" for q, a in ind['faq'])
              + "</div></section>")

        # --- 10. CTA + sibling industries
        others = [o for o in INDUSTRIES if o['slug'] != s]
        b += ("<section class='bg-soft'><div class='wrap prose center' style='text-align:center;max-width:780px'>"
              "<h2>Moving " + low + " freight?</h2>"
              "<p>Posting is free for brokers and shippers &mdash; no subscription and no per-post fee. Every carrier who "
              "can accept your load has had authority, insurance and safety checked first, every load carries live GPS, "
              "and the accessorial terms above are written down before the truck moves.</p>"
              "<div class='ctarow' style='margin-top:18px;justify-content:center'>"
              "<a href='/app/partner/' class='btn btn-primary'>Post a load &rarr;</a>"
              "<a href='create-shipper-account.html' class='btn btn-secondary'>Create a shipper account &rarr;</a></div>"
              + "<div class='ind-other'><a href='" + INDEX_FNAME + "'>All industries</a>" + ''.join(
                    "<a href='" + o['slug'] + "-freight-shipping.html'>" + o['name'] + " freight</a>" for o in others)
                 + "</div>"
              + "</div></section>")

        out.append(dict(
            fname=fname,
            title=ind['title_kw'] + ' &mdash; Equipment, Rules &amp; Rates | LoadBoot',
            desc=ind['desc'],
            body=b,
            schema=faq_schema(ind['faq']),
            related=[(INDEX_FNAME, 'Freight Shipping by Industry')] + ind['related'][:5],
            # consumed by build_site.py to add this page to the RELATED block of every
            # equipment rate hub whose trailer this industry's freight actually rides on
            ind_label=n,
            equip=[e[0] for e in ind['equip']],
        ))
    return out


def build_industry_index(eq_rates, faq_schema):
    """The 'freight shipping by industry' hub.

    Exists so the nav carries ONE entry instead of six: six industry links in the
    Solutions dropdown is nav bloat, and a hub page also gives the vertical pages a
    single strong internal parent. Generated from INDUSTRIES, so a new vertical
    appears here automatically.
    """
    _eqname = {e['slug']: e['name'] for e in (eq_rates or [])}
    b = _IND_CSS
    b += ("<section class='hero'><div class='aurora'><span class='a1'></span><span class='a2'></span></div>"
          "<div class='wrap' style='position:relative;z-index:1;max-width:860px'>"
          "<span class='badge reveal'><span class='dot'></span> Freight by industry</span>"
          "<h1 class='reveal d1'>Freight shipping by industry &mdash; "
          "<span style=\"color:#4ade80\">what each kind of load actually needs</span></h1>"
          "<p class='lead reveal d2' style='margin:22px 0 28px'>Equipment fit, the rules that govern the freight, the "
          "dock and site reality, and what belongs on the posting &mdash; written per industry, for the people who own "
          "the freight.</p>"
          "<div class='hero-btns reveal d3'>"
          "<a href='/app/partner/' class='btn btn-primary'>Post a load &rarr;</a>"
          "<a href='shipper-solutions.html' class='btn btn-secondary'>Shipper solutions</a>"
          "<a href='market-rates.html' class='btn btn-ghost'>Market rates per mile &rarr;</a></div></div></section>")

    b += ("<section><div class='wrap prose'>"
          "<p>Truckload rates follow <b>equipment</b>, not industry &mdash; a pallet of canned goods and a pallet of "
          "hardware price the same in the same van. What changes by industry is everything around the rate: which trailer "
          "the freight is legal on, what has to be written down before it moves, how long the receiving end really takes, "
          "and which accessorials you are exposed to. Those are the things that decide whether a load covers, and they "
          "are what these pages document.</p>"
          "<p>Each page is written as information rather than as a sales claim: the actual equipment fit, the federal or "
          "contractual rules that apply, the seasonal capacity pattern, where loads lose money at the dock, and a posting "
          "checklist. For the numbers, every page links through to the "
          "<a href='market-rates.html'>equipment rate pages</a> and the "
          "<a href='freight-market-reports.html'>weekly market reports</a>, where the figures are live rather than "
          "copied into prose that would go stale.</p></div></section>")

    b += "<section class='bg-soft'><div class='wrap prose'><h2>The industries</h2>"
    for ind in INDUSTRIES:
        eqs = ', '.join(_eqname.get(e[0], e[1]) for e in ind['equip'])
        b += ("<div class='ind-eqcard'>"
              "<h3><a href='" + ind['slug'] + "-freight-shipping.html'>" + ind['name'] + " freight shipping</a></h3>"
              "<p>" + ind['lead'] + "</p>"
              "<span class='ind-rate'>Usual equipment: " + eqs + " &middot; "
              "<a href='" + ind['slug'] + "-freight-shipping.html'>read the page &rarr;</a></span></div>")
    b += "</div></section>"

    b += ("<section><div class='wrap prose'><h2>The same four questions, every industry</h2>"
          "<p>Whatever the freight is, the posting has to answer these before a carrier can price it honestly.</p>"
          "<table class='ind-t'><tbody>"
          + _rows([
            ('Is it legal on that trailer?', "Weight, dimensions as the freight sits on the deck, and any commodity-specific rule that changes how it must be secured or held. This is what decides dry van versus reefer versus flatbed versus step deck &mdash; and whether you are into permit territory."),
            ('What has to be in writing?', "A temperature spec, a securement note, a delivery window, a labelling requirement. The rule differs by industry &mdash; federal for food and open deck, contractual for retail &mdash; but the failure mode is the same: what was not written down is what gets argued about."),
            ('How long does each end really take?', "Live unload, crane queue, packhouse wait, plant gate procedure. Free time that does not match reality is detention you did not plan to pay. See the <a href='detention-pay-policy.html'>detention pay policy</a>."),
            ('Who does the work at the dock?', "Driver assist, lumper, forklift, crane or rigging crew &mdash; and who pays. This is the most common thing missing from a posting and the most common reason a delivery stalls."),
          ], '30%')
          + "</tbody></table></div></section>")

    faq = [
     ('Do freight rates change by industry?',
      "Not directly. Rates follow equipment, lane and season &mdash; a dry van load prices as a dry van load whether it is "
      "canned food or hardware. What industry changes is the requirements attached to the load and the accessorial "
      "exposure around it, and those absolutely change the total cost. Current benchmarks by equipment are on the "
      "<a href='market-rates.html'>market rates page</a>."),
     ('Which trailer does my freight need?',
      "Start with three numbers: weight, dimensions as the freight will sit on the deck, and any temperature requirement. "
      "Weight and temperature usually decide between dry van and reefer; height decides between flatbed and step deck, "
      "because a flatbed deck sits around 60 inches and a step deck around 38&ndash;42, which is roughly the difference "
      "between 8&nbsp;ft 6&nbsp;in and 10 feet of legal cargo height. Each industry page works through the specifics."),
     ('What makes a load sit on a board?',
      "Usually not the rate. A load sits when a carrier cannot tell from the posting whether it is legal on his trailer, "
      "how long he will wait, or what he gets paid if something goes wrong. Every industry page here ends with a posting "
      "checklist aimed at exactly that."),
     ('Is posting a load free?',
      "Yes &mdash; posting is free for brokers and shippers, with no subscription and no per-post fee. See "
      "<a href='free-load-board-for-brokers.html'>why posting is free</a>, or "
      "<a href='create-shipper-account.html'>create a shipper account</a>."),
    ]
    b += ("<section class='bg-soft'><div class='wrap prose'><h2>Common questions</h2>"
          + ''.join("<div class='ind-faq'><h3>" + q + "</h3><p>" + a + "</p></div>" for q, a in faq)
          + "</div></section>")

    b += ("<section><div class='wrap prose center' style='text-align:center;max-width:780px'>"
          "<h2>Moving freight?</h2>"
          "<p>Every carrier who can accept your load has had authority, insurance and safety checked first, every load "
          "carries live GPS, and the accessorial terms are written down before the truck moves rather than argued about "
          "after.</p>"
          "<div class='ctarow' style='margin-top:18px;justify-content:center'>"
          "<a href='/app/partner/' class='btn btn-primary'>Post a load &rarr;</a>"
          "<a href='create-shipper-account.html' class='btn btn-secondary'>Create a shipper account &rarr;</a></div>"
          "<div class='ind-other'>" + ''.join(
             "<a href='" + i['slug'] + "-freight-shipping.html'>" + i['name'] + "</a>" for i in INDUSTRIES)
          + "</div></div></section>")

    return dict(
        fname=INDEX_FNAME,
        title='Freight Shipping by Industry &mdash; Equipment, Rules &amp; Rates | LoadBoot',
        desc="Freight shipping by industry: which trailer each kind of load is legal on, the rules that govern it, the "
             "dock reality, and what belongs on the posting. Six US truckload verticals.",
        body=b,
        schema=faq_schema(faq),
        related=[('shipper-solutions.html', 'Shipper Solutions'),
                 ('market-rates.html', 'All Market Rates'),
                 ('freight-market-reports.html', 'Weekly Market Reports'),
                 ('load-board.html', 'Live Load Board'),
                 ('free-load-board-for-brokers.html', 'Free Load Board for Brokers'),
                 ('create-shipper-account.html', 'Create a Shipper Account')],
    )


def industry_links_for_equipment(max_per_hub=3):
    """equipment slug -> [(industry page, label)] for the equipment rate hubs' RELATED.

    Ranked by how central that equipment is to the industry (its position in the
    industry's own `equip` list), then capped, so the flatbed hub gets metals and
    building materials rather than whichever industries happen to be defined first,
    and no hub ends up with a wall of related links. Every equipment that any
    industry lists gets at least one link.
    """
    ranked = {}
    for ind in INDUSTRIES:
        for rank, e in enumerate(ind['equip']):
            ranked.setdefault(e[0], []).append(
                (rank, ind['slug'] + '-freight-shipping.html', ind['name'] + ' Freight'))
    return {k: [(f, l) for _, f, l in sorted(v)[:max_per_hub]] for k, v in ranked.items()}
