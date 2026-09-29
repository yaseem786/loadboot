-- bl_ship_0499c — found in the staging walkthrough (29 Sep 2026). Run right after 0499b.
-- cc_decide_partner_load('post') calls cc_offer_send for the carrier the SHIPPER itself picked
-- (details.direct_carrier_id) at the shipper's own rate. 0499 blocked cc_offer_send on every shipper load, which
-- would have broken that legitimate path. The poster now marks the call (transaction-local app.shipper_direct_offer),
-- and cc_offer_send lets it through only for that load and only at the load's own posted rate. A staff member
-- calling cc_offer_send directly on a shipper's load is still refused.

do $do$
declare d text;
  a1 text := $a$perform public.cc_offer_send(v_load, array[(l.details->>'direct_carrier_id')::uuid], l.rate,$a$;
  a2 text := $a$  if app_private.is_shipper_load(p_load) then  -- bl_ship_0499$a$;
begin
  d := pg_get_functiondef('public.cc_decide_partner_load(uuid,text)'::regprocedure);
  if position('bl_ship_0499c' in d) = 0 then
    if position(a1 in d) = 0 then raise exception 'bl_ship_0499c: cc_decide_partner_load anchor not found'; end if;
    execute replace(d, a1, $b$perform set_config('app.shipper_direct_offer', v_load::text, true);  -- bl_ship_0499c: the shipper's own pick
        $b$ || a1);
  end if;
  d := pg_get_functiondef('public.cc_offer_send(uuid,uuid[],numeric,integer)'::regprocedure);
  if position('bl_ship_0499c' in d) = 0 then
    if position(a2 in d) = 0 then raise exception 'bl_ship_0499c: cc_offer_send anchor not found'; end if;
    execute replace(d, a2, $b$  if app_private.is_shipper_load(p_load)  -- bl_ship_0499 / 0499c
     and not (coalesce(current_setting('app.shipper_direct_offer', true), '') = p_load::text
              and (p_rate is null or p_rate = (select rate from public.loads where id = p_load))) then$b$);
  end if;
end $do$;
