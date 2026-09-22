# LoadBoot — Email & Notification Deep Audit (bl_comm_0391)

**Date:** 22 Sep 2026 · **Source of truth:** production DB `rwscphuhpjoudvljvmdk` (pg_proc, cron.job, app_private.message_deliveries, comm_templates, comm_preferences, suppressions) + repo `app/command-center`, `supabase/functions/delivery-worker`.
**Nothing here is estimated.** Where a value could not be proven from prod it says `UNKNOWN — verify`.

---

## 0. One-line answer to the question

> "CC se jitni bhi email jati hai wo ek jagah kahan dekhun?"

**Aaj kahin nahi.** Email ka data CC me **8 alag screens** par bikhra hai (`#/delivery`, `#/crm`, `#/templates`, `#/carrier-reminders`, `#/mailbox`, `#/marketing-intel`, `#/announcements`, Audiences) aur **koi catalog table nahi** hai jo bataye ke system me kaun si email mojood hai, kyun jati hai, kis ko jati hai, kitni baar jati hai. Template ka HTML **SQL functions ke andar hardcoded** hai, isliye CC kabhi poori list dikha hi nahi sakta.

Iska fix Section 6/7 me hai: **ek `email_catalog` registry + ek CC "Communications" hub + har 360 page par "Email & consent" section.**

---

## 1. Mail nikalti kaise hai (asal pipeline)

```
            ┌─ app_private.sys_email(to, template, subject, html, text, idem)   ← ~95 functions
            ├─ app_private.reminder_dispatch()        ← carrier activation reminders (pref-aware)
 ENTRY ─────├─ app_private.fire_comm_trigger()        ← comm_triggers table (1 row, OFF)
  POINTS    ├─ public.cc_campaign_enqueue()           ← CC Campaigns (source='campaign')
            ├─ public.cc_enqueue_transactional()      ← CC manual transactional send
            ├─ app_private.lb_email_notify()          ← email-loads pipeline (load_email_*)
            └─ app_private.cron_email_health()        ← self-test mail

                         ▼
        app_private.message_deliveries   (status=queued, meta.category, idempotency_key)
                         ▼
   cron `delivery-worker-minutely` + `lb-email-worker` (har minute)
                         ▼
        supabase/functions/delivery-worker  →  Resend  →  inbox
```

**Gatekeepers jo abhi lagte hain:**

| Gate | Kahan | Kya rokta hai |
|---|---|---|
| Email regex | `sys_email` line 1 | kharab address |
| Suppression list | `sys_email` | bounce/complaint = sab kuch block; `reason='unsubscribed'` = **sirf `outreach.*` block** hota hai, baqi transactional phir bhi jati hai |
| Idempotency key | `message_deliveries` unique | duplicate send |
| Marketing re-check | `cc_delivery_worker_marketing_allowed` (worker) | claim ke baad unsubscribe hua to bhi ruk jati hai |
| Comm preferences | **sirf 4 code paths** | Section 3 dekhen |

**Sender identity** (delivery-worker `categoryOf` regex, template_key par):
`load|trip|offer|dispatch|booking|tracking|pod|detention|checkin|carrier|driver|ops` → **dispatch@** · `billing|invoice|payment|settlement|payout|statement|receipt|factoring` → **billing@** · `outreach.*` ya `source='campaign'` → **marketing (SENDER_MARKETING)** · baqi sab → **support = hello@loadboot.com**.

**Unsubscribe** (worker v17, 1 Sep 2026): sirf marketing mail (`outreach.*` self-contained ya `source='campaign'`) me unsub link + RFC 8058 `List-Unsubscribe` headers jate hain. **Har operational/reminder email me koi opt-out nahi hai.**

---

## 2. Live volume — prod me kya waqai jata hai

`app_private.message_deliveries`, 4 Jul – 22 Sep 2026. Total distinct template keys: **104**.

