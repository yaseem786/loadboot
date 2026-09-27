-- bl_brain_0472 — Ops Brain CONTROL: every permission the brain has, as a row the owner can flip from the CC.
--
-- Owner ask (27 Sep 2026): "CC mein API ka poora system — jo jo AI karay gi, kab karay gi, kitna data use kar rahi
-- hai har action mein real time, har permission ke saath toggle on/off, aur nayi permission add karne ka engine".
--
-- WHAT THIS ADDS (all in app_private unless said otherwise)
--   brain_permissions      ONE registry of everything the brain is allowed to do. Three kinds:
--                            source.<name>  WHEN it runs (chat, email, wa, onboarding, dispatch, sales, sweep, voice, test).
--                                           Off → brain_enqueue files the job as `skipped`, no POST, no spend.
--                                           Per-source caps: jobs/day and USD/day.
--                            tool.<name>    WHAT it may do (kb_search, account_lookup, escalate, report_finding, …).
--                                           Off → the tool is not offered to the model AND brain_tool_exec refuses it
--                                           (belt and braces: the registry is the gate, the tool list is the hint).
--                                           mode 'prep' → the call is RECORDED (brain_actions.outcome='prepared') but
--                                           not executed; per-job and per-day call caps; restrict to some sources.
--                            rule.<name>    Owner policy lines rendered into the cached system block ("NEVER …" /
--                                           "ALLOWED …"). Prompt-level, so a rule the owner types in the CC reaches
--                                           the model on the next job without a deploy.
--                          A tool that is NOT in the registry is denied (fail-closed). Every future migration that
--                          adds a brain tool adds its row here, the way every email gets an email_catalog row.
--   brain_permission_log   who changed what, before/after — every flip, add, delete and config change.
--   brain_actions.outcome  executed | prepared | denied | error  — what actually happened to each tool call.
--   public.cc_brain_*      the CC screen's RPCs (settings.manage): overview (polled every 5 s), permission set/add/
--                          delete, config set, jobs + one job with its actions, findings inbox, facts, a test job.
--
-- ENFORCEMENT lives in Postgres, not in the CC and not in the edge function: brain_enqueue() (source gate, caps,
-- tool filter, rules in the prompt) and brain_tool_exec() (tool gate, mode, caps). The function only ever sees the
-- tools it was handed, and even a tool it invents is refused by name in brain_tool_exec.
--
-- SECDEF: every new public function revokes public + anon (CLAUDE.md §4) and the file asserts the anon-executable
-- SECURITY DEFINER surface did not change by a single NAME (36 prod / 35 staging).


-- ── 0. secdef snapshot (compared at the end) ──────────────────────────────────────────────────────────────────────
create temp table _bl0472_secdef_before as
  select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');

