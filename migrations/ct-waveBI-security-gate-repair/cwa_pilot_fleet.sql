-- cwa_pilot_fleet.sql
-- AI LOAD PILOT — ADVANCED (fleet level). Two new explainable, deterministic advisors:
--   1) cc_carrier_best_loads(p_carrier, p_limit)  — the REVERSE question: for one carrier, rank all open loads
--      using the carrier's real last location (deadhead, only from real GPS) and stated dispatch preferences.
--      Staff (dispatch.view) may ask about any carrier; a carrier account always gets its OWN org only.
--   2) cc_dispatch_plan(p_max_loads)              — one-click fleet plan: greedy assignment of open loads to
--      eligible carriers, each load at most once, carrier capacity (available trucks) respected, every pairing
--      itemized with the same push-score formula the Load Pilot drawer uses. Deterministic greedy — the plan is
--      a PROPOSAL for a dispatcher; nothing is booked automatically.
-- Honesty rules preserved: deadhead only when real coords exist (labeled ESTIMATE + basis), unknown data says
-- 'unknown', ineligible carriers are never planned, fleet-size-unknown carriers are capped at 1 planned load
-- with an explicit note. No black-box numbers: every score is a sum of printed factors.
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

-- 1) REVERSE ADVISOR — best open loads for one carrier.
create or replace function public.cc_carrier_best_loads(p_carrier uuid default null, p_limit integer default 10)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare v_my uuid; v_target uuid; v_name text; pr record;
  v_lat double precision; v_lng double precision; v_loc_at timestamptz; v_loc_basis text;
  v_targetrpm numeric; v_maxdh numeric;
  l record; e record; v_rpm numeric; v_dh double precision; v_all_in numeric;
  p int; s int; facts jsonb; items jsonb:='[]'::jsonb; skipped jsonb:='[]'::jsonb; v_skip int:=0;
