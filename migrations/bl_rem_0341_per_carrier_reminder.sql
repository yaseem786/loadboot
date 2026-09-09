-- bl_rem_0341_per_carrier_reminder
--
-- Carrier 360 had a "Send first-truck reminder" button and nothing else. No driver
-- button, no availability button — because that button was written for one specific
-- gap rather than for the funnel. A carrier sitting on "truck on file, no driver"
-- had no button at all.
--
-- This exposes the engine one carrier at a time, so the SAME decision tree that
-- drives the list screen and the nightly job also answers "what does THIS carrier
-- need, and send it". One brain, three doors.
--
-- reminder_dispatch gains a p_org filter rather than growing a second copy of the
-- send logic — a per-carrier send that could drift from the bulk send is exactly
-- how two systems start disagreeing about what a carrier owes.
--
-- NOTE at the end: "create or replace" with a new argument list creates an OVERLOAD,
-- it does not replace. The old 4-argument reminder_dispatch therefore has to be
-- dropped explicitly, or every existing 4-argument caller keeps resolving to it as
-- the exact match and quietly runs the old body. Caught on staging.

create or replace function app_private.reminder_dispatch(
  p_keys text[] default null,
  p_dry_run boolean default true,
  p_ignore_cadence boolean default false,
  p_by uuid default null,
  p_org uuid default null                      -- null = every carrier (bulk / nightly)
) returns jsonb
language plpgsql
security definer
set search_path to 'app_private, public'
as $function$
declare r record; v_key text; v_tpl record; v_id uuid; v_q int := 0; v_skip int := 0; v_rows jsonb := '[]'::jsonb;
        v_html text; v_text text; v_list text; v_st jsonb;
begin
  for r in select * from app_private.reminder_recipients() t
            where p_org is null or t.org = p_org loop
    v_key := app_private.reminder_for_carrier(r.org);
    if v_key is null then continue; end if;
    if p_keys is not null and not (v_key = any(p_keys)) then continue; end if;
    if not r.opted_in then v_skip := v_skip + 1; continue; end if;
    if r.suppressed then v_skip := v_skip + 1; continue; end if;
    if not p_ignore_cadence and not app_private.reminder_due(r.org, v_key) then v_skip := v_skip + 1; continue; end if;

    select * into v_tpl from app_private.comm_templates where key = 'carrier.reminder.' || v_key;
    if v_tpl.key is null then v_skip := v_skip + 1; continue; end if;

    v_html := v_tpl.body;
    if v_key in ('docs_start', 'docs_finish', 'docs_fix') then
      v_list := coalesce(app_private.reminder_doc_list(r.org), 'your remaining verification documents');
      v_st   := app_private.carrier_onboarding_state(r.org);
      v_html := replace(v_html, '{{MISSING_LIST}}', v_list);
      v_html := replace(v_html, '{{DOC_PROGRESS}}',
                  coalesce(v_st->>'verified_count','0') || ' of ' || coalesce(v_st->>'required_count','0') || ' verified');
    end if;
    v_html := regexp_replace(v_html, '\{\{[A-Za-z0-9_]+\}\}', '', 'g');
    v_text := coalesce(v_tpl.body_text, app_private.html_to_text(v_html));
    if v_tpl.body_text is null then v_text := app_private.html_to_text(v_html); end if;

    v_rows := v_rows || jsonb_build_object('company', r.company, 'email', r.email, 'reminder', v_key);
    if p_dry_run then continue; end if;

    insert into app_private.message_deliveries(org_id, source, template_key, channel, provider,
        recipient_user, recipient_email, idempotency_key, status, scheduled_at, meta)
    values (r.org, 'campaign', v_tpl.key, 'email', 'resend', r.uid, r.email,
        'rem:' || v_key || ':' || r.org::text || ':' || to_char(now() at time zone 'UTC','YYYYMMDD'),
        'queued', now(),
        jsonb_build_object('subject', v_tpl.subject, 'body_html', v_html, 'body_text', v_text,
                           'category', 'dispatch'))
    on conflict (idempotency_key) do nothing
    returning id into v_id;

    if v_id is null then v_skip := v_skip + 1; continue; end if;
    insert into app_private.reminder_log(carrier_id, reminder_key, delivery_id, sent_by)
      values (r.org, v_key, v_id, p_by);
    v_q := v_q + 1;
  end loop;

  return jsonb_build_object('dry_run', p_dry_run, 'queued', v_q, 'skipped', v_skip, 'rows', v_rows);
