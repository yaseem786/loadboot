-- STAGING ONLY: reviewed compliance contracts. No cron, provider calls or backfills.
DO $guard$ DECLARE s text; BEGIN
 FOREACH s IN ARRAY ARRAY['public.cc_authority_board()','public.cc_org_set_docket(uuid,text,text)','public.cc_packet_set_dates(uuid,text,date,date)','public.cc_partner_compliance_board(integer)','public.cc_partner_packet_remind(uuid,text)','app_private.fmcsa_webkey()'] LOOP
  IF to_regprocedure(s) IS NOT NULL THEN RAISE EXCEPTION 'Expected absent staging function: %',s; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='app_private' AND ((table_name='org_onboarding_items' AND column_name='expires_at') OR (table_name='onboarding_packet_templates' AND column_name='revalidate_days'))) OR to_regclass('app_private.packet_revalidation_notices') IS NOT NULL THEN
  RAISE EXCEPTION 'Prerequisite drift; re-sync before applying';
 END IF;
 IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='app_private.org_onboarding_items'::regclass AND conname='org_onboarding_items_status_check') IS DISTINCT FROM 'CHECK ((status = ANY (ARRAY[''pending''::text, ''submitted''::text, ''verified''::text, ''rejected''::text, ''waived''::text])))' THEN RAISE EXCEPTION 'Status constraint drift'; END IF;
END $guard$;
ALTER TABLE app_private.org_onboarding_items ADD COLUMN expires_at date;
ALTER TABLE app_private.onboarding_packet_templates ADD COLUMN revalidate_days integer;
ALTER TABLE app_private.org_onboarding_items DROP CONSTRAINT org_onboarding_items_status_check;
ALTER TABLE app_private.org_onboarding_items ADD CONSTRAINT org_onboarding_items_status_check CHECK(status IN ('pending','submitted','verified','rejected','waived','expired'));
CREATE TABLE app_private.packet_revalidation_notices (
 org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
 item_key text NOT NULL,stage text NOT NULL,cycle date NOT NULL,sent_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(org_id,item_key,stage,cycle));
ALTER TABLE app_private.packet_revalidation_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_private.packet_revalidation_notices FROM PUBLIC,anon,authenticated,service_role;
-- Restore observed template defaults only for keys already present; no customer dates changed.
UPDATE app_private.onboarding_packet_templates t SET revalidate_days=v.days FROM (VALUES ('broker','bank_instructions',180),('broker','bmc84_bond',30),('broker','boc3',365),('broker','claims_procedure',365),('broker','coi',30),('broker','mc_authority',30),('broker','ucr',365),('carrier','ach_details',180),('carrier','auto_liability',30),('carrier','cargo_insurance',30),('carrier','coi_from_agent',30),('carrier','emergency_contact',365),('carrier','equipment_info',365),('carrier','hazmat_cert',365),('carrier','noa_factoring',180),('carrier','operating_authority',30),('carrier','safer_check',90),('shipper','billing_instructions',365),('shipper','cargo_profile',365),('shipper','claims_contact',365),('shipper','facility_rules',365),('shipper','insurance_requirements',365),('shipper','payment_terms',365)) v(kind,key,days) WHERE t.org_kind=v.kind AND t.item_key=v.key;
CREATE OR REPLACE FUNCTION app_private.fmcsa_webkey()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO pg_catalog
AS $function$
  select case when exists (select 1 from app_private.fmcsa_config where id and enabled)
              then 'configured' end;
