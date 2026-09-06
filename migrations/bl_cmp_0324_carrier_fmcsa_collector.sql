-- bl_cmp_0324 — carrier FMCSA auto-check: reuse the broker authority collector for carriers (audit F30, Sprint 2 item 2)
-- 2026-09-05 · Claude · staging first (with the prerequisite port below), prod on Yaseen's "go and complete all"
--
-- WHY (prod evidence, 5 Sep, read-only)
--   • 44 non-demo carriers, 0 rows in app_private.authority_checks, 0 ever eligible for the daily FMCSA poll.
--   • app_private.trg_auto_fmcsa_at_signup (trigger on profiles) posts to fmcsa-verify with NO Authorization header and
--     no carrier_org → fmcsa-verify persists nothing; the trigger then audit-logs "FMCSA lookup auto-queued at signup".
--     30 days: 22 such audit rows, 0 verifications. A silent no-op that reads as work done.
--   • The working pipeline (bl_fmcsa_0228–0231, prod only) is broker-shaped: fmcsa_authority_dispatch(40) daily 06:10 UTC
--     picks orgs whose onboarding item mc_authority/operating_authority is verified|expired — carriers never have that
--     item in that state (2 of 44 have it at all, both 'submitted'). fmcsa_authority_collect() every 5 min reads
--     net._http_response and writes authority_checks; it already refuses to pause carriers (kind <> 'carrier').
--
-- WHAT THIS DOES (additive; no table dropped, no column removed, no existing broker behaviour changed)
--   0. PREREQUISITES (no-ops on prod; ports the poll schema to STAGING, which never received bl_fmcsa_0228–0231):
--      organizations.is_demo (default false), app_private.authority_checks (+index), app_private.org_docket(uuid) — now with a
--      2b fallback to the OWNER'S PROFILE dot/mc (carrier signup stores the docket there; 6 of 44 prod carriers had it
--      nowhere else) — and the two cron jobs (only if absent).
--   1. NEW app_private.fmcsa_authority_request(p_org uuid) returns bigint — the single "queue a check for this org"
--      primitive, factored out of fmcsa_authority_dispatch. Uses fmcsa_config.auth_key (the project anon JWT; never a
--      service key). Idempotent: in-flight request or checked < 20 h ago → returns null, does nothing.
--   2. fmcsa_authority_dispatch(int): same loop, now calls the primitive; CARRIERS are eligible whenever a docket is on
--      file (brokers keep the onboarding-item gate).
--   3. fmcsa_authority_collect(): status now prefers fmcsa-verify's verified verdict (carrier.authority when
--      authorityVerified=true — L&I or SAFER) over the census allowedToOperate/mcActive fallback; NEW — for carrier orgs it upserts app_private.carrier_safety
--      (source='fmcsa', the check constraint allows manual|fmcsa) and inserts app_private.carrier_verifications (source='auto', status='pending_review',
--      max one per org per 20 h). On 'inactive' a CARRIER gets a staff in-app notification only — no org status change,
--      no email to the carrier (Yaseen sends personal messages himself). Broker path unchanged.
--   4. trg_auto_fmcsa_at_signup(): same trigger, same name/signature (attachments + ACL untouched); body now resolves
--      the user's carrier org and calls fmcsa_authority_request(); audit row 'compliance.fmcsa.requested' carries the
--      request id (or 'compliance.fmcsa.skipped' with the reason). The unauthenticated net.http_post is gone.
--   5. Backfill helper app_private.fmcsa_carrier_backfill(p_limit int default 40) — queues carriers with a docket and no
--      check yet. Run by hand: select app_private.fmcsa_carrier_backfill(40); once per minute until it returns 0.
--
-- TEST: docs/audit-2026-09/tests/bl_cmp_0324_rollback_test.sql (DO … RAISE; fakes a net._http_response row; nothing persists).
-- ROLLBACK: bl_cmp_0324_rollback() below restores the previous trigger body (no-op version) and drops the new functions;
--           collect/dispatch keep the new bodies (they are supersets) — drop carrier rows with
--           delete from app_private.carrier_verifications where source='auto'; if ever needed.

