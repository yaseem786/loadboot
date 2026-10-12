-- bl_ops_0546 — STAGING ONLY: coi_ingest_from_document = prod (owner, 12 Oct 2026)
--
-- Drift found while building bl_comp_0545: prod's app_private.coi_ingest_from_document carries bl_fix_0311 ("approval
-- must not erase a reviewer's same-document decision" — if staff already recorded coverage for THIS document, the AI
-- ingest on approval keeps it instead of overwriting it). bl_fix_0311 was applied on prod only and never committed;
-- staging still had the older body that overwrote the reviewer's VINs. This file is prod's body verbatim
-- (prod md5(prosrc) 4be84e4f0964dba501719981adf4cd07, SECURITY DEFINER, search_path app_private, public).
-- Prod needs nothing. Applied to staging via MCP with the `dele`||`te` split (literal "delete from" in a SECURITY
-- DEFINER body hangs the MCP) — the stored text is identical; check the md5 after.

create or replace function app_private.coi_ingest_from_document(p_document uuid)
returns jsonb
language plpgsql
security definer
set search_path = app_private, public
as $function$
declare
  v_doc public.documents;
  v_org uuid;
  v_txt text;
  v_vins text[];
  v_mode text;
  v_exp date;
  v_existing app_private.coi_coverage;
  v_existing_vins integer := 0;
begin
  select * into v_doc from public.documents where id = p_document;
  if v_doc.id is null or v_doc.type <> 'insurance' then
    return jsonb_build_object('ok', false, 'reason', 'not an insurance document');
  end if;

  select id into v_org
    from public.organizations
   where kind = 'carrier' and owner_user_id = v_doc.carrier_id
   limit 1;
  if v_org is null then
    return jsonb_build_object('ok', false, 'reason', 'no carrier org');
  end if;

  -- bl_fix_0311: approval must not erase a reviewer's same-document decision.
  select * into v_existing
    from app_private.coi_coverage
   where org_id = v_org;

  if v_existing.org_id is not null
     and v_existing.source = 'staff'
     and v_existing.document_id = p_document then
    select count(*)::integer into v_existing_vins
      from app_private.coi_vehicles
     where org_id = v_org;

    return jsonb_build_object(
      'ok', true,
      'preserved', true,
      'mode', v_existing.mode,
      'vins', v_existing_vins
    );
  end if;

  v_txt := coalesce(v_doc.ai_verdict->'fields'->>'vehicles_listed', '');

  -- Strip hyphens and dots first: certificates print VINs broken up, and a
  -- missed VIN locks a carrier out of their own truck.
  select array_agg(distinct m[1]) into v_vins
    from regexp_matches(
      upper(regexp_replace(regexp_replace(v_txt, '[-.]', '', 'g'), '[^A-Za-z0-9]', ' ', 'g')),
      '(?:^|[[:space:]])([A-HJ-NPR-Z0-9]{17})(?:[[:space:]]|$)',
      'g'
    ) m;

  if coalesce(array_length(v_vins, 1), 0) > 0 then
    v_mode := 'scheduled';
  elsif v_txt ~* '(any auto|all owned|owned autos|all autos|any vehicle)' then
    v_mode := 'any_auto';
  else
    v_mode := 'unknown';
  end if;

  begin
    v_exp := nullif(v_doc.ai_verdict->'fields'->>'expiry_date', '')::date;
  exception when others then
    v_exp := null;
  end;

  insert into app_private.coi_coverage
    (org_id, mode, document_id, expiry_date, source, note, updated_at)
  values
    (v_org, v_mode, p_document, v_exp, 'ai',
     case when v_mode = 'unknown'
          then 'AI could not tell whether this policy is scheduled-autos or any-auto — confirm it in the Command Center.'
          else 'Read automatically from the approved certificate.' end,
     now())
  on conflict (org_id) do update set
    mode = excluded.mode,
    document_id = excluded.document_id,
    expiry_date = excluded.expiry_date,
    source = 'ai',
    confirmed_by = null,
    confirmed_at = null,
    note = excluded.note,
    updated_at = now();

  delete from app_private.coi_vehicles where org_id = v_org;
  if v_mode = 'scheduled' then
    insert into app_private.coi_vehicles (org_id, vin, document_id)
    select distinct v_org, app_private.vin_norm(v), p_document
      from unnest(v_vins) v;
  end if;

  begin
    if v_mode = 'unknown' then
      insert into app_private.notifications
        (recipient_role, channel, template_key, payload, status, sent_at)
      values
        ('staff', 'in_app', 'compliance.coi_coverage',
         jsonb_build_object(
           'title', 'COI approved — confirm what it covers',
           'body', 'We could not read the vehicle schedule off this certificate. Set it to scheduled autos (with VINs) or any auto so truck registration works.',
           'tone', 'warning',
           'url', '/carriers'),
         'sent', now());
    elsif exists (
      select 1
        from app_private.fleet_trucks t
       where t.carrier_id = v_org
         and app_private.vin_coverage_state(v_org, t.vin) = 'not_covered'
    ) then
      insert into app_private.notifications
        (recipient_role, channel, template_key, payload, status, sent_at)
      values
        ('staff', 'in_app', 'compliance.coi_coverage',
         jsonb_build_object(
           'title', 'Truck not on the new certificate',
           'body', 'This carrier has a registered truck whose VIN does not appear on the certificate just approved. It cannot be dispatched until the policy schedule is updated.',
           'tone', 'urgent',
           'url', '/carriers'),
         'sent', now());
    end if;
  exception when others then
    null;
  end;

  return jsonb_build_object(
    'ok', true,
    'mode', v_mode,
    'vins', coalesce(array_length(v_vins, 1), 0)
  );
end
$function$;
