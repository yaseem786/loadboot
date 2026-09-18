-- bl_ios_0349_apns_push.sql — iOS App Store shell: APNs device tokens ride the existing
-- push_subscriptions table (endpoint = 'apns:<hex token>', p256dh/auth = 'apns').
-- No change to cc_save_push_subscription / cc_push_targets / the web push path.
--
-- Adds:
--   1. platform (generated) — 'apns' | 'web', for CC stats and for pruning.
--   2. cc_push_drop_endpoint(text) — service-role only. push-send calls it when APNs answers
--      410 Unregistered / 400 BadDeviceToken so dead tokens stop being retried.
--   3. index on platform.
-- Apply: STAGING first, then production (both via Supabase SQL editor / MCP apply_migration).

alter table app_private.push_subscriptions
  add column if not exists platform text
  generated always as (case when endpoint like 'apns:%' then 'apns' else 'web' end) stored;

create index if not exists push_subscriptions_platform_idx
  on app_private.push_subscriptions (platform);

create or replace function public.cc_push_drop_endpoint(p_endpoint text)
returns boolean
language plpgsql
security definer
set search_path = public, app_private
as $$
declare v_n int;
begin
  if coalesce(p_endpoint, '') = '' then return false; end if;
  delete from app_private.push_subscriptions where endpoint = p_endpoint;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

revoke all on function public.cc_push_drop_endpoint(text) from public, anon, authenticated;
grant execute on function public.cc_push_drop_endpoint(text) to service_role;

comment on function public.cc_push_drop_endpoint(text) is
  'bl_ios_0349: service-role only. Removes a dead push endpoint (APNs 410/400 or Web Push 404/410). Called by the push-send edge function.';
