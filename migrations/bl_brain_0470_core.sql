-- bl_brain_0470 — LoadBoot Ops Brain, CORE. One queue, one audit log, one config row, one write-back RPC.
--
-- Plan: docs/livechat/LIVECHAT-CLAUDE-BRAIN-PLAN.md §2 (staging first; §12 gate before prod).
--
-- WHAT THIS ADDS (all in app_private unless said otherwise)
--   brain_config       one row: enabled (kill switch), model, effort per route, daily_usd_cap ($25), spot_check_until,
--                      fn_url/auth_key (how Postgres reaches the edge function), max_tool_calls, price table.
--   brain_jobs         the universal queue. source chat|email|wa|onboarding|dispatch|sales|sweep|voice|test, route,
--                      status queued→running→done|failed, plus skipped (kill switch) and capped (daily cap).
--                      Tokens + usd per job from response.usage.
--   brain_actions      audit: every tool the brain called (kb_search, note, escalate, report_finding, …) with payload
--                      and result. "No brain action without a brain_actions row" (§11).
--   brain_facts        self-updating facts (§10). Seeded from site_facts + the lc-brain FACTS block.
--   brain_usage_daily  per-day tokens/usd; feeds the cap.
--   brain_findings     the owner's inbox for what the brain notices: bug | kb_gap | portal | growth | seo | ads |
--                      process — with evidence and a suggested fix (owner ask, 27 Sep 2026: "jahan bug pakre, fix
--                      mujhe de; live chat train karta rahe; portal improvements; growth/SEO/ads strategy").
--   public.brain_rpc   the ONLY write path for the edge function: token-scoped AND service_role-only.
--   public.cc_brain_status / cc_brain_set   staff (settings.manage): read state, flip the kill switch, set the cap.
--
-- TRUST MODEL (same shape as lc-brain, one step tighter)
--   Postgres mints a one-time job token, builds the whole prompt (rules + facts + KB as the cached system block,
--   the volatile context as the user turn) and POSTs it to the edge function with the anon key. The function
--   talks to Anthropic and writes back ONLY through public.brain_rpc(token, op, payload). brain_rpc is executable
--   by service_role alone (the platform-injected SUPABASE_SERVICE_ROLE_KEY the function already holds) and every
--   op is scoped to the one job the token names. So, unlike lc_brain_write, NO new anon-executable name appears:
--   the anon SECURITY DEFINER surface stays 36 prod / 35 staging, and this file asserts that at the bottom.
--
-- NOT in this file (later sections): chat wiring (§3 — lc_brain_dispatch keeps calling Gemini until then, and
-- lc_brain_jobs is untouched), email, onboarding, the CC Brain screen. brain_sink() is the hook they plug into.
--
-- Cache-read price for claude-fable-5-1 is taken from the Anthropic skill notes ($0.25/MTok); every price lives in
-- brain_config.price so the owner can correct it without a deploy.


-- ── 0. secdef snapshot (compared at the end) ──────────────────────────────────────────────────────────────────────
create temp table _bl0470_secdef_before as
  select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');

-- ── 1. tables ─────────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists app_private.brain_config (
  id               boolean primary key default true check (id),
  enabled          boolean not null default true,
  model            text    not null default 'claude-fable-5-1',
  gate_model       text    not null default 'claude-haiku-4-5',
  effort           jsonb   not null default '{"chat":"low","email":"medium","verdict":"high","handoff":"high","doc":"high","sweep":"medium","test":"low"}'::jsonb,
  max_tokens       jsonb   not null default '{"default":16000,"chat":8000,"test":8000}'::jsonb,
  daily_usd_cap    numeric(8,2) not null default 25.00,
  spot_check_until date,
  fn_url           text,
  auth_key         text,
  timeout_ms       integer not null default 20000,
  max_tool_calls   integer not null default 8,
  price            jsonb   not null default '{
    "claude-fable-5-1": {"in":10, "out":50, "cache_read":0.25, "cache_write":12.5},
    "claude-haiku-4-5": {"in":1,  "out":5,  "cache_read":0.10, "cache_write":1.25}
  }'::jsonb,
  updated_at       timestamptz not null default now()
);

