-- bl_mail_0180 — suppression policy split + honor "reply to unsubscribe".
-- Applied to production 2026-07-31 (this file is the repo record of that change).
--
-- Policy (matches how serious ESPs behave):
--   * bounced / complained  -> block EVERYTHING to that address (deliverability protection).
--   * unsubscribed          -> block MARKETING only (outreach.% / campaign). A carrier who
--     unsubscribes from cold outreach must still receive operational email (rate cons,
--     document decisions, billing) once they become a customer.
-- bl_mail_0179 blocked everything for every reason; this refines it.
--
-- Also: cc_mail_unsubscribe_from(p_email) — service-role RPC used by inbound-mail so that a
-- plain reply saying "unsubscribe" is honored automatically (the unsubscribe page and the
-- email footer both tell people they can reply with the word "unsubscribe").
-- Grants: service_role only. Anon-executable definer count stays 26.

create or replace function app_private.sys_email(p_to text, p_template text, p_subject text, p_html text, p_text text default null::text, p_idem text default null::text)
returns void language plpgsql
as $function$
begin
  if p_to is null or p_to !~ '^[^@]+@[^@]+\.[^@]+$' then return; end if;
  if exists (select 1 from app_private.suppressions s
             where s.channel='email' and s.address=lower(p_to)
               and (s.reason in ('bounced','complained') or p_template like 'outreach.%')) then return; end if;
  insert into app_private.message_deliveries(source,channel,provider,recipient_email,idempotency_key,status,scheduled_at,template_key,meta)
  values ('transactional','email','resend',lower(p_to),
    coalesce(p_idem, 'sys:'||p_template||':'||lower(p_to)||':'||extract(epoch from now())::bigint::text),
    'queued', now(), p_template,
    jsonb_build_object('subject',p_subject,'body_html',p_html,'body_text',coalesce(p_text,p_subject),'category','transactional'))
  on conflict (idempotency_key) do nothing;
end; $function$;

create or replace function public.cc_delivery_worker_claim(p_limit integer default 50, p_channel text default 'email')
returns setof app_private.message_deliveries language plpgsql security definer set search_path to 'app_private, public'
as $function$
begin
  -- Close out queued deliveries that suppression policy now blocks.
  update app_private.message_deliveries m
    set status='unsubscribed', failure_reason='recipient suppressed', updated_at=now()
    where m.status='queued' and m.channel=p_channel
      and exists (select 1 from app_private.suppressions s
                  where s.channel=m.channel
                    and s.address = case when m.channel='email' then lower(m.recipient_email) else m.recipient_phone end
                    and (s.reason in ('bounced','complained') or m.template_key like 'outreach.%' or m.source='campaign'));
  return query with claimed as (select id from app_private.message_deliveries m
      where m.status='queued' and m.channel=p_channel and coalesce(m.scheduled_at,now())<=now()
        and not exists (select 1 from app_private.suppressions s
                        where s.channel=m.channel
                          and s.address = case when m.channel='email' then lower(m.recipient_email) else m.recipient_phone end
                          and (s.reason in ('bounced','complained') or m.template_key like 'outreach.%' or m.source='campaign'))
      order by m.scheduled_at nulls first for update skip locked limit least(greatest(coalesce(p_limit,50),1),500))
    update app_private.message_deliveries m set status='claimed', claimed_at=now(), attempts=attempts+1, updated_at=now()
    from claimed where m.id=claimed.id returning m.*;
end; $function$;

create or replace function public.cc_mail_unsubscribe_from(p_email text)
returns jsonb language plpgsql security definer set search_path to 'app_private, public'
as $function$
declare v_email text := lower(trim(p_email));
begin
  if v_email is null or v_email !~ '^[^@]+@[^@]+\.[^@]+$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid email');
  end if;
  insert into app_private.suppressions(channel,address,reason) values ('email', v_email, 'unsubscribed') on conflict do nothing;
  update app_private.outreach_contacts set status='unsubscribed' where lower(email)=v_email and status <> 'unsubscribed';
  perform app_private.log_audit('comm.unsubscribe','email',v_email,null,'recipient unsubscribed by replying to an email', '{}'::jsonb);
  return jsonb_build_object('ok', true);
end; $function$;

revoke all on function public.cc_mail_unsubscribe_from(text) from public, anon, authenticated;
grant execute on function public.cc_mail_unsubscribe_from(text) to service_role;
