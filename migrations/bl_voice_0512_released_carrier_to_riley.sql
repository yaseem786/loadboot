-- bl_voice_0512 — owner rule (30 Sep 2026): a carrier whose dedicated dispatcher has been RELEASED still reaches
-- Riley directly when they call the contact line (+1 815 365-1168) — the call no longer rings the dispatcher first.
--
-- No new logic: dialer_hook_event already reads app_private.dialer_config.riley_route_to_dispatcher on EVERY call
-- (bl_voice_0458b), for every carrier. This flips the stored value to false and makes false the column default, so the
-- rule holds for every carrier released from now on. The CC switch (Riley → WhatsApp line → "Known carrier → their
-- dispatcher first") stays the single place to change it.
--
-- Unchanged: Riley's briefing still names the caller's dispatcher; a needs_human callback for a released carrier still
-- goes to that dispatcher's dock (bl_voice_0506). Data + default only; no function or ACL change.

alter table app_private.dialer_config alter column riley_route_to_dispatcher set default false;
update app_private.dialer_config set riley_route_to_dispatcher = false, updated_at = now() where id = 1;
