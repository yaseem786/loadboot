-- bl_ship_0509c — a shipper item that has its own proof step cannot be ticked "verified" by hand (1 Oct 2026).
--   cc_onboarding_review_item(org, key, 'verify') wrote status = verified for ANY shipper item. For phone_verify and
--   independent_callback, shipper_item_status reads that row as-is, so a staff click (the old generic Packet list on
--   Shipper 360, or a direct RPC call) marked the signer phone / the independent call-back done with no code call.
--   Now 'verify' is refused for every shipper item whose template type is system / staff / accept, except
--   registry_check (it keeps its own card-only gate). Those are proven by their own step:
--     email_verify / phone_verify / independent_callback → cc_shipper_code_verify (writes the row itself)
--     facility_rules / platform_terms / shipper_carrier_terms → derived live from locations / signatures
--   'waive' (written reason required, audited) and 'reject' are unchanged — waiving stays the deliberate staff override.
-- Anchor-patched, idempotent (bl_ship_0509c marker), no grant change. Raises if the anon SECURITY DEFINER names move.

drop table if exists pg_temp._bl0509c_anon;
create temp table _bl0509c_anon as
select p.proname::text n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
 where s.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');

do $mig$
declare d text; a text; n int;
begin
  d := pg_get_functiondef('public.cc_onboarding_review_item(uuid,text,text,text)'::regprocedure);
  if position('bl_ship_0509c' in d) = 0 then
    a := $a$    elsif p_key in ('ein_letter','address_proof') then$a$;
    n := (length(d) - length(replace(d, a, ''))) / length(a);
    if n <> 1 then raise exception 'bl_ship_0509c: anchor found % times — refusing', n; end if;
    d := replace(d, a, $b$    elsif exists (select 1 from app_private.onboarding_packet_templates tp  -- bl_ship_0509c: proven by its own step
                   where tp.org_kind = 'shipper' and tp.item_key = p_key and tp.item_type in ('system','staff','accept')) then
      raise exception '"%" is confirmed by its own step (code call, independent call-back, signature or location) and cannot be marked verified by hand. Waive it with a written reason if it really must be skipped.',
        (select tp.label from app_private.onboarding_packet_templates tp where tp.org_kind = 'shipper' and tp.item_key = p_key) using errcode = '22023';
$b$ || a);
    execute d;
  end if;
end $mig$;

do $$
declare v_added text; v_gone text;
begin
  select string_agg(n, ', ') into v_added from (
    select p.proname::text n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
    except select n from pg_temp._bl0509c_anon) a;
  select string_agg(n, ', ') into v_gone from (
    select n from pg_temp._bl0509c_anon
    except select p.proname::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')) g;
  if v_added is not null or v_gone is not null then
    raise exception 'bl_ship_0509c: anon surface changed (added: %, removed: %) — rolling back', v_added, v_gone; end if;
end $$;