end $function$;

revoke execute on function app_private.reminder_dispatch(text[], boolean, boolean, uuid, uuid) from anon, public, authenticated;

-- ---------------------------------------------------------------------------
-- What does THIS carrier need? Read-only, for the Carrier 360 card.
-- Gated on carriers.view because it is part of the carrier record, and it reports
-- separately whether the viewer is allowed to actually send.
-- ---------------------------------------------------------------------------
create or replace function public.cc_reminder_carrier(p_org uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'app_private, public'
as $function$
declare v_key text; v_r record; v_tpl record; v_st jsonb; v_out jsonb;
begin
  if not public.has_global_permission('carriers.view') then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select * into v_r from app_private.reminder_recipients() t where t.org = p_org;
  v_key := app_private.reminder_for_carrier(p_org);
  v_st  := app_private.carrier_onboarding_state(p_org);

  if v_key is not null then
    select * into v_tpl from app_private.comm_templates where key = 'carrier.reminder.' || v_key;
  end if;

  v_out := jsonb_build_object(
    'reminder',       v_key,
    'onboarding',     v_st->>'state',
    'subject',        v_tpl.subject,
    'template_ready', (v_tpl.key is not null),
    'missing',        app_private.reminder_doc_list(p_org),
    'email',          v_r.email,
    'opted_in',       coalesce(v_r.opted_in, false),
    'suppressed',     coalesce(v_r.suppressed, false),
    'reachable',      (v_r.email is not null),
    'due',            case when v_key is null then null else app_private.reminder_due(p_org, v_key) end,
    'last_sent',      (select max(sent_at) from app_private.reminder_log l
                        where l.carrier_id = p_org and (v_key is null or l.reminder_key = v_key)),
    'sent_before',    (select count(*) from app_private.reminder_log l
                        where l.carrier_id = p_org and (v_key is null or l.reminder_key = v_key)),
    'can_send',       app_private.can_manage_comms()
  );
  return v_out;
end $function$;

-- ---------------------------------------------------------------------------
-- Send this one carrier the email the tree picked. Same engine as the bulk send,
-- so opt-out, suppression, the one-per-day idempotency key and the missing-template
-- skip all apply identically.
--
-- p_ignore_cadence is offered here and NOT on the nightly job on purpose: a person
-- looking at one carrier's record may have a reason to push again today. A robot
-- never does.
-- ---------------------------------------------------------------------------
create or replace function public.cc_reminder_send_carrier(
  p_org uuid,
  p_ignore_cadence boolean default false
) returns jsonb
language plpgsql
security definer
set search_path to 'app_private, public'
as $function$
declare v_res jsonb; v_by uuid;
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode='42501'; end if;
  v_by := auth.uid();
  v_res := app_private.reminder_dispatch(null, false, coalesce(p_ignore_cadence,false), v_by, p_org);
  perform app_private.log_audit('reminder.send.one','carrier', p_org::text, null,
    format('queued %s reminder(s) for this carrier, skipped %s', v_res->>'queued', v_res->>'skipped'),
    jsonb_build_object('ignore_cadence', coalesce(p_ignore_cadence,false), 'manual', true));
  return v_res;
end $function$;

revoke execute on function public.cc_reminder_carrier(uuid)               from anon, public;
revoke execute on function public.cc_reminder_send_carrier(uuid, boolean) from anon, public;
grant  execute on function public.cc_reminder_carrier(uuid)               to authenticated;
grant  execute on function public.cc_reminder_send_carrier(uuid, boolean) to authenticated;

-- Must come last: leaves exactly one reminder_dispatch, so cc_reminder_send and
-- reminder_cron (both 4-argument callers) fall through to the version above.
drop function if exists app_private.reminder_dispatch(text[], boolean, boolean, uuid);