-- ── 1. tables ─────────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists app_private.brain_permissions (
  key            text primary key check (key ~ '^(source|tool|rule)\.[a-z0-9_]{2,48}$'),
  kind           text not null check (kind in ('source','tool','rule')),
  name           text not null,
  label          text not null,
  description    text,
  enabled        boolean not null default false,
  -- tool: auto (execute) | prep (record only, never execute). rule: deny (NEVER …) | allow (ALLOWED …). source: auto.
  mode           text not null default 'auto' check (mode in ('auto','prep','allow','deny')),
  risk           text not null default 'low' check (risk in ('low','medium','high')),
  status         text not null default 'live' check (status in ('live','planned')),   -- planned = row exists, code not yet shipped
  sources        text[],                       -- tool only: which sources may use it (null = all)
  max_per_job    integer check (max_per_job is null or max_per_job >= 0),      -- tool: calls per job
  max_per_day    integer check (max_per_day is null or max_per_day >= 0),      -- tool: calls per day · source: jobs per day
  usd_cap_daily  numeric(8,2) check (usd_cap_daily is null or usd_cap_daily >= 0),   -- source: spend per day
  builtin        boolean not null default false,   -- seeded by a migration: can be switched, not deleted
  note           text,
  created_by     uuid,
  updated_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists brain_permissions_kind_idx on app_private.brain_permissions (kind, enabled);

create table if not exists app_private.brain_permission_log (
  id         bigserial primary key,
  key        text not null,
  action     text not null check (action in ('set','add','delete','config','fact','finding')),
  before     jsonb,
  after      jsonb,
  by_user    uuid,
  by_email   text,
  note       text,
  created_at timestamptz not null default now()
);
create index if not exists brain_permission_log_created_idx on app_private.brain_permission_log (created_at desc);

alter table app_private.brain_actions add column if not exists outcome text not null default 'executed'
  check (outcome in ('executed','prepared','denied','error'));
alter table app_private.brain_actions add column if not exists ms integer;   -- wall time of the tool call in Postgres

-- ── 2. seed: the map from plan §2 / §14 — what exists today (live) and what is planned ────────────────────────────
insert into app_private.brain_permissions (key, kind, name, label, description, enabled, mode, risk, status, builtin, max_per_day, usd_cap_daily) values
 ('source.chat',       'source','chat',       'Live chat',            'Website live chat replies (plan §3). Off until §3 lands — chat still runs on Gemini via lc-brain.', false, 'auto', 'medium', 'planned', true, 2000, 10),
 ('source.email',      'source','email',      'Mailbox (hello@ / dispatch@)', 'Reads and drafts replies in the CC Mailbox (plan §4).', false, 'auto', 'medium', 'planned', true, 1000, 10),
 ('source.wa',         'source','wa',         'WhatsApp',             'Replies on the WhatsApp line (utility only, never marketing).', false, 'auto', 'medium', 'planned', true, 1000, 5),
 ('source.onboarding', 'source','onboarding', 'Onboarding',           'Carrier / dispatcher / partner onboarding follow-ups and document checks (plan §5).', false, 'auto', 'high', 'planned', true, 1000, 10),
 ('source.dispatch',   'source','dispatch',   'Dispatcher ops',       'Load book, rate cons, the carrier bridge, call QA (plan §6).', false, 'auto', 'high', 'planned', true, 1000, 10),
 ('source.sales',      'source','sales',      'Sales',                'Lead → customer sequences, call summaries (plan §7).', false, 'auto', 'medium', 'planned', true, 500, 5),
 ('source.sweep',      'source','sweep',      'Sweeps & digest',      'Scheduled sweeps: facts, findings digest, SEO monitor (plan §8, §10, §15).', false, 'auto', 'low', 'planned', true, 200, 5),
 ('source.voice',      'source','voice',      'Voice (Riley)',        'Riley call plans and post-call work (plan §9).', false, 'auto', 'medium', 'planned', true, 500, 5),
 ('source.test',       'source','test',       'Test jobs',            'Synthetic jobs from SQL or the CC "Try a question" button. Costs real money, delivers nothing.', true, 'auto', 'low', 'live', true, 200, 5)
on conflict (key) do nothing;

insert into app_private.brain_permissions (key, kind, name, label, description, enabled, mode, risk, status, builtin, max_per_job, max_per_day) values
 ('tool.kb_search',      'tool','kb_search',      'Search the knowledge base', 'Reads lc_kb (our approved answers). Read-only.', true, 'auto', 'low', 'live', true, 4, null),
 ('tool.get_facts',      'tool','get_facts',      'Read the facts registry',   'Reads brain_facts (fees, verification, accessorial standards, contact line). Read-only.', true, 'auto', 'low', 'live', true, 2, null),
 ('tool.account_lookup', 'tool','account_lookup', 'Look up the signed-in account', 'Reads ONLY the account attached to the job (documents with review notes, trucks, payment setup). Never arbitrary people.', true, 'auto', 'medium', 'live', true, 2, null),
 ('tool.note',           'tool','note',           'Leave an internal note',    'A staff-only note on the job. Never shown to the customer.', true, 'auto', 'low', 'live', true, 3, null),
 ('tool.escalate',       'tool','escalate',       'Escalate to a person',      'Hands the conversation to a human with a summary and a suggested reply. This is the safe exit — keep it on.', true, 'auto', 'low', 'live', true, 1, null),
 ('tool.report_finding', 'tool','report_finding', 'File a finding for the owner', 'Writes to brain_findings: a bug, a KB gap, a portal idea, a growth / SEO / ads idea. Read in CC → AI Brain → Findings.', true, 'auto', 'low', 'live', true, 3, 200),
 -- planned write tools (plan §2 list). Rows exist so the owner sees the full map and decides BEFORE the code ships.
 ('tool.create_lead',        'tool','create_lead',        'Create a CRM lead',           'Creates a lead in the CRM from a chat / email / call.', false, 'auto', 'medium', 'planned', true, 1, 200),
 ('tool.update_lead_stage',  'tool','update_lead_stage',  'Move a lead between stages',  'Changes a CRM lead stage.', false, 'auto', 'medium', 'planned', true, 2, 500),
 ('tool.send_email',         'tool','send_email',         'Send an email',               'Through sys_email only: catalog key + unsubscribe law + contact switch. Never a raw send.', false, 'prep', 'high', 'planned', true, 1, 300),
 ('tool.send_whatsapp',      'tool','send_whatsapp',      'Send a WhatsApp template',    'Approved utility templates only.', false, 'prep', 'high', 'planned', true, 1, 200),
 ('tool.schedule_riley_call','tool','schedule_riley_call','Schedule a Riley callback',   'Books an outbound Riley call (plan §14.2).', false, 'prep', 'medium', 'planned', true, 1, 100),
 ('tool.send_signup_link',   'tool','send_signup_link',   'Send a signup link',          'Sends the role-specific signup link.', false, 'prep', 'medium', 'planned', true, 1, 200),
 ('tool.request_document',   'tool','request_document',   'Request a document',          'Asks a carrier / dispatcher for a missing document.', false, 'prep', 'medium', 'planned', true, 2, 300),
 ('tool.set_doc_verdict',    'tool','set_doc_verdict',    'Document verdict (advisory)', 'Suggests valid / rejected on a compliance document. Advisory until the owner flips it to auto.', false, 'prep', 'high', 'planned', true, 3, 300),
 ('tool.approve_application','tool','approve_application','Approve an application',      'Approves a carrier / dispatcher application when §5 rules say it is clean.', false, 'prep', 'high', 'planned', true, 1, 100)
on conflict (key) do nothing;

insert into app_private.brain_permissions (key, kind, name, label, description, enabled, mode, risk, status, builtin) values
 ('rule.whatsapp_utility_only', 'rule','whatsapp_utility_only', 'WhatsApp is utility only', 'Never send marketing, promotions or newsletters over WhatsApp — only replies and transactional notices the person expects (owner decision, plan §14.11).', true, 'deny', 'medium', 'live', true),
 ('rule.demo_accounts_invisible','rule','demo_accounts_invisible','Demo accounts are invisible', 'Never mention, count or describe demo / store-review accounts (play.*@loadboot.com, is_demo organisations) in anything a customer can see (CLAUDE.md §4).', true, 'deny', 'high', 'live', true),
 ('rule.owner_decides_money',   'rule','owner_decides_money',   'Money is the owner''s call', 'Payouts, commissions, refunds, settlements, bank or factoring changes and disputes are prepared for the owner, never decided or promised (plan §11).', true, 'deny', 'high', 'live', true)
on conflict (key) do nothing;

-- ── 3. helpers ────────────────────────────────────────────────────────────────────────────────────────────────────
create or replace function app_private.brain_perm(p_key text)
returns app_private.brain_permissions language sql stable set search_path = app_private, public as $$
  select * from app_private.brain_permissions where key = p_key;
$$;

-- Which of the requested tools this source may actually use right now.
create or replace function app_private.brain_tools_allowed(p_source text, p_tools text[])
returns text[] language sql stable set search_path = app_private, public as $$
  select coalesce(array_agg(t order by ord), '{}'::text[])
    from unnest(coalesce(p_tools, '{}'::text[])) with ordinality u(t, ord)
    join app_private.brain_permissions p on p.key = 'tool.' || u.t
   where p.enabled and p.status = 'live'
     and (p.sources is null or p_source = any (p.sources));
$$;

-- Owner rules → text for the cached system block. Byte-stable between calls (ordered by key, no timestamps).
create or replace function app_private.brain_perm_block()
returns text language sql stable set search_path = app_private, public as $$
  select case when count(*) = 0 then ''
         else E'\n\nOWNER PERMISSIONS (set in the Command Center; hard rules, same weight as NEVER above):\n'
              || string_agg(case p.mode when 'allow' then '• ALLOWED: ' else '• NEVER: ' end
                            || p.label || ' — ' || coalesce(p.description, ''), E'\n' order by p.key)
         end
    from app_private.brain_permissions p where p.kind = 'rule' and p.enabled;
$$;

create or replace function app_private.brain_system(p_route text, p_lang text default 'en')
returns jsonb language sql stable set search_path = app_private, public as $$
  select jsonb_build_array(
    jsonb_build_object('text', app_private.brain_rules()),
    jsonb_build_object('text', app_private.brain_facts_block() || E'\n\n' || app_private.brain_kb_block(p_lang) || app_private.brain_perm_block(), 'cache', true));
$$;

create or replace function app_private.brain_source_spent_today(p_source text)
returns numeric language sql stable set search_path = app_private, public as $$
  select coalesce(sum(usd), 0) from app_private.brain_jobs
   where source = p_source and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
$$;

create or replace function app_private.brain_source_jobs_today(p_source text)
returns integer language sql stable set search_path = app_private, public as $$
  select count(*)::int from app_private.brain_jobs
   where source = p_source and status not in ('skipped','capped')
     and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
$$;

create or replace function app_private.brain_log(p_key text, p_action text, p_before jsonb, p_after jsonb, p_note text default null)
returns void language sql security definer set search_path = app_private, public as $$
  insert into app_private.brain_permission_log (key, action, before, after, by_user, by_email, note)
  values (p_key, p_action, p_before, p_after, auth.uid(),
          (select u.email from auth.users u where u.id = auth.uid()), p_note);
$$;
revoke execute on function app_private.brain_log(text,text,jsonb,jsonb,text) from public, anon, authenticated;

-- ── 4. enqueue: kill switch → source permission → caps → tool filter → job row → POST ─────────────────────────────
create or replace function app_private.brain_enqueue(
  p_source text, p_ref_id text, p_route text, p_question text,
  p_context jsonb default '{}'::jsonb, p_fallback text default null,
  p_tools text[] default array['kb_search','get_facts','note','escalate','report_finding'],
  p_lang text default 'en')
returns jsonb language plpgsql security definer set search_path = app_private, public, extensions as $$
declare v_cfg app_private.brain_config; v_job app_private.brain_jobs; v_status text := 'queued'; v_eff text; v_max int;
        v_perm app_private.brain_permissions; v_err text; v_tools text[];
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

  v_eff := coalesce(v_cfg.effort ->> p_route, 'medium');
  v_max := coalesce((v_cfg.max_tokens ->> p_route)::int, (v_cfg.max_tokens ->> 'default')::int, 16000);
  v_tools := app_private.brain_tools_allowed(p_source, p_tools);

  insert into app_private.brain_jobs (source, ref_id, route, status, lang, question, context, fallback, tools, model, effort, error)
  values (p_source, p_ref_id, p_route, v_status, coalesce(p_lang,'en'), left(coalesce(p_question,''), 8000),
          coalesce(p_context,'{}'::jsonb), p_fallback, v_tools, v_cfg.model, v_eff, v_err)
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
                 'tools',      to_jsonb(v_tools),
                 'system',     app_private.brain_system(p_route, v_job.lang),
                 'user',       app_private.brain_user_text(p_route, p_source, p_question, p_context),
                 'fallback',   coalesce(p_fallback,'')),
    headers := jsonb_build_object('Content-Type','application/json', 'apikey', v_cfg.auth_key, 'Authorization', 'Bearer ' || v_cfg.auth_key),
    timeout_milliseconds := v_cfg.timeout_ms);

  return jsonb_build_object('job_id', v_job.id, 'status', 'queued', 'tools', to_jsonb(v_tools));
