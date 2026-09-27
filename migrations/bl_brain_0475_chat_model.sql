-- bl_brain_0475 — chat on Sonnet 5 (per-route model), honest 1-hour cache prices, named specialists (27 Sep 2026)
--
-- Why:
--   1. Visitor live chat is the highest-volume, lowest-revenue traffic the brain sees. On Fable 5.1 a cold hour costs
--      $0.47 just to write the 23.5k-token system block, and a warm 10-message chat $0.30–0.50. Sonnet 5 is 5–8× cheaper
--      at a quality that beats the Gemini fallback. `model` stays the brain-wide default (staff drafts, verdicts, sweeps
--      keep Fable); `model_by_route` overrides it per route — `{"chat":"claude-sonnet-5"}` to start.
--   2. brain_config.price carried the 5-minute cache-write rate ($12.50/M on Fable) while the `brain` function caches the
--      system block for 1 hour, which is billed at 2× base ($20/M). The CC under-reported every cold job by ~37%
--      (prod job 4: shown $0.31, billed ~$0.48). Prices now match what Anthropic bills for the 1 h TTL.
--   3. rule.chat_specialists — the assistant answers from a named desk (Riley general, Sara billing, Omar onboarding,
--      Ali tech, Maya plans & pricing, Daniel dispatch) by starting the reply with [[as:<desk>]]; the widget (v6) turns
--      that into the avatar, header and "who" line. Same honesty rule as before: asked whether it is a person or an AI,
--      it says plainly that it is an AI assistant on the LoadBoot team and offers a real person.
--
-- Deploy order: `brain` edge function (v2 guard: refusal fallbacks only on Fable/Opus/Mythos) → this migration.
-- Anon-executable SECURITY DEFINER surface: unchanged (nothing new in public; brain_enqueue is app_private, revoked).

begin;

-- ── 1. per-route model ─────────────────────────────────────────────────────────────────────────────────────────────
alter table app_private.brain_config add column if not exists model_by_route jsonb not null default '{}'::jsonb;

update app_private.brain_config
   set model_by_route = model_by_route || '{"chat":"claude-sonnet-5"}'::jsonb,
       price = price
            || '{"claude-fable-5-1":{"in":10,"out":50,"cache_read":0.25,"cache_write":20},
                 "claude-haiku-4-5":{"in":1,"out":5,"cache_read":0.1,"cache_write":2},
                 "claude-sonnet-5":{"in":2,"out":10,"cache_read":0.2,"cache_write":4}}'::jsonb,
       updated_at = now()
 where id;

do $$ begin
  perform app_private.brain_log('config', 'config', '{}'::jsonb,
    jsonb_build_object('model_by_route', '{"chat":"claude-sonnet-5"}'::jsonb,
                       'price', 'cache_write now the 1-hour TTL rate (2× base); claude-sonnet-5 added'),
    'bl_brain_0475: chat route on Sonnet 5; cache-write prices corrected to the 1 h TTL the brain function uses');
end $$;

-- brain_enqueue: identical to 0472 except the model comes from model_by_route ->> route, then brain_config.model.
create or replace function app_private.brain_enqueue(
  p_source text, p_ref_id text, p_route text, p_question text,
  p_context jsonb default '{}'::jsonb, p_fallback text default null,
  p_tools text[] default array['kb_search','get_facts','note','escalate','report_finding'],
  p_lang text default 'en')
returns jsonb language plpgsql security definer set search_path = app_private, public, extensions as $$
declare v_cfg app_private.brain_config; v_job app_private.brain_jobs; v_status text := 'queued'; v_eff text; v_max int;
        v_perm app_private.brain_permissions; v_err text; v_tools text[]; v_model text;
