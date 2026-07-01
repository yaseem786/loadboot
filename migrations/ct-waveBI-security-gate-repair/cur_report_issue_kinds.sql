-- cur_report_issue_kinds.sql
-- Add TONU and accident to the carrier trip-exception whitelist (Carrier Portal + Pocket "Report issue").
-- Also switches org resolution to app_private.my_carrier_org() for consistency with the other cc_pocket_* RPCs.
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

create or replace function public.cc_pocket_report_issue(p_trip uuid, p_kind text, p_note text default null)
returns uuid
language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_org uuid; v_id uuid;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  if not exists (select 1 from app_private.trips t where t.id=p_trip and t.carrier_id=v_org) then raise exception 'trip not found for your account' using errcode='42501'; end if;
  if coalesce(p_kind,'') not in ('detention','layover','lumper','tonu','breakdown','accident','weather','missed_appointment','other') then raise exception 'invalid issue type' using errcode='22023'; end if;
  insert into app_private.trip_exceptions(trip_id,kind,description,status,created_by)
    values (p_trip, p_kind, left(coalesce(p_note,''),2000), 'open', auth.uid()) returning id into v_id;
  perform app_private.emit_event('trip.exception','trip',p_trip::text, jsonb_build_object('kind',p_kind,'source','pocket','exception',v_id));
  perform app_private.log_audit('pocket.report_issue','trip_exception',v_id::text,v_org,p_kind,'{}'::jsonb);
  return v_id;
end; $$;
revoke execute on function public.cc_pocket_report_issue(uuid,text,text) from anon, public;
grant  execute on function public.cc_pocket_report_issue(uuid,text,text) to authenticated;

-- Align the table CHECK with the reporting whitelist. The old constraint only allowed
-- breakdown/weather/missed_appointment/accident/delay/other, which silently broke the existing
-- detention/layover/lumper options as well. This restores them and adds tonu.
alter table app_private.trip_exceptions drop constraint if exists trip_exceptions_kind_check;
alter table app_private.trip_exceptions add constraint trip_exceptions_kind_check
  check (kind = any (array['detention','layover','lumper','tonu','breakdown','accident','weather','missed_appointment','delay','other']));
