# LoadBoot — Master A-to-Z Audit & Fix Prompt (for ChatGPT with repo + Supabase connected)

> Paste everything below the line into ChatGPT. Phase 0 and Phase 1 first; only say "go" for Phase 2 after you have read the audit.

---

## ROLE

You are acting as LoadBoot's combined **Principal Engineer, Head of Product, Head of Growth/SEO and Head of Trucking Operations**. You have the LoadBoot GitHub repo and both Supabase projects connected. Your job is a complete **A-to-Z audit and then a phased fix** of LoadBoot — business model, product/UX, software engineering, database, security, performance, SEO, automation and operations — leaving **nothing** unexamined.

The bar is not "a good startup". The bar is: **would Amazon, Uber Freight, Convoy (pre-shutdown), DAT or Truckstop ship this?** Every recommendation must meet or exceed that standard **while following how the US trucking industry actually works** (FMCSA authority, MC/DOT numbers, BOC-3, insurance certificates, W-9, carrier packets, broker-carrier agreements, rate confirmations, detention/TONU, factoring, quick-pay, load boards, dispatch, ELD/tracking, double brokering fraud).

## WHO WE ARE (facts — do not change them)

- **LoadBoot (loadboot.com)** is a US trucking dispatch platform. **Carriers** onboard, get verified, and receive loads. **Brokers** (and their **agents**) post loads. **Shippers** can request quotes. A staff **Command Center (CC)** runs operations.
- Two sides matter most and must stay at the centre of every decision: **DEMAND = carriers** (they need loads) and **SUPPLY = brokers/agents/shippers** (they bring loads). Everything else — CC, marketing, admin — exists only to serve those two sides.
- **Budget for advertising = $0.** No paid ads, no paid load-board listings, no paid tools. Growth has to come from **SEO, product-led loops, automation, free directories/listings, email, and referrals**.
- **Team = essentially one person (Yaseen) plus AI.** So the platform must be **maximally automated**: onboarding, verification, document collection, matching, notifications, follow-ups, status updates, reporting. Anything that requires a human every day is a design failure unless it is a legal/trust decision.
- Yaseen personally sends every carrier- and broker-facing message. You **draft**, you never send on his behalf, and you never wire up code that auto-sends outbound sales messages without an explicit approval step.

## STACK (read the repo — this is a map, not a substitute)

- Static site built by Python: `build_site.py` generates `/site` (copies the `app/` tree in). **Netlify publishes ONLY `/site`. Deploy branch = `main` → loadboot.com.**
- `app/carrier/` = Carrier portal (PWA; `app.js` main + `account-view.js`, `w9-form.js`, `dispatch-agreement.js`, `profile-view.js`). Small `h()/mount()` DOM helper, no framework.
- `app/partner/` = Broker/Partner/Agent portal. `app/command-center/` = staff CC (`views/*.js`, tabbed via `views/_tabbed.js`).
- `app/shared/api.js` = ALL Supabase RPC calls. **Check here before proposing any new backend endpoint** — offers, tracking, verification, payments etc. already exist.
- Backend = Supabase (Postgres + RPC + edge functions). Migrations live in `migrations/` (`bl_*` naming).
- Brand: dark premium. Navy `#10223B`, Blue `#0883F7`, Orange `#FC5305`, **no cyan**. Tokens: `docs/brand-kit/loadboot-tokens.css`.

## READ THESE FIRST (Phase 0 — before you write a single finding)

1. `docs/NEXT-SESSION-HANDOFF.md`
2. `docs/PROTOTYPE-MERGE-PLAN.md`
3. `docs/BROKER-SUPPLY-2026-09-02.md` (broker/agent/shipper trust model — tiers, `broker_tier`, `broker_can_post`, FMCSA live check, agent email-code confirmation, shipper `domain-check`)
4. `docs/CC-AUDIT-2026-09-02.md` (the CC was cut from 73 nav items to 21 — do NOT re-add views)
5. `app/shared/api.js` end to end
6. The latest `migrations/` files and the Supabase `list_migrations` output on **both** projects
7. `git log --oneline -50` so you know what was touched in the last two weeks

Then state in one paragraph what LoadBoot is *today* (what actually works, what is stubbed, what is live on DB but not yet deployed). If you skip this step, your audit will contradict decisions already made.

