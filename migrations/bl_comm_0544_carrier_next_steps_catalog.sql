-- bl_comm_0544 — catalog row for onboarding.carrier_next_steps (owner, 12 Oct 2026)
-- Hand-sent premium email (shell + app_private.email_kit, CLAUDE.md §10) to a carrier that is fully verified and active:
-- what compliance verified + the one next step (add a truck / post availability). First use: the 4 carriers activated
-- by bl_onb_0541 (T Strick, MEDO, The Way Home, Blessed Road Runner). Carrier twin of onboarding.broker_next_steps.
-- Applied on prod + staging 12 Oct 2026.

insert into app_private.email_catalog as c
  (key, name, purpose, class, audience_role, trigger_type, trigger_source, cadence, cap_note, stop_condition,
   preference_group, unsub_allowed, status, cc_deep_link, owner_note)
values
  ('onboarding.carrier_next_steps', 'Carrier next steps',
   'Hand-sent to a carrier once fully verified and active: what our compliance team verified and the one next step '
   || '(add a truck / post truck availability). Body built with app_private.email_kit from the account''s live state.',
   'O', 'carrier', 'manual', 'hand-sent by staff (owner request) via app_private.sys_email', 'ad-hoc',
   'once per org (idempotency carrier-next-steps:<org>)', 'the step it names is done',
   'compliance', true, 'live', '#/carriers',
   'Created 12 Oct 2026 (bl_comm_0544) for the 4 carriers activated by bl_onb_0541.')
on conflict (key) do update set
  name = excluded.name, purpose = excluded.purpose, class = excluded.class, audience_role = excluded.audience_role,
  trigger_type = excluded.trigger_type, trigger_source = excluded.trigger_source, cadence = excluded.cadence,
  cap_note = excluded.cap_note, stop_condition = excluded.stop_condition, preference_group = excluded.preference_group,
  unsub_allowed = excluded.unsub_allowed, status = excluded.status, cc_deep_link = excluded.cc_deep_link,
  owner_note = excluded.owner_note, updated_at = now();