-- ============================================================================================
-- 0. prerequisites (idempotent; real work only on staging)
-- ============================================================================================
alter table public.organizations add column if not exists is_demo boolean default false;

create table if not exists app_private.authority_checks (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  mc_number text, dot_number text,
  request_id bigint, requested_at timestamptz, checked_at timestamptz,
  authority_status text, allowed_to_operate text, legal_name text, safety_rating text,
  out_of_service boolean, consecutive_fail integer not null default 0, last_error text, raw jsonb,
  entity_type text, authority_type text, mc_active boolean
);
create index if not exists authority_checks_pending_idx on app_private.authority_checks (requested_at) where request_id is not null;

CREATE OR REPLACE FUNCTION app_private.org_docket(p_org uuid)
 RETURNS TABLE(mc text, dot text) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'app_private, public'
AS $function$
declare v_ref text; v_mc text; v_dot text;
begin
  select nullif(regexp_replace(coalesce(mc_number,''),  '\D','','g'), ''),
         nullif(regexp_replace(coalesce(dot_number,''), '\D','','g'), '')
    into v_mc, v_dot from public.organizations where id = p_org;
  if v_mc is null and v_dot is null then
    select nullif(regexp_replace(coalesce(cs.mc_number,''),  '\D','','g'), ''),
           nullif(regexp_replace(coalesce(cs.dot_number,''), '\D','','g'), '')
      into v_mc, v_dot from app_private.carrier_safety cs
     where cs.carrier_id = p_org order by cs.last_checked desc nulls last limit 1;
  end if;
  -- bl_cmp_0324: 2b. the owner's profile (carrier signup writes dot/mc there, not on the org — 6 of 44 prod carriers)
  if v_mc is null and v_dot is null then
    select nullif(regexp_replace(coalesce(p.mc,''),  '\D','','g'), ''),
           nullif(regexp_replace(coalesce(p.dot,''), '\D','','g'), '')
      into v_mc, v_dot
      from public.organizations o join public.profiles p on p.id = o.owner_user_id
     where o.id = p_org;
  end if;
  if v_mc is null and v_dot is null then
    select i.ref into v_ref from app_private.org_onboarding_items i
     where i.org_id = p_org and i.item_key in ('mc_authority','operating_authority') and coalesce(i.ref,'') <> '' limit 1;
    if v_ref is not null then
      v_mc  := nullif(regexp_replace(coalesce((regexp_match(v_ref, '(?i)\mMC[^0-9A-Za-z]{0,3}([0-9]{4,8})'))[1],
                 (regexp_match(v_ref, '(?i)MC\s*number[^0-9]{0,4}([0-9]{4,8})'))[1], ''), '\D','','g'), '');
      v_dot := nullif(regexp_replace(coalesce((regexp_match(v_ref, '(?i)\m(?:USDOT|DOT)[^0-9A-Za-z]{0,3}([0-9]{5,9})'))[1], ''), '\D','','g'), '');
    end if;
  end if;
  mc := v_mc; dot := v_dot; return next;
end;
$function$;

-- ============================================================================================
-- 1. the primitive
-- ============================================================================================
CREATE OR REPLACE FUNCTION app_private.fmcsa_authority_request(p_org uuid)
 RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'app_private, public'
