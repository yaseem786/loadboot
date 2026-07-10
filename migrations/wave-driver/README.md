# wave-driver (wd_0001–wd_0024) — STAGING ONLY as of 2026-07-09

Applied to STAGING (snslhvmkjusozgjelghi) via Supabase MCP. NOT yet on production.
Full SQL of every migration lives in `supabase_migrations.schema_migrations.statements`
on staging — extract from there when promoting to production (rwscphuhpjoudvljvmdk).

| # | name | what |
|---|------|------|
| 0001 | driver_identity_scoping | fleet_drivers.user_id, my_fleet_driver_id(), driver-scoped can_touch_trip, cc_carrier_link_driver |
| 0002 | driver_invites | carrier_driver_invites + invite/accept RPCs; driver signups skip org provisioning |
| 0003 | fleet_drivers_updated_at | missing column (latent crash) |
| 0004 | drivers_cannot_book | BEFORE-INSERT triggers: driver-role cannot book/request |
| 0005 | my_capacity | cc_my_capacity / cc_my_free_trucks |
| 0006 | invite_email | invite emails with link |
| 0007 | partner_carrier_capacity | broker sees "All trucks booked" |
| 0008 | fix_trip_cancel | allow both canceled/cancelled; carrier cancel no auto-TONU |
| 0009 | cancel_load_status | carrier cancel → load back to 'available' |
| 0010 | carrier_cancel_policy | graduated tiers by time-to-pickup + cc_cancel_preview + cancellation rate |
| 0011 | pickup_late_enforcement | trip_pickup_assess, cron_pickup_watch (*/15) at_risk/late notify |
| 0012 | cancel_fault_and_notify | fault-aware broker cancel: carrier late/no-show → NO TONU |
| 0013 | cancel_committed_found_fix | v_committed FOUND fix (broker-cancel TONU never fired) + no double-TONU |
| 0014 | load_pickup_status | broker risk read RPC |
| 0015 | load_pickup_status_accept_partner_load_id | resolve partner_loads.id |
| 0016 | partner_cancel_accept_partner_load_id | same resolver in cancel |
| 0017 | cancel_repost_or_delete_and_reason | broker cancel = re-post OR delete; cancel_reason |
| 0018 | carrier_no_tonu_evidence_snapshot | frozen GPS fault snapshot on trips |
| 0019 | broker_cancellation_history | cc_partner_load_cancellations / cc_partner_cancellations |
| 0020 | my_loads_cancel_count | "N prior cancellation(s)" chip |
| 0021 | offer_send_clear_stale_before_insert | fix unique-key on re-offer |
| 0022 | active_trip_index_both_cancel_spellings | fix re-booking a re-covered load |
| 0023 | stale_load_not_carrier_fault | fault='stale_load' fairness |
| 0024 | expired_load_guard_and_broker_reschedule | reject past-pickup booking + cc_partner_update_pickup |
| 0025 | hide_expired_from_board | carrier board excludes pickup_date < current_date (DAT/Truckstop practice) |
| 0026 | public_teaser_no_expired | public marketing teaser same rule |
| 0027 | expired_load_broker_nag | broker in-app + daily email until expired load rescheduled/cancelled |
| 0028 | no_posting_past_pickup | DB guard: post/decide/offer reject passed pickup dates |
| 0029 | offer_withdraw | broker ✕ withdraws pending request; direct tag cleared; carrier notified |
| 0030 | reschedule_auto_shift_delivery | update-pickup auto-shifts delivery by same delta |
| 0031 | reschedule_full_scheduling | reschedule modal: FCFS/Appt + delivery + HOS guard + TEAM |
| 0032 | wizard_doc_prefill | payload.docs auto-fills checklist at submission |
| 0033 | paperwork_enforcement | 4h+ overdue docs pause new postings; 8h+ CC escalation |
| 0034 | offers_carry_pickup_pin | Requests cards: live deadhead + feasibility chips |
| 0035 | sched_time_pipeline_fix | windows -> loads.pickup_time; sched default 23:59 not midnight |
| 0036 | delivered_propagates_to_broker | trip->loads/partner_loads status + broker delivered email |
| 0037 | carrier_lifecycle_and_rc_gate | carrier step emails; RC gate on rolling; emoji fix |
| 0038 | notification_deep_links | trip/tracking notifs -> #trips; frontend tab whitelist |
| 0039 | geofence_locked_transitions | depart/in_transit/delivered require GPS dwell evidence |
| 0039b | frontend delivery-exit | tracking ends on EXITING delivery 800m (receiver detention proof), not at check-in |
| 0040 | trip_rating_invites | delivered -> mutual rating invites; carrier dashboard star card |
| 0041 | hazmat_item_sync + packet live status | hazmat lock reads real compliance |
| 0042 | valid_driver_booking_gate | expired license/medical blocks booking; VIN+CDL sanity checks |
| 0043 | request_confirm_and_emoji_fix | carrier request-sent email; emoji escapes decoded |
| 0044 | mark_all_read | mark-all RPCs both portals + panel buttons |
| 0045 | trust_profile_real_compliance | trust score reads live carrier_compliance |
| 0046 | packet_items_live_status | packet lists read live compliance; My Loads inline request approve |
| 0047 | booking_closes_all_offers | any booking auto-closes all other pending offers + notifies |
| 0048b | frontend tracking-at-booking | ensureLiveLoc from planned (booking); hero copy: Start = navigation |
| 0049 | docs_enforced_after_delivery | nag+posting-pause include delivered; Finalizing-details chip |
| 0050 | cc_ask_reschedule | CC EXPIRED chip + one-click Ask-reschedule (email+notif); Quick post hidden on expired |
| 0051 | doc_arrival_notifies_carrier | RC signed -> carrier email+notif; PU/DEL/appt -> notif (billing excluded) |
| 0052 | facility_contacts_in_dispatch_pack | wizard dock contacts -> driver dispatch pack |
| 0050-0055 | cc_visibility_batch | ask-reschedule, doc notify (carrier+CC), dock contacts, packet-copy CC alert |
