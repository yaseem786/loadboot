-- bl_disp_0147 — Dispatcher application: fix notification redirect + create a Task-queue task.
-- Bug 1: staff notification url was '/app/command-center/#/dispatchers'; the CC shell
--   prefixes '#' to urls starting with '/', producing a broken '#/app/command-center/#/…'
--   route — clicking did nothing. CC staff notification urls must be router paths ('/dispatchers').
--   (Same bug in agent_profiles_review_alert: '/app/command-center/#/agents' → '/agents'.)
-- Bug 2: a new dispatcher application created NO Task-queue task (unlike partner signups),
--   so it never appeared in the CC Task queue. Now dispatcher_apply inserts a
--   'dispatcher_review' task (idempotent: skipped if an open one exists for the user).
-- Data fix: existing dispatcher.applied notifications get the corrected url; existing
--   screening applications without an open task get one. STAGING then PROD.

create or replace function public.dispatcher_apply(p jsonb, p_submit boolean default false)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare v_uid uuid := auth.uid(); v_status text; v_name text;
begin
  if v_uid is null then return jsonb_build_object('error','not signed in'); end if;
  insert into app_private.dispatcher_profiles as d (user_id, full_name, phone, country, city, english_level, years_exp, load_boards, skills, refs, status, updated_at)
  values (v_uid, p->>'full_name', p->>'phone', p->>'country', p->>'city', p->>'english_level',
          nullif(p->>'years_exp','')::int, coalesce(p->'load_boards','[]'::jsonb), coalesce(p->'skills','{}'::jsonb), coalesce(p->'refs','[]'::jsonb),
          case when p_submit then 'screening' else 'applied' end, now())
  on conflict (user_id) do update set
    full_name = coalesce(excluded.full_name, d.full_name), phone = coalesce(excluded.phone, d.phone),
    country = coalesce(excluded.country, d.country), city = coalesce(excluded.city, d.city),
    english_level = coalesce(excluded.english_level, d.english_level), years_exp = coalesce(excluded.years_exp, d.years_exp),
    load_boards = coalesce(excluded.load_boards, d.load_boards), skills = coalesce(excluded.skills, d.skills), refs = coalesce(excluded.refs, d.refs),
    status = case when p_submit and d.status in ('applied','withdrawn') then 'screening' else d.status end, updated_at = now()
  returning status, full_name into v_status, v_name;
  if p_submit then
    begin
      insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
      values ('staff','in_app','dispatcher.applied', jsonb_build_object('user', v_uid, 'title', '🧑‍✈️ New dispatcher application',
          'body', coalesce(v_name,'A candidate') || ' applied to be a LoadBoot dispatcher. Open Dispatchers to screen.',
          'tone','info','url','/dispatchers'), 'sent', now());
    exception when others then null; end;
    begin
      if not exists (select 1 from app_private.automation_tasks t
                     where t.task_type = 'dispatcher_review' and t.related_id = v_uid::text and t.status = 'open') then
        insert into app_private.automation_tasks (task_type, title, description, priority, assignee_role, related_type, related_id, source_rule)
        values ('dispatcher_review', 'Review new dispatcher application',
          '📌 ' || coalesce(v_name,'A candidate') || E'\n👉 Screen the application (experience, English, load boards, CV), then move them through screening → skills test → paid trial in Dispatchers.',
          'urgent', 'operations_admin', 'dispatcher', v_uid::text, 'dispatcher_applied');
      end if;
    exception when others then null; end;
    begin
      perform app_private.sys_email('hello@loadboot.com','dispatcher.applied', 'LoadBoot Dispatcher — new application: ' || coalesce(v_name,'candidate'),
        '<p><b>' || coalesce(v_name,'A candidate') || '</b> applied to be a LoadBoot dispatcher. Open the Command Center → Dispatchers to screen.</p>',
        null, 'dispatchapply:'||v_uid::text||':'||to_char(now(),'YYYYMMDDHH24MI'));
    exception when others then null; end;
  end if;
  return jsonb_build_object('ok', true, 'status', v_status);
end $$;

