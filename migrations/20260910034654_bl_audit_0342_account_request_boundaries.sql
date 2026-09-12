-- STAGING ONLY. Restore missing account request RPCs with ownership and workflow boundaries.
-- Requests never close the organization: the current carrier confirmation promises staff review.
-- No email is sent and no account request is processed by applying this file.
DO $guard$ BEGIN
 IF to_regprocedure('public.cc_request_account_action(text,text)') IS NOT NULL
 OR to_regprocedure('public.cc_account_requests(text,integer)') IS NOT NULL
 OR to_regprocedure('public.cc_resolve_account_request(uuid,text,text)') IS NOT NULL THEN
  RAISE EXCEPTION 'Account request RPC already exists; re-sync before applying';
 END IF;
 IF pg_get_functiondef('app_private.close_blockers(uuid)'::regprocedure) IS DISTINCT FROM $expected$CREATE OR REPLACE FUNCTION app_private.close_blockers(p_org uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
AS $function$
  select jsonb_build_object(
    'open_trips', (select count(*) from app_private.trips t
                    where t.carrier_id = p_org and t.status in ('planned','dispatched','in_transit')),
    'unpaid_settlements', (select count(*) from public.settlements s
                            where s.carrier_id = p_org and coalesce(s.status,'') <> 'paid'),
    'unpaid_amount', (select coalesce(sum(s.net),0) from public.settlements s
                       where s.carrier_id = p_org and coalesce(s.status,'') <> 'paid'))
$function$
$expected$ THEN
  RAISE EXCEPTION 'close_blockers changed; re-sync before applying';
 END IF;
END $guard$;
CREATE OR REPLACE FUNCTION app_private.close_blockers(p_org uuid)
 RETURNS jsonb LANGUAGE sql STABLE SET search_path TO 'pg_catalog'
AS $function$
 WITH legacy AS (
  SELECT count(*) AS n, coalesce(sum(s.net),0) AS amount
  FROM public.settlements s JOIN public.organizations o ON o.owner_user_id=s.carrier_id
  WHERE o.id=p_org AND s.status <> 'paid'
 ), finance AS (
  SELECT count(*) AS n, coalesce(sum(s.net),0) AS amount
  FROM app_private.fin_settlements s
  WHERE s.carrier_id=p_org AND s.status NOT IN ('paid','void')
 )
 SELECT jsonb_build_object(
  'open_trips',(SELECT count(*) FROM app_private.trips t WHERE t.carrier_id=p_org AND t.status IN ('planned','dispatched','in_transit')),
  'unpaid_settlements',legacy.n+finance.n,
  -- Counts are source records. When both ledgers contain entries, do not invent a deduplicated balance.
  'unpaid_amount',CASE WHEN legacy.n>0 AND finance.n>0 THEN NULL ELSE legacy.amount+finance.amount END,
  'legacy_unpaid_settlements',legacy.n,'legacy_unpaid_amount',legacy.amount,
  'finance_unpaid_settlements',finance.n,'finance_unpaid_amount',finance.amount
 ) FROM legacy CROSS JOIN finance;
$function$;

CREATE OR REPLACE FUNCTION public.cc_request_account_action(p_action text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare v_org uuid; v_name text; v_email text; v_id uuid; v_label text; v_open uuid;
        v_b jsonb; v_blocked boolean;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  if p_action IS NULL OR p_action not in ('pause','close') then
    raise exception 'action must be pause or close' using errcode='22023';
  end if;

  -- Serialize requests for this organization and require its actual owner.
  PERFORM 1 FROM public.organizations o
   WHERE o.id=v_org AND o.owner_user_id=auth.uid() AND o.kind='carrier'
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'only the carrier owner may request this action' USING errcode='42501'; END IF;
  IF EXISTS(SELECT 1 FROM public.organizations WHERE id=v_org AND status='closed') THEN
    RAISE EXCEPTION 'account is already closed' USING errcode='22023';
  END IF;

  select id into v_open from app_private.account_requests
   where org_id = v_org and action = p_action and status = 'open'
   order by created_at desc limit 1;
  if v_open is not null then
    return jsonb_build_object('ok', true, 'already_open', true, 'id', v_open);
  end if;

  select name into v_name from public.organizations where id = v_org;
  select email into v_email from public.profiles where id = auth.uid();
  v_label := case p_action when 'pause' then 'Pause new load offers' else 'Close account' end;

  v_b := app_private.close_blockers(v_org);
  v_blocked := p_action = 'close'
    and ((v_b->>'open_trips')::int > 0 or (v_b->>'unpaid_settlements')::int > 0);

  -- The portal promises staff review before closure. This RPC records a request.
  -- Pause, or a close we will not do silently.
  insert into app_private.account_requests(org_id, requested_by, action, reason)
  values (v_org, auth.uid(), p_action, nullif(btrim(p_reason), ''))
  returning id into v_id;

  insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
  values ('staff','in_app','account.request',
    jsonb_build_object('title', v_label || ' requested — ' || coalesce(v_name,'a carrier'),
      'body', coalesce(nullif(btrim(p_reason),''), 'No reason given.')
              || case when v_blocked then '  BLOCKED: ' || (v_b->>'open_trips') || ' live trip(s), ' || (v_b->>'unpaid_settlements') || ' unpaid settlement(s).' else '' end,
      'tone', case when p_action = 'close' then 'urgent' else 'warning' end,
      'url', '/carriers'), 'sent', now());

  begin
    perform app_private.sys_email(v_email, 'account.request',
      case p_action when 'pause' then 'We have your pause request' else 'About closing your account' end,
      '<h2 style="margin:0 0 8px;font-size:21px;color:#0f172a">' || v_label || ' — received</h2>'
      || case when v_blocked then
           '<p style="margin:0 0 14px;color:#475569;line-height:1.7">We could not close it straight away, and here is exactly why: you have <b>'
           || (v_b->>'open_trips') || '</b> load(s) still running and <b>' || (v_b->>'unpaid_settlements')
           || '</b> settlement(s) still unpaid. We are not going to switch your account off while a load is under way or while we owe you money. A person is on it now and will get both settled with you, then close it.</p>'
         when p_action = 'pause' then
           '<p style="margin:0 0 14px;color:#475569;line-height:1.7">We have your request and a person is picking it up. While paused you keep your account, documents and history — we simply stop sending new load offers.</p>'
         else
           '<p style="margin:0 0 14px;color:#475569;line-height:1.7">We have your request and a person is picking it up. Nothing has changed yet.</p>'
         end
      || '<p style="margin:0;color:#64748b;font-size:14px">Changed your mind? Reply to this email and we will drop it.<br>— LoadBoot · hello@loadboot.com</p>',
      null, 'accreq:' || v_id::text);
  exception when others then null; end;

  perform app_private.log_audit('account.request','carrier', v_org::text, v_org,
    v_label || ' requested', jsonb_build_object('action',p_action,'reason',p_reason,'blockers',v_b));
  return jsonb_build_object('ok', true, 'id', v_id, 'action', p_action,
    'closed', false, 'blocked', v_blocked, 'blockers', v_b);
end $function$

;
CREATE OR REPLACE FUNCTION public.cc_resolve_account_request(p_id uuid, p_status text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare r app_private.account_requests; v_b jsonb;
begin
  if not (public.has_global_permission('carriers.manage')
          or public.has_global_permission('dispatch.manage')
          or public.has_global_permission('documents.review')) then
    raise exception 'not authorized' using errcode='42501';
  end if;
  if p_status IS NULL OR p_status not in ('done','declined','withdrawn') then
    raise exception 'status must be done, declined or withdrawn' using errcode='22023';
  end if;
  SELECT * INTO r FROM app_private.account_requests WHERE id=p_id FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'request not found' USING errcode='22023'; END IF;
  IF r.status <> 'open' THEN RAISE EXCEPTION 'request is already resolved' USING errcode='22023'; END IF;
  IF p_status='done' AND r.action='close' THEN
    v_b:=app_private.close_blockers(r.org_id);
    IF (v_b->>'open_trips')::bigint>0 OR (v_b->>'unpaid_settlements')::bigint>0 THEN
      RAISE EXCEPTION 'finish active trips and settle unpaid records before resolving closure' USING errcode='55006';
    END IF;
  END IF;
  update app_private.account_requests
     set status = p_status, staff_note = p_note, handled_by = auth.uid(), handled_at = now()
   where id = p_id returning * into r;
  if r.id is null then raise exception 'request not found' using errcode='22023'; end if;
  perform app_private.log_audit('account.request_resolved','carrier', r.org_id::text, r.org_id,
    r.action || ' -> ' || p_status, jsonb_build_object('note', p_note));
  return jsonb_build_object('ok', true, 'id', r.id, 'status', p_status);
end $function$

;
CREATE OR REPLACE FUNCTION public.cc_account_requests(p_status text DEFAULT 'open'::text, p_limit integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare j jsonb;
begin
  if not (public.has_global_permission('carriers.manage')
          or public.has_global_permission('dispatch.manage')
          or public.has_global_permission('documents.review')) then
    raise exception 'not authorized' using errcode='42501';
  end if;
  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) into j from (
    select jsonb_build_object(
      'id', r.id, 'action', r.action, 'status', r.status, 'reason', r.reason,
      'created_at', r.created_at, 'staff_note', r.staff_note,
      'org_id', r.org_id, 'carrier', o.name,
      'email', (select p.email from public.profiles p where p.id = r.requested_by),
      -- A close request with a load still running is the one that must not be actioned
      -- quietly, so it travels with the request.
      'unpaid_settlements', (app_private.close_blockers(r.org_id)->>'unpaid_settlements')::bigint,
      'open_trips', (select count(*) from app_private.trips t
                      where t.carrier_id = r.org_id
                        and t.status in ('planned','dispatched','in_transit'))
    ) as x
    from app_private.account_requests r
    join public.organizations o on o.id = r.org_id
    where (p_status is null or r.status = p_status)
    order by r.created_at desc
    limit least(greatest(coalesce(p_limit,100),1),500)
  ) s;
  return j;
end $function$

;
REVOKE ALL ON FUNCTION public.cc_request_account_action(text,text),public.cc_account_requests(text,integer),public.cc_resolve_account_request(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cc_request_account_action(text,text),public.cc_account_requests(text,integer),public.cc_resolve_account_request(uuid,text,text) TO authenticated,service_role;

