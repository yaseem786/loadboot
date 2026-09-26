-- bl_voice_0458c — the WhatsApp-line legs carry the recording too.
-- Owner ask (26 Sep, after the first real call): "the Telnyx legs table should let me play the recording".
-- Riley (Retell) records the conversation and the recording lands in lc_calls via the Retell webhooks; the
-- Telnyx leg is the same call seen from the other side. Join them: same caller number, Retell call created
-- within 20 s before / 120 s after the Telnyx leg started. cc_riley_calls.wa_legs now carries lc_call_id,
-- recording_url, transcript length, summary and analysis for the matched call.
-- Also verified by that call: the caller id passes through the transfer (from = the caller, not the 815 line).
-- STAGING + prod. Idempotent (create or replace).

create or replace function public.cc_riley_calls(p_limit int default 120)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'app_private', 'public'
as $function$
  select case when not (public.has_global_permission('comm.view') or public.has_global_permission('comm.manage')
                     or public.has_global_permission('support.view') or public.has_global_permission('dispatch.manage')
                     or public.has_global_permission('settings.manage'))
    then jsonb_build_object('error','not authorized')
    else jsonb_build_object(
      'calls', coalesce((select jsonb_agg(jsonb_build_object(
          'id', c.id, 'call_id', c.call_id, 'direction', c.direction, 'from_number', c.from_number, 'to_number', c.to_number,
          'name', c.contact_name, 'role', c.contact_role, 'topic', c.topic, 'status', c.status, 'duration_sec', c.duration_sec,
          'summary', c.summary, 'sentiment', c.sentiment, 'at', c.created_at, 'updated_at', c.updated_at, 'scheduled_at', c.scheduled_at,
          'source', c.source, 'context', c.context, 'recording_url', c.recording_url, 'transcript', c.transcript,
          'analysis', c.analysis, 'lead_id', c.lead_id, 'org_id', c.org_id) order by c.created_at desc)
        from (select * from app_private.lc_calls order by created_at desc limit greatest(1, least(coalesce(p_limit,120), 500))) c), '[]'::jsonb),
      'wa_legs', coalesce((select jsonb_agg(jsonb_build_object(
          'id', d.id, 'from_number', d.from_number, 'status', d.status, 'started_at', d.started_at, 'answered_at', d.answered_at,
          'ended_at', d.ended_at, 'duration_sec', d.duration_sec, 'hangup_cause', d.hangup_cause, 'contact_name', d.contact_name,
          'lc_call_id', r.id, 'recording_url', r.recording_url, 'transcript_chars', length(r.transcript), 'summary', r.summary,
          'analysis', r.analysis, 'riley_status', r.status, 'riley_name', r.contact_name) order by d.started_at desc)
        from (select * from app_private.dialer_calls where source = 'riley' order by started_at desc limit 60) d
        left join lateral (
          select l.id, l.recording_url, l.transcript, l.summary, l.analysis, l.status, l.contact_name
            from app_private.lc_calls l
           where l.direction = 'inbound'
             and right(regexp_replace(coalesce(l.from_number,''), '[^0-9]', '', 'g'), 10) = right(regexp_replace(coalesce(d.from_number,''), '[^0-9]', '', 'g'), 10)
             and l.created_at between d.started_at - interval '20 seconds' and d.started_at + interval '120 seconds'
           order by abs(extract(epoch from (l.created_at - d.started_at))) limit 1) r on true), '[]'::jsonb),
      'wa_callbacks', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'number', k.number, 'reason', k.reason, 'status', k.status,
          'created_at', k.created_at, 'call_id', k.call_id) order by k.created_at desc)
        from (select * from app_private.dialer_callbacks where dispatcher_user_id is null and status = 'open' order by created_at desc limit 40) k), '[]'::jsonb),
      'stats', (select jsonb_build_object(
          'live', count(*) filter (where status in ('in-progress','dialing')),
          'today', count(*) filter (where created_at >= date_trunc('day', now() at time zone 'America/Chicago') at time zone 'America/Chicago'),
          'today_min', coalesce(round(sum(duration_sec) filter (where created_at >= date_trunc('day', now() at time zone 'America/Chicago') at time zone 'America/Chicago') / 60.0, 1), 0),
          'week', count(*) filter (where created_at >= now() - interval '7 days'),
          'week_min', coalesce(round(sum(duration_sec) filter (where created_at >= now() - interval '7 days') / 60.0, 1), 0),
          'answered_week', count(*) filter (where created_at >= now() - interval '7 days' and coalesce(duration_sec,0) > 0),
          'hot_week', count(*) filter (where created_at >= now() - interval '7 days' and analysis->>'interest_level' = 'hot'))
        from app_private.lc_calls)) end;
$function$;
revoke execute on function public.cc_riley_calls(int) from public, anon;
grant  execute on function public.cc_riley_calls(int) to authenticated;
