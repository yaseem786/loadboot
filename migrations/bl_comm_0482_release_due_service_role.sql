-- bl_comm_0482 — cc_delivery_release_due accepts the service role (27 Sep 2026)
--
--   delivery-worker / delivery-worker-sms call public.cc_delivery_release_due(p_channel) with the service key on
--   every tick, but the function was staff-only (app_private.can_manage_comms() reads the caller's staff
--   permissions — false for service_role), so every minute logged a 403 "not authorized" for 48 h+. Harmless
--   (app_private.comm_release_due() on cron does the same promotion since bl_comm_0397) but noise that hides a
--   real failure. Fix: the guard now passes for a service_role JWT as well (same idiom as bl_audit_0354/0365) —
--   staff callers unchanged, anon still revoked, ACL unchanged (authenticated + service_role).
begin;

create or replace function public.cc_delivery_release_due(p_channel text default null)
returns integer language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_n int;
begin
  if not (app_private.can_manage_comms()
          or coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb->>'role' = 'service_role') then
    raise exception 'not authorized' using errcode='42501';
  end if;
  update app_private.message_deliveries
    set status='queued', updated_at=now()
    where status='scheduled' and coalesce(scheduled_at, now()) <= now()
      and (p_channel is null or channel = p_channel);
  get diagnostics v_n = row_count;
  return v_n;
end; $$;
revoke execute on function public.cc_delivery_release_due(text) from anon, public;
grant  execute on function public.cc_delivery_release_due(text) to authenticated, service_role;

commit;