create table if not exists app_private.brain_jobs (
  id             bigserial primary key,
  token          uuid not null unique default gen_random_uuid(),
  source         text not null check (source in ('chat','email','wa','onboarding','dispatch','sales','sweep','voice','test')),
  ref_id         text,
  route          text not null,
  status         text not null default 'queued' check (status in ('queued','running','done','failed','skipped','capped')),
  lang           text not null default 'en',
  question       text,
  context        jsonb not null default '{}'::jsonb,
  fallback       text,
  tools          text[] not null default '{}',
  model          text,
  effort         text,
  input_tokens   integer not null default 0,
  cache_read     integer not null default 0,
  cache_write    integer not null default 0,
  output_tokens  integer not null default 0,
  usd            numeric(10,6) not null default 0,
  tool_calls     integer not null default 0,
  iterations     integer not null default 0,
  result         jsonb,
  error          text,
  created_at     timestamptz not null default now(),
  started_at     timestamptz,
  done_at        timestamptz
);
create index if not exists brain_jobs_created_idx on app_private.brain_jobs (created_at desc);
create index if not exists brain_jobs_open_idx    on app_private.brain_jobs (status) where status in ('queued','running');
create index if not exists brain_jobs_ref_idx     on app_private.brain_jobs (source, ref_id);

