-- bl_brain_0473 — Ops Brain §3: LIVE CHAT on Claude, Gemini as the fallback.
--
-- Plan: docs/livechat/LIVECHAT-CLAUDE-BRAIN-PLAN.md §3. Gate: §12 (staging first; prod flips source.chat in the CC).
--
-- WHAT CHANGES (one seam, nothing else moves)
--   app_private.lc_brain_dispatch(conv, text, fallback)   is the ONLY place chat reaches a model. lc_bot_step,
--     lc_bot_step_es and lc_on_identified all call it (bl_lc_0312) and keep doing so, unchanged. It now:
--       1. if the brain kill switch is on AND source.chat is enabled → brain_enqueue('chat', …) → Claude
--       2. otherwise, or if the enqueue is capped/failed/raises            → lc_brain_dispatch_gemini (the old body)
--     So flipping source.chat OFF in CC → AI Brain puts chat back on Gemini instantly, no deploy.
--   app_private.lc_bot_deliver(conv, reply, escalate)    the write side of lc_brain_write, factored out so Claude and
--     Gemini deliver through the SAME code: staff-joined check, escalate, repeat-answer guard, the name/email form
--     ask, the lc_messages insert. public.lc_brain_write keeps its name, signature and anon ACL (it is one of the 36)
--     and just calls it after the token check.
--   app_private.brain_sink(job)                           'chat' branch: done → lc_bot_deliver(result); failed →
--     lc_brain_dispatch_gemini(question, fallback), so a Claude outage answers through Gemini, never silence.
--   public.brain_rpc                                      now sinks on 'fail' too (0470 sank on 'done' only).
--   app_private.brain_chat_watchdog()                     every minute: a chat job with no write-back in 60 s is failed
--     and sunk (→ Gemini). A late Claude write finds the token spent and is ignored — no double reply.
--   app_private.brain_user_text                           'chat' renderer: Riley persona line, VISITOR block,
--     SIGNED-IN ACCOUNT block, earlier conversations by the same visitor (memory), transcript, the new message and
--     the closest KB match as a hint. Frozen rules/facts/KB stay in the cached system block (0470).
--   brain_permissions                                     source.chat → status 'live' (enabled stays as it is: the
--     owner flips it); new builtin rule.chat_no_emoji (off) after the staging observation that the model uses emoji.
--   cc_brain_overview                                     the "lc_brain" note now says which engine chat is on.
--
-- NOT in this file: CC Live-chat "AI suggested reply" / "why the brain said this" / brain-vs-human stats (§3 UI
-- items — separate section), lead capture tools (create_lead etc. stay `planned`).
--
-- SECDEF: no new public function. lc_brain_write is re-created with the same ACL. The file asserts the anon
-- SECURITY DEFINER surface did not change by a single NAME (36 prod / 35 staging).


-- ── 0. secdef snapshot (compared at the end) ──────────────────────────────────────────────────────────────────────
create temp table _bl0473_secdef_before as
  select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');

-- ── 1. permissions: source.chat is now real code; one new rule the owner may switch on ─────────────────────────────
update app_private.brain_permissions
   set status = 'live',
       description = 'Website / portal live chat replies (plan §3). ON = Claude answers through brain_enqueue; OFF = chat falls back to Gemini (lc-brain v4) instantly. Claude failures and timeouts also fall back to Gemini.',
       updated_at = now()
 where key = 'source.chat';

insert into app_private.brain_permissions (key, kind, name, label, description, enabled, mode, risk, status, builtin) values
 ('rule.chat_no_emoji', 'rule', 'chat_no_emoji', 'No emoji in replies',
  'Never put emoji in a reply. Plain text and simple <b>/<i> only. (Staging gate 27 Sep 2026: the model used emoji freely; switch on if you want them gone.)',
  false, 'deny', 'low', 'live', true)
on conflict (key) do nothing;

-- ── 2. the write side of a bot reply, shared by Claude (brain_sink) and Gemini (lc_brain_write) ───────────────────
create or replace function app_private.lc_bot_deliver(p_conv uuid, p_reply text, p_escalate boolean)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare
  v_conv app_private.lc_conversations;
  v_last text; v_asks int; v_bot int; v_ask text := ''; v_body text; v_es boolean;
