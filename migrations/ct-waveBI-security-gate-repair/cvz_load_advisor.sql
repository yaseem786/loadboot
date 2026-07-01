-- cvz_load_advisor.sql
-- AI LOAD PILOT — explainable take/negotiate/skip advisor + carrier push ranking (max input → max output).
-- Deterministic and fully explained: every point in every score is itemized; every estimate is labeled an
-- estimate with its assumptions echoed back; deadhead is computed ONLY when real coordinates exist (carrier's
-- last known trip location + load pickup coords) and is otherwise honestly 'unknown'. No invented data.
--
-- Also adds carrier dispatch PREFERENCES (min RPM, preferred equipment/lanes, home base) — carrier self-service,
-- read by the advisor so pushes respect what the carrier actually wants.
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

create table if not exists app_private.carrier_dispatch_prefs (
  carrier_id uuid primary key,
  min_rpm numeric,
  preferred_equipment text[] not null default '{}',
  preferred_lanes text[] not null default '{}',
  home_base text,
  max_deadhead_miles integer,
  notes text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);

-- Carrier self-service: set my dispatch preferences.
create or replace function public.cc_set_dispatch_prefs(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_org uuid;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  insert into app_private.carrier_dispatch_prefs(carrier_id, min_rpm, preferred_equipment, preferred_lanes, home_base, max_deadhead_miles, notes, updated_by, updated_at)
  values (v_org, nullif(p->>'min_rpm','')::numeric,
    coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'preferred_equipment','[]'::jsonb)) x), '{}'),
    coalesce((select array_agg(x) from jsonb_array_elements_text(coalesce(p->'preferred_lanes','[]'::jsonb)) x), '{}'),
    p->>'home_base', nullif(p->>'max_deadhead_miles','')::int, p->>'notes', auth.uid(), now())
  on conflict (carrier_id) do update set
    min_rpm=excluded.min_rpm, preferred_equipment=excluded.preferred_equipment, preferred_lanes=excluded.preferred_lanes,
    home_base=excluded.home_base, max_deadhead_miles=excluded.max_deadhead_miles, notes=excluded.notes,
    updated_by=excluded.updated_by, updated_at=now();
  perform app_private.log_audit('carrier.prefs','carrier',v_org::text,null,'dispatch preferences updated',p);
  return jsonb_build_object('ok',true);
end; $$;
revoke execute on function public.cc_set_dispatch_prefs(jsonb) from anon, public;
grant  execute on function public.cc_set_dispatch_prefs(jsonb) to authenticated;

-- Carrier self-service read.
create or replace function public.cc_get_dispatch_prefs()
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare v_org uuid; r record;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  select * into r from app_private.carrier_dispatch_prefs where carrier_id=v_org;
  return coalesce(to_jsonb(r), jsonb_build_object('carrier_id', v_org));
end; $$;
revoke execute on function public.cc_get_dispatch_prefs() from anon, public;
grant  execute on function public.cc_get_dispatch_prefs() to authenticated;

-- Haversine miles (internal helper).
create or replace function app_private.haversine_miles(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision)
returns double precision language sql immutable
as $$
  select 3959.0 * 2 * asin(least(1.0, sqrt(
    power(sin(radians(lat2-lat1)/2),2) + cos(radians(lat1))*cos(radians(lat2))*power(sin(radians(lng2-lng1)/2),2))));
$$;

