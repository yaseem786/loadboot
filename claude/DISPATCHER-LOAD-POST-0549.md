# bl_disp_0549 — Dispatcher posts a 3rd-party load on his carrier's board (13 Oct 2026)

Owner ask (`bl_disp_post`): a dispatcher finds a load on DAT / Truckstop / 123Loadboard / Direct Freight / a broker
call and posts it so it appears **on his assigned carrier's LoadBoot load board**, tagged "Posted by your dispatcher
<name>", with the same card, detail and decision flow the carrier already uses. No new screen for the carrier.

## What shipped

| Layer | File | What |
|---|---|---|
| DB | `migrations/bl_disp_0549_dispatcher_load_post.sql` | column `loads.target_carrier_org`; check constraints widened (`source_type` 'dispatcher', `verification_state` 'dispatcher_posted', `status` 'carrier_accepted' / 'declined' / 'withdrawn' / 'expired'); RLS `loads_visible` via `public.lb_load_target_visible(uuid)`; 5 catalog rows; RPCs; visibility patches; cron `lb-disp-posts-expire` (*/10 min). |
| Dispatcher | `app/agent/dispatcher-workspace.js` | Board tab → **"Post a load for <carrier>"** (one page, grouped Source / Broker / Lane / Freight / Money / Notes; MC blur = inline FMCSA screen, non-blocking; equipment restricted to the fleet; $/mi + all-in $/mi live; below-floor needs a written reason). **"Loads you posted"** card: status, countdown, Edit / Withdraw / Log booking (pre-fills Log a booking) / Attach the RC / Post again. Deep link `#board/post`. |
| Carrier | `app/carrier/app.js` | Board card: orange-on-navy badge "Posted by your dispatcher Andrew", "Found on DAT", countdown, below-min flag, broker line + note; sorted first; chip **"From my dispatcher (n)"**; buttons **"I'll take it" / Decline** (reason required). Detail view: every field, broker screen (✓ active / 🚩 flag), payment terms, accessorials, countdown, the two buttons. Dashboard strip "N loads from your dispatcher waiting". `lbNotifDest`: `dispatcher.load.*` → loads. Deep link `/app/carrier/#loads/<id>` opens the detail. |
| CC | `app/command-center/views/carrier360.js`, `dispatcher-360.js` | Carrier 360 → "Loads posted by the dispatcher" (source, dispatcher, status, decision, booking; staff **Withdraw**). Dispatcher 360 header: Loads posted · accepted / declined / expired. |
| API | `app/shared/api.js` | `dispatcherPostLoad`, `dispatcherUpdateLoad`, `dispatcherWithdrawLoad`, `dispatcherMyPosts`, `dispatcherBrokerScreen`, `carrierDispatcherLoadDecide`, `ccDispatcherPosts`. |