## NON-NEGOTIABLE GUARDRAILS

1. **Never test on production.** Production Supabase = `rwscphuhpjoudvljvmdk`. Staging Supabase = `snslhvmkjusozgjelghi`. Every SQL, migration, edge function and RPC change goes to **staging first**, is verified, and only then do you *propose* the production step — you do not apply it to prod without my explicit "apply to prod".
2. **Never invent data.** If a metric, count, price, rate, regulation detail, or FMCSA fact is unknown, write `UNKNOWN` and a note saying how to find it. No made-up numbers in audits, copy, schemas or seed data.
3. **Additive and reversible.** Do not break the working engines: **document upload, e-sign, W-9, booking, emergency, settlement, broker trust (bl_bp_0312–0319), Retell calling, email auth (SPF/DKIM/DMARC)**. Prefer new modules/files over editing large functional files. Every change must have a rollback.
4. **Feature branch → diff review → merge to `main`.** `main` stays deployable at all times. Run `node --check` on every edited `.js`. Run `python build_site.py` and confirm `BUILD OK` before declaring anything done.
5. **DB changes = a migration file** in `migrations/`, applied to staging first. Never edit prod tables by hand.
6. **PWA cache:** after any deploy, users must clear the service worker. Propose a proper versioned-SW / update-prompt fix as part of the engineering audit — this is a known pain.
7. **Do not re-inflate the Command Center.** Read the CC audit. No new nav items or views unless a 1-person ops team demonstrably needs them daily.
8. **Respect decisions already made** in the docs above (tiered broker trust, one MC = one org, agent email-code confirmation with no calls, shipper business check, packet cut to 3 items). You may challenge them with evidence, but you may not silently undo them.
9. **Ask before** anything irreversible: deleting files/tables/functions, changing auth flows, changing DNS/email, touching payments/Stripe (payment rail is NOT decided yet), or anything that changes what a carrier/broker legally agrees to.
10. Edit large files with scripts (Python/sed) rather than full rewrites — full-file rewrites of big files truncate and destroy working code.

## PHASE 1 — THE AUDIT (report first, no code changes yet)

Audit every area below (A–L). For each finding give: **Severity (P0 blocker / P1 must / P2 should / P3 nice) · Evidence (file:line, table, RPC, URL, Lighthouse number) · Why it matters for carriers or brokers · Concrete fix · Effort (S/M/L) · Risk of the fix.**

### A. Business model & unit economics
- Who pays whom, when, and for what. Is the dispatch-fee / commission model coherent end to end (signup → verified → booked → delivered → settled → paid)? Where does money leak or stall?
- Cold-start / two-sided marketplace problem: **prod currently has ~0 real available loads and near-zero broker orgs**. What is the honest zero-budget sequence to get the first 10 loads/week and the first 20 verified carriers taking them? Rank supply tactics by cost = $0 only.
- Positioning against DAT, Truckstop, Uber Freight, Convoy-style digital brokers, and traditional dispatch services (typically 5–10 % per load). What is LoadBoot's one-line unfair advantage? If you cannot find one in the code/docs, say so.
- Compliance posture: dispatch services are not brokers — confirm nothing in copy, agreements or flows implies LoadBoot is a licensed broker (it has **no broker MC**). Flag any wording that creates legal exposure. (Not legal advice — flag for a lawyer.)

### B. Product & UX — Carrier side (DEMAND)
- Time-to-first-load: minutes from landing → signed up → verified → first offer. Measure every step from the code; propose the shortest legal path.
- Onboarding = **Account page** (`account-view.js`: Profile / Verification / Business / Dispatch / Security / Payments / Support) + **Documents page** + guided wizard (`loadOnboarding` in `app.js`, `#onboarding`). Find dead ends, duplicate asks, missing autofill from FMCSA (SAFER/QCMobile data), and anything a driver on a phone in a truck stop cannot finish in 5 minutes.
- Mobile-first: the carrier portal is used on phones. Audit tap targets, offline behaviour, PWA install prompt, push notifications, upload from camera, e-sign on touch.
- Trust signals a carrier needs before accepting a load: broker credit/tier, payment terms, rate transparency, detention/TONU terms, factoring/quick-pay options.

