-- bl_fix_0091 — "Update pickup time" on a SUBMITTED (not-yet-posted) load did nothing:
-- cc_partner_update_pickup only updated public.loads (raising 'not authorized' when
-- posted_load_id was null) and NEVER updated app_private.partner_loads.pickup_date,
-- so the broker UI kept showing EXPIRED forever. Now the partner_loads row itself is
-- rescheduled (dates + windows, delivery auto-shift) and the promoted board load, when
-- it exists, is updated exactly as before (incl. cancelled→available reactivation).
-- Applied to staging 2026-07-14 (verified on the Cedar Park, TX load). Replay on PROD.

create or replace function public.cc_partner_update_pickup(p_load uuid, p_pickup_date date, p_pickup_time text default null, p_delivery_date date default null, p_delivery_time text default null, p_pickup_mode text default null, p_delivery_mode text default null, p_team boolean default null)
 returns jsonb language plpgsql security definer
 set search_path to 'app_private', 'public'
as $function$
declare v_org uuid; v_pl app_private.partner_loads; v_pub uuid; l record; v_was text; v_del date; v_pt text; v_dt text; v_det jsonb;
begin
  v_org := app_private.my_partner_org();
  if v_org is null then raise exception 'not a partner account' using errcode='42501'; end if;
  if p_pickup_date is null then raise exception 'a new pickup date is required' using errcode='22023'; end if;
  if p_pickup_date < current_date then raise exception 'the new pickup date must be today or later' using errcode='22023'; end if;
  select * into v_pl from app_private.partner_loads pl where pl.id=p_load and pl.broker_org=v_org;
  if v_pl.id is not null then
    v_pub := v_pl.posted_load_id;
  else
    select ld.id into v_pub from public.loads ld where ld.id=p_load and ld.broker_org=v_org;
    if v_pub is null then raise exception 'not authorized' using errcode='42501'; end if;
  end if;
  if v_pl.id is not null and v_pl.status in ('booked','delivered') then
    raise exception 'load is % — cannot reschedule now', v_pl.status using errcode='22023';
  end if;
  v_del := case
    when p_delivery_date is not null then p_delivery_date
    when v_pl.id is not null and v_pl.delivery_date is not null and v_pl.pickup_date is not null
      then greatest(v_pl.delivery_date + (p_pickup_date - v_pl.pickup_date), p_pickup_date)
    else null end;
  if v_pl.id is not null then
    update app_private.partner_loads set
      pickup_date = p_pickup_date,
      delivery_date = coalesce(v_del, delivery_date),
      pickup_window = case when nullif(trim(coalesce(p_pickup_time,'')),'') is null then pickup_window
                           when lower(coalesce(p_pickup_mode,''))='appointment' then 'Appt ' || trim(p_pickup_time)
                           else trim(p_pickup_time) end,
      delivery_window = case when nullif(trim(coalesce(p_delivery_time,'')),'') is null then delivery_window
                             when lower(coalesce(p_delivery_mode,''))='appointment' then 'Appt ' || trim(p_delivery_time)
                             else trim(p_delivery_time) end,
      updated_at = now()
    where id = v_pl.id;
  end if;
  if v_pub is not null then
    select * into l from public.loads where id=v_pub;
    v_was := l.status;
    if v_was in ('booked','delivered') then raise exception 'load is % — cannot reschedule now', v_was using errcode='22023'; end if;
    if v_del is null then
      v_del := case when l.delivery_date is not null and l.pickup_date is not null
        then greatest(l.delivery_date + (p_pickup_date - l.pickup_date), p_pickup_date) else l.delivery_date end;
    end if;
    if v_del is not null and v_del < p_pickup_date then
      raise exception 'delivery date cannot be before the new pickup date' using errcode='22023';
    end if;
    v_pt := case
      when nullif(trim(coalesce(p_pickup_time,'')),'') is null then l.pickup_time
      when lower(coalesce(p_pickup_mode,'')) = 'appointment' then 'Appt ' || trim(p_pickup_time)
      else trim(p_pickup_time) end;
    v_dt := case
      when nullif(trim(coalesce(p_delivery_time,'')),'') is null then l.delivery_time
      when lower(coalesce(p_delivery_mode,'')) = 'appointment' then 'Appt ' || trim(p_delivery_time)
      else trim(p_delivery_time) end;
    v_det := coalesce(l.details,'{}'::jsonb);
    if p_pickup_mode is not null and nullif(trim(coalesce(p_pickup_time,'')),'') is not null then
      v_det := v_det || jsonb_build_object('dock_hours_pickup',
        case when lower(p_pickup_mode)='appointment' then 'By appointment only' else 'FCFS ' || trim(p_pickup_time) end);
    end if;
    if p_delivery_mode is not null and nullif(trim(coalesce(p_delivery_time,'')),'') is not null then
      v_det := v_det || jsonb_build_object('dock_hours_delivery',
        case when lower(p_delivery_mode)='appointment' then 'By appointment only' else 'FCFS ' || trim(p_delivery_time) end);
    end if;
    if p_team is not null then v_det := v_det || jsonb_build_object('team_required', p_team); end if;
    update public.loads set pickup_date=p_pickup_date, pickup_time=v_pt,
      delivery_date=v_del, delivery_time=v_dt, details=v_det,
      status = case when status='cancelled' then 'available' else status end
     where id=v_pub;
    begin update app_private.partner_loads set status='posted' where posted_load_id=v_pub; exception when others then null; end;
  end if;
  perform app_private.log_audit('load.reschedule','load',coalesce(v_pub, p_load)::text,null,'broker rescheduled (full scheduling)', jsonb_build_object('pickup_date',p_pickup_date,'delivery_date',v_del,'team',p_team));
  return jsonb_build_object('ok',true,'pickup_date',p_pickup_date,'delivery_date',v_del,'reactivated', coalesce(v_was,'')='cancelled');
end; $function$;

notify pgrst, 'reload schema';
