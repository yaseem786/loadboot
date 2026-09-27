-- bl_voice_0483_riley_call_plans.sql
-- Riley call plans — plan §9 Phase 1, first slice (27 Sep 2026). The Ops Brain writes the briefing for a carrier call
-- BEFORE anyone dials: goal, opener, five talking points, facts to confirm, do-not-say, best time, language. Staff ask
-- for it from Carrier 360 / Carrier choices ("Plan a call"), read it in CC → Riley → Call plans. Nothing here dials:
-- `tool.schedule_riley_call` stays `prep` until the owner flips it (CC → AI Brain → Permissions). The plan text is
-- written as Riley's `{{context}}` so the same words drive the call when scheduling ships.
--
-- Additive and reversible. Staging first, then prod. Anon SECURITY DEFINER surface unchanged (36 prod / 35 staging):
-- every new public function below revokes public + anon explicitly (CLAUDE.md §4).
--
-- WHAT THIS ADDS
--   app_private.riley_call_plans        one row per requested plan: who, why, consent basis, the brain job, the plan.
--   app_private.riley_plan_context()    the carrier file the brain plans from (profile, compliance via lc_account_snapshot,
--                                       trucks, dispatcher, pending choices, last Riley calls, consent). Never a demo org.
--   app_private.riley_plan_parse()      the fixed-header plan text → jsonb sections for the CC card.
--   brain_user_text                     a 'voice_plan' branch (route) in front of the default branch — same 0474 body otherwise.
--   brain_sink                          a 'voice' branch: done → plan ready (or failed), usd + confidence copied to the plan row.
--   brain_permissions                   source.voice planned → LIVE (enabled). tool.schedule_riley_call untouched (prep, off).
--   brain_config                        voice_plan on claude-sonnet-5, effort medium, max_tokens 3000 (a plan is ~250 words).
--   public.cc_riley_plan_create         staff: plan a call for one carrier (reason + note) → brain job. One in flight per carrier.
--   public.cc_riley_plans / cc_riley_plan   staff reads (list / one, with job cost + timing).
--   public.cc_riley_plan_set            staff: cancel · called (done by hand) · redo (new job) · edit (plan text).
--
-- ROLLBACK: drop function public.cc_riley_plan_create(uuid,text,text,text), public.cc_riley_plans(text,integer,uuid),
--   public.cc_riley_plan(bigint), public.cc_riley_plan_set(bigint,text,text); drop function app_private.riley_plan_context(bigint),
--   app_private.riley_plan_parse(text); drop table app_private.riley_call_plans; re-create brain_user_text from
--   bl_brain_0474 and brain_sink from bl_brain_0473; cc_brain_perm_set('source.voice', {enabled:false,status:'planned'}).
--   Nothing here is referenced by a trigger or a cron.

-- ---------------------------------------------------------------- 1. the plan row
create table if not exists app_private.riley_call_plans (
  id            bigserial primary key,
  org_id        uuid not null references public.organizations(id) on delete cascade,
  contact_name  text,
  to_number     text,                                   -- E.164 when we could normalise it, else the profile value
  contact_role  text not null default 'carrier',
  consent       jsonb not null default '{}'::jsonb,     -- {ok, basis, method, at}: what lets us place this call (TCPA)
  reason        text not null check (reason in ('welcome','onboarding_gap','document_missing','choice_pending','no_reply','custom')),
  note          text,                                   -- what staff want covered, in their words
  lang          text not null default 'en' check (lang in ('en','es')),
  status        text not null default 'planning' check (status in ('planning','ready','failed','scheduled','called','cancelled')),
  job_id        bigint,                                 -- brain_jobs.id (latest)
  plan_text     text,                                   -- the briefing, verbatim = Riley's {{context}} when scheduled
  plan          jsonb,                                  -- parsed sections for the card
  confidence    numeric(4,3),
  review_note   text,                                   -- the brain's escalate_reason when it wants a person to look first
  brain_usd     numeric(10,6) not null default 0,
  est_minutes   integer not null default 4,
  call_id       bigint,                                 -- lc_calls.id once a call is booked (future: tool.schedule_riley_call)
  error         text,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  closed_at     timestamptz
);
alter table app_private.riley_call_plans enable row level security;
create index if not exists riley_call_plans_org_idx    on app_private.riley_call_plans (org_id, id desc);
create index if not exists riley_call_plans_status_idx on app_private.riley_call_plans (status, id desc);
create index if not exists riley_call_plans_job_idx    on app_private.riley_call_plans (job_id);
comment on table app_private.riley_call_plans is
  'bl_voice_0483: Riley call plans — the brain''s briefing for one outbound carrier call, requested by staff. Nothing dials from here until tool.schedule_riley_call is live.';

