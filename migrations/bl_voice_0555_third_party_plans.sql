-- bl_voice_0555 — Riley "call someone else": third-party call plans (CC staff only)            15 Oct 2026
--
-- Spec + review: claude/NEXT-SESSION-0539.md §P. Doc: claude/RILEY-THIRD-PARTY-0555.md.
--
-- A Riley call plan can now target
--   • the carrier (unchanged — target_kind 'carrier'), or
--   • someone else FOR a carrier (target_kind 'third_party': factoring / insurance / broker / shipper / other), or
--   • someone else with NO carrier ("Custom call" from Riley → Call plans; purpose note required).
--
-- Third-party rules (all enforced here, in Postgres):
--   - staff create and book it by hand; never auto-booked, never an automatic follow-up / carrier email
--   - the brain gets a REDACTED file (riley_third_party_context): carrier name, MC/DOT, dispatcher name, the
--     documents the note names (status only, no amounts) and "confirm X" items as yes/no questions — never bank /
--     account numbers, TIN, insurance amounts, phone, email or address
--   - opener "Hi, this is Riley, an AI assistant calling on behalf of LoadBoot" + "this call is recorded"
--     (brain prompt + Retell prompt section `third_party`, which the owner publishes — the gate blocks booking
--     until the published Outbound prompt knows "third_party")
--   - window Mon–Fri 09:00–17:00 in the TARGET's time zone (last start 16:45)
--   - one call per target number per day, 3 per 7 days; Riley do-not-call + SMS STOP block as for carriers
--   - outcome.confirmed (short "what they confirmed" line) on the plan, shown on the carrier's CC page
--
-- No new anon-executable SECURITY DEFINER function: the two public functions below are revoked from public, anon.

begin;

-- ─────────────────────────────────────────────────────────────── 0. anchor-patch helper (session only)
create or replace function pg_temp.lb_patch(p_fn regprocedure, p_old text, p_new text, p_tag text, p_all boolean default false)
returns void language plpgsql as $$
declare d text; n int;
begin
  d := pg_get_functiondef(p_fn);
  if position(p_tag in d) > 0 then return; end if;                       -- already patched
  n := (length(d) - length(replace(d, p_old, ''))) / greatest(length(p_old), 1);
  if n = 0 then raise exception 'bl_voice_0555: anchor not found in %: %', p_fn, left(p_old, 90); end if;
  if n > 1 and not p_all then raise exception 'bl_voice_0555: anchor not unique in % (% hits): %', p_fn, n, left(p_old, 90); end if;
  execute replace(d, p_old, p_new);
end $$;

-- ─────────────────────────────────────────────────────────────── 1. columns + checks
alter table app_private.riley_call_plans
  add column if not exists target_kind text not null default 'carrier',
  add column if not exists target_name text,
  add column if not exists target_org  text,
  add column if not exists target_role text,
  add column if not exists target_tz   text;
alter table app_private.riley_call_plans alter column org_id drop not null;

alter table app_private.riley_call_plans drop constraint if exists riley_call_plans_target_kind_check;
alter table app_private.riley_call_plans add constraint riley_call_plans_target_kind_check
  check (target_kind in ('carrier', 'third_party'));
alter table app_private.riley_call_plans drop constraint if exists riley_call_plans_target_role_check;
alter table app_private.riley_call_plans add constraint riley_call_plans_target_role_check
  check (target_role is null or target_role in ('factoring', 'insurance', 'broker', 'shipper', 'other'));
alter table app_private.riley_call_plans drop constraint if exists riley_call_plans_target_check;
alter table app_private.riley_call_plans add constraint riley_call_plans_target_check check (
  (target_kind = 'carrier' and org_id is not null)
  or (target_kind = 'third_party' and nullif(btrim(coalesce(target_name, '')), '') is not null and target_role is not null
      and target_tz is not null and to_number is not null
      and (org_id is not null or nullif(btrim(coalesce(note, '')), '') is not null)));

-- ─────────────────────────────────────────────────────────────── 2. area code → time zone (a DEFAULT; staff edit it)
-- Split-zone area codes take the zone of most of their numbers. Unknown → null (staff must pick).
create or replace function app_private.npa_tz(p_number text)
returns text language sql immutable set search_path = pg_catalog as $$
  with d as (select right(regexp_replace(coalesce(p_number, ''), '[^0-9]', '', 'g'), 10) n),
       a as (select left(n, 3) npa from d where length(n) = 10)
  select case
    when npa = any (array[
      '203','475','860','959','302','202','771',
      '239','305','321','324','352','386','407','448','561','645','656','689','727','728','754','772','786','813','850','863','904','941','954',
      '229','404','470','478','678','706','762','770','912','943',
      '260','317','463','574','765','812','930',
      '502','606','859','207','227','240','301','410','443','667',
      '339','351','413','508','617','774','781','857','978',
      '231','248','269','313','517','586','616','679','734','810','906','947','989','603',
      '201','551','609','640','732','848','856','862','908','973',
      '212','315','329','332','347','363','516','518','585','607','624','631','646','680','716','718','838','845','914','917','929','934',
      '252','336','472','704','743','828','910','919','980','984',
      '216','220','234','283','326','330','380','419','436','440','513','567','614','740','937',
      '215','223','267','272','412','445','484','570','582','610','717','724','814','835','878','401',
      '803','821','839','843','854','864','423','865','802',
      '276','434','540','571','686','703','757','804','826','948','304','681']) then 'America/New_York'
    when npa = any (array[
      '205','251','256','334','659','938','327','479','501','870',
      '217','224','309','312','331','447','464','618','630','708','730','773','779','815','847','861','872',
      '219','270','364','319','515','563','641','712','316','620','785','913',
      '225','318','337','457','504','985','218','320','507','612','651','763','924','952','228','601','662','769',
      '235','314','417','557','573','636','660','816','975','308','402','531','701','605',
      '405','539','572','580','918','615','629','731','901','931',
      '210','214','254','281','325','346','361','409','430','432','469','512','682','713','726','737','806','817','830','832',
      '903','936','940','945','956','972','979','262','274','353','414','534','608','715','920']) then 'America/Chicago'
    when npa = any (array['303','719','720','970','983','406','505','575','385','435','801','307','208','986','915']) then 'America/Denver'
    when npa = any (array['480','520','602','623','928']) then 'America/Phoenix'
    when npa = any (array[
      '209','213','279','310','323','341','350','369','408','415','424','442','510','530','559','562','619','626','628','650','657',
      '661','669','707','714','747','760','805','818','820','831','837','840','858','909','916','925','949','951',
      '702','725','775','458','503','541','971','206','253','360','425','509','564']) then 'America/Los_Angeles'
    when npa = '907' then 'America/Anchorage'
    when npa = '808' then 'Pacific/Honolulu'
    when npa in ('787', '939') then 'America/Puerto_Rico'
  end from a;
