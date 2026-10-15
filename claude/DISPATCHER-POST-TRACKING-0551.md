# bl_disp_0551 — dispatcher posts: seen, everything posted, staff hide / delete / alert

Owner, 15 Oct 2026: show everything the dispatcher put in a posted load, what the carrier did (seen / opened /
accepted / declined), let the dispatcher see the same, let CC hide, delete or alert, and show what is missing.
0550 was reserved for the (cancelled) training session and is skipped so the two never collide.

| Where | What |
|---|---|
| `migrations/bl_disp_0551_dispatcher_post_tracking.sql` | `app_private.dispatcher_post_views` (board / opened per carrier user), `app_private.dispatcher_post_staff` (hidden, deleted, alerts). `carrier_dispatcher_post_seen(load, board\|detail)`, `cc_dispatcher_post_action(load, hide\|unhide\|delete\|restore, reason)`, `cc_dispatcher_post_alert(load, message)`. `cc_dispatcher_posts` + `dispatcher_my_posts` replaced whole (same signatures): all fields, `seen`, staff state / alerts; the dispatcher's list drops deleted posts. |
| `app/shared/dispatcher-post-quality.js` | `postMissing` (high: origin/destination not "City, ST", no miles, no broker MC; low: contact, board ID, windows, commodity, weight, ZIPs, note), `postJourney`, `postSeenLine`. |
| `app/command-center/views/dispatcherPosts.js` | The panel: stats, filters (open / accepted / declined / expired / withdrawn / not seen / missing info), search, show hidden / deleted, per post: journey stepper, seen line, missing chips, LoadBoot alerts, "Everything the dispatcher posted", actions. |
| CC | Carrier 360 → "Loads posted by the dispatcher" · Dispatcher 360 → **Loads** tab → "Loads posted on carrier boards". |
| Dispatcher workspace | Board → "Loads you posted": 👁 seen line, ⚠ missing, 🔔 LoadBoot alerts. |
| Carrier app | Pings `board` once per session when the card renders and `detail` on every open. Staff, the poster and non-members are never counted. |

Rules: **Hide** = Command Center list only. **Delete** = withdraws an open post through `dispatcher_withdraw_load`
(carrier told only if they had opened it), drops it from the dispatcher's list, keeps the row; refused while a live
booking exists; **Restore** undoes it (does not reopen a withdrawn load). **Alert** = in-app + push to the dispatcher
who posted it, no e-mail (no catalog key). Actions need `dispatch.manage` or `carriers.approve`; `dispatch.view` reads
with the 0509 redaction. Anon SECURITY DEFINER surface unchanged (staging 35 checked; every new public function
revokes `public, anon`).

Staging 15 Oct: applied; E2E in one rolled-back transaction — post → board + 2 opens counted, the poster's own ping
not counted, dispatcher sees `opens 2 / opened_by`, non-staff alert refused, alert → in-app row, hide, delete
(withdrew the open post, `carrier_notified false`), dispatcher list count 0 after delete, restore. Staff name fix
(`disp_staff_name`) applied as `bl_disp_0551b_staff_name` on staging; it is folded into the migration file.
Prod: not yet applied — waiting on the owner's go.