create table if not exists app_private.brain_actions (
  id         bigserial primary key,
  job_id     bigint not null references app_private.brain_jobs(id) on delete cascade,
  tool       text not null,
  payload    jsonb,
  result     jsonb,
  ok         boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists brain_actions_job_idx on app_private.brain_actions (job_id);

create table if not exists app_private.brain_facts (
  key        text primary key,
  value      text not null,
  unit       text,
  source     text,
  as_of      date,
  note       text,
  updated_by text not null default 'seed',
  updated_at timestamptz not null default now()
);

create table if not exists app_private.brain_usage_daily (
  day           date primary key,
  jobs          integer not null default 0,
  input_tokens  bigint  not null default 0,
  cache_read    bigint  not null default 0,
  cache_write   bigint  not null default 0,
  output_tokens bigint  not null default 0,
  usd           numeric(10,4) not null default 0,
  updated_at    timestamptz not null default now()
);

create table if not exists app_private.brain_findings (
  id            bigserial primary key,
  kind          text not null check (kind in ('bug','kb_gap','portal','growth','seo','ads','process')),
  surface       text,
  title         text not null,
  detail        text,
  evidence      jsonb,
  suggested_fix text,
  job_id        bigint references app_private.brain_jobs(id) on delete set null,
  status        text not null default 'open' check (status in ('open','accepted','done','dismissed')),
  created_at    timestamptz not null default now(),
  resolved_at   timestamptz
);
create index if not exists brain_findings_open_idx on app_private.brain_findings (status, kind, created_at desc);

-- ── 2. seed config (fn_url / auth_key copied from lc_brain_config, lc-brain → brain) ─────────────────────────────
insert into app_private.brain_config (id, fn_url, auth_key)
select true, replace(c.fn_url, '/lc-brain', '/brain'), c.auth_key
  from app_private.lc_brain_config c where c.id
on conflict (id) do nothing;

-- ── 3. seed facts: site_facts registry + the FACTS block that lc-brain v4 hard-codes ──────────────────────────────
insert into app_private.brain_facts (key, value, unit, source, as_of, updated_by)
select 'site.' || key, value::text, unit, source, as_of, 'site_facts'
  from app_private.site_facts
on conflict (key) do nothing;

insert into app_private.brain_facts (key, value, source, as_of) values
 ('lb.what',        'LoadBoot is a US trucking dispatch service + load board. Four sides: carriers, brokers, shippers, referral partners.', 'lc-brain FACTS', '2026-09-27'),
 ('lb.carrier_fee', 'Carriers: flat 5% of gross, charged ONLY on loads LoadBoot books that actually get paid. Free to join. No contract, no minimum, cancel anytime. NO forced dispatch — the carrier sees rate, miles, deadhead and stops and approves before anything is booked.', 'lc-brain FACTS', '2026-09-27'),
 ('lb.carrier_verification', 'Carrier verification: active MC/DOT authority, certificate of insurance (auto liability + cargo), W-9, signed dispatch agreement. Uploaded and signed in the portal, usually about a day.', 'lc-brain FACTS', '2026-09-27'),
 ('lb.broker_shipper', 'Brokers and shippers post loads FREE, forever. Carriers on the board are FMCSA-verified. Shippers can post direct to carriers with no broker margin on top.', 'lc-brain FACTS', '2026-09-27'),
 ('lb.referral',    'Referral Partner program: 1% of the gross the accounts you refer generate, paid out of LoadBoot''s own fee — the referred party never pays extra.', 'lc-brain FACTS', '2026-09-27'),
 ('lb.money',       'LoadBoot NEVER touches freight money. The broker pays the carrier (or the carrier''s factoring company) directly; LoadBoot invoices its 5% separately, after the carrier has been paid. Factoring: upload the NOA once and payments route to the factor.', 'lc-brain FACTS', '2026-09-27'),
 ('lb.accessorials','Accessorial standards: detention $60/hr after 2 hours free time; TONU $250; layover $250/day; lumper reimbursed 100% with receipt or paid direct by the broker; driver assist typically $75 agreed in writing first; FCFS still starts the detention clock at check-in.', 'lc-brain FACTS', '2026-09-27'),
 ('lb.tracking',    'Every load gets live GPS tracking with geofenced arrive/depart timestamps.', 'lc-brain FACTS', '2026-09-27'),
 ('lb.compliance_line', 'A dispatcher works FOR the carrier and books under the carrier''s own authority. Taking a load you do not own and keeping a margin for arranging the move is brokering — that requires your own broker authority (MC) plus a $75,000 BMC-84 surety bond (49 CFR 371.2). LoadBoot cannot let anyone earn a per-load margin without it.', 'lc-brain FACTS', '2026-09-27'),
 ('lb.hiring',      'Hiring: two doors — salaried dispatcher roles (loadboot.com/careers.html, CV to hello@loadboot.com with "Dispatcher application" in the subject) and the Referral Partner program (1%, not a job). Never quote a salary figure that is not published on the careers page. Never promise anyone work, or work by a date.', 'lc-brain FACTS', '2026-09-27'),
 ('lb.portal_pages','Signed-in carrier pages: Documents (https://loadboot.com/app/carrier/#documents — COI, authority, W-9, dispatch agreement), Fleet (https://loadboot.com/app/carrier/#fleet — trucks with VIN, drivers), Account → Payments (https://loadboot.com/app/carrier/#account/payments — bank or factoring + NOA), Load Board (https://loadboot.com/app/carrier/#loads). A truck can only be posted if its VIN is on the certificate of insurance (error LB001) and saved under Fleet (LB002).', 'lc-brain FACTS', '2026-09-27'),
 ('lb.email',       'Email: hello@loadboot.com (general), dispatch@loadboot.com (dispatch). Website loadboot.com.', 'lc-brain FACTS', '2026-09-27')
on conflict (key) do nothing;

-- ── 4. helpers: price, cap, state ─────────────────────────────────────────────────────────────────────────────────
create or replace function app_private.brain_usd(p_model text, p_in integer, p_cache_read integer, p_cache_write integer, p_out integer)
returns numeric language sql stable set search_path = app_private, public as $$
  with p as (select coalesce(c.price -> p_model, c.price -> c.model) pr from app_private.brain_config c where c.id)
  select round( coalesce(p_in,0)          * coalesce((pr->>'in')::numeric, 10)          / 1e6
              + coalesce(p_cache_read,0)  * coalesce((pr->>'cache_read')::numeric, 1)   / 1e6
              + coalesce(p_cache_write,0) * coalesce((pr->>'cache_write')::numeric, 12.5)/ 1e6
              + coalesce(p_out,0)         * coalesce((pr->>'out')::numeric, 50)         / 1e6, 6)
    from p;
$$;

create or replace function app_private.brain_spent_today()
returns numeric language sql stable set search_path = app_private, public as $$
  select coalesce((select usd from app_private.brain_usage_daily where day = (now() at time zone 'utc')::date), 0);
$$;

create or replace function app_private.brain_state()
returns jsonb language sql stable set search_path = app_private, public as $$
  select jsonb_build_object(
    'enabled',      c.enabled,
    'model',        c.model,
    'cap_usd',      c.daily_usd_cap,
    'spent_today',  app_private.brain_spent_today(),
    'over_cap',     app_private.brain_spent_today() >= c.daily_usd_cap,
    'spot_check',   c.spot_check_until is not null and c.spot_check_until >= current_date,
    'fn_url',       c.fn_url,
    'max_tool_calls', c.max_tool_calls)
  from app_private.brain_config c where c.id;
$$;

-- ── 5. the prompt: frozen rules + facts + KB (cached) ─────────────────────────────────────────────────────────────
-- Everything in brain_rules() and brain_facts_block()/brain_kb_block() must be byte-stable between calls, or the
-- 1-hour prompt cache never hits. No timestamps, no per-job values here — those go in the user turn.
create or replace function app_private.brain_rules()
returns text language sql immutable as $$
select $r$You are the LoadBoot Ops Brain: the assistant that runs LoadBoot's live chat, mailboxes, onboarding, dispatcher support and sales so that no human staff is needed. LoadBoot is a US trucking dispatch service and load board. You talk to carriers, brokers, shippers, dispatchers and referral partners.

WHAT IS TRUE comes from the FACTS block and the KNOWLEDGE BASE below, and from any SIGNED-IN ACCOUNT block in the task. Prefer those wordings. Never contradict them.

HOW TO WORK
- Default to answering. Anything the facts, the knowledge base or the account block covers, you answer yourself — pricing, the 5% fee, contracts, forced dispatch, verification and documents, factoring, detention and accessorials, GPS, who posts free, the referral program, the brokering/authority rule, how to apply. Escalating those is a failure.
- A SIGNED-IN ACCOUNT block is that person's real file and it is authoritative: answer "my"/"me" questions from it and point to the exact portal page. Never guess anything about an account that is not in the block; use account_lookup if the task offers it.
- staff_online=false means nobody is at the desk. Never say a person is available or "will reply in a moment"; say the team follows up (email/here) and offer the 24/7 phone line from the facts. staff_online=true means a human can be pulled in now.
- Be short and concrete. Under 110 words for chat, under 180 for email, plain sentences, no salesy padding. Answer in the visitor's language (en or es). Ask at most one question per reply. Simple HTML <b>/<i> allowed; a chat reply may end with ONE chip line: [[chips:Label=text|Label2=text]].
- Use tools when they help: kb_search before saying "I don't know"; note for internal remarks; report_finding when you see a bug, a knowledge-base gap, a portal improvement, or a growth/SEO/ads idea worth the owner's time; escalate when a person must decide.

NEVER (hard rules, not preferences)
- Never invent or estimate a number we have not been given: carrier/truck/driver/load/customer counts, years in business, review scores, salary figures, market rates. Say plainly that you will not invent a number and ask for lane and equipment so a person can answer straight.
- Never promise that a load will be covered, or by when. Never promise a job or a start date. Never quote a rate-per-mile from memory.
- Never quote any phone number other than the one in the facts. Never give legal, tax or financial advice beyond the compliance facts. Never ask for a password, card number, bank details or any government ID. Never claim a feature exists if it is not in the facts or the knowledge base.
- Never decide or act on money (payouts, commissions, refunds, bank changes, disputes), partnership, legal/claims, press, regulation approvals, or an angry customer you are not confident about: prepare (summary + suggested reply) and escalate.
- Never repeat an answer the person already received — say something new or escalate.

OUTPUT — return exactly one JSON object and nothing else:
{"reply": string, "lang": "en"|"es", "confidence": number 0..1, "escalate": boolean, "escalate_reason": string, "actions": string[]}
- reply: the message to send (empty string only when escalate is true and you have nothing useful to say — avoid that; one or two useful sentences are always better).
- confidence: how sure you are the reply is correct and complete. Below 0.6 you escalate instead of guessing.
- escalate: true when the facts and tools genuinely do not cover it, the person is frustrated or asks for a human, or it needs a decision only a person can make. escalate_reason: one line, empty when not escalating.
- actions: short labels of what you did or recommend (e.g. "kb_search", "reported kb_gap", "needs owner: refund").$r$;
$$;

create or replace function app_private.brain_facts_block()
returns text language sql stable set search_path = app_private, public as $$
  with cc as (select public.lb_contact_channel() j)
  select 'LOADBOOT — WHAT IS TRUE (never contradict this):' || E'\n'
      || coalesce((select string_agg('• ' || f.value || case when f.unit is not null then ' ' || f.unit else '' end
                                     || case when f.key like 'site.%' then ' (' || coalesce(f.source, 'registry') || coalesce(', as of ' || f.as_of::text, '') || ')' else '' end,
                                     E'\n' order by f.key)
                     from app_private.brain_facts f), '')
      || E'\n• Contact: ' || coalesce((select j->'one'->>'text' from cc),
                                       'ONE number for calls and WhatsApp — +1 (815) 365-1168 (WhatsApp link https://wa.me/18153651168)')
      || '. Never quote any other phone number.';
$$;

create or replace function app_private.brain_kb_block(p_lang text default 'en')
returns text language sql stable set search_path = app_private, public as $$
  select 'KNOWLEDGE BASE (our own approved answers, highest authority — prefer these wordings):' || E'\n'
      || coalesce((select string_agg('[' || k.id || '] ' || array_to_string(k.patterns, ', ') || E'\n' || k.answer, E'\n---\n' order by k.priority desc, k.id)
                     from app_private.lc_kb k where k.lang = coalesce(p_lang, 'en')), '(empty)');
$$;

create or replace function app_private.brain_system(p_route text, p_lang text default 'en')
returns jsonb language sql stable set search_path = app_private, public as $$
  select jsonb_build_array(
    jsonb_build_object('text', app_private.brain_rules()),
    jsonb_build_object('text', app_private.brain_facts_block() || E'\n\n' || app_private.brain_kb_block(p_lang), 'cache', true));
$$;

-- The volatile user turn. Generic in §2; §3+ add per-route renderers in front of the default branch.
create or replace function app_private.brain_user_text(p_route text, p_source text, p_question text, p_context jsonb)
returns text language sql stable set search_path = app_private, public as $$
  select 'ROUTE: ' || p_route || ' · SOURCE: ' || p_source || E'\n\n'
      || 'CONTEXT (json):' || E'\n' || left(coalesce(jsonb_pretty(coalesce(p_context, '{}'::jsonb)), '{}'), 14000) || E'\n\n'
      || 'TASK / NEW MESSAGE:' || E'\n' || left(coalesce(p_question, ''), 6000) || E'\n\n'
      || 'Respond with the single JSON object described in your rules.';
$$;

-- ── 6. enqueue: kill switch → cap → job row → pg_net POST ─────────────────────────────────────────────────────────
create or replace function app_private.brain_enqueue(
  p_source text, p_ref_id text, p_route text, p_question text,
  p_context jsonb default '{}'::jsonb, p_fallback text default null,
  p_tools text[] default array['kb_search','get_facts','note','escalate','report_finding'],
  p_lang text default 'en')
returns jsonb language plpgsql security definer set search_path = app_private, public, extensions as $$
declare v_cfg app_private.brain_config; v_job app_private.brain_jobs; v_status text := 'queued'; v_eff text; v_max int;
begin
  select * into v_cfg from app_private.brain_config where id;
  if v_cfg is null or not v_cfg.enabled then v_status := 'skipped';
  elsif app_private.brain_spent_today() >= v_cfg.daily_usd_cap then v_status := 'capped';
  elsif v_cfg.fn_url is null or v_cfg.auth_key is null then v_status := 'failed';
  end if;

  v_eff := coalesce(v_cfg.effort ->> p_route, 'medium');
  v_max := coalesce((v_cfg.max_tokens ->> p_route)::int, (v_cfg.max_tokens ->> 'default')::int, 16000);

  insert into app_private.brain_jobs (source, ref_id, route, status, lang, question, context, fallback, tools, model, effort, error)
  values (p_source, p_ref_id, p_route, v_status, coalesce(p_lang,'en'), left(coalesce(p_question,''), 8000),
          coalesce(p_context,'{}'::jsonb), p_fallback, coalesce(p_tools,'{}'), v_cfg.model, v_eff,
          case v_status when 'skipped' then 'brain disabled (kill switch)'
                        when 'capped'  then 'daily cap reached: ' || app_private.brain_spent_today()::text || ' >= ' || v_cfg.daily_usd_cap::text
                        when 'failed'  then 'brain_config.fn_url/auth_key not set' end)
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
                 'model',      v_cfg.model,
                 'effort',     v_eff,
                 'max_tokens', v_max,
                 'max_tool_calls', v_cfg.max_tool_calls,
                 'tools',      to_jsonb(coalesce(p_tools,'{}'::text[])),
                 'system',     app_private.brain_system(p_route, v_job.lang),
                 'user',       app_private.brain_user_text(p_route, p_source, p_question, p_context),
                 'fallback',   coalesce(p_fallback,'')),
    headers := jsonb_build_object('Content-Type','application/json', 'apikey', v_cfg.auth_key, 'Authorization', 'Bearer ' || v_cfg.auth_key),
    timeout_milliseconds := v_cfg.timeout_ms);

  return jsonb_build_object('job_id', v_job.id, 'status', 'queued');
