-- bl_disp_0591 — the intro call says exactly what happened, in the thread, every time (owner, 2 Nov 2026)
-- Before: trg_disp_intro_call (bl_disp_0555) counted the intro as DONE the moment Telnyx reported answered_at — so a
-- voicemail pickup (Sprint Shift, 48s, tagged "voicemail left") and a 16-second "no answer" (The Way Home) both posted
-- "📞 Intro call done" and the dispatcher stopped calling. A call nobody picked up posted nothing at all.
-- Now:
--   * dialer_calls.intro_result = connected | short | voicemail | no_answer | busy | declined | bad_number
--     (decided when the call ends, re-decided when the dispatcher tags the outcome)
--   * ONLY "connected" counts as the intro (answered and tagged as a real conversation, or answered >= 30 s untagged).
--     A later "no answer"/"voicemail left" tag takes the intro back.
--   * Every attempt posts one system line in the carrier thread with the exact status and time (ET); the intro stays
--     "pending" until a connected call — so neither side mistakes an attempt for the intro.

alter table app_private.dialer_calls add column if not exists intro_result text;
comment on column app_private.dialer_calls.intro_result is
  'bl_disp_0591: outcome of a reason=intro call: connected|short|voicemail|no_answer|busy|declined|bad_number. Only connected counts as the intro.';

create or replace function app_private.intro_call_result(c app_private.dialer_calls)
returns text language sql stable set search_path to 'app_private', 'public' as $function$
  select case
    when c.ended_at is null and coalesce(c.status, '') not in ('ended', 'canceled', 'failed', 'busy', 'no_answer', 'missed', 'voicemail') then null
    when c.outcome = 'voicemail left' or c.status = 'voicemail' then 'voicemail'
    when c.outcome = 'no answer' then 'no_answer'
    when c.answered_at is null then case
      when c.status = 'busy' or c.hangup_cause ilike 'user_busy' then 'busy'
      when c.hangup_cause ilike 'call_rejected' then 'declined'
      when c.hangup_cause ilike any (array['not_found', 'unallocated_number', 'invalid_number_format']) then 'bad_number'
      else 'no_answer' end
    when c.outcome is not null then 'connected'
    when coalesce(c.duration_sec, extract(epoch from (c.ended_at - c.answered_at))::int, 0) >= 30 then 'connected'
    else 'short' end;
$function$;

create or replace function app_private.trg_disp_intro_call()
returns trigger language plpgsql security definer set search_path to 'app_private', 'public' as $function$
declare
  r text; v_prev text := new.intro_result; v_a record; v_dur int; v_len text; v_at text; v_body text;
begin
  if new.direction <> 'outbound' or coalesce(new.reason_code, '') <> 'intro' or new.carrier_org_id is null then return new; end if;
  r := app_private.intro_call_result(new);
  if r is null or r is not distinct from new.intro_result then return new; end if;
  update app_private.dialer_calls set intro_result = r where id = new.id;   -- intro_result is not in the trigger's column list

  select a.id, a.carrier_org_id, a.intro_call_id into v_a from app_private.dispatcher_assignments a
   where a.dispatcher_user_id = new.dispatcher_user_id and a.carrier_org_id = new.carrier_org_id and a.status = 'active'
   order by a.assigned_at desc limit 1;
  if v_a.id is null then return new; end if;
  if v_a.intro_call_id is not null and v_a.intro_call_id <> new.id then return new; end if;   -- intro already done by another call

  if r = 'connected' and v_a.intro_call_id is null then
    update app_private.dispatcher_assignments set intro_call_at = coalesce(new.answered_at, now()), intro_call_id = new.id, updated_at = now()
     where id = v_a.id;
  elsif r <> 'connected' and v_a.intro_call_id = new.id then
    update app_private.dispatcher_assignments set intro_call_at = null, intro_call_id = null, updated_at = now() where id = v_a.id;
  end if;

  v_dur := coalesce(new.duration_sec, extract(epoch from (new.ended_at - new.answered_at))::int, 0);
  v_len := case when v_dur >= 60 then (v_dur / 60) || 'm ' || (v_dur % 60) || 's' else v_dur || 's' end;
  v_at  := to_char(coalesce(new.started_at, new.created_at) at time zone 'America/New_York', 'Dy Mon FMDD, FMHH12:MI AM') || ' ET';
  v_body := case r
    when 'connected'  then '📞 Intro call done — connected, ' || v_len || ' (' || v_at || '). From here: the carrier posts availability in the portal, loads go on the board, and the dispatcher calls only if it is urgent.'
    when 'short'      then '📞 Intro call attempt — picked up but ended after ' || v_dur || 's (' || v_at || '). Not counted as the intro yet — intro call still pending.'
    when 'voicemail'  then '📞 Intro call attempt — voicemail left (' || v_at || '). Intro call still pending: the dispatcher will try again, or the carrier can reply here with a good time to call.'
    when 'no_answer'  then '📞 Intro call attempt — no answer (' || v_at || '). Intro call still pending: the dispatcher will try again, or the carrier can reply here with a good time to call.'
    when 'busy'       then '📞 Intro call attempt — line busy (' || v_at || '). Intro call still pending: the dispatcher will try again.'
    when 'declined'   then '📞 Intro call attempt — call declined (' || v_at || '). Intro call still pending: the carrier can reply here with a good time to call.'
    when 'bad_number' then '📞 Intro call attempt — the call did not go through, the number could not be reached (' || v_at || '). Intro call still pending: please check the phone number on the account.'
  end;
  if v_prev = 'connected' then   -- the dispatcher re-tagged a call that had counted: say so plainly
    v_body := replace(v_body, '📞 Intro call attempt — ', '📞 Update — that call is now marked: ') || ' (It no longer counts as the intro.)';
  end if;
  insert into app_private.dispatcher_messages (assignment_id, carrier_org_id, sender_role, body)
  values (v_a.id, v_a.carrier_org_id, 'system', v_body);
  return new;
