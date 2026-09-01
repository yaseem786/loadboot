-- bl_out_0312_outreach_only_unsubscribe
-- 2026-09-01 — make every outreach unsubscribe route immediate, durable and marketing-only.
--
-- Guarantees:
--   * Footer {UNSUB}, RFC 8058 one-click, and a reply containing "unsubscribe" all set the
--     outreach contact to unsubscribed and add an email suppression.
--   * reason='unsubscribed' is intentionally marketing-only under the existing sys_email /
--     delivery-worker policy. Account, load, document, support, billing and other operational
--     email stays deliverable. Bounce/complaint suppression remains global.
--   * Queued/claimed marketing rows are closed immediately.
--   * The worker gets a final pre-Resend guard to close the claim-to-send race.
--   * Historical footer unsubscribes are backfilled into suppressions.

create or replace function public.outreach_unsubscribe(p_email text, p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'app_private, public'
as $function$
declare
  v_email text := lower(trim(p_email));
begin
  if v_email is null or v_email !~ '^[^@]+@[^@]+\\.[^@]+$' then
    return jsonb_build_object('ok', false, 'error', 'invalid link');
  end if;
  if p_token is distinct from app_private.outreach_unsub_token(v_email) then
    return jsonb_build_object('ok', false, 'error', 'invalid link');
  end if;

  update app_private.outreach_contacts
     set status = 'unsubscribed'
   where lower(trim(email)) = v_email
     and status <> 'unsubscribed';

  insert into app_private.suppressions(channel, address, reason)
  values ('email', v_email, 'unsubscribed')
  on conflict do nothing;

  update app_private.message_deliveries
     set status = 'unsubscribed',
         failure_reason = 'recipient opted out of marketing/outreach',
         updated_at = now()
   where channel = 'email'
     and lower(recipient_email) = v_email
     and (template_key like 'outreach.%' or source = 'campaign')
     and status in ('queued', 'claimed');

  perform app_private.log_audit(
    'comm.outreach_unsubscribe', 'email', v_email, null,
    'recipient unsubscribed through outreach footer',
    jsonb_build_object('scope', 'marketing')
  );

  return jsonb_build_object('ok', true, 'scope', 'marketing');
end;
$function$;

revoke all on function public.outreach_unsubscribe(text, text) from public;
grant execute on function public.outreach_unsubscribe(text, text) to anon, authenticated, service_role;

create or replace function public.cc_delivery_worker_unsubscribe(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'app_private, public'
as $function$
declare
  d app_private.message_deliveries%rowtype;
  v_email text;
  v_marketing boolean;
begin
  select * into d
    from app_private.message_deliveries
   where correlation_id = p_token
   limit 1;

  if d.id is null then
    return jsonb_build_object('ok', false, 'reason', 'unknown token');
  end if;

  if d.channel = 'email' and d.recipient_email is not null then
    v_email := lower(trim(d.recipient_email));
    v_marketing := coalesce(d.template_key like 'outreach.%', false) or d.source = 'campaign';

    -- A token from an older operational email remains a valid way to opt out of marketing,
    -- but it never suppresses operational delivery or rewrites that operational row.
    insert into app_private.suppressions(channel, address, reason)
    values ('email', v_email, 'unsubscribed')
    on conflict do nothing;

    update app_private.outreach_contacts
       set status = 'unsubscribed'
     where lower(trim(email)) = v_email
       and status <> 'unsubscribed';

    update app_private.message_deliveries
       set status = 'unsubscribed',
           failure_reason = 'recipient opted out of marketing/outreach',
           updated_at = now()
     where channel = 'email'
       and lower(recipient_email) = v_email
       and (template_key like 'outreach.%' or source = 'campaign')
       and status in ('queued', 'claimed');

    if v_marketing then
      update app_private.message_deliveries
         set status = 'unsubscribed', updated_at = now()
       where id = d.id;
    end if;

    perform app_private.log_audit(
      'comm.outreach_unsubscribe', 'delivery', d.id::text, null,
      'recipient unsubscribed through one-click link',
      jsonb_build_object('channel', 'email', 'scope', 'marketing')
    );

    return jsonb_build_object('ok', true, 'channel', 'email', 'scope', 'marketing');
  elsif d.channel = 'sms' and d.recipient_phone is not null then
    insert into app_private.suppressions(channel, address, reason)
    values ('sms', d.recipient_phone, 'unsubscribed')
    on conflict do nothing;

    update app_private.message_deliveries
       set status = 'unsubscribed', updated_at = now()
     where id = d.id;

    perform app_private.log_audit(
      'comm.unsubscribe', 'delivery', d.id::text, null,
      'recipient unsubscribed from SMS through one-click link',
      jsonb_build_object('channel', 'sms')
    );

    return jsonb_build_object('ok', true, 'channel', 'sms');
  end if;

  return jsonb_build_object('ok', false, 'reason', 'unsupported channel');
end;
$function$;

revoke all on function public.cc_delivery_worker_unsubscribe(uuid) from public, anon, authenticated;
grant execute on function public.cc_delivery_worker_unsubscribe(uuid) to service_role;

create or replace function public.cc_mail_unsubscribe_from(p_email text)
returns jsonb
language plpgsql
security definer
set search_path to 'app_private, public'
as $function$
declare
  v_email text := lower(trim(p_email));
begin
  if v_email is null or v_email !~ '^[^@]+@[^@]+\\.[^@]+$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid email');
  end if;

  insert into app_private.suppressions(channel, address, reason)
  values ('email', v_email, 'unsubscribed')
  on conflict do nothing;

  update app_private.outreach_contacts
     set status = 'unsubscribed'
   where lower(trim(email)) = v_email
     and status <> 'unsubscribed';

  update app_private.message_deliveries
     set status = 'unsubscribed',
         failure_reason = 'recipient opted out of marketing/outreach by reply',
         updated_at = now()
   where channel = 'email'
     and lower(recipient_email) = v_email
     and (template_key like 'outreach.%' or source = 'campaign')
     and status in ('queued', 'claimed');

  perform app_private.log_audit(
    'comm.outreach_unsubscribe', 'email', v_email, null,
    'recipient unsubscribed by replying to an email',
    jsonb_build_object('scope', 'marketing')
  );

  return jsonb_build_object('ok', true, 'scope', 'marketing');
end;
$function$;

revoke all on function public.cc_mail_unsubscribe_from(text) from public, anon, authenticated;
grant execute on function public.cc_mail_unsubscribe_from(text) to service_role;

create or replace function public.cc_delivery_worker_marketing_allowed(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'app_private, public'
as $function$
  select coalesce((
    select
      d.status = 'claimed'
      and not exists (
        select 1
          from app_private.suppressions s
         where s.channel = d.channel
           and s.address = lower(d.recipient_email)
           and (
             s.reason in ('bounced', 'complained')
             or d.template_key like 'outreach.%'
             or d.source = 'campaign'
           )
      )
      and (
        d.template_key not like 'outreach.%'
        or exists (
          select 1
            from app_private.outreach_contacts oc
           where lower(trim(oc.email)) = lower(d.recipient_email)
             and oc.status in ('active', 'completed')
             and oc.replied_at is null
             and oc.converted_at is null
        )
      )
    from app_private.message_deliveries d
    where d.id = p_id
      and d.channel = 'email'
      and (d.template_key like 'outreach.%' or d.source = 'campaign')
  ), false);
$function$;

revoke all on function public.cc_delivery_worker_marketing_allowed(uuid) from public, anon, authenticated;
grant execute on function public.cc_delivery_worker_marketing_allowed(uuid) to service_role;

-- Backfill old footer-only opt-outs so every future outreach path sees them.
insert into app_private.suppressions(channel, address, reason)
select 'email', lower(trim(oc.email)), 'unsubscribed'
  from app_private.outreach_contacts oc
 where oc.status = 'unsubscribed'
on conflict do nothing;

update app_private.message_deliveries d
   set status = 'unsubscribed',
       failure_reason = 'recipient opted out of marketing/outreach',
       updated_at = now()
 where d.channel = 'email'
   and (d.template_key like 'outreach.%' or d.source = 'campaign')
   and d.status in ('queued', 'claimed')
   and exists (
     select 1 from app_private.suppressions s
      where s.channel = 'email'
        and s.address = lower(d.recipient_email)
        and s.reason = 'unsubscribed'
   );

