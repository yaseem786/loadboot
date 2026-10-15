# Partner onboarding gaps closed — bl_bp_0456 + bl_bp_0457 (26 Sep 2026)

Follow-up to `claude/PARTNER-360-0455.md` ("Next milestone"). Both migrations applied **staging + prod**; anon SECDEF
surface by name unchanged (36 prod / 35 staging, no new `public` function). Portal + CC JS ships with the next site push.

## What changed

| Gap | Where | What |
|---|---|---|
| G1 | `app/partner/app.js` brokerDash | Shippers (who land in brokerDash via `appView`) now get the shipper trust card (`mountShipperTrust` — company-e-mail code form, re-check, ladder) in the post-load slot, and the request form unfolds on `can_post` (business check) instead of `onboarded` (packet). Shipper-specific hero copy: "Confirm your company e-mail to request quotes" / "Quotes are open — the short packet comes before your first booking". |
| G4 | `app/partner/shipper-trust.js` | `agreementRow()` — one-click `cc_accept_agreement('broker_shipper')` inside the can-post card. Renders **nothing until legal publishes `broker_shipper`** (`cc_current_agreement` → `available:false`; still unpublished on prod and staging, finding 1 in the 0455 doc). Once published, `trg_agreement_fills_packet` verifies the packet item. |
| G6 | `trg_partner_org_welcome`, `cc_partner_register`, catalog `welcome.broker_agent` | Agent detection = `auth.users.raw_user_meta_data.agent_intent` (set by the signup form). Agent-flavoured e-mail (name the brokerage → it confirms you by code → post under its authority), in-app welcome, staff notice "🤝 New BROKER AGENT signup" / "New broker agent registered — X · brokerage MC follows in a moment" (was "NO MC GIVEN"). |
| G7 | `app_private.broker_authority_partner_notice(org, 'fail'|'stale', reason)` + catalog `broker.authority_paused` | Called from `broker_screen_apply` (fail #2) and `broker_rescreen_sweep` (14-day stale block). Partner in-app + e-mail to the owner (what is untouched / what changes / what to do, `{{contact_inline}}`); confirmed agents of the brokerage get the in-app notice. Idempotency `authpause:<org>:<kind>:<yyyymmdd>`. |
| G8 | `partner_verify_code` | Staff notice `broker.verified_by_phone` back: identity branch (→ `#/broker?id=`) and agent↔parent phone-code branch (→ `#/broker-agent?id=`). |
| G9 | `broker_screen_collect`, `shipper_business_start`, `shipper_check_collect`, `broker_identity_send_email` | Partner notice on broker unknown / not_found / error (non-agents; agents keep the 0449 nudge), shipper free-mail signup (once), shipper check error (+ staff notice). "FMCSA lists no e-mail — we will call" now files the staff call task `broker.identity.no_email` once per org. |
| G13 | `cc_partner_register`, `shipper_check_collect` | Staff notice URLs open the right 360: `#/broker`, `#/broker-agent`, `#/shipper` `?id=`. |
| G2 | `trust_label_load`, `enforce_trust_gate_not_bookable` | Verified live: **0** shipper-posted loads on prod. Both triggers now branch on the shipper tier: verified → clean; business_verified → `partial` + request-to-book label ("Posted directly by a shipper new to LoadBoot — company domain X confirmed…"); new / hold → not bookable. Broker path byte-identical to 0343. |

Tested on staging inside a rolled-back transaction (throwaway user + org, nothing persisted): shipper load → `partial`
+ label; instant book → request-to-book refusal; hold → "not cleared"; agent org → "🤝 New BROKER AGENT signup" +
`welcome.broker_agent` e-mail queued; pause notice → in-app + `broker.authority_paused` e-mail queued.

## Deep links (portal) — `app/partner/app.js`

`#tab/target?k=v`, carrier-style. `parseDeep()` at boot and on `hashchange`; `applyDeep()` runs once after the tab
renders, then drops the target.
- `#onboarding/<item_key>` → scrolls to and flashes the packet row (`data-ob-key` on both `packetDocRow` variants).
- `#loads/<id>` → opens the live tracker for that load (`partner_loads.id` or `load_id`); toast if it is gone.
- `#dashboard?post=1` (or `#dashboard/post`, legacy `#post`) → opens the post form.
- any other tab: `#account/security` → flashes `#security` if such an element id exists.
- `bgo()` no longer strips a `/target` or `?query` from the hash; notice clicks (`n.url`) keep everything after `#`.
Not done: CC "open in portal" buttons — staff cannot be signed in as the partner, so a CC button can only copy a
link. Add a "copy portal link" action to the 360 kit when needed; the links above are what to copy.

## Real-time — `bl_bp_0457` + `app/shared/partners-live.js`

`app_private.partners_live(org, type, extra)` → `realtime.send(payload, 'partner', 'partners:live', false)` (public
topic; `realtime.messages` has RLS but public channels need no policy). Fired from `notify_partner` (43 callers) and
`trg_zz_partners_live` on `broker_trust`, `broker_screenings`, `shipper_trust`, `broker_identity`, `agent_parents`
(+ the parent org), `org_onboarding_items`, `org_agreement_acceptances`, `public.organizations` (broker/shipper;
status / name / MC changes only). Every emit is exception-wrapped.
- `partner360-kit.js`: subscribes; an event for this org → `load(true)` after 500 ms; refresh bar reads
  "live · realtime" vs "live · polling 30 s". The 30 s poll stays as the fallback.
- `partners.js` (directory): any event → silent table repaint after 1.5 s.
- Portal side does not listen yet (its notices badge still polls) — cheap follow-up with the same module.

## Still with the owner
1. Publish `broker_shipper` (CC → Legal / agreements). Until then G4 renders nothing and shippers upload a PDF.
2. LinkLane — approve in Broker Agent 360. 3. khannawab m afzal — MC not on FMCSA, needs a human (0455 doc).
