-- bl_voice_0302_lead_safety_net
-- 29 Aug 2026
--
-- WHAT WAS WRONG
-- Lead creation lived entirely inside `if event = 'call_analyzed'`. Measured on
-- production lc_calls: 19 of 59 answered calls (32%) are still sitting at status
-- 'ended' and never received a call_analyzed event at all. For every one of those
-- calls no CRM lead, no contact, no follow-up task was ever created — the call simply
-- vanished after the transcript was stored.
--
-- That is how the 28 Aug inbound lead was lost. +1 786 269-4953 called, said in so
-- many words "I'm trying to find a dispatcher", talked for 47 seconds, then rang three
-- more times. lc_calls row 269: status 'ended', lead_id null. Nobody was ever told.
--
-- Two smaller faults in the same statement:
--   * transcript used coalesce(new, old), so a later event carrying a SHORTER or
--     partial transcript would overwrite a fuller one already stored.
--   * the no-analysis fallback tested `rec.analysis is null`. Once any analysis object
--     exists — even one without an interest_level — both the interest path and the
--     fallback path fail, and the lead is dropped. 30 of the 40 analyzed rows carry no
--     custom_analysis_data, so this is the common case, not the edge case.
--
-- WHAT THIS CHANGES
--   1. The lead block now runs on call_ended as well as call_analyzed. It is already
--      idempotent (guarded by lc_calls.lead_id), so when call_analyzed does arrive
--      later it finds the lead already there and does nothing.
--   2. transcript keeps whichever version is LONGER.
--   3. the fallback triggers whenever interest_level is unknown, not only when the
--      whole analysis object is null.
--   4. JUDGEMENT CALL, flagged for review: with no interest_level, the duration floor
--      is 30s for INBOUND and stays 60s for outbound. Someone who rang us has already
--      self-selected; someone we rang has not. The 47-second call above clears 30 and
--      fails 60. If this proves noisy, raise LEAD_MIN_INBOUND back towards 60 — it is
--      the single `case when rec.direction='inbound' then 30 else 60 end` below.
--
-- NOT fixed here, because it is not in the database: the missing call_analyzed events
-- themselves. Check the Retell webhook subscription actually has call_analyzed enabled,
-- and that post-call analysis fields are configured — only 10 of 40 analyzed rows carry
-- custom_analysis_data, which is why interest_level is usually absent in the first place.
--
-- Reversible: restore `if event = 'call_analyzed' then`, the coalesce() transcript
-- assignment, and `rec.analysis is null`.

CREATE OR REPLACE FUNCTION public.retell_webhook(jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
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
    -- bl_voice_0302: keep the LONGER transcript. A later event carrying a partial one
    -- must never shorten what is already stored.
    transcript = case when length(coalesce(nullif(call->>'transcript',''), '')) > length(coalesce(transcript, ''))
                      then call->>'transcript' else transcript end,
    summary = coalesce(nullif(call->'call_analysis'->>'call_summary',''), summary),
    sentiment = coalesce(nullif(call->'call_analysis'->>'user_sentiment',''), sentiment),
    recording_url = coalesce(nullif(call->>'recording_url',''), recording_url),
    analysis = case when v_an is null then analysis else coalesce(analysis,'{}'::jsonb) || v_an end,
    contact_role = coalesce(nullif(v_an->>'caller_type',''), contact_role),
    contact_name = coalesce(nullif(nullif(contact_name,'there'),''), nullif(v_an->>'caller_name',''), nullif(nullif(call->'retell_llm_dynamic_variables'->>'name','there'),'the owner')),
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

  -- Turn a real conversation into a CRM lead. bl_voice_0302: this now runs on call_ended
  -- TOO, because a third of answered calls never get a call_analyzed event and were
  -- being dropped in silence. Still guarded by lc_calls.lead_id, so whichever event
  -- arrives first creates the lead and the other one finds it already there.
  if event in ('call_ended','call_analyzed') then
    select * into rec from app_private.lc_calls where call_id = v_id;
    v_interest := coalesce(rec.analysis->>'interest_level','');
    v_ctype    := coalesce(rec.analysis->>'caller_type','');

    if rec.lead_id is null
       and coalesce(rec.duration_sec,0) >= 20
       and v_interest not in ('not_interested','wrong_number')
       and (v_interest in ('hot','warm','cold')
            or (nullif(rec.analysis->>'interest_level','') is null
                and coalesce(rec.duration_sec,0) >= (case when rec.direction = 'inbound' then 30 else 60 end)))
    then
      v_phone  := case when rec.direction = 'inbound' then rec.from_number else rec.to_number end;
      v_last10 := right(regexp_replace(coalesce(v_phone,''), '[^0-9]', '', 'g'), 10);
      v_name   := coalesce(nullif(rec.contact_name,''), nullif(rec.analysis->>'caller_name',''), nullif(rec.analysis->>'company_name',''), 'Caller ' || v_last10);
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
          insert into app_private.crm_contacts (name, phone, title, email)
          values (left(v_name,200), v_phone, nullif(v_ctype,''), nullif(rec.analysis->>'contact_email',''))
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
          || coalesce(E'\nEmail: ' || nullif(rec.analysis->>'contact_email',''), '')
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
              || coalesce(E'\nEmail: ' || nullif(rec.analysis->>'contact_email',''), '')
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
