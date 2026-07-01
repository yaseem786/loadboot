-- cvd_delivery_views.sql
-- Read-only list RPCs backing the Command Center Delivery Health / Failed / Dead-letter / Suppressions views.
-- Both are staff-gated (can_manage_comms) SECURITY DEFINER, anon revoked. No writes.
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

-- Recent deliveries, optionally filtered by status (e.g. 'failed','dead_letter','queued','delivered').
create or replace function public.cc_delivery_list(p_status text default null, p_limit integer default 100)
returns table(id uuid, campaign_id uuid, channel text, provider text, recipient_email text, status text,
              attempts integer, scheduled_at timestamptz, sent_at timestamptz, failure_reason text, created_at timestamptz)
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode='42501'; end if;
  return query
    select m.id, m.campaign_id, m.channel, m.provider, m.recipient_email, m.status, m.attempts,
           m.scheduled_at, m.sent_at, m.failure_reason, m.created_at
    from app_private.message_deliveries m
    where p_status is null or m.status = p_status
    order by m.created_at desc
    limit least(greatest(coalesce(p_limit,100),1),500);
end; $$;
revoke execute on function public.cc_delivery_list(text, integer) from anon, public;
grant  execute on function public.cc_delivery_list(text, integer) to authenticated;

-- Current suppression list (hard opt-outs / bounces / complaints).
create or replace function public.cc_suppressions_list(p_channel text default null, p_limit integer default 200)
returns table(id uuid, channel text, address text, reason text, created_at timestamptz)
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode='42501'; end if;
  return query
    select s.id, s.channel, s.address, s.reason, s.created_at
    from app_private.suppressions s
    where p_channel is null or s.channel = p_channel
    order by s.created_at desc
    limit least(greatest(coalesce(p_limit,200),1),1000);
end; $$;
revoke execute on function public.cc_suppressions_list(text, integer) from anon, public;
grant  execute on function public.cc_suppressions_list(text, integer) to authenticated;