$$;
revoke all on function app_private.npa_tz(text) from public;

-- ─────────────────────────────────────────────────────────────── 3. time zone + calling window of a PLAN
create or replace function app_private.riley_plan_tz_of(p app_private.riley_call_plans)
returns text language sql stable security definer set search_path to 'app_private', 'public' as $$
  select case when p.target_kind = 'third_party' then p.target_tz else app_private.riley_plan_tz(p.org_id) end;
$$;
revoke all on function app_private.riley_plan_tz_of(app_private.riley_call_plans) from public;

-- carrier → riley_call_window (Mon–Fri 09:00–18:30 local); third party → Mon–Fri 09:00–17:00 in THEIR zone
-- (last start 16:45 so a 4-minute call ends inside business hours)
create or replace function app_private.riley_plan_window(p app_private.riley_call_plans, p_from timestamptz)
returns timestamptz language plpgsql stable security definer set search_path to 'app_private', 'public' as $$
declare tz text; s time := time '09:00'; e time := time '16:45'; loc timestamp; d date; i int;
begin
  if p.target_kind is distinct from 'third_party' then
    return app_private.riley_call_window(app_private.riley_plan_tz(p.org_id), p_from);
  end if;
  tz := coalesce(p.target_tz, 'America/New_York');
  loc := coalesce(p_from, now()) at time zone tz; d := loc::date;
  for i in 0..10 loop
    if extract(isodow from d) between 1 and 5 then
      if i = 0 and loc::time >= s and loc::time <= e then return coalesce(p_from, now()); end if;
      if i > 0 or loc::time < s then return (d + s) at time zone tz; end if;
    end if;
    d := d + 1;
  end loop;
  return null;
end $$;
revoke all on function app_private.riley_plan_window(app_private.riley_call_plans, timestamptz) from public;

-- ─────────────────────────────────────────────────────────────── 4. the REDACTED brain file for a third-party call
create or replace function app_private.riley_third_party_context(p_plan bigint)
returns jsonb language plpgsql stable security definer set search_path to 'app_private', 'public' as $$
declare v_p app_private.riley_call_plans; v_org public.organizations; v_prof public.profiles; v_note text;
        v_disp text; v_snap jsonb; v_docs jsonb := '[]'::jsonb; v_conf jsonb := '[]'::jsonb;
begin
  select * into v_p from app_private.riley_call_plans where id = p_plan;
  if v_p.id is null or v_p.target_kind <> 'third_party' then return null; end if;
  v_note := coalesce(v_p.note, '');

  if v_p.org_id is not null then
    select * into v_org from public.organizations where id = v_p.org_id;
    if v_org.id is null or coalesce(v_org.is_demo, false) then return null; end if;   -- demo accounts are invisible (CLAUDE.md §4)
    select * into v_prof from public.profiles where id = v_org.owner_user_id;
    select dp.full_name into v_disp
      from app_private.dispatcher_assignments a left join app_private.dispatcher_profiles dp on dp.user_id = a.dispatcher_user_id
     where a.carrier_org_id = v_org.id and a.status = 'active' order by a.assigned_at desc limit 1;
    -- only the documents the note names; status only — names lose any "(… $1M)" amount
    v_snap := app_private.lc_account_snapshot(v_org.owner_user_id);
    select coalesce(jsonb_agg(jsonb_build_object('document', btrim(regexp_replace(x ->> 'name', '\s*\([^)]*\)', '', 'g')), 'status', x ->> 'status')), '[]'::jsonb)
      into v_docs
      from jsonb_array_elements(case when jsonb_typeof(v_snap -> 'compliance') = 'array' then v_snap -> 'compliance' else '[]'::jsonb end) x
     where v_note ~* case x ->> 'key'
             when 'insurance_coi'      then 'insur|\mcoi\M|certificate|policy|coverage'
             when 'mc_authority'       then 'authority|\mmc\M|\mdot\M|operating'
             when 'w9'                 then 'w-?9|tax form'
             when 'dispatch_agreement' then 'agreement|contract'
             else '\m' || regexp_replace(lower(coalesce(nullif(x ->> 'key', ''), 'zzzz')), '[^a-z0-9]+', '\\M|\\m', 'g') || '\M' end;
  end if;

  -- "confirm X" in the note → a yes/no item; the value itself is never read out
  select coalesce(jsonb_agg(jsonb_build_object('item', btrim(m[1]), 'answer', 'yes / no only')), '[]'::jsonb)
    into v_conf
    from regexp_matches(v_note, 'confirm(?:\s+(?:that|whether|if))?\s+([^.;?!\n]{3,200})', 'gi') m;

  return jsonb_strip_nulls(jsonb_build_object(
    'plan_id',     v_p.id,
    'reason',      v_p.reason,
    'staff_note',  v_p.note,
    'lang',        v_p.lang,
    'target_kind', 'third_party',
    'person_called', jsonb_build_object('name', v_p.target_name, 'organisation', v_p.target_org, 'role', v_p.target_role, 'time_zone', v_p.target_tz),
    'about_carrier', case when v_org.id is null then null else jsonb_build_object(
        'name', v_org.name, 'mc', coalesce(v_org.mc_number, v_prof.mc), 'dot', coalesce(v_org.dot_number, v_prof.dot), 'dispatcher', v_disp,
        'factoring_company', case when v_note ~* 'factor|\mnoa\M|notice of assignment' then nullif(btrim(coalesce(v_prof.factoring_company, '')), '') end) end,
    'documents_named_in_note', case when jsonb_array_length(v_docs) > 0 then v_docs end,
    'confirm',     case when jsonb_array_length(v_conf) > 0 then v_conf end,
    'redaction',   'Third-party call: bank / account numbers, TIN / EIN / SSN, insurance amounts and limits, phone numbers, emails and addresses are deliberately not in this file. Riley never asks for or reads them out.'));