-- ---------------------------------------------------------------- 2. the carrier file the brain plans from
create or replace function app_private.riley_plan_context(p_plan bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'app_private', 'public'
as $function$
declare v_p app_private.riley_call_plans; v_org public.organizations; v_prof public.profiles;
        v_snap jsonb; v_disp jsonb; v_choices jsonb; v_calls jsonb; v_last_login timestamptz;
begin
  select * into v_p from app_private.riley_call_plans where id = p_plan;
  if v_p.id is null then return null; end if;
  select * into v_org from public.organizations where id = v_p.org_id;
  if v_org.id is null or coalesce(v_org.is_demo, false) then return null; end if;   -- demo accounts are invisible (CLAUDE.md §4)
  select * into v_prof from public.profiles where id = v_org.owner_user_id;
  select u.last_sign_in_at into v_last_login from auth.users u where u.id = v_org.owner_user_id;

  v_snap := app_private.lc_account_snapshot(v_org.owner_user_id);     -- compliance rows + notes, trucks, payment status

  select jsonb_build_object('name', dp.full_name, 'status', a.status, 'assigned_at', a.assigned_at,
                            'contact_released', a.contact_released_at is not null, 'carrier_acknowledged', a.carrier_ack_at is not null)
    into v_disp
    from app_private.dispatcher_assignments a
    left join app_private.dispatcher_profiles dp on dp.user_id = a.dispatcher_user_id
   where a.carrier_org_id = v_org.id and a.status = 'active'
   order by a.assigned_at desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object('candidate', dp.full_name, 'match', c.match_kind, 'chosen_at', c.created_at,
                                                'candidate_note', left(c.dispatcher_note, 300)) order by c.created_at), '[]'::jsonb)
    into v_choices
    from app_private.dispatcher_carrier_choices c
    left join app_private.dispatcher_profiles dp on dp.user_id = c.dispatcher_user_id
   where c.carrier_org_id = v_org.id and c.status = 'pending';

  select coalesce(jsonb_agg(jsonb_build_object('at', c.created_at, 'direction', c.direction, 'status', c.status, 'duration_sec', c.duration_sec,
                                                'summary', left(c.summary, 400), 'next_step', c.analysis ->> 'next_step',
                                                'interest', c.analysis ->> 'interest_level') order by c.created_at desc), '[]'::jsonb)
    into v_calls
    from (select * from app_private.lc_calls c
           where (c.org_id = v_org.id
                  or (v_p.to_number is not null and right(regexp_replace(coalesce(c.to_number, c.from_number, ''), '[^0-9]', '', 'g'), 10)
                                                  = right(regexp_replace(v_p.to_number, '[^0-9]', '', 'g'), 10)))
           order by c.created_at desc limit 3) c;

  return jsonb_build_object(
    'plan_id',      v_p.id,
    'reason',       v_p.reason,
    'staff_note',   v_p.note,
    'lang',         v_p.lang,
    'user_id',      v_org.owner_user_id,          -- lets tool.account_lookup read THIS account only
    'carrier', jsonb_build_object(
      'org_id', v_org.id, 'name', v_org.name, 'org_status', v_org.status, 'mc', coalesce(v_org.mc_number, v_prof.mc), 'dot', coalesce(v_org.dot_number, v_prof.dot),
      'contact_name', v_prof.contact_name, 'legal_owner_name', v_prof.legal_owner_name, 'phone_on_file', v_prof.phone is not null,
      'preferred_contact', v_prof.contact_method, 'whatsapp_on_file', v_prof.whatsapp is not null,
      'equipment', v_prof.equipment_types, 'truck_count', v_prof.truck_count, 'home_base', v_prof.home_base, 'lanes', v_prof.lanes,
      'authority', v_prof.authority, 'factoring', v_prof.factoring_status, 'hazmat', v_prof.hazmat, 'owner_drives', v_prof.owner_drives,
      'joined_at', v_prof.created_at, 'application_status', v_prof.status, 'last_login_at', v_last_login,
      'days_since_login', case when v_last_login is null then null else floor(extract(epoch from (now() - v_last_login)) / 86400)::int end),
    'compliance',        coalesce(v_snap - 'org_id' - 'org_name' - 'kind', '{}'::jsonb),
    'dispatcher',        v_disp,                       -- null = no dispatcher assigned yet
    'pending_choices',   v_choices,                    -- candidates who picked this carrier and wait for the owner
    'recent_riley_calls', v_calls,
    'consent',           v_p.consent);