-- THE ADVISOR. Staff-gated. p_overrides: {cost_per_mile, target_rpm, max_deadhead} to tune assumptions.
create or replace function public.cc_load_advisor(p_load uuid, p_overrides jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare l record; v_cpm numeric; v_target numeric; v_maxdh numeric;
  v_rpm numeric; v_margin_pm numeric; v_lane_trips int; v_lane_avg numeric;
  pts jsonb:='[]'::jsonb; v_score int:=0; p int; v_rec text; v_counter numeric;
  flags text[]:='{}'; v_carriers jsonb; v_top jsonb;
begin
  if not public.has_global_permission('dispatch.view') then raise exception 'not authorized' using errcode='42501'; end if;
  select * into l from public.loads where id=p_load;
  if l.id is null then raise exception 'load not found' using errcode='22023'; end if;
  v_cpm    := coalesce(nullif(p_overrides->>'cost_per_mile','')::numeric, 1.80);
  v_target := coalesce(nullif(p_overrides->>'target_rpm','')::numeric, 2.50);
  v_maxdh  := coalesce(nullif(p_overrides->>'max_deadhead','')::numeric, 400);

  -- ---------- LOAD ECONOMICS ----------
  v_rpm := case when coalesce(l.miles,0)>0 and l.rate is not null then round(l.rate/l.miles,2) end;
  v_margin_pm := case when v_rpm is not null then round(v_rpm - v_cpm,2) end;
  select count(*), round(avg(t.rate),0) into v_lane_trips, v_lane_avg
    from app_private.trips t join public.loads ll on ll.id=t.load_id
    where t.status in ('delivered','invoiced') and lower(ll.origin)=lower(l.origin) and lower(ll.destination)=lower(l.destination);

  -- ---------- EXPLAINED SCORE (each factor itemized) ----------
  -- economics vs target
  p := case when v_rpm is null then 0 when v_rpm>=v_target then 25 else greatest(0, round(25*v_rpm/v_target))::int end;
  v_score:=v_score+p; pts:=pts||jsonb_build_object('factor','rate per mile','points',p,'max',25,
    'detail', coalesce('$'||v_rpm||'/mi vs target $'||v_target||'/mi','rate or miles missing'));
  -- margin vs cost baseline
  p := case when v_margin_pm is null then 0 when v_margin_pm>=0.70 then 20 when v_margin_pm<=0 then 0 else round(20*v_margin_pm/0.70)::int end;
  v_score:=v_score+p; pts:=pts||jsonb_build_object('factor','est. margin per mile','points',p,'max',20,
    'detail', coalesce('$'||v_margin_pm||'/mi over $'||v_cpm||'/mi cost baseline (ESTIMATE)','not computable'));
  -- verification + confidence
  p := case l.verification_state when 'verified' then 10 when 'partial' then 5 else 0 end
     + case l.confidence when 'high' then 5 when 'medium' then 2 else 0 end;
  v_score:=v_score+p; pts:=pts||jsonb_build_object('factor','data trust','points',p,'max',15,
    'detail', l.verification_state||' / '||l.confidence||' confidence');
  -- source risk
  p := case when l.source_type in ('official_api','partner_portal','licensed_integration') then 10
            when l.source_type in ('staff_entered','imported','quote_converted','recurring_lane','duplicated','api_client','uploaded_document') then 5
            else 0 end;
  v_score:=v_score+p; pts:=pts||jsonb_build_object('factor','source reliability','points',p,'max',10,'detail',coalesce(l.source_type,'unknown source'));
  -- broker identity
  p := case when coalesce(l.broker,'')<>'' or l.broker_org is not null then 5 else 0 end;
  v_score:=v_score+p; pts:=pts||jsonb_build_object('factor','broker identified','points',p,'max',5,'detail',coalesce(l.broker,'not identified'));
  -- lane history
  p := case when v_lane_trips>0 then 10 else 0 end;
  v_score:=v_score+p; pts:=pts||jsonb_build_object('factor','lane history','points',p,'max',10,
    'detail', v_lane_trips||' delivered trip(s) on this lane'||coalesce(' (avg $'||v_lane_avg||')',''));
  -- timing
  p := case when l.pickup_date is null then 3 when l.pickup_date >= current_date then 10 else 0 end;
  v_score:=v_score+p; pts:=pts||jsonb_build_object('factor','timing','points',p,'max',10,
    'detail', coalesce('pickup '||l.pickup_date::text, 'no pickup date'));
  if l.pickup_date is not null and l.pickup_date < current_date then flags:=flags||('pickup date is in the past')::text; end if;
  if (to_jsonb(l)->>'expires_at') is not null and (to_jsonb(l)->>'expires_at')::timestamptz < now() then flags:=flags||('load posting has expired')::text; end if;
  -- completeness
  p := (case when coalesce(l.commodity,'')<>'' then 2 else 0 end) + (case when coalesce(l.weight,'')<>'' then 1 else 0 end)
     + (case when l.equipment is not null then 2 else 0 end);
  v_score:=v_score+p; pts:=pts||jsonb_build_object('factor','completeness','points',p,'max',5,
    'detail', concat_ws(', ', case when coalesce(l.commodity,'')<>'' then 'commodity' end, case when coalesce(l.weight,'')<>'' then 'weight' end, case when l.equipment is not null then 'equipment' end));
  if l.verification_state='unverified' and l.source_type='unverified_external' then flags:=flags||('unverified external load — verify before committing a truck')::text; end if;

  -- ---------- RECOMMENDATION ----------
  v_counter := case when l.miles is not null then round(l.miles * v_target, 0) end;
  v_rec := case
    when array_length(flags,1) is not null and (l.pickup_date is not null and l.pickup_date < current_date) then 'skip'
    when v_score >= 70 then 'take'
    when v_score >= 45 then 'negotiate'
    else 'skip' end;
  if v_rec='negotiate' and v_counter is not null and l.rate is not null and v_counter <= l.rate then v_rec:='take'; end if;

  -- ---------- CARRIER PUSH RANKING (location + preferences aware) ----------
  select jsonb_agg(rec order by (rec->>'push_score')::int desc) into v_carriers from (
    select jsonb_build_object(
      'carrier_id', r.carrier_id, 'carrier', r.carrier, 'match_score', r.score,
      'deadhead_miles', dh.miles, 'deadhead_basis', dh.basis,
      'all_in_rpm', case when l.rate is not null and coalesce(l.miles,0)+coalesce(dh.miles,0) > 0
          then round((l.rate/(l.miles+coalesce(dh.miles,0)))::numeric,2) end,
      'pref_fit', pf.fit, 'pref_notes', pf.notes,
      'push_score', (r.score
        + case when dh.miles is null then 0 when dh.miles<50 then 15 when dh.miles<150 then 8 when dh.miles> v_maxdh then -10 else 0 end
        + pf.bonus)::int,
      'explanation', jsonb_build_array(
          'match score '||r.score,
          coalesce('deadhead ~'||round(dh.miles)||' mi ('||dh.basis||')','deadhead unknown — no recent carrier location'),
          pf.notes)
        ) as rec
    from public.cc_match_rank(p_load) r
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
        (case when pr.min_rpm is not null and v_rpm is not null and v_rpm>=pr.min_rpm then 10 else 0 end)
        + (case when pr.carrier_id is not null and l.equipment is not null and pr.preferred_equipment @> array[l.equipment] then 5 else 0 end) as bonus,
        (case when pr.carrier_id is null then 'no preferences on file'
              when pr.min_rpm is not null and v_rpm is not null and v_rpm<pr.min_rpm then 'BELOW carrier min $'||pr.min_rpm||'/mi'
              else 'fits stated preferences' end) as fit,
        coalesce(nullif(concat_ws('; ',
          case when pr.min_rpm is not null then 'min RPM $'||pr.min_rpm end,
          case when array_length(pr.preferred_equipment,1) is not null then 'prefers '||array_to_string(pr.preferred_equipment,'/') end,
          case when pr.home_base is not null then 'home base '||pr.home_base end), ''), 'no stated preferences') as notes
    ) pf
  ) s;
  v_top := coalesce(v_carriers->0, null);

  return jsonb_build_object(
    'load', p_load, 'lane', l.origin||' → '||l.destination, 'equipment', l.equipment,
    'rate', l.rate, 'miles', l.miles, 'loaded_rpm', v_rpm,
    'assumptions', jsonb_build_object('cost_per_mile', v_cpm, 'target_rpm', v_target, 'max_deadhead', v_maxdh,
      'note','cost/margin/deadhead figures are ESTIMATES from these assumptions — override via p_overrides'),
    'score', v_score, 'score_max', 100, 'factors', pts, 'flags', to_jsonb(flags),
    'recommendation', v_rec,
    'suggested_counter_rate', case when v_rec='negotiate' then v_counter end,
    'lane_history', jsonb_build_object('delivered_trips', v_lane_trips, 'avg_rate', v_lane_avg),
    'push_ranking', coalesce(v_carriers,'[]'::jsonb),
    'push_recommendation', case when v_top is not null then
        'push to '||(v_top->>'carrier')||' (push score '||(v_top->>'push_score')||')' else 'no eligible carrier to push' end);
end; $$;
revoke execute on function public.cc_load_advisor(uuid, jsonb) from anon, public;
grant  execute on function public.cc_load_advisor(uuid, jsonb) to authenticated;
