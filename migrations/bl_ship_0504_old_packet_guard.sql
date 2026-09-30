-- bl_ship_0504 — old-packet guard + Shipper Agreement card reads the shipper's own terms (30 Sep 2026).
--   1. cc_onboarding_review_item: a shipper FORM item whose `data` is null (or an empty object) cannot be verified.
--      Items submitted before bl_ship_0491 carry their answers only as text in `ref` (MII e3f7d7b9…: 9 items). Staff
--      reading free text and ticking Verify would open lanes on answers the registry check / playbook never compared.
--      Reject still works (it asks the shipper to fill the new form); waive is unchanged.
--   2. cc_partner_360: the Shipper 360 "Shipper Agreement" card read broker_shipper. Since 0491 a shipper's agreement is
--      shipper_platform (bl_ship_0500b fixed the same thing in partner_journey). Now:
--        * agreements_published also lists shipper_platform, only when published AND legal_approved (same as the portal);
--        * agreements also lists the shipper's e-signatures (agreement_signatures, shipper_platform / shipper_carrier) —
--          shippers sign there, not in org_agreement_acceptances.
-- Anchor-patched, idempotent (skips a function that already carries the bl_ship_0504 marker). No new public function;
-- the file raises if the anon SECURITY DEFINER names change.

drop table if exists pg_temp._bl0504_anon;
create temp table _bl0504_anon as
select p.proname::text n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
 where s.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');

create or replace function app_private._bl0504_patch(p_fn regprocedure, p_old text, p_new text)
returns void language plpgsql as $$
declare d text; n int;
begin
  d := pg_get_functiondef(p_fn);
  if position('bl_ship_0504' in d) > 0 then return; end if;  -- already patched
  n := (length(d) - length(replace(d, p_old, ''))) / greatest(length(p_old), 1);
  if n <> 1 then raise exception 'bl_ship_0504 patch: anchor found % times in % — refusing', n, p_fn; end if;
  execute replace(d, p_old, p_new);
end $$;

-- ───────────────────────────── 1. old-packet guard ─────────────────────────────
select app_private._bl0504_patch('public.cc_onboarding_review_item(uuid,text,text,text)'::regprocedure,
$a$  if p_action = 'verify' and (select kind from public.organizations where id = p_org) = 'shipper' then  -- bl_ship_0502$a$,
$b$  if p_action = 'verify' and (select kind from public.organizations where id = p_org) = 'shipper' then  -- bl_ship_0502
    if exists (select 1 from app_private.onboarding_packet_templates tp
                where tp.org_kind = 'shipper' and tp.item_key = p_key and tp.item_type = 'form')
       and not exists (select 1 from app_private.org_onboarding_items x
                        where x.org_id = p_org and x.item_key = p_key
                          and jsonb_typeof(x.data) = 'object' and x.data <> '{}'::jsonb) then  -- bl_ship_0504
      raise exception 'This answer has no form data (old packet, before the two-lane form) — reject it so the shipper fills the new form' using errcode = '22023'; end if;$b$);

-- ───────────────────────────── 2. Shipper Agreement card ─────────────────────────────
select app_private._bl0504_patch('public.cc_partner_360(uuid)'::regprocedure,
$a$from app_private.org_agreement_acceptances a where a.org_id = p_org), '[]'::jsonb),$a$,
$b$from (select a.kind, a.version, a.accepted_at, a.accepted_by from app_private.org_agreement_acceptances a where a.org_id = p_org
              union all  -- bl_ship_0504: shippers e-sign (agreement_signatures)
              select s.kind, s.version, s.signed_at, s.signer_user from app_private.agreement_signatures s
               where s.org_id = p_org and s.kind in ('shipper_platform','shipper_carrier')) a), '[]'::jsonb),$b$);

-- second anchor in the same function: the marker is now present, so patch it directly
do $$ declare d text; a1 text := $a$        from app_private.master_agreements m where m.published and m.kind in ('broker_carrier','broker_shipper')), '[]'::jsonb),$a$;
begin
  d := pg_get_functiondef('public.cc_partner_360(uuid)'::regprocedure);
  if position('m.kind = ''shipper_platform'' and m.legal_approved' in d) = 0 then
    if (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1 then raise exception 'bl_ship_0504: agreements_published anchor not found once'; end if;
    execute replace(d, a1, $b$        from app_private.master_agreements m where m.published
         and (m.kind in ('broker_carrier','broker_shipper') or (m.kind = 'shipper_platform' and m.legal_approved))), '[]'::jsonb),  -- bl_ship_0504$b$);
  end if;
end $$;

-- ───────────────────────────── 3. cleanup + anon check ─────────────────────────────
drop function app_private._bl0504_patch(regprocedure, text, text);

do $$ declare v_added text; v_gone text; begin
  select string_agg(n, ', ') into v_added from (
    select p.proname::text n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
    except select n from _bl0504_anon) a;
  select string_agg(n, ', ') into v_gone from (select n from _bl0504_anon except
    select p.proname::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')) g;
  if v_added is not null or v_gone is not null then
    raise exception 'bl_ship_0504: anon surface changed (added: %, removed: %) — rolling back', v_added, v_gone; end if;
end $$;
drop table pg_temp._bl0504_anon;