-- Same url bug in the agent review-alert trigger function: '/app/command-center/#/agents' -> '/agents'
create or replace function app_private.agent_profiles_review_alert()
returns trigger language plpgsql security definer set search_path to 'app_private, public' as $$
declare
  v_email text; v_name text; v_kind text; v_title text; v_reason_tag text;
  new_id   text := NEW.payout_details->>'id_doc';
  new_bank text := NEW.payout_details->>'bank_doc';
  old_id   text := case when TG_OP='UPDATE' then OLD.payout_details->>'id_doc'   else null end;
  old_bank text := case when TG_OP='UPDATE' then OLD.payout_details->>'bank_doc' else null end;
  submitted  boolean := (NEW.status='under_review' and (TG_OP='INSERT' or OLD.status is distinct from 'under_review'));
  id_resub   boolean := (new_id   is not null and new_id   is distinct from old_id   and coalesce(NEW.status,'draft') <> 'draft');
  bank_resub boolean := (new_bank is not null and new_bank is distinct from old_bank and coalesce(NEW.status,'draft') <> 'draft');
begin
  if not (submitted or id_resub or bank_resub) then return NEW; end if;
  select email into v_email from auth.users where id = NEW.user_id;
  v_name := coalesce(nullif(trim(NEW.full_name),''), 'An agent');
  if submitted then
    v_kind := 'submitted their agent onboarding for review';
    v_title := '🤝 Agent verification requested';
    v_reason_tag := 'sub';
  else
    v_kind := 'uploaded a corrected ' ||
      case when id_resub and bank_resub then 'government ID and bank proof'
           when id_resub then 'government ID' else 'bank proof' end ||
      ' — ready to re-review';
    v_title := '📎 Agent re-uploaded a document — re-review';
    v_reason_tag := case when id_resub and bank_resub then 'idbank' when id_resub then 'id' else 'bank' end;
  end if;
  if not submitted then
    begin
      insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
      values ('staff','in_app','agent.review_requested',
        jsonb_build_object('user', NEW.user_id, 'title', v_title,
          'body', v_name || ' ' || v_kind || '. Open the Agents tab to review.',
          'tone','info','url','/agents'),
        'sent', now());
    exception when others then null; end;
  end if;
  begin
    perform app_private.sys_email('hello@loadboot.com', 'agent.owner_alert',
      'LoadBoot Agent — ' || v_name || ': ' || case when submitted then 'new submission to review' else 'document re-uploaded' end,
      '<div style="font-family:Inter,Arial,sans-serif;color:#0f172a"><h2 style="margin:0 0 8px">Agent action needs review</h2>'
      || '<p style="margin:0 0 6px"><b>' || v_name || '</b>' || case when v_email is not null then ' (' || v_email || ')' else '' end || ' ' || v_kind || '.</p>'
      || '<p style="margin:14px 0"><a href="https://loadboot.com/app/command-center/#/agents" style="background:#FC5305;color:#fff;padding:11px 20px;border-radius:9px;text-decoration:none;font-weight:800">Open Agents tab &rarr;</a></p>'
      || '<p style="color:#64748b;font-size:12px;margin:0">LoadBoot Command Center &middot; agent verification</p></div>',
      null,
      'agentalert:' || NEW.user_id::text || ':' || v_reason_tag || ':' || to_char(now(),'YYYYMMDDHH24MI'));
  exception when others then null; end;
  return NEW;
end $$;

-- Data fixes: correct urls on existing notifications; create tasks for existing screening applications
update app_private.notifications
   set payload = jsonb_set(payload, '{url}', '"/dispatchers"')
 where template_key = 'dispatcher.applied' and payload->>'url' like '/app/command-center%';
update app_private.notifications
   set payload = jsonb_set(payload, '{url}', '"/agents"')
 where template_key = 'agent.review_requested' and payload->>'url' like '/app/command-center%';
insert into app_private.automation_tasks (task_type, title, description, priority, assignee_role, related_type, related_id, source_rule)
select 'dispatcher_review', 'Review new dispatcher application',
  '📌 ' || coalesce(d.full_name,'A candidate') || E'\n👉 Screen the application (experience, English, load boards, CV), then move them through screening → skills test → paid trial in Dispatchers.',
  'urgent', 'operations_admin', 'dispatcher', d.user_id::text, 'dispatcher_applied'
from app_private.dispatcher_profiles d
where d.status = 'screening'
  and not exists (select 1 from app_private.automation_tasks t
                  where t.task_type='dispatcher_review' and t.related_id = d.user_id::text and t.status='open');