## Flow
1. `public.dispatcher_post_load(p_org, p)` — `disp_is_assigned` + carrier not paused/held (`app_private.disp_carrier_open`); equipment must be in `disp_carrier_equipment`; rate check against `disp_effective_min(truck, org)` → below needs `below_min_reason` (stored in `details.below_min_reason`, flagged `details.below_min`). Inserts `public.loads` with `source_type='dispatcher'`, `source_provider=<board>`, `source_reference`, `verification_state='dispatcher_posted'`, `confidence` from the broker screen, `is_public=false`, `target_carrier_org=p_org`, `expires_at=now()+expiry` (default 2 h), `details` = full form + `dispatcher_post{dispatcher_user, dispatcher_name, board, board_label, note, expires_at, broker_screen}`, `accessorials`, `field_meta.posted_by`. `is_demo` is forced to the carrier's flag after insert (`stamp_load_demo` would otherwise reset it from the null broker_org).
2. Notify (`app_private.disp_post_notify_carrier`): carrier members (owner first, ≤3) in-app `dispatcher.load.posted` (url `/app/carrier/#loads/<id>`) + push (`push_enqueue`) + premium e-mail (`email_kit` body, catalog key `dispatcher.load.posted`, `email_gate` honoured, idempotency `disp-post:<load>:<email>`). **Demo orgs: in-app + push only.** Staff in-app `dispatcher.post.created`.
3. Visibility: only `target_carrier_org` members, the poster and staff. Patched: RLS, `cc_pocket_available_loads` (sorted first, hidden once `expires_at` passes, exempt from the demo/training clause), `cc_load_detail` (opens in every state for the target carrier; `posted_by` = "Your dispatcher <name>", returns `dispatcher_post`, `expires_at`, `source_*`, `broker`, `notes`), `cc_carrier_best_loads`, `tp_match_new_load`, `tp_run_matcher`, `get_public_load_opportunities`.
4. Carrier decides — `public.carrier_dispatcher_load_decide(p_load, p_action, p_reason, p_truck)`:
   - **accept** ("I'll take it"): compliance (`carrier_mandatory_ok`) + hazmat gate as the Book path; load → `carrier_accepted`, `assigned_to` = owner; **`dispatcher_bookings` row** (`pending_rc`, `source=<board>`, `load_id`, truck = the post's truck or the first fleet truck of that equipment, broker/MC/rep/phone/email, pickup/delivery at from date + window, below_min carried); booking event; dispatcher `dispatcher.post.accepted` (in-app + e-mail, deep link `#bookings/<id>`); staff in-app; carrier in-app "Your dispatcher is getting the rate con…"; system line in the assignment thread.
   - **decline** (reason required): load → `declined`, `details.decision.reason`; dispatcher `dispatcher.post.declined` with the reason.
5. `cc_dispatcher_booking_decide` (unchanged pipeline): **approve** also moves the load `carrier_accepted → booked`; **reject** moves it to `declined` (`details.cc_rejected`).
6. Edit / withdraw: `dispatcher_update_load` (poster or staff, only while `available`; same validation; `expiry_hours` only resets when sent; carrier gets in-app `dispatcher.load.updated`), `dispatcher_withdraw_load` (→ `withdrawn`; the carrier is told in-app, and by e-mail (`dispatcher.load.withdrawn`) only if they had read the post notification).
7. Expiry: `app_private.disp_posts_expire()` (cron `lb-disp-posts-expire`, */10) → `expired` when `expires_at` passed or the pickup date is gone; dispatcher `dispatcher.post.expired`.
8. Reports: `cc_dispatcher_360.posts {posted, open, accepted, declined, expired, withdrawn, below_min}`; `cc_carrier_360.dispatcher_posts[]`; `cc_dispatcher_posts(p_org, p_user)`; daily trial e-mail: "Loads posted" under Effort, "Posts accepted" under Outcome, and a day with posts is not a zero day.

## Staging verification (13 Oct 2026, project `snslhvmkjusozgjelghi`)
Dispatcher `b89cff94…` (stg.dispatcher.0548) → carrier "LOADBOOT TRAINING CARRIER — Staging QA" `e6f5fdf8…` (demo, Sprinter Van, floor $2.00/mi).
- Equipment not in fleet (Flatbed) → refused. $1.33/mi without reason → `BELOW_MIN` refused. $2.67/mi → posted (`4dd4e53a…`). $1.82/mi with reason → posted, `below_min=true`, reason stored (`0965ca4f…`).
- Carrier board (owner `45cca28b…`): both posts first, with `details.dispatcher_post`; detail opens; RLS select works (2 rows + the rest). **Other carrier** (`0355822f…`): 0 on board, 0 via RLS, detail raises "load not available". `get_public_load_opportunities`: 0. Matcher: 0 matches created. `dev_api_loads` is `is_public`-only.
- Notifications: carrier in-app ×1 per post (url `#loads/<id>`), staff in-app ×1; **demo org → 0 e-mails**. Non-demo org (rolled-back DO block on `77c6e374…`): 1 `message_deliveries` row queued, subject "LoadBoot: New load from your dispatcher — Dallas, TX → Memphis, TN · $1,200".
- Decline without reason → raises. Decline with reason → `declined`, dispatcher notified with the reason. Accept → `carrier_accepted`, booking `34c9d599…` `pending_rc` with all broker fields, event, dispatcher + staff + carrier notices, thread line. CC reject of that booking → load `declined`.
- Edit → rate/notes/window/version bumped, carrier `dispatcher.load.updated`. Withdraw (after the carrier read the post) → `withdrawn`, carrier `dispatcher.load.withdrawn` in-app (demo → no e-mail).
- Expiry: post with 15-min expiry, `expires_at` moved into the past, `disp_posts_expire()` → 1, status `expired`, dispatcher `dispatcher.post.expired` (e-mail suppressed: `.invalid` address).
- Staff: `cc_dispatcher_posts`, `cc_carrier_360.dispatcher_posts` (2), `cc_dispatcher_360.posts {posted 2, open 2, below_min 1}` ✓.
- Anon SECURITY DEFINER surface: **35 on staging, names = baseline** (none of the 8 new public functions is anon-executable).
- Gates: `ESM SYNTAX CHECK: ALL PASS (232 files)`, `IMPORT-REFERENCE CHECK: PASS`, esbuild OK on all 5 edited modules, `python build_site.py` → BUILD OK.
- Test records left on staging (all terminal, demo org): loads `4dd4e53a…` (declined via CC reject), `0965ca4f…` (declined), Tulsa→Dallas (expired), Waco→San Antonio (withdrawn); booking `34c9d599…` (rejected).

## Coordination with bl_train_0548 (carrier training sandbox) — 13 Oct 2026
Peer session's review (verified against staging + prod, read-only) and what changed:
- **Numbering:** 0547 was taken twice on main (`bl_dial_0547`, `bl_ops_0547`), 0548 = training → this is **bl_disp_0549**. 0550 is reserved by the training session.
- **Order on prod: 0548 → 0549.** The file starts with a preflight that raises unless `training_load_ok` + `app_live.loads` exist (prod has 0548 since 13 Oct).
- **Training carrier sees its posts:** a post has no broker_org, so `training_load_ok(null, null)` is false for a training world; the board exempts `target_carrier_org = v_me` from that clause (verified on "Staging QA"), and `cc_carrier_best_loads` now reads the world from `coalesce(broker_org, shipper_org, target_carrier_org)`.
- **Scorecards read `app_live.*`:** `disp_trial_stats` (loads_posted / posts_accepted) and `cc_dispatcher_360.posts` read `app_live.loads` (the non-demo view), so training posts never count. The view is `select *` frozen at 0548 and lacks `target_carrier_org`; nothing reporting needs it.
- **Training reset:** `training_wipe` is anchor-patched (guarded by `to_regprocedure`) to also delete `target_carrier_org = w.carrier_org`.
- **Demo/training quiet:** no staff in-app on post or accept, no push, no e-mail for demo carriers; `training_blocked_log` shows the sandbox guard stopping the dispatcher-side e-mails too (ids 84–87).
- Verified again: a real (non-demo) carrier session sees 0 targeted posts on the board and in best-loads; `authenticated` holds no SELECT grant on `public.loads` on either DB (the RLS change is defence in depth).

## PROD — applied 13 Oct 2026 (project rwscphuhpjoudvljvmdk)
Applied in the part order below after main merged `claude/dispatcher-load-post`. Policy changed: `loads_carrier_select`. All 19 anchor patches hit once. Cron `lb-disp-posts-expire` scheduled. Anon SECURITY DEFINER surface after apply: see the line in SESSION-CHANGELOG (must be 36, names = baseline).

## PROD apply notes — read before touching prod
- **Apply in parts through the MCP, not as one `apply_migration` call.** A 66 KB apply timed out at 60 s with nothing committed; the real blocker was `drop policy` — the Supabase MCP holds any `drop policy` for a confirmation that never arrives in an autonomous session and times out. The file now uses `alter policy loads_visible … using (…)` (same end state). `drop constraint` is fine.
- Order used on staging (each its own `execute_sql`, each re-runnable): (1) `fn_patch` helper + column + indexes + the three constraints + `lb_load_target_visible` + `alter policy` + catalog rows → (2) helpers (section 3) → (3a) dispatcher RPCs (section 4–5) + (3b) `carrier_dispatcher_load_decide` → (4) `disp_posts_expire` + cron → (5a) the `fn_patch` DO block → (5b) grants + anon assertion.
- **RLS policy names differ:** staging `loads_visible` (role public), prod `loads_carrier_select` (role authenticated), same expression. The migration loops over every permissive SELECT policy on `public.loads` and ALTERs each (creates `loads_visible` only if none exists), then asserts none ignores `target_carrier_org`. Prod read-only check 13 Oct: `loads_admin` (`is_admin()`, all) + `loads_carrier_select` (select) — only the latter changes.
- `app_private.fn_patch(regprocedure, anchor, replacement)` replaces exactly one occurrence of the anchor in `pg_get_functiondef` and re-executes it; it raises if the anchor is found 0 or 2+ times and is a no-op when the replacement is already present. **Prod anchors were checked read-only on 13 Oct: every anchor hits exactly once on prod** (same function bodies as staging), so the DO block applies as-is.
- After apply: `select count(*) …` anon-executable SECURITY DEFINER in `public` must read **36 on prod** (35 + `retell_inbound`) and the names must equal `docs/audit-2026-09/anon-secdef-baseline.md` — the new functions must NOT appear.
- Cron: `lb-disp-posts-expire` (*/10 * * * *) is created idempotently (unschedule-then-schedule by name).
- No brain permission rows (§9): the brain gets no new tool or source here.
- Deploys: none needed for e-mail (body = `email_kit`, shell added by the existing `delivery-worker`); the site build carries the four JS files.

## Not built / notes
- `verified_broker_orgs` does not exist on either database; the broker screen reuses `app_private.broker_screenings` (by MC) + the `fmcsa-verify` edge function live from the client (`fmcsaVerify({ mc })`), the result is stored in `details.dispatcher_post.broker_screen` and drives `confidence` (active → high, unknown → medium, flagged → low). Insurance on file is not read by `fmcsa-verify`; the form says so.
- "Send as offer" waits for `bl_disp_offer` (not built); the posts card shows Edit / Withdraw / Log booking / Attach the RC / Post again.
- Miles auto-fill is client-side (`roadMiles` from the usGeo city table, same as Log a booking); deadhead = truck's last posted `empty_location` (or domicile) → origin. Server-side geocoding of the lane still runs through `geo_loads_trg` for the carrier's live deadhead badge.