end $$;
revoke execute on function app_private.brain_enqueue(text,text,text,text,jsonb,text,text[],text) from public, anon, authenticated;

-- ── 5. tool gate: registry → mode → caps → execute. Returns {_outcome: executed|prepared|denied} + the result. ────
create or replace function app_private.brain_tool_exec(p_job app_private.brain_jobs, p_tool text, p_input jsonb)
returns jsonb language plpgsql security definer set search_path = app_private, public, extensions as $$
declare v_q text; v_user uuid; v_id bigint; v_perm app_private.brain_permissions; v_n int;
begin
  v_perm := app_private.brain_perm('tool.' || coalesce(p_tool, ''));

  if v_perm is null or not v_perm.enabled or v_perm.status <> 'live' then
    return jsonb_build_object('_outcome', 'denied', 'error', 'tool "' || coalesce(p_tool,'?') || '" is switched off in the Command Center; do not retry it');
  end if;
  if v_perm.sources is not null and not (p_job.source = any (v_perm.sources)) then
    return jsonb_build_object('_outcome', 'denied', 'error', 'tool "' || p_tool || '" is not allowed for source "' || p_job.source || '"');
  end if;
  if not (p_tool = any (p_job.tools)) then
    return jsonb_build_object('_outcome', 'denied', 'error', 'tool "' || p_tool || '" is not enabled for this job');
  end if;
  if v_perm.max_per_job is not null then
    select count(*) into v_n from app_private.brain_actions a where a.job_id = p_job.id and a.tool = p_tool and a.outcome in ('executed','prepared');
    if v_n >= v_perm.max_per_job then
      return jsonb_build_object('_outcome', 'denied', 'error', 'tool "' || p_tool || '" already used ' || v_n || ' time(s) on this job (limit ' || v_perm.max_per_job || '); answer with what you have');
    end if;
  end if;
  if v_perm.max_per_day is not null then
    select count(*) into v_n from app_private.brain_actions a
     where a.tool = p_tool and a.outcome in ('executed','prepared')
       and a.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
    if v_n >= v_perm.max_per_day then
      return jsonb_build_object('_outcome', 'denied', 'error', 'tool "' || p_tool || '" hit its daily limit (' || v_perm.max_per_day || '); answer with what you have or escalate');
    end if;
  end if;
  if v_perm.mode = 'prep' then
    -- Recorded for the owner, not executed. The model is told so it does not assume the action happened.
    return jsonb_build_object('_outcome', 'prepared', 'prepared', true,
             'note', 'recorded for the owner to approve; NOT executed. Tell the person a human will follow up, do not claim it was done.');
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
      -- In the registry and enabled, but no executor shipped yet (status should be 'planned'). Fail closed.
      return jsonb_build_object('_outcome', 'denied', 'error', 'tool "' || p_tool || '" has no executor yet');
  end case;
