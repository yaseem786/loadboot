-- bl_fleet_0234 — the Command Center can finally see the truck the carrier described.
--
-- The Add-truck form collects 50 columns (bl_fleet_0210–0224). cc_carrier_360 returned
-- drivers but NOT ONE truck — the only fleet fact on the Carrier 360 screen was
-- profile.truck_count, a number the carrier typed at signup. So staff approving a COI, or
-- answering "can this truck take a 4,000 lb pallet off a kerb", went back to WhatsApp to
-- ask for spec we already held — the exact thing collecting these fields was meant to end.
--
-- New function rather than widening cc_carrier_360: that body already differs between
-- staging and prod in places, and this keeps the change additive and droppable
-- (`drop function public.cc_carrier_fleet_360(uuid);` reverts it completely).
--
-- The VIN verdict is the point. A truck is only dispatchable on insurance that names it,
-- so every truck carries its own state against the approved COI, and where it matches we
-- return the vehicle line AS PRINTED ON THE CERTIFICATE — staff should compare what the
-- carrier typed against what the insurer wrote, not take our word that they agree.
--
-- Applied: staging snslhvmkjusozgjelghi + production rwscphuhpjoudvljvmdk (2026-08-21).

create or replace function public.cc_carrier_fleet_360(p_org uuid)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'app_private, public'
as $function$
declare v_org uuid; v_cov app_private.coi_coverage;
begin
  if not public.has_global_permission('carriers.view') then
    raise exception 'not authorized' using errcode='42501';
  end if;
  -- Carrier 360 links can arrive keyed on either the org or its owning user.
  select id into v_org from public.organizations
   where kind='carrier' and (id=p_org or owner_user_id=p_org) limit 1;
  if v_org is null then raise exception 'carrier not found' using errcode='22023'; end if;

  select * into v_cov from app_private.coi_coverage where org_id = v_org;

  return jsonb_build_object(
    'org', v_org,
    'coi', jsonb_build_object(
      'mode',           coalesce(v_cov.mode,'unknown'),
      'effective_date', v_cov.effective_date,
      'expiry_date',    v_cov.expiry_date,
      'expired',        (v_cov.expiry_date is not null and v_cov.expiry_date < current_date),
      'source',         v_cov.source,
      'note',           v_cov.note,
      'confirmed_at',   v_cov.confirmed_at,
      'document_id',    v_cov.document_id,
      'document',       (select jsonb_build_object('file_name',d.file_name,'file_path',d.file_path,'status',d.status,'created_at',d.created_at)
                           from public.documents d where d.id = v_cov.document_id),
      'vehicles',       coalesce((select jsonb_agg(jsonb_build_object('vin',v.vin,'descr',v.descr) order by v.vin)
                                    from app_private.coi_vehicles v where v.org_id = v_org), '[]'::jsonb)),

    'trucks', coalesce((
      select jsonb_agg(x order by x->>'unit_no' nulls last)
        from (
          select to_jsonb(t)
                 || jsonb_build_object(
                      'vin_normalized', app_private.vin_norm(t.vin),
                      'vin_valid',      app_private.vin_looks_valid(t.vin),
                      -- no_vin / invalid_vin resolve before coverage: an unreadable VIN is not
                      -- "not covered by the policy", it is a truck we cannot check at all.
                      'vin_state',      case
                                          when app_private.vin_norm(t.vin) is null then 'no_vin'
                                          when not app_private.vin_looks_valid(t.vin) then 'invalid_vin'
                                          else app_private.vin_coverage_state(v_org, t.vin)
                                        end,
                      -- The certificate's own words for this vehicle, when the VIN is listed.
                      'coi_line',       (select jsonb_build_object('vin',v.vin,'descr',v.descr)
                                           from app_private.coi_vehicles v
                                          where v.org_id = v_org and v.vin = app_private.vin_norm(t.vin) limit 1),
                      'coi_expired',    (v_cov.expiry_date is not null and v_cov.expiry_date < current_date),
                      'loading',        app_private.truck_loading_profile(t.id)) as x
            from app_private.fleet_trucks t
           where t.carrier_id = v_org
        ) s), '[]'::jsonb),

    'trailers', coalesce((select jsonb_agg(to_jsonb(tr) order by tr.unit_no)
                            from app_private.fleet_trailers tr where tr.carrier_id = v_org), '[]'::jsonb),

    'counts', (select jsonb_build_object(
        'trucks',        count(*),
        'active',        count(*) filter (where coalesce(t.status,'active')='active'),
        'covered',       count(*) filter (where app_private.vin_looks_valid(t.vin)
                                            and app_private.vin_coverage_state(v_org, t.vin)='covered'),
        'not_covered',   count(*) filter (where app_private.vin_looks_valid(t.vin)
                                            and app_private.vin_coverage_state(v_org, t.vin)='not_covered'),
        'no_coi',        count(*) filter (where app_private.vin_looks_valid(t.vin)
                                            and app_private.vin_coverage_state(v_org, t.vin)='no_coi'),
        'vin_problem',   count(*) filter (where not app_private.vin_looks_valid(t.vin)))
      from app_private.fleet_trucks t where t.carrier_id = v_org)
  );
end $function$;

-- Standing rule (loadboot-anon-surface): create-or-replace preserves an existing PUBLIC
-- grant, and revoking from public does not remove anon's own grant. Name both.
-- Verified after apply on both DBs: acl = postgres | authenticated | service_role, no anon.
revoke all on function public.cc_carrier_fleet_360(uuid) from anon, public;
grant execute on function public.cc_carrier_fleet_360(uuid) to authenticated;
