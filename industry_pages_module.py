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
              + ("<div class='ind-other'>" + ''.join(
                    "<a href='" + o['slug'] + "-freight-shipping.html'>" + o['name'] + " freight</a>" for o in others)
                 + "</div>" if others else '')
              + "</div></section>")

        out.append(dict(
            fname=fname,
            title=ind['title_kw'] + ' &mdash; Equipment, Rules &amp; Rates | LoadBoot',
            desc=ind['desc'],
            body=b,
            schema=faq_schema(ind['faq']),
            related=ind['related'],
            # consumed by build_site.py to add this page to the RELATED block of every
            # equipment rate hub whose trailer this industry's freight actually rides on
            ind_label=n,
            equip=[e[0] for e in ind['equip']],
        ))
    return out
