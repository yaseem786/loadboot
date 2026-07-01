-- cvc_delivery_engine_queue.sql
-- Public campaign/delivery RPCs on top of the unified ledger from cvb_delivery_engine_core.sql.
-- Flow: preview (dry-run counts) -> enqueue (confirm-count guarded, consent + suppression + dedup + idempotent)
--       -> claim (atomic FOR UPDATE SKIP LOCKED) -> mark (provider result; bounce/complaint auto-suppress).
--
-- CAMPAIGN SAFETY: cc_campaign_enqueue REFUSES to send unless the caller passes p_confirm_count exactly equal
-- to the freshly recomputed final recipient count — a human must preview then confirm. No broad send can fire
-- from a single call with a stale/guessed count. Enqueue only writes to the queue; nothing is actually
-- transmitted until a provider worker claims + sends (not wired to a live provider in dev).
--
-- Security: every public function revokes execute from anon,public and grants only to authenticated, and each
-- body first checks app_private.can_manage_comms(). Anon SECURITY DEFINER surface is unchanged (stays 5).
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk)
--   as consolidated migration `cvb_cvc_delivery_engine` (incl. cvb_preview_cte_fix + cvc_enqueue_uuid_fix).

-- ---------------------------------------------------------------------------
-- Preview — dry run: audience size, after-consent, suppressed, final unique recipients, sample of 5.
-- Uses CTEs (no temp tables) so it can be called repeatedly within one transaction.
-- ---------------------------------------------------------------------------
create or replace function public.cc_campaign_audience_preview(p_campaign uuid)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare c record; v_aud int; v_opt int; v_supp int; v_final int; v_sample jsonb;
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode='42501'; end if;
  select camp.*, a.type as audience_type into c from app_private.campaigns camp
    left join app_private.audiences a on a.id=camp.audience_id where camp.id=p_campaign;
  if c.id is null then raise exception 'campaign not found' using errcode='22023'; end if;
  with aud as (select recipient_user, lower(email) email, opted_in from app_private.resolve_audience_emails(coalesce(c.audience_type,''))),
       supp as (select lower(address) a from app_private.suppressions where channel='email')
  select (select count(*) from aud),(select count(*) from aud where opted_in),
    (select count(*) from aud where opted_in and email in (select a from supp)),
    (select count(distinct email) from aud where opted_in and email not in (select a from supp)),
    (select coalesce(jsonb_agg(email),'[]'::jsonb) from (select distinct email from aud where opted_in and email not in (select a from supp) limit 5) s)
  into v_aud,v_opt,v_supp,v_final,v_sample;
  return jsonb_build_object('campaign',c.name,'channel','email','audience_total',v_aud,'after_consent',v_opt,
    'suppressed',v_supp,'final_recipients',v_final,'sample',v_sample,'excluded_no_consent',v_aud-v_opt);
