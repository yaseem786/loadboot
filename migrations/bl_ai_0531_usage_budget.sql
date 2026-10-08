-- bl_ai_0531 — Claude credit budget: Console balance + credit expiry, a reserve stop, ledger repriced (8 Oct 2026)
--
-- Why: the Anthropic Console account is PREPAID — no billing cycle, invoices only when credits are bought. So the
-- budget follows the credit balance and each credit's expiry, not a calendar month (owner, 8 Oct 2026). Screenshot
-- 8 Oct: balance $213.03 = $200 "API credit (Max 20x)" granted 8 Oct, expiring 20 Oct 2026 + $20 grant of 27 Sep,
-- expiring 28 Sep 2027.
--
-- What this adds (all behind CC → AI Brain, all owner-editable, nothing hard-coded in a function):
--   app_private.brain_credit_lots       one row per Console credit (label, usd, granted_on, expires_on).
--   brain_config.credit_balance_usd/_at the last Console balance the owner typed in, and when.
--   brain_config.credit_reserve_usd     stop line. Estimated balance at/below it → every brain job is 'capped', which
--                                       already means chat → Gemini lc-brain v4 (bl_brain_0473) and load-mail → its
--                                       non-Claude path (brain_loads_gate). Default $5.
--   app_private.brain_credit_state()    the estimate:  balance typed in
--                                                     − brain_jobs.usd spent since then (this database only)
--                                                     + lots granted after the snapshot that have not expired
--                                                     − lots already inside the snapshot that expired since.
--                                       An expiring lot is subtracted IN FULL. That is the conservative reading: we do
--                                       not know which credit Anthropic draws first. Re-type the balance after an
--                                       expiry and the guess goes away.
--   public.cc_brain_credit_set(jsonb)   CC writes (balance, reserve, add/delete a lot). authenticated + brain_cc_guard;
--                                       NOT anon — the anon SECURITY DEFINER list stays 36/35 with the same names.
--
-- Known limit: the balance is account-wide, but each database only sees its own spend. Prod carries the traffic;
-- staging's estimate drifts by whatever prod spends. Fail-open on purpose when no balance was ever typed: the real
-- hard stop is Anthropic itself (a $0 balance → API error → chat falls back to Gemini, already wired).
--
-- Ledger correction: jobs written before bl_brain_0475 were priced at the 5-minute cache-write rate while the
-- `brain` function writes the 1-hour cache (2× base). Staging, 8 Oct: stored $2.23, repriced $2.91. Each job's usd is
-- recomputed from its own token counts with today's brain_config.price (only for models that HAVE a price row — an
-- unknown model id would otherwise fall back to the default model's price), and brain_usage_daily gets the per-day
-- delta, so the spend-today cap and the CC charts keep agreeing with brain_jobs.
--
-- Patches brain_enqueue, brain_loads_gate and cc_brain_overview by replacing one anchor in their live definition
-- (CLAUDE.md §3), asserting each anchor occurs exactly once. Re-running the file is a no-op.
--
-- Applied to STAGING 8 Oct 2026 in four parts (the Supabase MCP timed out on the single file, nothing was left
-- half-applied): bl_ai_0531a_credit_storage (§1–2), bl_ai_0531b_reserve_patch (§3), bl_ai_0531c_cc_credit_rpc (§4),
-- bl_ai_0531d_ledger_reprice (§5). Staging result: 5 jobs repriced, brain_jobs $2.23 → $2.91; anon secdef 35, same
-- names (hash of the sorted signatures unchanged); reserve stop probed on brain_enqueue and brain_loads_gate inside
-- a rolled-back transaction.
-- Applied to PROD (rwscphuhpjoudvljvmdk) 8 Oct 2026 in the same four parts. Pre-checks: both brain_jobs models
-- (claude-fable-5-1, claude-sonnet-5) have a price row; each anchor found exactly once. Prod result: 1 job repriced,
-- brain_jobs $3.68 → $3.85 (+$0.18 only — the open ~$3 Console-vs-ledger gap is NOT a pricing error; prices match
-- the published rates); anon secdef 36 before and after, names md5 06f779f74423a983253c79ab9d4e1e84 unchanged;
-- reserve stop probed on brain_loads_gate inside a rolled-back transaction (reason 'Claude credit reserve reached').

