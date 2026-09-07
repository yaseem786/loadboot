-- bl_sec_0329c_retell_hook_log.sql — audit F14. The observation log for the retell-hook edge function.
-- Observe mode is how the DOC-DERIVED signature format gets confirmed against real Retell traffic before
-- enforcement is switched on. Read it with:
--   select at, verified, reason, forwarded, event from app_private.retell_hook_log order by at desc limit 20;
-- No payload, no phone number and no transcript is stored — only the verdict. 30-day retention.
-- STAGING 2026-09-06: applied; holds the two verdicts from the live end-to-end test. PROD: not applied.
create table if not exists app_private.retell_hook_log(
  id         bigserial primary key,
  at         timestamptz not null default now(),
  verified   boolean,
  reason     text,
  forwarded  boolean,
  event      text
);
create index if not exists retell_hook_log_at_idx on app_private.retell_hook_log(at desc);

create or replace function public.retell_hook_log_write(p_verified boolean, p_reason text, p_forwarded boolean, p_event text)
returns void
language plpgsql
security definer
set search_path to 'app_private, public'
as $$
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role','') <> 'service_role'
     and current_user not in ('postgres','service_role') then
    return;   -- silently ignore: this is a log, never a lever
  end if;
  insert into app_private.retell_hook_log(verified, reason, forwarded, event)
  values (p_verified, left(coalesce(p_reason,''), 200), p_forwarded, left(coalesce(p_event,''), 60));
  delete from app_private.retell_hook_log where at < now() - interval '30 days';
end $$;
revoke all on function public.retell_hook_log_write(boolean, text, boolean, text) from public, anon, authenticated;
grant execute on function public.retell_hook_log_write(boolean, text, boolean, text) to service_role;