end $$;
revoke execute on function app_private.brain_enqueue(text,text,text,text,jsonb,text,text[],text) from public, anon, authenticated;

-- ── 7. tools the brain may call (executed HERE, never in the function) ────────────────────────────────────────────
create or replace function app_private.brain_tool_exec(p_job app_private.brain_jobs, p_tool text, p_input jsonb)
returns jsonb language plpgsql security definer set search_path = app_private, public, extensions as $$
declare v_q text; v_user uuid; v_id bigint;
begin
  if not (p_tool = any (p_job.tools)) then
    return jsonb_build_object('error', 'tool "' || p_tool || '" is not enabled for this job');
  end if;

  case p_tool
    when 'kb_search' then
      v_q := left(coalesce(p_input ->> 'query', ''), 500);
      return jsonb_build_object('results', coalesce((
        select jsonb_agg(jsonb_build_object('id', k.id, 'patterns', k.patterns, 'answer', k.answer) order by s desc)
          from (select k.*, extensions.similarity(array_to_string(k.patterns,' '), lower(v_q))
                          + case when exists (select 1 from unnest(k.patterns) kw where position(lower(kw) in lower(v_q)) > 0) then 1 else 0 end s
                  from app_private.lc_kb k where k.lang = coalesce(p_input ->> 'lang', p_job.lang, 'en')
                 order by s desc limit least(coalesce((p_input->>'limit')::int, 5), 10)) k), '[]'::jsonb));

    when 'get_facts' then
      return jsonb_build_object('facts', (select jsonb_object_agg(f.key, f.value || coalesce(' ' || f.unit, '')) from app_private.brain_facts f));

    when 'account_lookup' then
      -- Only the account already attached to this job. The brain never looks up arbitrary people.
      v_user := nullif(p_job.context ->> 'user_id', '')::uuid;
      if v_user is null then return jsonb_build_object('error', 'no signed-in account on this job'); end if;
      return jsonb_build_object('account', app_private.lc_account_snapshot(v_user));

    when 'note' then
      return jsonb_build_object('ok', true);

    when 'escalate' then
      return jsonb_build_object('ok', true, 'note', 'recorded; a person will be told through the source''s own handoff');

    when 'report_finding' then
      if coalesce(p_input ->> 'kind','') not in ('bug','kb_gap','portal','growth','seo','ads','process')
         or nullif(btrim(coalesce(p_input ->> 'title','')), '') is null then
        return jsonb_build_object('error', 'kind must be one of bug|kb_gap|portal|growth|seo|ads|process and title is required');
      end if;
      insert into app_private.brain_findings (kind, surface, title, detail, evidence, suggested_fix, job_id)
      values (p_input ->> 'kind', left(p_input ->> 'surface', 120), left(p_input ->> 'title', 200),
              left(p_input ->> 'detail', 4000), p_input -> 'evidence', left(p_input ->> 'suggested_fix', 4000), p_job.id)
      returning id into v_id;
      return jsonb_build_object('ok', true, 'finding_id', v_id);

    else
      return jsonb_build_object('error', 'unknown tool "' || p_tool || '"');
  end case;
