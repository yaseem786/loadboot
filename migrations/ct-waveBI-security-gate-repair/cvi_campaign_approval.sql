-- cvi_campaign_approval.sql
-- Campaign APPROVAL gate (maker-checker) — the missing governance link in the delivery chain. A campaign must
-- be explicitly approved before it can be enqueued, and the approver must NOT be the campaign's creator (when a
-- creator is recorded) — separation of duties, mirroring the settlement maker-checker. Approval is cleared on
-- any content edit path by the app (re-approval required). Staff-gated (can_manage_comms), anon revoked.
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

alter table app_private.campaigns add column if not exists approved_by uuid;
alter table app_private.campaigns add column if not exists approved_at timestamptz;

-- Approve or un-approve a campaign. p_approve=false revokes approval (e.g. before editing).
create or replace function public.cc_campaign_approve(p_campaign uuid, p_approve boolean default true)
returns jsonb language plpgsql security definer set search_path to 'app_private, public'
as $$
declare c record; v_uid uuid;
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode='42501'; end if;
  v_uid := auth.uid();
  select * into c from app_private.campaigns where id=p_campaign;
  if c.id is null then raise exception 'campaign not found' using errcode='22023'; end if;
  if p_approve then
    -- separation of duties: creator cannot approve their own campaign
    if c.created_by is not null and c.created_by = v_uid then
      raise exception 'maker-checker: the campaign creator cannot approve their own campaign' using errcode='42501'; end if;
    update app_private.campaigns set approved_by=v_uid, approved_at=now(), updated_at=now() where id=p_campaign;
    perform app_private.log_audit('campaign.approve','campaign',p_campaign::text,null,'campaign approved for send',null);
  else
    update app_private.campaigns set approved_by=null, approved_at=null, updated_at=now() where id=p_campaign;
    perform app_private.log_audit('campaign.unapprove','campaign',p_campaign::text,null,'campaign approval revoked',null);
  end if;
  return jsonb_build_object('approved', p_approve, 'approved_by', case when p_approve then v_uid else null end);
end; $$;
revoke execute on function public.cc_campaign_approve(uuid, boolean) from anon, public;
grant  execute on function public.cc_campaign_approve(uuid, boolean) to authenticated;

-- Enqueue now REQUIRES approval. All other guards (confirm-count, consent, suppression, dedup, idempotency,
-- content snapshot) are unchanged.
create or replace function public.cc_campaign_enqueue(p_campaign uuid, p_confirm_count integer)
returns jsonb language plpgsql security definer set search_path to 'app_private, public'
as $$
declare c record; v_final int; v_ins int; v_sched timestamptz; v_subj text; v_html text; v_text text;
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
        case when v_sched>now() then 'scheduled' else 'queued' end, v_sched,
        jsonb_build_object('subject',v_subj,'utm_campaign',c.utm_campaign,'body_html',v_html,'body_text',v_text)
      from rcpt r on conflict (idempotency_key) do nothing returning 1)
  select count(*) into v_ins from ins;
  update app_private.campaigns set status=case when v_sched>now() then 'scheduled' else 'sending' end, updated_at=now() where id=c.id;
  perform app_private.emit_event('campaign.enqueued','campaign',c.id::text, jsonb_build_object('final_recipients',v_final,'newly_queued',v_ins,'channel','email'));
  perform app_private.log_audit('campaign.enqueue','campaign',c.id::text,null,format('enqueued %s email recipients',v_final), jsonb_build_object('newly_queued',v_ins));
  return jsonb_build_object('final_recipients',v_final,'newly_queued',v_ins,'status',case when v_sched>now() then 'scheduled' else 'sending' end);
end; $$;
revoke execute on function public.cc_campaign_enqueue(uuid, integer) from anon, public;
grant  execute on function public.cc_campaign_enqueue(uuid, integer) to authenticated;

-- Surface approval state in the campaign list (additive columns; existing callers ignore them).
-- Return-type change requires a drop first; execute is re-granted to authenticated (anon revoked).
drop function if exists public.cc_cmp_list();
create or replace function public.cc_cmp_list()
returns table(id uuid, name text, objective text, status text, channels text[], subject text,
  audience_id uuid, audience_name text, audience_type text, template_key text,
  scheduled_at timestamptz, sent_at timestamptz, sent_count integer, created_at timestamptz,
  approved_by uuid, approved_at timestamptz)
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
begin
  if not public.is_active_staff() then raise exception 'not authorized' using errcode='42501'; end if;
  return query
    select c.id, c.name, c.objective, c.status, c.channels, c.subject,
           c.audience_id, a.name, a.type, c.template_key,
           c.scheduled_at, c.sent_at, c.sent_count, c.created_at, c.approved_by, c.approved_at
    from app_private.campaigns c
    left join app_private.audiences a on a.id = c.audience_id
    order by c.created_at desc;
end; $$;
revoke execute on function public.cc_cmp_list() from anon, public;
grant  execute on function public.cc_cmp_list() to authenticated;
