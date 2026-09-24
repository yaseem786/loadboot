# Marketing site re-imagining plan — "The Operating System for Trucking" + the dispatcher model as it really runs

24 Sep 2026 · Plan only, nothing shipped · Based on `main` @ e19fe63 (code is the tie-breaker over older design docs)

Sources read for this plan: `build_site.py` + `*_module.py` (live page source; the root `*.html` files are a stale snapshot), `app/carrier/dispatcher-desk.js`, `app/agent/dispatcher-workspace.js`, `app/command-center/views/dispatchers.js`, migrations `bl_disp_0140…0410`, `docs/DISPATCHER-PORTAL-AUDIT.md`, `docs/seo/WEEKLY-LOG.md` (R10), `docs/audit-2026-09/90-DAY-PLAN.md`, `docs/audit-2026-09/COMPETITION-AND-WEDGE.md`, `docs/research/independent-dispatcher-payment-model.md`, plus a web pass on 2026 competitor positioning and Google's current structured-data docs (sources at the end).

---

## 0. Decision in one paragraph

The website should keep selling **"truck dispatch service for owner-operators"** on every page that ranks for it (that is where the search demand and the clicks are), and put the **operating-system story underneath it as the reason LoadBoot's dispatch is different**, not as a replacement headline. The honest model — and the one the code enforces — is not "a marketplace of independent dispatchers". It is: **one platform (app, board, GPS, documents, settlements, AI front desk) + a LoadBoot-run dispatcher network (screened, tested, assigned by hand within 3 business days, supervised by the Command Center, paid by LoadBoot) + the carrier keeps authority and money and pays a flat 5% of line-haul at delivery.** That story is currently told in pieces across the site, with three contradictions (§2). Fixing the story is mostly conversion and trust work; done the way §5 describes, the expected SEO effect is neutral-to-positive, and the pages most likely to gain are exactly the dispatch pages that are stuck at position 50–70 today.

---

## 1. How the dispatcher side actually works, A to Z (from code, 22–24 Sep)

This is the "backend truth" the site has to reflect. Every step names the code so copy can be checked against it.