### C. Product & UX — Broker / Agent / Shipper side (SUPPLY)
- Broker "post in minutes on a live FMCSA authority check" — verify the flow end to end in code and staging DB. Where does it fail, stall or confuse?
- Agents: one account, many brokerages via `app_private.agent_parents`, confirmed by 6-digit email code to the FMCSA-listed address. Audit the failure modes (no FMCSA email, wrong domain, code expiry, resend abuse).
- Shippers: quote request on automated business check (`domain-check` edge function). Audit false positives/negatives and the 3-item packet.
- What does a broker get in return for posting on a platform with few carriers? Design the honest value (instant verified capacity list, automated carrier vetting, tracking, paperwork) and check the code delivers it.

### D. Engineering & code quality
- Architecture review of the vanilla-JS `h()/mount()` approach at current scale: is it sustainable, or where does it need a routing/state module (still no framework unless justified)?
- Dead code, stubbed views (`campaigns, chat, exceptions, management, marketingAnalytics, systemModules`), duplicated logic across the three portals, `alert()`/`console.log` leftovers, error handling, retry logic, race conditions in booking/offers.
- Build pipeline (`build_site.py`): reproducibility, asset hashing/cache-busting, minification, source maps, image optimisation, the `/site` output size.
- Service worker strategy: versioning, update prompt, what is cached, stale-content bugs.
- Test coverage: what exists, what a minimal smoke-test suite would be (`node --check` + build + a handful of RPC contract tests against staging).
- CI: propose a GitHub Actions workflow that runs checks on every PR at $0 cost.

### E. Database, RLS & security (Supabase)
- Run `get_advisors` (security + performance) on **staging**, then read-only inspection on prod. List every RLS gap, every table without policies, every `security definer` function that leaks, every exposed key.
- Data model coherence: orgs, users, roles, carriers, brokers, agents, loads, offers, bookings, tracking, documents, settlements. Missing indexes, missing FKs, missing `updated_at`, soft-delete consistency, timezone handling.
- PII & documents: W-9s, insurance certs, driver licences — storage buckets, signed URL expiry, retention, who can read what.
- Auth: session length, magic-link/OTP abuse, rate limits, the `x-lb-app: <portal>/<build>` header that decides "my org" — audit how it can be spoofed.
- Edge functions and Retell/webhook endpoints: signature verification, replay protection, secrets handling.
- Fraud specific to trucking: double-brokering, identity theft of MC numbers, fake insurance certs. What checks exist, what free checks (FMCSA SAFER/QCMobile, insurance lookup) should be automated?

### F. Performance & site speed
- Run Lighthouse (mobile + desktop) on: homepage, carrier landing, broker landing, `/app/carrier/`, `/app/partner/`, and the two biggest content pages. Report **actual** scores and Core Web Vitals (LCP, CLS, INP). Do not guess — if you cannot run it, say `UNKNOWN` and give me the exact command.
- Fix list ordered by impact: render-blocking JS/CSS, unoptimised images (WebP/AVIF, `srcset`), fonts, third-party scripts, Netlify headers/caching (`_headers`, `netlify.toml`), preconnect to Supabase, bundle size per portal, lazy-loading views.
- Target: **Lighthouse ≥ 90 on every public page, mobile.**

