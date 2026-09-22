-- bl_comm_0396: the per-email send feed behind the catalog's detail drawer.
-- One question, answered honestly: for THIS email key — who got it, when, what happened,
-- and who was blocked before it left. Sends and blocks are merged into one timeline so a
-- missing email is visible rather than absent.
--
-- Note on opens: no production row has opened_at set — open tracking is not live outside
-- the campaign pixel. The columns are returned as they are; the screen says "not tracked"
-- rather than pretending a zero means nobody opened it.

create or replace function public.cc_email_sends(
  p_key text,
  p_status text default null,
  p_q text default null,
  p_limit int default 50,
  p_offset int default 0)
returns jsonb language plpgsql security definer set search_path = public, app_private as $$
declare v_rows jsonb; v_total int; v_stats jsonb; v_lim int; v_off int;
begin
  if not public.has_global_permission('comm.view') then
    raise exception 'not authorized' using errcode='42501'; end if;

  v_lim := least(greatest(coalesce(p_limit,50),1),200);
  v_off := greatest(coalesce(p_offset,0),0);

  create temp table _feed on commit drop as
  with base as (
    select d.id::text as id, 'send'::text as kind, d.created_at as at_ts,
           d.recipient_email as email, d.recipient_user, d.org_id,
           d.status, d.sent_at, d.delivered_at, d.opened_at, d.clicked_at,
           d.failure_reason as note, d.meta->>'subject' as subject,
           d.meta->>'sender' as sender, d.source
      from app_private.message_deliveries d
     where d.template_key = p_key
    union all
    select 'b'||b.id::text, 'blocked', b.created_at,
           b.recipient_email, b.recipient_user, null::uuid,
           'blocked', null, null, null, null,
           coalesce(b.reason,'blocked by preference')||
             case when b.group_code is not null then ' ('||b.group_code||')' else '' end,
           null, null, null
      from app_private.email_blocked_log b
     where b.template_key = p_key
  )
  select b.*, p.contact_name, p.company, p.role as person_role,
         o.name as org_name, o.kind as org_kind,
         case o.kind
           when 'carrier' then '#/carrier?id='||o.id::text
           when 'broker'  then '#/broker?id='||o.id::text
           when 'shipper' then '#/broker?id='||o.id::text
           else null end as deep_link
    from base b
    left join public.profiles p on p.id = b.recipient_user
    left join public.organizations o on o.id = b.org_id;

  select count(*) into v_total from _feed f
   where (p_status is null or f.status = p_status)
     and (p_q is null or f.email ilike '%'||p_q||'%'
          or coalesce(f.contact_name,'') ilike '%'||p_q||'%'
          or coalesce(f.org_name,'') ilike '%'||p_q||'%');

  select coalesce(jsonb_agg(to_jsonb(x) order by x.at_ts desc),'[]'::jsonb) into v_rows
    from (select * from _feed f
           where (p_status is null or f.status = p_status)
             and (p_q is null or f.email ilike '%'||p_q||'%'
                  or coalesce(f.contact_name,'') ilike '%'||p_q||'%'
                  or coalesce(f.org_name,'') ilike '%'||p_q||'%')
           order by f.at_ts desc
           limit v_lim offset v_off) x;

  select jsonb_build_object(
      'total',      (select count(*) from _feed),
      'sent',       (select count(*) from _feed where kind='send'),
      'blocked',    (select count(*) from _feed where kind='blocked'),
      'delivered',  (select count(*) from _feed where status='delivered'),
      'bounced',    (select count(*) from _feed where status in ('bounced','complained','dead_letter')),
      'queued',     (select count(*) from _feed where status in ('queued','claimed','sent')),
      'opened',     (select count(*) from _feed where opened_at is not null),
      'clicked',    (select count(*) from _feed where clicked_at is not null),
      'last_30d',   (select count(*) from _feed where at_ts > now() - interval '30 days'),
      'first_seen', (select min(at_ts) from _feed),
      'last_seen',  (select max(at_ts) from _feed),
      'people',     (select count(distinct lower(email)) from _feed),
      'open_tracking', (select count(*) > 0 from app_private.message_deliveries where opened_at is not null)
  ) into v_stats;

  return jsonb_build_object('ok',true,'key',p_key,'total',v_total,'rows',v_rows,'stats',v_stats,
                            'as_of', now());
end $$;

revoke all on function public.cc_email_sends(text,text,text,int,int) from public, anon;
grant execute on function public.cc_email_sends(text,text,text,int,int) to authenticated;
