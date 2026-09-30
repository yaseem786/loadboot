-- bl_ship_0509b — what a held shipper reads about its hold (30 Sep 2026). Follows bl_ship_0509; found by its test.
--   1. shipper_lane_gate hands the hold note to shipper_can_post ("Posting is on hold: <note>. Contact …"),
--      assert_shipper_lane (the error a held shipper gets when it posts / tenders) and partner_journey. Each consumer adds
--      its own full stop, so a note that ends in one read "…we look up ourselves.. Contact hello@loadboot.com." The gate
--      now strips the note's trailing stop once, at the source.
--   2. A failed independent call-back files hold_reason = 'independent call-back: <what the company told staff>'. That
--      is internal (CC asks "What did the company say?"), but the gate and partner_shipper_status returned it verbatim
--      to the shipper. Both now return the neutral line the gate already had for this case: "the independent call-back
--      could not confirm the company". Staff screens read shipper_trust directly and still see the full note.
-- Anchor-patched, idempotent (bl_ship_0509b marker), no grant changes (create or replace keeps the ACL). Raises if the
-- anon SECURITY DEFINER names in public change.

drop table if exists pg_temp._bl0509b_anon;
create temp table _bl0509b_anon as
select p.proname::text n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
 where s.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');

create or replace function pg_temp._bl0509b_sub(d text, p_old text, p_new text)
returns text language plpgsql as $$
declare n int;
begin
  n := (length(d) - length(replace(d, p_old, ''))) / greatest(length(p_old), 1);
  if n <> 1 then raise exception 'bl_ship_0509b: anchor found % times — refusing: %', n, left(p_old, 80); end if;
  return replace(d, p_old, p_new);
end $$;

do $mig$
declare d text;
begin
  d := pg_get_functiondef('app_private.shipper_lane_gate(uuid,text)'::regprocedure);
  if position('bl_ship_0509b' in d) = 0 then
    d := pg_temp._bl0509b_sub(d,
      $a$  v_hold := t.hold_reason;$a$,
      $a$  v_hold := rtrim(t.hold_reason, '. ');  -- bl_ship_0509b: consumers add their own stop
  if v_hold ilike 'independent call-back:%' then v_hold := null; end if;  -- internal note: the neutral line below instead$a$);
    d := pg_temp._bl0509b_sub(d,
      $a$  if v_hold is null and t.callback_status = 'failed' then$a$,
      $a$  if v_hold is null and (t.callback_status = 'failed' or t.hold_reason is not null) then$a$);
    execute d;
  end if;

  d := pg_get_functiondef('public.partner_shipper_status()'::regprocedure);
  if position('bl_ship_0509b' in d) = 0 then
    d := pg_temp._bl0509b_sub(d,
      $a$'hold_reason', t.hold_reason,$a$,
      $a$'hold_reason', case when t.hold_reason ilike 'independent call-back:%' then 'the independent call-back could not confirm the company' else t.hold_reason end,  -- bl_ship_0509b
$a$);
    execute d;
  end if;
end $mig$;

do $$
declare v_added text; v_gone text;
begin
  select string_agg(n, ', ') into v_added from (
    select p.proname::text n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
    except select n from pg_temp._bl0509b_anon) a;
  select string_agg(n, ', ') into v_gone from (
    select n from pg_temp._bl0509b_anon
    except select p.proname::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')) g;
  if v_added is not null or v_gone is not null then
    raise exception 'bl_ship_0509b: anon surface changed (added: %, removed: %) — rolling back', v_added, v_gone; end if;
end $$;
