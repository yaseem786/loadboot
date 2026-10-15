# Availability-first dispatching + one-intro-call rule (bl_disp_0555) — design + state

Owner decision 15 Oct 2026 (the prompt said 0551; that number was taken by dispatcher post tracking the same day, so
this ships as **bl_disp_0555**). Mode on deploy: **warn** — nothing is blocked, everything is visible and counted;
CC flips to **enforce** when carriers are posting.

## 0. What exists and is reused (nothing rebuilt)

| Piece | Where | Used for |
|---|---|---|
| `app_private.truck_postings` (`post_kind`, `last_confirmed_at`, `available_to`, `created_by`) | carrier portal "Post your availability" (`bl_avail_0394/0538`, `cc_post_truck`) | **the carrier's own post** — this is what "availability" means to a carrier |
| `app_private.truck_availability` (`status`, `updated_by`, `updated_at`) | dispatcher workspace Trucks tab + carrier (`dispatcher_set_availability`, shared writer) | a carrier-written row counts; a dispatcher-written row never does |
| `public.cc_my_availability_status` | carrier portal card (24 h rule, `availability.js`) | unchanged — the 24 h "dispatcher works today" card stays; the 7-day **gate** is a separate, softer rule |
| `app_private.disp_carrier_open(p_org)` / `disp_is_assigned` / `disp_act_as` | every dispatcher write RPC | the new gate sits right after `disp_carrier_open` |
| `public.dispatcher_post_load / dispatcher_post_truck / dispatcher_log_booking / dispatcher_request_book` | dispatcher workspace | gated (warn → `availability_warning` in the result, enforce → error) |
| `public.cc_pocket_available_loads` (TABLE) + `cc_carrier_best_loads` | carrier portal board | enforce → no rows for a gated carrier; warn → untouched |
| `public.carrier_dispatcher_desk` | carrier Dispatcher tab + dashboard card | now carries `availability_gate` |
| `public.dialer_lookup` / `public.dialer_call_start` / `dialer_call_update` / `dialer_hook_event` | `app/shared/dialer.js` | lookup carries the reason list + intro state; call_start enforces; answered → `intro_call_at` (trigger) |
| `app_private.dial_match` | number → broker / driver / carrier | tells us a call is to **this carrier** |
| `app_private.dispatcher_messages` (`sender_role='system'`) | shared thread | system lines for calls |
| `app_private.disp_notify(user, role, template, title, body, url, email)` | in-app + e-mail | carrier notice + staff notices |
| `app_private.disp_desk_config (key, value)` (`bl_disp_0408`) | CC | the mode switches live here (no new config table) |
| `app_private.disp_trial_stats` → `disp_trial_daily_build` (`disp_tdr_kpi` tiles) | daily trial e-mail | two new tiles |
| `public.cc_dispatcher_360`, `cc_carrier_360` | CC | chip data on the assignment row |
| `app_private.disp_assign_brief_html` | dispatcher's assignment brief e-mail | the standing rules box |
| `public.cc_dispatcher_sop` / `dispatcher_assignments.sop` | CC SOP form | the standing rules are shown above the editable SOP, not stored in it |
| cron `lb-disp-*` (`disp_posts_expire` every 10 min, `disp_unreachable_run` hourly) | pg_cron | `lb-disp-avail-sweep` hourly |

## 1. Rules (plain words)

**A. The carrier posts availability.** "Fresh" = within the last `availability_fresh_days` (7) the **carrier** (a member of
the org — not a dispatcher, not staff) did one of: a truck posting (`truck_postings.status='active'`, `available_to >= today`,
`last_confirmed_at` in window) or a Trucks-tab availability line (`truck_availability.status in (empty, loaded)`,
`updated_by` = carrier member). Helper `app_private.carrier_availability_fresh(p_org)` → `(fresh, since, trucks, reason)`;
reason ∈ `ok | never | stale | dispatcher_only | no_trucks`.

**B. A dispatcher never writes availability for the carrier.** `dispatcher_set_availability` with role `dispatcher`:
enforce → error *The carrier posts their own availability. Ask in the thread.*; warn → saved, but the result carries the
same sentence as `warning`, the row never counts as fresh, and the Trucks-tab button says so. Staff keeps the ability.