$function$
;
REVOKE ALL ON FUNCTION app_private.fmcsa_webkey() FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.cc_authority_board()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO pg_catalog
AS $function$
declare v_out jsonb; v_key boolean;
begin
  if not coalesce(public.has_global_permission('compliance.view') or public.has_global_permission('compliance.manage') or public.has_global_permission('partners.view') or public.has_global_permission('partners.manage'),false) then
    raise exception 'not authorized' using errcode='42501';
  end if;

  v_key := app_private.fmcsa_webkey() is not null;

  select coalesce(jsonb_agg(jsonb_build_object(
           'org_id', o.id, 'org', o.name, 'kind', o.kind, 'org_status', o.status,
           'mc', d.mc, 'dot', d.dot,
           'authority_status', coalesce(c.authority_status, 'never_checked'),
           'legal_name', c.legal_name, 'safety_rating', c.safety_rating,
           'out_of_service', c.out_of_service,
           'checked_at', c.checked_at, 'last_error', c.last_error,
           'consecutive_fail', coalesce(c.consecutive_fail, 0)
         ) order by
           case coalesce(c.authority_status,'never_checked')
             when 'inactive' then 0 when 'not_found' then 1 when 'no_docket' then 2
             when 'error' then 3 when 'never_checked' then 4 else 5 end,
           o.name), '[]'::jsonb)
    into v_out
  from public.organizations o
  cross join lateral app_private.org_docket(o.id) d
  left join app_private.authority_checks c on c.org_id = o.id
  where o.kind in ('broker','carrier')
    and not o.is_demo
    and exists (select 1 from app_private.org_onboarding_items i
                 where i.org_id = o.id
                   and i.item_key in ('mc_authority','operating_authority'));

  return jsonb_build_object(
    'configured', v_key,
    'items', v_out,
    'inactive',    (select count(*) from jsonb_array_elements(v_out) e where e->>'authority_status' = 'inactive'),
    'no_docket',   (select count(*) from jsonb_array_elements(v_out) e where e->>'mc' is null and e->>'dot' is null),
    'never_checked',(select count(*) from jsonb_array_elements(v_out) e where e->>'authority_status' = 'never_checked')
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.cc_org_set_docket(p_org uuid,p_mc text DEFAULT NULL,p_dot text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $fn$
DECLARE v_mc text;v_dot text;o public.organizations%ROWTYPE;
BEGIN
 IF not coalesce(public.has_global_permission('compliance.manage') or public.has_global_permission('partners.manage'),false) THEN RAISE EXCEPTION 'not authorized' USING errcode='42501'; END IF;
 v_mc:=nullif(regexp_replace(coalesce(p_mc,''),'\D','','g'),'');
 v_dot:=nullif(regexp_replace(coalesce(p_dot,''),'\D','','g'),'');
 IF (v_mc IS NOT NULL AND length(v_mc) NOT BETWEEN 4 AND 8) OR (v_dot IS NOT NULL AND length(v_dot) NOT BETWEEN 5 AND 9) OR (v_mc IS NULL AND v_dot IS NULL) THEN RAISE EXCEPTION 'Provide a valid MC (4-8 digits) or USDOT (5-9 digits)' USING errcode='22023'; END IF;
 SELECT * INTO o FROM public.organizations WHERE id=p_org FOR UPDATE;
 IF NOT FOUND OR o.kind NOT IN ('broker','carrier') THEN RAISE EXCEPTION 'broker or carrier not found' USING errcode='22023'; END IF;
 v_mc:=coalesce(v_mc,o.mc_number);v_dot:=coalesce(v_dot,o.dot_number);
 IF v_mc IS DISTINCT FROM o.mc_number OR v_dot IS DISTINCT FROM o.dot_number THEN
  UPDATE public.organizations SET mc_number=v_mc,dot_number=v_dot WHERE id=p_org;
  -- Invalidate the entire old identity, including any in-flight request.
  UPDATE app_private.authority_checks SET mc_number=v_mc,dot_number=v_dot,
   request_id=NULL,requested_at=NULL,checked_at=NULL,authority_status=NULL,
   allowed_to_operate=NULL,legal_name=NULL,safety_rating=NULL,out_of_service=NULL,
   consecutive_fail=0,last_error=NULL,raw=NULL,entity_type=NULL,authority_type=NULL,mc_active=NULL
   WHERE org_id=p_org;
 END IF;
 RETURN jsonb_build_object('org_id',p_org,'mc_number',v_mc,'dot_number',v_dot);
END $fn$;
CREATE OR REPLACE FUNCTION public.cc_packet_set_dates(p_org uuid,p_key text,p_expires date DEFAULT NULL,p_recheck date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $fn$
DECLARE v_days integer;i app_private.org_onboarding_items%ROWTYPE;v_exp date;v_re date;v_due date;v_old date;
BEGIN
 IF not coalesce(public.has_global_permission('compliance.manage') or public.has_global_permission('partners.manage'),false) THEN RAISE EXCEPTION 'not authorized' USING errcode='42501'; END IF;
 IF (p_expires IS NOT NULL AND NOT isfinite(p_expires)) OR (p_recheck IS NOT NULL AND NOT isfinite(p_recheck)) THEN RAISE EXCEPTION 'Dates must be finite' USING errcode='22023'; END IF;
 SELECT t.revalidate_days INTO v_days FROM app_private.onboarding_packet_templates t JOIN public.organizations o ON o.kind=t.org_kind WHERE o.id=p_org AND t.item_key=p_key;
 IF NOT FOUND THEN RAISE EXCEPTION 'unknown packet item' USING errcode='22023'; END IF;
 SELECT * INTO i FROM app_private.org_onboarding_items WHERE org_id=p_org AND item_key=p_key FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'packet item not found' USING errcode='22023'; END IF;
 v_exp:=coalesce(p_expires,i.expires_at);v_re:=coalesce(p_recheck,i.recheck_due,case when v_days IS NOT NULL then current_date+v_days end);
 v_old:=least(coalesce(i.expires_at,'infinity'::date),coalesce(i.recheck_due,'infinity'::date));
 v_due:=least(coalesce(v_exp,'infinity'::date),coalesce(v_re,'infinity'::date));
 UPDATE app_private.org_onboarding_items SET expires_at=v_exp,recheck_due=v_re WHERE org_id=p_org AND item_key=p_key;
 -- Same/earlier effective due date is the same warning cycle; daily manual caps survive renewal.
 IF v_due>v_old THEN DELETE FROM app_private.packet_revalidation_notices WHERE org_id=p_org AND item_key=p_key AND stage<>'manual_missing'; END IF;
 RETURN jsonb_build_object('item_key',p_key,'expires_at',v_exp,'recheck_due',v_re,'status',i.status);
END $fn$;
CREATE OR REPLACE FUNCTION public.cc_partner_compliance_board(p_days integer DEFAULT 45)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO pg_catalog
AS $function$
declare v_out jsonb;
begin
  if not coalesce(public.has_global_permission('compliance.view') or public.has_global_permission('compliance.manage') or public.has_global_permission('partners.view') or public.has_global_permission('partners.manage'),false) then
    raise exception 'not authorized' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(x order by x->>'sort_key'), '[]'::jsonb) into v_out
  from (
    select jsonb_build_object(
      'org_id',      o.id,
      'org',         o.name,
      'kind',        o.kind,
      'org_status',  o.status,
      'item_key',    i.item_key,
      'label',       t.label,
      'tag',         t.status_tag,
      'status',      i.status,
      'expires_at',  i.expires_at,
      'recheck_due', i.recheck_due,
      'lapsed_at',   i.lapsed_at,
      'due',         case when isfinite(d.due) then d.due end,
      'days_left',   (case when isfinite(d.due) then d.due - current_date end),
      'state',       case when i.status = 'expired' then 'lapsed'
                          when d.due < current_date  then 'overdue'
                          else 'due_soon' end,
      'owner_email', (select email from public.profiles pr where pr.id = o.owner_user_id),
      -- lapsed first, then soonest due
      'sort_key',    lpad((case when i.status='expired' then 0 else 1 end)::text, 1, '0')
                     || lpad(greatest(0, least(99999, case when isfinite(d.due) then d.due - current_date else 99999 end))::text, 5, '0')
    ) as x
    from app_private.org_onboarding_items i
    join public.organizations o on o.id = i.org_id and not o.is_demo
    join app_private.onboarding_packet_templates t
      on t.org_kind = o.kind and t.item_key = i.item_key
    cross join lateral (
      select least(coalesce(i.expires_at, 'infinity'::date),
                   coalesce(i.recheck_due, 'infinity'::date)) as due
    ) d
    where (i.status = 'expired')
       or (i.status = 'verified' and d.due <> 'infinity'::date
           and d.due <= current_date + greatest(1, least(coalesce(p_days,45), 365)))
  ) q;

  return jsonb_build_object(
    'items', v_out,
    'lapsed',  (select count(*) from jsonb_array_elements(v_out) e where e->>'state' = 'lapsed'),
    'overdue', (select count(*) from jsonb_array_elements(v_out) e where e->>'state' = 'overdue'),
    'due_soon',(select count(*) from jsonb_array_elements(v_out) e where e->>'state' = 'due_soon'),
    'window_days', greatest(1, least(coalesce(p_days,45), 365))
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.cc_partner_packet_remind(p_org uuid,p_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO pg_catalog AS $fn$
DECLARE v_label text;v_name text;v_status text;v_base text;v_idem text;v_sent integer:=0;v_rows integer;m record;
BEGIN
 IF NOT coalesce(public.has_global_permission('partners.manage') OR public.has_global_permission('dispatch.manage'),false) THEN RAISE EXCEPTION 'not authorized' USING errcode='42501'; END IF;
 SELECT name INTO v_name FROM public.organizations WHERE id=p_org FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'organization not found' USING errcode='22023'; END IF;
 SELECT t.label INTO v_label FROM app_private.onboarding_packet_templates t JOIN public.organizations o ON o.kind=t.org_kind WHERE o.id=p_org AND t.item_key=p_key;
 IF NOT FOUND THEN RAISE EXCEPTION 'unknown packet item' USING errcode='22023'; END IF;
 SELECT status INTO v_status FROM app_private.org_onboarding_items WHERE org_id=p_org AND item_key=p_key FOR UPDATE;
 IF coalesce(v_status,'pending') NOT IN ('pending','rejected') THEN RAISE EXCEPTION 'Item is not missing or rejected' USING errcode='22023'; END IF;
 v_base:='pktrem:'||p_org||':'||p_key||':'||to_char(current_date,'YYYYMMDD');
 -- Honor legacy per-day keys too, avoiding re-send on an upgrade day.
 IF EXISTS(SELECT 1 FROM app_private.message_deliveries WHERE idempotency_key=v_base) THEN RETURN jsonb_build_object('ok',true,'item',p_key,'emails',0,'already_sent',true); END IF;
 INSERT INTO app_private.packet_revalidation_notices(org_id,item_key,stage,cycle) VALUES(p_org,p_key,'manual_missing',current_date) ON CONFLICT DO NOTHING;
 GET DIAGNOSTICS v_rows=ROW_COUNT;
 IF v_rows=0 THEN RETURN jsonb_build_object('ok',true,'item',p_key,'emails',0,'already_sent',true); END IF;
 -- A storage error rolls back the cap; do not report a swallowed notification failure as success.
 INSERT INTO app_private.partner_notifications(partner_org,title,body,kind,url)
 VALUES(p_org,'Reminder: '||v_label||' is still missing','Your onboarding packet is waiting on this item. Upload it under Onboarding.','urgent','/app/partner/#onboarding');
 FOR m IN SELECT DISTINCT lower(u.email) AS email FROM public.organization_memberships om JOIN auth.users u ON u.id=om.user_id WHERE om.org_id=p_org AND om.status='active' AND u.email IS NOT NULL ORDER BY lower(u.email) LIMIT 3 LOOP
  v_idem:=v_base||':'||md5(m.email);
  IF NOT EXISTS(SELECT 1 FROM app_private.message_deliveries WHERE idempotency_key=v_idem) THEN
   PERFORM app_private.sys_email(m.email,'onboarding.item_reminder','Reminder: '||v_label||' is missing from your LoadBoot onboarding',
    '<p>Hi '||app_private.h_esc(coalesce(v_name,'there'))||',</p><p>Your onboarding packet is still missing <b>'||app_private.h_esc(v_label)||'</b>.</p><p>Upload it at <a href="https://loadboot.com/app/partner/#onboarding">Onboarding</a>.</p>',
    'Your LoadBoot onboarding packet is still missing '||v_label||'. Upload it at https://loadboot.com/app/partner/#onboarding',v_idem);
   IF EXISTS(SELECT 1 FROM app_private.message_deliveries WHERE idempotency_key=v_idem AND status='queued') THEN v_sent:=v_sent+1; END IF;
  END IF;
 END LOOP;
 PERFORM app_private.log_audit('onboarding.item_remind','org',p_org::text,p_org,'reminder queued for '||p_key,jsonb_build_object('emails_queued',v_sent));
 RETURN jsonb_build_object('ok',true,'item',p_key,'emails',v_sent,'already_sent',false);
END $fn$;
REVOKE ALL ON FUNCTION public.cc_authority_board() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cc_authority_board() TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.cc_org_set_docket(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cc_org_set_docket(uuid,text,text) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.cc_packet_set_dates(uuid,text,date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cc_packet_set_dates(uuid,text,date,date) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.cc_partner_compliance_board(integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cc_partner_compliance_board(integer) TO authenticated,service_role;
REVOKE ALL ON FUNCTION public.cc_partner_packet_remind(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cc_partner_packet_remind(uuid,text) TO authenticated,service_role;