end $$;
revoke all on function app_private.riley_third_party_context(bigint) from public;

-- riley_plan_context (used by plan create, redo, follow-up) hands the redacted file for a third-party plan
select pg_temp.lb_patch('app_private.riley_plan_context(bigint)',
  $o$  if v_p.id is null then return null; end if;
$o$,
  $n$  if v_p.id is null then return null; end if;
  if v_p.target_kind = 'third_party' then return app_private.riley_third_party_context(p_plan); end if;   -- bl_voice_0555a
$n$, 'bl_voice_0555a');

-- ─────────────────────────────────────────────────────────────── 5. riley_plan_create — riley_plan_new + optional target params
-- No DROP anywhere in this migration: the old 7-argument riley_plan_new keeps its signature and delegates here, so
-- every existing caller (cc_riley_followup_act, riley_followup_auto) works unchanged; a follow-up of a third-party
-- plan inherits the parent's target.
create or replace function app_private.riley_plan_create(p_org uuid, p_reason text, p_note text, p_lang text, p_actor uuid,
  p_parent bigint default null, p_auto_book boolean default false,
  p_target_kind text default null, p_to_number text default null, p_target_name text default null,
  p_target_org text default null, p_target_role text default null, p_target_tz text default null)
returns jsonb language plpgsql security definer set search_path to 'app_private', 'public', 'extensions' as $$
declare v_org public.organizations; v_prof public.profiles; v_p app_private.riley_call_plans; v_par app_private.riley_call_plans;
        v_num text; v_digits text; v_consent jsonb; v_open bigint; v_ctx jsonb; v_q jsonb; v_sms app_private.sms_consent;
        v_kind text; v_name text; v_torg text; v_role text; v_tz text;
        v_note text := nullif(left(btrim(coalesce(p_note, '')), 1500), '');
