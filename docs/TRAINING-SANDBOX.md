# Carrier training sandbox (bl_train_0548)

A reusable **training world** for dispatcher onboarding: a fully onboarded demo carrier, a demo broker and
demo freight in every state a carrier can see. A new dispatcher logs in **as the carrier** to learn the
carrier portal, and later works the same carrier **from his own dispatcher workspace**. First user: Andrew Higgins.

Nothing in a training world leaves the system, and nothing in it is visible to real carriers, brokers,
shippers, KPIs, investor numbers or public pages.

| File | What |
|---|---|
| `migrations/bl_ops_0547_staging_demo_isolation_parity.sql` | **Staging only.** Ports prod's demo isolation (bl_demo_0214–0221, never committed) to staging. Already applied on staging. Do not run on prod. |
| `migrations/bl_train_0548_carrier_training_sandbox.sql` | The sandbox: registry, outbound guards, isolation, Part C, seed/reset, CC + UI RPCs. **Run on prod first.** |
| `scripts/training/prod-seed-training-carrier.sql` | Paste into the prod SQL Editor after the migration. `ANDREW_TRAINING_EMAIL` at the top. |
| `scripts/training/staging-training-wipe.sql` | **Staging only.** Creates `training_wipe` and drops the inert `patch_fn` (the Supabase tool cannot run DELETE/DROP text). |
| `tools/training/make-samples.py` · `tools/training/samples/*.pdf` | Seven sample PDFs, each watermarked **TRAINING SAMPLE — NOT A REAL DOCUMENT**. |
| `tools/training/upload-samples.mjs` | Signs in as the training carrier and uploads the PDFs to the paths the seed recorded. |
| `app/shared/training-banner.js` (+ `app/carrier/app.js`, `app/agent/dispatcher-workspace.js`, `app/carrier/trip-map.js`, `app/shared/api.js`) | The TRAINING strip, plus the trip-map test-drive simulator for training carriers. |

---

## 1. Seed one world (prod)

Preflight done 13 Oct 2026 (read-only, prod `rwscphuhpjoudvljvmdk`): all 24 anchor patches + 8 board clauses + 10 `swap_live` targets found, no overloads; 0548 not yet applied; anon SECURITY DEFINER surface 36.

1. Apply `migrations/bl_train_0548_carrier_training_sandbox.sql` in the prod SQL Editor (one run).
   Then run the anon check from `docs/audit-2026-09/anon-secdef-baseline.md`. It must still be **36, same names**:
   every new public function revokes `public, anon`.
2. Open `scripts/training/prod-seed-training-carrier.sql` and set `andrew_training_email` to a **new** address.
   It must not be Andrew's dispatcher login; something like `andrew.higgins+training@…` works. The seed refuses an address that already has a login.
3. Run it. The result is one jsonb row. `login.password` is shown **once**, is not stored anywhere and is not committed. Give it to Andrew.
4. On your PC: `node tools/training/upload-samples.mjs --env prod --email <training email> --password '<password>'`
   This uploads the six compliance PDFs and the completed load's POD.

What one seed creates (`app_private.training_seed(email, label, dispatcher)`):