| Band | Keys | Sends |
|---|---|---|
| Cold outreach (`outreach.carrier-d1…d7`, `outreach.broker-d1…d7`) | 14 | **26,800** (~97% of all mail) |
| Sab kuch baqi (transactional + operational + staff) | 90 | ~1,050 |

Top non-outreach: `agent.onboarding_reminder` 210 · `chat.sla` 208 (staff) · `onboarding.reminder` 196 · `welcome.agent` 113 · `document.submitted` 85 · `welcome.account` 69 · `ops.signup.new` 69 · `load_email_dispatcher_received` 60 · `dispatcher.applied` 60 · `dispatcher.status.rejected` 37 · `dispatcher.reapply_invite` 36 · `document.reviewed.valid` 36.

---

## 3. Findings (severity order)

### 🔴 F1 — Har email "transactional" label hoti hai, chahe wo reminder/digest ho
`sys_email` har row me hardcode karta hai:
```sql
jsonb_build_object(..., 'category','transactional')
```
Isliye `onboarding.reminder`, `carrier.reminder.*`, `fleet.first_truck_reminder`, `chat.lead.nudge` — sab "transactional" ban jati hain. Classification ka **koi single source of truth nahi**; delivery-worker template_key par regex laga kar sender guess karta hai. CAN-SPAM/CASL ke liye ye kamzor position hai.

### 🔴 F2 — `comm_preferences` practically dead hai
Table mojood hai (`marketing_email, product_announcements, load_offers, sms, push, weekly_summaries, unsubscribed_all, consent_source`) lekin:
- **sirf 4 code paths** use karte hain: `carrier_weekly_digest_run`, `tg_announcement_notify`, `resolve_audience_emails`, `reminder_recipients`.
- Prod me **4 rows** (1 unsubscribed_all). Yani ~0 adoption.
- Portal me koi UI nahi (`cc_pocket_save_preferences` RPC hai, `consentSummary` sirf CC Audiences screen me use hoti hai).
- Baqi **~100 templates** prefs ko bilkul nahi dekhte.

### 🔴 F3 — Per-user email history banana abhi mumkin hi nahi
`message_deliveries.recipient_user` **100% NULL** hai (`sys_email` sirf `recipient_email` bharta hai; `org_id`, `related_carrier` bhi khali). Yani "is carrier ko ab tak kitni email gayi" sirf **email string** par join kar ke nikalti hai — role, org, ya multi-contact accounts ke liye ghalat. **Ye 360-page section ka #1 blocker hai.**

### 🟠 F4 — Do parallel template duniya
`app_private.comm_templates` me **60 rows** hain, jin me **44 `tx.*` templates "published"** hain (`tx.pod_required`, `tx.settlement_ready`, `tx.security_alert`, `tx.detention_warning`…). Inme se prod me kabhi bheji gayin sirf `tx.signup_recovery` (4), `tx.onboarding_nudge` (1), `tx.dispatcher_followup` (1), `tx.shell_render_test` (1). Asli mail ka HTML SQL functions ke andar hardcoded hai. **Catalog aur reality ka koi rishta nahi.**

### 🟠 F5 — Operational mail ka koi opt-out nahi
Worker v17 ne unsubscribe ko marketing-only kar diya. Result: carrier `onboarding.reminder` (cap 3), `carrier.reminder.*`, `fleet.first_truck_reminder`, `compliance.expiring` (har 2h sweep) band nahi kara sakta — sirf "reply karo aur hum suppression list me daal dein" ka manual rasta hai. Amazon/Uber standard: **category-level preferences** (sirf account-critical bina opt-out ke).

### 🟠 F6 — Unsubscribe = all-or-nothing, aur do alag jagah
`suppressions` me **311 rows**, `outreach_contacts.status='unsubscribed'` me **50**, `comm_preferences` me **4**. Teen alag opt-out stores, koi category granularity nahi, aur koi single "consent ledger" nahi jise 360 page dikha sake.