begin
  if p_reason is null or p_reason not in ('welcome','onboarding_gap','document_missing','choice_pending','no_reply','custom','follow_up') then
    raise exception 'unknown reason' using errcode = '22023';
  end if;
  if p_parent is not null then
    select * into v_par from app_private.riley_call_plans where id = p_parent;
    if v_par.id is null or v_par.org_id is distinct from p_org then return jsonb_build_object('error', 'follow-up parent not found for this carrier'); end if;
    if v_par.attempt >= 3 then return jsonb_build_object('error', 'Three attempts on one topic is the limit — send an email or hand it to a person.'); end if;
  end if;
  v_kind := coalesce(nullif(p_target_kind, ''), v_par.target_kind, 'carrier');
  if v_kind not in ('carrier', 'third_party') then raise exception 'unknown target' using errcode = '22023'; end if;
  if v_par.id is not null and v_par.target_kind <> v_kind then
    return jsonb_build_object('error', 'A follow-up calls the same person as the first call.');
  end if;

  if p_org is not null then
    select * into v_org from public.organizations where id = p_org;
    if v_org.id is null then raise exception 'carrier not found' using errcode = 'P0002'; end if;
    if v_org.kind <> 'carrier' then return jsonb_build_object('error', 'Call plans are for carriers only (owner rule: no calls to dispatchers — plan §14.2).'); end if;
    if coalesce(v_org.is_demo, false) then return jsonb_build_object('error', 'Demo / store-review accounts are never called.'); end if;
    select * into v_prof from public.profiles where id = v_org.owner_user_id;
  elsif v_kind <> 'third_party' then
    return jsonb_build_object('error', 'Pick a carrier — only a call to someone else can be planned without one.');
  end if;

  if v_kind = 'carrier' then
    v_digits := regexp_replace(coalesce(v_prof.phone, ''), '[^0-9]', '', 'g');
    if length(v_digits) = 11 and left(v_digits, 1) = '1' then v_digits := right(v_digits, 10); end if;
    if length(v_digits) <> 10 then
      return jsonb_build_object('error', 'No usable US phone number on this carrier''s profile — nothing to plan a call to.');
    end if;
    v_num := '+1' || v_digits;
  else
    -- bl_voice_0555: someone else (for this carrier, or a custom call with no carrier)
    v_name := left(btrim(coalesce(nullif(btrim(p_target_name), ''), v_par.target_name, '')), 120);
    v_torg := nullif(left(btrim(coalesce(nullif(btrim(p_target_org), ''), v_par.target_org, '')), 160), '');
    v_role := lower(coalesce(nullif(btrim(p_target_role), ''), v_par.target_role, ''));
    v_digits := regexp_replace(coalesce(nullif(p_to_number, ''), v_par.to_number, ''), '[^0-9]', '', 'g');
    if length(v_digits) = 11 and left(v_digits, 1) = '1' then v_digits := right(v_digits, 10); end if;
    if v_name = '' then return jsonb_build_object('error', 'Who is Riley calling? Add the person''s name.'); end if;
    if v_role not in ('factoring', 'insurance', 'broker', 'shipper', 'other') then
      return jsonb_build_object('error', 'Pick their role: factoring, insurance, broker, shipper or other.');
    end if;
    if v_digits !~ '^[2-9][0-9]{2}[2-9][0-9]{6}$' then
      return jsonb_build_object('error', 'That is not a valid US number — 10 digits after +1, area code and exchange starting 2–9.');
    end if;
    v_num := '+1' || v_digits;
    if v_prof.id is not null and right(regexp_replace(coalesce(v_prof.phone, ''), '[^0-9]', '', 'g'), 10) = v_digits then
      return jsonb_build_object('error', 'That is the carrier''s own number — choose "The carrier" instead.');
    end if;
    v_tz := coalesce(nullif(btrim(p_target_tz), ''), v_par.target_tz, app_private.npa_tz(v_num));
    if v_tz is null then return jsonb_build_object('error', 'Pick their time zone — the area code does not tell us.'); end if;
    if v_tz <> all (array['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles',
                          'America/Anchorage', 'Pacific/Honolulu', 'America/Puerto_Rico']) then
      return jsonb_build_object('error', 'Time zone must be a US zone (Eastern, Central, Mountain, Arizona, Pacific, Alaska, Hawaii, Puerto Rico).');
    end if;
    v_note := coalesce(v_note, v_par.note);   -- a follow-up keeps the first call's purpose
    if v_note is null then
      return jsonb_build_object('error', 'Write what Riley must find out — a call to someone else needs a purpose note.');
    end if;
  end if;

  if p_parent is null then
    select id into v_open from app_private.riley_call_plans
     where org_id is not distinct from p_org and target_kind = v_kind and (v_kind = 'carrier' or to_number = v_num)
       and status = 'planning' and created_at > now() - interval '5 minutes' order by id desc limit 1;
    if v_open is not null then
      select * into v_p from app_private.riley_call_plans where id = v_open;
      return app_private.riley_plan_json(v_p) || jsonb_build_object('reused', true);
    end if;
  end if;

  if v_kind = 'carrier' then
    select * into v_sms from app_private.sms_consent s where s.revoked_at is null
       and right(regexp_replace(s.number, '[^0-9]', '', 'g'), 10) = v_digits limit 1;
    v_consent := jsonb_build_object(
      'ok',     true,
      'basis',  'existing account — number given at signup; service call about their own account',
      'method', coalesce(v_sms.method, 'signup_phone'),
      'at',     coalesce(v_sms.consented_at, v_prof.created_at),
      'sms_consent', v_sms.number is not null);
  else
    v_consent := jsonb_build_object(
      'ok',     true,
      'basis',  'business contact named by staff (B2B, service call about a shared customer)',
      'method', 'staff_named',
      'by',     p_actor,
      'at',     now(),
      'sms_consent', false);
  end if;

  insert into app_private.riley_call_plans (org_id, contact_name, to_number, contact_role, consent, reason, note, lang, created_by, parent_id, attempt, auto_book,
                                            target_kind, target_name, target_org, target_role, target_tz)
  values (v_org.id,
          case when v_kind = 'carrier' then coalesce(nullif(v_prof.contact_name, ''), nullif(v_prof.legal_owner_name, '')) else v_name end,
          v_num, case when v_kind = 'carrier' then 'carrier' else v_role end, v_consent, p_reason,
          v_note, case when p_lang = 'es' then 'es' else 'en' end, p_actor,
          p_parent, coalesce(v_par.attempt, 0) + 1,
          case when v_kind = 'carrier' then coalesce(p_auto_book, false) else false end,   -- third party: a person always books
          v_kind, case when v_kind = 'third_party' then v_name end, v_torg, case when v_kind = 'third_party' then v_role end, v_tz)
  returning * into v_p;

  v_ctx := app_private.riley_plan_context(v_p.id);
  if v_kind = 'carrier' then
    v_q := app_private.brain_enqueue('voice', v_p.id::text, 'voice_plan',
             'Write the call plan for ' || coalesce(v_org.name, 'this carrier') || ' (reason: ' || p_reason || case when p_parent is not null then ', attempt ' || v_p.attempt || ' of 3' else '' end || ').',
             v_ctx, null, array['get_facts', 'kb_search', 'account_lookup'], v_p.lang);
  else
    -- no account_lookup: the redacted file is all the brain may see about the carrier
    v_q := app_private.brain_enqueue('voice', v_p.id::text, 'voice_plan',
             'Write the call plan for a THIRD-PARTY call to ' || v_name || coalesce(' at ' || v_torg, '') || ' (' || v_role || ')'
               || coalesce(' about the carrier ' || v_org.name, ' (custom call, no carrier)') || case when p_parent is not null then ', attempt ' || v_p.attempt || ' of 3' else '' end || '.',
             v_ctx, null, array['get_facts', 'kb_search'], v_p.lang);
  end if;

  update app_private.riley_call_plans
     set job_id = (v_q ->> 'job_id')::bigint,
         status = case when v_q ->> 'status' = 'queued' then 'planning' else 'failed' end,
         error  = case when v_q ->> 'status' = 'queued' then null else coalesce(v_q ->> 'error', 'brain refused the job') end,
         updated_at = now()
   where id = v_p.id
   returning * into v_p;
  return app_private.riley_plan_json(v_p);
end $$;
revoke all on function app_private.riley_plan_create(uuid, text, text, text, uuid, bigint, boolean, text, text, text, text, text, text) from public, anon, authenticated;

