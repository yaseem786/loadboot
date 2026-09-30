-- bl_ship_0508 — executed copy of a shipper agreement (30 Sep 2026).
--   The owner wants every signed shipper agreement (Platform Terms, Shipper–Carrier Terms) to be a real executed document:
--   LoadBoot LLC pre-signed and dated the day the shipper signed, the shipper's e-signature block, and the ESIGN record
--   (consent text, SHA-256 of the exact text signed, IP, UTC time). The shipper opens/downloads it from the portal; staff
--   preview/download it from Shipper 360 → Two-lane verification → Signatures.
--   public.cc_shipper_agreement_copy(p_kind, p_version default null, p_org default null)
--     * a shipper reads only its own org (my_shipper_org); passing another org is refused (42501);
--     * staff with partners.manage / dispatch.manage / carriers.manage may pass p_org;
--     * returns the text of the version that was SIGNED (not the latest), and text_matches = the stored SHA-256 still
--       equals that text, so a later edit of an old version would show up.
--   Read-only (no writes). NOT executable by anon: revoked from public + anon explicitly (CLAUDE.md §4).
--   The file raises if the anon SECURITY DEFINER names change.

drop table if exists pg_temp._bl0508_anon;
create temp table _bl0508_anon as
select p.proname::text n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
 where s.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');

create or replace function public.cc_shipper_agreement_copy(p_kind text, p_version integer default null, p_org uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'app_private', 'public'
as $function$
declare v_org uuid; v_staff boolean; s app_private.agreement_signatures; a app_private.master_agreements; v_name text; v_legal text;
begin
  if p_kind not in ('shipper_platform','shipper_carrier') then raise exception 'unknown agreement' using errcode = '22023'; end if;
  v_staff := public.has_global_permission('partners.manage') or public.has_global_permission('dispatch.manage')
          or public.has_global_permission('carriers.manage');
  if p_org is not null and v_staff then
    v_org := p_org;
  else
    v_org := app_private.my_shipper_org();
    if v_org is null then raise exception 'not a shipper account' using errcode = '42501'; end if;
    if p_org is not null and p_org is distinct from v_org then raise exception 'not authorized' using errcode = '42501'; end if;
  end if;
  select * into s from app_private.agreement_signatures
   where org_id = v_org and kind = p_kind and (p_version is null or version = p_version)
   order by signed_at desc limit 1;
  if s.id is null then return jsonb_build_object('signed', false); end if;
  select * into a from app_private.master_agreements where kind = p_kind and version = s.version;
  select name into v_name from public.organizations where id = v_org;
  select nullif(trim(i.data->>'legal_name'), '') into v_legal from app_private.org_onboarding_items i where i.org_id = v_org and i.item_key = 'legal_entity';
  return jsonb_build_object(
    'signed', true, 'kind', p_kind, 'version', s.version, 'title', a.title, 'body_md', a.body_md,
    'body_sha256', s.body_sha256,
    'text_matches', a.body_md is not null and encode(extensions.digest(a.body_md, 'sha256'), 'hex') = s.body_sha256,
    'company', v_name, 'legal_name', v_legal,
    'signer_name', s.signer_name, 'signer_title', s.signer_title, 'signed_at', s.signed_at,
    'consent_text', s.consent_text, 'ip', s.ip, 'user_agent', s.user_agent, 'ref', 'LB-' || upper(replace(p_kind, 'shipper_', 'SH-')) || '-' || s.id,
    'loadboot', jsonb_build_object('entity', 'LoadBoot LLC', 'state', 'a Wyoming limited liability company', 'by', 'Authorized Signatory', 'dated', s.signed_at));
end $function$;

revoke execute on function public.cc_shipper_agreement_copy(text, integer, uuid) from public, anon;
grant execute on function public.cc_shipper_agreement_copy(text, integer, uuid) to authenticated;

-- anon SECURITY DEFINER names must not move
do $$
declare v_added text; v_gone text;
begin
  select string_agg(n, ', ') into v_added from (
    select p.proname::text n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
    except select n from pg_temp._bl0508_anon) a;
  select string_agg(n, ', ') into v_gone from (
    select n from pg_temp._bl0508_anon
    except select p.proname::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')) g;
  if v_added is not null or v_gone is not null then
    raise exception 'bl_ship_0508: anon surface changed (added: %, removed: %) — rolling back', v_added, v_gone; end if;
end $$;