begin
  select * into v_conv from app_private.lc_conversations where id = p_conv;
  if v_conv is null then return jsonb_build_object('ok', false, 'error', 'no conversation'); end if;
  v_es := coalesce(v_conv.lang,'en') = 'es';

  if v_conv.mode = 'human' and exists (select 1 from app_private.lc_messages
        where conversation_id = p_conv and sender = 'staff') then
    return jsonb_build_object('ok', true, 'skipped', 'staff already joined');
  end if;

  v_body := nullif(btrim(coalesce(p_reply,'')), '');

  if coalesce(p_escalate, false) or v_body is null then
    perform app_private.lc_escalate(p_conv, coalesce(v_body,
      case when v_es then 'Déjeme poner a una persona real en esto — le responderá aquí mismo. 🙏'
           else 'Let me get a real person on this — they will reply right here. 🙏' end));
    return jsonb_build_object('ok', true, 'escalated', true);
  end if;

  select body into v_last from app_private.lc_messages
   where conversation_id = p_conv and sender = 'bot' order by id desc limit 1;

  if v_body = coalesce(v_last,'') then
    perform app_private.lc_escalate(p_conv,
      case when v_es then 'Ya le di esa misma respuesta una vez, así que claramente no era lo que buscaba. 🙏 Mejor le paso con una persona real.'
           else 'I have already given you that answer once, so it clearly was not what you were after. 🙏 Let me get a real person on it.' end);
    return jsonb_build_object('ok', true, 'escalated', true, 'reason', 'repeat');
  end if;

  select count(*), count(*) filter (where body like '%[[form:%')
    into v_bot, v_asks
    from app_private.lc_messages where conversation_id = p_conv and sender = 'bot';

  if v_conv.email is null and v_bot >= 1 and v_asks < 3
     and coalesce(v_last,'') not like '%[[form:%' and v_body not like '%[[form:%' then
    v_ask := case when v_es then
        e'\n\n— Y para que esto no se quede solo en mí: déjeme su nombre y su mejor correo y una persona real de nuestro equipo le da seguimiento como se debe. Puede seguir preguntándome igual. 👇\n\n[[form:name,email]]'
      else
        e'\n\n— And so this does not stop at me: leave your name and best email and a real person from our team follows up properly. You can keep asking me things either way. 👇\n\n[[form:name,email]]'
      end;
  end if;

  insert into app_private.lc_messages (conversation_id, sender, body)
    values (p_conv, 'bot', v_body || v_ask);
  update app_private.lc_conversations
     set bot_misses = 0, answers_given = answers_given + 1, last_msg_at = now()
   where id = p_conv;

  return jsonb_build_object('ok', true, 'wrote', true);
end $$;
revoke execute on function app_private.lc_bot_deliver(uuid, text, boolean) from public, anon, authenticated;

-- Same name, same signature, same ACL (anon-executable token write for the lc-brain function). Body = token check
-- + lc_bot_deliver. Behaviour identical to bl_lc_0312's version.
create or replace function public.lc_brain_write(p_token uuid, p_reply text, p_escalate boolean, p_source text)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_job app_private.lc_brain_jobs;
begin
  select * into v_job from app_private.lc_brain_jobs
   where token = p_token and used_at is null and created_at > now() - interval '3 minutes'
   for update;
  if v_job is null then return jsonb_build_object('ok', false, 'error', 'unknown or expired token'); end if;
  update app_private.lc_brain_jobs set used_at = now(), source = p_source where token = p_token;
  return app_private.lc_bot_deliver(v_job.conv, p_reply, p_escalate);
end $$;