| | |
|---|---|
| Login | auth user (email confirmed) → `handle_new_user` creates profile + carrier org + owner membership, exactly as a real signup |
| Carrier | **LOADBOOT TRAINING CARRIER — \<label\>**, `is_demo = true`, active, onboarding **approved**, every mandatory compliance item **valid** (authority, COI, cargo, W-9, MCS-150, safety, bank, dispatch agreement). Phone verified on a fictional **555-01xx** number (reserved for fiction; never rings anyone). |
| Numbers | MC 9,0xx,xxx and USDOT 99,xxx,xxx, outside every range FMCSA has issued. The VIN has `0` in position 10, which is not a valid model-year code, so it cannot belong to a real vehicle. Bank account 000000000000 / routing 000000000. TIN 00-0000000. |
| Fleet | 1 Sprinter van **TRAIN-1**: VIN scheduled on the COI (`coi_coverage.mode = scheduled`), one driver, today's availability posted. |
| Prefs | home Dallas TX, lanes TX→TX/OK/AR/LA, floor $2.00/mi, deadhead 120, home weekly, `external_boards = {"dat":"active"}` |
| Broker | **DEMO BROKER — Training (\<label\>)**, `is_demo`, verified packet ("nothing reviewed"), `broker_tier = verified`, so its loads are bookable now |
| Dispatcher | assigned through the real `cc_dispatcher_assign` (thread, notices); 2 opening thread messages |
| a | 6 board loads: Dallas→Houston (matching lane), Fort Worth→Austin **partial**, Dallas→Shreveport **hotshot** (a Sprinter can't take it), Dallas→Little Rock **above** the floor, Dallas→OKC **below** the floor, Garland→San Antonio |
| b | Irving→Tulsa **pending offer** from the dispatcher (Accept / Decline; expires in 3 days) |
| c | El Paso offer **declined**, Plano→Waco offer **expired** |
| d | Dallas→Memphis **booked, pickup in 3 days**, rate confirmation built by the real trigger (My Loads → Upcoming) |
| e | Dallas→Fort Worth **ready to start** today: driver + truck on it, RC acknowledged |
| f | Dallas→Houston **in transit**: pickup check-in, 6 tracking points, 2 check calls |
| g | Arlington→Lubbock **delivered, waiting for POD** (its fee invoice was issued by the real auto-invoice trigger) |
| h | Dallas→San Antonio **completed**: POD approved, **$80 detention** approved; LoadBoot fee invoice **gross $2,080 · fee $100 (5% of the $2,000 line-haul only) · net $1,980 · Net-30** |

No Stripe or QuickBooks invoice is ever created. On staging `lb_stripe_queue` is guarded; prod has no Stripe fee billing.

## 2. Reset, reuse, hand over

| Do | How (SQL Editor) | CC / staff session |
|---|---|---|
| Back to the clean state | `select app_private.training_reset('<carrier_org>');` then re-run `upload-samples.mjs` | `cc_training_reset(p_org)` |
| Give the carrier to the trainee's **own** dispatcher account (Part C) | `select app_private.training_set_dispatcher('<carrier_org>', '<dispatcher user id>');` (Andrew on prod: `66544e6b-ab05-4427-a9e3-5d05ec7c6208`) | `cc_training_set_dispatcher(p_org, p_dispatcher)` |
| Next trainee | a new seed with a new label (`'Bilal'`), or reset + hand over the existing world | `cc_training_seed(email, label, dispatcher)` |
| List worlds | `select public.cc_training_worlds();` from a staff session | `cc_training_worlds()` |
| What was held | `select * from app_private.training_blocked_log order by id desc;` | |

Reset removes the world's loads, trips, offers, bookings, invoices, RCs, POD files, book requests, checklists,
the carrier's in-app notifications and the non-system thread messages. It then re-runs the carrier fill (onboarding, compliance,
van, driver, availability, prefs, bank are put back even if the trainee changed them) and re-seeds a–h.
The login, the org and the dispatcher assignment stay.

## 3. How it stays sealed

**Registry, not `is_demo`.** Every guard keys on `app_private.training_worlds`. `hello@loadboot.com` is the
only member of the demo org "LOADBOOT TEST CARRIER (internal)" and gets ~200 real emails a month, so
"no mail to demo-org users" would have cut the owner's own inbox off.

A send is held when any of these is true:
- a seed/reset is running (`lb.training_ctx`);
- the actor is a training login;
- a dispatcher is acting for a training carrier (`app.dispatch_as`);
- the recipient is a training login or its email;
- any id on the row (org, load, trip, offer, booking, assignment, invoice, idempotency key, links in the body) belongs to a training world;
- the text names `TRAINING CARRIER` / `DEMO BROKER — Training`;
- the same user request changed a training row. This last rule is ignored for real customers, because crons batch real and demo rows together.

Held rows are **marked, not dropped**, because several writers use `insert … returning id`:
- email/SMS `status = suppressed`;
- push `sent_at` set;
- WhatsApp auto and webhooks `status = skipped`;
- Stripe `done_at` set.

Every hold is logged in `training_blocked_log`. Interactive sends (dispatcher SMS, WhatsApp, outbound call log, Riley call plans) **raise**
"TRAINING ACCOUNT — nothing here is real…", so the dispatcher sees why.

### Side-effect audit (PART B)