end $function$;

drop trigger if exists disp_intro_call on app_private.dialer_calls;
create trigger disp_intro_call after insert or update of status, ended_at, answered_at, duration_sec, outcome on app_private.dialer_calls
  for each row execute function app_private.trg_disp_intro_call();

-- backfill (no thread messages): record the result of every past intro call, and take back intros that were not real
update app_private.dialer_calls c set intro_result = app_private.intro_call_result(c)
 where c.reason_code = 'intro' and c.direction = 'outbound' and c.intro_result is null;
update app_private.dispatcher_assignments a set intro_call_at = null, intro_call_id = null, updated_at = now()
  from app_private.dialer_calls c
 where c.id = a.intro_call_id and c.intro_result is distinct from 'connected';

-- the last intro attempt since the assignment (for the dispatcher's phone + workspace chip, D360 and Carrier 360)
create or replace function app_private.intro_last_attempt(p_user uuid, p_org uuid)
returns jsonb language sql stable security definer set search_path to 'app_private', 'public' as $function$
  select (select jsonb_build_object('result', c.intro_result, 'at', coalesce(c.started_at, c.created_at),
                   'tries', (select count(*) from app_private.dialer_calls t
                              where t.dispatcher_user_id = p_user and t.carrier_org_id = p_org and t.reason_code = 'intro'
                                and t.intro_result is not null and t.created_at >= a.assigned_at))
            from app_private.dialer_calls c
           where c.dispatcher_user_id = p_user and c.carrier_org_id = p_org and c.reason_code = 'intro'
             and c.intro_result is not null and c.created_at >= a.assigned_at
           order by c.created_at desc limit 1)
    from app_private.dispatcher_assignments a
   where a.dispatcher_user_id = p_user and a.carrier_org_id = p_org and a.status = 'active'
   order by a.assigned_at desc limit 1;
$function$;
revoke all on function app_private.intro_last_attempt(uuid, uuid), app_private.intro_call_result(app_private.dialer_calls) from public, anon;

-- teach the four readers 'intro_last' by replacing one anchor each (no retyping of the big functions)
do $$
declare r record; d text; n int;
begin
  for r in select * from (values
    ('app_private.disp_call_context(uuid,text)', $a$'intro_done', v_a.intro_call_at is not null,$a$,
       $a$'intro_done', v_a.intro_call_at is not null, 'intro_last', app_private.intro_last_attempt(p_user, v_a.carrier_org_id),$a$),
    ('public.dispatcher_workspace_feed()', $a$'assigned_at', a.assigned_at,$a$,
       $a$'assigned_at', a.assigned_at, 'intro_last', app_private.intro_last_attempt(a.dispatcher_user_id, a.carrier_org_id),$a$),
    ('public.cc_carrier_360(uuid)', $a$'intro_call_at', a.intro_call_at)$a$,
       $a$'intro_call_at', a.intro_call_at, 'intro_last', app_private.intro_last_attempt(a.dispatcher_user_id, a.carrier_org_id))$a$),
    ('public.cc_dispatcher_360(uuid)', $a$'intro_call_at', a.intro_call_at,$a$,
       $a$'intro_call_at', a.intro_call_at, 'intro_last', app_private.intro_last_attempt(a.dispatcher_user_id, a.carrier_org_id),$a$)
  ) v(fn, anchor, repl) loop
    d := pg_get_functiondef(r.fn::regprocedure);
    if position('intro_last' in d) > 0 then continue; end if;
    n := (length(d) - length(replace(d, r.anchor, ''))) / length(r.anchor);
    if n <> 1 then raise exception 'bl_disp_0591: anchor found % times in %', n, r.fn; end if;
    execute replace(d, r.anchor, r.repl);
  end loop;
end $$;