### 🟡 F7 — `carrier.reminder.*` engine cron OFF hai magar mail ja rahi hai
`cron.job` me `lb-carrier-reminders` (`reminder_cron()`) **active=false**, phir bhi `carrier.reminder.docs_start` 9–21 Sep tak 20 baar gayi — matlab sirf CC `#/carrier-reminders` se manual send chal raha hai. Automation band, log chal raha — **verify karna chahiye ke ye jaan-boojh kar hai.**

### 🟡 F8 — Naming drift + legacy duplicates catalog kharab kar rahe hain
`document.reviewed` vs `document.reviewed.valid/.rejected` · `packet_lapsed` vs `packet.lapsed` · `authority_lapsed` vs `authority.lapsed` · `dispatcher.trial.welcome` vs `dispatcher.welcome.trial` vs `dispatcher.status.trial` · `load_email_*` (underscore) vs baqi dotted convention.

### 🟡 F9 — Test keys prod log me
`tx.shell_render_test`, `test.waitlist_fragment`, `test.fulldoc_guard`, `carrier.daily_availability.2026_09` (ek dafa ka campaign key). Inhe catalog se bahar rakhna hoga warna list kabhi saaf nahi hogi.

### 🟡 F10 — Banaye gaye magar kabhi na chalne wale senders
`rating.invite` (trip rating invite) — **0 sends**. `carrier_weekly_summary` (cron Mon 13:00 active hai) — **0 sends**. `comm_triggers` me sirf 1 row aur wo `active=false`. Ye chup-chaap dead features hain.

---

## 4. Poora email catalog (104 keys)

**Class:** `T` = transactional/account-critical · `O` = operational (kaam se juda, lekin opt-out milna chahiye) · `P` = promotional/lifecycle · `M` = marketing (consent + unsub zaroori) · `S` = internal staff alert.
**Repeat:** `1×` = event par ek baar · cron cadence + cap jahan proven hai.
**CC aaj:** jahan se ye email CC me nazar aati/chalti hai (`#` = CC hash route).

### A. Account & signup
| Key | Trigger | Fired by | Recipient | Repeat | Class | Prod | CC aaj |
|---|---|---|---|---|---|---|---|
| `welcome.account` | signup | `send_welcome_email` | new user | 1× | T | 69 | — |
| `welcome.agent` | agent signup | `send_welcome_email` | agent | 1× | T | 113 | `#/dispatchers` |
| `welcome.broker` / `welcome.shipper` / `welcome.founder_broker` | partner org create | `trg_partner_org_welcome` | broker/shipper | 1× | T | 6 / 2 / 1 | `#/partners` |
| `welcome.application_received` | onboarding submit | `cc_pocket_submit_onboarding` | carrier | 1× | T | 2 | `#/carriers` |
| `agent.confirm_email` / `onboarding.confirm_email` / `carrier.reminder.confirm_email` | daily 14:00 cron | `cc_run_onboarding_reminders` | unconfirmed user | cap UNKNOWN — verify | O | 35 / 21 / 2 | `#/carrier-reminders` |
| `account.violation` / `account.closed` / `account.request` / `account.reopened` / `account.expiry` | CC action | `cc_issue_violation`, `cc_request_account_action`, `cc_reopen_account` | account owner | 1× | T | 0 | `#/carriers` → 360 |
| `account.deletion_requested` | user request | `request_account_deletion` | user + staff | 1× | T | 2 | `#/settings` |
| `tx.signup_recovery` / `tx.onboarding_nudge` | manual/CC | `cc_enqueue_transactional` | lead | ad-hoc | P | 4 / 1 | `#/comms` |

