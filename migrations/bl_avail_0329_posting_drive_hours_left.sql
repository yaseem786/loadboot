-- bl_avail_0329_posting_drive_hours_left.sql
-- Applied: staging 6 Sep 2026, production 6 Sep 2026.
--
-- WHY: an availability post never carried the one number a dispatcher plans the NEXT load
-- from — how much drive time the driver has left. It exists in app_private.truck_availability
-- (fleet-level, ELD-fed) but NOT in truck_postings, which is what the load board matches on.
-- A dispatcher looking at a fresh post could not tell a truck with 9 hours from one with 1.
--
-- SHAPE: deliberately ADDITIVE and separate. cc_post_truck and cc_update_truck_posting_place
-- are long, load-bearing functions; threading one optional field through both is a bad trade.
-- A tiny dedicated RPC sets the value and the posting engine is untouched. The frontend calls
-- it immediately after a successful post/update.
--
-- RANGE: 0-11. FMCSA 395.3(a)(3) caps driving at 11 hours after 10 consecutive hours off duty,
-- so a value above 11 is not a pessimistic estimate — it is an impossible one.
--
-- hos_source records whether a human typed it ('carrier') or it came from a connected ELD
-- ('eld'), so the UI can say "filled from your ELD — edit it if the clock has moved".
--
-- NOTE for anyone tempted to promise more: eld-poll writes HOS into truck_availability and
-- GPS into the ACTIVE TRIP only. Nothing derives a truck's EMPTY location, and nothing writes
-- to truck_postings. Connecting an ELD does NOT remove the need to post availability.

alter table app_private.truck_postings
  add column if not exists hos_drive_left_h numeric(4,1),
  add column if not exists hos_source text;

do $$ begin
  alter table app_private.truck_postings
    add constraint truck_postings_hos_range check (hos_drive_left_h is null or (hos_drive_left_h >= 0 and hos_drive_left_h <= 11));
exception when duplicate_object then null; end $$;

do $$ begin
  alter table app_private.truck_postings
    add constraint truck_postings_hos_source check (hos_source is null or hos_source in ('carrier','eld'));
exception when duplicate_object then null; end $$;

create or replace function public.cc_set_posting_hos(p_id uuid, p_hours numeric, p_source text default 'carrier')
returns jsonb
language plpgsql security definer
set search_path to 'app_private, public'
as $function$
declare v_org uuid; v_n int;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  if p_hours is not null and (p_hours < 0 or p_hours > 11) then
    raise exception 'Drive hours left must be between 0 and 11 — FMCSA caps driving at 11 hours.' using errcode='22023';
  end if;
  update app_private.truck_postings
     set hos_drive_left_h = p_hours,
         hos_source = case when p_hours is null then null
                           when coalesce(p_source,'carrier') = 'eld' then 'eld' else 'carrier' end,
         updated_at = now()
   where id = p_id and carrier_id = v_org;
  get diagnostics v_n = row_count;
  if v_n = 0 then raise exception 'posting not found for your account' using errcode='42501'; end if;
  return jsonb_build_object('ok', true, 'hos_drive_left_h', p_hours);
end $function$;

revoke all on function public.cc_set_posting_hos(uuid, numeric, text) from public;
revoke execute on function public.cc_set_posting_hos(uuid, numeric, text) from anon;
grant execute on function public.cc_set_posting_hos(uuid, numeric, text) to authenticated;

-- cc_my_truck_postings also re-created to expose hos_drive_left_h + hos_source
-- (full body applied in the same migration on both databases).