| # | Step | What really happens | Where |
|---|---|---|---|
| 1 | **Carrier applies** | Six-step wizard: company & authority → operation & equipment → factoring & payment → dispatch preferences → documents → review. E-signs the Dispatch Service Agreement (LB-DSA). Can also be onboarded inside live chat. | `app/carrier/app.js:8059`, `dispatch-agreement.js`, `bl_cc_0134` |
| 2 | **Compliance check** | AI pre-check on every upload, FMCSA lookup, staff review in the Verification Center, expiry engine + reminders. | edge `doc-precheck`, `fmcsa-verify`, `bl_cmp_0325`, `bl_exp_0267–0269`, `bl_rem_0339–0342` |
| 3 | **Dispatcher is a screened contractor, not a marketplace listing** | Applies at `/app/agent/` → screening → 18-question, 75-minute skills test (≥70 % overall, ≥60 % compliance, must catch a double-brokering set-up, must refuse an illegal-hours plan, voice negotiation drill) → 10-working-day paid trial with KPIs → verified → active. 14-day cooldown, max 3 re-applications. | `bl_disp_0317/0319`, `app/agent/skills-test.js`, `bl_disp_0318`, `bl_disp_0361` |
| 4 | **Assignment is by hand and dedicated** | Command Center writes a per-carrier SOP (scope, lanes, rate floor, equipment, home time) and assigns **one** dispatcher; a unique index enforces one active dispatcher per carrier. SLA: assigned within **3 business days** of approval; if late the carrier sees the reason. Carrier can pause or ask for a different dispatcher. | `cc_dispatcher_assign`, `bl_disp_0140`, `bl_disp_0408/0410`, `carrier_dispatcher_change_request` |
| 5 | **Dispatcher tools are LoadBoot-issued** | `@loadboot.com` mailbox inside the portal, Telnyx softphone line, WhatsApp routed so a dispatcher sees only their own carriers. Contact details released to the carrier by compliance, never a personal number. | `bl_dmail_0356–0364`, `bl_dial_0351`, `bl_wa_0369`, `bl_disp_0303/0363` |
| 6 | **Availability gate** | Dispatcher works loads only while the carrier has confirmed an "empty" or "backhaul" post in the last 24 h (auto-expires). Dispatcher can update it too. | `bl_avail_0320–0329`, `dispatcher_set_availability` |
| 7 | **Load sourcing** | External boards (DAT / Truckstop / 123Loadboard via the dispatcher's own or employer login — **no API integration exists**), broker e-mail, direct shippers, plus LoadBoot's own board (broker/shipper posts, e-mail ingestion, developer API `dev_post_load`). Amazon Relay / Newtrul are checkboxes and logos, not integrations. | `dispatcher-desk.js:133`, `bl_api_0276/0277`, `bl_soft_0279–0284` |
| 8 | **Booking is logged, then LoadBoot approves** | Dispatcher "logs a booking" with the rate confirmation attached; staff approve (`cc_dispatcher_booking_decide`); that creates the `booked` load and the trip. RC parsed by AI. Carrier approves every load against its floor. | `dispatcher_log_booking`, `bl_disp_0288`, edge `rc-parse` |
| 9 | **Tracking** | Phone GPS (owner app / driver mode) or ELD (Samsara / Motive); 800 m geofence arrive/depart; blackout alerts. **Prod ping path only started working on 24 Sep (`bl_ux_0434`)** — do not advertise "always-on tracking" until a few real trips have data. | `trip-map.js`, `cc_pocket_post_location`, `eld-poll`, `bl_ux_0434/0435` |
| 10 | **POD → invoice → settlement** | POD upload → staff POD review → invoice prep. Freight money goes broker → carrier or factor directly; LoadBoot never holds it. Factoring NOA engine routes payment instructions. Settlement ledger with maker-checker. | `cc_pocket_upload_pod`, `podReview.js`, `bl_pay_0092`, `bl_fin_0299`, `fin_settlements` |
| 11 | **Accessorials** | Auto-detention on GPS departure, auto-TONU on cancellation, evidence bundle, 100 % passed to the carrier with no LoadBoot fee. | `ct-waveBL/bl_trip_0002`, `wave-accessorial-payout/wa_0001`, `bl_pay_0067/0068` |
| 12 | **Fee** | Flat 5 % of gross line-haul on delivered loads booked through the dispatcher; FSC, lumper, detention, layover, TONU excluded; Net-30 invoice; 30 days' notice. `auto_invoice_on_delivery()` bills 5 % of `trips.rate` on every delivered trip. **Open item:** the DSA says self-sourced loads carry no fee, the trigger does not check source — copy must not promise more than the trigger does until that is reconciled. | `dispatch-agreement.js §7`, `bl_stripe_0346`, `bl_pay_0097` |
| 13 | **Dispatcher pay** | Commission % set per dispatcher (never published), fixed on each load at approval; after the trial a written package (base + per-truck + bonus). Paid by LoadBoot out of its own 5 % share, manually (Wise / Payoneer / bank / JazzCash). | `cc_dispatcher_set_terms`, `cc_dispatcher_commission_pay`, `dispatchers.js:925–969` |
| 14 | **LoadBoot staff's own role** | Hire and test dispatchers, write SOPs, assign, approve every RC, run compliance, release contacts, rule on claims, approve fees, pay commissions, handle brokers/shippers. | `app/command-center/app.js:239–318` |
| 15 | **Referral partner (the other "agent")** | Same portal, separate track chooser (dispatcher / referral / both). Earns 1 % of gross on delivered loads by parties they referred; switched on 22 Sep. | `bl_agent_0402–0406`, `profiles.portal_intent` |

**What this means in one sentence for the site:** LoadBoot is not "your dispatcher" the way a two-person dispatch agency is, and it is not a neutral marketplace where you pick a freelancer. It is a **managed dispatch network running on its own operating system** — the platform does verification, matching, tracking, documents and settlement; the dispatcher does sourcing, negotiation, check calls and paperwork chasing; the Command Center supervises both.

**FMCSA framing that must survive any rewrite** (`docs/research/independent-dispatcher-payment-model.md`, DSA §2, `dispatcher-desk.js:149`): the dispatcher acts as the carrier's bona fide agent under the carrier's authority (88 FR 39368); LoadBoot never touches freight money and never allocates one load between two carriers (the per-carrier SOP `scope_type` exists precisely to avoid 88 FR 39371 "allocation"). "Marketplace connecting carriers to dispatchers" is therefore not just an SEO non-starter (§5), it also drifts away from the legal posture the code was built around. Attorney review of the F04 copy is still pending; nothing in this plan changes that.

---

## 2. Where the site is wrong or inconsistent today

1. **Two stories side by side.** `services.html` and every equipment page read as a human dispatch agency ("we book, we negotiate, you drive"). `how-it-works.html` reads as a self-serve four-sided platform and has **no dispatcher step at all** in the carrier lane. `about.html` says "Operating System" but then describes dispatch as an add-on. A visitor cannot tell whether they are buying software or a service.
2. **"Independent dispatcher" is used for the wrong thing.** The home REFTEASER, contact tab and `build_site.py:6607` call the *referral* program "the independent dispatcher model". The people who actually dispatch are LoadBoot-tested contractors assigned by the Command Center. This is the exact confusion the owner noticed ("lagta hai dispatcher LoadBoot khud hai") — and the truth is closer to "LoadBoot runs the dispatchers" than the site admits, which is a *stronger* story once told properly.
3. **Fee wording drifts.** "5 % of gross" (home FAQ, pricing hero) vs "5 % of line-haul, FSC and accessorials excluded" (equipment FAQs, pricing by-role, llms.txt). The DSA says line-haul. One wording everywhere.
4. **Claims internal evidence does not support.** "Zero ghost loads" in the home H1 and meta, "24/7 dispatch desk" in the compare table, "15 min avg reply" — `COMPETITION-AND-WEDGE.md` says zero-ghost is not demonstrated, the desk is business-hours (only Riley's phone line is 24/7), and the 22 Sep owner guardrails already ban "cover loads in minutes". The dispatcher A-to-Z is *more* credible than these slogans and needs none of them.
5. **Nothing on the site describes the dispatcher pipeline** (test, trial, SOP, 3-business-day assignment, RC approval, contact release, pause/switch). That is the most differentiated, most verifiable content LoadBoot owns, and it is invisible. `careers.html` also still says "bring your own DAT/Truckstop login", which the 21 Sep rule replaced.
6. **Housekeeping:** the 22 root `*.html`, root `sitemap.xml` and `docs/site-inventory*` are stale snapshots; all page work goes through `build_site.py` and the modules. Search Console shows ~127 sitemap pages, not 20.

---

## 3. The positioning model

### 3.1 Three layers, one sentence each

| Layer | Name on the site | What it is | Proof points that are true today |
|---|---|---|---|
| **Brand** | **The Operating System for Trucking** (keep — owner's official tagline, already in Organization schema, footer, backlinks) | The umbrella. Brand vocabulary only; it is not a search term (§5.1). | — |
| **Platform** | "the LoadBoot platform" / "your carrier app" | Verified board, carrier app (Android live; iOS "coming"), driver mode, GPS + geofence, document vault + AI pre-check + expiry reminders, account health score, market rates, settlements ledger, factoring NOA, QuickBooks (say "sync" only once Intuit approves prod keys), API, Riley 24/7 phone line, live chat onboarding. | Play Store listing, `features.html`, health score prod since Jul |
| **Dispatch network** | **"LoadBoot Dispatch — a dedicated, vetted dispatcher on the platform"** | Screened + tested + trialled contractors, assigned by hand within 3 business days, one dispatcher per carrier, supervised by the Command Center, every rate confirmation approved, paid by LoadBoot. | §1 rows 3–8 and 14 |

Carrier promise that ties them together (draft, plain words):

> **Keep your authority, keep your money, keep your truck moving.** A dedicated dispatcher who passed our test works your lanes. The platform verifies every broker, tracks every load, files your detention and settles your paperwork. You pay a flat 5 % of line-haul, only on loads we book and you deliver.

### 3.2 Vocabulary rules (apply everywhere, including schema and llms.txt)

- "Dedicated dispatcher" / "LoadBoot-vetted dispatcher" — never "independent dispatcher" for the person who books loads.
- The referral program is "Referral Partner" everywhere (careers title already says so). Retire "Agent program — the independent dispatcher model".
- Fee: "flat 5 % of line-haul, earned at delivery; fuel surcharge and accessorials are yours".
- "No long-term contract", never "no contract". "Business-hours dispatch desk; Riley answers the phone 24/7", never "24/7 dispatch".
- "Assigned within 3 business days" is a real SLA in `disp_desk_config` — use it. Never print a dispatcher commission %.
- "Verified load board" is fine; drop "zero ghost loads" as a headline claim until the non-demo board has real volume (keep the *rule* "every posting expires and is timestamped" as a feature).
- GPS: "phone or ELD tracking with geofenced arrival proof" — say it, but do not add "always on" or reliability numbers until prod has trips with data.
- Never a page that implies LoadBoot chooses which carrier gets a load.

### 3.3 What "how LoadBoot's dispatch works" looks like as a page section (the thing the owner asked for)

A numbered, illustrated strip, reused on the homepage (short), `services.html` (medium) and a new deep page (full):

1. **You apply, we verify** — authority, insurance, W-9, DSA e-signed; AI pre-check + human review.
2. **We match you by hand** — SOP written from your lanes, floor rate and home time; one dedicated dispatcher within 3 business days.
3. **Your dispatcher passed our test** — 18-question compliance and negotiation exam, voice drill, 10-day trial with KPIs.
4. **You confirm you're empty, they go to work** — DAT/Truckstop/123LB, broker network, direct shippers, LoadBoot board.
5. **Every rate con gets two approvals** — yours against your floor, LoadBoot's before the truck moves.
6. **The platform tracks and proves** — geofenced arrival/departure, detention auto-filed, POD in the vault.
7. **You get paid directly** — broker or factor pays you; LoadBoot never holds your money. One 5 % invoice, Net-30.
8. **Not happy? Pause or switch** — one tap in the app; 30 days' notice to leave.

Each step links to the portal screen or policy page that backs it (Dispatcher tab, Documents, GPS tracking page, detention policy). That is E-E-A-T "experience" content Google's 2026 core updates reward, and none of it is a claim about volume or speed.

---

## 4. Page-by-page plan

### 4.1 Pages that rank — change the story, protect the keyword

| Page | R10 GSC (28 d) | Title / H1 rule | What changes in the body |
|---|---|---|---|
| `index.html` | 55 clicks / 330 impr / **pos 6.2** — the site's biggest asset | **Title unchanged** ("Truck Dispatch & Verified Load Board for Carriers \| LoadBoot"). H1 keeps "Truck Dispatch" and "Load Board" at the front; replace "With Zero Ghosts" with "on One Platform". Sub-line stays "The Operating System for Trucking". | Replace the "we type, you drive" flow with the 8-step strip (short form). Fix the REFTEASER to "Referral Partner". Compare table: "Business-hours desk + Riley 24/7". FAQ: one fee wording. Keep FAQ markup (Google still reads it; no rich result since May 2026). |
| `services.html` | in the "dispatch services" cluster, pos 60–72 | Title stays keyword-first. | Rewrite from agency copy to "what the dispatcher does / what the platform does / what you do" three-column model + full 8-step strip. This is the page the 90-day plan already flagged as "brochure copy". |
| `pricing.html` | — | Keep. | One fee sentence; "what the 5 % includes" lists the dispatcher network *and* the platform explicitly; remove "24/7". |
| `owner-operator-dispatch.html` | 2 clicks, **locked** (growing) | **No title/H1 change this round.** | Body only, after the lock clears: add the "who your dispatcher is" block. |
| `dry-van-`, `power-only-`, `flatbed-`, `reefer-`, `hotshot-dispatch.html` | 0 clicks each, pos 35–71; power-only "stuck across four rounds, content problem" | Titles already keyword-first — keep. | These are where the new story helps SEO most: add equipment-specific eligibility, the assignment SLA, how the dispatcher sources that equipment's freight, fee base, first-week flow. Ahrefs' refresh data (+4.6 positions average for substantive updates) is the upside case; power-only and dry van have 3–6× the demand of box truck/hotshot, so do them first. |
| `how-it-works.html` | — | Keep. | Add a fifth lane: **"Carrier with a LoadBoot dispatcher"** (today the carrier lane is self-serve only). |
| `about.html` | brand | Keep "The Operating System for Trucking". | Make the three layers explicit; the dispatcher paragraph becomes the pipeline (test, trial, SOP, assignment). |
| `us-truck-dispatcher.html`, `carriers.html` | small | Keep. | Already closest to the truth ("Command Center assigns a screened, dedicated dispatcher"); align wording to §3.2. |
| `careers.html` | top-10 for its brand query | Keep. | Fix "bring your own DAT/Truckstop login" → the 21 Sep rule (we test how you find loads, not whose login it is). |
| `market-rates.html`, `*-freight-rates.html`, policy pages | 29 % of impressions; top-10 hubs | **Do not touch** (standing rule). | — |

### 4.2 New URLs (the platform layer, targeting real adjacent demand — not "operating system")

| New page | Target query (demand is an estimate; none of these were in the 835-row GSC pull, so treat as long-tail) | Content | Schema |
|---|---|---|---|
| `how-loadboot-dispatch-works.html` | "how does a truck dispatcher work", "what does a truck dispatcher do for owner operators" | The full A-to-Z of §1 in carrier language, with screenshots of the Dispatcher tab, skills-test rubric (non-answers), SOP fields, assignment timer. The trust page every other page links to. | Article + BreadcrumbList |
| `dedicated-truck-dispatcher.html` | "dedicated truck dispatcher", "find a truck dispatcher", "hire a truck dispatcher for owner operator" | Why dedicated (one dispatcher, fixed truck count), how vetting works, pause/switch, vs freelancer / vs call-centre agency. | Service + Breadcrumb |
| `trucking-app-for-owner-operators.html` (or fold into `apps.html`) | "trucking app for owner operators", "dispatch app for truckers" | Android live, driver mode, GPS, documents, health score; iOS "in review" only when true. | **SoftwareApplication / MobileApplication** (still a live rich result, doc updated 8 Sep 2026; needs name, offers price 0, and a real aggregateRating — omit rating until real reviews exist) |
| `ai-dispatch-for-owner-operators.html` (optional, later) | "AI truck dispatcher", "AI dispatch trucking" — small but rising; TruckSmarter, Numeo, DispatchMVP chase it | Honest scope: AI does document pre-check, RC parsing, the 24/7 phone line and chat onboarding; a **human** dispatcher books. Differentiate from "AI books your loads" vendors. | Article |
| `truck-dispatcher-vs-dispatch-software.html` (optional) | "dispatch software vs dispatcher", "TMS for owner operators" (<100/mo) | Comparison page; funnels the TMS-curious to the platform + dispatcher combo. | Article |

Internal linking: every ranking dispatch page → the how-it-works page and the dedicated-dispatcher page (in the first screen, not the footer); the two new pages → services and pricing. No orphan pages; add to the build's sitemap automatically.

### 4.3 Structured data changes (Google docs as of Sep 2026)

- Add `Organization` (with `sameAs`, logo, founder) to the **global** head, not only `about.html` — it drives the knowledge panel. Keep `ProfessionalService` but set `description` to the three-layer sentence and add `hasOfferCatalog` for "Dedicated dispatch" and "Platform".
- `SoftwareApplication` on the app page only, and only with fields that are true.
- `Service` schema stays on equipment pages (valid, no rich result, still entity-useful).
- `HowTo` is dead (Sept 2023): remove from `load-score.html` and the accessorial pages when those pages are next touched (no ranking value, one less thing to validate).
- `FAQPage`: leave in place (deprecated rich result, still used for understanding). Do not add new ones for rich-result reasons.
- `JobPosting` on careers stays only while both roles are genuinely open.

---

## 5. SEO impact — what to expect, honestly

### 5.1 The demand picture (web pass, 24 Sep; volumes are estimates, no tool page was reachable through the proxy)

| Phrase family | Real demand? | Who owns it | Use |
|---|---|---|---|
| truck dispatch services / dispatch services for owner operators / [equipment] dispatch services | **Yes** — DAT built a five-page cluster on it; FreightWaves has a ratings page; GSC already shows LoadBoot 417 impr/28 d on this cluster | DAT, Logity, Truck Dispatch 360, Freight Girlz, fleet.care | **Primary keyword on every ranking page — unchanged** |
| how much does a dispatcher cost / dispatcher vs broker / 5 % | Yes (informational) | LoadBoot already has the pages; AI Overviews will keep eroding clicks here regardless of positioning | Keep, snippet-first |
| find / hire a truck dispatcher, dedicated truck dispatcher, independent truck dispatcher | Small but real (forum evidence: "How do you find dispatcher?") | thin | New `dedicated-truck-dispatcher.html` |
| trucking app for owner operators / dispatch app for truckers | Small, app-store style | TruckSmarter | App page + SoftwareApplication |
| AI truck dispatcher / AI dispatch trucking | Low hundreds, rising in the last 12 months | TruckSmarter, Numeo, DispatchMVP, Tarmac (Truckstop marketplace) | Optional page, honest scope |
| trucking software / TMS for owner operators | Moderate but Capterra/G2/Alvys/TruckLogics own it; "TMS for owner operators" < 100/mo | incumbents | Do not chase; one comparison page at most |
| **trucking operating system / operating system for carriers / dispatcher marketplace** | **≈ 0.** Only TheTruckingSoftware.com and the defunct TrueNorth use "operating system"; nobody ranking uses it in a title | — | **Brand tagline only.** Never a title's primary phrase, never a target page |

2026 competitor vocabulary is "AI-native TMS" (Rose Rocket, Alvys), "platform" (Motive, Samsara), "AI dispatch" (TruckSmarter, FleetWorks), and old-style "truck dispatch services in USA" for agencies. "Operating System for Trucking" is therefore *differentiating as brand copy* and *invisible as a keyword* — exactly the split this plan makes.

### 5.2 Expected effect by tranche

| Tranche | Change | Expected ranking effect | Risk and control |
|---|---|---|---|
| A — story rewrite on ranking pages, titles untouched | index, services, pricing, equipment pages, how-it-works, about | **Neutral to positive.** Titles/H1 keep the primary phrase, URLs unchanged, keyword density on "dispatch service(s)" preserved or increased. Substantive refreshes of ranking pages average a gain (Ahrefs content-decay data); the equipment pages at pos 50–71 have the most room. | The only documented way to lose here is removing the head term from a title/H1 (SearchPilot's largest recorded loss, −27 %, came from a one-word title change). Rule: the head term stays first. Pre-record clicks/impr/pos per page; revert at −5 positions after two rounds (existing playbook line). Locked pages (owner-operator) wait. |
| B — new platform pages | 3–5 new URLs | **Additive, slow.** New pages on a ~127-page site at avg pos 18 take 4–12 weeks to settle; each targets long-tail intent, so expect tens of impressions/month each at first, not hundreds. They mainly improve internal-link context for "dispatcher" entities and convert visitors who already landed. | No cannibalisation if each new page owns a distinct intent (find/hire a dispatcher ≠ dispatch services). No state/lane pages, no programmatic expansion. |
| C — schema | Organization global, SoftwareApplication on app page, HowTo removal | **No ranking change** (Google: structured data is not a ranking factor); possible knowledge-panel/app-card gains. | Only true fields. |
| D — homepage H1 wording | "With Zero Ghosts" → "on One Platform" | **Small risk, worth taking.** Title unchanged, H1 keeps both head phrases; the page ranks on brand + "truck dispatch"/"load board" and neither word is removed. | Measure at R12/R13; if homepage non-brand impressions drop > 20 %, restore the previous H1 wording (one-line revert). |

Net: the repositioning **does not need to cost any rank** and, on the dispatch cluster, is more likely to gain than the title-surgery rounds have been, because those pages' problem is content, not titles (WEEKLY-LOG R10 on power-only). The thing that would cost rank is the version of this idea where the homepage becomes "The Operating System for Trucking — a marketplace for carriers and dispatchers" with the head keywords demoted; that version has zero search demand and is not what the code does anyway.

### 5.3 What the numbers won't show

- AI Overviews / AI Mode (default since May 2026) are cutting informational CTR (Ahrefs: −34 % to −58 % on position 1). The cost/vs-broker pages will keep losing clicks whatever the site says. The commercial pages are what to protect — this plan protects them.
- Conversion is the metric this work moves. `cta_id` tracking already exists (90-day plan); record carrier-signup and "talk to a dispatcher" clicks per page before and after.

---

## 6. Sequence (fits the weekly SEO round rhythm; one page-set per round)

| Round | Work | Owner step |
|---|---|---|
| R11 (this week) | Write `how-loadboot-dispatch-works.html` + `dedicated-truck-dispatcher.html` (new, zero ranking risk). Fix vocabulary (§3.2) site-wide: "Referral Partner", fee sentence, business-hours desk, careers login line. Organization schema global. | Read the two pages for accuracy against §1; attorney pass on DSA-derived wording if the F04 review is still open. |
| R12 | `services.html` + `pricing.html` rewrite (three-column model + 8-step strip). `how-it-works.html` fifth lane. | Approve the 8-step strip text. |
| R13 | Homepage body + H1 word swap; `about.html` three layers. Record pre-edit homepage metrics first. | Decide on "zero ghost loads" (recommendation: drop as headline, keep as a board rule). |
| R14–R15 | Equipment pages: power-only, dry van first, then flatbed, reefer, hotshot; owner-operator when unlocked. | — |
| R16 | App page + SoftwareApplication; optional AI-dispatch page. | Only after iOS status and Play reviews are real. |
| Every round | Pull GSC (rowLimit 5000), compare edited pages to their pre-edit row, revert at −5 positions. | — |

Effort: roughly one build_site.py module + one review per round; no framework change, no URL change, no redirects.

---

## 7. Decisions only the owner can make

1. **Name of the dispatch layer.** "LoadBoot Dispatch" (recommended, plain) vs "Dispatch Network" vs "Dedicated Dispatch". Only the label; the description is fixed by the code.
2. **"Zero ghost loads"** in the homepage H1/meta: drop now or keep until the board has volume. Recommendation: drop from H1, keep the board rule as a feature line.
3. **Self-sourced loads and the 5 %** (§1 row 12): reconcile `auto_invoice_on_delivery()` with DSA §7 before the site promises "no fee on loads you find yourself" in the new pages. This is a money/production change — main-loop work, not this plan.
4. **iOS / Stripe / dialer / WhatsApp** all off or unreleased on prod: the copy says "Android app; iOS coming" and nothing about autopay until they flip.
5. **Attorney review** of the DSA-derived public wording (agent status, 88 FR 39368) before R11 publishes the dispatch-works page.

---

## Sources (web pass, 24 Sep 2026)

DAT dispatch cluster — dat.com/solutions/truck-dispatch-services, /owner-operator-dispatchers · FreightWaves ratings.freightwaves.com/best-truck-dispatching-companies · TruckSmarter trucksmarter.com/dispatch · Truckstop marketplace "AI Dispatcher for Trucking" (Tarmac) · Alvys, Rose Rocket, Toro, Truckbase, TruckLogics, Motive homepages (title tags) · TheTruckingSoftware.com ("Transportation Operating System") · Title-change evidence: searchpilot.com case studies; searchengineland.com "Google says title changes don't impact rankings"; zyppy.com title-rewrite study · Google Search Central: title-link, site-move, creating-helpful-content, structured-data/software-app (updated 8 Sep 2026), structured-data/organization (15 Apr 2026), search-gallery · FAQ rich result deprecation 7 May 2026 (Search Engine Journal) · HowTo removal (Google blog, Aug 2023) · Ahrefs content-decay and AI-Overviews CTR studies · Google I/O 2026 AI Mode default (blog.google).