create or replace function app_private.riley_plan_new(p_org uuid, p_reason text, p_note text, p_lang text, p_actor uuid,
  p_parent bigint default null, p_auto_book boolean default false)
returns jsonb language sql security definer set search_path to 'app_private', 'public', 'extensions' as $$
  select app_private.riley_plan_create(p_org, p_reason, p_note, p_lang, p_actor, p_parent, p_auto_book);   -- bl_voice_0555
$$;

-- ─────────────────────────────────────────────────────────────── 6. brain briefing — third-party branch
select pg_temp.lb_patch('app_private.brain_user_text(text, text, text, jsonb)',
  $o$  when p_route = 'voice_plan' then
$o$,
  $n$  when p_route = 'voice_plan' and p_context ->> 'target_kind' = 'third_party' then   -- bl_voice_0555b
       'You are the LoadBoot Ops Brain writing a CALL PLAN for Riley, LoadBoot''s AI phone assistant. This is a THIRD-PARTY call: '
    || 'Riley is NOT calling the carrier. She calls the person in "person_called" (a factoring company, insurer, broker, shipper or other business) '
    || 'on behalf of LoadBoot, about the carrier in "about_carrier" (or, with no carrier, about the matter in the staff note). Address Riley directly ("Call X and …"). '
    || 'The OPENER must begin exactly: "Hi, this is Riley, an AI assistant calling on behalf of LoadBoot." and must say "this call is recorded" within its first two sentences. '
    || 'Riley asks ONLY what the staff note needs. PRIVACY (hard rules): never say or ask for bank or account numbers, routing numbers, TIN / EIN / SSN, insurance amounts or limits, '
    || 'personal details, phone numbers, emails or addresses. For every item under "confirm" Riley asks a yes / no question and records the answer — she never reads a value out '
    || 'and never asks them to read one out. Anything beyond the note: a LoadBoot team member will follow up. If they will not discuss the carrier without written authorisation, '
    || 'Riley thanks them and ends the call. No sales, no marketing, no offers — if the staff note is a sales or marketing call, set confidence to 0.2 and say so in escalate_reason. '
    || 'Keep everything under 200 words.' || E'\n\n'
    || 'STAFF NOTE (the purpose of this call): ' || coalesce(nullif(p_context ->> 'staff_note', ''), 'none') || E'\n'
    || 'CALL LANGUAGE: ' || case when coalesce(p_context ->> 'lang', 'en') = 'es' then 'Spanish' else 'English' end || E'\n\n'
    || 'CALL FILE (json — redacted on purpose; the only source of truth):' || E'\n'
    || left(jsonb_pretty(coalesce(p_context - 'user_id' - 'plan_id' - 'reason' - 'staff_note' - 'lang', '{}'::jsonb)), 6000) || E'\n\n'
    || 'Put the plan in "reply" as plain text with EXACTLY these seven headers, each on its own line, in this order, nothing before the first:' || E'\n'
    || 'GOAL: one sentence — what Riley must find out or confirm.' || E'\n'
    || 'OPENER: the first two sentences — "Hi, this is Riley, an AI assistant calling on behalf of LoadBoot." plus "this call is recorded"; ask for the person by name and say which carrier (name and MC) it is about.' || E'\n'
    || 'TALKING POINTS: up to five numbered lines, each one question or point from the staff note, most important first.' || E'\n'
    || 'CONFIRM: numbered yes / no questions, one per "confirm" item ("none" when there are none).' || E'\n'
    || 'DO NOT SAY: numbered lines — always include: no bank / account numbers, no TIN, no insurance amounts, no promises about payment or dates, no sales talk.' || E'\n'
    || 'BEST TIME: their business hours, Mon–Fri 9:00–17:00 in their time zone (' || coalesce(p_context #>> '{person_called,time_zone}', 'unknown') || ').' || E'\n'
    || 'LANGUAGE: English or Spanish, and the register (polite, businesslike, short).' || E'\n\n'
    || 'Set "confidence" to how well the note and file support this plan (below 0.6 when the purpose is unclear, and say why in escalate_reason). '
    || 'Respond with the single JSON object described in your rules.'
  when p_route = 'voice_plan' then
$n$, 'bl_voice_0555b');

-- ─────────────────────────────────────────────────────────────── 7. dial gate — third-party branches
create or replace function app_private.riley_dial_gate(p app_private.riley_call_plans, p_auto boolean default false, p_slot timestamptz default null)
returns jsonb language plpgsql stable security definer set search_path to 'app_private', 'public' as $$
declare t app_private.brain_permissions; o public.organizations; cfg app_private.retell_config; pr app_private.riley_prompts;
        v10 text; n int; v_slot timestamptz := coalesce(p_slot, now()); v_dnc app_private.voice_dnc; v_last timestamptz;
        v_tp boolean := p.target_kind = 'third_party';   -- bl_voice_0555
        v_src text := case when p.target_kind = 'third_party' then 'third_party' else 'account' end;
begin
  select * into t from app_private.brain_permissions where key = 'tool.schedule_riley_call';
  if t.key is null or not t.enabled or t.status <> 'live' or t.mode = 'deny' then
    return jsonb_build_object('ok', false, 'code', 'tool_off', 'reason',
      'Riley booking is off: tool.schedule_riley_call is ' || case when t.key is null then 'missing' when t.status <> 'live' then t.status
        when t.mode = 'deny' then 'set to deny' else 'switched off' end || ' (CC → AI Brain → Permissions).');
  end if;
  if p_auto and t.mode <> 'auto' then
    return jsonb_build_object('ok', false, 'code', 'auto_off', 'reason', 'Automatic booking needs tool.schedule_riley_call in auto mode (it is in ' || t.mode || ' mode, so a person books).');
  end if;
  if p_auto and v_tp then
    return jsonb_build_object('ok', false, 'code', 'auto_third_party', 'reason', 'A call to someone other than the carrier is always booked by a person.');
  end if;
  if not coalesce((select c.enabled from app_private.brain_config c where c.id), false) then
    return jsonb_build_object('ok', false, 'code', 'brain_off', 'reason', 'The AI Brain master switch is off.');
  end if;
  if p.org_id is not null or not v_tp then
    select * into o from public.organizations where id = p.org_id;
    if o.id is null or o.kind <> 'carrier' or coalesce(o.is_demo, false) then
      return jsonb_build_object('ok', false, 'code', 'not_carrier', 'reason', 'Only real carrier accounts are called (or called about) — never demo / store-review accounts, never dispatchers.');
    end if;
  end if;
  if coalesce((p.consent ->> 'ok')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'code', 'no_consent', 'reason', 'No consent basis is recorded for this number.');
  end if;
  if coalesce(p.to_number, '') !~ '^\+1[2-9][0-9]{9}$' then
    return jsonb_build_object('ok', false, 'code', 'bad_number', 'reason', 'The number on the plan is not a valid US number.');
  end if;
  v10 := right(p.to_number, 10);
  select * into v_dnc from app_private.voice_dnc where last10 = v10;
  if v_dnc.last10 is not null then
    return jsonb_build_object('ok', false, 'code', 'dnc', 'reason', 'On the Riley do-not-call list since ' || to_char(v_dnc.created_at at time zone 'America/New_York', 'Mon DD') || ': ' || v_dnc.reason);
  end if;
  if (select max(s.revoked_at) from app_private.sms_consent s where right(regexp_replace(s.number, '[^0-9]', '', 'g'), 10) = v10)
     > coalesce((select max(s.consented_at) from app_private.sms_consent s where right(regexp_replace(s.number, '[^0-9]', '', 'g'), 10) = v10 and s.revoked_at is null), '-infinity'::timestamptz) then
    return jsonb_build_object('ok', false, 'code', 'sms_stop', 'reason', 'This number texted STOP to our SMS line — we treat that as "do not call" too.');
  end if;
  select * into cfg from app_private.retell_config where id = 1;
  if cfg.api_key is null or cfg.outbound_agent_id is null or nullif(cfg.from_number, '') is null then
    return jsonb_build_object('ok', false, 'code', 'retell_off', 'reason', 'Retell is not configured on this environment.');
  end if;
  select * into pr from app_private.riley_prompts where agent_key = 'outbound';
  if pr.general_prompt is null or position('"' || v_src || '"' in pr.general_prompt) = 0 then
    return jsonb_build_object('ok', false, 'code', 'prompt_old', 'reason',
      case when v_tp then 'Riley Outbound''s prompt has no "third_party" section yet — add it (claude/RILEY-THIRD-PARTY-0555.md) under CC → Riley → Prompts, then Publish Outbound.'
           else 'Riley Outbound''s prompt does not know account calls yet.' end);
  end if;
  if pr.published_at is null or pr.published_at < pr.updated_at then
    return jsonb_build_object('ok', false, 'code', 'prompt_unpublished', 'reason', 'Riley Outbound has an unpublished prompt change — CC → Riley → Prompts → Publish Outbound first, so Riley uses the right opener.');
  end if;
  -- carrier plans count per carrier OR number; third-party plans per number only (calling the carrier's factoring
  -- company does not use up the carrier's own call of the day, and vice versa)
  select max(coalesce(x.called_at, x.scheduled_for, x.booked_at)) into v_last from app_private.riley_call_plans x
   where x.id <> p.id and x.status in ('scheduled', 'dialing', 'called', 'no_answer')
     and ((not v_tp and x.target_kind = 'carrier' and x.org_id = p.org_id) or right(x.to_number, 10) = v10)
     and coalesce(x.called_at, x.scheduled_for, x.booked_at) between v_slot - interval '20 hours' and v_slot + interval '20 hours';
  if v_last is not null then
    return jsonb_build_object('ok', false, 'code', 'cap_day', 'last', v_last, 'reason',
      case when v_tp then 'One Riley call per number per day' else 'One Riley call per carrier per day' end
      || ' — another call to this ' || case when v_tp then 'number' else 'carrier' end || ' is at ' || to_char(v_last at time zone 'America/New_York', 'Dy Mon DD HH12:MI AM') || ' ET.');
  end if;
  select count(*) into n from app_private.riley_call_plans x
   where x.id <> p.id and x.status in ('scheduled', 'dialing', 'called', 'no_answer')
     and ((not v_tp and x.target_kind = 'carrier' and x.org_id = p.org_id) or right(x.to_number, 10) = v10)
     and coalesce(x.called_at, x.scheduled_for, x.booked_at) between v_slot - interval '7 days' and v_slot;
  if n >= 3 then
    return jsonb_build_object('ok', false, 'code', 'cap_week', 'reason', 'Three Riley calls to this ' || case when v_tp then 'number' else 'carrier' end || ' in 7 days is the limit.');
  end if;
  if p.attempt > 3 then
    return jsonb_build_object('ok', false, 'code', 'cap_attempts', 'reason', 'Three attempts on one topic is the limit — send an email or hand it to a person.');
  end if;
  select count(*) into n from app_private.riley_call_plans x where x.id <> p.id and x.booked_at >= date_trunc('day', now()) and x.status in ('scheduled', 'dialing', 'called', 'no_answer');
  if n >= coalesce(t.max_per_day, 100) then
    return jsonb_build_object('ok', false, 'code', 'cap_global', 'reason', 'The daily limit for Riley bookings (' || t.max_per_day || ') is reached.');
  end if;
  return jsonb_build_object('ok', true, 'mode', t.mode);
end $$;

-- ─────────────────────────────────────────────────────────────── 8. booking / gate view / pre-dial use the plan's zone + window
select pg_temp.lb_patch('app_private.riley_plan_book(bigint, timestamptz, uuid, boolean, boolean)',
  $o$  tz := app_private.riley_plan_tz(p.org_id);
  v_slot := app_private.riley_call_window(tz, greatest(coalesce(p_when, now()), now()));$o$,
  $n$  tz := app_private.riley_plan_tz_of(p);   -- bl_voice_0555c: third party → their zone, 09:00–17:00
  v_slot := app_private.riley_plan_window(p, greatest(coalesce(p_when, now()), now()));$n$, 'bl_voice_0555c');
select pg_temp.lb_patch('app_private.riley_plan_book(bigint, timestamptz, uuid, boolean, boolean)',
  $o$    v_slot := app_private.riley_call_window(tz, (g ->> 'last')::timestamptz + interval '20 hours 5 minutes');$o$,
  $n$    v_slot := app_private.riley_plan_window(p, (g ->> 'last')::timestamptz + interval '20 hours 5 minutes');   -- bl_voice_0555d$n$, 'bl_voice_0555d');
select pg_temp.lb_patch('app_private.riley_plan_book(bigint, timestamptz, uuid, boolean, boolean)',
  $o$  values ('outbound', p.to_number, p.contact_name, 'carrier', 'your LoadBoot carrier account', p.plan_text, 'account', p.org_id, p_actor, 'scheduled', v_slot)$o$,
  $n$  values ('outbound', p.to_number, p.contact_name, coalesce(p.contact_role, 'carrier'),   -- bl_voice_0555e: third party → their role
          case when p.target_kind = 'third_party' then coalesce('the carrier ' || (select o.name from public.organizations o where o.id = p.org_id), 'a LoadBoot matter')
               else 'your LoadBoot carrier account' end,
          p.plan_text, 'account', p.org_id, p_actor, 'scheduled', v_slot)$n$, 'bl_voice_0555e');

create or replace function app_private.riley_plan_gate_view(p app_private.riley_call_plans)
returns jsonb language plpgsql stable security definer set search_path to 'app_private', 'public' as $$
declare v_slot timestamptz; g jsonb;   -- bl_voice_0555: the plan's own zone + window
begin
  v_slot := app_private.riley_plan_window(p, now());
  g := app_private.riley_dial_gate(p, false, v_slot);
  if not coalesce((g ->> 'ok')::boolean, false) and g ->> 'code' = 'cap_day' then
    v_slot := app_private.riley_plan_window(p, (g ->> 'last')::timestamptz + interval '20 hours 5 minutes');
    g := app_private.riley_dial_gate(p, false, v_slot);
  end if;
  return g || jsonb_build_object('next_slot', v_slot);
end $$;

select pg_temp.lb_patch('app_private.riley_plan_predial(bigint)',
  $o$    tz := app_private.riley_plan_tz(p.org_id);
    v_slot := app_private.riley_call_window(tz, now());$o$,
  $n$    tz := app_private.riley_plan_tz_of(p);
    v_slot := app_private.riley_plan_window(p, now());   -- bl_voice_0555f$n$, 'bl_voice_0555f');

select pg_temp.lb_patch('app_private.riley_followup_default_time(app_private.riley_call_plans)',
  $o$declare tz text := app_private.riley_plan_tz(p.org_id);$o$,
  $n$declare tz text := app_private.riley_plan_tz_of(p); /* bl_voice_0555g */$n$, 'bl_voice_0555g');

-- ─────────────────────────────────────────────────────────────── 9. plan JSON: the target + its zone
select pg_temp.lb_patch('app_private.riley_plan_json(app_private.riley_call_plans)',
  $o$app_private.riley_plan_tz(p.org_id)$o$, $n$app_private.riley_plan_tz_of(p)$n$, 'riley_plan_tz_of(p)', true);
select pg_temp.lb_patch('app_private.riley_plan_json(app_private.riley_call_plans)',
  $o$    'id', p.id, 'org_id', p.org_id,$o$,
  $n$    'id', p.id, 'org_id', p.org_id,
    'target', case when p.target_kind = 'third_party' then jsonb_build_object('kind', 'third_party', 'name', p.target_name, 'org', p.target_org, 'role', p.target_role, 'tz', p.target_tz)
                  else jsonb_build_object('kind', 'carrier') end, /* bl_voice_0555h */$n$, 'bl_voice_0555h');

-- ─────────────────────────────────────────────────────────────── 10. after the call: outcome.confirmed, no carrier follow-up machinery
select pg_temp.lb_patch('app_private.riley_plan_on_call(text, text)',
  $o$'recording', c.recording_url is not null, 'event', p_event)),$o$,
  $n$'recording', c.recording_url is not null, 'event', p_event,
                                                        'confirmed', case when p.target_kind = 'third_party'   -- bl_voice_0555i
                                                                          then left(coalesce(nullif(c.analysis ->> 'confirmed', ''), nullif(c.summary, '')), 400) end)),$n$, 'bl_voice_0555i');
