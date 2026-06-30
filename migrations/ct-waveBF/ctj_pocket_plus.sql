-- CONTROL TOWER WAVE K — Carrier Pocket+ : carrier-facing support (raise issue + history).
-- Self-scoping: carrier org resolved from the session (organizations.owner_user_id); no
-- carrier-id parameter, so cross-carrier access is impossible. Applied to staging + production.
create or replace function public.cc_pocket_raise_issue(p_subject text, p_body text default null)
returns uuid language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_org uuid; v_email text; v_id uuid; v_ref text;
begin
  select id into v_org from public.organizations where owner_user_id=auth.uid() and kind='carrier' limit 1;
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  if coalesce(btrim(p_subject),'')='' then raise exception 'subject required' using errcode='22023'; end if;
  select email into v_email from public.profiles where id=auth.uid();
  insert into app_private.support_tickets(subject,body,requester_email,channel,category,priority,status,related_type,related_id,created_by)
    values (left(p_subject,200), left(coalesce(p_body,''),5000), v_email, 'pocket', 'carrier', 'normal', 'open', 'carrier', v_org::text, auth.uid())
    returning id, ref into v_id, v_ref;
  perform app_private.emit_event('ticket.created','support_ticket',v_id::text, jsonb_build_object('ref',v_ref,'priority','normal','source','pocket'));
  return v_id; end; $function$;

create or replace function public.cc_pocket_my_issues(p_limit int default 30)
returns table (id uuid, ref text, subject text, status text, created_at timestamptz)
language plpgsql stable security definer set search_path to 'app_private, public' as $function$
declare v_org uuid; v_l int := least(greatest(coalesce(p_limit,30),1),100);
begin
  select id into v_org from public.organizations where owner_user_id=auth.uid() and kind='carrier' limit 1;
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  return query select t.id,t.ref,t.subject,t.status,t.created_at from app_private.support_tickets t
    where t.related_type='carrier' and t.related_id=v_org::text and t.channel='pocket'
    order by t.created_at desc limit v_l; end; $function$;

revoke all on function public.cc_pocket_raise_issue(text,text) from public, anon;
revoke all on function public.cc_pocket_my_issues(int) from public, anon;
grant execute on function public.cc_pocket_raise_issue(text,text) to authenticated;
grant execute on function public.cc_pocket_my_issues(int) to authenticated;