end $$;
revoke execute on function app_private.brain_tool_exec(app_private.brain_jobs,text,jsonb) from public, anon, authenticated;

-- ── 6. brain_rpc: same four ops; the 'tool' branch records outcome + ms and strips _outcome before replying ───────
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
      if p_op = 'done' then perform app_private.brain_sink(v_job); end if;
      return jsonb_build_object('ok', true, 'job_id', v_job.id, 'status', v_job.status, 'usd', v_usd);

    else
      return jsonb_build_object('ok', false, 'error', 'unknown op');
  end case;
end $$;
revoke execute on function public.brain_rpc(uuid, text, jsonb) from public, anon, authenticated;
grant  execute on function public.brain_rpc(uuid, text, jsonb) to service_role;

-- ── 7. CC RPCs (settings.manage). Every write is logged to brain_permission_log. ──────────────────────────────────
create or replace function app_private.brain_cc_guard()
returns void language plpgsql stable set search_path = app_private, public as $$
begin
  if not public.has_global_permission('settings.manage') then raise exception 'not authorized' using errcode = '42501'; end if;
end $$;
revoke execute on function app_private.brain_cc_guard() from public, anon, authenticated;

-- One permission row + its live numbers (today / 7 days / last use).
create or replace function app_private.brain_perm_json(p app_private.brain_permissions)
returns jsonb language sql stable set search_path = app_private, public as $$
  select to_jsonb(p) - 'created_by' - 'updated_by' || case p.kind
    when 'tool' then (
      select jsonb_build_object(
        'today',     count(*) filter (where a.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'),
        'week',      count(*),
        'denied_7d', count(*) filter (where a.outcome = 'denied'),
        'prepared_7d', count(*) filter (where a.outcome = 'prepared'),
        'bytes_7d',  coalesce(sum(octet_length(coalesce(a.payload::text,'')) + octet_length(coalesce(a.result::text,''))), 0),
        'avg_ms',    round(avg(a.ms)),
        'last_used', max(a.created_at))
        from app_private.brain_actions a where a.tool = p.name and a.created_at > now() - interval '7 days')
    when 'source' then (
      select jsonb_build_object(
        'today',     count(*) filter (where j.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc' and j.status not in ('skipped','capped')),
        'week',      count(*) filter (where j.status not in ('skipped','capped')),
        'skipped_7d', count(*) filter (where j.status in ('skipped','capped')),
        'failed_7d', count(*) filter (where j.status = 'failed'),
        'usd_today', coalesce(sum(j.usd) filter (where j.created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'), 0),
        'usd_7d',    coalesce(sum(j.usd), 0),
        'tokens_7d', coalesce(sum(j.input_tokens + j.cache_read + j.cache_write + j.output_tokens), 0),
        'avg_secs',  round(avg(extract(epoch from (j.done_at - j.created_at)))::numeric, 1),
        'last_used', max(j.created_at))
        from app_private.brain_jobs j where j.source = p.name and j.created_at > now() - interval '7 days')
    else '{}'::jsonb end;
$$;

create or replace function public.cc_brain_overview()
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_day timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
begin
  perform app_private.brain_cc_guard();
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
    'lc_brain', (select jsonb_build_object('note', 'Live chat still answers through lc-brain (Gemini) until plan §3 moves it here.',
                  'jobs_today', count(*)) from app_private.lc_brain_jobs where created_at >= v_day));
end $$;
revoke execute on function public.cc_brain_overview() from public, anon;
grant  execute on function public.cc_brain_overview() to authenticated, service_role;

-- Patch one permission. Allowed keys in p_patch: enabled, mode, label, description, risk, sources, max_per_job,
-- max_per_day, usd_cap_daily, note. Anything else is ignored. Returns the row with its numbers.
create or replace function public.cc_brain_perm_set(p_key text, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_before app_private.brain_permissions; v_after app_private.brain_permissions; v_mode text;
begin
  perform app_private.brain_cc_guard();
  select * into v_before from app_private.brain_permissions where key = p_key for update;
  if v_before is null then raise exception 'unknown permission %', p_key using errcode = 'P0002'; end if;

  v_mode := coalesce(p_patch ->> 'mode', v_before.mode);
  if (v_before.kind = 'tool' and v_mode not in ('auto','prep'))
     or (v_before.kind = 'rule' and v_mode not in ('allow','deny'))
     or (v_before.kind = 'source' and v_mode <> 'auto') then
    raise exception 'mode "%" is not valid for a %', v_mode, v_before.kind using errcode = '22023';
  end if;
  if v_before.kind = 'tool' and v_before.status = 'planned' and coalesce((p_patch ->> 'enabled')::boolean, false) then
    raise exception 'tool "%" has no executor yet (planned) — it can be configured but not switched on', v_before.name using errcode = '22023';
  end if;

  update app_private.brain_permissions set
    enabled       = coalesce((p_patch ->> 'enabled')::boolean, enabled),
    mode          = v_mode,
    label         = coalesce(nullif(btrim(p_patch ->> 'label'), ''), label),
    description   = case when p_patch ? 'description' then nullif(btrim(p_patch ->> 'description'), '') else description end,
    risk          = coalesce(p_patch ->> 'risk', risk),
    sources       = case when p_patch ? 'sources' then
                      (select nullif(array_agg(x), '{}'::text[]) from jsonb_array_elements_text(coalesce(nullif(p_patch -> 'sources', 'null'::jsonb), '[]'::jsonb)) x)
                    else sources end,
    max_per_job   = case when p_patch ? 'max_per_job'   then nullif(p_patch ->> 'max_per_job', '')::int         else max_per_job end,
    max_per_day   = case when p_patch ? 'max_per_day'   then nullif(p_patch ->> 'max_per_day', '')::int         else max_per_day end,
    usd_cap_daily = case when p_patch ? 'usd_cap_daily' then nullif(p_patch ->> 'usd_cap_daily', '')::numeric   else usd_cap_daily end,
    note          = case when p_patch ? 'note' then nullif(btrim(p_patch ->> 'note'), '') else note end,
    updated_by    = auth.uid(), updated_at = now()
  where key = p_key returning * into v_after;

  perform app_private.brain_log(p_key, 'set', to_jsonb(v_before) - 'created_by' - 'updated_by', to_jsonb(v_after) - 'created_by' - 'updated_by', p_patch ->> 'reason');
  return app_private.brain_perm_json(v_after);
end $$;
revoke execute on function public.cc_brain_perm_set(text, jsonb) from public, anon;
grant  execute on function public.cc_brain_perm_set(text, jsonb) to authenticated, service_role;

-- Add a permission. A new `rule` is live at once (it is prompt text). A new `tool` is `planned` until a migration
-- ships its executor (status flips there); a new `source` is a real gate the moment code enqueues with that name.
create or replace function public.cc_brain_perm_add(p_kind text, p_name text, p_label text, p_description text default null, p_patch jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_key text; v_row app_private.brain_permissions; v_name text := btrim(lower(regexp_replace(btrim(coalesce(p_name,'')), '[^a-zA-Z0-9_]+', '_', 'g')), '_');
begin
  perform app_private.brain_cc_guard();
  if p_kind not in ('source','tool','rule') then raise exception 'kind must be source, tool or rule' using errcode = '22023'; end if;
  if v_name !~ '^[a-z0-9_]{2,48}$' then raise exception 'name must be 2–48 letters, digits or _' using errcode = '22023'; end if;
  if nullif(btrim(coalesce(p_label,'')), '') is null then raise exception 'label is required' using errcode = '22023'; end if;
  v_key := p_kind || '.' || v_name;
  if exists (select 1 from app_private.brain_permissions where key = v_key) then raise exception 'permission % already exists', v_key using errcode = '23505'; end if;

  insert into app_private.brain_permissions (key, kind, name, label, description, enabled, mode, risk, status, sources, max_per_job, max_per_day, usd_cap_daily, note, created_by, updated_by)
  values (v_key, p_kind, v_name, btrim(p_label), nullif(btrim(coalesce(p_description,'')), ''),
          case p_kind when 'tool' then false else coalesce((p_patch ->> 'enabled')::boolean, true) end,
          case p_kind when 'tool' then coalesce(p_patch ->> 'mode', 'prep') when 'rule' then coalesce(p_patch ->> 'mode', 'deny') else 'auto' end,
          coalesce(p_patch ->> 'risk', case p_kind when 'rule' then 'medium' else 'high' end),
          case p_kind when 'tool' then 'planned' else 'live' end,
          (select nullif(array_agg(x), '{}'::text[]) from jsonb_array_elements_text(coalesce(nullif(p_patch -> 'sources', 'null'::jsonb), '[]'::jsonb)) x),
          nullif(p_patch ->> 'max_per_job', '')::int, nullif(p_patch ->> 'max_per_day', '')::int, nullif(p_patch ->> 'usd_cap_daily', '')::numeric,
          nullif(btrim(coalesce(p_patch ->> 'note','')), ''), auth.uid(), auth.uid())
  returning * into v_row;
  perform app_private.brain_log(v_key, 'add', null, to_jsonb(v_row) - 'created_by' - 'updated_by', p_patch ->> 'reason');
  return app_private.brain_perm_json(v_row);
end $$;
revoke execute on function public.cc_brain_perm_add(text, text, text, text, jsonb) from public, anon;
grant  execute on function public.cc_brain_perm_add(text, text, text, text, jsonb) to authenticated, service_role;

create or replace function public.cc_brain_perm_delete(p_key text)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_row app_private.brain_permissions;
begin
  perform app_private.brain_cc_guard();
  select * into v_row from app_private.brain_permissions where key = p_key for update;
  if v_row is null then raise exception 'unknown permission %', p_key using errcode = 'P0002'; end if;
  if v_row.builtin then raise exception 'built-in permission % can be switched off but not deleted', p_key using errcode = '22023'; end if;
  delete from app_private.brain_permissions where key = p_key;
  perform app_private.brain_log(p_key, 'delete', to_jsonb(v_row) - 'created_by' - 'updated_by', null, null);
  return jsonb_build_object('ok', true, 'key', p_key);
end $$;
revoke execute on function public.cc_brain_perm_delete(text) from public, anon;
grant  execute on function public.cc_brain_perm_delete(text) to authenticated, service_role;

-- Config: enabled, daily_usd_cap, model, gate_model, effort{}, max_tokens{}, max_tool_calls, timeout_ms,
-- spot_check_until, price{}. fn_url / auth_key are NOT settable from the CC (they are wiring, set in SQL).
create or replace function public.cc_brain_config_set(p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_before app_private.brain_config; v_after app_private.brain_config; k text; v text;
begin
  perform app_private.brain_cc_guard();
  select * into v_before from app_private.brain_config where id for update;

  if p_patch ? 'effort' then
    for k, v in select * from jsonb_each_text(p_patch -> 'effort') loop
      if v not in ('low','medium','high','max') then raise exception 'effort for "%" must be low, medium, high or max', k using errcode = '22023'; end if;
    end loop;
  end if;
  if p_patch ? 'max_tokens' then
    for k, v in select * from jsonb_each_text(p_patch -> 'max_tokens') loop
      if v !~ '^[0-9]+$' or v::int < 256 or v::int > 64000 then raise exception 'max_tokens for "%" must be 256–64000', k using errcode = '22023'; end if;
    end loop;
  end if;
  if p_patch ? 'daily_usd_cap' and ((p_patch ->> 'daily_usd_cap')::numeric < 0 or (p_patch ->> 'daily_usd_cap')::numeric > 10000) then
    raise exception 'daily cap must be 0–10000 USD' using errcode = '22023';
  end if;
  if p_patch ? 'max_tool_calls' and ((p_patch ->> 'max_tool_calls')::int < 0 or (p_patch ->> 'max_tool_calls')::int > 40) then
    raise exception 'tool budget must be 0–40 calls per job' using errcode = '22023';
  end if;
  if p_patch ? 'timeout_ms' and ((p_patch ->> 'timeout_ms')::int < 1000 or (p_patch ->> 'timeout_ms')::int > 120000) then
    raise exception 'timeout must be 1000–120000 ms' using errcode = '22023';
  end if;

  update app_private.brain_config set
    enabled          = coalesce((p_patch ->> 'enabled')::boolean, enabled),
    daily_usd_cap    = coalesce((p_patch ->> 'daily_usd_cap')::numeric, daily_usd_cap),
    model            = coalesce(nullif(btrim(p_patch ->> 'model'), ''), model),
    gate_model       = coalesce(nullif(btrim(p_patch ->> 'gate_model'), ''), gate_model),
    effort           = case when p_patch ? 'effort' then effort || (p_patch -> 'effort') else effort end,
    max_tokens       = case when p_patch ? 'max_tokens' then max_tokens || (p_patch -> 'max_tokens') else max_tokens end,
    max_tool_calls   = coalesce((p_patch ->> 'max_tool_calls')::int, max_tool_calls),
    timeout_ms       = coalesce((p_patch ->> 'timeout_ms')::int, timeout_ms),
    spot_check_until = case when p_patch ? 'spot_check_until' then nullif(p_patch ->> 'spot_check_until', '')::date else spot_check_until end,
    price            = case when p_patch ? 'price' then price || (p_patch -> 'price') else price end,
    updated_at       = now()
  where id returning * into v_after;

  perform app_private.brain_log('config', 'config',
    to_jsonb(v_before) - 'auth_key' - 'fn_url', to_jsonb(v_after) - 'auth_key' - 'fn_url', p_patch ->> 'reason');
  return app_private.brain_state();
end $$;
revoke execute on function public.cc_brain_config_set(jsonb) from public, anon;
grant  execute on function public.cc_brain_config_set(jsonb) to authenticated, service_role;

create or replace function public.cc_brain_jobs(p_limit integer default 60, p_source text default null, p_status text default null)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
begin
  perform app_private.brain_cc_guard();
  return (select coalesce(jsonb_agg(jsonb_build_object('id', j.id, 'source', j.source, 'ref_id', j.ref_id, 'route', j.route, 'status', j.status, 'lang', j.lang,
            'model', j.model, 'effort', j.effort, 'input', j.input_tokens, 'cache_read', j.cache_read, 'cache_write', j.cache_write, 'output', j.output_tokens,
            'usd', j.usd, 'tool_calls', j.tool_calls, 'iterations', j.iterations, 'confidence', j.result ->> 'confidence', 'escalate', (j.result ->> 'escalate') = 'true',
            'question', left(j.question, 160), 'error', j.error, 'created_at', j.created_at, 'done_at', j.done_at,
            'secs', round(extract(epoch from (coalesce(j.done_at, now()) - j.created_at))::numeric, 1)) order by j.id desc), '[]'::jsonb)
    from (select * from app_private.brain_jobs
           where (p_source is null or source = p_source) and (p_status is null or status = p_status)
           order by id desc limit least(greatest(coalesce(p_limit, 60), 1), 300)) j);
end $$;
revoke execute on function public.cc_brain_jobs(integer, text, text) from public, anon;
grant  execute on function public.cc_brain_jobs(integer, text, text) to authenticated, service_role;

create or replace function public.cc_brain_job(p_id bigint)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
begin
  perform app_private.brain_cc_guard();
  return (select jsonb_build_object(
    'job', to_jsonb(j) - 'token',
    'actions', (select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'tool', a.tool, 'outcome', a.outcome, 'ok', a.ok, 'ms', a.ms,
                  'payload', a.payload, 'result', a.result, 'bytes', octet_length(coalesce(a.payload::text,'')) + octet_length(coalesce(a.result::text,'')),
                  'created_at', a.created_at) order by a.id), '[]'::jsonb) from app_private.brain_actions a where a.job_id = j.id),
    'findings', (select coalesce(jsonb_agg(to_jsonb(f) order by f.id), '[]'::jsonb) from app_private.brain_findings f where f.job_id = j.id))
    from app_private.brain_jobs j where j.id = p_id);
end $$;
revoke execute on function public.cc_brain_job(bigint) from public, anon;
grant  execute on function public.cc_brain_job(bigint) to authenticated, service_role;

create or replace function public.cc_brain_findings(p_status text default 'open', p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
begin
  perform app_private.brain_cc_guard();
  return (select coalesce(jsonb_agg(to_jsonb(f) order by f.id desc), '[]'::jsonb)
    from (select * from app_private.brain_findings where (p_status is null or status = p_status) order by id desc limit least(greatest(coalesce(p_limit,100),1), 500)) f);
end $$;
revoke execute on function public.cc_brain_findings(text, integer) from public, anon;
grant  execute on function public.cc_brain_findings(text, integer) to authenticated, service_role;

create or replace function public.cc_brain_finding_set(p_id bigint, p_status text)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_before app_private.brain_findings; v_after app_private.brain_findings;
begin
  perform app_private.brain_cc_guard();
  if p_status not in ('open','accepted','done','dismissed') then raise exception 'bad status' using errcode = '22023'; end if;
  select * into v_before from app_private.brain_findings where id = p_id for update;
  if v_before is null then raise exception 'unknown finding' using errcode = 'P0002'; end if;
  update app_private.brain_findings set status = p_status, resolved_at = case when p_status in ('done','dismissed') then now() else null end
   where id = p_id returning * into v_after;
  perform app_private.brain_log('finding:' || p_id, 'finding', jsonb_build_object('status', v_before.status), jsonb_build_object('status', v_after.status), null);
  return to_jsonb(v_after);
end $$;
revoke execute on function public.cc_brain_finding_set(bigint, text) from public, anon;
grant  execute on function public.cc_brain_finding_set(bigint, text) to authenticated, service_role;

create or replace function public.cc_brain_facts()
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
begin
  perform app_private.brain_cc_guard();
  return (select coalesce(jsonb_agg(to_jsonb(f) order by f.key), '[]'::jsonb) from app_private.brain_facts f);
end $$;
revoke execute on function public.cc_brain_facts() from public, anon;
grant  execute on function public.cc_brain_facts() to authenticated, service_role;

-- Set / add / remove a fact (value null = delete). Facts starting with 'site.' are the site_facts mirror: edit those in
-- CC → Market rates (the registry), not here — they are refused so the two never drift.
create or replace function public.cc_brain_fact_set(p_key text, p_value text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_before app_private.brain_facts; v_after app_private.brain_facts; v_key text := lower(btrim(coalesce(p_key,'')));
begin
  perform app_private.brain_cc_guard();
  if v_key !~ '^[a-z0-9_.]{2,80}$' then raise exception 'key must be 2–80 of a-z 0-9 _ .' using errcode = '22023'; end if;
  if v_key like 'site.%' then raise exception 'site.* facts mirror the site registry — edit them in CC → Market rates' using errcode = '22023'; end if;
  select * into v_before from app_private.brain_facts where key = v_key for update;
  if p_value is null or btrim(p_value) = '' then
    if v_before is null then raise exception 'unknown fact %', v_key using errcode = 'P0002'; end if;
    delete from app_private.brain_facts where key = v_key;
    perform app_private.brain_log('fact:' || v_key, 'fact', to_jsonb(v_before), null, p_note);
    return jsonb_build_object('ok', true, 'deleted', v_key);
  end if;
  insert into app_private.brain_facts as f (key, value, note, source, as_of, updated_by, updated_at)
  values (v_key, left(btrim(p_value), 2000), p_note, 'owner (CC)', current_date, 'cc', now())
  on conflict (key) do update set value = excluded.value, note = coalesce(excluded.note, f.note), source = 'owner (CC)', as_of = current_date, updated_by = 'cc', updated_at = now()
  returning * into v_after;
  perform app_private.brain_log('fact:' || v_key, 'fact', to_jsonb(v_before), to_jsonb(v_after), p_note);
  return to_jsonb(v_after);
end $$;
revoke execute on function public.cc_brain_fact_set(text, text, text) from public, anon;
grant  execute on function public.cc_brain_fact_set(text, text, text) to authenticated, service_role;

-- "Try a question": one test job through the real queue (source.test must be on; costs real money).
create or replace function public.cc_brain_test(p_question text, p_lang text default 'en')
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
begin
  perform app_private.brain_cc_guard();
  if nullif(btrim(coalesce(p_question,'')), '') is null then raise exception 'type a question' using errcode = '22023'; end if;
  return app_private.brain_enqueue('test', 'cc-' || to_char(now(), 'HH24MISS'), 'test', left(p_question, 2000),
           jsonb_build_object('staff_online', false, 'visitor_role', 'visitor', 'page', '/', 'asked_by', 'owner via CC'),
           null, array['kb_search','get_facts','note','escalate','report_finding'], case when p_lang = 'es' then 'es' else 'en' end);
end $$;
revoke execute on function public.cc_brain_test(text, text) from public, anon;
grant  execute on function public.cc_brain_test(text, text) to authenticated, service_role;

create or replace function public.cc_brain_perm_log(p_limit integer default 100)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
begin
  perform app_private.brain_cc_guard();
  return (select coalesce(jsonb_agg(to_jsonb(l) order by l.id desc), '[]'::jsonb)
    from (select * from app_private.brain_permission_log order by id desc limit least(greatest(coalesce(p_limit,100),1), 500)) l);
end $$;
revoke execute on function public.cc_brain_perm_log(integer) from public, anon;
grant  execute on function public.cc_brain_perm_log(integer) to authenticated, service_role;

-- cc_brain_set (0470) stays for SQL use; it now logs too.
create or replace function public.cc_brain_set(p_enabled boolean default null, p_daily_usd_cap numeric default null, p_spot_check_until date default null)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
begin
  return public.cc_brain_config_set(jsonb_strip_nulls(jsonb_build_object('enabled', p_enabled, 'daily_usd_cap', p_daily_usd_cap, 'spot_check_until', p_spot_check_until)));
end $$;
revoke execute on function public.cc_brain_set(boolean, numeric, date) from public, anon;
grant  execute on function public.cc_brain_set(boolean, numeric, date) to authenticated, service_role;

-- ── 8. assertions ─────────────────────────────────────────────────────────────────────────────────────────────────
do $chk$
declare added text; removed text; n int;
begin
  select string_agg(proname, ',') into added from (
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
    except select proname from _bl0472_secdef_before) a;
  select string_agg(proname, ',') into removed from (
    select proname from _bl0472_secdef_before
    except select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')) r;
  if added is not null or removed is not null then
    raise exception 'bl_brain_0472: anon secdef surface changed — added [%] removed [%]', coalesce(added,''), coalesce(removed,'');
  end if;
  if has_function_privilege('anon', 'public.brain_rpc(uuid,text,jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.brain_rpc(uuid,text,jsonb)', 'execute') then
    raise exception 'bl_brain_0472: brain_rpc must be service_role only';
  end if;
  -- every tool the 0470 executor knows has a registry row, and the gate denies an unknown name
  select count(*) into n from app_private.brain_permissions where key in ('tool.kb_search','tool.get_facts','tool.account_lookup','tool.note','tool.escalate','tool.report_finding');
  if n <> 6 then raise exception 'bl_brain_0472: expected 6 live tool rows, found %', n; end if;
  if array_length(app_private.brain_tools_allowed('test', array['kb_search','made_up_tool']), 1) <> 1 then
    raise exception 'bl_brain_0472: brain_tools_allowed must drop tools that are not in the registry';
  end if;
  drop table if exists _bl0472_secdef_before;
end $chk$;