select pg_temp.lb_patch('app_private.riley_plan_on_call(text, text)',
  $o$followup_status = case when followup_status is null$o$,
  $n$followup_status = case when p.target_kind = 'third_party' then followup_status /* bl_voice_0555j */ when followup_status is null$n$, 'bl_voice_0555j');
select pg_temp.lb_patch('app_private.riley_plan_on_call(text, text)',
  $o$  if p_event = 'call_analyzed' then perform app_private.riley_followup_enqueue(p.id); end if;$o$,
  $n$  if p.target_kind = 'third_party' then   -- bl_voice_0555k: staff read it; no auto follow-up, never a carrier email
    if p_event = 'call_analyzed' then
      perform app_private.riley_plan_notify(p, '📞 Riley spoke to ' || coalesce(p.target_name, 'the contact') || coalesce(' (' || p.target_org || ')', ''),
                                            coalesce(p.outcome ->> 'confirmed', 'Open the plan for the transcript.'));
    end if;
    return;
  end if;
  if p_event = 'call_analyzed' then perform app_private.riley_followup_enqueue(p.id); end if;$n$, 'bl_voice_0555k');
select pg_temp.lb_patch('app_private.riley_followup_rule_noanswer(bigint)',
  $o$  if p.id is null or p.status <> 'no_answer' or p.followup_status is not null then return; end if;$o$,
  $n$  if p.id is null or p.status <> 'no_answer' or p.followup_status is not null then return; end if;
  if p.target_kind = 'third_party' then return; end if;   -- bl_voice_0555l: no carrier email / auto retry for a third party$n$, 'bl_voice_0555l');