**C. The gate (only for carriers WITH an active dispatcher; board-first carriers are never gated).**
`app_private.disp_availability_gate(p_org)` → `{mode, assigned, fresh, since, trucks, reason, blocked, warn, last_label, message}`.
- Carrier board: enforce + not fresh → `cc_pocket_available_loads` / `cc_carrier_best_loads` return nothing and the portal
  shows the full-width card *You can't see loads until you post your availability* → **Post availability** (opens the quick
  post, `openQuickPost('empty')`). warn → loads as before + a banner *Your dispatcher hunts loads by your availability — post today's*.
- Dispatcher: `dispatcher_post_load`, `dispatcher_post_truck`, `dispatcher_log_booking`, `dispatcher_request_book`:
  enforce + not fresh → error *Carrier has not posted availability — nothing to work until they do.*; warn → goes through,
  result carries `availability_warning`. Workspace carrier card: chip **Waiting for availability · last posted <date|never>**
  (both modes); Post / Board / Book buttons greyed only in enforce.
- CC Carrier 360 + Dispatcher 360 assignment row: same chip (`availability` object on the assignment).

**D. Carrier notice** — catalog key `carrier.availability.required` (class T, audience carrier, pref group `load_ops`,
unsub allowed). In-app + e-mail (email_kit; CTA **Post availability** → `https://loadboot.com/app/carrier/#availability`).
Fires at `cc_dispatcher_assign` (new carrier) and from the hourly sweep while an active assignment is not fresh; **max once per
24 h per carrier** (`app_private.disp_avail_notices`), stops the moment the carrier is fresh. Mode `off` → never. Copy:
*Your dispatcher <first name> can only work loads for trucks you've marked available. Post today's availability (30 seconds) —*
warn: *that post is what every load is matched to.* / enforce: *until then the board stays hidden.*

**E. Calls — one intro call, then the portal, unless urgent.**
- `dispatcher_assignments.intro_call_at / intro_call_id`: set by trigger when the dispatcher's outbound call to a number of
  this carrier (owner / WhatsApp / driver) with reason `intro` is **answered**.
- `app_private.disp_call_reasons` (CC-editable: label, urgent, active, sort; codes fixed). Seed: `intro` (allowed while
  `intro_call_at` is null), `pickup_24h` ✱, `transit_problem` ✱, `broker_confirm` ✱, `carrier_asked` ✱, `other` (not urgent).
  ✱ = urgent. `callback` is automatic: the carrier called in the last 30 min.
- `dialer_lookup` adds `carrier_call = {assignment_id, carrier, intro_call_at, callback_ok, reasons[]}` when the number is a
  carrier/driver of an active assignment, so the phone shows the reason picker **before** dialling. Broker and unknown
  numbers: untouched.
- `dialer_call_start(p)` reads `p.reason`, `p.reason_note`. For a carrier number: no reason → error `reason_required`
  (both modes). `intro` after the intro → error. Urgent → allowed; thread system line *📞 Dispatcher called — urgent: <label>.
  <note>* + staff in-app notice `dispatcher.call.urgent`. Non-urgent after the intro → enforce: error *After the intro call,
  work through the portal: post the load, use the thread. Call only if urgent.*; warn: allowed, thread line *📞 Dispatcher
  called — <label>* + staff notice `dispatcher.call.offpolicy`, counted. `dialer_calls.reason_code / reason_note / policy`
  (`intro | urgent | callback | offpolicy`). Inbound calls and callbacks are always allowed.
- Standing rules text (below) goes in: the dispatcher's assignment brief e-mail, the workspace SOP card, the CC SOP form
  header, docs/dispatch guide.

**F. Counts.** `disp_trial_stats.effort` + `waiting_availability`, `urgent_calls`, `offpolicy_calls`; daily trial e-mail
tiles *Carriers waiting for availability* and *Urgent calls*; `cc_dispatcher_360.calls` `{urgent_7d, offpolicy_7d,
waiting_availability}` + per-assignment `intro_call_at`, `availability`.

**G. Where is the load — one line both sides can read.** `app_private.disp_load_stage(p_load)` →
`{step, stage, ball, label, carrier_next, dispatcher_next, since}` from `loads.status` + the linked `dispatcher_bookings` row.
Exposed as `stage` in `dispatcher_my_posts` and `cc_carrier_360.dispatcher_posts`.