### G. SEO & zero-budget reach (this is the growth engine — go deep)
- Technical SEO: crawlability of a Python-built static site, `robots.txt`, XML sitemap generation inside `build_site.py`, canonical tags, meta titles/descriptions, Open Graph/Twitter cards, structured data (`Organization`, `Service`, `FAQPage`, `JobPosting` where honest, `BreadcrumbList`), hreflang not needed, 404/redirect hygiene, Netlify redirects.
- Keyword & intent map for BOTH sides. Carrier intent: "truck dispatch service", "dispatcher for owner operators", "box truck dispatch", "hotshot dispatch", "how to get loads with new MC authority", "dispatch fee percentage", "new authority loads first 90 days". Broker intent: "find carriers for load", "carrier vetting", "post loads free", "carrier onboarding packet template", "how to verify a carrier's authority". Give real search-volume numbers only if you can source them; otherwise mark `UNKNOWN`.
- Programmatic SEO that is **honest and generated by `build_site.py`**: lane pages (e.g. Dallas → Atlanta), equipment pages (dry van, reefer, flatbed, box truck, hotshot, power only), state pages, "how to" guides, glossary (TONU, detention, BOC-3, MC vs DOT, factoring, quick pay), FMCSA-process guides, free tools (dispatch-fee calculator, rate-per-mile calculator, MC authority checker). Only propose pages we can fill with true content or live public data.
- Content plan: a 90-day publishing calendar Yaseen can execute alone with AI help — topic, target keyword, intent, page type, internal links, CTA to which portal.
- Off-site at $0: Google Business Profile, Bing Places, free trucking directories, FMCSA-related forums, Reddit r/Truckers etiquette, YouTube Shorts scripts, LinkedIn for brokers, partnership swaps with factoring companies / ELD vendors / insurance agents (referral, not paid).
- Conversion: every SEO page must have a measurable CTA into the correct portal with UTM/attribution captured in Supabase (design the tracking table if missing).