| Path | Before 0548 | Now |
|---|---|---|
| `sys_email` → `message_deliveries` (every catalog email, factoring/NOA, billing, onboarding, dispatcher assignment, offers, trip status, POD, book requests) | not demo-aware; would mail the trainee's real address, the dispatcher and staff | **guard added**: `a0_training_guard`, marked `suppressed` |
| `cc_enqueue_transactional`, `fire_comm_trigger`, `lb_email_notify`, `reminder_dispatch`, `cc_campaign_enqueue` | write the same table | **guard added** (same trigger) |
| Weekly / reminder / outreach audiences (`weekly_recipients`, `reminder_recipients`, `cron_*` nags) | already skip `is_demo` | already safe, and the guard also covers them |
| Push (`push_enqueue` → `push_outbox`) | not demo-aware | **guard added**: `sent_at` set, never delivered |
| WhatsApp auto (`wa_auto_enqueue`, `wa_call_alert` → `wa_auto_outbox`) | `wa_auto_enqueue` skips demo; `wa_call_alert` does not | **guard added** (`skipped`) |
| Dispatcher SMS (`dialer_sms_prepare` → `dialer_messages`), WhatsApp (`wa_send_prepare` → `wa_messages`) | not demo-aware | **guard added**: raise |
| Outbound calls (`dialer_calls`) | not demo-aware | **guard added**: raise on the log row; the training phone is a fictional 555-01xx, so even a call placed by the browser rings nobody |
| Riley / Retell (`riley_plan_new`, `riley_dial_gate`; `retell_dial` serves live-chat callbacks only) | already skip `is_demo` | already safe + **guard added** on `riley_call_plans` (raise) |
| Webhooks (`fanout_domain_events` → `webhook_deliveries`) | no tenant filter at all (see open items) | **guard added** (`skipped`) |
| Stripe fee billing (staging `lb_stripe_queue`), autopay | queue not demo-aware | **guard added** on the queue (staging); prod has no Stripe fee billing. Autopay needs a Stripe customer, which a training org never has |
| QuickBooks | only syncs a carrier that connected QBO; the training carrier never does | already safe |
| FMCSA authority (`fmcsa_authority_request`, incl. the signup trigger) | dispatch/backfill skip demo; the request itself and the signup trigger did not | **guard added**: returns before any lookup for demo orgs |
| FMCSA snapshot sweep (`fmcsa_snapshot_queue`) | not demo-aware; would look up the fake DOT and could flip the carrier inactive | **guard added** |
| Broker screening (`broker_screen_request`) | sweep skips demo; only staff/portal call it otherwise | already safe |
| Matcher / auto-dispatch (`tp_match_new_load`, `tp_run_matcher`, `cc_auto_dispatch_run`) | skip demo | already safe |
| Dispatcher commissions | not demo-aware | **guard added**: no `dispatcher_commission` row for a demo carrier |
| In-app notifications | — | allowed (they stay inside the portal); during seed/reset, notices to anyone but the training carrier are pre-read so staff feeds stay clean |
| Geocoding (`geo_loads_trg`) | city lookups only, no person, no message | allowed (coordinates are seeded anyway) |

### Visibility audit

| Surface | Now |
|---|---|
| Carrier board, booking, prebook, suggestions, fleet plan, posting matches | symmetric demo rule (prod since 0215; staging since 0547) **plus** `training_load_ok`: a training carrier sees only its own broker's freight, and nobody else sees it, including the Play-review demo accounts and other training worlds |
| Dispatcher acting for a carrier | `session_is_demo()` now honours `app.dispatch_as`. Before this, a real dispatcher working a demo carrier saw **real** loads and could request one for a fake carrier |
| "Best loads" ranking (`cc_carrier_best_loads`) | was not demo-aware for anyone; now ranks only the target carrier's side |
| Broker directory / eligible carriers / offers | symmetric + `training_org_ok` |
| Public board `get_public_load_opportunities` | excludes demo (0219 / 0547) |
| CC KPIs `cc_get_overview`, `cc_analytics_overview`, `cc_dispatchers_stats` | read `app_live.*` (non-demo views) |
| Investor `inv_growth_metrics`, `inv_growth` | excluded demo **orgs** but counted demo loads, trips and **fees**. Now read `app_live.*` |
| Dispatcher scorecards (`disp_kpis`), trial daily report + email (`disp_trial_stats`, `disp_trial_daily_build`), capacity, carrier choice | read `app_live.*` |
| `cc_dispatcher_assign` capacity (trial_max_carriers, waivers, max_carriers, max_trucks, proof_loads) | counts real carriers only; assigning a demo carrier never uses a slot |
| Market-rate engine / site facts | built from staff-set `rate_standards`, never from loads. Already safe |