end; $$;
revoke execute on function public.cc_campaign_audience_preview(uuid) from anon, public;
grant  execute on function public.cc_campaign_audience_preview(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Enqueue — confirm-count guarded. Inserts one queued/scheduled delivery per surviving recipient.
-- Idempotent via idempotency_key = campaign::text || ':email:' || email (ON CONFLICT DO NOTHING),
-- so re-running never double-sends. Emits campaign.enqueued event + audit log.
-- ---------------------------------------------------------------------------
create or replace function public.cc_campaign_enqueue(p_campaign uuid, p_confirm_count integer)
returns jsonb language plpgsql security definer set search_path to 'app_private, public'
as $$
declare c record; v_final int; v_ins int; v_sched timestamptz;
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode='42501'; end if;
  select camp.*, a.type as audience_type into c from app_private.campaigns camp
    left join app_private.audiences a on a.id=camp.audience_id where camp.id=p_campaign;
  if c.id is null then raise exception 'campaign not found' using errcode='22023'; end if;
  if not ('email'=any(coalesce(c.channels,array[]::text[]))) then raise exception 'campaign has no email channel' using errcode='22023'; end if;
  v_sched := coalesce(c.scheduled_at, now());
  with rcpt as (select email, min(recipient_user::text)::uuid recipient_user from (
      select lower(email) email, recipient_user from app_private.resolve_audience_emails(coalesce(c.audience_type,''))
      where opted_in and lower(email) not in (select lower(address) from app_private.suppressions where channel='email')) x group by email)
  select count(*) into v_final from rcpt;
  if p_confirm_count is null or p_confirm_count<>v_final then
    raise exception 'recipient count changed (expected %, now %) — re-preview and confirm', p_confirm_count, v_final using errcode='22023'; end if;
  with rcpt as (select email, min(recipient_user::text)::uuid recipient_user from (
      select lower(email) email, recipient_user from app_private.resolve_audience_emails(coalesce(c.audience_type,''))
      where opted_in and lower(email) not in (select lower(address) from app_private.suppressions where channel='email')) x group by email),
  ins as (insert into app_private.message_deliveries(org_id,source,campaign_id,template_key,channel,provider,recipient_user,recipient_email,idempotency_key,status,scheduled_at,meta)
      select null,'campaign',c.id,c.template_key,'email','resend',r.recipient_user,r.email,c.id::text||':email:'||r.email,
        case when v_sched>now() then 'scheduled' else 'queued' end, v_sched, jsonb_build_object('subject',c.subject,'utm_campaign',c.utm_campaign)
      from rcpt r on conflict (idempotency_key) do nothing returning 1)
  select count(*) into v_ins from ins;
  update app_private.campaigns set status=case when v_sched>now() then 'scheduled' else 'sending' end, updated_at=now() where id=c.id;
  perform app_private.emit_event('campaign.enqueued','campaign',c.id::text, jsonb_build_object('final_recipients',v_final,'newly_queued',v_ins,'channel','email'));
  perform app_private.log_audit('campaign.enqueue','campaign',c.id::text,null,format('enqueued %s email recipients',v_final), jsonb_build_object('newly_queued',v_ins));
  return jsonb_build_object('final_recipients',v_final,'newly_queued',v_ins,'status',case when v_sched>now() then 'scheduled' else 'sending' end);
end; $$;
revoke execute on function public.cc_campaign_enqueue(uuid, integer) from anon, public;
grant  execute on function public.cc_campaign_enqueue(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Claim — atomic worker claim of due queued rows (FOR UPDATE SKIP LOCKED); increments attempts.
-- ---------------------------------------------------------------------------
create or replace function public.cc_delivery_claim(p_limit integer default 50, p_channel text default 'email')
returns setof app_private.message_deliveries language plpgsql security definer set search_path to 'app_private, public'
as $$
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode='42501'; end if;
  return query with claimed as (select id from app_private.message_deliveries
      where status='queued' and channel=p_channel and coalesce(scheduled_at,now())<=now()
      order by scheduled_at nulls first for update skip locked limit least(greatest(coalesce(p_limit,50),1),500))
    update app_private.message_deliveries m set status='claimed', claimed_at=now(), attempts=attempts+1, updated_at=now()
    from claimed where m.id=claimed.id returning m.*;
end; $$;
revoke execute on function public.cc_delivery_claim(integer, text) from anon, public;
grant  execute on function public.cc_delivery_claim(integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Mark — record a delivery outcome. failed => retry (back to queued) until attempts>=5 then dead_letter.
-- bounced/complained => auto-add to suppressions. Every call logs an idempotent provider_events row.
-- ---------------------------------------------------------------------------
create or replace function public.cc_delivery_mark(p_id uuid, p_status text, p_reason text default null, p_provider text default null, p_dedupe text default null)
returns text language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v record; v_new text;
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode='42501'; end if;
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
revoke execute on function public.cc_delivery_mark(uuid, text, text, text, text) from anon, public;
grant  execute on function public.cc_delivery_mark(uuid, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Suppress — manual opt-out (email|sms). Lower-cased; idempotent; audited.
-- ---------------------------------------------------------------------------
create or replace function public.cc_suppress(p_channel text, p_address text, p_reason text default 'manual')
returns boolean language plpgsql security definer set search_path to 'app_private, public'
as $$
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode='42501'; end if;
  if p_channel not in ('email','sms') then raise exception 'invalid channel' using errcode='22023'; end if;
  insert into app_private.suppressions(channel,address,reason) values (p_channel,lower(p_address),coalesce(p_reason,'manual')) on conflict do nothing;
  perform app_private.log_audit('comm.suppress','suppression',lower(p_address),null,p_channel||' suppressed',jsonb_build_object('reason',p_reason));
  return true;
end; $$;
revoke execute on function public.cc_suppress(text, text, text) from anon, public;
grant  execute on function public.cc_suppress(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Health — status histogram over the whole ledger (for the Delivery Health dashboard).
-- ---------------------------------------------------------------------------
create or replace function public.cc_delivery_health()
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public'
as $$
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode='42501'; end if;
  return (select coalesce(jsonb_object_agg(status,c),'{}'::jsonb) from (select status,count(*) c from app_private.message_deliveries group by status) s);
end; $$;
revoke execute on function public.cc_delivery_health() from anon, public;
grant  execute on function public.cc_delivery_health() to authenticated;