-- ── 3. the Gemini path, verbatim from bl_lc_0312, under its own name ─────────────────────────────────────────────
create or replace function app_private.lc_brain_dispatch_gemini(p_conv uuid, p_text text, p_fallback text)
returns void language plpgsql security definer set search_path = app_private, public, extensions as $$
declare v_cfg app_private.lc_brain_config; v_token uuid;
begin
  select * into v_cfg from app_private.lc_brain_config where id;
  if v_cfg is null or not v_cfg.enabled then return; end if;

  insert into app_private.lc_brain_jobs (conv, fallback, question)
    values (p_conv, p_fallback, left(coalesce(p_text,''), 4000))
    returning token into v_token;

  perform net.http_post(
    url     := v_cfg.fn_url,
    body    := jsonb_build_object(
                 'token',    v_token,
                 'model',    v_cfg.model,
                 'question', left(coalesce(p_text,''), 4000),
                 'fallback', coalesce(p_fallback,''),
                 'context',  app_private.lc_brain_context(p_conv, p_text)),
    headers := jsonb_build_object(
                 'Content-Type',  'application/json',
                 'apikey',        v_cfg.auth_key,
                 'Authorization', 'Bearer ' || v_cfg.auth_key),
    timeout_milliseconds := v_cfg.timeout_ms);
end $$;
revoke execute on function app_private.lc_brain_dispatch_gemini(uuid, text, text) from public, anon, authenticated;

-- ── 4. chat context for Claude: who, where, their account, their earlier conversations, the transcript ───────────
-- No KB facts here (the whole KB is in the cached system block). user_id is what brain_tool_exec('account_lookup')
-- reads. Memory: up to 2 earlier conversations by the same visitor_key / email / user, 8 messages each.
create or replace function app_private.lc_brain_chat_context(p_conv uuid, p_text text)
returns jsonb language sql stable set search_path = app_private, public, extensions as $$
with c as (select * from app_private.lc_conversations where id = p_conv),
hist as (
  select jsonb_agg(x order by x_id) j from (
    select m.id x_id,
           jsonb_build_object('who', case m.sender when 'visitor' then 'visitor' when 'staff' then 'human agent' else 'assistant' end,
                              'body', left(m.body, 900)) x
    from app_private.lc_messages m
    where m.conversation_id = p_conv and m.body not like '[[note]]%' and m.body not like '[[sys]]%'
      -- the message being answered is already in lc_messages (lc_send inserts before lc_bot_step); it goes in the
      -- NEW MESSAGE section, not the transcript, or the model sees it twice and thinks the visitor repeated it
      and m.id is distinct from (select max(x.id) from app_private.lc_messages x
                                   where x.conversation_id = p_conv and x.sender = 'visitor' and x.body = left(trim(p_text), 2000))
    order by m.id desc limit 20
  ) z
),
prior as (
  select jsonb_agg(jsonb_build_object(
           'when', to_char(c2.created_at, 'YYYY-MM-DD'), 'status', c2.status, 'lead_stage', c2.lead_stage,
           'messages', (select jsonb_agg(jsonb_build_object('who', case m.sender when 'visitor' then 'visitor' when 'staff' then 'human agent' else 'assistant' end,
                                                             'body', left(m.body, 300)) order by m.id)
                          from (select * from app_private.lc_messages m
                                 where m.conversation_id = c2.id and m.body not like '[[note]]%' and m.body not like '[[sys]]%'
                                 order by m.id desc limit 8) m))
         order by c2.created_at desc) j
    from (select c2.* from app_private.lc_conversations c2, c
           where c2.id <> p_conv
             and (c2.visitor_key = c.visitor_key
                  or (c.email is not null and c2.email = c.email)
                  or (c.user_id is not null and c2.user_id = c.user_id))
           order by c2.created_at desc limit 2) c2
)
select jsonb_build_object(
  'lang',         coalesce((select lang from c), app_private.lc_detect_lang(p_text), 'en'),
  'visitor_role', coalesce((select visitor_role from c), 'visitor'),
  'name',         (select name from c),
  'page',         (select page from c),
  'origin',       (select origin from c),
  'has_email',    ((select email from c) is not null),
  'lead_stage',   (select lead_stage from c),
  'staff_online', app_private.lc_staff_online(),
  'user_id',      (select user_id from c),
  'account',      app_private.lc_account_snapshot((select user_id from c)),
  'history',      coalesce((select j from hist), '[]'::jsonb),
  'prior',        coalesce((select j from prior), '[]'::jsonb),
  'kb_hint',      app_private.lc_bot_answer_l2(p_text, coalesce((select lang from c), 'en'), 2.0)
)
$$;
revoke execute on function app_private.lc_brain_chat_context(uuid, text) from public, anon, authenticated;

