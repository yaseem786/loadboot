-- bl_fix_0089 — PLATFORM-WIDE notification bug: 15 functions inserted channel 'inapp'
-- but notifications_channel_check only allows 'in_app' — every such staff notification
-- (claims filed, auto detention/TONU, pickup watch, disputes, cancels, escalations,
-- agent review/payout requests) SILENTLY FAILED inside `exception when others then null`.
-- Fix = batch-rewrite every function definition replacing 'inapp' -> 'in_app'.
-- Applied to staging 2026-07-13 (verified 0 remaining). Replay on PROD.

do $$
declare r record; src text;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','app_private') and pg_get_functiondef(p.oid) like '%''inapp''%' and p.prokind='f'
  loop
    src := replace(pg_get_functiondef(r.oid), '''inapp''', '''in_app''');
    execute src;
  end loop;
end $$;

-- verify: should return 0
-- select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--   where n.nspname in ('public','app_private') and pg_get_functiondef(p.oid) like '%''inapp''%' and p.prokind='f';

notify pgrst, 'reload schema';