-- ── 1. storage ──────────────────────────────────────────────────────────────────────────────────────────────────
create table if not exists app_private.brain_credit_lots (
  id          bigserial primary key,
  label       text          not null,
  usd         numeric(10,2) not null check (usd > 0),
  granted_on  date          not null,
  expires_on  date          not null check (expires_on > granted_on),
  note        text,
  created_by  uuid,
  created_at  timestamptz   not null default now(),
  unique (label, granted_on)
);
alter table app_private.brain_credit_lots enable row level security;
revoke all on app_private.brain_credit_lots from public, anon, authenticated;

alter table app_private.brain_config add column if not exists credit_balance_usd numeric(10,2);
alter table app_private.brain_config add column if not exists credit_balance_at  timestamptz;
alter table app_private.brain_config add column if not exists credit_reserve_usd numeric(8,2) not null default 5.00;

-- seed from the owner's Console screenshot (8 Oct 2026). Dates are UTC, as the Console shows them.
insert into app_private.brain_credit_lots (label, usd, granted_on, expires_on, note) values
  ('API credit (Max 20x)', 200.00, date '2026-10-08', date '2026-10-20', 'Console invoice history, 8 Oct 2026'),
  ('Credit grant',          20.00, date '2026-09-27', date '2027-09-28', 'Console invoice JCBN1WQ6-0001')
on conflict (label, granted_on) do nothing;

update app_private.brain_config
   set credit_balance_usd = 213.03, credit_balance_at = now(), updated_at = now()
 where id and credit_balance_at is null;

-- ── 2. the estimate ─────────────────────────────────────────────────────────────────────────────────────────────
create or replace function app_private.brain_credit_state()
returns jsonb language sql stable set search_path = app_private, public as $$
  with c as (select credit_balance_usd bal, credit_balance_at at, credit_reserve_usd res from app_private.brain_config where id),
  d as (select (now() at time zone 'utc')::date today),
  s as (select coalesce(sum(j.usd), 0) spent
          from app_private.brain_jobs j, c
         where c.at is not null and coalesce(j.done_at, j.created_at) >= c.at),
  l as (select
          coalesce(sum(x.usd) filter (where x.granted_on >  (c.at at time zone 'utc')::date and x.expires_on > d.today), 0) added,
          coalesce(sum(x.usd) filter (where x.granted_on <= (c.at at time zone 'utc')::date
                                        and x.expires_on >  (c.at at time zone 'utc')::date
                                        and x.expires_on <= d.today), 0) lost
          from app_private.brain_credit_lots x, c, d),
  e as (select case when c.bal is null then null else round(c.bal - s.spent + l.added - l.lost, 2) end est from c, s, l)
  select jsonb_build_object(
    'balance_usd',     c.bal,
    'balance_at',      c.at,
    'spent_since',     round(s.spent, 4),
    'lots_added',      l.added,
    'lots_expired',    l.lost,
    'est_balance',     e.est,
    'reserve_usd',     c.res,
    'below_reserve',   coalesce(e.est <= c.res, false),
    'month_to_date',   (select coalesce(round(sum(u.usd), 4), 0) from app_private.brain_usage_daily u
                         where u.day >= date_trunc('month', d.today)::date),
    'lots',            (select coalesce(jsonb_agg(jsonb_build_object(
                          'id', x.id, 'label', x.label, 'usd', x.usd, 'granted_on', x.granted_on, 'expires_on', x.expires_on,
                          'days_left', x.expires_on - d.today, 'expired', x.expires_on <= d.today, 'note', x.note)
                          order by x.expires_on), '[]'::jsonb)
                         from app_private.brain_credit_lots x),
    'expiring_soon',   (select coalesce(jsonb_agg(jsonb_build_object('label', x.label, 'usd', x.usd, 'expires_on', x.expires_on,
                          'days_left', x.expires_on - d.today) order by x.expires_on), '[]'::jsonb)
                         from app_private.brain_credit_lots x where x.expires_on > d.today and x.expires_on <= d.today + 14),
    'scope',           'Spend counted from this database only; the Console balance is account-wide.')
  from c, s, l, e, d;
$$;