-- The volatile user turn. 'chat' gets a readable transcript; every other route keeps 0470's generic JSON dump.
create or replace function app_private.brain_user_text(p_route text, p_source text, p_question text, p_context jsonb)
returns text language sql stable set search_path = app_private, public as $$
  select case when p_route = 'chat' then
       'You are answering as Riley, LoadBoot''s live-chat assistant, inside the website / portal chat widget. One visitor, one reply, in the visitor''s language.' || E'\n\n'
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
    || 'Reply under 110 words. Respond with the single JSON object described in your rules.'
  else
       'ROUTE: ' || p_route || ' · SOURCE: ' || p_source || E'\n\n'
    || 'CONTEXT (json):' || E'\n' || left(coalesce(jsonb_pretty(coalesce(p_context, '{}'::jsonb)), '{}'), 14000) || E'\n\n'
    || 'TASK / NEW MESSAGE:' || E'\n' || left(coalesce(p_question, ''), 6000) || E'\n\n'
    || 'Respond with the single JSON object described in your rules.'
  end;
$$;

-- ── 5. the seam: Claude first, Gemini when the brain is off / capped / errors ─────────────────────────────────────
create or replace function app_private.lc_brain_dispatch(p_conv uuid, p_text text, p_fallback text)
returns void language plpgsql security definer set search_path = app_private, public, extensions as $$
declare v_cfg app_private.brain_config; v_perm app_private.brain_permissions; v_ctx jsonb; v_res jsonb; v_tools text[];
begin
  select * into v_cfg from app_private.brain_config where id;
  v_perm := app_private.brain_perm('source.chat');

  if v_cfg is null or not v_cfg.enabled or v_perm is null or not v_perm.enabled then
    perform app_private.lc_brain_dispatch_gemini(p_conv, p_text, p_fallback);
    return;
  end if;

  begin
    v_ctx := app_private.lc_brain_chat_context(p_conv, p_text);
    v_tools := array['kb_search', 'get_facts', 'note', 'escalate', 'report_finding']
               || case when (v_ctx ->> 'user_id') is not null then array['account_lookup'] else '{}'::text[] end;
    v_res := app_private.brain_enqueue('chat', p_conv::text, 'chat', p_text, v_ctx,
                                       p_fallback, v_tools, case when (v_ctx ->> 'lang') = 'es' then 'es' else 'en' end);
  exception when others then
    v_res := jsonb_build_object('status', 'error', 'error', left(sqlerrm, 300));
  end;

  if coalesce(v_res ->> 'status', '') <> 'queued' then
    -- capped / failed / error: the Gemini brain answers, exactly as before this file.
    perform app_private.lc_brain_dispatch_gemini(p_conv, p_text, p_fallback);
  end if;
end $$;
revoke execute on function app_private.lc_brain_dispatch(uuid, text, text) from public, anon, authenticated;

-- ── 6. sink: deliver a finished chat job; fall back when it failed ────────────────────────────────────────────────
create or replace function app_private.brain_sink(p_job app_private.brain_jobs)
returns void language plpgsql security definer set search_path = app_private, public, extensions as $$
declare v_conv uuid;
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
    when 'test' then null;
    else null;  -- no sink yet for this source: the result stays on brain_jobs.result for the CC screen
  end case;
end $$;
revoke execute on function app_private.brain_sink(app_private.brain_jobs) from public, anon, authenticated;

