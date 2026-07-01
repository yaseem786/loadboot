-- cvf_delivery_release_due.sql
-- Closes the scheduled-send gap: enqueue writes future sends as status='scheduled', but cc_delivery_claim
-- only picks 'queued'. This promotes due scheduled rows (scheduled_at <= now) to 'queued' so a worker claims
-- them. Idempotent and safe to call on any cadence (cron / worker tick). Staff-gated, anon revoked.
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

create or replace function public.cc_delivery_release_due(p_channel text default null)
returns integer language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_n int;
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode='42501'; end if;
  update app_private.message_deliveries
    set status='queued', updated_at=now()
    where status='scheduled' and coalesce(scheduled_at, now()) <= now()
      and (p_channel is null or channel = p_channel);
  get diagnostics v_n = row_count;
  return v_n;
end; $$;
revoke execute on function public.cc_delivery_release_due(text) from anon, public;
grant  execute on function public.cc_delivery_release_due(text) to authenticated;
