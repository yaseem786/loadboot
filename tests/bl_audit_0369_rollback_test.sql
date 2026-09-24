-- run in one transaction; ends in ROLLBACK-OK. Uses the prod/staging test carrier if present, else any carrier owner.
do $t$
declare v_user uuid; v_org uuid; r jsonb;
begin
  select m.user_id, m.org_id into v_user, v_org
    from public.organization_memberships m join public.organizations o on o.id = m.org_id
   where m.status = 'active' and o.kind = 'carrier' and o.status <> 'closed'
     and not exists (select 1 from app_private.trips t where t.carrier_id = o.id and t.status in ('planned','dispatched','in_transit'))
   order by (m.user_id = (select id from auth.users where email = 'muhammadyaseenhakeem786@gmail.com')) desc limit 1;
  if v_user is null then raise exception 'no carrier fixture'; end if;
  perform set_config('request.jwt.claims', json_build_object('role','authenticated','sub',v_user)::text, true);
  r := public.cc_request_account_action('close', 'zzt0369 probe');
  if (r->>'closed')::boolean is distinct from false then raise exception 'c1 closed=% %', r->>'closed', r; end if;
  if (select status from public.organizations where id = v_org) = 'closed' then raise exception 'c2 org was closed'; end if;
  if not exists (select 1 from app_private.account_requests where org_id = v_org and action = 'close' and status = 'open') then raise exception 'c3 no open request'; end if;
  r := public.cc_request_account_action('close', 'zzt0369 again');
  if (r->>'already_open')::boolean is distinct from true then raise exception 'c4 duplicate not folded %', r; end if;
  raise exception 'ROLLBACK-OK 4/4 bl_audit_0369';
end $t$;