end $$;
revoke execute on function app_private.brain_tool_exec(app_private.brain_jobs,text,jsonb) from public, anon, authenticated;

-- Where a finished job goes. §2 knows only 'test' (nothing to deliver). §3 adds 'chat' (write to lc_messages),
-- §4 'email', and so on — each section adds ONE branch here, nothing else changes.
create or replace function app_private.brain_sink(p_job app_private.brain_jobs)
returns void language plpgsql security definer set search_path = app_private, public as $$
begin
  case p_job.source
    when 'test' then null;
    else null;  -- no sink yet for this source: the result stays on brain_jobs.result for the CC screen
  end case;
end $$;
revoke execute on function app_private.brain_sink(app_private.brain_jobs) from public, anon, authenticated;

-- ── 8. the ONE write-back RPC: service_role only, token-scoped, four ops ──────────────────────────────────────────
create or replace function public.brain_rpc(p_token uuid, p_op text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_job app_private.brain_jobs; v_role text; v_res jsonb; v_usage jsonb; v_usd numeric; v_model text;
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
      if v_job.tool_calls >= (select max_tool_calls from app_private.brain_config where id) then
        v_res := jsonb_build_object('error', 'tool budget for this job is spent; answer now with what you have');
      else
        begin
          v_res := app_private.brain_tool_exec(v_job, coalesce(p_payload ->> 'name',''), coalesce(p_payload -> 'input', '{}'::jsonb));
        exception when others then
          v_res := jsonb_build_object('error', left(sqlerrm, 300));
        end;
      end if;
      insert into app_private.brain_actions (job_id, tool, payload, result, ok)
      values (v_job.id, coalesce(p_payload ->> 'name','?'), p_payload -> 'input', v_res, (v_res ->> 'error') is null);
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
      if p_op = 'done' then perform app_private.brain_sink(v_job); end if;
      return jsonb_build_object('ok', true, 'job_id', v_job.id, 'status', v_job.status, 'usd', v_usd);

    else
      return jsonb_build_object('ok', false, 'error', 'unknown op');
  end case;
end $$;
revoke execute on function public.brain_rpc(uuid, text, jsonb) from public, anon, authenticated;
grant  execute on function public.brain_rpc(uuid, text, jsonb) to service_role;

-- ── 9. staff: status + kill switch + cap (settings.manage) ────────────────────────────────────────────────────────
create or replace function public.cc_brain_status()
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
begin
  if not public.has_global_permission('settings.manage') then raise exception 'not authorized' using errcode = '42501'; end if;
  return jsonb_build_object(
    'state', app_private.brain_state(),
    'today', (select to_jsonb(u) from app_private.brain_usage_daily u where u.day = (now() at time zone 'utc')::date),
    'last_7d', (select coalesce(jsonb_agg(to_jsonb(u) order by u.day desc), '[]'::jsonb) from app_private.brain_usage_daily u where u.day > current_date - 7),
    'open_findings', (select count(*) from app_private.brain_findings where status = 'open'),
    'jobs', (select coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'source', j.source, 'route', j.route, 'status', j.status,
               'usd', j.usd, 'cache_read', j.cache_read, 'input', j.input_tokens, 'output', j.output_tokens, 'tool_calls', j.tool_calls,
               'error', j.error, 'created_at', j.created_at, 'done_at', j.done_at) order by j.id desc), '[]'::jsonb)
             from (select * from app_private.brain_jobs order by id desc limit 30) j));