### B. Carrier onboarding & compliance
| Key | Trigger | Fired by | Recipient | Repeat | Class | Prod | CC aaj |
|---|---|---|---|---|---|---|---|
| `onboarding.reminder` | cron daily 14:00 | `cc_run_onboarding_reminders` | carrier owner | **lifetime cap 3**, key stamped w/ last_activity | O | 196 | `#/carriers` → 360 |
| `agent.onboarding_reminder` | same cron | " | agent | cap UNKNOWN — verify | O | 210 | `#/dispatchers` |
| `onboarding.in_review` | same cron | " | carrier | 1× per review cycle | T | 3 | 360 |
| `onboarding.ready_for_decision` | same cron | " | **staff** | — | S | 0 | `#/carriers` |
| `onboarding.decided` / `onboarding.complete` / `onboarding.item_reject` | CC decision | `cc_decide_onboarding`, `cc_onboarding_review_item` | carrier | 1× per item | T | 6 / 1 / 0 | `#/documents` |
| `onboarding.item_reminder` | CC click | `cc_partner_packet_remind` | broker/carrier | manual (human throttle) | O | 7 | `#/partner-intake` |
| `onboarding.submitted(.staff)` / `ops.onboarding.submitted` | submit | `cc_pocket_submit_onboarding` | carrier + staff | 1× | T/S | 2 | `#/carriers` |
| `onboarding.guide` / `.status.update` / `.finish_line` / `.mc_pending_ack` / `.broker_next_steps` | manual (Aug) | hand-sent | carrier | ad-hoc | O | 11 / 6 / 1 / 1 / 1 | — legacy |
| `document.submitted` | doc upload trigger | `tg_document_submitted` | **staff** | 1× per doc | S | 85 | `#/documents` |
| `document.reviewed.valid` / `.rejected` | CC approve/reject | `compliance_decision_notify` | carrier | **1× per item — 4 items = 4 emails** | T | 36 / 22 | `#/documents` |
| `document.reviewed` (legacy) | — | old path | carrier | — | T | 32 | — retire |
| `compliance.expiring` | cron har 2h | `carrier_expiry_notify_run` | carrier | dedupe table + daily cap (bl_exp_0267-69); **`comm.expiry_reminders_enabled` flag** | O | 0 | `#/compliance` |
| `compliance.complete` / `compliance.reminder` / `compliance.review.summary` / `verification.result` / `broker.verification` | CC/manual | `admin_review_document` etc. | carrier/broker | 1× | T | 1 / 4 / 1 / 1 / 1 | `#/compliance` |
| `authority_lapsed` / `authority.check_failing` | cron */5min | `fmcsa_authority_collect` | carrier + staff | **edge-only** (status change par) | T | 1 | `#/compliance` |
| `packet_revalidation` / `packet_lapsed` / `packet.lapsed.staff` | cron daily 07:30 | `cron_packet_revalidation` | broker + staff | unique per (org,item,stage,cycle) | O | 4 / 2 | `#/partner-compliance` |
| `packet.copy_request` / `ops.packet.copy_request` | CC click | `cc_request_packet_copies` | carrier + staff | manual | T/S | 0 | `#/partners` |
| `broker.identity_claim` / `broker.parent_confirm` | broker identity flow | `broker_identity_send_email`, `broker_parent_confirm_send_p` | broker contact | 1× per claim | T | 0 / 15 | `#/broker-trust` |

### C. Carrier activation reminders (reminder engine — **pref-aware**)
`reminder_recipients` marketing_email + unsubscribed_all + suppressions sab check karta hai. Cron `lb-carrier-reminders` **OFF** (F7), sends manual `#/carrier-reminders` se.

| Key | Recipient | Repeat | Class | Prod |
|---|---|---|---|---|
| `carrier.reminder.docs_start` / `docs_fix` / `docs_finish` | carrier owner | cadence gate + "Send anyway" override | O (comm_templates me **marketing**) | 20 / 4 / 1 |
| `carrier.reminder.truck_add` / `truck_continue` / `driver_add` | carrier owner | " | O | 2 / 0 / 0 |
| `carrier.reminder.avail_start` / `avail_confirm` / `avail_continue` | carrier owner | " | O | 5 / 0 / 0 |
| `fleet.first_truck_reminder` | carrier owner | CC click (manual throttle) | O | 12 |
| `carrier.daily_availability.2026_09` | carrier owner | one-off campaign 6 Sep | P | 29 |
| `carrier_weekly_summary` | carrier owner | cron **Mon 13:00 active** | O (`weekly_summaries` pref) | **0 — dead, verify** |
| `announcement` | audience | `tg_announcement_notify` (`product_announcements` pref) | P | 0 | 

