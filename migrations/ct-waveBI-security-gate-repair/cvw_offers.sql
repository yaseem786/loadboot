-- cvw_offers.sql
-- Increment 47 — Offer waves, expiry and carrier response. Sits between the Matching engine and booking:
-- staff send a load offer to one or more RANKED, ELIGIBLE carriers with an expiry window; carriers view,
-- accept, decline (with reason) or counter. Eligibility is re-checked at send so an ineligible carrier is
-- never offered. (Transactional first-valid-acceptance + assignment is Increment 48.)
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

create table if not exists app_private.load_offers (
  id            uuid primary key default gen_random_uuid(),
  load_id       uuid not null,
  carrier_id    uuid not null,
  offered_rate  numeric,
  deadhead      integer,
  score         integer,
  status        text not null default 'sent',   -- sent|viewed|accepted|declined|expired|countered
  sent_at       timestamptz not null default now(),
  expiry_at     timestamptz,
  viewed_at     timestamptz,
  responded_at  timestamptz,
  decline_reason text,
  counter_rate  numeric,
  message       text,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (load_id, carrier_id)
);
create index if not exists load_offers_load_idx on app_private.load_offers(load_id);
create index if not exists load_offers_carrier_idx on app_private.load_offers(carrier_id, status);

alter table app_private.load_offers drop constraint if exists load_offers_status_check;
alter table app_private.load_offers add constraint load_offers_status_check
  check (status = any (array['sent','viewed','accepted','declined','expired','countered']));

-- Staff: send an offer wave to specific carriers (only the ELIGIBLE ones actually receive an offer).
create or replace function public.cc_offer_send(p_load uuid, p_carriers uuid[], p_rate numeric default null, p_expiry_minutes integer default 60)
returns jsonb language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_sent int:=0; v_skipped int:=0; c uuid; v_ok boolean; v_rate numeric; v_exp timestamptz;
begin
  if not public.has_global_permission('dispatch.manage') then raise exception 'not authorized' using errcode='42501'; end if;
  if not exists (select 1 from public.loads where id=p_load) then raise exception 'load not found' using errcode='22023'; end if;
  v_rate := coalesce(p_rate, (select rate from public.loads where id=p_load));
  v_exp := now() + (greatest(coalesce(p_expiry_minutes,60),5) || ' minutes')::interval;
  foreach c in array coalesce(p_carriers, array[]::uuid[]) loop
    -- re-check hard eligibility at send time
    select eligible into v_ok from public.cc_match_eligibility(p_load) el where el.carrier_id=c;
    if coalesce(v_ok,false) then
      insert into app_private.load_offers(load_id,carrier_id,offered_rate,expiry_at,status,created_by,
          score,deadhead)
        select p_load, c, v_rate, v_exp, 'sent', auth.uid(),
          (select score from public.cc_match_rank(p_load) r where r.carrier_id=c), null
      on conflict (load_id,carrier_id) do update set offered_rate=excluded.offered_rate, expiry_at=excluded.expiry_at,
          status='sent', sent_at=now(), responded_at=null, decline_reason=null, counter_rate=null, updated_at=now();
      v_sent := v_sent + 1;
      perform app_private.emit_event('offer.created','load_offer',p_load::text, jsonb_build_object('load',p_load,'carrier',c,'rate',v_rate));
    else
      v_skipped := v_skipped + 1;
    end if;
  end loop;
  perform app_private.log_audit('offer.send','load',p_load::text,null,format('offer wave: %s sent, %s skipped (ineligible)',v_sent,v_skipped),null);
  return jsonb_build_object('sent',v_sent,'skipped_ineligible',v_skipped,'expiry_at',v_exp);
end; $$;
revoke execute on function public.cc_offer_send(uuid, uuid[], numeric, integer) from anon, public;
grant  execute on function public.cc_offer_send(uuid, uuid[], numeric, integer) to authenticated;