end $$;
revoke execute on function public.cc_brain_status() from public, anon;
grant  execute on function public.cc_brain_status() to authenticated, service_role;

create or replace function public.cc_brain_set(p_enabled boolean default null, p_daily_usd_cap numeric default null, p_spot_check_until date default null)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
begin
  if not public.has_global_permission('settings.manage') then raise exception 'not authorized' using errcode = '42501'; end if;
  update app_private.brain_config
     set enabled = coalesce(p_enabled, enabled),
         daily_usd_cap = coalesce(p_daily_usd_cap, daily_usd_cap),
         spot_check_until = coalesce(p_spot_check_until, spot_check_until),
         updated_at = now()
   where id;
  return app_private.brain_state();
end $$;
revoke execute on function public.cc_brain_set(boolean, numeric, date) from public, anon;
grant  execute on function public.cc_brain_set(boolean, numeric, date) to authenticated, service_role;

-- ── 10. staging gate helpers + housekeeping ───────────────────────────────────────────────────────────────────────
create or replace function app_private.brain_test_enqueue(p_n integer default 1, p_question text default null)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare i int; v jsonb; out jsonb := '[]'::jsonb;
  qs text[] := array[
    'A carrier asks in chat: what does LoadBoot charge, and when do I pay?',
    'Un transportista pregunta: ¿cuánto cobra LoadBoot y cuándo se paga?',
    'Visitor asks: how many carriers do you have on the board right now?',
    'Visitor asks: can you guarantee me 3 loads a week in Texas?',
    'Visitor: my COI got rejected, why? (no signed-in account on this job)',
    'Visitor asks: what is the detention rate you negotiate?',
    'Visitor asks: I am a dispatcher, can I take loads and keep a margin?',
    'Visitor asks: what phone number can I call at 2am?',
    'Visitor asks: are you a bot?',
    'Broker asks: does it cost anything to post loads?'];
