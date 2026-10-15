# bl_disp_0552 — dispatcher posts: broker contact + board load ID locked until the carrier accepts

Owner, 15 Oct 2026 (dispatch agreement Art. 10.2): on a load the dispatcher posted, the carrier must not see the
broker's rep / phone / e-mail or the board load ID / link before accepting — otherwise the load can be booked around
the dispatcher. **Broker name + MC and the FMCSA broker screen stay visible** so the carrier can still judge the broker.

| Where | What |
|---|---|
| `migrations/bl_disp_0552_dispatcher_post_contact_lock.sql` | `app_private.disp_post_redact(jsonb)` strips `broker_phone, broker_email, broker_rep, board_ref, source_link` (+ `broker_screen.phone/email` defensively). `cc_load_detail`: `v_hide` = dispatcher post AND status in available/declined/expired/withdrawn AND not staff → `source_reference` null, `terms.details` redacted, new key `contact_locked`. `cc_pocket_available_loads`: details redacted for dispatcher posts (non-staff). `disp_post_notify_carrier`: the "Found on" fact no longer appends `· ref <board ID>` (in-app + e-mail). All three patched by exact-once anchor replace — nothing else in the bodies moved. |
| `app/carrier/app.js` | Load overview: "🔒 Broker contact and the board load ID open after you accept…" while `contact_locked`. |
| `app/shared/dispatcher-post-quality.js` | Missing chips "Broker phone / e-mail" and "Board load ID": now "For the LoadBoot record … the carrier sees it only after accepting." |
| `app/agent/dispatcher-workspace.js` | Post-a-load form: one hint line under Source and under Broker saying what the carrier sees and when. |

From `carrier_accepted` on (booked, in transit, …) the carrier sees everything, as before. CC (staff) and the
dispatcher's own views (`cc_dispatcher_posts`, `dispatcher_my_posts`) are unchanged. Not touched: the free-text
dispatcher note (`notes`) — if a dispatcher types a phone number there, the carrier sees it.

Staging 15 Oct: applied; E2E in one rolled-back transaction on a throwaway status flip of a staging dispatcher post
(carrier member, not staff): pre-accept detail `source_reference null, contact_locked true`, details keys
board/broker/broker_mc/broker_screen only, `broker_screen.phone` gone, broker name kept; board list same; after
`carrier_accepted` everything back (`ref`, rep, phone, e-mail, board_ref, link).
Prod: applied 15 Oct 2026 (`rwscphuhpjoudvljvmdk`, migration `bl_disp_0552_dispatcher_post_contact_lock`). Pre-apply
md5 of the 3 patched functions = staging; post-apply md5 of all 4 = staging (cc_load_detail 429434a3…,
cc_pocket_available_loads 529c6ead…, disp_post_notify_carrier 6299ce8c…, disp_post_redact 0b375ff6…), ACLs unchanged,
helper revoked from public/anon/authenticated, anon SECURITY DEFINER surface 36, names = baseline.