`app_live` is a private schema whose views carry the **same table names** (`app_live.trips`, …), so swapping
`app_private.trips` → `app_live.trips` keeps every alias valid. The views expand `select *` at creation: a column added to one of
those tables later must be added by re-running its `create or replace view` before a reporting function uses it.

### Sandbox-only exceptions (training registry only)

- `carrier_capacity()` is +5 for training carriers, so one van can hold the upcoming, ready and in-transit trips and still
  book a board load and accept the offer. `match_eligibility` and `cc_my_capacity` now call the same function, which gives the same result for
  every other carrier.
- Training fee invoices are due 30 days after issue (site terms). See the open items about prod.
- The trip map's test-drive simulator (🧪) shows for training carriers. A trainee is never at the pickup, and check-ins are GPS-proofed (800 m).
  The simulator drives the van, so the server's GPS rule stays untouched.
- Banner: training worlds show **TRAINING ACCOUNT — nothing here is real**. Other demo orgs (Play-review accounts, the internal test carrier)
  show **DEMO ACCOUNT — nothing here is real**.

## 4. Verified on staging (13 Oct 2026)

| Check | Result |
|---|---|
| Login | the seeded user signs in through Supabase Auth and the real `/app/carrier/` login page (Chromium); banner + carrier name shown; phone width has no horizontal scroll |
| a | board shows exactly the 6 training loads; `cc_pocket_book_load` booked Dallas→Houston |
| b / c | offers listed as sent / declined / expired; `cc_offer_respond(accept)` booked Irving→Tulsa and created the trip |
| e | `cc_trip_arrive_gps` (simulator coordinates, 7 m) → `cc_trip_depart` → `cc_pocket_advance_trip(in_transit)` → GPS arrive at delivery → `delivered` |
| g | `cc_pocket_upload_pod` filed the POD |
| h | invoice gross 2,080 / fee 100 / net 1,980 / sent / Net-30 |
| Dispatcher tab | dispatcher, 2 approved bookings; carrier confirmed one (`carrier_booking_ack`); readiness checklist all green |
| Part C | dispatcher board for the training carrier = training loads only; `dispatcher_request_book` → pending request in the carrier's Dispatcher tab; a trial dispatcher (cap 1) holding the training carrier could still be assigned a real carrier (rolled back) |
| Outbound | 41 emails created across seed + walk-through, **41 suppressed, 0 sendable**; 0 push / WA / webhook / Stripe / Riley / SMS / FMCSA / commission; interactive SMS refused |
| Isolation | real carrier: 10 loads, 0 demo, all 3 booking RPCs refuse a training load id; real broker directory: no training carrier; public board: 0; a second world ("Preview") sees only its own 6 loads |
| KPIs | trips 22 raw vs 17 `app_live`, invoices 20 vs 18; test dispatcher's scorecard / trial stats = 0 bookings, 0 carriers |
| Anon SECURITY DEFINER | staging **35, same names**, before and after |
| Build | `node --check` + esbuild (single files and full bundles) on every edited `.js`; `npm run check` all pass; `python build_site.py` → **BUILD OK** |

**Found by testing and fixed:** the very first seed runs before its registry row exists, and every guard's "no worlds yet" fast path
skipped the seed flag. So welcome / signup emails to the trainee and to staff were queued (staging, `.invalid` addresses; held by hand).
The seed flag now wins over the fast path.
A second one: with an email catalog key in `send_mode = test`, `sys_email` rewrites the recipient to the test inbox
and blanks the user id, so a "new sign-in" alert for the training login slipped past. The guard now also reads `meta.intended_for`.

## 5. Open items for the owner

1. **Net-15 vs Net-30 (money, your call).** Prod `auto_invoice_on_delivery` issues real fee invoices on **Net-15** (`current_date + 15`,
   email says "net 15"); loadboot.com/pricing and /factoring-noa say **Net-30**. Staging's trigger is already Net-30. Training invoices follow
   the site; real carriers are untouched.
