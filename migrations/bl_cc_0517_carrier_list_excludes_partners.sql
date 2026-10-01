-- bl_cc_0517 — brokers and shippers no longer show up in CC → Carriers.
-- Owner, 1 Oct 2026: TQL's Isaac (iclark@tql.com, broker owner) was listed under Carriers as "Pending".
-- Cause: every signup gets public.profiles.role = 'carrier' (the default), broker/shipper owners included, and
-- cc_list_carriers / cc_get_overview count "carriers" as profiles with that role. On prod that put 18 broker or
-- shipper owners in the carrier directory and in the Overview carrier totals.
-- Rule (one helper, both functions): a user who belongs to a broker/shipper org and to NO carrier org is not a
-- carrier. Users in both kinds (owner test accounts, brokers that also run trucks) stay listed.
-- profiles.role itself is NOT changed — routing and RLS read it; this only fixes what CC calls a carrier.
-- Functions are patched by replacing one anchor string in their live definition (raises if the anchor is gone),
-- so no other line is retyped. create or replace keeps their ACLs; the anon surface is unchanged (check after).

create or replace function app_private.is_partner_only_user(p_user uuid)
returns boolean
language sql
stable
set search_path to 'app_private, public'
as $$
  select exists (select 1 from public.organization_memberships m join public.organizations o on o.id = m.org_id
                  where m.user_id = p_user and o.kind in ('broker', 'shipper'))
     and not exists (select 1 from public.organization_memberships m join public.organizations o on o.id = m.org_id
                      where m.user_id = p_user and o.kind = 'carrier')
$$;

revoke all on function app_private.is_partner_only_user(uuid) from public, anon, authenticated;

do $$
declare
  d text;
  a text := 'and not exists (select 1 from app_private.developer_accounts da where da.user_id = pr.id)  -- bl_dev_0502';
begin
  d := pg_get_functiondef('public.cc_list_carriers(text,text,integer)'::regprocedure);
  if position(a in d) = 0 then raise exception 'bl_cc_0517: cc_list_carriers anchor not found'; end if;
  if position('bl_cc_0517' in d) > 0 then return; end if;
  d := replace(d, a, a || E'\n      and not app_private.is_partner_only_user(pr.id)  -- bl_cc_0517: brokers/shippers are not carriers');
  execute d;
end $$;

do $$
declare
  d text;
  a text := 'and not app_private.is_developer_account(profiles.id) /* bl_dev_0502 */';
begin
  d := pg_get_functiondef('public.cc_get_overview'::regproc);
  if position(a in d) = 0 then raise exception 'bl_cc_0517: cc_get_overview anchor not found'; end if;
  if position('bl_cc_0517' in d) > 0 then return; end if;
  d := replace(d, a, a || ' and not app_private.is_partner_only_user(profiles.id) /* bl_cc_0517 */');
  execute d;
end $$;
