-- bl_brain_0505_loads_email.sql
-- loads@ email parsing moves onto the Claude brain; Gemini becomes the fallback (owner ask, 30 Sep 2026:
-- "new ai brain jo bna claude ka ... sirf loads pe jo email ay un k lyea, fallback pe gemini rakho").
--
-- WHY: load-mail parsed every broker email with Gemini only. 28-29 Sep: Gemini 429 (quota) and 503
-- (overloaded) turned 36 of 41 loads@ emails into "[loads@ unparsed]" - loads never posted.
--
-- HOW (load-mail v11):
--   1. load-mail asks public.brain_loads_gate() whether Claude may run now. The gate honours every brain
--      switch the owner already has in CC -> AI Brain: the kill switch (brain_config.enabled), this
--      source's row (source.loads_email: enabled + live), its daily $ cap and job cap, and the brain-wide
--      daily $ cap. Model + effort come from brain_config.model_by_route / effort ->> 'loads_email'.
--   2. gate says yes -> Claude parses (structured JSON). Claude fails or gate says no -> Gemini, as before.
--   3. every Claude attempt is written by public.brain_loads_record() as a brain_jobs row (source
--      'loads_email') + brain_usage_daily, so cost and failures show in CC -> AI Brain like any brain job.
--
-- BRAIN LAW (CLAUDE.md s9): the new source has its brain_permissions row in this same file.
-- It is a SOURCE only - Claude here gets no tools; load-mail itself posts the loads, exactly as with Gemini.
--
-- ANON SURFACE: two new public SECURITY DEFINER functions, service_role only - revoked from public, anon,
-- authenticated explicitly (CLAUDE.md s4). Baseline stays 36 prod / 35 staging.
--
-- ROLLBACK: at the end of the file. Turning it OFF needs no rollback: CC -> AI Brain -> source.loads_email
-- off (or brain kill switch) and load-mail goes straight back to Gemini.

begin;

-- 1. brain_jobs may carry the new source
alter table app_private.brain_jobs drop constraint if exists brain_jobs_source_check;
alter table app_private.brain_jobs add constraint brain_jobs_source_check check (source = any (array[
  'chat','assist','email','wa','onboarding','dispatch','sales','sweep','voice','test','loads_email']));

-- 2. the permission row (s9) - live and on, $3/day, 500 emails/day
insert into app_private.brain_permissions
  (key, kind, name, label, description, enabled, mode, risk, status, max_per_day, usd_cap_daily, builtin, note)
values
  ('source.loads_email', 'source', 'loads_email', 'Loads inbox (loads@) parsing',
   'Claude reads every email that reaches loads@ (broker load blasts, replies, booking confirmations) and returns the loads as structured data; load-mail posts them. Gemini takes over whenever this is off, capped or failing. No tools.',
   true, 'auto', 'low', 'live', 500, 3.00, false,
   'bl_brain_0505. Model/effort: brain_config.model_by_route / effort ->> loads_email.')
on conflict (key) do nothing;

select app_private.brain_log('source.loads_email', 'add', null,
  (select to_jsonb(p) from app_private.brain_permissions p where p.key = 'source.loads_email'),
  'bl_brain_0505: loads@ parsing on Claude, Gemini fallback');

-- 3. model + effort for the route (owner can change both without a deploy)
update app_private.brain_config
   set model_by_route = model_by_route || '{"loads_email":"claude-sonnet-5"}'::jsonb,
       effort         = effort || '{"loads_email":"low"}'::jsonb,
       updated_at     = now()
 where id and not (model_by_route ? 'loads_email');
select app_private.brain_log('config', 'config', null,
  jsonb_build_object('model_by_route', jsonb_build_object('loads_email', 'claude-sonnet-5'), 'effort', jsonb_build_object('loads_email', 'low')),
  'bl_brain_0505: route loads_email');