AS $function$
declare cfg record; d record; v_req bigint;
begin
  select * into cfg from app_private.fmcsa_config where id;
  if not found or not cfg.enabled then return null; end if;

  -- idempotent: something in flight, or checked recently → do nothing
  -- a 'no_docket' row never counts as recent: the moment a number appears we want to try again
  if exists (select 1 from app_private.authority_checks c
              where c.org_id = p_org and (c.request_id is not null
                 or (c.checked_at > now() - interval '20 hours' and c.authority_status is distinct from 'no_docket'))) then
    return null;
  end if;

  select * into d from app_private.org_docket(p_org);
  if coalesce(d.mc, d.dot) is null then
    insert into app_private.authority_checks (org_id, checked_at, authority_status, last_error)
    values (p_org, now(), 'no_docket', 'No MC or USDOT number on file to check against FMCSA.')
    on conflict (org_id) do update
      set checked_at = now(), authority_status = 'no_docket', last_error = excluded.last_error, request_id = null;
    return null;
  end if;

  -- DOT preferred: it identifies the entity, a docket identifies one authority the entity holds
  select net.http_post(
    url := cfg.function_url,
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || cfg.auth_key),
    body := case when d.dot is not null then jsonb_build_object('dot', d.dot) else jsonb_build_object('mc', d.mc) end,
    timeout_milliseconds := 15000) into v_req;

  insert into app_private.authority_checks (org_id, mc_number, dot_number, request_id, requested_at)
  values (p_org, d.mc, d.dot, v_req, now())
  on conflict (org_id) do update
    set mc_number = excluded.mc_number, dot_number = excluded.dot_number,
        request_id = excluded.request_id, requested_at = excluded.requested_at;
  return v_req;
end;
$function$;

-- ============================================================================================
-- 2. dispatch — carriers eligible on docket alone
-- ============================================================================================
CREATE OR REPLACE FUNCTION app_private.fmcsa_authority_dispatch(p_limit integer DEFAULT 40)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'app_private, public'
AS $function$
declare cfg record; r record; v_req bigint; v_sent int := 0; v_skipped int := 0;
begin
  select * into cfg from app_private.fmcsa_config where id;
  if not found or not cfg.enabled then
    return jsonb_build_object('status','not_configured',
      'note','app_private.fmcsa_config is missing or disabled — authority polling is inactive.');
  end if;

  for r in
    select o.id, o.name, o.kind
      from public.organizations o
     where o.kind in ('broker','carrier')
       and not coalesce(o.is_demo, false)
       and coalesce(o.status,'') <> 'archived'
       and ( o.kind = 'carrier'   -- bl_cmp_0324: carriers need no onboarding-item gate
             or exists (select 1 from app_private.org_onboarding_items i
                         where i.org_id = o.id
                           and i.item_key in ('mc_authority','operating_authority')
                           and i.status in ('verified','expired')) )
       and not exists (select 1 from app_private.authority_checks c
                        where c.org_id = o.id
                          and (c.request_id is not null or c.checked_at > now() - interval '20 hours'))
     order by o.created_at
     limit greatest(1, least(coalesce(p_limit,40), 200))
  loop
    v_req := app_private.fmcsa_authority_request(r.id);
    if v_req is null then v_skipped := v_skipped + 1; else v_sent := v_sent + 1; end if;
  end loop;

  return jsonb_build_object('status','ok','sent',v_sent,'no_docket',v_skipped,'ran_at',now());
end;
$function$;

-- ============================================================================================
-- 3. collect — carrier rows + carrier-safe lapse handling
-- ============================================================================================
CREATE OR REPLACE FUNCTION app_private.fmcsa_authority_collect()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'app_private, public'
AS $function$
declare
  r record; resp record; body jsonb; car jsonb;
  v_status text; v_read int := 0; v_lapsed int := 0; v_failed int := 0; v_carriers int := 0;
  v_owner uuid; v_email text; v_orgname text; v_kind text;
