-- bl_voice_0183 — everything Riley learns on a call now lands in CC automatically.
-- Applied to production 2026-08-01 (this file is the repo record of that change).
--
-- Before this, retell_webhook stored transcript/summary/sentiment/recording only. The
-- Post-Call Data Extraction fields configured in Retell (caller_type, company_name,
-- mc_number, equipment_type, truck_count, preferred_lanes, interest_level) arrive in
-- call.call_analysis.custom_analysis_data and were being thrown away, and no call ever
-- created a CRM lead — a hot carrier could call, qualify himself completely, and leave
-- no trace anywhere except a transcript nobody opens.
--
-- Now, on call_analyzed:
--   * custom_analysis_data is merged into lc_calls.analysis (new jsonb column)
--   * caller_type overwrites contact_role
--   * a crm_contact (deduped on last 10 digits) + crm_lead + crm_activity are created,
--     staged qualified / contacted / new by interest_level
--   * interest_level = hot also opens an automation_task due in 2 hours
--   * staff get an in-app notification pointing at /crm
--   * lc_calls.lead_id guards the whole block so repeated webhooks cannot duplicate
--   * calls under 20s, not_interested and wrong_number never create a lead
--   * if extraction fails entirely, a 60s+ call still creates a lead so nothing is lost

alter table app_private.lc_calls
  add column if not exists analysis jsonb,
  add column if not exists lead_id uuid;