begin
  for i in 1..greatest(coalesce(p_n,1),1) loop
    v := app_private.brain_enqueue('test', 'gate-' || i, 'test',
           coalesce(p_question, qs[1 + ((i-1) % array_length(qs,1))]),
           jsonb_build_object('staff_online', false, 'visitor_role', 'carrier', 'page', '/'),
           null, array['kb_search','get_facts','note','escalate','report_finding'],
           case when i % 2 = 0 and p_question is null then 'es' else 'en' end);
    out := out || v;
  end loop;
  return out;
end $$;
revoke execute on function app_private.brain_test_enqueue(integer, text) from public, anon, authenticated;

create or replace function app_private.brain_gate_report()
returns table (job_id bigint, status text, lang text, model text, input_tokens int, cache_read int, cache_write int,
               output_tokens int, usd numeric, tool_calls int, iterations int, confidence text, escalate text,
               reply text, error text, secs numeric)
language sql stable set search_path = app_private, public as $$
  select j.id, j.status, j.lang, j.model, j.input_tokens, j.cache_read, j.cache_write, j.output_tokens, j.usd,
         j.tool_calls, j.iterations, j.result ->> 'confidence', j.result ->> 'escalate', left(j.result ->> 'reply', 220), j.error,
         round(extract(epoch from (j.done_at - j.created_at))::numeric, 1)
    from app_private.brain_jobs j where j.source = 'test' order by j.id desc limit 50;