| step | stage | ball | carrier does | dispatcher does |
|---|---|---|---|---|
| 1 | posted | carrier | open it, check lane + rate, **Accept / Decline** | nothing — do not call; post the next shortlisted load |
| — | expired / declined / withdrawn | closed | — | read the reason, fix the shortlist, post again |
| 2 | accepted · getting the RC | dispatcher ↔ broker | nothing yet | call the broker, lock the rate, get the rate confirmation, attach it |
| 3 | RC in · LoadBoot check | loadboot | nothing | wait — LoadBoot checks the RC against what was negotiated |
| 4 | approved | dispatcher | make sure the driver has the pickup details | send driver + truck to the broker, mark **Dispatched** |
| 5 | dispatched | driver | driver heads to pickup | check call before pickup |
| 6 | in transit | driver | keep the driver reachable | check calls at pickup, mid-route, before delivery; update the broker |
| 7 | delivered | carrier | upload POD / invoice | confirm delivery with the broker, close the booking |
| 8 | invoiced / paid | done | — | — |
| — | cancelled / rejected | closed | — | note the reason |

## 2. Standing rules — the text (same words everywhere)

> **LoadBoot standing rules — every carrier**
> 1. **One intro call.** Right after the assignment, call the carrier once on your LoadBoot line. Introduce yourself, walk
>    them to *Post your availability* in their portal (30 seconds a day), and say it plainly: every load you hunt is matched
>    to that post — no post, nothing to work.
> 2. **Never call for availability again.** If the post goes stale the portal reminds the carrier. You post nothing until it
>    is fresh, and you do not chase it by phone.
> 3. **Every carrier call has a reason.** The phone asks before it dials. After the intro only the urgent reasons are allowed:
>    pickup within 24 hours, an in-transit problem, a broker who needs an answer now, the carrier asked to be called.
>    Everything else goes in the thread.
> 4. **Post only shortlisted loads.** A load goes on the carrier's board only when it fits the posted availability, the floor
>    rate and the SOP — 100% shortlisted, one look to decide. The carrier accepts or declines in the portal.
> 5. **Accepted means your move.** Call the broker, lock the rate, get the rate confirmation, log it. LoadBoot approves,
>    then the driver moves.

Intro-call script (workspace card): *"I'm <name>, your LoadBoot dispatcher. I find loads only for trucks you've marked
available, so every morning open the portal and post where the truck is, when it's empty and when you need to be home —
thirty seconds. I'll put only loads that fit on your board; you accept or decline there. After today I won't call unless it's
urgent — everything else is in our thread."*

## 3. Config (CC → Dispatchers → Desk settings)

| key | default | values |
|---|---|---|
| `availability_gate_mode` | `warn` | `off` · `warn` · `enforce` |
| `availability_fresh_days` | `7` | integer days |
| `call_rule_mode` | `warn` | `warn` · `enforce` |

`public.cc_disp_desk_config()` / `cc_disp_desk_config_set(p_key, p_value)` (staff). A change writes `disp_audit`.

## 4. Migration (one file, anchor-replace on live definitions, staging first)

1. config rows · `carrier_availability_fresh` · `disp_availability_gate` · `cc_disp_desk_config*`
2. gates: `dispatcher_set_availability`, `dispatcher_post_load`, `dispatcher_post_truck`, `dispatcher_log_booking`,
   `dispatcher_request_book`, `cc_pocket_available_loads`, `cc_carrier_best_loads`, `carrier_dispatcher_desk`,
   `dispatcher_my_status`, `cc_dispatcher_360`, `cc_carrier_360`
3. notice: catalog row, `disp_avail_notices`, `disp_avail_notice(p_org)`, `disp_avail_sweep()` + cron, hook in `cc_dispatcher_assign`
4. calls: `disp_call_reasons` + seed, columns, trigger, `dialer_lookup`, `dialer_call_start`, catalog rows
   `dispatcher.call.urgent` / `dispatcher.call.offpolicy` (class S, staff_internal, in-app only), CC RPCs
5. counts: `disp_trial_stats`, `disp_trial_daily_build` tiles, `cc_dispatcher_360.calls`
6. `disp_load_stage` + `stage` in `dispatcher_my_posts`, `cc_carrier_360.dispatcher_posts`
7. standing rules box in `disp_assign_brief_html`
8. anon-secdef assertion (surface unchanged: 36 prod / 35 staging, names = baseline)

## 5. Frontend (node --check + esbuild OK on every file; not rendered in a browser)

- `app/shared/dialer.js` — **"Why this call?"** panel (`vAsk`) before an outbound call to an assigned carrier: CC's reason list with
  allowed / outside-the-rule flags from `dialer_lookup.carrier_call`, a note field, intro pre-selected while the intro is pending;
  `reason_required` from the server re-opens it; the match line says *Your intro call / Intro done · urgent reasons only / Callback*.
