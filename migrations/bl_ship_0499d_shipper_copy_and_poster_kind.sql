-- bl_ship_0499d — copy fixes found in the 29 Sep staging walkthrough. Run right after 0499c.
-- 1. cc_partner_register: the shipper welcome said "…then you can request quotes right away", but since 0491 nothing
--    reaches carriers or brokers until a lane opens.
-- 2. cc_pocket_available_loads: details carry poster_kind ('shipper' / 'broker') so the carrier board can say
--    "Shipper's load" instead of "Broker packet" on a shipper's own load. No new data leaves: the carrier already
--    sees the poster's name; the kind only fixes the label.

do $do$
declare d text;
  a1 text := $a$Your shipper account is created. We are confirming your business from your company email — usually under a minute — then you can request quotes right away. Payment terms and the short packet come before your first booking.$a$;
  b1 text := $a$Your shipper account is created. Next: finish Verification — company identity, billing, the agreements and your locations. Nothing reaches carriers or brokers until a lane opens; then you post at your own rate and choose the carrier, or tender to a verified broker.$a$;
  a2 text := $a$|| case when l.broker_org is not null then jsonb_build_object('broker_pay', app_private.broker_pay_stats(l.broker_org)) else '{}'::jsonb end$a$;
  b2 text := $a$|| case when l.broker_org is not null then jsonb_build_object('broker_pay', app_private.broker_pay_stats(l.broker_org),
             'poster_kind', (select o9.kind from public.organizations o9 where o9.id = l.broker_org)) else '{}'::jsonb end  -- bl_ship_0499d$a$;
begin
  d := pg_get_functiondef('public.cc_partner_register(text,text,text)'::regprocedure);
  if position(a1 in d) > 0 then execute replace(d, a1, b1);
  elsif position(b1 in d) = 0 then raise exception 'bl_ship_0499d: cc_partner_register anchor not found'; end if;
  d := pg_get_functiondef('public.cc_pocket_available_loads(integer,integer)'::regprocedure);
  if position('bl_ship_0499d' in d) = 0 then
    if position(a2 in d) = 0 then raise exception 'bl_ship_0499d: cc_pocket_available_loads anchor not found'; end if;
    execute replace(d, a2, b2);
  end if;
end $do$;