-- Staff: list offers for a load.
create or replace function public.cc_load_offers(p_load uuid)
returns table(id uuid, carrier_id uuid, carrier text, offered_rate numeric, score integer, status text,
  sent_at timestamptz, expiry_at timestamptz, viewed_at timestamptz, responded_at timestamptz, decline_reason text, counter_rate numeric)
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
begin
  if not public.has_global_permission('dispatch.view') then raise exception 'not authorized' using errcode='42501'; end if;
  return query select o.id,o.carrier_id,org.name,o.offered_rate,o.score,o.status,o.sent_at,o.expiry_at,o.viewed_at,o.responded_at,o.decline_reason,o.counter_rate
    from app_private.load_offers o left join public.organizations org on org.id=o.carrier_id
    where o.load_id=p_load order by o.score desc nulls last, o.sent_at;
end; $$;
revoke execute on function public.cc_load_offers(uuid) from anon, public;
grant  execute on function public.cc_load_offers(uuid) to authenticated;

-- Carrier: my offers (self-scoped).
create or replace function public.cc_carrier_offers(p_limit integer default 50)
returns table(id uuid, load_id uuid, origin text, destination text, equipment text, offered_rate numeric,
  status text, sent_at timestamptz, expiry_at timestamptz)
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare v_org uuid;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  return query select o.id,o.load_id,l.origin,l.destination,l.equipment,o.offered_rate,o.status,o.sent_at,o.expiry_at
    from app_private.load_offers o join public.loads l on l.id=o.load_id
    where o.carrier_id=v_org order by o.sent_at desc limit least(greatest(coalesce(p_limit,50),1),200);
end; $$;
revoke execute on function public.cc_carrier_offers(integer) from anon, public;
grant  execute on function public.cc_carrier_offers(integer) to authenticated;

-- Carrier: respond to an offer (view|accept|decline|counter). Self-scoped + concurrency safe.
create or replace function public.cc_offer_respond(p_offer uuid, p_action text, p_reason text default null, p_counter numeric default null, p_message text default null)
returns jsonb language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_org uuid; o record;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  select * into o from app_private.load_offers where id=p_offer for update;
  if o.id is null or o.carrier_id<>v_org then raise exception 'offer not found' using errcode='42501'; end if;
  if o.status in ('accepted','declined','expired') then raise exception 'offer is already %', o.status using errcode='22023'; end if;
  if o.expiry_at is not null and o.expiry_at < now() then
    update app_private.load_offers set status='expired', updated_at=now() where id=p_offer;
    raise exception 'offer has expired' using errcode='22023'; end if;
  if p_action='view' then
    update app_private.load_offers set viewed_at=coalesce(viewed_at,now()), status=case when status='sent' then 'viewed' else status end, updated_at=now() where id=p_offer;
  elsif p_action='accept' then
    update app_private.load_offers set status='accepted', responded_at=now(), updated_at=now() where id=p_offer;
  elsif p_action='decline' then
    update app_private.load_offers set status='declined', responded_at=now(), decline_reason=p_reason, updated_at=now() where id=p_offer;
  elsif p_action='counter' then
    update app_private.load_offers set status='countered', responded_at=now(), counter_rate=p_counter, message=p_message, updated_at=now() where id=p_offer;
  else raise exception 'invalid action' using errcode='22023'; end if;
  perform app_private.emit_event('offer.responded','load_offer',p_offer::text, jsonb_build_object('offer',p_offer,'carrier',v_org,'action',p_action));
  return jsonb_build_object('ok',true,'action',p_action);
end; $$;
revoke execute on function public.cc_offer_respond(uuid, text, text, numeric, text) from anon, public;
grant  execute on function public.cc_offer_respond(uuid, text, text, numeric, text) to authenticated;

-- Staff/service: expire overdue offers.
create or replace function public.cc_offers_expire()
returns integer language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_n int;
begin
  if not public.has_global_permission('dispatch.view') then raise exception 'not authorized' using errcode='42501'; end if;
  update app_private.load_offers set status='expired', updated_at=now()
    where status in ('sent','viewed') and expiry_at is not null and expiry_at < now();
  get diagnostics v_n = row_count;
  return v_n;
end; $$;
revoke execute on function public.cc_offers_expire() from anon, public;
grant  execute on function public.cc_offers_expire() to authenticated;