end $function$;
revoke all on function app_private.riley_plan_context(bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------- 3. plan text → sections
-- The brain writes seven fixed headers (see the voice_plan branch below). A missing header is simply null; the CC
-- card always keeps the verbatim text, so a free-form answer is never lost.
create or replace function app_private.riley_plan_parse(p_text text)
returns jsonb
language plpgsql
immutable
as $function$
declare t text := coalesce(p_text, '');
        stop_ text := '(?=\n\s*(?:GOAL|OPENER|TALKING POINTS|CONFIRM|DO NOT SAY|BEST TIME|LANGUAGE)\s*:|$)';
        g_goal text; g_open text; g_pts text; g_conf text; g_dns text; g_time text; g_lang text;
begin
  if btrim(t) = '' then return null; end if;
  -- ARE greediness is decided by the FIRST quantifier in the branch, so the leading \s*? makes the whole match shortest.
  g_goal := nullif(btrim(substring(t from '(?i)GOAL\s*?:\s*?(.*?)' || stop_)), '');
  g_open := nullif(btrim(substring(t from '(?i)OPENER\s*?:\s*?(.*?)' || stop_)), '');
  g_pts  := nullif(btrim(substring(t from '(?i)TALKING POINTS\s*?:\s*?(.*?)' || stop_)), '');
  g_conf := nullif(btrim(substring(t from '(?i)CONFIRM\s*?:\s*?(.*?)' || stop_)), '');
  g_dns  := nullif(btrim(substring(t from '(?i)DO NOT SAY\s*?:\s*?(.*?)' || stop_)), '');
  g_time := nullif(btrim(substring(t from '(?i)BEST TIME\s*?:\s*?(.*?)' || stop_)), '');
  g_lang := nullif(btrim(substring(t from '(?i)LANGUAGE\s*?:\s*?(.*?)' || stop_)), '');
  return jsonb_strip_nulls(jsonb_build_object(
    'goal',       g_goal,
    'opener',     g_open,
    'points',     (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select nullif(btrim(regexp_replace(l, '^\s*(?:[0-9]+[.)]|[-*•])\s*', '')), '') x from regexp_split_to_table(coalesce(g_pts, ''), E'\n') l) s where x is not null),
    'confirm',    (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select nullif(btrim(regexp_replace(l, '^\s*(?:[0-9]+[.)]|[-*•])\s*', '')), '') x from regexp_split_to_table(coalesce(g_conf, ''), E'\n') l) s where x is not null),
    'do_not_say', (select coalesce(jsonb_agg(x), '[]'::jsonb) from (select nullif(btrim(regexp_replace(l, '^\s*(?:[0-9]+[.)]|[-*•])\s*', '')), '') x from regexp_split_to_table(coalesce(g_dns, ''), E'\n') l) s where x is not null),
    'best_time',  g_time,
    'language',   g_lang,
    'parsed',     g_goal is not null and g_pts is not null));
