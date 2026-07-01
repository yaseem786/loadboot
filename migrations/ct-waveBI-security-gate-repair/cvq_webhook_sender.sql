-- cvq_webhook_sender.sql
-- Service-role transport for outbound webhooks: claim queued webhook_deliveries (with their endpoint URL),
-- then mark the result (delivered, or failed → retry up to 5 attempts then terminal 'failed'). Same trust model
-- as the delivery worker: granted to service_role only, off the anon+authenticated surface. Signing is done in
-- the edge function via an owner-set env secret (no signing secret is stored in the DB).
--
-- Adds 'sending' as an allowed in-flight status (additive; existing queued/delivered/failed/skipped unchanged),
-- so a claimed delivery can't be double-claimed by a concurrent worker.
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

alter table app_private.webhook_deliveries drop constraint if exists webhook_deliveries_status_check;
alter table app_private.webhook_deliveries add constraint webhook_deliveries_status_check
  check (status = any (array['queued'::text,'sending'::text,'delivered'::text,'failed'::text,'skipped'::text]));

create or replace function public.cc_webhook_claim(p_limit integer default 50)
returns table(id uuid, url text, event_type text, payload jsonb, signing_configured boolean)
language plpgsql security definer set search_path to 'app_private, public'
as $$
begin
  return query
  with claimed as (
    select d.id from app_private.webhook_deliveries d
    where d.status='queued' order by d.created_at
    for update skip locked limit least(greatest(coalesce(p_limit,50),1),200)
  ), upd as (
    update app_private.webhook_deliveries wd set status='sending', attempts=coalesce(wd.attempts,0)+1
    from claimed c where wd.id=c.id
    returning wd.id, wd.endpoint_id, wd.event_type, wd.payload
  )
  select u.id, ep.url, u.event_type, u.payload, ep.signing_configured
  from upd u join app_private.webhook_endpoints ep on ep.id=u.endpoint_id;
end; $$;
revoke execute on function public.cc_webhook_claim(integer) from public, anon, authenticated;
grant  execute on function public.cc_webhook_claim(integer) to service_role;

create or replace function public.cc_webhook_mark(p_id uuid, p_ok boolean, p_note text default null)
returns text language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v record; v_new text;
begin
  select * into v from app_private.webhook_deliveries where id=p_id for update;
  if v.id is null then raise exception 'delivery not found' using errcode='22023'; end if;
  if p_ok then v_new := 'delivered';
  else v_new := case when coalesce(v.attempts,0) >= 5 then 'failed' else 'queued' end; end if;
  update app_private.webhook_deliveries set status=v_new, note=p_note where id=p_id;
  return v_new;
end; $$;
revoke execute on function public.cc_webhook_mark(uuid, boolean, text) from public, anon, authenticated;
grant  execute on function public.cc_webhook_mark(uuid, boolean, text) to service_role;