### D. Loads, offers, trips
| Key | Trigger | Recipient | Repeat | Class | Prod |
|---|---|---|---|---|---|
| `offer.received` | CC offer send | carrier | 1× per offer | T | 0 |
| `offer.expiring` | cron */3min | carrier | one-shot (`expiry_warned_at`) | T | 0 |
| `book.requested` / `.sent` / `bookreq.received` / `bookreq.sent` | book request | carrier ↔ broker | 1× | T | 0 |
| `book.approved` / `book.rejected` / `load.assigned` / `trip.created` | CC decision | carrier + broker | 1× | T | 0 |
| `bookreq.expired` | cron stale sweep | carrier | 1× | O | 0 |
| `load.booked` / `trip.dispatched` / `trip.started` / `load.delivered` | trip status trigger | broker | 1× per transition | T | 0 |
| `load.pickup_late` / `trip.pickup_late` | cron */15min | carrier + broker | **risk transition par hi** | T | 0 |
| `load.expired` | cron hourly :20 | broker | **cap 4**, demo skip, >30d ignore | O | 0 |
| `load.expired_abandoned` | cap hit | **staff** | 1× | S | 0 |
| `load.expired.ask` / `partner_load.ask_reschedule` | CC click | broker | manual | T | 0 |
| `load.posted` / `partner.load_posted` | CC approve | broker | 1× | T | 0 |
| `load.cancelled_by_broker` / `load.cancelled_carrier_fault` | CC cancel | dono taraf | 1× | T | 0 |
| `checklist.received` / `checklist.cc_review` | checklist submit | carrier / staff | 1× | T/S | 0 |
| `checklist.nag` | cron har 2h | broker | **cap 8**, delivered ke baad daily | O | 0 |
| `checklist.nag_exhausted` / `checklist.cc_escalation` | cap hit | **staff** | 1× | S | 0 |
| `trip.emergency` / `.emergency_request` / `.emergency_decision` / `trip.reschedule` | emergency flow | carrier + staff | 1× | T | 0 |
| `safety.incident` / `safety.reschedule(.broker)` | CC safety desk | carrier/broker | 1× | T | 0 |
| `rating.invite` | trip complete trigger | carrier/broker | 1× | P | **0 — dead, verify** |
| `load_email_dispatcher_received` / `load_email_needsinfo` / `load_email_claim` | inbound broker email | dispatcher/broker | per email | T | 60 / 5 / 4 |

### E. Money
| Key | Trigger | Recipient | Repeat | Class | Prod |
|---|---|---|---|---|---|
| `invoice.created` / `fee.invoice_due` / `finance.invoice.auto` | delivery par auto-invoice | carrier/broker + staff | 1× | T | 0 |
| `invoice.reminder` / `finance.invoice.reminder` | CC click | broker | manual | O | 0 |
| `pay.reminder` | CC click | payer | manual | O | 0 |
| `pay.confirm_nag` | cron har 12h | payee | **cap 7** | O | 0 |
| `pay.confirm_abandoned` / `pay.confirm_stuck` | cap hit | **staff** | 1× | S | 0 |
| `pay.confirmed` / `pay.incoming` | payment event | dono | 1× | T | 0 |
| `factoring.decision` / `.mode_change` / `.broker_notice` / `.noa_submitted` / `.released` / `.booking_notice` / `.carrier_note` / `.referral_requested` | factoring flow | carrier/broker/factor | 1× | T | 1 |
| `agent.payout_requested(_self)` / `agent.payout_details_requested` / `agent.payout_review` / `referral.payout_*` | payout flow | agent + finance | 1× | T | 2 |
| `agent.commission` | commission accrue trigger | agent | per accrual | T | 0 |
| `health.adjustment` / `health.reset` / `health.poa_required` | CC health actions | carrier | 1× | T | 0 |