-- ── 7. brain_rpc: identical to 0472 except the sink now runs on 'fail' as well as 'done' ──────────────────────────
create or replace function public.brain_rpc(p_token uuid, p_op text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_job app_private.brain_jobs; v_role text; v_res jsonb; v_usage jsonb; v_usd numeric; v_model text;
        v_outcome text; v_t0 timestamptz;
begin
  v_role := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  if v_role <> 'service_role' and session_user not in ('postgres', 'supabase_admin') then
    raise exception 'brain_rpc: service role only' using errcode = '42501';
  end if;

  select * into v_job from app_private.brain_jobs
   where token = p_token and status in ('queued','running') and created_at > now() - interval '15 minutes'
   for update;
  if v_job is null then return jsonb_build_object('ok', false, 'error', 'unknown, finished or expired token'); end if;

  case p_op
    when 'start' then
      update app_private.brain_jobs set status = 'running', started_at = coalesce(started_at, now()) where id = v_job.id;
      return jsonb_build_object('ok', true, 'job_id', v_job.id);

    when 'tool' then
      v_t0 := clock_timestamp();
      if v_job.tool_calls >= (select max_tool_calls from app_private.brain_config where id) then
        v_res := jsonb_build_object('_outcome', 'denied', 'error', 'tool budget for this job is spent; answer now with what you have');
      else
        begin
          v_res := app_private.brain_tool_exec(v_job, coalesce(p_payload ->> 'name',''), coalesce(p_payload -> 'input', '{}'::jsonb));
        exception when others then
          v_res := jsonb_build_object('_outcome', 'error', 'error', left(sqlerrm, 300));
        end;
      end if;
      v_outcome := coalesce(v_res ->> '_outcome', case when (v_res ->> 'error') is null then 'executed' else 'error' end);
      v_res := v_res - '_outcome';
      insert into app_private.brain_actions (job_id, tool, payload, result, ok, outcome, ms)
      values (v_job.id, coalesce(p_payload ->> 'name','?'), p_payload -> 'input', v_res, (v_res ->> 'error') is null, v_outcome,
              (extract(epoch from (clock_timestamp() - v_t0)) * 1000)::int);
      update app_private.brain_jobs set tool_calls = tool_calls + 1 where id = v_job.id;
      return jsonb_build_object('ok', true, 'result', v_res);

    when 'done', 'fail' then
      v_usage := coalesce(p_payload -> 'usage', '{}'::jsonb);
      v_model := coalesce(p_payload ->> 'model', v_job.model);
      v_usd := app_private.brain_usd(v_model,
                 coalesce((v_usage ->> 'input_tokens')::int, 0),
                 coalesce((v_usage ->> 'cache_read_input_tokens')::int, 0),
                 coalesce((v_usage ->> 'cache_creation_input_tokens')::int, 0),
                 coalesce((v_usage ->> 'output_tokens')::int, 0));
      update app_private.brain_jobs
         set status = case p_op when 'done' then 'done' else 'failed' end,
             done_at = now(), model = v_model,
             input_tokens = coalesce((v_usage ->> 'input_tokens')::int, 0),
             cache_read   = coalesce((v_usage ->> 'cache_read_input_tokens')::int, 0),
             cache_write  = coalesce((v_usage ->> 'cache_creation_input_tokens')::int, 0),
             output_tokens= coalesce((v_usage ->> 'output_tokens')::int, 0),
             usd = v_usd, iterations = coalesce((p_payload ->> 'iterations')::int, 0),
             result = p_payload -> 'result',
             error = case p_op when 'fail' then left(coalesce(p_payload ->> 'error', 'failed'), 600) else null end
       where id = v_job.id returning * into v_job;
      insert into app_private.brain_usage_daily as u (day, jobs, input_tokens, cache_read, cache_write, output_tokens, usd)
      values ((now() at time zone 'utc')::date, 1, v_job.input_tokens, v_job.cache_read, v_job.cache_write, v_job.output_tokens, v_usd)
      on conflict (day) do update set jobs = u.jobs + 1, input_tokens = u.input_tokens + excluded.input_tokens,
        cache_read = u.cache_read + excluded.cache_read, cache_write = u.cache_write + excluded.cache_write,
        output_tokens = u.output_tokens + excluded.output_tokens, usd = u.usd + excluded.usd, updated_at = now();
      -- 0473: the sink sees both outcomes; per source it decides what a failure means (chat → Gemini fallback).
      begin
        perform app_private.brain_sink(v_job);
      exception when others then
        update app_private.brain_jobs set error = left(coalesce(error, '') || ' | sink: ' || sqlerrm, 600) where id = v_job.id;
      end;
      return jsonb_build_object('ok', true, 'job_id', v_job.id, 'status', v_job.status, 'usd', v_usd);

    else
      return jsonb_build_object('ok', false, 'error', 'unknown op');
  end case;
end $$;
revoke execute on function public.brain_rpc(uuid, text, jsonb) from public, anon, authenticated;
grant  execute on function public.brain_rpc(uuid, text, jsonb) to service_role;

-- ── 8. timeouts: chat waits 60 s at most; every timed-out job is sunk, not just marked ───────────────────────────
create or replace function app_private.brain_chat_watchdog()
returns integer language plpgsql security definer set search_path = app_private, public, extensions as $$
declare r app_private.brain_jobs; n int := 0;
begin
  for r in
    update app_private.brain_jobs
       set status = 'failed', done_at = now(), error = 'timeout: no write-back within 60 seconds (chat watchdog)'
     where source = 'chat' and status in ('queued','running') and created_at < now() - interval '60 seconds'
     returning *
  loop
    begin perform app_private.brain_sink(r); exception when others then null; end;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function app_private.brain_chat_watchdog() from public, anon, authenticated;

create or replace function app_private.brain_housekeep()
returns void language plpgsql security definer set search_path = app_private, public, extensions as $$
declare r app_private.brain_jobs;
begin
  for r in
    update app_private.brain_jobs set status = 'failed', done_at = now(), error = 'timeout: no write-back within 15 minutes'
     where status in ('queued','running') and created_at < now() - interval '15 minutes'
     returning *
  loop
    begin perform app_private.brain_sink(r); exception when others then null; end;
  end loop;
  delete from app_private.brain_jobs where created_at < now() - interval '90 days';
end $$;
revoke execute on function app_private.brain_housekeep() from public, anon, authenticated;

do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and not exists (select 1 from cron.job where jobname = 'brain_chat_watchdog') then
    perform cron.schedule('brain_chat_watchdog', '* * * * *', $$select app_private.brain_chat_watchdog()$$);
  end if;
end $cron$;

-- ── 9. CC overview: say which engine chat is on (was a fixed "still on Gemini" note) ─────────────────────────────
create or replace function public.cc_brain_overview()
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_day timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc'; v_chat_on boolean;
begin
  perform app_private.brain_cc_guard();
  v_chat_on := coalesce((select p.enabled from app_private.brain_permissions p where p.key = 'source.chat'), false)
               and coalesce((select c.enabled from app_private.brain_config c where c.id), false);
  return jsonb_build_object(
    'state',   app_private.brain_state(),
    'config',  (select jsonb_build_object('enabled', c.enabled, 'model', c.model, 'gate_model', c.gate_model, 'effort', c.effort,
                  'max_tokens', c.max_tokens, 'daily_usd_cap', c.daily_usd_cap, 'spot_check_until', c.spot_check_until,
                  'fn_url', c.fn_url, 'fn_key_set', c.auth_key is not null, 'timeout_ms', c.timeout_ms,
                  'max_tool_calls', c.max_tool_calls, 'price', c.price, 'updated_at', c.updated_at)
                  from app_private.brain_config c where c.id),
    'today',   (select coalesce(to_jsonb(u), jsonb_build_object('day', current_date, 'jobs', 0, 'usd', 0, 'input_tokens', 0, 'cache_read', 0, 'cache_write', 0, 'output_tokens', 0))
                  from app_private.brain_usage_daily u where u.day = (now() at time zone 'utc')::date),
    'days',    (select coalesce(jsonb_agg(to_jsonb(u) order by u.day), '[]'::jsonb) from app_private.brain_usage_daily u where u.day > current_date - 14),
    'live',    (select coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'source', j.source, 'route', j.route, 'status', j.status,
                  'tool_calls', j.tool_calls, 'created_at', j.created_at, 'started_at', j.started_at, 'question', left(j.question, 140)) order by j.id desc), '[]'::jsonb)
                  from app_private.brain_jobs j where j.status in ('queued','running')),
    'counts',  (select jsonb_build_object(
                  'done_today',   count(*) filter (where status = 'done'),
                  'failed_today', count(*) filter (where status = 'failed'),
                  'skipped_today',count(*) filter (where status in ('skipped','capped')),
                  'escalated_today', count(*) filter (where status = 'done' and (result ->> 'escalate') = 'true'),
                  'avg_secs',     round((avg(extract(epoch from (done_at - created_at))) filter (where status = 'done'))::numeric, 1),
                  'cache_hit_pct', round(100.0 * sum(cache_read) / nullif(sum(cache_read + input_tokens + cache_write), 0)))
                  from app_private.brain_jobs where created_at >= v_day),
    'permissions', (select coalesce(jsonb_agg(app_private.brain_perm_json(p) order by p.kind, p.status, p.key), '[]'::jsonb) from app_private.brain_permissions p),
    'actions', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'job_id', a.job_id, 'source', j.source, 'route', j.route, 'tool', a.tool,
                  'outcome', a.outcome, 'ok', a.ok, 'ms', a.ms, 'bytes', octet_length(coalesce(a.payload::text,'')) + octet_length(coalesce(a.result::text,'')),
                  'summary', left(coalesce(a.payload ->> 'query', a.payload ->> 'title', a.payload ->> 'reason', a.payload ->> 'text', ''), 120),
                  'error', a.result ->> 'error', 'created_at', a.created_at) order by a.id desc), '[]'::jsonb)
                  from (select * from app_private.brain_actions order by id desc limit 40) a
                  join app_private.brain_jobs j on j.id = a.job_id),
    'open_findings', (select count(*) from app_private.brain_findings where status = 'open'),
    'log',     (select coalesce(jsonb_agg(to_jsonb(l) order by l.id desc), '[]'::jsonb) from (select * from app_private.brain_permission_log order by id desc limit 20) l),
    'lc_brain', (select jsonb_build_object(
                  'note', case when v_chat_on then 'Live chat answers through Claude (source.chat ON); Gemini lc-brain is the fallback for caps, errors and timeouts.'
                               else 'Live chat answers through Gemini lc-brain (source.chat OFF). Switch source.chat on to move it to Claude.' end,
                  'chat_on_claude', v_chat_on,
                  'jobs_today', count(*)) from app_private.lc_brain_jobs where created_at >= v_day));