begin
  for r in
    select * from app_private.authority_checks
     where request_id is not null and requested_at < now() - interval '20 seconds'
  loop
    select id, status_code, content into resp from net._http_response where id = r.request_id;

    if not found then
      if r.requested_at < now() - interval '30 minutes' then
        update app_private.authority_checks
           set request_id = null, checked_at = now(), authority_status = 'error',
               last_error = 'No response within 30 minutes.', consecutive_fail = consecutive_fail + 1
         where org_id = r.org_id;
        v_failed := v_failed + 1;
      end if;
      continue;
    end if;

    v_read := v_read + 1;
    begin body := resp.content::jsonb; exception when others then body := null; end;

    -- 404 = FMCSA has no record for that number: an answer, not a failure, and never grounds to switch anyone off
    if resp.status_code = 404 then
      update app_private.authority_checks
         set request_id = null, checked_at = now(), authority_status = 'not_found',
             last_error = 'FMCSA has no record for this number — check the docket on file.',
             consecutive_fail = 0, raw = body
       where org_id = r.org_id;
      continue;
    end if;

    if resp.status_code is null or resp.status_code >= 400 or body is null or (body ? 'error') then
      update app_private.authority_checks
         set request_id = null, checked_at = now(), authority_status = 'error',
             last_error = left(coalesce(body->>'error', 'HTTP ' || coalesce(resp.status_code::text,'?')), 300),
             consecutive_fail = consecutive_fail + 1
       where org_id = r.org_id;
      v_failed := v_failed + 1;
      continue;
    end if;

    car := body->'carrier';
    if car is null then
      update app_private.authority_checks
         set request_id = null, checked_at = now(), authority_status = 'error',
             last_error = 'Unexpected response shape from fmcsa-verify.', consecutive_fail = consecutive_fail + 1
       where org_id = r.org_id;
      v_failed := v_failed + 1;
      continue;
    end if;

    -- a docket can be revoked while the entity still reads "allowed to operate": check both
    -- bl_cmp_0324: fmcsa-verify's own verdict (L&I or SAFER, authorityVerified=true) wins; the census
    -- allowedToOperate/mcActive fields stay as the fallback they always were.
    v_status := case
      when (car->>'authorityVerified') = 'true' and car->>'authority' = 'inactive' then 'inactive'
      when (car->>'authorityVerified') = 'true' and car->>'authority' = 'active'   then 'active'
      when upper(coalesce(car->>'allowedToOperate','')) = 'N' then 'inactive'
      when (car ? 'mcActive') and (car->>'mcActive') = 'false' then 'inactive'
      when upper(coalesce(car->>'allowedToOperate','')) = 'Y' then 'active'
      else 'unknown' end;

    update app_private.authority_checks
       set request_id = null, checked_at = now(), authority_status = v_status,
           allowed_to_operate = car->>'allowedToOperate',
           mc_active = nullif(car->>'mcActive','')::boolean,
           entity_type = car->>'entityType', authority_type = car->>'authorityType',
           legal_name = car->>'legalName', safety_rating = car->>'safetyRating',
           out_of_service = coalesce((car->>'outOfService')::boolean, false),
           dot_number = coalesce(dot_number, nullif(car->>'dotNumber','')),
           consecutive_fail = 0, last_error = null, raw = car
     where org_id = r.org_id;

    select o.owner_user_id, o.name, o.kind into v_owner, v_orgname, v_kind from public.organizations o where o.id = r.org_id;

    -- bl_cmp_0324: carriers get a safety snapshot + a pending_review verification row (max one per 20 h)
    -- carrier_safety CHECKs: source in (manual,fmcsa); authority_status in (active,inactive,pending,revoked,unknown);
    -- safety_rating in (satisfactory,conditional,unsatisfactory,none) — v_status only ever takes active|inactive|unknown here.
    if v_kind = 'carrier' then
      insert into app_private.carrier_safety (carrier_id, dot_number, mc_number, authority_status, safety_rating,
                                              power_units, driver_count, out_of_service, source, last_checked, updated_at, fmcsa_snapshot)
      values (r.org_id, coalesce(nullif(car->>'dotNumber',''), r.dot_number),
              coalesce(nullif(regexp_replace(coalesce(car->>'mcNumber',''),'\D','','g'),''), r.mc_number), v_status,
              case when car->>'safetyRating' in ('satisfactory','conditional','unsatisfactory') then car->>'safetyRating' else 'none' end,
              nullif(car->>'powerUnits','')::int, nullif(car->>'drivers','')::int,
              coalesce((car->>'outOfService')::boolean, false), 'fmcsa', now(), now(), car)
      on conflict (carrier_id) do update
        set dot_number = coalesce(excluded.dot_number, app_private.carrier_safety.dot_number),
            mc_number = coalesce(excluded.mc_number, app_private.carrier_safety.mc_number),
            authority_status = excluded.authority_status, safety_rating = excluded.safety_rating,
            power_units = coalesce(excluded.power_units, app_private.carrier_safety.power_units),
            driver_count = coalesce(excluded.driver_count, app_private.carrier_safety.driver_count),
            out_of_service = excluded.out_of_service, source = 'fmcsa',
            last_checked = now(), updated_at = now(), fmcsa_snapshot = excluded.fmcsa_snapshot;

      if not exists (select 1 from app_private.carrier_verifications v
                      where v.carrier_org = r.org_id and v.source = 'auto' and v.verified_at > now() - interval '20 hours') then
        insert into app_private.carrier_verifications (carrier_org, source, dot, mc, legal_name, dba_name, authority,
                                                       safety_rating, power_units, drivers, out_of_service, raw, status, verified_at)
        values (r.org_id, 'auto', coalesce(nullif(car->>'dotNumber',''), r.dot_number), r.mc_number,
                car->>'legalName', car->>'dbaName', v_status, car->>'safetyRating',
                nullif(car->>'powerUnits','')::int, nullif(car->>'drivers','')::int,
                coalesce((car->>'outOfService')::boolean, false), car, 'pending_review', now());
      end if;
      v_carriers := v_carriers + 1;
    end if;

    if v_status = 'inactive' then
      if v_kind = 'carrier' then
        -- carriers: tell staff, change nothing, email nobody (Yaseen contacts carriers himself)
        insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
        values ('staff','in_app','authority.lapsed',
          jsonb_build_object('title','FMCSA: carrier authority not active — ' || coalesce(v_orgname,'carrier'),
            'body', coalesce(car->>'legalName', coalesce(r.mc_number, r.dot_number, 'this docket'))
                    || ' is reported not allowed to operate. Review before dispatching.',
            'tone','urgent','url','/carriers','org_id', r.org_id), 'sent', now());
        v_lapsed := v_lapsed + 1;
      else
        update app_private.org_onboarding_items
           set status = 'expired', lapsed_at = now(),
               note = 'FMCSA reports this authority is not active (checked ' || to_char(now(),'YYYY-MM-DD') || ').'
         where org_id = r.org_id and item_key in ('mc_authority','operating_authority') and status <> 'expired';

        if found then
          v_lapsed := v_lapsed + 1;
          update public.organizations set status = 'pending' where id = r.org_id and status = 'active' and kind <> 'carrier';

          insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
          values ('staff','in_app','authority.lapsed',
            jsonb_build_object('title','FMCSA: authority not active — ' || coalesce(v_orgname,'account'),
              'body', coalesce(car->>'legalName', coalesce(r.mc_number, r.dot_number, 'this docket'))
                      || ' is no longer allowed to operate. Posting paused.',
              'tone','urgent','url','/partner-compliance','org_id', r.org_id), 'sent', now());

          if v_owner is not null then
            insert into app_private.notifications(recipient_user, channel, template_key, payload, status, sent_at)
            values (v_owner,'in_app','authority.lapsed',
              jsonb_build_object('title','Load posting paused — FMCSA authority',
                'body','FMCSA currently reports your operating authority as not active. Posting is paused until this is resolved.',
                'tone','urgent','url','/app/partner/#onboarding'), 'sent', now());

            select email into v_email from public.profiles where id = v_owner;
            if v_email is not null then
              perform app_private.sys_email(v_email,'authority_lapsed',
                'Load posting paused — FMCSA shows your authority as not active',
                '<h2 style="margin:0 0 10px">FMCSA shows your authority as not active</h2>'
                || '<p style="margin:6px 0;font-size:15px">We check operating authority against FMCSA every day. Today''s check for '
                || coalesce(r.mc_number, r.dot_number, 'your docket') || ' came back <b>not allowed to operate</b>.</p>'
                || '<p style="margin:6px 0;color:#475569;font-size:14px">New load posting is paused. Everything already booked keeps running — trips, tracking, invoices and payments are untouched.</p>'
                || '<p style="margin:6px 0;color:#475569;font-size:14px">If this is wrong, it is usually a lapsed bond filing or a recent reinstatement FMCSA has not published yet. Send us the current record and we will restore posting the same day.</p>'
                || '<p style="margin:16px 0"><a href="https://loadboot.com/app/partner/#onboarding" style="background:#0883F7;color:#fff;padding:12px 18px;border-radius:10px;text-decoration:none;font-weight:700">Open your packet</a></p>',
                null, 'authlapse:' || r.org_id::text || ':' || to_char(now(),'YYYY-MM-DD'));
            end if;
          end if;
        end if;
      end if;
    end if;
  end loop;

  insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
  select 'staff','in_app','authority.check_failing',
         jsonb_build_object('title','FMCSA authority checks are failing',
           'body', count(*) || ' account(s) have failed 3+ checks in a row. Nothing has been paused — check fmcsa-verify and its FMCSA_WEBKEY secret.',
           'tone','action','url','/partner-compliance'), 'sent', now()
    from app_private.authority_checks where consecutive_fail >= 3
   having count(*) > 0
      and not exists (select 1 from app_private.notifications n
                       where n.template_key = 'authority.check_failing' and n.created_at > now() - interval '24 hours');

  return jsonb_build_object('read',v_read,'lapsed',v_lapsed,'failed',v_failed,'carriers',v_carriers,'ran_at',now());
