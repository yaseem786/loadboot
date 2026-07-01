-- cvo_comm_triggers.sql
-- Event-triggered transactional automations — the "trigger" link in Campaign/trigger. An admin maps a domain
-- event (e.g. form.submitted) to a template; when that event fires, an acknowledgement is enqueued on the SAME
-- unified ledger (suppression-checked, idempotent per event+trigger). No-op until an admin activates a trigger.
--
-- Wiring: an AFTER INSERT trigger on form_submissions fires 'form.submitted'. fire_comm_trigger is an internal
-- app_private helper (never granted to anyone) called by the DB trigger; management RPCs are staff-gated public.
-- Anon SECURITY DEFINER surface unchanged (5).
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

create table if not exists app_private.comm_triggers (
  id           uuid primary key default gen_random_uuid(),
  event_type   text not null,
  channel      text not null default 'email',
  template_key text,
  subject      text,
  active       boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (event_type, channel)
);

-- Internal: enqueue transactional messages for every active trigger matching an event. Idempotent per
-- (trigger, ref). Suppression-enforced. Renders the template's subject/body with the supplied vars.
create or replace function app_private.fire_comm_trigger(p_event text, p_email text, p_ref text, p_vars jsonb default '{}'::jsonb)
returns integer language plpgsql security definer set search_path to 'app_private, public'
as $$
declare t record; v_subj text; v_html text; v_text text; v_key text; v_n int:=0; v_ins int; k text; val text;
begin
  if p_email is null or p_email !~ '^[^@]+@[^@]+\.[^@]+$' then return 0; end if;
  if exists (select 1 from app_private.suppressions where channel='email' and address=lower(p_email)) then return 0; end if;
  for t in select * from app_private.comm_triggers where event_type=p_event and channel='email' and active loop
    select tpl.subject, tpl.body, tpl.body_text into v_subj, v_html, v_text
      from app_private.comm_templates tpl where tpl.key=t.template_key;
    v_subj := coalesce(nullif(t.subject,''), v_subj, 'LoadBoot');
    v_html := coalesce(v_html, ''); v_text := coalesce(v_text, v_subj);
    for k, val in select key, value from jsonb_each_text(coalesce(p_vars,'{}'::jsonb)) loop
      v_subj := replace(v_subj, '{{'||k||'}}', val);
      v_html := replace(v_html, '{{'||k||'}}', val);
      v_text := replace(v_text, '{{'||k||'}}', val);
    end loop;
    v_key := 'trigger:'||t.id::text||':'||p_ref;
    insert into app_private.message_deliveries(source,channel,provider,recipient_email,idempotency_key,status,template_key,meta)
    values ('transactional','email','resend',lower(p_email),v_key,'queued',t.template_key,
      jsonb_build_object('subject',v_subj,'body_html',v_html,'body_text',v_text,'trigger',t.event_type))
    on conflict (idempotency_key) do nothing;
    get diagnostics v_ins = row_count; v_n := v_n + v_ins;
  end loop;
  return v_n;
end; $$;
-- internal only: no grants (app_private is deny-by-default; the DB trigger runs as owner)

-- AFTER INSERT on form_submissions → fire the form.submitted automation.
create or replace function app_private.tg_form_submission_comm() returns trigger
language plpgsql security definer set search_path to 'app_private, public'
as $$
begin
  if NEW.email is not null and coalesce(NEW.spam_score,0) < 80 then
    perform app_private.fire_comm_trigger('form.submitted', NEW.email, NEW.id::text,
      jsonb_build_object('first_name', split_part(coalesce(NEW.name,''),' ',1)));
  end if;
  return NEW;
end; $$;
drop trigger if exists form_submission_comm_trigger on app_private.form_submissions;
create trigger form_submission_comm_trigger after insert on app_private.form_submissions
  for each row execute function app_private.tg_form_submission_comm();

-- Staff management: list + upsert triggers.
create or replace function public.cc_comm_triggers()
returns table(id uuid, event_type text, channel text, template_key text, subject text, active boolean)
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode='42501'; end if;
  return query select x.id, x.event_type, x.channel, x.template_key, x.subject, x.active
    from app_private.comm_triggers x order by x.event_type, x.channel;
end; $$;
revoke execute on function public.cc_comm_triggers() from anon, public;
grant  execute on function public.cc_comm_triggers() to authenticated;

create or replace function public.cc_set_comm_trigger(p_event text, p_channel text default 'email',
  p_template_key text default null, p_subject text default null, p_active boolean default false)
returns uuid language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_id uuid;
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode='42501'; end if;
  if p_channel not in ('email','sms') then raise exception 'invalid channel' using errcode='22023'; end if;
  insert into app_private.comm_triggers(event_type,channel,template_key,subject,active)
  values (p_event,p_channel,p_template_key,p_subject,coalesce(p_active,false))
  on conflict (event_type,channel) do update set template_key=excluded.template_key, subject=excluded.subject, active=excluded.active
  returning id into v_id;
  perform app_private.log_audit('comm.trigger.set','comm_trigger',p_event,null,'trigger '||(case when p_active then 'activated' else 'saved' end),jsonb_build_object('template',p_template_key));
  return v_id;
end; $$;
revoke execute on function public.cc_set_comm_trigger(text, text, text, text, boolean) from anon, public;
grant  execute on function public.cc_set_comm_trigger(text, text, text, text, boolean) to authenticated;