create or replace function app_private.brain_below_reserve()
returns boolean language sql stable set search_path = app_private, public as $$
  select coalesce((app_private.brain_credit_state() ->> 'below_reserve')::boolean, false);
$$;

revoke execute on function app_private.brain_credit_state()  from public, anon, authenticated;
revoke execute on function app_private.brain_below_reserve() from public, anon, authenticated;

-- ── 3. enforcement: patch the live definitions on one anchor each ───────────────────────────────────────────────
do $patch$
declare
  v_def text; v_new text; v_n int;
  r record;
begin
  for r in
    select * from (values
      ('app_private.brain_enqueue(text,text,text,text,jsonb,text,text[],text)'::regprocedure,
       $a$  elsif app_private.brain_spent_today() >= v_cfg.daily_usd_cap then$a$,
       $b$  elsif app_private.brain_below_reserve() then   -- bl_ai_0531
    v_status := 'capped'; v_err := 'credit reserve reached: estimated Claude balance '
      || coalesce(app_private.brain_credit_state() ->> 'est_balance', '?') || ' <= reserve ' || v_cfg.credit_reserve_usd::text
      || ' (CC → AI Brain → Overview → Claude credit)';
  elsif app_private.brain_spent_today() >= v_cfg.daily_usd_cap then$b$),
      ('public.brain_loads_gate()'::regprocedure,
       $a$    when app_private.brain_spent_today() >= c.daily_usd_cap           then 'brain daily $ cap reached'$a$,
       $b$    when app_private.brain_below_reserve()                            then 'Claude credit reserve reached'   -- bl_ai_0531
    when app_private.brain_spent_today() >= c.daily_usd_cap           then 'brain daily $ cap reached'$b$),
      ('public.cc_brain_overview()'::regprocedure,
       $a$    'today',   (select coalesce(to_jsonb(u)$a$,
       $b$    'credit',  app_private.brain_credit_state(),   -- bl_ai_0531
    'today',   (select coalesce(to_jsonb(u)$b$)
    ) t(fn, anchor, repl)
  loop
    v_def := pg_get_functiondef(r.fn);
    if position('bl_ai_0531' in v_def) > 0 then continue; end if;          -- already patched
    v_n := (length(v_def) - length(replace(v_def, r.anchor, ''))) / length(r.anchor);
    if v_n <> 1 then
      raise exception 'bl_ai_0531: anchor found % times in % (expected 1) — definition drifted, patch by hand', v_n, r.fn;
    end if;
    v_new := replace(v_def, r.anchor, r.repl);
    execute v_new;                                                       -- CREATE OR REPLACE keeps the ACL
  end loop;
end $patch$;

-- ── 4. CC write path ────────────────────────────────────────────────────────────────────────────────────────────
-- p: {balance_usd, reserve_usd, lot: {label, usd, granted_on, expires_on, note}, lot_delete: id, reason}
create or replace function public.cc_brain_credit_set(p jsonb)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_before jsonb; v_lot jsonb; v_id bigint;
begin
  perform app_private.brain_cc_guard();
  v_before := app_private.brain_credit_state();

  if p ? 'balance_usd' then
    if (p ->> 'balance_usd')::numeric < 0 or (p ->> 'balance_usd')::numeric > 100000 then
      raise exception 'balance must be 0-100000 USD' using errcode = '22023';
    end if;
    update app_private.brain_config
       set credit_balance_usd = (p ->> 'balance_usd')::numeric, credit_balance_at = now(), updated_at = now()
     where id;
  end if;

  if p ? 'reserve_usd' then
    if (p ->> 'reserve_usd')::numeric < 0 or (p ->> 'reserve_usd')::numeric > 1000 then
      raise exception 'reserve must be 0-1000 USD' using errcode = '22023';
    end if;
    update app_private.brain_config set credit_reserve_usd = (p ->> 'reserve_usd')::numeric, updated_at = now() where id;
  end if;

  if p ? 'lot' then
    v_lot := p -> 'lot';
    if nullif(btrim(v_lot ->> 'label'), '') is null then raise exception 'credit needs a label' using errcode = '22023'; end if;
    if coalesce((v_lot ->> 'usd')::numeric, 0) <= 0 then raise exception 'credit amount must be above 0' using errcode = '22023'; end if;
    if (v_lot ->> 'expires_on')::date <= (v_lot ->> 'granted_on')::date then
      raise exception 'expiry must be after the grant date' using errcode = '22023';
    end if;
    insert into app_private.brain_credit_lots (label, usd, granted_on, expires_on, note, created_by)
    values (btrim(v_lot ->> 'label'), (v_lot ->> 'usd')::numeric, (v_lot ->> 'granted_on')::date, (v_lot ->> 'expires_on')::date,
            nullif(btrim(v_lot ->> 'note'), ''), auth.uid())
    on conflict (label, granted_on) do update
      set usd = excluded.usd, expires_on = excluded.expires_on, note = excluded.note;
  end if;

  if p ? 'lot_delete' then
    delete from app_private.brain_credit_lots where id = (p ->> 'lot_delete')::bigint returning id into v_id;
    if v_id is null then raise exception 'no such credit row' using errcode = 'P0002'; end if;
  end if;

  perform app_private.brain_log('credit', 'config', v_before, app_private.brain_credit_state(), p ->> 'reason');
  return app_private.brain_credit_state();
end $$;

revoke execute on function public.cc_brain_credit_set(jsonb) from public, anon;
grant  execute on function public.cc_brain_credit_set(jsonb) to authenticated, service_role;

-- ── 5. ledger correction: reprice every job at today's price table ─────────────────────────────────────────────
do $reprice$
declare v_before numeric; v_after numeric; v_rows int;
begin
  if exists (select 1 from app_private.brain_permission_log where key = 'ledger' and note like 'bl_ai_0531%') then
    return;                                                              -- already done on this database
  end if;

  with r as (
    select j.id, (coalesce(j.done_at, j.created_at) at time zone 'utc')::date d, j.usd old_usd,
           app_private.brain_usd(j.model, j.input_tokens, j.cache_read, j.cache_write, j.output_tokens) new_usd
      from app_private.brain_jobs j, app_private.brain_config c
     where c.id and j.model is not null and c.price ? j.model),
  ch as (select * from r where new_usd is distinct from old_usd),
  upd as (update app_private.brain_jobs j set usd = ch.new_usd from ch where ch.id = j.id returning ch.d, ch.old_usd, ch.new_usd),
  daily as (insert into app_private.brain_usage_daily as u (day, usd)
            select d, sum(new_usd - coalesce(old_usd, 0)) from upd group by d
            on conflict (day) do update set usd = u.usd + excluded.usd, updated_at = now()
            returning 1)
  select coalesce(sum(old_usd), 0), coalesce(sum(new_usd), 0), count(*) into v_before, v_after, v_rows
    from upd, (select count(*) from daily) dd;

  perform app_private.brain_log('ledger', 'config',
    jsonb_build_object('usd', v_before), jsonb_build_object('usd', v_after, 'jobs', v_rows),
    'bl_ai_0531: jobs repriced at brain_config.price (1-hour cache-write rate)');
end $reprice$;

-- ── 6. asserts ──────────────────────────────────────────────────────────────────────────────────────────────────
do $assert$
begin
  if has_function_privilege('anon', 'public.cc_brain_credit_set(jsonb)', 'execute') then
    raise exception 'bl_ai_0531: anon can execute cc_brain_credit_set';
  end if;
  if has_function_privilege('anon', 'app_private.brain_credit_state()', 'execute')
     or has_function_privilege('authenticated', 'app_private.brain_credit_state()', 'execute') then
    raise exception 'bl_ai_0531: brain_credit_state is callable from the API roles';
  end if;
  if position('brain_below_reserve' in pg_get_functiondef('app_private.brain_enqueue(text,text,text,text,jsonb,text,text[],text)'::regprocedure)) = 0
     or position('brain_below_reserve' in pg_get_functiondef('public.brain_loads_gate()'::regprocedure)) = 0
     or position('brain_credit_state' in pg_get_functiondef('public.cc_brain_overview()'::regprocedure)) = 0 then
    raise exception 'bl_ai_0531: a patch did not land';
  end if;
  if not has_function_privilege('service_role', 'public.brain_loads_gate()', 'execute') then
    raise exception 'bl_ai_0531: brain_loads_gate lost its service_role grant';
  end if;
end $assert$;