- `app/agent/dispatcher-workspace.js` — standing rules + intro script in *Rules of the road* (from `feed.rules`); availability chip
  on the Trucks tab and the board header (`availabilityChip`); Post / Post the truck greyed in enforce; the Trucks-tab *Set
  availability* button becomes *Carrier posts this* in enforce and warns in warn; `availability_warning` toasts after post / book /
  request / log; *➜ Your move / Waiting on the carrier…* stage line on every posted load (`stage`).
- `app/carrier/app.js` — Loads tab: gate card above the availability card (warn = banner, enforce = *You can't see loads until you
  post your availability*) → `openQuickPost('empty')`. `app/carrier/dispatcher-desk.js` — the same line in the setup card.
- CC — Dispatcher 360: *Availability* + *Intro call* cells on every assignment, **Rules & call reasons** card (counts, standing rules,
  recent urgent / off-rule calls) and its drawer (modes, fresh days, the reason list, add a reason). Carrier 360: *Dispatcher ·
  availability + intro call* card. SOP dialog (`dispatchers.js`): the standing rules shown above the editable SOP.
- `app/shared/dispatcher-rules.js` — the static copy of the rules (CC screens without a feed) + the ball labels.

## 6. State

- **Staging: applied 15 Oct 2026** in parts (`execute_sql`: A config+gate · B1a rules/reasons · `alter dialer_calls` · trigger ·
  B2 context/stats/CC · C notice/sweep/cron/stage · D1/D2 anchors + assertion) — the one big batch timed out at the MCP's 60 s
  twice and rolled back; nothing landed twice. Registered as `bl_disp_0555_availability_gate_call_rule`. All 21 anchors hit.
  Rolled-back E2E (throwaway assignment on `cc000000…0001`, test dispatcher b89cff94…): assign → standing-rules thread line +
  carrier notice (in-app row, dedupe within 24 h) · warn: dispatcher availability write saved + warning, reason `dispatcher_only` ·
  enforce: availability write refused, post_truck / request_book / log_booking refused, board 0 rows, carrier gate blocked ·
  carrier writes the Trucks line → fresh, board 10 rows, notice stops · 9 days later stale · carrier `cc_post_truck` → fresh ·
  calls: no reason → `reason_required`, intro → policy intro, answered → `intro_call_at` set + thread line, intro again →
  `intro_done`, other (warn) → offpolicy + staff notice, pickup_24h → urgent + staff notice, other (enforce) → `portal_only`,
  inbound then outbound → callback, broker number → no rule · 360 calls `{intro 1, urgent 1, offpolicy 1, waiting 1}`, trial stats,
  daily e-mail tiles, brief rules box, feed.rules, desk gate all present. Anon SECDEF surface on staging: **35, names unchanged**
  (md5 `b862e7e206b44d39503adef7970b89d2`).
- **Prod: applied 15 Oct 2026** in the same parts (a batch holding `drop trigger … on dialer_calls` timed out twice at the MCP's
  60 s on both databases — `create trigger` alone, in `begin; set local lock_timeout='5s'; … commit;`, went through in seconds; the
  file keeps the drop/create pair, so apply that line by hand next time). All 21 anchors hit. Registered as
  `bl_disp_0555_availability_gate_call_rule`. Anon SECDEF surface **36, names = baseline** (staging 35 + `retell_inbound`; md5
  `06f779f74423a983253c79ab9d4e1e84`). `lb-disp-avail-sweep` live (41 past the hour). Config: gate `warn`, 7 days, call rule `warn`.
  Four active non-demo assignments at apply time, all "waiting": PICK N NETT (never), SPRINT SHIFT (dispatcher_only), THE WAY HOME
  (no_trucks — the reminder still says "post availability"; a carrier with no truck on file gets it until a truck exists), GABE
  LOGISTICS (dispatcher_only). Each gets one in-app + e-mail per 24 h from the first sweep. Nothing is blocked until CC flips
  `availability_gate_mode` to `enforce`. (`bl_voice_0555` shipped the same day from another session — same number, different area;
  next free number is **0556**.)
- Not done: the dispatcher guide PDF (`docs/dispatch/…Guide-Book…pdf`) is not editable here — the rules live in the brief e-mail,
  the thread, the workspace and CC instead.