$$;
revoke execute on function app_private.brain_gate_report() from public, anon, authenticated;

create or replace function app_private.brain_housekeep()
returns void language sql security definer set search_path = app_private, public as $$
  update app_private.brain_jobs set status = 'failed', done_at = now(), error = 'timeout: no write-back within 15 minutes'
   where status in ('queued','running') and created_at < now() - interval '15 minutes';
  delete from app_private.brain_jobs where created_at < now() - interval '90 days';
$$;
revoke execute on function app_private.brain_housekeep() from public, anon, authenticated;

do $cron$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and not exists (select 1 from cron.job where jobname = 'brain_housekeep') then
    perform cron.schedule('brain_housekeep', '23 * * * *', $$select app_private.brain_housekeep()$$);
  end if;
end $cron$;

-- ── 11. assertions: the anon SECURITY DEFINER surface did not change by a single NAME ─────────────────────────────
do $chk$
declare added text; removed text; anon_rpc boolean;
begin
  select string_agg(proname, ',') into added from (
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
    except select proname from _bl0470_secdef_before) a;
  select string_agg(proname, ',') into removed from (
    select proname from _bl0470_secdef_before
    except select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')) r;
  if added is not null or removed is not null then
    raise exception 'bl_brain_0470: anon secdef surface changed — added [%] removed [%]', coalesce(added,''), coalesce(removed,'');
  end if;
  if has_function_privilege('anon', 'public.brain_rpc(uuid,text,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.brain_rpc(uuid,text,jsonb)', 'execute') then
    raise exception 'bl_brain_0470: brain_rpc must be service_role only';
  end if;
  if (select count(*) from app_private.brain_config) <> 1 then raise exception 'bl_brain_0470: brain_config must have exactly one row'; end if;
  drop table if exists _bl0470_secdef_before;
end $chk$;