end;
$function$;

-- ============================================================================================
-- 4. the signup trigger — same name, same signature; body replaced
-- ============================================================================================
CREATE OR REPLACE FUNCTION app_private.trg_auto_fmcsa_at_signup()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'app_private, public'
AS $function$
declare v_dot text; v_org uuid; v_req bigint;
begin
  v_dot := coalesce(nullif(btrim(new.dot),''), nullif(btrim(new.mc),''));
  if v_dot is null then return new; end if;
  if tg_op='UPDATE' and coalesce(old.dot,'') = coalesce(new.dot,'') and coalesce(old.mc,'') = coalesce(new.mc,'') then return new; end if;
  begin
    -- the user's carrier org (owner or active member); the check is per ORG, not per profile
    select om.org_id into v_org
      from public.organization_memberships om join public.organizations o on o.id = om.org_id
     where om.user_id = new.id and om.status = 'active' and o.kind = 'carrier'
     order by om.created_at limit 1;
    if v_org is null then
      select o.id into v_org from public.organizations o where o.owner_user_id = new.id and o.kind = 'carrier' order by o.created_at limit 1;
    end if;
    if v_org is null then
      perform app_private.log_audit('compliance.fmcsa.skipped','profile', new.id::text, null,
        'FMCSA check not queued: no carrier org for this profile yet', jsonb_build_object('dot', v_dot));
      return new;
    end if;
    -- make sure the docket is on the org so org_docket() finds it (only fills blanks)
    update public.organizations set
      dot_number = coalesce(nullif(dot_number,''), nullif(btrim(new.dot),'')),
      mc_number  = coalesce(nullif(mc_number,''),  nullif(btrim(new.mc),''))
     where id = v_org;
    v_req := app_private.fmcsa_authority_request(v_org);
    perform app_private.log_audit('compliance.fmcsa.requested','organization', v_org::text, v_org,
      case when v_req is null then 'FMCSA check already pending/recent — not re-queued' else 'FMCSA check queued (request ' || v_req || ')' end,
      jsonb_build_object('dot', v_dot, 'request_id', v_req, 'profile', new.id));
  exception when others then raise warning 'auto fmcsa failed: %', sqlerrm; end;
  return new;
