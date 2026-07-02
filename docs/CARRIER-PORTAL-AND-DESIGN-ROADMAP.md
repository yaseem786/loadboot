# LoadBoot — Carrier Portal Vision + Site-Wide Design Roadmap
_Owner brief captured 2026-07-02. Goal: a carrier dashboard with no real competitor — beating Uber Freight /
Amazon Relay — for a company operating at the scale of ~300M (30 crore) carrier accounts, as a truck-dispatch
service. Everything below is broken into shippable, verifiable increments so nothing is missed._

> **Guardrails (unchanged, apply to every item):** broker-only partners; anon SECURITY DEFINER surface stays
> **5**; production feature flags OFF until owner enables; no fake/seeded data shown as real; every backend
> increment applied to BOTH DBs (staging `snslhvmkjusozgjelghi` / prod `rwscphuhpjoudvljvmdk`) + a live SQL
> security matrix + md5 parity; commit only at a bare milestone. **A global notification-colour token set**
> (info / success / warning / **urgent = red** / action-needed) is defined ONCE and reused everywhere.

---

## PART A — CARRIER PORTAL (the product the owner described, tab by tab)

### A1. Dashboard (command-and-control home)
- **Notifications feed** with globally-defined colours: anything Command Center pushes shows here — urgent = red,
  warning = amber, action-needed = blue, info/success = green. Backed by the Inc 70 notification backbone
  (`cc_my_notifications` / `emit_notification` / `cc_notify_broadcast`).
- **Account status card**: live onboarding/verification state. If anything is missing (authority, insurance,
  W-9, documents), highlight it with a direct "complete this" action → deep-link to the exact step.
- **Two-way asks**: when Command Center needs something from the carrier, it appears here as an action item.
- **At-a-glance KPIs**: active trips, this-week revenue, next pickup, open documents, P&L snapshot.
- Backend: `cc_carrier_dashboard()` — one self-scoped aggregate (account status + onboarding gaps + unread
  notifications + active trips + KPIs). Matrix-proven.

### A2. Available Loads (the differentiator — must feel like Amazon/Uber-grade, not a load board)
- Shows **broker-partner loads** AND **Command-Center direct posts**, ranked as **best-match for THIS carrier**
  (reuse the explainable matcher + AI Pilot: `cc_carrier_best_loads`).
- **Broker loads are NOT shown to carriers directly** — they flow Command Center → approve → routed to the most-
  matching carrier. Only Command-Center-approved offers surface here.
- **Every load card is decision-complete**: rate, RPM, miles, deadhead (real, labelled est.), commodity, weight,
  equipment, pickup/delivery windows or "first-come" terms, appointment vs FCFS, accessorials + **rates for
  detention / layover / lumper**, broker terms — captured as **max input from broker + Command Center at post
  time** so the carrier can decide without asking.
- **Detailed overview** per card: exact instructions for that load.
- **Book flow**: on "Book", location tracking is **enabled and mandatory until delivered**; notifications on.
- **Support before booking**: a "need help deciding?" opens **live chat** with the carrier's **personal dispatch
  officer** (every carrier has a named dispatcher).
- Backend to extend: load post schema must **require** max fields from broker + CC (accessorial rate card,
  windows, FCFS flag) before a load is eligible to surface. Matrix-proven; broker→CC→carrier routing enforced.

### A3. My Trips (post-booking, live ops — Uber/Amazon-Relay-grade UI)
- Work starts on book: **real-time tracking pickup → delivery** (mandatory, consent captured once at book).
- Beautiful trip interface: dead miles, detention, layover, lumper, accessorials — each **with rates + terms**.
- **Tracker history** shown attractively (timeline/map).
- **Exception + emergency**: carrier can notify Command Center and request a delivery reschedule, but must
  supply **proof + a detailed reason**; the accepted emergency categories are **defined and shown** up front.
- **Stop events**: if extra time is incurred (e.g. > 2 free hours at a stop) the carrier can notify CC from the
  trip — feeding the detention engine (`cc_trip_arrive`/`depart`, `cc_detention_scan`).

### A4. Fleet (run the whole trucking business here — no other software needed)
- Manage staff, drivers, trucks, trailers, equipment, and services in one place, so a truck agency needs **no
  separate software**. Builds on `cc_pocket_*` fleet + team RPCs; extend to full staff/roles/equipment/service
  scheduling.

### A5. Finance (real-time finance software for the carrier)
- A→Z money with LoadBoot: **per-trip profit/loss** and **overall** P&L; carrier enters max inputs → exact
  graphs + reports; **employee salary management**. Builds on `cc_carrier_pnl` + `carrier_expenses`; extend to
  payroll + report export.

### A6. Documents
- What LoadBoot needs from the carrier, **urgency-highlighted**; what the carrier submitted, with **status**.
  Builds on the document checklist model.

### A7. Support
- Message Command Center + **live chat**; the carrier's **dedicated dispatcher's contact** (WhatsApp / call /
  email) always visible.

### A8. Account
- All settings + profile update.

### A9. Mobile portal (companion, not a cut-down web)
- Web dashboard = full overview/control. Mobile surfaces what a driver needs on the road: today's trip, tracking,
  arrive/depart, POD upload, notifications, quick support. (PWA install already shipped in Inc 65.)

---

## PART B — SITE-WIDE DESIGN OVERHAUL
_Owner: "many pages (resources, partner program, etc.) look the same, third-class; every section must be unique,
attractive, and use conversion psychology; even icons/logos should differ."_

- **B1. Home sections** — DONE this session: carrier "process rail", broker dark panel, Brokers→LoadBoot→Carriers
  bridge diagram, and a desire-driven referral earnings panel (illustrative, honest).
- **B2. Referral (home + referral.html)** — lead with earning potential (recurring, multi-level, "paid from our
  fee, costs you nothing"), illustrative figures + honest disclaimer, strong single CTA. Home DONE; referral.html
  hero/earnings section to be upgraded to match.
- **B3. Distinct section system** — introduce a small library of section motifs (rail, timeline, split, stat band,
  diagram, dark panel, gradient CTA, comparison) and vary them per page so no two sections look identical.
  Unique icon set per theme (no repeated generic 1-2-3 cards).
- **B4. Page-by-page pass** — resources, partners, brokers, carriers, shipper-solutions, pricing, how-it-works,
  compliance pages: replace repeated card grids with the motif library; conversion copy; clear single CTA each.
- **B5. Verification** — all via `build_site.py` + `scripts/site_inventory.py`; **requires the build sandbox**
  (currently down — host disk space) to run `python build_site.py` and preview. Static review only until then.

---

## SEQUENCING (proposed)
1. **Carrier Dashboard** (A1) — backend `cc_carrier_dashboard` + matrix, then dashboard UI (uses Inc 70 feed). ← next
2. **Available Loads** (A2) — load-post max-input schema + broker→CC→carrier routing + decision-complete cards.
3. **My Trips** (A3) — live tracking UI + exception/emergency-with-proof + stop-time notify.
4. **Fleet / Finance / Documents / Support / Account** (A4–A8) — deepen existing RPCs to "no other software needed".
5. **Design**: referral.html upgrade (B2) + motif library (B3) + page passes (B4), interleaved as the sandbox allows.

## OPEN DEPENDENCIES / OWNER ACTIONS
- **Build sandbox down** (host disk space) — blocks `node --check` + `python build_site.py`; free space to restore
  full frontend verification.
- **Live chat / dedicated-dispatcher** needs a chat transport decision (existing team-chat vs a provider).
- **Referral commission tiers** remain legal-pending (prod flag OFF) — public figures stay illustrative until sign-off.