2. **Webhook fan-out has no tenant filter.** `fanout_domain_events` delivers every event to any endpoint subscribed to that event type,
   whoever owns it. Today the only active endpoint subscribes to nothing, so nothing leaks. One subscription would send it every org's events.
3. **Staging cleanup needing your approval**: the Supabase tool asks for confirmation on any SQL with `DROP`/`DELETE` and times out.
   - `app_private.training_wipe` (and so `training_reset`) is **not yet created on staging**. Paste `scripts/training/staging-training-wipe.sql` into the staging SQL Editor (it also drops `patch_fn`, below).
   - `drop function app_private.patch_fn(text,text,text,text);` removes an inert helper left by bl_ops_0547 (it only raises).
4. A dispatcher's request-to-book goes to the training broker, which nobody answers. Staff can approve it in CC, or it expires in 30 minutes,
   which is also a lesson.
5. Residual gap, documented: a **cron** notice to the dispatcher about a training trip that carries no id, no training name and no training actor
   would not be recognised. The ones checked all carry the trip/booking id.

Staging fixtures (throwaway, `.invalid` addresses): worlds **Staging QA** (walked through) and **Preview** (fresh), stand-in dispatcher
`stg.dispatcher.0548@training.loadboot.invalid`.

---

## 6. Trainee checklist: what to study (1 page)

You are logged in as a **carrier**, so you see exactly what your carriers see. Nothing here is real; break things freely.

**Day 1: the carrier's world**
- [ ] **Dashboard**: what "compliant", "account active" and "trips active" mean to a carrier.
- [ ] **Documents**: authority, COI, W-9, MCS-150, voided check, dispatch agreement. Open the COI: which VIN is scheduled on it, and why a truck that isn't on the COI cannot be dispatched.
- [ ] **Fleet**: TRAIN-1 specs (payload, pallets, doors). Which loads can a Sprinter take?
- [ ] **Account → Dispatch preferences**: lanes, $2.00/mi floor, deadhead, home time, DAT seat. Every booking decision starts here.

**Day 2: finding and booking freight**
- [ ] **Load Board**: sort the 6 loads into: book, counter, pass. Why is the hotshot load wrong for this van? Which load is below the floor, and by how much $/mi?
- [ ] Book the best one yourself. Watch it move to **My Loads**.
- [ ] **Requests**: accept the pending offer from your dispatcher. Read why the declined and expired ones went the way they did.
- [ ] **Dispatcher tab**: who your dispatcher is, the thread, the bookings they made, and how a carrier confirms or flags a problem.

**Day 3: running the load**
- [ ] **Upcoming** (Dallas→Memphis): open the rate confirmation and find detention, TONU, layover, lumper, POD deadline and invoice instructions.
- [ ] **Ready to start** (Dallas→Fort Worth): press **▶ Start your trip** → 🧪 test drive. Watch the check-in at pickup, departure, delivery. These GPS events are the proof for on-time and detention pay.
- [ ] **In transit** (Dallas→Houston): read the tracking points and check calls. What does a good check call say?
- [ ] **Delivered** (Arlington→Lubbock): upload the POD (any PDF; `tools/training/samples/training-pod.pdf` works). Why does the POD need to go in within 48 h?

**Day 4: money**
- [ ] **Finance → Invoices** (Dallas→San Antonio): line-haul **$2,000** + detention **$80** = gross $2,080. LoadBoot's fee is **5% of line-haul only = $100**; detention, TONU, layover and lumper are 100% the carrier's. The fee is a **separate invoice, Net-30**.
- [ ] Explain to a carrier in two sentences what they keep on a $2,000 load with 2 h detention.

**Day 5: from your dispatcher seat** (after staff hands the carrier to your own dispatcher login)
- [ ] Workspace **Board** for the training carrier: request a load. Watch it appear in the carrier's Dispatcher tab.
- [ ] Thread: write the carrier a booking summary (lane, pickup window, rate, $/mi, RC status).
- [ ] Calls, SMS and WhatsApp to a training carrier are blocked on purpose. Practise the words in the thread instead.

When you are done, staff resets the world for the next trainee.
