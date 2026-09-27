-- bl_brain_0474_assist.sql
-- Ops Brain — plan §3 UI items: "AI suggested reply" for staff in CC → Live chat, "why the brain said this",
-- and the brain-vs-human split in the Live chat stats. Also the data the CC "AI Brain" screen reads.
-- Additive and reversible. Staging first, then prod. Anon SECURITY DEFINER surface unchanged (36 prod / 35 staging).
--
-- WHAT THIS ADDS
--   source.assist            a new brain source: the brain drafts a reply for a HUMAN agent. The draft is shown
--                            to staff only — nothing reaches the visitor until a person presses Send. Low risk,
--                            $3/day, 300 jobs/day, on by default. brain_sink has no branch for it, so the result
--                            stays on the job row and the CC reads it back.
--   brain_user_text          an 'assist' branch: same visitor / account / history blocks as 'chat', a different
--                            opener (write in the human's voice, no chips/forms/emoji, never promise money or dates).
--   public.cc_lc_assist(id)  staff (lc_cc_ok): enqueue one draft for a conversation. One in flight per chat.
--   public.cc_lc_brain(id)   staff: the brain's view of one conversation — engine (Claude or Gemini), the latest
--                            draft, the latest escalate (summary + suggested reply the brain wrote when it handed
--                            off), every Claude chat job with confidence, tool calls, cost and fallback.
--   public.cc_lc_stats       + who_7d {claude, gemini, human, total}, claude_usd_7d, chat_on_claude.
--   index                    brain_jobs (source, ref_id, id desc) — the per-conversation reads above.
--
-- ROLLBACK: drop function public.cc_lc_assist(uuid), public.cc_lc_brain(uuid); delete from
--   app_private.brain_permissions where key = 'source.assist'; re-create cc_lc_stats / brain_user_text from
--   bl_brain_0473_chat. Nothing here is referenced by a trigger or a cron.

-- ---------------------------------------------------------------- 1. the source + its route settings
-- brain_jobs.source is a CHECK list (bl_brain_0470). Same list + 'assist'. (Staging learned this the hard way:
-- the first enqueue failed on the constraint — applied there as bl_brain_0474b_source_check, prod gets it here.)
alter table app_private.brain_jobs drop constraint if exists brain_jobs_source_check;
alter table app_private.brain_jobs add constraint brain_jobs_source_check
  check (source = any (array['chat','assist','email','wa','onboarding','dispatch','sales','sweep','voice','test']));

do $$
declare v_row app_private.brain_permissions;
begin
  insert into app_private.brain_permissions
    (key, kind, name, label, description, enabled, mode, risk, status, sources, max_per_job, max_per_day, usd_cap_daily, builtin)
  values
    ('source.assist', 'source', 'assist', 'Staff assist (suggested replies)',
     'Drafts a reply for a HUMAN agent in CC → Live chat ("AI suggested reply"). Shown to staff only — nothing reaches the visitor until a person presses Send. Reads the same account file and knowledge base as live chat.',
     true, 'auto', 'low', 'live', null, null, 300, 3, true)
  on conflict (key) do nothing
  returning * into v_row;
  if v_row.key is not null then
    perform app_private.brain_log('source.assist', 'add', null, to_jsonb(v_row) - 'created_by' - 'updated_by', 'bl_brain_0474: staff assist source');
  end if;
end $$;

update app_private.brain_config
   set effort     = effort     || jsonb_build_object('assist', coalesce(effort ->> 'assist', 'low')),
       max_tokens = max_tokens || jsonb_build_object('assist', coalesce((max_tokens ->> 'assist')::int, 4000))
 where id;

create index if not exists brain_jobs_source_ref_idx on app_private.brain_jobs (source, ref_id, id desc);

-- ---------------------------------------------------------------- 2. the user turn: 'assist' next to 'chat'
create or replace function app_private.brain_user_text(p_route text, p_source text, p_question text, p_context jsonb)
returns text
language sql
stable
set search_path to 'app_private', 'public'
as $function$
  select case when p_route in ('chat', 'assist') then
       case when p_route = 'assist' then
            'You are drafting a reply for a HUMAN LoadBoot staff member ('
              || coalesce(nullif(p_context ->> 'staff_name', ''), 'a support agent')
              || ') who is about to answer this live-chat visitor. Write the exact message THEY will send, in their voice '
              || '("I" is the human agent, not an AI). It is shown to staff only; nothing reaches the visitor until the person presses Send. '
              || 'No chips, no forms, no [[...]] directives, no emoji, no greeting boilerplate. Say what is known, ask for what is missing, '
              || 'never promise money, dates or approvals, and never state a fact that is not in the account file, the facts or the knowledge base.'
            else
            'You are answering as Riley, LoadBoot''s live-chat assistant, inside the website / portal chat widget. One visitor, one reply, in the visitor''s language.'
       end || E'\n\n'
    || 'VISITOR: role=' || coalesce(p_context ->> 'visitor_role', 'visitor')
    || ' · name=' || coalesce(nullif(p_context ->> 'name', ''), 'unknown')
    || ' · page=' || coalesce(nullif(p_context ->> 'page', ''), '?')
    || ' · lang=' || coalesce(p_context ->> 'lang', 'en')
    || ' · has_email=' || coalesce(p_context ->> 'has_email', 'false')
    || ' · lead_stage=' || coalesce(nullif(p_context ->> 'lead_stage', ''), 'none')
    || ' · staff_online=' || coalesce(p_context ->> 'staff_online', 'false') || E'\n\n'
    || 'SIGNED-IN ACCOUNT: ' || case when (p_context -> 'account') is null or jsonb_typeof(p_context -> 'account') = 'null'
                                     then 'none (anonymous visitor — never guess anything about an account)'
                                     else left(jsonb_pretty(p_context -> 'account'), 6000) end || E'\n\n'
    || 'EARLIER CONVERSATIONS BY THIS VISITOR: '
    || case when jsonb_array_length(coalesce(p_context -> 'prior', '[]'::jsonb)) = 0 then 'none'
            else E'\n' || left((select string_agg('— ' || (p ->> 'when') || ' (' || coalesce(p ->> 'status', '?') || '):' || E'\n'
                                  || coalesce((select string_agg('   ' || (m ->> 'who') || ': ' || (m ->> 'body'), E'\n')
                                                 from jsonb_array_elements(p -> 'messages') m), '   (empty)'), E'\n')
                                 from jsonb_array_elements(p_context -> 'prior') p), 3000) end || E'\n\n'
    || 'CONVERSATION SO FAR (oldest first):' || E'\n'
    || coalesce((select string_agg((m ->> 'who') || ': ' || (m ->> 'body'), E'\n') from jsonb_array_elements(coalesce(p_context -> 'history', '[]'::jsonb)) m), '(this is the first message)') || E'\n\n'
    || 'NEW MESSAGE FROM THE VISITOR:' || E'\n' || left(coalesce(p_question, ''), 4000) || E'\n\n'
    || 'CLOSEST KNOWLEDGE-BASE MATCH (a hint — use its wording if it answers the question, ignore it if it does not): '
    || coalesce(nullif(left(p_context ->> 'kb_hint', 1500), ''), 'none') || E'\n\n'
    || case when p_route = 'assist'
            then 'Put the draft in "reply", under 120 words. Respond with the single JSON object described in your rules.'
            else 'Reply under 110 words. Respond with the single JSON object described in your rules.' end
  else
       'ROUTE: ' || p_route || ' · SOURCE: ' || p_source || E'\n\n'
    || 'CONTEXT (json):' || E'\n' || left(coalesce(jsonb_pretty(coalesce(p_context, '{}'::jsonb)), '{}'), 14000) || E'\n\n'
    || 'TASK / NEW MESSAGE:' || E'\n' || left(coalesce(p_question, ''), 6000) || E'\n\n'
    || 'Respond with the single JSON object described in your rules.'
  end;
$function$;

-- ---------------------------------------------------------------- 3. staff asks for a draft
create or replace function public.cc_lc_assist(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'app_private', 'public', 'extensions'
as $function$
declare v_conv app_private.lc_conversations; v_last text; v_ctx jsonb; v_running bigint;
begin
  if not app_private.lc_cc_ok() then raise exception 'not authorized' using errcode = '42501'; end if;
  select * into v_conv from app_private.lc_conversations where id = p_id;
  if v_conv.id is null then raise exception 'conversation not found' using errcode = 'P0002'; end if;

  -- one draft in flight per conversation; the watchdog / brain_rpc settle anything older than 90 s
  select count(*) into v_running from app_private.brain_jobs
   where source = 'assist' and ref_id = p_id::text and status in ('queued', 'running') and created_at > now() - interval '90 seconds';
  if v_running > 0 then return jsonb_build_object('status', 'running'); end if;

  select body into v_last from app_private.lc_messages
   where conversation_id = p_id and sender = 'visitor' and body not like '[[sys]]%' and body not like '[[note]]%'
   order by id desc limit 1;
  v_last := coalesce(nullif(btrim(coalesce(v_last, '')), ''), '(the visitor has not written anything yet — draft an opening line for the agent)');

  v_ctx := app_private.lc_brain_chat_context(p_id, v_last)
        || jsonb_build_object('staff_online', true,
                              'staff_name',   app_private.lc_staff_display(auth.uid()),
                              'mode',         v_conv.mode,
                              'bot_paused',   v_conv.bot_paused);

  return app_private.brain_enqueue('assist', p_id::text, 'assist', v_last, v_ctx, null,
                                   array['kb_search', 'get_facts', 'account_lookup'],
                                   case when coalesce(v_conv.lang, 'en') = 'es' then 'es' else 'en' end);
end $function$;

revoke execute on function public.cc_lc_assist(uuid) from public, anon;
grant  execute on function public.cc_lc_assist(uuid) to authenticated, service_role;
comment on function public.cc_lc_assist(uuid) is
  'bl_brain_0474: staff (comm.view / support.view / dispatch.manage) ask the brain for a reply draft on one live chat. Staff-only output; never delivered to the visitor.';

-- ---------------------------------------------------------------- 4. the brain''s view of one conversation
create or replace function public.cc_lc_brain(p_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'app_private', 'public'
as $function$
  with cfg as (select c.enabled from app_private.brain_config c where c.id),
       chat_on as (select coalesce((select enabled from cfg), false) and coalesce((select p.enabled from app_private.brain_permissions p where p.key = 'source.chat'), false) v),
       assist_on as (select coalesce((select enabled from cfg), false) and coalesce((select p.enabled from app_private.brain_permissions p where p.key = 'source.assist'), false) v),
       acts as (
         select a.job_id,
                jsonb_agg(jsonb_build_object('id', a.id, 'tool', a.tool, 'outcome', a.outcome, 'ok', a.ok, 'ms', a.ms,
                                             'summary', left(coalesce(a.payload ->> 'query', a.payload ->> 'reason', a.payload ->> 'title', a.payload ->> 'text', ''), 160),
                                             'error', a.result ->> 'error') order by a.id) j
           from app_private.brain_actions a
          where a.job_id in (select id from app_private.brain_jobs where ref_id = p_id::text and source in ('chat', 'assist'))
          group by a.job_id)
  select case when not app_private.lc_cc_ok() then jsonb_build_object('error', 'not authorized') else jsonb_build_object(
    'engine',    case when (select v from chat_on) then 'claude' else 'gemini' end,
    'assist_on', (select v from assist_on),
    'usd',       (select coalesce(sum(usd), 0) from app_private.brain_jobs where ref_id = p_id::text and source in ('chat', 'assist')),
    'assist',    (select jsonb_build_object(
                    'id', j.id, 'status', j.status, 'reply', j.result ->> 'reply',
                    'confidence', (j.result ->> 'confidence')::numeric, 'escalate', (j.result ->> 'escalate') = 'true',
                    'escalate_reason', j.result ->> 'escalate_reason', 'actions', coalesce(j.result -> 'actions', '[]'::jsonb),
                    'usd', j.usd, 'secs', round(extract(epoch from (coalesce(j.done_at, now()) - j.created_at))::numeric, 1),
                    'model', j.model, 'error', j.error, 'created_at', j.created_at,
                    'tools', coalesce((select a.j from acts a where a.job_id = j.id), '[]'::jsonb))
                    from app_private.brain_jobs j where j.source = 'assist' and j.ref_id = p_id::text order by j.id desc limit 1),
    'escalation', (select jsonb_build_object('job_id', a.job_id, 'reason', a.payload ->> 'reason', 'summary', a.payload ->> 'summary',
                                             'suggested_reply', a.payload ->> 'suggested_reply', 'at', a.created_at)
                     from app_private.brain_actions a
                     join app_private.brain_jobs j on j.id = a.job_id
                    where j.source = 'chat' and j.ref_id = p_id::text and a.tool = 'escalate'
                    order by a.id desc limit 1),
    'jobs',      (select coalesce(jsonb_agg(jsonb_build_object(
                    'id', j.id, 'status', j.status, 'question', left(j.question, 160), 'reply', left(j.result ->> 'reply', 240),
                    'confidence', (j.result ->> 'confidence')::numeric, 'escalate', (j.result ->> 'escalate') = 'true',
                    'escalate_reason', j.result ->> 'escalate_reason', 'actions', coalesce(j.result -> 'actions', '[]'::jsonb),
                    'model', j.model, 'usd', j.usd, 'tool_calls', j.tool_calls, 'error', j.error,
                    'fell_back', j.status in ('failed', 'skipped', 'capped'),
                    'secs', round(extract(epoch from (coalesce(j.done_at, now()) - j.created_at))::numeric, 1),
                    'created_at', j.created_at,
                    'tools', coalesce((select a.j from acts a where a.job_id = j.id), '[]'::jsonb)) order by j.id desc), '[]'::jsonb)
                    from (select * from app_private.brain_jobs where source = 'chat' and ref_id = p_id::text order by id desc limit 20) j)
  ) end;
$function$;

revoke execute on function public.cc_lc_brain(uuid) from public, anon;
grant  execute on function public.cc_lc_brain(uuid) to authenticated, service_role;
comment on function public.cc_lc_brain(uuid) is
  'bl_brain_0474: staff read of the brain on one live chat — engine, latest draft, latest escalate summary, every Claude chat job with tools, confidence, cost, fallback.';

-- ---------------------------------------------------------------- 5. stats: who answered, last 7 days
create or replace function public.cc_lc_stats()
returns jsonb
language sql
stable
security definer
set search_path to 'app_private, public'
as $function$
  select case when not app_private.lc_cc_ok() then jsonb_build_object('error','not authorized')
    else jsonb_build_object(
      'open', (select count(*) from app_private.lc_conversations where status='open'),
      'needs_human', (select count(*) from app_private.lc_conversations where status='open' and mode='human' and staff_unread > 0),
      'unread', (select coalesce(sum(staff_unread),0) from app_private.lc_conversations where status='open'),
      'today', (select count(*) from app_private.lc_conversations where created_at > current_date),
      'leads_today', (select count(*) from app_private.lc_conversations where created_at > current_date and email is not null and user_id is null),
      'ai_resolved_today', (select count(*) from app_private.lc_conversations where created_at > current_date and mode = 'bot'),
      'oldest_wait_secs', (select coalesce(max(extract(epoch from (now() - last_msg_at)))::int, 0)
                           from app_private.lc_conversations where status='open' and mode='human' and staff_unread > 0),
      'online', app_private.lc_staff_online(),
      'staff_name', (select staff_name from app_private.lc_presence where id = 1),
      'unanswered_handoffs', (select count(*) from app_private.lc_conversations c where c.status='open' and c.mode='human'
                               and not exists (select 1 from app_private.lc_messages m where m.conversation_id=c.id and m.sender='staff')),
      'convs_7d', (select count(*) from app_private.lc_conversations where created_at > now() - interval '7 days'),
      'handoffs_7d', (select count(*) from app_private.lc_conversations where handoff_at > now() - interval '7 days'),
      'median_first_reply_secs_7d', (select percentile_cont(0.5) within group (order by extract(epoch from (first_staff_reply_at - handoff_at)))::int
                                     from app_private.lc_conversations where handoff_at > now() - interval '7 days' and first_staff_reply_at is not null),
      'handoffs_answered_15m_pct_7d', (select case when count(*) = 0 then null
                                           else round(100.0 * count(*) filter (where first_staff_reply_at is not null and first_staff_reply_at - handoff_at <= interval '15 minutes') / count(*)) end
                                       from app_private.lc_conversations where handoff_at > now() - interval '7 days' and handoff_at < now() - interval '15 minutes'),
      'csat_avg_30d', (select round(avg(csat)::numeric, 1) from app_private.lc_conversations where csat_at > now() - interval '30 days'),
      'csat_n_30d', (select count(*) from app_private.lc_conversations where csat_at > now() - interval '30 days'),
      'ai_share_7d', (select case when count(*) = 0 then null else round(100.0 * count(*) filter (where handoff_at is null) / count(*)) end
                      from app_private.lc_conversations where created_at > now() - interval '7 days'),
      -- bl_brain_0474: who actually answered. claude = a done Claude chat job and no handoff; human = handed off;
      -- gemini = a bot reply with no Claude job and no handoff. The rest never got a reply (visitor left, no message).
      'chat_on_claude', (coalesce((select enabled from app_private.brain_config where id), false)
                         and coalesce((select enabled from app_private.brain_permissions where key = 'source.chat'), false)),
      'who_7d', (select jsonb_build_object(
                   'claude', count(*) filter (where cl and not hu),
                   'gemini', count(*) filter (where bot and not cl and not hu),
                   'human',  count(*) filter (where hu),
                   'total',  count(*))
                 from (select c.handoff_at is not null hu,
                              exists (select 1 from app_private.brain_jobs j where j.source = 'chat' and j.status = 'done' and j.ref_id = c.id::text) cl,
                              exists (select 1 from app_private.lc_messages m where m.conversation_id = c.id and m.sender = 'bot') bot
                         from app_private.lc_conversations c where c.created_at > now() - interval '7 days') x),
      'claude_usd_7d', (select coalesce(round(sum(usd)::numeric, 2), 0) from app_private.brain_jobs
                         where source in ('chat', 'assist') and created_at > now() - interval '7 days')
    ) end;
$function$;

-- ---------------------------------------------------------------- 6. proof
-- select key, enabled, usd_cap_daily, max_per_day from app_private.brain_permissions where key = 'source.assist';
-- select effort ->> 'assist', max_tokens ->> 'assist' from app_private.brain_config;
-- select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');   -- 36 prod / 35 staging, names per docs/audit-2026-09/anon-secdef-baseline.md