### F. Dispatcher hiring & ops
| Key | Trigger | Recipient | Repeat | Class | Prod |
|---|---|---|---|---|---|
| `dispatcher.applied` | application | applicant | 1× | T | 60 |
| `dispatcher.skills_test` | CC invite | applicant | 1× | T | 6 |
| `dispatcher.skills_test.reminder` | cron */10min sweep | applicant | cap UNKNOWN — verify | O | 3 |
| `dispatcher.skills_test.submitted` / `dispatcher.test_score` / `dispatcher.test_passed` | test events | applicant (+staff) | 1× | T | 4 / 4 / 4 |
| `dispatcher.status.rejected` | CC reject (note = body) | applicant | 1× | T | 37 |
| `dispatcher.reapply_invite` | CC bulk invite | past applicant | 1× per invite | **P** | 36 |
| `dispatcher.waitlist` | Aug batch | applicant | 1× | P | 32 |
| `dispatcher.trial.welcome` / `dispatcher.status.trial` / `dispatcher.welcome.trial` (legacy) | move to trial | dispatcher | 1× | T | 1 / 1 / 1 |
| `dispatcher.terms` | terms send | dispatcher | 1× | T | 3 |
| `dispatcher.assigned.brief` / `dispatcher.assigned.carrier` / `dispatcher.intro_sent` | assignment | dispatcher / carrier | 1× (+ CC resend) | T | 1 / 1 |
| `dispatcher.mailbox.assigned` / `.withdrawn` | mailbox grant/revoke | dispatcher | 1× | T | 4 / 1 |
| `dispatcher.phone.line_ready` / `.line_withdrawn` / `.line_changed` | dialer line grant/revoke | dispatcher | 1× | T | 2 / 1 |
| `dispatcher.whatsapp.assigned` / `carrier_dispatcher_whatsapp_intro` | WA assign | dispatcher / carrier | 1× | T | 0 / 1 |

### G. Agents & referrals
`agent.invite` (27) · `agent.invite_sent` · `agent.submitted` (18) · `agent.review_requested` · `agent.owner_alert` (13, **staff**) · `agent.decision` (16) · `agent.doc_review` · `agent.message` (1) · `agent.staff_notice` (10) · `agent.joined` / `agent.team_joined` · `broker.agent_invite` · `shipper.company_email`. Sab event-driven 1×, class T (invites = P), CC: `#/dispatchers`, `#/referrals`.

### H. Live chat & leads
| Key | Trigger | Recipient | Repeat | Class | Prod |
|---|---|---|---|---|---|
| `chat.sla` / `livechat.sla` | cron */2min | **staff** | per breach | S | 208 |
| `chat.handoff` / `livechat.handoff` | human handoff | **staff** | 1× | S | 16 |
| `chat.reply` | cron */2min | visitor | 1× per reply | T | 2 |
| `chat.lead.nudge` | cron */10min | lead | **1 nudge only**, time-boxed, customer/suppression skip | P | 7 |
| `chat.lead.followup` | cron */10min | lead | 1×, reply/convert par stop | P | 11 |
| `call.lead.followup` | cron */10min | lead | 1× | P | 3 |
| `chat.transcript` | rating par | visitor | 1× | T | 1 |
| `livechat.csat_low` | low CSAT | **staff** | 1× | S | 0 |

### I. Marketing / outreach
| Key | Trigger | Recipient | Repeat | Class | Prod |
|---|---|---|---|---|---|
| `outreach.carrier-d1 … d7` | cron 13/15/17/19 UTC | cold carrier list | 3-day gap per contact, d1→d7, bounce/unsub auto-stop | **M** (unsub ✅) | 13,700 |
| `outreach.broker-d1 … d7` | same | cold broker list | same | **M** (unsub ✅) | 13,100 |
| campaigns (`source='campaign'`, `mk.*`) | CC Campaign send | audience | per campaign | **M** (unsub ✅) | — |
| `outreach.killswitch` / `ops.outreach_capped` | health check | **staff** | on trip | S | 0 |

