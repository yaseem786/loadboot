-- cvg_delivery_worker.sql
-- Service-role delivery worker RPCs over the unified ledger. These are the ONLY functions a headless worker
-- (the delivery-worker edge function, running as service_role) uses to drain + settle the queue. They are
-- deliberately kept OFF the anon and authenticated surfaces: execute is revoked from public/anon/authenticated
-- and granted ONLY to service_role (which also bypasses RLS). No JWT / permission path can reach them, so the
-- anon SECURITY DEFINER surface is unchanged (still 5) and no logged-in user can drain the queue.
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

-- Worker claim — atomic, same semantics as cc_delivery_claim but authorized by grant (service_role) only.
create or replace function public.cc_delivery_worker_claim(p_limit integer default 50, p_channel text default 'email')
returns setof app_private.message_deliveries language plpgsql security definer set search_path to 'app_private, public'
as $$
begin
  return query with claimed as (select id from app_private.message_deliveries
      where status='queued' and channel=p_channel and coalesce(scheduled_at,now())<=now()
      order by scheduled_at nulls first for update skip locked limit least(greatest(coalesce(p_limit,50),1),500))
    update app_private.message_deliveries m set status='claimed', claimed_at=now(), attempts=attempts+1, updated_at=now()
    from claimed where m.id=claimed.id returning m.*;
end; $$;
revoke execute on function public.cc_delivery_worker_claim(integer, text) from public, anon, authenticated;
grant  execute on function public.cc_delivery_worker_claim(integer, text) to service_role;

-- Worker mark — record a provider outcome. failed => retry (queued) until attempts>=5 then dead_letter;
-- bounced/complained => auto-suppress; every call logs an idempotent provider_events row. Same behaviour as
-- cc_delivery_mark, authorized by grant (service_role) only.
create or replace function public.cc_delivery_worker_mark(p_id uuid, p_status text, p_reason text default null, p_provider text default null, p_dedupe text default null)
returns text language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v record; v_new text;
begin
  select * into v from app_private.message_deliveries where id=p_id for update;
  if v.id is null then raise exception 'delivery not found' using errcode='22023'; end if;
  if p_status not in ('sent','delivered','opened','clicked','bounced','complained','unsubscribed','failed') then raise exception 'invalid status' using errcode='22023'; end if;
  if p_status='failed' then
    v_new := case when v.attempts>=5 then 'dead_letter' else 'queued' end;
    update app_private.message_deliveries set status=v_new, failure_reason=p_reason, updated_at=now() where id=p_id;
  else
    update app_private.message_deliveries set status=p_status, failure_reason=p_reason,
      sent_at=coalesce(sent_at, case when p_status in ('sent','delivered') then now() end),
      delivered_at=case when p_status='delivered' then now() else delivered_at end, updated_at=now() where id=p_id;
    v_new := p_status;
    if p_status in ('bounced','complained') and v.recipient_email is not null then
      insert into app_private.suppressions(channel,address,reason) values ('email',lower(v.recipient_email),p_status) on conflict do nothing; end if;
  end if;
  insert into app_private.provider_events(delivery_id,provider,raw_type,normalized_status,dedupe_key,payload)
    values (p_id,coalesce(p_provider,v.provider),p_status,v_new,p_dedupe,jsonb_build_object('reason',p_reason))
    on conflict (dedupe_key) where dedupe_key is not null do nothing;
  return v_new;
end; $$;
revoke execute on function public.cc_delivery_worker_mark(uuid, text, text, text, text) from public, anon, authenticated;
grant  execute on function public.cc_delivery_worker_mark(uuid, text, text, text, text) to service_role;

-- Worker resolve — map a provider event back to a delivery id (by our idempotency_key ref, else newest by
-- recipient email). Service-role only. Used by delivery-webhook to correlate signed provider events.
create or replace function public.cc_delivery_worker_resolve(p_ref text default null, p_email text default null)
returns uuid language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare v_id uuid;
begin
  if p_ref is not null then
    select id into v_id from app_private.message_deliveries where idempotency_key=p_ref limit 1;
    if v_id is not null then return v_id; end if;
  end if;
  if p_email is not null then
    select id into v_id from app_private.message_deliveries where recipient_email=lower(p_email)
      order by created_at desc limit 1;
  end if;
  return v_id;
end; $$;
revoke execute on function public.cc_delivery_worker_resolve(text, text) from public, anon, authenticated;
grant  execute on function public.cc_delivery_worker_resolve(text, text) to service_role;
