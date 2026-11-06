-- bl_onb_0598 (owner, 3 Nov 2026) — carrier contact preferences right after phone verification.
--   The carrier ticks (unticked by default, optional): text messages + WhatsApp, for the number just verified.
--   SMS goes into the one consent table (app_private.sms_consent, method web_form, the declared 10DLC opt-in); a "no" is
--   stored as a revoked row so the older SMS prompt does not ask again. WhatsApp is recorded only; no send path reads it yet.
--   Preferences belong to one number: prefs_phone. A new verified number asks again.
-- Security: one new public RPC, authenticated only (revoked from public + anon). Anon surface unchanged.

alter table app_private.carrier_phone_verify
  add column if not exists whatsapp_pref boolean,
  add column if not exists whatsapp_pref_at timestamptz,
  add column if not exists prefs_phone text,
  add column if not exists prefs_saved_at timestamptz;

create or replace function app_private.carrier_contact_prefs(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path to 'app_private','public','pg_temp' as $$
declare v_phone text := app_private.carrier_owner_phone(p_org); e text; v app_private.carrier_phone_verify; c app_private.sms_consent;
begin
  e := app_private.dial_e164(coalesce(v_phone, ''));
  select * into v from app_private.carrier_phone_verify where org_id = p_org;
  if e is not null then select * into c from app_private.sms_consent where number = e; end if;
  return jsonb_build_object(
    'sms_consent', c.number is not null and c.revoked_at is null,
    'sms_answered', c.number is not null,
    'sms_consent_at', case when c.revoked_at is null then c.consented_at end,
    'sms_method', c.method,
    'sms_opted_out', e is not null and exists (select 1 from app_private.dialer_sms_optout o where o.number = e),
    'whatsapp_pref', case when v.prefs_phone = v_phone then v.whatsapp_pref end,
    'whatsapp_pref_at', case when v.prefs_phone = v_phone then v.whatsapp_pref_at end,
    'prefs_saved_at', case when v.prefs_phone = v_phone then v.prefs_saved_at end);
end $$;
revoke execute on function app_private.carrier_contact_prefs(uuid) from public, anon, authenticated;

create or replace function public.carrier_contact_prefs_set(p_sms boolean, p_whatsapp boolean) returns jsonb
language plpgsql security definer set search_path to 'app_private','public','pg_temp' as $$
declare v_org uuid; v_phone text; e text; v_name text; v_sms boolean := coalesce(p_sms, false); v_wa boolean := coalesce(p_whatsapp, false);
  v_ev text := 'carrier phone verification step, ticked by the account holder; number verified by voice code';
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  v_org := app_private.my_owned_carrier_org();
  if v_org is null then return jsonb_build_object('ok', false, 'error', 'Only the account owner can set this.'); end if;
  v_phone := app_private.carrier_owner_phone(v_org);
  e := app_private.dial_e164(coalesce(v_phone, ''));
  if e is null or not app_private.carrier_phone_verified(v_org)
     or not exists (select 1 from app_private.carrier_phone_verify where org_id = v_org and phone = v_phone) then
    return jsonb_build_object('ok', false, 'error', 'Verify your phone number first.');
  end if;
  if v_sms then
    if exists (select 1 from app_private.dialer_sms_optout where number = e) then
      return jsonb_build_object('ok', false, 'error', 'This number replied STOP to an earlier text. Reply START in that text thread to turn texts back on.');
    end if;
    select nullif(raw_user_meta_data->>'name', '') into v_name from auth.users where id = auth.uid();
    insert into app_private.sms_consent (number, kind, method, evidence, contact_name)
    values (e, 'carrier', 'web_form', v_ev, v_name)
    on conflict (number) do update set revoked_at = null, method = 'web_form', consented_at = now(), evidence = v_ev;
  else
    insert into app_private.sms_consent (number, kind, method, evidence, revoked_at)
    values (e, 'carrier', 'web_form', 'carrier phone verification step, left unticked by the account holder', now())
    on conflict (number) do update set revoked_at = coalesce(app_private.sms_consent.revoked_at, now());
  end if;
  update app_private.carrier_phone_verify
     set whatsapp_pref = v_wa, whatsapp_pref_at = now(), prefs_phone = v_phone, prefs_saved_at = now(), updated_at = now()
   where org_id = v_org;
  return jsonb_build_object('ok', true, 'sms', v_sms, 'whatsapp', v_wa);
end $$;
revoke execute on function public.carrier_contact_prefs_set(boolean, boolean) from public, anon;
grant execute on function public.carrier_contact_prefs_set(boolean, boolean) to authenticated;

do $mig$
declare r record; d text; n int;
begin
  for r in select * from (values
    ('public.carrier_phone_status()',
     $a$'verified', app_private.carrier_phone_verified(v_org),$a$,
     $b$'verified', app_private.carrier_phone_verified(v_org),
    'prefs_saved_at', app_private.carrier_contact_prefs(v_org)->'prefs_saved_at',$b$),
    ('public.cc_carrier_phone_status(uuid)',
     $a$'required_for_dispatcher', app_private.carrier_phone_required(p_org));$a$,
     $b$'required_for_dispatcher', app_private.carrier_phone_required(p_org))
    || app_private.carrier_contact_prefs(p_org);$b$)
  ) as x(fn, anchor, repl) loop
    d := pg_get_functiondef(r.fn::regprocedure);
    if position(r.anchor in d) = 0 then raise exception 'bl_onb_0598: anchor not found in %: %', r.fn, left(r.anchor, 70); end if;
    execute replace(d, r.anchor, r.repl);
  end loop;
  select count(*) into n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'carrier_contact_prefs_set' and has_function_privilege('anon', p.oid, 'EXECUTE');
  if n <> 0 then raise exception 'carrier_contact_prefs_set still anon-executable'; end if;
end $mig$;
