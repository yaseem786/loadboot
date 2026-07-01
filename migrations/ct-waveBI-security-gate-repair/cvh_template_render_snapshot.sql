-- cvh_template_render_snapshot.sql
-- Makes campaign sends carry REAL content: a template renderer + snapshotting the resolved subject/body onto
-- each delivery at enqueue time (so the worker transmits actual HTML/text, not just the subject line).
--
-- 1) cc_render_template(key, vars) — server-truth {{variable}} substitution (staff-gated).
-- 2) cc_campaign_enqueue — now resolves the campaign's template (or its own subject/body) and stores
--    subject + body_html + body_text in each delivery's meta. Behaviour otherwise unchanged (confirm-count
--    guard, consent, suppression, dedup, idempotency all identical), so the delivery-engine matrix still passes.
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

-- Template renderer: substitutes {{var}} / {{ var }} from p_vars; reports any unresolved placeholders.
create or replace function public.cc_render_template(p_key text, p_vars jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public'
as $$
declare t record; v_subj text; v_html text; v_text text; k text; val text;
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode='42501'; end if;
  select * into t from app_private.comm_templates where key=p_key;
  if t.key is null then raise exception 'template not found' using errcode='22023'; end if;
  v_subj := coalesce(t.subject,''); v_html := coalesce(t.body,''); v_text := coalesce(t.body_text, t.body, '');
  for k, val in select key, value from jsonb_each_text(coalesce(p_vars,'{}'::jsonb)) loop
    v_subj := replace(replace(v_subj, '{{'||k||'}}', val), '{{ '||k||' }}', val);
    v_html := replace(replace(v_html, '{{'||k||'}}', val), '{{ '||k||' }}', val);
    v_text := replace(replace(v_text, '{{'||k||'}}', val), '{{ '||k||' }}', val);
  end loop;
  return jsonb_build_object('subject',v_subj,'html',v_html,'text',v_text,
    'unresolved', (select coalesce(jsonb_agg(distinct m[1]),'[]'::jsonb)
                   from regexp_matches(v_subj||' '||v_html||' '||v_text, '\{\{\s*([a-z_]+)\s*\}\}', 'g') m));
end; $$;
revoke execute on function public.cc_render_template(text, jsonb) from anon, public;
grant  execute on function public.cc_render_template(text, jsonb) to authenticated;

-- Enqueue with content snapshot. Resolves body from the campaign's template (if any), else the campaign's own
-- subject/body. Stores subject + body_html + body_text in each delivery's meta for the worker to transmit.
create or replace function public.cc_campaign_enqueue(p_campaign uuid, p_confirm_count integer)
returns jsonb language plpgsql security definer set search_path to 'app_private, public'
as $$
declare c record; v_final int; v_ins int; v_sched timestamptz; v_subj text; v_html text; v_text text;
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode='42501'; end if;
  select camp.*, a.type as audience_type into c from app_private.campaigns camp
    left join app_private.audiences a on a.id=camp.audience_id where camp.id=p_campaign;
  if c.id is null then raise exception 'campaign not found' using errcode='22023'; end if;
  if not ('email'=any(coalesce(c.channels,array[]::text[]))) then raise exception 'campaign has no email channel' using errcode='22023'; end if;
  -- resolve content: template first, else the campaign's own subject/body
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
