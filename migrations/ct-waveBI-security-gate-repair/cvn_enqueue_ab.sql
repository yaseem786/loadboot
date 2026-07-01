-- cvn_enqueue_ab.sql
-- Variant-aware cc_campaign_enqueue. If the campaign has A/B variants, recipients are split deterministically
-- (stable per-address hash, weighted) and each delivery snapshots ITS variant's content + label. If there are
-- NO variants, the insert is byte-identical to the prior (cvi) behaviour — fully regression-safe. All guards
-- (approval, confirm-count, consent, suppression, idempotency) unchanged.
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

create or replace function public.cc_campaign_enqueue(p_campaign uuid, p_confirm_count integer)
returns jsonb language plpgsql security definer set search_path to 'app_private, public'
as $$
declare c record; v_final int; v_ins int; v_sched timestamptz; v_subj text; v_html text; v_text text; v_nvar int;
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode='42501'; end if;
  select camp.*, a.type as audience_type into c from app_private.campaigns camp
    left join app_private.audiences a on a.id=camp.audience_id where camp.id=p_campaign;
  if c.id is null then raise exception 'campaign not found' using errcode='22023'; end if;
  if c.approved_by is null then raise exception 'campaign is not approved — an approver must approve it before sending' using errcode='42501'; end if;
  if not ('email'=any(coalesce(c.channels,array[]::text[]))) then raise exception 'campaign has no email channel' using errcode='22023'; end if;
  select coalesce(t.subject, c.subject), coalesce(t.body, c.body), coalesce(t.body_text, t.body, c.body)
    into v_subj, v_html, v_text
  from (select 1) _ left join app_private.comm_templates t on t.key = c.template_key;
  select count(*) into v_nvar from app_private.campaign_variants where campaign_id=c.id;
  v_sched := coalesce(c.scheduled_at, now());
  with rcpt as (select email, min(recipient_user::text)::uuid recipient_user from (
      select lower(email) email, recipient_user from app_private.resolve_audience_emails(coalesce(c.audience_type,''))
      where opted_in and lower(email) not in (select lower(address) from app_private.suppressions where channel='email')) x group by email)
  select count(*) into v_final from rcpt;
  if p_confirm_count is null or p_confirm_count<>v_final then
    raise exception 'recipient count changed (expected %, now %) — re-preview and confirm', p_confirm_count, v_final using errcode='22023'; end if;

  if v_nvar = 0 then
    -- no variants: single content snapshot (identical to prior behaviour)
    with rcpt as (select email, min(recipient_user::text)::uuid recipient_user from (
        select lower(email) email, recipient_user from app_private.resolve_audience_emails(coalesce(c.audience_type,''))
        where opted_in and lower(email) not in (select lower(address) from app_private.suppressions where channel='email')) x group by email),
    ins as (insert into app_private.message_deliveries(org_id,source,campaign_id,template_key,channel,provider,recipient_user,recipient_email,idempotency_key,status,scheduled_at,meta)
        select null,'campaign',c.id,c.template_key,'email','resend',r.recipient_user,r.email,c.id::text||':email:'||r.email,
          case when v_sched>now() then 'scheduled' else 'queued' end, v_sched,
          jsonb_build_object('subject',v_subj,'utm_campaign',c.utm_campaign,'body_html',v_html,'body_text',v_text)
        from rcpt r on conflict (idempotency_key) do nothing returning 1)
    select count(*) into v_ins from ins;
  else
    -- A/B: deterministic weighted split; each delivery carries its variant's content + label
    with rcpt as (select email, min(recipient_user::text)::uuid recipient_user from (
        select lower(email) email, recipient_user from app_private.resolve_audience_emails(coalesce(c.audience_type,''))
        where opted_in and lower(email) not in (select lower(address) from app_private.suppressions where channel='email')) x group by email),
    vs as (select label,
        coalesce(nullif(subject,''), v_subj) subject,
        coalesce(nullif(body_html,''), v_html) body_html,
        coalesce(nullif(body_text,''), v_text) body_text,
        (sum(weight) over (order by created_at, id) - weight) lo,
        sum(weight) over (order by created_at, id) hi
      from app_private.campaign_variants where campaign_id=c.id),
    tot as (select sum(weight) w from app_private.campaign_variants where campaign_id=c.id),
    ins as (insert into app_private.message_deliveries(org_id,source,campaign_id,template_key,channel,provider,recipient_user,recipient_email,idempotency_key,status,scheduled_at,meta)
        select null,'campaign',c.id,c.template_key,'email','resend',r.recipient_user,r.email,c.id::text||':email:'||r.email,
          case when v_sched>now() then 'scheduled' else 'queued' end, v_sched,
          jsonb_build_object('subject',v.subject,'utm_campaign',c.utm_campaign,'body_html',v.body_html,'body_text',v.body_text,'variant',v.label)
        from rcpt r cross join tot
        join vs v on ((hashtextextended(r.email,0) % tot.w) + tot.w) % tot.w >= v.lo
                 and ((hashtextextended(r.email,0) % tot.w) + tot.w) % tot.w <  v.hi
        on conflict (idempotency_key) do nothing returning 1)
    select count(*) into v_ins from ins;
  end if;

  update app_private.campaigns set status=case when v_sched>now() then 'scheduled' else 'sending' end, updated_at=now() where id=c.id;
  perform app_private.emit_event('campaign.enqueued','campaign',c.id::text, jsonb_build_object('final_recipients',v_final,'newly_queued',v_ins,'channel','email','variants',v_nvar));
  perform app_private.log_audit('campaign.enqueue','campaign',c.id::text,null,format('enqueued %s email recipients (%s variants)',v_final,v_nvar), jsonb_build_object('newly_queued',v_ins));
  return jsonb_build_object('final_recipients',v_final,'newly_queued',v_ins,'variants',v_nvar,'status',case when v_sched>now() then 'scheduled' else 'sending' end);
end; $$;
revoke execute on function public.cc_campaign_enqueue(uuid, integer) from anon, public;
grant  execute on function public.cc_campaign_enqueue(uuid, integer) to authenticated;