end $function$;

-- ============================================================================================
-- 5. backfill helper (run by hand, ≤40 per call, once a minute)
-- ============================================================================================
CREATE OR REPLACE FUNCTION app_private.fmcsa_carrier_backfill(p_limit integer DEFAULT 40)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'app_private, public'
AS $function$
declare r record; v_req bigint; v_sent int := 0; v_nodocket int := 0;
begin
  for r in
    select o.id from public.organizations o
     where o.kind = 'carrier' and not coalesce(o.is_demo,false) and coalesce(o.status,'') <> 'archived'
       and not exists (select 1 from app_private.authority_checks c where c.org_id = o.id and c.authority_status is distinct from 'no_docket')
     order by o.created_at limit greatest(1, least(coalesce(p_limit,40), 60))
  loop
    v_req := app_private.fmcsa_authority_request(r.id);
    if v_req is null then v_nodocket := v_nodocket + 1; else v_sent := v_sent + 1; end if;
  end loop;
  return jsonb_build_object('sent', v_sent, 'no_docket_or_skipped', v_nodocket,
    'remaining', (select count(*) from public.organizations o where o.kind='carrier' and not coalesce(o.is_demo,false)
                   and coalesce(o.status,'')<>'archived' and not exists (select 1 from app_private.authority_checks c where c.org_id=o.id and c.authority_status is distinct from 'no_docket')));