-- 4. the gate: may Claude parse this email right now?
create or replace function public.brain_loads_gate()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'app_private, public'
as $function$
declare c app_private.brain_config; p app_private.brain_permissions; v_model text; v_effort text; v_why text;
begin
  select * into c from app_private.brain_config where id;
  p := app_private.brain_perm('source.loads_email');
  v_model  := coalesce(nullif(btrim(c.model_by_route ->> 'loads_email'), ''), c.model);
  v_effort := coalesce(nullif(btrim(c.effort ->> 'loads_email'), ''), 'low');
  v_why := case
    when c is null or not c.enabled                                   then 'brain kill switch is off'
    when p.key is null                                                then 'source.loads_email row missing'
    when not p.enabled or p.status <> 'live'                          then 'source.loads_email is switched off'
    when app_private.brain_spent_today() >= c.daily_usd_cap           then 'brain daily $ cap reached'
    when p.usd_cap_daily is not null
     and app_private.brain_source_spent_today('loads_email') >= p.usd_cap_daily then 'loads_email daily $ cap reached'
    when p.max_per_day is not null
     and app_private.brain_source_jobs_today('loads_email') >= p.max_per_day   then 'loads_email daily job cap reached'
  end;
  return jsonb_build_object('use_claude', v_why is null, 'model', v_model, 'effort', v_effort,
                            'reason', coalesce(v_why, 'ok'));
end;
$function$;

-- 5. the ledger: one brain_jobs row per Claude attempt (+ brain_usage_daily), so CC shows cost and failures
create or replace function public.brain_loads_record(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'app_private, public'
as $function$
declare v_ok boolean := coalesce((p ->> 'ok')::boolean, false);
        v_in int := coalesce((p ->> 'input_tokens')::int, 0);
        v_cr int := coalesce((p ->> 'cache_read')::int, 0);
        v_cw int := coalesce((p ->> 'cache_write')::int, 0);
        v_out int := coalesce((p ->> 'output_tokens')::int, 0);
        v_model text := nullif(p ->> 'model', '');
        v_usd numeric := 0; v_id bigint;
begin
  if v_in + v_cr + v_cw + v_out > 0 then
    v_usd := app_private.brain_usd(v_model, v_in, v_cr, v_cw, v_out);
  end if;
  insert into app_private.brain_jobs
    (source, ref_id, route, status, question, model, effort, input_tokens, cache_read, cache_write,
     output_tokens, usd, iterations, result, error, started_at, done_at)
  values
    ('loads_email', left(p ->> 'ref', 200), 'loads_email', case when v_ok then 'done' else 'failed' end,
     left(p ->> 'subject', 300), v_model, nullif(p ->> 'effort', ''), v_in, v_cr, v_cw, v_out, v_usd, 1,
     case when p ? 'result' then p -> 'result' end, left(p ->> 'error', 500),
     now() - make_interval(secs => coalesce((p ->> 'ms')::numeric, 0) / 1000.0), now())
  returning id into v_id;

  if v_usd > 0 then
    insert into app_private.brain_usage_daily as u (day, jobs, input_tokens, cache_read, cache_write, output_tokens, usd)
    values ((now() at time zone 'utc')::date, 1, v_in, v_cr, v_cw, v_out, v_usd)
    on conflict (day) do update set jobs = u.jobs + 1, input_tokens = u.input_tokens + excluded.input_tokens,
      cache_read = u.cache_read + excluded.cache_read, cache_write = u.cache_write + excluded.cache_write,
      output_tokens = u.output_tokens + excluded.output_tokens, usd = u.usd + excluded.usd, updated_at = now();
  end if;
  return jsonb_build_object('ok', true, 'job_id', v_id, 'usd', v_usd);
end;
$function$;

revoke all on function public.brain_loads_gate()        from public, anon, authenticated;
revoke all on function public.brain_loads_record(jsonb) from public, anon, authenticated;
grant execute on function public.brain_loads_gate()        to service_role;
grant execute on function public.brain_loads_record(jsonb) to service_role;

commit;

-- ROLLBACK (manual)
-- begin;
--   drop function if exists public.brain_loads_gate();
--   drop function if exists public.brain_loads_record(jsonb);
--   update app_private.brain_config set model_by_route = model_by_route - 'loads_email', effort = effort - 'loads_email' where id;
--   delete from app_private.brain_permissions where key = 'source.loads_email';
--   -- leave the source check widened if brain_jobs has loads_email rows (they are history).
-- commit;
