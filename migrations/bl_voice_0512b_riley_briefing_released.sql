-- bl_voice_0512b — Riley's briefing follows the 0512 rule.
-- retell_inbound_verified told Riley, for a released carrier: "They reached you because that dispatcher did not pick
-- up right now." With riley_route_to_dispatcher = false the dispatcher is never rung, so that line was false. It now
-- reads the same switch: ON → the old sentence; OFF → Riley handles the call herself and, if the carrier needs the
-- dispatcher personally, says the dispatcher will call back (needs_human → callback in the dispatcher's dock, 0506).
-- Anchor patch, not retyped; CREATE OR REPLACE keeps the ACL (postgres + service_role only).

do $$
declare
  d text;
  a text := $a$'. They reached you because that dispatcher did not pick up right now.'$a$;
  b text := $b$(case when coalesce((select dc.riley_route_to_dispatcher from app_private.dialer_config dc where dc.id = 1), false)
                  then '. They reached you because that dispatcher did not pick up right now.'
                  else '. Their calls come straight to you, not to the dispatcher (owner rule). Help them yourself; if they need the dispatcher personally, tell them the dispatcher will call them back.' end)$b$;
begin
  select pg_get_functiondef('public.retell_inbound_verified(jsonb)'::regprocedure) into d;
  if position('Their calls come straight to you' in d) > 0 then return; end if;   -- already applied
  if position(a in d) = 0 then raise exception 'bl_voice_0512b: anchor not found in retell_inbound_verified'; end if;
  execute replace(d, a, b);
end $$;
