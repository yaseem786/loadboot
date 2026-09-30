-- bl_voice_0513 — owner rule (30 Sep 2026): a released carrier's needs_human callback goes to CC → Riley callbacks,
-- not to the dispatcher's dock. Reason: a dispatcher can leave; a callback parked in a gone dispatcher's dock is a
-- promise nobody keeps. Riley answered the call (0512), so the follow-up stays on Riley's screen.
--
-- Both follow the same switch as 0512/0512b (app_private.dialer_config.riley_route_to_dispatcher):
--  * riley_needs_human_callback: ON → released dispatcher's dock (old 0506 behaviour); OFF → dispatcher NULL
--    = CC → Riley → "Open callbacks from the line" + staff in-app alert.
--  * retell_inbound_verified (0512b line): OFF → Riley tells the carrier "our team will call you back", not "the dispatcher".
-- Anchor patches, not retyped; CREATE OR REPLACE keeps the ACLs. No public function added; anon SECDEF unchanged.

do $$
declare
  d text;
  a text := $a$select d.dispatcher_user_id into v_disp from app_private.riley_caller_dispatcher(v_phone) d where d.released limit 1;$a$;
  b text := $b$-- bl_voice_0513: released dispatcher gets it only while calls route to them; OFF → CC Riley callbacks
  if coalesce((select dc.riley_route_to_dispatcher from app_private.dialer_config dc where dc.id = 1), false) then
    select d.dispatcher_user_id into v_disp from app_private.riley_caller_dispatcher(v_phone) d where d.released limit 1;
  end if;$b$;
begin
  select pg_get_functiondef('app_private.riley_needs_human_callback(text)'::regprocedure) into d;
  if position('bl_voice_0513' in d) > 0 then return; end if;   -- already applied
  if position(a in d) = 0 then raise exception 'bl_voice_0513: anchor not found in riley_needs_human_callback'; end if;
  execute replace(d, a, b);
end $$;

do $$
declare
  d text;
  a text := $a$tell them the dispatcher will call them back.$a$;
  b text := $b$tell them our team will call them back.$b$;
begin
  select pg_get_functiondef('public.retell_inbound_verified(jsonb)'::regprocedure) into d;
  if position(b in d) > 0 then return; end if;   -- already applied
  if position(a in d) = 0 then raise exception 'bl_voice_0513: anchor not found in retell_inbound_verified'; end if;
  execute replace(d, a, b);
end $$;

comment on function app_private.riley_needs_human_callback(text) is 'bl_voice_0506/0513: Riley call with needs_human=true → one open dialer_callbacks row (reason riley). Released dispatcher only while dialer_config.riley_route_to_dispatcher is ON; otherwise the Riley screen (CC).';