begin
  v_my := app_private.my_carrier_org();
  if v_my is not null then
    v_target := v_my;                                   -- carriers only ever see their own ranking
  elsif public.has_global_permission('dispatch.view') then
    v_target := p_carrier;
    if v_target is null then raise exception 'p_carrier required for staff' using errcode='22023'; end if;
  else
    raise exception 'not authorized' using errcode='42501';
  end if;
  select name into v_name from public.organizations where id=v_target and kind='carrier';
  if v_name is null then raise exception 'carrier not found' using errcode='22023'; end if;

  select t.last_lat, t.last_lng, t.last_loc_at into v_lat, v_lng, v_loc_at
    from app_private.trips t where t.carrier_id=v_target and t.last_lat is not null
    order by t.last_loc_at desc nulls last limit 1;
  v_loc_basis := case when v_lat is not null
    then 'last trip GPS '||to_char(v_loc_at,'MM-DD HH24:MI')||' (ESTIMATE, straight-line)' end;

  select * into pr from app_private.carrier_dispatch_prefs where carrier_id=v_target;
  v_targetrpm := coalesce(pr.min_rpm, 2.50);
  v_maxdh := coalesce(pr.max_deadhead_miles, 400);

  for l in
    select * from public.loads
    where status in ('available','offered','matching','approved_for_matching')
      and (pickup_date is null or pickup_date >= current_date)
    order by created_at desc limit 60
  loop
    select me.eligible, me.hard_fails into e
      from app_private.match_eligibility(l.id) me where me.carrier_id=v_target;
    if e is null or not e.eligible then
      v_skip := v_skip + 1;
      if jsonb_array_length(skipped) < 5 then
        skipped := skipped || jsonb_build_object('load', l.id, 'lane', l.origin||' → '||l.destination,
          'reasons', to_jsonb(coalesce(e.hard_fails, array['carrier not evaluated'])));
      end if;
      continue;
    end if;

    v_rpm := case when coalesce(l.miles,0)>0 and l.rate is not null then round(l.rate/l.miles,2) end;
    v_dh  := case when v_lat is not null and l.pickup_lat is not null
               then app_private.haversine_miles(v_lat, v_lng, l.pickup_lat, l.pickup_lng) end;
    v_all_in := case when l.rate is not null and coalesce(l.miles,0)+coalesce(v_dh,0) > 0
               then round((l.rate/(l.miles+coalesce(v_dh,0)))::numeric,2) end;
    s := 0; facts := '[]'::jsonb;
    -- rate vs the carrier's own target (their stated min RPM, else $2.50 default)
    p := case when v_rpm is null then 0 when v_rpm>=v_targetrpm then 30 else greatest(0, round(30*v_rpm/v_targetrpm))::int end;
    s:=s+p; facts:=facts||jsonb_build_object('factor','rate vs your target','points',p,'max',30,
      'detail', coalesce('$'||v_rpm||'/mi vs $'||v_targetrpm||'/mi target','rate or miles missing'));
    -- deadhead from the carrier's real last location
    p := case when v_dh is null then 0 when v_dh<50 then 20 when v_dh<150 then 12 when v_dh<=v_maxdh then 5 else 0 end;
    s:=s+p; facts:=facts||jsonb_build_object('factor','deadhead','points',p,'max',20,
      'detail', coalesce('~'||round(v_dh)||' mi ('||v_loc_basis||')'||case when v_dh>v_maxdh then ' — OVER your '||v_maxdh||' mi limit' else '' end,
                         'unknown — no recent GPS for this carrier'));
    -- preference fit
    p := (case when pr.carrier_id is not null and l.equipment is not null and pr.preferred_equipment @> array[l.equipment] then 10 else 0 end)
       + (case when pr.carrier_id is not null and exists (select 1 from unnest(pr.preferred_lanes) pl
              where position(lower(pl) in lower(coalesce(l.origin,'')||' '||coalesce(l.destination,''))) > 0) then 10 else 0 end);
    s:=s+p; facts:=facts||jsonb_build_object('factor','preference fit','points',p,'max',20,
      'detail', case when pr.carrier_id is null then 'no preferences on file' else 'equipment/lane vs stated preferences' end);
    -- data trust
    p := case l.verification_state when 'verified' then 10 when 'partial' then 5 else 0 end;
    s:=s+p; facts:=facts||jsonb_build_object('factor','data trust','points',p,'max',10,'detail',coalesce(l.verification_state,'unknown'));
    -- timing
    p := case when l.pickup_date is null then 5 else 10 end;
    s:=s+p; facts:=facts||jsonb_build_object('factor','timing','points',p,'max',10,
      'detail', coalesce('pickup '||l.pickup_date::text,'no pickup date'));
    -- broker identity + completeness
    p := (case when coalesce(l.broker,'')<>'' or l.broker_org is not null then 5 else 0 end)
       + (case when coalesce(l.commodity,'')<>'' then 3 else 0 end) + (case when coalesce(l.weight,'')<>'' then 2 else 0 end);
    s:=s+p; facts:=facts||jsonb_build_object('factor','broker + completeness','points',p,'max',10,
      'detail', coalesce(l.broker,'broker not identified'));

    items := items || jsonb_build_object('load', l.id, 'lane', l.origin||' → '||l.destination,
      'equipment', l.equipment, 'rate', l.rate, 'miles', l.miles, 'loaded_rpm', v_rpm,
      'deadhead_miles', case when v_dh is not null then round(v_dh) end, 'all_in_rpm', v_all_in,
      'pickup_date', l.pickup_date, 'score', s, 'score_max', 100, 'factors', facts);
  end loop;

  return jsonb_build_object(
    'carrier_id', v_target, 'carrier', v_name,
    'last_location_basis', coalesce(v_loc_basis, 'no recent GPS on file'),
    'preferences_on_file', pr.carrier_id is not null,
    'assumptions', jsonb_build_object('target_rpm', v_targetrpm, 'max_deadhead', v_maxdh,
      'note','target = carrier''s stated min RPM when set; deadhead/all-in figures are straight-line ESTIMATES'),
    'loads', coalesce((select jsonb_agg(q1.x order by q1.sc desc)
        from (select x, (x->>'score')::int as sc from jsonb_array_elements(items) x
              order by (x->>'score')::int desc limit greatest(coalesce(p_limit,10),1)) q1
        ), '[]'::jsonb),
    'returned', least(jsonb_array_length(items), p_limit),
    'skipped_ineligible', v_skip, 'skipped_examples', skipped);
end; $$;
revoke execute on function public.cc_carrier_best_loads(uuid, integer) from anon, public;
grant  execute on function public.cc_carrier_best_loads(uuid, integer) to authenticated;

-- 2) FLEET DISPATCH PLAN — greedy, explained, capacity-aware proposal. Staff only (dispatch.manage).
create or replace function public.cc_dispatch_plan(p_max_loads integer default 20)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare pairrec record; v_plan jsonb:='[]'::jsonb; v_assigned uuid[]:='{}';
  v_cap jsonb:='{}'::jsonb; v_rem int; v_total int:=0; v_count int:=0;
  v_loads jsonb:='{}'::jsonb;  -- load_id -> lane (for unassigned report)
  v_capnote text; lrec record; v_unassigned jsonb:='[]'::jsonb;