### J. Internal staff alerts
`ops.signup.new` (69) · `signup.new.staff` · `form.owner_alert` (27) · `ops.email_health` (3, cron :40 hourly) · `ops.load.cancelled` · `ops.packet.copy_request` · `notification.broadcast` (CC broadcast) · `mail.reply` / `dispatch.mail.reply` / `billing.mail.reply` (CC Mailbox replies). Class S/T.

### K. Test/junk — catalog se bahar rakhein
`tx.shell_render_test` · `test.waitlist_fragment` · `test.fulldoc_guard` · `tx.dispatcher_followup`.

---

## 5. Kya missing hai (jo Amazon/Uber standard par hona chahiye)

**Security & account (abhi zero):**
1. `security.login_new_device` — nayi device/IP se login.
2. `security.password_changed` / `security.email_changed` — change ke baad dono addresses par.
3. `security.bank_changed` — payout account badla (fraud ka sabse bara vector; abhi koi alert nahi).
4. `account.data_export_ready` + `account.deletion_confirmed` — abhi sirf `account.deletion_requested` hai.

**Receipts (abhi zero):**
5. `pay.receipt` — paisa bhejne ka receipt (PDF link).
6. `statement.monthly` — carrier/dispatcher monthly statement.
7. `pod.accepted` — POD approve hone ka receipt broker ko (`tx.pod_approved` template banaya hua hai, wired nahi).

**Lifecycle (template mojood, wired nahi — F4):**
8. `tx.detention_warning`, `tx.trip_checkin_reminder`, `tx.tracking_stale_warning`, `tx.settlement_ready`, `tx.invoice_dispute_update` — 44 published `tx.*` me se ye sab abhi dead hain.
9. Broker-side weekly digest (carrier ka hai, broker ka nahi).
10. `rating.invite` ko zinda karein (0 sends).

**Consent (abhi zero):**
11. `consent.preferences_updated` — jab user preferences badle, confirmation mail (double-opt-out receipt) — ye legal defence hai.
12. `consent.reengagement` — 6 mahine se inactive marketing contacts ko "kya aap abhi bhi sunna chahte hain".

---

## 6. Recommendation — 3 builds (Amazon/Uber pattern)

### Build A — `app_private.email_catalog` registry (**pehle ye, baqi sab isi par khara hai**)
Ek row per template key:

```
key (PK) · name · purpose · class (T|O|P|M|S) · audience_role (carrier|broker|shipper|
dispatcher|agent|driver|lead|staff) · trigger_type (event|cron|manual|inbound) ·
trigger_source (function/cron job ka naam) · cadence · cap · stop_condition ·
preference_group · unsub_allowed (bool) · sender_identity · cc_deep_link ·
owner · status (live|legacy|dead|test) · first_seen · last_seen
```

Phir:
- `sys_email` me ek soft lookup: agar key catalog me nahi to `ops.unknown_template` staff notice (mail phir bhi jaye — kuch tootay na).
- `meta.category` catalog se aaye, hardcoded `'transactional'` khatam (**F1 fix**).
- `message_deliveries` me `recipient_user` + `org_id` bharna shuru karein: `sys_email` me ek `p_user uuid` optional param + email→profile lookup fallback (**F3 fix — ye 360 page ke liye lazmi hai**).
- Backfill: upar wali 104 keys ka table seed data hai.

**Preference groups (proposal):**
| Group | Opt-out? | Kya andar |
|---|---|---|
| `account_critical` | ❌ nahi | security, account status, legal, authority lapse |
| `load_ops` | ⚠️ sirf "summary only" | offers, book, trip, pickup, POD |
| `compliance` | ⚠️ frequency choice (har baar / weekly digest) | doc review, expiry, packet |
| `billing` | ❌ nahi (receipts) / ⚠️ reminders | invoice, payout, statement |
| `digests` | ✅ | weekly summary, monthly statement |
| `product_announcements` | ✅ | naye features |
| `marketing` | ✅ | outreach, campaigns, winback |