end;
$function$;

-- ============================================================================================
-- cron (prod already has both → no-op)
-- ============================================================================================
do $c$
begin
  if not exists (select 1 from cron.job where jobname = 'lb-fmcsa-authority-dispatch') then
    perform cron.schedule('lb-fmcsa-authority-dispatch', '10 6 * * *', 'select app_private.fmcsa_authority_dispatch(40);');
  end if;
  if not exists (select 1 from cron.job where jobname = 'lb-fmcsa-authority-collect') then
    perform cron.schedule('lb-fmcsa-authority-collect', '*/5 * * * *', 'select app_private.fmcsa_authority_collect();');
  end if;
end $c$;

-- ============================================================================================
-- grants: all app_private, internal-only (cron + trigger run as owner). No public exposure.
-- ============================================================================================
revoke all on function app_private.fmcsa_authority_request(uuid) from public, anon, authenticated;
revoke all on function app_private.fmcsa_carrier_backfill(integer) from public, anon, authenticated;
revoke all on function app_private.fmcsa_authority_dispatch(integer) from public, anon, authenticated;
revoke all on function app_private.fmcsa_authority_collect() from public, anon, authenticated;

-- ============================================================================================
-- rollback helper
-- ============================================================================================
CREATE OR REPLACE FUNCTION app_private.bl_cmp_0324_rollback() RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $r$
begin
  -- restore the pre-0324 trigger body (the no-op one) so behaviour is exactly as before
  execute $t$
  CREATE OR REPLACE FUNCTION app_private.trg_auto_fmcsa_at_signup() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'app_private, public' AS $f$
  declare v_dot text;
  begin
    v_dot := coalesce(nullif(btrim(new.dot),''), nullif(btrim(new.mc),''));
    if v_dot is null then return new; end if;
    if tg_op='UPDATE' and coalesce(old.dot,'') = coalesce(new.dot,'') and coalesce(old.mc,'') = coalesce(new.mc,'') then return new; end if;
    begin
      perform app_private.log_audit('compliance.fmcsa.auto','profile', new.id::text, null, 'FMCSA lookup auto-queued at signup (disabled by bl_cmp_0324 rollback)', jsonb_build_object('dot', v_dot));
    exception when others then raise warning 'auto fmcsa failed: %', sqlerrm; end;
    return new;
  end $f$;$t$;
  drop function if exists app_private.fmcsa_carrier_backfill(integer);
  return 'bl_cmp_0324 rolled back: trigger body restored (no-op), backfill helper dropped. dispatch/collect keep superset bodies; fmcsa_authority_request kept (used by dispatch).';
end $r$;