end $function$;
revoke all on function app_private.riley_plan_parse(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- 4. the user turn: 'voice_plan' in front of the default
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
  when p_route = 'voice_plan' then
       -- bl_voice_0483: the briefing Riley (Retell voice agent) will read as {{context}} before an OUTBOUND call to a carrier.
       'You are the LoadBoot Ops Brain writing a CALL PLAN for Riley, LoadBoot''s AI phone assistant, before she calls this carrier. '
    || 'Riley reads your text as her briefing, so address her directly ("Call X and …"). The carrier is an existing LoadBoot account '
    || 'who gave us this number at signup; this is a service call about THEIR OWN account, never a sales pitch and never marketing. '
    || 'Use only what is in the carrier file, the facts and the knowledge base — never invent a document status, a rate, a dispatcher name or a date. '
    || 'Money, payouts, commissions, refunds, legal or factoring questions: Riley takes a message for the owner, she never decides or promises. '
    || 'Riley must say she is LoadBoot''s AI assistant in the opener (AI disclosure). Keep everything under 230 words.' || E'\n\n'
    || 'WHY THIS CALL (reason code): ' || coalesce(p_context ->> 'reason', 'custom')
    || case (p_context ->> 'reason')
         when 'welcome'          then ' — new carrier welcome: thank them, say what is missing to get dispatched, offer help.'
         when 'onboarding_gap'   then ' — signed up but did not finish: find out what is blocking them, walk them through the next step.'
         when 'document_missing' then ' — a compliance document is missing or was rejected: name it, say exactly what to upload and where (portal → Documents).'
         when 'choice_pending'   then ' — a dispatcher candidate picked this carrier: explain the trial, confirm equipment and lanes, ask if they want to proceed.'
         when 'no_reply'         then ' — we emailed / messaged and heard nothing: check they got it, answer questions, agree the next step.'
         else ' — custom: follow the staff note.' end || E'\n'
    || 'STAFF NOTE: ' || coalesce(nullif(p_context ->> 'staff_note', ''), 'none') || E'\n'
    || 'CALL LANGUAGE: ' || case when coalesce(p_context ->> 'lang', 'en') = 'es' then 'Spanish' else 'English' end || E'\n\n'
    || 'CARRIER FILE (json — the only source of truth about this carrier):' || E'\n'
    || left(jsonb_pretty(coalesce(p_context - 'user_id' - 'plan_id' - 'reason' - 'staff_note' - 'lang', '{}'::jsonb)), 12000) || E'\n\n'
    || 'Put the plan in "reply" as plain text with EXACTLY these seven headers, each on its own line, in this order, nothing before the first:' || E'\n'
    || 'GOAL: one sentence — what this call must achieve.' || E'\n'
    || 'OPENER: the first two sentences Riley says (name the person, LoadBoot, that she is the AI assistant, why she is calling).' || E'\n'
    || 'TALKING POINTS: exactly five numbered lines, each one thing to cover, most important first, each grounded in the file.' || E'\n'
    || 'CONFIRM: numbered lines — facts Riley must verify with the carrier (phone, email, equipment, a document, a dispatcher name…).' || E'\n'
    || 'DO NOT SAY: numbered lines — promises, numbers or topics Riley must avoid on this call (always include money decisions and dates we do not control).' || E'\n'
    || 'BEST TIME: a window in the carrier''s local time (from home_base; default 10:00–18:00 weekdays) and why.' || E'\n'
    || 'LANGUAGE: English or Spanish, and the register (first-name, plain trucking English, no jargon).' || E'\n\n'
    || 'Set "confidence" to how well the file supports this plan (below 0.6 when a key fact is missing, and say what is missing in escalate_reason). '
    || 'Respond with the single JSON object described in your rules.'
  else
       'ROUTE: ' || p_route || ' · SOURCE: ' || p_source || E'\n\n'
    || 'CONTEXT (json):' || E'\n' || left(coalesce(jsonb_pretty(coalesce(p_context, '{}'::jsonb)), '{}'), 14000) || E'\n\n'
    || 'TASK / NEW MESSAGE:' || E'\n' || left(coalesce(p_question, ''), 6000) || E'\n\n'
    || 'Respond with the single JSON object described in your rules.'
  end;
$function$;

-- ---------------------------------------------------------------- 5. the sink: 'voice' next to 'chat'
create or replace function app_private.brain_sink(p_job app_private.brain_jobs)
returns void language plpgsql security definer set search_path = app_private, public, extensions as $$
declare v_conv uuid; v_reply text; v_job app_private.brain_jobs;
begin
  case p_job.source
    when 'chat' then
      v_conv := nullif(p_job.ref_id, '')::uuid;
      if v_conv is null then return; end if;
      if p_job.status = 'done' then
        perform app_private.lc_bot_deliver(v_conv, p_job.result ->> 'reply', coalesce((p_job.result ->> 'escalate')::boolean, false));
      elsif p_job.status = 'failed' then
        -- Claude did not answer (API error, refusal path already delivers via 'done', timeout): Gemini takes it.
        perform app_private.lc_brain_dispatch_gemini(v_conv, p_job.question, p_job.fallback);
      end if;
    when 'voice' then
      -- bl_voice_0483: route voice_plan → the plan row that owns this job. Other voice routes: result stays on the job.
      if p_job.route <> 'voice_plan' then return; end if;
      select * into v_job from app_private.brain_jobs where id = p_job.id;     -- usd / status as written by brain_rpc
      v_reply := nullif(btrim(coalesce(p_job.result ->> 'reply', '')), '');
      if p_job.status = 'done' and v_reply is not null then
        update app_private.riley_call_plans
           set status      = case when status = 'planning' then 'ready' else status end,
               plan_text   = v_reply,
               plan        = app_private.riley_plan_parse(v_reply),
               confidence  = nullif(p_job.result ->> 'confidence', '')::numeric,
               review_note = case when coalesce((p_job.result ->> 'escalate')::boolean, false) then nullif(p_job.result ->> 'escalate_reason', '') end,
               brain_usd   = coalesce(v_job.usd, 0),
               error       = null,
               updated_at  = now()
         where job_id = p_job.id;
      else
        update app_private.riley_call_plans
           set status     = case when status = 'planning' then 'failed' else status end,
               brain_usd  = coalesce(v_job.usd, 0),
               error      = coalesce(nullif(p_job.error, ''), nullif(p_job.result ->> 'escalate_reason', ''), 'the brain returned no plan'),
               updated_at = now()
         where job_id = p_job.id;
      end if;
    when 'test' then null;
    else null;  -- no sink yet for this source: the result stays on brain_jobs.result for the CC screen
  end case;
end $$;
revoke execute on function app_private.brain_sink(app_private.brain_jobs) from public, anon, authenticated;

-- ---------------------------------------------------------------- 6. permissions + route settings (registry law, CLAUDE.md §9)
do $$
declare v_before app_private.brain_permissions; v_after app_private.brain_permissions;
begin
  select * into v_before from app_private.brain_permissions where key = 'source.voice';
  update app_private.brain_permissions
     set enabled = true, status = 'live',
         description = 'Riley call plans (plan §9 Phase 1): the brain writes the briefing for an outbound carrier call that staff request from Carrier 360 / Carrier choices. Read in CC → Riley → Call plans. Nothing dials until tool.schedule_riley_call is live.',
         updated_at = now()
   where key = 'source.voice'
   returning * into v_after;
  if v_after.key is not null then
    perform app_private.brain_log('source.voice', 'set', to_jsonb(v_before) - 'created_by' - 'updated_by', to_jsonb(v_after) - 'created_by' - 'updated_by',
                                  'bl_voice_0483: call plans ship — source live, dial tool stays prep');
  end if;
end $$;

do $$
declare v_before app_private.brain_config; v_after app_private.brain_config;
begin
  select * into v_before from app_private.brain_config where id;
  update app_private.brain_config
     set model_by_route = model_by_route || jsonb_build_object('voice_plan', coalesce(model_by_route ->> 'voice_plan', 'claude-sonnet-5')),
         effort         = effort         || jsonb_build_object('voice_plan', coalesce(effort ->> 'voice_plan', 'medium')),
         max_tokens     = max_tokens     || jsonb_build_object('voice_plan', coalesce((max_tokens ->> 'voice_plan')::int, 3000))
   where id
   returning * into v_after;
  perform app_private.brain_log('config', 'config',
    jsonb_build_object('model_by_route', v_before.model_by_route, 'effort', v_before.effort, 'max_tokens', v_before.max_tokens),
    jsonb_build_object('model_by_route', v_after.model_by_route,  'effort', v_after.effort,  'max_tokens', v_after.max_tokens),
    'bl_voice_0483: voice_plan route on Sonnet 5, effort medium, 3000 max tokens');
end $$;

-- ---------------------------------------------------------------- 7. staff RPCs
-- Same gate as the rest of CC → Riley (cc_riley_calls): view = comm.view / comm.manage / support.view / dispatch.manage /
-- settings.manage; write = comm.manage / dispatch.manage / settings.manage.
create or replace function app_private.riley_plan_json(p app_private.riley_call_plans)
returns jsonb
language sql
stable
set search_path to 'app_private', 'public'
as $function$
  select jsonb_build_object(
    'id', p.id, 'org_id', p.org_id, 'org_name', (select o.name from public.organizations o where o.id = p.org_id),
    'contact_name', p.contact_name, 'to_number', p.to_number, 'contact_role', p.contact_role, 'consent', p.consent,
    'reason', p.reason, 'note', p.note, 'lang', p.lang, 'status', p.status, 'job_id', p.job_id,
    'plan_text', p.plan_text, 'plan', p.plan, 'confidence', p.confidence, 'review_note', p.review_note, 'error', p.error,
    'call_id', p.call_id, 'created_by', p.created_by,
    'created_by_name', (select coalesce(nullif(pr.contact_name, ''), pr.email) from public.profiles pr where pr.id = p.created_by),
    'created_at', p.created_at, 'updated_at', p.updated_at, 'closed_at', p.closed_at,
    -- plan §9 cost line: Retell ≈ $0.13/min all-in + the brain job. The estimate is shown, never billed.
    'cost', jsonb_build_object('retell_per_min', 0.13, 'est_minutes', p.est_minutes, 'brain_usd', round(p.brain_usd, 4),
                               'est_total', round(p.est_minutes * 0.13 + p.brain_usd, 2)),
    'job', (select jsonb_build_object('status', j.status, 'model', j.model, 'effort', j.effort, 'usd', round(j.usd, 4), 'tool_calls', j.tool_calls,
                                      'error', j.error, 'created_at', j.created_at,
                                      'secs', round(extract(epoch from (coalesce(j.done_at, now()) - j.created_at))::numeric, 1))
              from app_private.brain_jobs j where j.id = p.job_id),
    'dial_tool', (select jsonb_build_object('enabled', t.enabled, 'mode', t.mode, 'status', t.status)
                    from app_private.brain_permissions t where t.key = 'tool.schedule_riley_call'));
$function$;
revoke all on function app_private.riley_plan_json(app_private.riley_call_plans) from public, anon, authenticated;

create or replace function public.cc_riley_plan_create(p_org uuid, p_reason text, p_note text default null, p_lang text default 'en')
returns jsonb
language plpgsql
security definer
set search_path to 'app_private', 'public', 'extensions'
as $function$
declare v_org public.organizations; v_prof public.profiles; v_p app_private.riley_call_plans; v_num text; v_digits text;
        v_consent jsonb; v_open bigint; v_ctx jsonb; v_q jsonb; v_sms app_private.sms_consent;
begin
  if not (public.has_global_permission('comm.manage') or public.has_global_permission('dispatch.manage') or public.has_global_permission('settings.manage')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('welcome','onboarding_gap','document_missing','choice_pending','no_reply','custom') then
    raise exception 'unknown reason' using errcode = '22023';
  end if;
  select * into v_org from public.organizations where id = p_org;
  if v_org.id is null then raise exception 'carrier not found' using errcode = 'P0002'; end if;
  if v_org.kind <> 'carrier' then return jsonb_build_object('error', 'Call plans are for carriers only (owner rule: no calls to dispatchers — plan §14.2).'); end if;
  if coalesce(v_org.is_demo, false) then return jsonb_build_object('error', 'Demo / store-review accounts are never called.'); end if;
  select * into v_prof from public.profiles where id = v_org.owner_user_id;

  v_digits := regexp_replace(coalesce(v_prof.phone, ''), '[^0-9]', '', 'g');
  if length(v_digits) = 11 and left(v_digits, 1) = '1' then v_digits := right(v_digits, 10); end if;
  if length(v_digits) <> 10 then
    return jsonb_build_object('error', 'No usable US phone number on this carrier''s profile — nothing to plan a call to.');
  end if;
  v_num := '+1' || v_digits;

  -- One open planning job per carrier: return it instead of paying twice.
  select id into v_open from app_private.riley_call_plans where org_id = v_org.id and status = 'planning' and created_at > now() - interval '5 minutes' order by id desc limit 1;
  if v_open is not null then
    select * into v_p from app_private.riley_call_plans where id = v_open;
    return app_private.riley_plan_json(v_p) || jsonb_build_object('reused', true);
  end if;

  -- TCPA basis, recorded on the plan: the signup phone of an existing account (service call about their own account);
  -- an sms_consent row on the number adds the explicit-consent method when there is one.
  select * into v_sms from app_private.sms_consent s where s.revoked_at is null
     and right(regexp_replace(s.number, '[^0-9]', '', 'g'), 10) = v_digits limit 1;
  v_consent := jsonb_build_object(
    'ok',     true,
    'basis',  'existing account — number given at signup; service call about their own account',
    'method', coalesce(v_sms.method, 'signup_phone'),
    'at',     coalesce(v_sms.consented_at, v_prof.created_at),
    'sms_consent', v_sms.number is not null);

  insert into app_private.riley_call_plans (org_id, contact_name, to_number, contact_role, consent, reason, note, lang, created_by)
  values (v_org.id, coalesce(nullif(v_prof.contact_name, ''), nullif(v_prof.legal_owner_name, '')), v_num, 'carrier', v_consent, p_reason,
          nullif(left(btrim(coalesce(p_note, '')), 1500), ''), case when p_lang = 'es' then 'es' else 'en' end, auth.uid())
  returning * into v_p;

  v_ctx := app_private.riley_plan_context(v_p.id);
  v_q := app_private.brain_enqueue('voice', v_p.id::text, 'voice_plan',
           'Write the call plan for ' || coalesce(v_org.name, 'this carrier') || ' (reason: ' || p_reason || ').',
           v_ctx, null, array['get_facts', 'kb_search', 'account_lookup'], v_p.lang);

  update app_private.riley_call_plans
     set job_id = (v_q ->> 'job_id')::bigint,
         status = case when v_q ->> 'status' = 'queued' then 'planning' else 'failed' end,
         error  = case when v_q ->> 'status' = 'queued' then null else coalesce(v_q ->> 'error', 'brain refused the job') end,
         updated_at = now()
   where id = v_p.id
   returning * into v_p;
  return app_private.riley_plan_json(v_p);
end $function$;
revoke execute on function public.cc_riley_plan_create(uuid, text, text, text) from public, anon;
grant  execute on function public.cc_riley_plan_create(uuid, text, text, text) to authenticated, service_role;
comment on function public.cc_riley_plan_create(uuid, text, text, text) is
  'bl_voice_0483: staff (comm.manage / dispatch.manage / settings.manage) ask the brain for a Riley call plan on one carrier. Creates the plan row + brain job (source voice, route voice_plan). Never dials.';

create or replace function public.cc_riley_plans(p_status text default null, p_limit integer default 100, p_org uuid default null)
returns jsonb
language sql
stable
security definer
set search_path to 'app_private', 'public'
as $function$
  select case when not (public.has_global_permission('comm.view') or public.has_global_permission('comm.manage')
                     or public.has_global_permission('support.view') or public.has_global_permission('dispatch.manage')
                     or public.has_global_permission('settings.manage'))
    then jsonb_build_object('error', 'not authorized')
    else jsonb_build_object(
      'can_manage', (public.has_global_permission('comm.manage') or public.has_global_permission('dispatch.manage') or public.has_global_permission('settings.manage')),
      'source_on',  coalesce((select c.enabled from app_private.brain_config c where c.id), false)
                    and coalesce((select p.enabled from app_private.brain_permissions p where p.key = 'source.voice'), false),
      'dial_tool',  (select jsonb_build_object('enabled', t.enabled, 'mode', t.mode, 'status', t.status) from app_private.brain_permissions t where t.key = 'tool.schedule_riley_call'),
      'counts',     (select jsonb_object_agg(s, n) from (select status s, count(*) n from app_private.riley_call_plans group by status) x),
      'usd_30d',    (select coalesce(round(sum(brain_usd)::numeric, 2), 0) from app_private.riley_call_plans where created_at > now() - interval '30 days'),
      'plans',      (select coalesce(jsonb_agg(app_private.riley_plan_json(p) order by p.id desc), '[]'::jsonb)
                       from (select * from app_private.riley_call_plans
                              where (p_status is null or status = p_status) and (p_org is null or org_id = p_org)
                              order by id desc limit greatest(1, least(coalesce(p_limit, 100), 300))) p))
  end;
$function$;
revoke execute on function public.cc_riley_plans(text, integer, uuid) from public, anon;
grant  execute on function public.cc_riley_plans(text, integer, uuid) to authenticated, service_role;

create or replace function public.cc_riley_plan(p_id bigint)
returns jsonb
language sql
stable
security definer
set search_path to 'app_private', 'public'
as $function$
  select case when not (public.has_global_permission('comm.view') or public.has_global_permission('comm.manage')
                     or public.has_global_permission('support.view') or public.has_global_permission('dispatch.manage')
                     or public.has_global_permission('settings.manage'))
    then jsonb_build_object('error', 'not authorized')
    else coalesce((select app_private.riley_plan_json(p) from app_private.riley_call_plans p where p.id = p_id), jsonb_build_object('error', 'plan not found'))
  end;
$function$;
revoke execute on function public.cc_riley_plan(bigint) from public, anon;
grant  execute on function public.cc_riley_plan(bigint) to authenticated, service_role;

create or replace function public.cc_riley_plan_set(p_id bigint, p_action text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'app_private', 'public', 'extensions'
as $function$
declare v_p app_private.riley_call_plans; v_ctx jsonb; v_q jsonb; v_org public.organizations;
begin
  if not (public.has_global_permission('comm.manage') or public.has_global_permission('dispatch.manage') or public.has_global_permission('settings.manage')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  select * into v_p from app_private.riley_call_plans where id = p_id for update;
  if v_p.id is null then return jsonb_build_object('error', 'plan not found'); end if;

  case p_action
    when 'cancel' then
      if v_p.status in ('called', 'cancelled') then return jsonb_build_object('error', 'already closed'); end if;
      update app_private.riley_call_plans set status = 'cancelled', closed_at = now(), updated_at = now(),
             note = case when nullif(btrim(coalesce(p_note, '')), '') is null then note else coalesce(note || E'\n', '') || 'Cancelled: ' || btrim(p_note) end
       where id = p_id returning * into v_p;
    when 'called' then
      -- a person made the call themselves (or Riley did outside this flow): close the plan, keep the text.
      if v_p.status in ('cancelled') then return jsonb_build_object('error', 'plan was cancelled'); end if;
      update app_private.riley_call_plans set status = 'called', closed_at = now(), updated_at = now(),
             note = case when nullif(btrim(coalesce(p_note, '')), '') is null then note else coalesce(note || E'\n', '') || 'Call outcome: ' || btrim(p_note) end
       where id = p_id returning * into v_p;
    when 'edit' then
      if nullif(btrim(coalesce(p_note, '')), '') is null then return jsonb_build_object('error', 'empty plan'); end if;
      if v_p.status in ('called', 'cancelled') then return jsonb_build_object('error', 'plan is closed'); end if;
      update app_private.riley_call_plans set plan_text = left(btrim(p_note), 6000), plan = app_private.riley_plan_parse(left(btrim(p_note), 6000)),
             status = case when status in ('planning', 'failed') then 'ready' else status end, review_note = null, error = null, updated_at = now()
       where id = p_id returning * into v_p;
    when 'redo' then
      if v_p.status in ('called', 'cancelled', 'scheduled') then return jsonb_build_object('error', 'plan is closed or already booked'); end if;
      select * into v_org from public.organizations where id = v_p.org_id;
      if coalesce(v_org.is_demo, false) then return jsonb_build_object('error', 'Demo accounts are never called.'); end if;
      if nullif(btrim(coalesce(p_note, '')), '') is not null then
        update app_private.riley_call_plans set note = left(btrim(p_note), 1500) where id = p_id;
      end if;
      v_ctx := app_private.riley_plan_context(p_id);
      v_q := app_private.brain_enqueue('voice', p_id::text, 'voice_plan',
               'Write the call plan for ' || coalesce(v_org.name, 'this carrier') || ' (reason: ' || v_p.reason || '). This is a redo — staff want a fresh plan.',
               v_ctx, null, array['get_facts', 'kb_search', 'account_lookup'], v_p.lang);
      update app_private.riley_call_plans
         set job_id = (v_q ->> 'job_id')::bigint,
             status = case when v_q ->> 'status' = 'queued' then 'planning' else 'failed' end,
             error  = case when v_q ->> 'status' = 'queued' then null else coalesce(v_q ->> 'error', 'brain refused the job') end,
             review_note = null, updated_at = now()
       where id = p_id returning * into v_p;
    else
      return jsonb_build_object('error', 'unknown action');
  end case;
  return app_private.riley_plan_json(v_p);
end $function$;
revoke execute on function public.cc_riley_plan_set(bigint, text, text) from public, anon;
grant  execute on function public.cc_riley_plan_set(bigint, text, text) to authenticated, service_role;
comment on function public.cc_riley_plan_set(bigint, text, text) is
  'bl_voice_0483: staff actions on a Riley call plan — cancel · called (done by hand, note = outcome) · edit (note = new plan text) · redo (new brain job, note = new staff note).';

-- ---------------------------------------------------------------- 8. proof
-- select key, enabled, status from app_private.brain_permissions where key in ('source.voice','tool.schedule_riley_call');
-- select model_by_route ->> 'voice_plan', effort ->> 'voice_plan', max_tokens ->> 'voice_plan' from app_private.brain_config;
-- select app_private.riley_plan_parse(E'GOAL: a\nOPENER: b\nTALKING POINTS:\n1. x\n2. y\nCONFIRM:\n- p\nDO NOT SAY:\n1. q\nBEST TIME: t\nLANGUAGE: en');
-- select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--  where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');   -- 36 prod / 35 staging, names per docs/audit-2026-09/anon-secdef-baseline.md