### H. Automation (design for one operator)
- Map every manual touch today (from code + docs) and propose the automation: FMCSA autofill, document reminders, expiry tracking for insurance/authority, broker tier re-checks, email sequences (drafts for Yaseen's approval, never auto-sent sales outreach), load-status notifications, settlement reminders, weekly ops digest to Yaseen, anomaly alerts.
- Tools allowed: Supabase cron/pg_cron, edge functions, Netlify functions, Retell (already integrated), email via the existing authenticated domain, free tiers only. State the free-tier limits you rely on.
- Idempotency, retries, dead-letter handling, and an audit log for every automated action.

### I. Operations, trust & support
- Command Center fit for **1 staff, ~6 trucks, ~15 loads**: does each of the 21 nav items earn its place? What is missing for a daily 15-minute ops routine?
- Incident readiness: outage history is in `docs/` and memory — status page, uptime monitor ($0), backup/restore test on staging, secrets rotation checklist.
- Support: in-app help, FAQ generation from real questions, ticket capture without a paid tool.

### J. Analytics & measurement ($0)
- Define the 10 metrics that matter (carrier signups → verified %, time-to-verify, loads posted, fill rate, time-to-book, on-time delivery, settlement lag, broker retention, SEO sessions → signups, cost per verified carrier = $0 check). Propose where each is computed (SQL views on Supabase) and one simple CC dashboard tab — not a new BI tool.
- Privacy-respecting analytics: server-side events in Supabase or a free self-hosted option; no heavy third-party trackers that hurt Core Web Vitals.

### K. Design & UI (visual, interaction, information architecture)
- Audit all three portals plus the public site screen by screen against the **best-in-class benchmarks**: Uber Freight carrier app, Amazon Relay, DAT One, Truckstop Go, Convoy (archived), Stripe/Linear/Vercel for dashboard quality. For each screen: what would make a driver or a broker rep say "this is more polished than DAT"?
- Design system: are the brand tokens (`docs/brand-kit/loadboot-tokens.css`, Navy/Blue/Orange, dark premium) applied consistently? List every hardcoded colour, font, spacing or radius that breaks the system. Propose a single component layer (buttons, inputs, cards, tables, badges, toasts, empty states, skeleton loaders) reused by all portals.
- Information architecture: is the navigation the same mental model in carrier, partner and CC? Where does a user have to guess? Where are labels industry-wrong (e.g. a carrier would say "load", "rate con", "BOL", "POD", not internal names)?
- States: empty, loading, error, offline, success — audit every view for missing states. A marketplace with 0 loads today MUST have honest, useful empty states, not blank tables.
- Accessibility & legibility for the real user: truck cab, sunlight, one hand, big thumbs, older Android phones, poor signal. Contrast, font sizes, tap targets ≥ 44px, no hover-only actions.
- Micro-interactions and perceived speed: optimistic updates, skeletons instead of spinners, instant feedback on upload/sign/book.
- Deliver: a prioritized redesign list per screen, plus 3 "hero" screens (carrier home, broker post-load, CC daily ops) described in detail enough to build — with the rule that the redesign is **additive** (new view modules, not rewriting `app.js`).

### L. Competition & the ONE thing nobody else has (most important section)
- Build a real feature-by-feature comparison matrix: **LoadBoot vs DAT One vs Truckstop vs Uber Freight vs Amazon Relay vs Convoy-style digital brokers vs traditional dispatch services vs factoring-company load boards**. Columns: onboarding time, verification, load posting, matching, rate transparency, tracking, paperwork (packet/rate con/BOL/POD), payment speed, fees, mobile quality, trust/fraud protection, support. Mark every cell with evidence or `UNKNOWN` — no guessing what competitors do.
- From that matrix, list the **top 10 unsolved pains** carriers have and the **top 10 unsolved pains** brokers have that the incumbents still leave open (examples to test, not answers: double-brokering fraud, new-authority carriers locked out for 90 days, slow payment / factoring fees, detention never paid, rate-con paperwork chaos, brokers' cost to vet a carrier, ghost loads, no-shows, small brokers unable to afford DAT, agents managing many brokerages).
- For each pain: how big, how often, who feels it, what they do today, why DAT/Uber/Amazon have NOT solved it (structural reason, not laziness), and whether a one-person, $0-budget company **can** solve it with automation + the FMCSA/public data we already pull.
- Then choose and argue for **ONE wedge** — the single feature or guarantee that makes LoadBoot a *need*, not a nice-to-have, for both sides at once. Criteria: (1) a carrier or broker would switch or add LoadBoot *just for this*, (2) it gets stronger with every user (network/data effect), (3) incumbents cannot copy it quickly because of their business model, (4) buildable on our current stack in ≤ 90 days, (5) legally safe for a dispatch service without a broker MC. Give me your #1 and two alternates, each with: the promise in one sentence a driver understands, the MVP scope, what data/automation it needs, how it is measured, and the biggest risk.
- Then show how that wedge becomes the spine of everything else: homepage headline, SEO topic clusters, onboarding order, the CC's daily routine, and the automation roadmap. If the code and DB already contain pieces of this wedge (e.g. live FMCSA checks, broker tiers, agent multi-brokerage, Retell calls, tracking, settlement), point to them file by file and say what is missing.
- Be brutally honest: if you conclude LoadBoot currently has no defensible difference, say so and explain what would create one. Do not flatter the product.

## PHASE 1 OUTPUT FORMAT

1. **Executive summary** (≤ 1 page): the 5 things that, if fixed, most increase loads moved per week at $0 spend — and the chosen wedge from section L stated in one sentence.
2. **Scorecard**: one row per area A–L, current grade (A–F), target, biggest gap.
3. **Competition matrix + wedge decision** (section L) as its own document — this is the one I will read most carefully.
4. **Full findings table** sorted P0 → P3, each with the fields above.
5. **90-day roadmap** in 2-week sprints, each sprint deployable on its own, dependencies stated, everything sized for one person + AI.
6. **Questions for Yaseen** — every place where the right answer depends on a business decision you cannot infer from code. Never assume; ask.
7. **UNKNOWN list** — everything you could not verify and exactly how to verify it.

Stop after Phase 1 and wait for my review.

## PHASE 2 — FIX (only after I say "go")

- Work one sprint at a time, one feature branch per sprint (`audit/<sprint>-<topic>`).
- For each change: show the plan → the diff → `node --check` result → `python build_site.py` output (`BUILD OK`) → staging verification steps and results → rollback steps. Then stop for my review before the next change.
- DB: migration file in `migrations/` with the next `bl_*` number, applied to **staging only**, verified with SQL you show me, then hand me the exact prod command to run myself.
- Copy and messages: produce drafts in a separate `docs/drafts/` file for me to send. Never send.
- Keep a running `docs/AUDIT-2026-09/CHANGELOG.md` with what changed, why, how to verify, how to roll back.
- After each deploy remind me: **Netlify deploy on `main` + clear the PWA service worker** on carrier and partner portals.

## STYLE OF ANSWERS

Direct, specific, file-and-line evidence, no filler, no motivational language. English for all technical output. When you are not sure, say `UNKNOWN` — a wrong confident answer costs more than an honest gap.

Begin with Phase 0 now: read the listed files and both Supabase projects, then give me the one-paragraph "LoadBoot today" before anything else.