end $$;
revoke execute on function public.cc_brain_overview() from public, anon;
grant  execute on function public.cc_brain_overview() to authenticated, service_role;

-- ── 10. assertions ────────────────────────────────────────────────────────────────────────────────────────────────
do $chk$
declare added text; removed text;
begin
  select string_agg(proname, ',') into added from (
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
    except select proname from _bl0473_secdef_before) a;
  select string_agg(proname, ',') into removed from (
    select proname from _bl0473_secdef_before
    except select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')) r;
  if added is not null or removed is not null then
    raise exception 'bl_brain_0473: anon secdef surface changed — added [%] removed [%]', coalesce(added,''), coalesce(removed,'');
  end if;
  if not has_function_privilege('anon', 'public.lc_brain_write(uuid,text,boolean,text)', 'execute') then
    raise exception 'bl_brain_0473: lc_brain_write must stay anon-executable (the lc-brain function writes through it)';
  end if;
  if has_function_privilege('anon', 'public.brain_rpc(uuid,text,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.brain_rpc(uuid,text,jsonb)', 'execute') then
    raise exception 'bl_brain_0473: brain_rpc must be service_role only';
  end if;
  if (select status from app_private.brain_permissions where key = 'source.chat') <> 'live' then
    raise exception 'bl_brain_0473: source.chat must be live';
  end if;
  if not exists (select 1 from cron.job where jobname = 'brain_chat_watchdog') then
    raise exception 'bl_brain_0473: brain_chat_watchdog cron missing';
  end if;
  drop table if exists _bl0473_secdef_before;
end $chk$;
