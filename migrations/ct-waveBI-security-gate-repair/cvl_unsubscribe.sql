-- cvl_unsubscribe.sql
-- One-click unsubscribe (CAN-SPAM / RFC 8058 list-unsubscribe) WITHOUT widening the public surface.
-- The unsubscribe link carries a delivery's correlation_id (an unguessable 122-bit uuid) as an opaque token.
-- Resolution runs through a service-role RPC called by the `unsubscribe` edge function — NOT an anon DB grant —
-- so the anon SECURITY DEFINER surface stays at 5. Suppresses the recipient on the right channel and marks the
-- originating delivery 'unsubscribed'. Idempotent.
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

create or replace function public.cc_delivery_worker_unsubscribe(p_token uuid)
returns jsonb language plpgsql security definer set search_path to 'app_private, public'
as $$
declare d record;
begin
  select * into d from app_private.message_deliveries where correlation_id = p_token limit 1;
  if d.id is null then return jsonb_build_object('ok', false, 'reason', 'unknown token'); end if;
  if d.channel = 'email' and d.recipient_email is not null then
    insert into app_private.suppressions(channel,address,reason) values ('email', lower(d.recipient_email), 'unsubscribed') on conflict do nothing;
  elsif d.channel = 'sms' and d.recipient_phone is not null then
    insert into app_private.suppressions(channel,address,reason) values ('sms', d.recipient_phone, 'unsubscribed') on conflict do nothing;
  end if;
  update app_private.message_deliveries set status='unsubscribed', updated_at=now() where id=d.id;
  perform app_private.log_audit('comm.unsubscribe','delivery',d.id::text,null,'recipient unsubscribed via one-click link',
    jsonb_build_object('channel',d.channel));
  return jsonb_build_object('ok', true, 'channel', d.channel);
end; $$;
revoke execute on function public.cc_delivery_worker_unsubscribe(uuid) from public, anon, authenticated;
grant  execute on function public.cc_delivery_worker_unsubscribe(uuid) to service_role;
