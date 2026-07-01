-- cvp_webhook_fanout.sql
-- Connects the durable domain-event log to the outbound webhook system. Previously app_private.emit_event wrote
-- domain_events (status='pending') but nothing ever fanned them out to webhook_endpoints, so subscribers never
-- received anything. This adds the fan-out: pending domain_events → webhook_deliveries for every ACTIVE endpoint
-- subscribed to that event_type, then marks the event processed. Idempotent (each event processed once).
-- Also exposes a curated event catalog so integrators can discover subscribable events (incl. delivery-engine).
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

-- Internal fan-out (called by the service-role RPC / a staff flush).
create or replace function app_private.fanout_domain_events(p_limit integer default 200)
returns integer language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_ids bigint[]; v_n int:=0;
begin
  select array_agg(id) into v_ids from (
    select id from app_private.domain_events where status='pending' order by id
    limit greatest(coalesce(p_limit,200),1) for update skip locked) s;
  if v_ids is null then return 0; end if;
  insert into app_private.webhook_deliveries(endpoint_id,event_type,payload,status)
  select ep.id, de.event_type, jsonb_build_object('event',de.event_type,'aggregate_type',de.aggregate_type,
           'aggregate_id',de.aggregate_id,'occurred_at',de.occurred_at,'data',de.payload), 'queued'
  from app_private.domain_events de
  join app_private.webhook_endpoints ep on ep.active and ep.event_types @> array[de.event_type]
  where de.id = any(v_ids);
  get diagnostics v_n = row_count;
  update app_private.domain_events set status='processed', processed_at=now() where id = any(v_ids);
  return v_n;
end; $$;
-- internal only: no grants

-- Service-role entry point for the webhook worker / cron.
create or replace function public.cc_fanout_domain_events(p_limit integer default 200)
returns integer language plpgsql security definer set search_path to 'app_private, public'
as $$
begin return app_private.fanout_domain_events(p_limit); end; $$;
revoke execute on function public.cc_fanout_domain_events(integer) from public, anon, authenticated;
grant  execute on function public.cc_fanout_domain_events(integer) to service_role;

-- Staff manual flush (integrations manager) — push pending events into the webhook delivery queue now.
create or replace function public.cc_webhooks_flush()
returns integer language plpgsql security definer set search_path to 'app_private, public'
as $$
begin
  if not (public.has_global_permission('settings.manage') or public.has_global_permission('integrations.view')) then
    raise exception 'not authorized' using errcode='42501'; end if;
  return app_private.fanout_domain_events(500);
end; $$;
revoke execute on function public.cc_webhooks_flush() from anon, public;
grant  execute on function public.cc_webhooks_flush() to authenticated;

-- Curated catalog of subscribable domain events (for the webhook endpoint editor + developer portal).
create or replace function public.cc_event_catalog()
returns table(event_type text, category text, description text)
language sql stable security definer set search_path to 'app_private, public'
as $$
  select * from (values
    ('load.assigned','Dispatch','A load was assigned to a carrier'),
    ('trip.status','Dispatch','A trip changed status (dispatched→in_transit→delivered)'),
    ('trip.exception','Dispatch','A carrier reported a trip exception (detention/TONU/…)'),
    ('trip.exception.resolved','Dispatch','A staff member resolved a trip exception'),
    ('pod.uploaded','Documents','A proof-of-delivery was uploaded'),
    ('pod.reviewed','Documents','A POD was approved or rejected by staff'),
    ('invoice.prep_requested','Finance','An invoice was requested for a delivered trip'),
    ('form.submitted','Growth','A website form was submitted'),
    ('campaign.enqueued','Marketing','A campaign was approved and queued for send'),
    ('comm.suppress','Marketing','An address was suppressed (bounce/complaint/manual)'),
    ('comm.unsubscribe','Marketing','A recipient unsubscribed via one-click link'),
    ('comm.trigger.set','Marketing','A transactional automation trigger was configured')
  ) as c(event_type, category, description)
  where public.is_active_staff();
$$;
revoke execute on function public.cc_event_catalog() from anon, public;
grant  execute on function public.cc_event_catalog() to authenticated;