### Build B — CC "Communications" hub (`#/comms`), 5 tabs
1. **Catalog** — catalog table ki searchable list: key, kis ko, kab, kitni baar, class badge (T/O/P/M/S), live 30-day count, ON/OFF toggle, "isko trigger karne wala code" link. Deep link: `#/comms/catalog/<key>`.
2. **Live log** — `cc_list_deliveries` par per-email row: kis ko, kab, status, open, click, bounce, failure reason; filters template/class/role/date; row click → `#/comms/log/<delivery_id>`.
3. **Consent & preferences** — ek jagah teenon stores: `comm_preferences`, `suppressions` (311), `outreach_contacts` unsubscribed (50). Kis ne kab kya opt-out kiya, source kya tha.
4. **Deliverability** — jo aaj `#/delivery` par hai (bounce rate, domain health, `ops.email_health`).
5. **Campaigns & outreach** — jo aaj `#/crm` par hai.

Purani screens gayab na karein — sirf `#/comms` ke tabs ban jayein (wahi tareeqa jo CC audit 2 Sep me NAV 73→21 ke liye use hua tha).

### Build C — 360 pages par "Email & consent" section
`carrier360.js`, `broker360.js`, `dispatcher-360.js` me ek naya card, RPC `cc_360_comms(p_org, p_user)`:
- **Preferences** — har preference group ka toggle, current value + kis ne/kab set kiya (`consent_source`).
- **Consent ledger** — subscribe/unsubscribe/suppression history, timestamp + source (user clicked / staff / bounce / complaint).
- **Sent mail** — akhri 50 email: template ka friendly naam, class badge, kab, delivered/opened/clicked/bounced, `#/comms/catalog/<key>` par deep link.
- **Counters** — 30 din me kitni email (class wise), "ye account cap ke kitna qareeb hai".
- **Send** — `#/carrier-reminders` wala "Send reminder" yahin, cadence aur prefs ka ehtram karte huye (blocked reason already carrier360 me mojood: no email / suppressed / opted out).

**Order:** A → C → B. (A ke bagair C jhoot bolega, kyunki `recipient_user` NULL hai.)

---

## 7. Ye audit dobara chalane ka tareeqa

```sql
-- 1) code me har email sender + uska template key
with f as (select n.nspname||'.'||p.proname fn, p.prosrc src from pg_proc p
           join pg_namespace n on n.oid=p.pronamespace where p.prosrc ~ 'sys_email')
select fn, string_agg(distinct k,' | ') from (
  select fn,(regexp_matches(src,'sys_email\s*\(\s*[^,()]{0,200},\s*''([a-z0-9_.\-]+)''','g'))[1] k from f
) x group by 1 order by 1;

-- 2) asal me kya gaya
select template_key, count(*) n, min(created_at)::date, max(created_at)::date
from app_private.message_deliveries group by 1 order by n desc;

-- 3) recurring senders
select jobname, schedule, active from cron.job order by jobname;

-- 4) prefs/suppression reality check
select (select count(*) from app_private.comm_preferences) prefs,
       (select count(*) from app_private.suppressions) suppressed,
       (select count(*) from app_private.outreach_contacts where status='unsubscribed') outreach_unsub;
```

---

## 8. Open questions (Yaseen ke liye)

1. `lb-carrier-reminders` cron jaan-boojh kar OFF hai ya ye bug hai? (F7)
2. `carrier_weekly_summary` cron active hai magar 0 sends — digest chahiye ya feature band karein? (F10)
3. `rating.invite` zinda karna hai?
4. 44 published `tx.*` templates — inhe live wire karein ya `status='retired'` kar ke catalog saaf karein? (F4)
5. Preference groups ka proposal (Section 6) manzoor hai ya toggles kam/zyada chahiye?