create or replace function public.retell_webhook(jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'app_private, public'
as $function$
declare payload jsonb := $1; event text; call jsonb;
        cfg app_private.retell_config; v_id text; v_dir text; v_dur int; v_exists bigint;
        v_an jsonb; rec app_private.lc_calls;
        v_pipe uuid; v_stage uuid; v_stage_key text; v_contact uuid; v_lead uuid;
        v_last10 text; v_phone text; v_name text; v_title text;
        v_interest text; v_ctype text;
begin
  event := payload->>'event';
  call := payload->'call';
  select * into cfg from app_private.retell_config where id = 1;
  if call is null or cfg.from_number is null
     or (call->>'from_number' is distinct from cfg.from_number and call->>'to_number' is distinct from cfg.from_number)
    then return jsonb_build_object('ok', true, 'ignored', true); end if;
  v_id := call->>'call_id';
  if v_id is null then return jsonb_build_object('ok', true, 'ignored', true); end if;
  v_dir := coalesce(call->>'direction', case when call->>'from_number' = cfg.from_number then 'outbound' else 'inbound' end);
  v_dur := case when (call->>'end_timestamp') is not null and (call->>'start_timestamp') is not null
    then greatest(0, (((call->>'end_timestamp')::bigint - (call->>'start_timestamp')::bigint) / 1000))::int else null end;

  select id into v_exists from app_private.lc_calls
    where call_id is null and status in ('dialing','scheduled') and to_number = call->>'to_number'
      and created_at > now() - interval '48 hours'
    order by created_at desc limit 1;
  if v_exists is not null then
    update app_private.lc_calls set call_id = v_id where id = v_exists;
  end if;

  insert into app_private.lc_calls (call_id, direction, from_number, to_number, status)
  values (v_id, v_dir, call->>'from_number', call->>'to_number',
          case event when 'call_started' then 'in-progress' when 'call_ended' then 'ended' else 'analyzed' end)
  on conflict (call_id) do update set
    status = case event when 'call_started' then 'in-progress' when 'call_ended' then 'ended' when 'call_analyzed' then 'analyzed' else app_private.lc_calls.status end,
    updated_at = now();

  v_an := call->'call_analysis'->'custom_analysis_data';
  if v_an is null or jsonb_typeof(v_an) <> 'object' then v_an := null; end if;

  update app_private.lc_calls set
    duration_sec = coalesce(v_dur, duration_sec),
    transcript = coalesce(nullif(call->>'transcript',''), transcript),
    summary = coalesce(nullif(call->'call_analysis'->>'call_summary',''), summary),
    sentiment = coalesce(nullif(call->'call_analysis'->>'user_sentiment',''), sentiment),
    recording_url = coalesce(nullif(call->>'recording_url',''), recording_url),
    analysis = case when v_an is null then analysis else coalesce(analysis,'{}'::jsonb) || v_an end,
    contact_role = coalesce(nullif(v_an->>'caller_type',''), contact_role),
    contact_name = coalesce(contact_name, nullif(nullif(call->'retell_llm_dynamic_variables'->>'name','there'),'the owner')),
    status = case when coalesce(v_dur,0) = 0 and event in ('call_ended','call_analyzed') then 'no-answer' else status end
  where call_id = v_id;

  if event = 'call_ended' and coalesce(v_dur,0) > 0 then
    begin
      insert into app_private.notifications (recipient_role, channel, template_key, payload, status, sent_at)
      values ('staff','in_app','voice.call_ended',
        jsonb_build_object('title','📞 ' || initcap(v_dir) || ' call ended',
          'body', coalesce(call->>'to_number','') || ' · ' || v_dur || 's — transcript + audio in CC → Live chat',
          'tone','info','url','/live-chat'), 'sent', now());
    exception when others then null; end;
  end if;

  -- Turn a real conversation into a CRM lead. Only on call_analyzed, so the extracted
  -- fields exist; only once, guarded by lc_calls.lead_id.
  if event = 'call_analyzed' then
    select * into rec from app_private.lc_calls where call_id = v_id;
    v_interest := coalesce(rec.analysis->>'interest_level','');
    v_ctype    := coalesce(rec.analysis->>'caller_type','');

    if rec.lead_id is null
       and coalesce(rec.duration_sec,0) >= 20
       and v_interest not in ('not_interested','wrong_number')
       and (v_interest in ('hot','warm','cold')
            or (rec.analysis is null and coalesce(rec.duration_sec,0) >= 60))
    then
      v_phone  := case when rec.direction = 'inbound' then rec.from_number else rec.to_number end;
      v_last10 := right(regexp_replace(coalesce(v_phone,''), '[^0-9]', '', 'g'), 10);
      v_name   := coalesce(nullif(rec.contact_name,''), nullif(rec.analysis->>'company_name',''), 'Caller ' || v_last10);
      v_title  := '📞 ' || initcap(coalesce(rec.direction,'call')) || ' call — ' || v_name
                  || coalesce(' · ' || nullif(v_ctype,''), '')
                  || coalesce(' · ' || nullif(rec.analysis->>'equipment_type',''), '')
                  || coalesce(' · ' || nullif(rec.analysis->>'truck_count','') || ' truck(s)', '')
                  || coalesce(' · ' || upper(nullif(v_interest,'')), '');

      begin
        select id into v_pipe from app_private.crm_pipelines where key = 'sales';
        v_stage_key := case v_interest when 'hot' then 'qualified' when 'warm' then 'contacted' else 'new' end;
        select id into v_stage from app_private.crm_stages where pipeline_id = v_pipe and key = v_stage_key;

        select id into v_contact from app_private.crm_contacts
          where length(v_last10) = 10
            and right(regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g'), 10) = v_last10
          order by created_at desc limit 1;
        if v_contact is null then
          insert into app_private.crm_contacts (name, phone, title)
          values (left(v_name,200), v_phone, nullif(v_ctype,''))
          returning id into v_contact;
        end if;

        insert into app_private.crm_leads (title, contact_id, pipeline_id, stage_id, source)
        values (left(v_title,300), v_contact, v_pipe, v_stage, 'voice-call')
        returning id into v_lead;

        update app_private.lc_calls set lead_id = v_lead where call_id = v_id;

        insert into app_private.crm_activities (lead_id, kind, body)
        values (v_lead, 'call',
          'Riley voice call · ' || coalesce(rec.duration_sec,0) || 's · sentiment ' || coalesce(rec.sentiment,'n/a')
          || coalesce(E'\nPhone: ' || nullif(v_phone,''), '')
          || coalesce(E'\nMC/DOT: ' || nullif(rec.analysis->>'mc_number',''), '')
          || coalesce(E'\nEquipment: ' || nullif(rec.analysis->>'equipment_type',''), '')
          || coalesce(E'\nTrucks: ' || nullif(rec.analysis->>'truck_count',''), '')
          || coalesce(E'\nLanes: ' || nullif(rec.analysis->>'preferred_lanes',''), '')
          || coalesce(E'\n\nSummary: ' || nullif(rec.summary,''), '')
          || coalesce(E'\n\nRecording: ' || nullif(rec.recording_url,''), ''));
      exception when others then null; end;

      if v_interest = 'hot' then
        begin
          insert into app_private.automation_tasks
            (task_type, title, description, status, priority, assignee_role, related_type, related_id, due_at, source_rule)
          values ('followup', left('🔥 Call back ' || v_name || ' — hot lead from a phone call', 200),
            coalesce(rec.summary,'')
              || coalesce(E'\nPhone: ' || nullif(v_phone,''), '')
              || coalesce(E'\nMC/DOT: ' || nullif(rec.analysis->>'mc_number',''), ''),
            'open', 'high', 'staff', 'lc_call', v_id, now() + interval '2 hours', 'voice.hot_lead');
        exception when others then null; end;
      end if;

      begin
        insert into app_private.notifications (recipient_role, channel, template_key, payload, status, sent_at)
        values ('staff','in_app','voice.lead',
          jsonb_build_object(
            'title', case when v_interest = 'hot' then '🔥 HOT lead from a phone call' else '🎯 New lead from a phone call' end,
            'body', v_title,
            'tone', case when v_interest = 'hot' then 'success' else 'info' end,
            'url','/crm'), 'sent', now());
      exception when others then null; end;
    end if;
  end if;

  return jsonb_build_object('ok', true);
end $function$;

-- Surface the new fields in CC.
create or replace function public.cc_lc_calls()
 returns jsonb
 language sql
 stable security definer
 set search_path to 'app_private, public'
as $function$
  select case when not (public.has_global_permission('comm.view') or public.has_global_permission('support.view') or public.has_global_permission('dispatch.manage'))
    then jsonb_build_object('error','not authorized')
    else coalesce((select jsonb_agg(jsonb_build_object(
      'id', c.id, 'call_id', c.call_id, 'direction', c.direction, 'to_number', c.to_number,
      'from_number', c.from_number, 'name', c.contact_name, 'topic', c.topic, 'role', c.contact_role,
      'status', c.status, 'duration_sec', c.duration_sec, 'summary', c.summary,
      'transcript', c.transcript, 'sentiment', c.sentiment, 'at', c.created_at,
      'scheduled_at', c.scheduled_at, 'context', c.context, 'source', c.source,
      'recording_url', c.recording_url, 'analysis', c.analysis, 'lead_id', c.lead_id) order by c.created_at desc)
      from (select * from app_private.lc_calls order by created_at desc limit 50) c), '[]'::jsonb) end;
$function$;
