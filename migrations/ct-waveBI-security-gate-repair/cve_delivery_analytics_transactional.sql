-- cve_delivery_analytics_transactional.sql
-- Delivery-engine depth: per-campaign analytics + a single-message transactional enqueue hook.
-- Both staff-gated (can_manage_comms), anon revoked. No change to the anon SECURITY DEFINER surface.
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

-- ---------------------------------------------------------------------------
-- Per-campaign delivery analytics — counts + rates over the unified ledger.
-- ---------------------------------------------------------------------------
create or replace function public.cc_campaign_analytics(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare v jsonb; v_total int; v_sent int; v_delivered int; v_opened int; v_clicked int; v_bounced int; v_failed int; v_dead int; v_pending int;
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode='42501'; end if;
  select count(*),
    count(*) filter (where status in ('sent','delivered','opened','clicked')),
    count(*) filter (where status='delivered'),
    count(*) filter (where status in ('opened','clicked')),
    count(*) filter (where status='clicked'),
    count(*) filter (where status in ('bounced','complained')),
    count(*) filter (where status='failed'),
    count(*) filter (where status='dead_letter'),
    count(*) filter (where status in ('queued','scheduled','claimed'))
  into v_total,v_sent,v_delivered,v_opened,v_clicked,v_bounced,v_failed,v_dead,v_pending
  from app_private.message_deliveries where campaign_id=p_campaign;
  v := jsonb_build_object(
    'total',v_total,'sent',v_sent,'delivered',v_delivered,'opened',v_opened,'clicked',v_clicked,
    'bounced',v_bounced,'failed',v_failed,'dead_letter',v_dead,'pending',v_pending,
    'delivery_rate', case when v_sent>0 then round(100.0*v_delivered/v_sent,1) else 0 end,
    'open_rate',     case when v_delivered>0 then round(100.0*v_opened/v_delivered,1) else 0 end,
    'click_rate',    case when v_opened>0 then round(100.0*v_clicked/v_opened,1) else 0 end,
    'bounce_rate',   case when v_total>0 then round(100.0*v_bounced/v_total,1) else 0 end);
  return v;
end; $$;
revoke execute on function public.cc_campaign_analytics(uuid) from anon, public;
grant  execute on function public.cc_campaign_analytics(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Transactional enqueue — put a SINGLE message onto the same unified ledger. This is the hook
-- automations / domain events use (welcome email, POD-reviewed notice, etc.). Idempotent per caller
-- key so an event replay never double-sends. Enforces the suppression list; consent is the caller's
-- responsibility for transactional (operational) messages, which are not marketing.
-- ---------------------------------------------------------------------------
create or replace function public.cc_enqueue_transactional(
  p_channel text, p_email text, p_template_key text default null, p_subject text default null,
  p_idem text default null, p_meta jsonb default '{}'::jsonb, p_scheduled_at timestamptz default null)
returns jsonb language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_key text; v_sched timestamptz; v_id uuid; v_ins int; v_provider text;
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode='42501'; end if;
  if p_channel not in ('email','sms') then raise exception 'invalid channel' using errcode='22023'; end if;
  if p_email is null or p_email !~ '^[^@]+@[^@]+\.[^@]+$' then raise exception 'invalid recipient' using errcode='22023'; end if;
  if exists (select 1 from app_private.suppressions where channel=p_channel and address=lower(p_email)) then
    return jsonb_build_object('queued',false,'reason','suppressed'); end if;
  v_provider := case when p_channel='sms' then 'twilio' else 'resend' end;
  v_sched := coalesce(p_scheduled_at, now());
  v_key := coalesce(p_idem, 'txn:'||p_channel||':'||lower(p_email)||':'||coalesce(p_template_key,'')||':'||extract(epoch from v_sched)::bigint::text);
  insert into app_private.message_deliveries(source,channel,provider,recipient_email,idempotency_key,status,scheduled_at,template_key,meta)
  values ('transactional',p_channel,v_provider,lower(p_email),v_key,
    case when v_sched>now() then 'scheduled' else 'queued' end, v_sched, p_template_key,
    coalesce(p_meta,'{}'::jsonb) || jsonb_build_object('subject',p_subject))
  on conflict (idempotency_key) do nothing returning id into v_id;
  get diagnostics v_ins = row_count;
  return jsonb_build_object('queued', v_ins>0, 'delivery_id', v_id, 'idempotency_key', v_key,
    'status', case when v_ins=0 then 'duplicate' when v_sched>now() then 'scheduled' else 'queued' end);
end; $$;
revoke execute on function public.cc_enqueue_transactional(text, text, text, text, text, jsonb, timestamptz) from anon, public;
grant  execute on function public.cc_enqueue_transactional(text, text, text, text, text, jsonb, timestamptz) to authenticated;