select pg_temp.lb_patch('app_private.riley_followup_enqueue(bigint)',
  $o$  if p.id is null or p.status <> 'called' or p.followup_job_id is not null or p.followup_status not in ('pending', 'failed') then return; end if;$o$,
  $n$  if p.id is null or p.status <> 'called' or p.followup_job_id is not null or p.followup_status not in ('pending', 'failed') then return; end if;
  if p.target_kind = 'third_party' then return; end if;   -- bl_voice_0555m$n$, 'bl_voice_0555m');
select pg_temp.lb_patch('public.cc_riley_followup_act(bigint, text, jsonb)',
  $o$    when 'email' then
$o$,
  $n$    when 'email' then
      if p.target_kind = 'third_party' then return jsonb_build_object('error', 'This call was to someone other than the carrier — no follow-up email from here.'); end if;   -- bl_voice_0555n
$n$, 'bl_voice_0555n');

-- ─────────────────────────────────────────────────────────────── 11. Retell: source "third_party" for these calls
select pg_temp.lb_patch('app_private.retell_dial(bigint)',
  $o$        'source', coalesce(r.source, 'website'))$o$,
  $n$        'source', case when exists (select 1 from app_private.riley_call_plans x where x.call_id = r.id and x.target_kind = 'third_party')
                       then 'third_party' else coalesce(r.source, 'website') end)   -- bl_voice_0555o$n$, 'bl_voice_0555o');