begin
  if not public.has_global_permission('dispatch.manage') then raise exception 'not authorized' using errcode='42501'; end if;

  for lrec in
    select id, origin, destination from public.loads
    where status in ('available','offered','matching','approved_for_matching')
      and (pickup_date is null or pickup_date >= current_date)
    order by created_at desc limit least(greatest(coalesce(p_max_loads,20),1),50)
  loop
    v_loads := v_loads || jsonb_build_object(lrec.id::text, lrec.origin||' → '||lrec.destination);
  end loop;

  for pairrec in
    with lds as (
      select * from public.loads where id in (select (jsonb_object_keys(v_loads))::uuid)
    ),
    pairs as (
      select l.id as load_id, l.origin, l.destination, l.equipment, l.rate, l.miles,
        case when coalesce(l.miles,0)>0 and l.rate is not null then round(l.rate/l.miles,2) end as rpm,
        r.carrier_id, r.carrier, r.score as match_score, r.available_trucks,
        dh.miles as dh_miles, dh.basis as dh_basis, pf.bonus as pref_bonus, pf.notes as pref_notes,
        (r.score
          + case when dh.miles is null then 0 when dh.miles<50 then 15 when dh.miles<150 then 8
                 when dh.miles > coalesce(pr.max_deadhead_miles,400) then -10 else 0 end
          + pf.bonus)::int as push_score
      from lds l
      cross join lateral public.cc_match_rank(l.id) r
      left join lateral (
        select app_private.haversine_miles(t.last_lat,t.last_lng,l.pickup_lat,l.pickup_lng) as miles,
               'last trip GPS '||to_char(t.last_loc_at,'MM-DD HH24:MI')||' (ESTIMATE, straight-line)' as basis
        from app_private.trips t
        where t.carrier_id=r.carrier_id and t.last_lat is not null and l.pickup_lat is not null
        order by t.last_loc_at desc nulls last limit 1
      ) dh on true
      left join app_private.carrier_dispatch_prefs pr on pr.carrier_id=r.carrier_id
      cross join lateral (
        select
          (case when pr.min_rpm is not null and coalesce(l.miles,0)>0 and l.rate is not null
                 and round(l.rate/l.miles,2)>=pr.min_rpm then 10 else 0 end)
          + (case when pr.carrier_id is not null and l.equipment is not null and pr.preferred_equipment @> array[l.equipment] then 5 else 0 end) as bonus,
          (case when pr.carrier_id is null then 'no preferences on file'
                when pr.min_rpm is not null and coalesce(l.miles,0)>0 and l.rate is not null
                     and round(l.rate/l.miles,2) < pr.min_rpm then 'BELOW carrier min $'||pr.min_rpm||'/mi'
                else 'fits stated preferences' end) as notes
      ) pf
    )
    select * from pairs order by push_score desc, load_id, carrier_id
  loop
    if pairrec.load_id = any(v_assigned) then continue; end if;
    if v_cap ? pairrec.carrier_id::text then
      v_rem := (v_cap->>pairrec.carrier_id::text)::int;
    else
      v_rem := case when coalesce(pairrec.available_trucks,0) > 0 then pairrec.available_trucks else 1 end;
    end if;
    if v_rem <= 0 then continue; end if;
    v_capnote := case when coalesce(pairrec.available_trucks,0)=0 then 'fleet size unknown — capped at 1 planned load, verify trucks' end;
    v_assigned := v_assigned || pairrec.load_id;
    v_cap := v_cap || jsonb_build_object(pairrec.carrier_id::text, v_rem - 1);
    v_total := v_total + pairrec.push_score; v_count := v_count + 1;
    v_plan := v_plan || jsonb_build_object(
      'load', pairrec.load_id, 'lane', pairrec.origin||' → '||pairrec.destination,
      'equipment', pairrec.equipment, 'rate', pairrec.rate, 'loaded_rpm', pairrec.rpm,
      'carrier_id', pairrec.carrier_id, 'carrier', pairrec.carrier, 'push_score', pairrec.push_score,
      'explanation', (select jsonb_agg(x) from unnest(array[
        'match score '||pairrec.match_score,
        coalesce('deadhead ~'||round(pairrec.dh_miles)||' mi ('||pairrec.dh_basis||')','deadhead unknown — no recent carrier location'),
        pairrec.pref_notes, v_capnote]) x where x is not null));
  end loop;

  for lrec in select (jsonb_object_keys(v_loads))::uuid as id loop
    if not (lrec.id = any(v_assigned)) then
      v_unassigned := v_unassigned || jsonb_build_object('load', lrec.id, 'lane', v_loads->>lrec.id::text,
        'reason', 'no eligible carrier with remaining planned capacity');
    end if;
  end loop;

  return jsonb_build_object(
    'note', 'PROPOSAL only — deterministic greedy plan (highest push score first, one load per pairing, carrier capacity respected). Nothing is booked until a dispatcher sends offers.',
    'loads_considered', (select count(*) from jsonb_object_keys(v_loads)),
    'assigned', v_count, 'total_push_score', v_total,
    'plan', v_plan, 'unassigned', v_unassigned);
end; $$;
revoke execute on function public.cc_dispatch_plan(integer) from anon, public;
grant  execute on function public.cc_dispatch_plan(integer) to authenticated;