begin
  select * into v_cfg from app_private.brain_config where id;
  v_perm := app_private.brain_perm('source.' || p_source);

  if v_cfg is null or not v_cfg.enabled then
    v_status := 'skipped'; v_err := 'brain disabled (kill switch)';
  elsif v_perm is null or not v_perm.enabled then
    v_status := 'skipped'; v_err := 'source "' || p_source || '" is switched off (CC → AI Brain → Permissions)';
  elsif app_private.brain_spent_today() >= v_cfg.daily_usd_cap then
    v_status := 'capped'; v_err := 'daily cap reached: ' || app_private.brain_spent_today()::text || ' >= ' || v_cfg.daily_usd_cap::text;
  elsif v_perm.usd_cap_daily is not null and app_private.brain_source_spent_today(p_source) >= v_perm.usd_cap_daily then
    v_status := 'capped'; v_err := 'source "' || p_source || '" daily USD cap reached: ' || app_private.brain_source_spent_today(p_source)::text || ' >= ' || v_perm.usd_cap_daily::text;
  elsif v_perm.max_per_day is not null and app_private.brain_source_jobs_today(p_source) >= v_perm.max_per_day then
    v_status := 'capped'; v_err := 'source "' || p_source || '" daily job cap reached: ' || v_perm.max_per_day::text || ' jobs';
  elsif v_cfg.fn_url is null or v_cfg.auth_key is null then
    v_status := 'failed'; v_err := 'brain_config.fn_url/auth_key not set';
  end if;

  v_model := coalesce(nullif(btrim(v_cfg.model_by_route ->> p_route), ''), v_cfg.model);   -- bl_brain_0475
  v_eff := coalesce(v_cfg.effort ->> p_route, 'medium');
  v_max := coalesce((v_cfg.max_tokens ->> p_route)::int, (v_cfg.max_tokens ->> 'default')::int, 16000);
  v_tools := app_private.brain_tools_allowed(p_source, p_tools);

  insert into app_private.brain_jobs (source, ref_id, route, status, lang, question, context, fallback, tools, model, effort, error)
  values (p_source, p_ref_id, p_route, v_status, coalesce(p_lang,'en'), left(coalesce(p_question,''), 8000),
          coalesce(p_context,'{}'::jsonb), p_fallback, v_tools, v_model, v_eff, v_err)
  returning * into v_job;

  if v_status <> 'queued' then
    return jsonb_build_object('job_id', v_job.id, 'status', v_status, 'error', v_job.error);
  end if;

  perform net.http_post(
    url     := v_cfg.fn_url,
    body    := jsonb_build_object(
                 'token',      v_job.token,
                 'job_id',     v_job.id,
                 'source',     p_source,
                 'route',      p_route,
                 'lang',       v_job.lang,
                 'model',      v_model,
                 'effort',     v_eff,
                 'max_tokens', v_max,
                 'max_tool_calls', v_cfg.max_tool_calls,
                 'tools',      to_jsonb(v_tools),
                 'system',     app_private.brain_system(p_route, v_job.lang),
                 'user',       app_private.brain_user_text(p_route, p_source, p_question, p_context),
                 'fallback',   coalesce(p_fallback,'')),
    headers := jsonb_build_object('Content-Type','application/json', 'apikey', v_cfg.auth_key, 'Authorization', 'Bearer ' || v_cfg.auth_key),
    timeout_milliseconds := v_cfg.timeout_ms);

  return jsonb_build_object('job_id', v_job.id, 'status', 'queued', 'tools', to_jsonb(v_tools));
end $$;
revoke execute on function app_private.brain_enqueue(text,text,text,text,jsonb,text,text[],text) from public, anon, authenticated;

-- CC: cc_brain_config_set may patch model_by_route (merge, like effort); the Overview shows it via brain_state → config.
-- (Kept out of this file: the UI field. The owner sets it here for now; the CC Overview shows the resolved chat model.)

-- ── 2. named specialists (a rule row the owner can switch off in CC → AI Brain → Permissions) ──────────────────────
insert into app_private.brain_permissions (key, kind, name, label, description, enabled, mode, risk, status, sources, builtin, note)
values ('rule.chat_specialists', 'rule', 'chat_specialists', 'Live chat answers from a named desk',
  'In the live-chat route (route "chat") start every reply with exactly one desk tag and then answer in that specialist''s '
  'first-person voice: [[as:general]] Riley — greetings, general questions, anything that fits no desk; '
  '[[as:billing]] Sara — invoices, fees, payouts, settlements, factoring, refunds; '
  '[[as:onboarding]] Omar — signup, documents, verification, COI, MC/DOT, account setup; '
  '[[as:tech]] Ali — the app or portal not working, login, bugs, notifications; '
  '[[as:sales]] Maya — pricing, plans, what LoadBoot does, comparisons, demos; '
  '[[as:dispatch]] Daniel — loads, trucks, dispatchers, brokers, rates. '
  'Stay on the same desk for the whole conversation unless the topic clearly moves; a desk change is a hand-over, so say so in one short line. '
  'Sign off as that name only, never as "the AI". If the visitor asks whether they are talking to a person, a bot or an AI, '
  'answer plainly that you are an AI assistant on the LoadBoot team (your desk name stays) and offer a real person right away — never claim or imply that you are human.',
  true, 'allow', 'low', 'live', array['chat'], true,
  'bl_brain_0475 — widget v6 renders the tag as avatar + header. Switch off to go back to a single "Riley" voice.')
on conflict (key) do update set description = excluded.description, enabled = true, mode = 'allow', status = 'live', updated_at = now();

do $$ begin
  perform app_private.brain_log('rule.chat_specialists', 'add', '{}'::jsonb,
    jsonb_build_object('enabled', true, 'mode', 'allow'), 'bl_brain_0475: named specialists in live chat');
end $$;

commit;