-- ─────────────────────────────────────────────────────────────── 12. CC RPCs
-- cc_riley_plan_create (carrier plans) is unchanged; a separate name avoids an overloaded RPC in PostgREST.
create or replace function public.cc_riley_plan_create_target(p_org uuid, p_reason text, p_note text, p_lang text,
  p_target_kind text, p_to_number text, p_target_name text, p_target_org text, p_target_role text, p_target_tz text)
returns jsonb language plpgsql security definer set search_path to 'app_private', 'public', 'extensions' as $$
begin
  if not (public.has_global_permission('comm.manage') or public.has_global_permission('dispatch.manage') or public.has_global_permission('settings.manage')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  return app_private.riley_plan_create(p_org, coalesce(p_reason, 'custom'), p_note, p_lang, auth.uid(), null, false,
                                       p_target_kind, p_to_number, p_target_name, p_target_org, p_target_role, p_target_tz);
end $$;
revoke execute on function public.cc_riley_plan_create_target(uuid, text, text, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.cc_riley_plan_create_target(uuid, text, text, text, text, text, text, text, text, text) to authenticated, service_role;

-- number check for the "Someone else" form: E.164, default time zone, do-not-call / STOP before anyone plans a call
create or replace function public.cc_riley_number_check(p_number text)
returns jsonb language plpgsql stable security definer set search_path to 'app_private', 'public' as $$
declare v_d text; v_num text; v_dnc app_private.voice_dnc; v_stop boolean;
begin
  if not (public.has_global_permission('comm.manage') or public.has_global_permission('dispatch.manage') or public.has_global_permission('settings.manage')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  v_d := regexp_replace(coalesce(p_number, ''), '[^0-9]', '', 'g');
  if length(v_d) = 11 and left(v_d, 1) = '1' then v_d := right(v_d, 10); end if;
  if v_d !~ '^[2-9][0-9]{2}[2-9][0-9]{6}$' then
    return jsonb_build_object('valid', false, 'reason', 'Not a valid US number — 10 digits after +1.');
  end if;
  v_num := '+1' || v_d;
  select * into v_dnc from app_private.voice_dnc where last10 = v_d;
  v_stop := coalesce((select max(s.revoked_at) from app_private.sms_consent s where right(regexp_replace(s.number, '[^0-9]', '', 'g'), 10) = v_d)
              > coalesce((select max(s.consented_at) from app_private.sms_consent s where right(regexp_replace(s.number, '[^0-9]', '', 'g'), 10) = v_d and s.revoked_at is null), '-infinity'::timestamptz), false);
  return jsonb_build_object(
    'valid', true, 'e164', v_num, 'tz', app_private.npa_tz(v_num),
    'dnc', case when v_dnc.last10 is null then null else jsonb_build_object('reason', v_dnc.reason, 'at', v_dnc.created_at) end,
    'sms_stop', v_stop,
    'is_carrier', exists (select 1 from public.profiles pr join public.organizations o on o.owner_user_id = pr.id
                           where o.kind = 'carrier' and right(regexp_replace(coalesce(pr.phone, ''), '[^0-9]', '', 'g'), 10) = v_d));
end $$;
revoke execute on function public.cc_riley_number_check(text) from public, anon;
grant execute on function public.cc_riley_number_check(text) to authenticated, service_role;

commit;
