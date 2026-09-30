-- bl_onb_0490 — carrier phone verification by voice code · 30 Sep 2026 (owner approved the preview
-- https://claude.ai/artifact/GKdvkFVL6yT5uKZDe2FBkP)
--
-- Flow: dashboard card "Verify your phone number" → confirm the number on the account (or type a new one) →
-- LoadBoot calls it from the outbound line (+1 815, retell_out_from) and the verify agent reads a 6-digit code →
-- the carrier types it → verified. A new number only replaces profiles.phone once its code matches.
--
-- Rules (owner): signup is never blocked; verification is REQUIRED before a dedicated dispatcher is assigned, for
-- carriers created on/after 30 Sep 2026 (older carriers are grandfathered). Code 10 min; 5 wrong tries lock
-- the account's codes for 1 hour; calls: 60 s apart, 3 per hour, 6 per day; US numbers only; Riley do-not-call
-- numbers refused.
--
-- Built on the broker voice-code pattern (partner_verify_call / verify_codes / retell_dial_verify).
-- New PUBLIC functions (all authenticated-only, revoked from public + anon — anon SECDEF surface unchanged):
--   carrier_phone_status()            carrier owner: state of the card
--   carrier_phone_call(p_phone text)  carrier owner: place the code call (p_phone null = number on file)
--   carrier_phone_code(p_code text)   carrier owner: check the code
--   cc_carrier_phone_status(p_org)    staff (carriers.view): Carrier 360 pill
-- cc_dispatcher_assign gets the gate (anchor-patched, asserted).

begin;

create table if not exists app_private.carrier_phone_verify (
  org_id      uuid primary key references public.organizations(id) on delete cascade,
  phone       text not null,
  verified_at timestamptz not null default now(),
  verified_by uuid,
  method      text not null default 'voice_code',
  updated_at  timestamptz not null default now()
);
alter table app_private.carrier_phone_verify enable row level security;   -- no policies: SECURITY DEFINER access only
comment on table app_private.carrier_phone_verify is 'bl_onb_0490: the carrier phone number proven by a voice code. Verified = this phone equals the owner''s current profiles.phone.';

alter table app_private.verify_codes drop constraint if exists verify_codes_purpose_check;
alter table app_private.verify_codes add constraint verify_codes_purpose_check
  check (purpose = any (array['identity','parent','shipper_email','shipper_signer_phone','shipper_callback','carrier_phone']));

-- carriers created on/after this moment must verify before a dispatcher is assigned
create or replace function app_private.carrier_phone_required(p_org uuid) returns boolean
language sql stable security definer set search_path = app_private, public, pg_temp as $$
  select coalesce((select o.created_at >= timestamptz '2026-09-30 00:00:00+00' and not coalesce(o.is_demo, false)
                     from public.organizations o where o.id = p_org and o.kind = 'carrier'), false)
$$;

-- the owner's current phone as +1XXXXXXXXXX, or null
create or replace function app_private.carrier_owner_phone(p_org uuid) returns text
language sql stable security definer set search_path = app_private, public, pg_temp as $$
  select case when d ~ '^1?[0-9]{10}$' then '+1' || right(d, 10) end
    from (select regexp_replace(coalesce(pr.phone, ''), '[^0-9]', '', 'g') d
            from public.organizations o join public.profiles pr on pr.id = o.owner_user_id where o.id = p_org) x
$$;

create or replace function app_private.carrier_phone_verified(p_org uuid) returns boolean
language sql stable security definer set search_path = app_private, public, pg_temp as $$
  select exists (select 1 from app_private.carrier_phone_verify v
                  where v.org_id = p_org and v.phone = app_private.carrier_owner_phone(p_org))
$$;

-- the carrier org the signed-in OWNER runs (drivers and dispatchers acting-as never pass)
create or replace function app_private.my_owned_carrier_org() returns uuid
language sql stable security definer set search_path = app_private, public, pg_temp as $$
  select o.id from public.organizations o where o.owner_user_id = auth.uid() and o.kind = 'carrier' order by o.created_at limit 1
$$;

revoke all on function app_private.carrier_phone_required(uuid), app_private.carrier_owner_phone(uuid),
                       app_private.carrier_phone_verified(uuid), app_private.my_owned_carrier_org()
  from public, anon, authenticated;

create or replace function public.carrier_phone_status() returns jsonb
language plpgsql stable security definer set search_path = app_private, public, pg_temp as $$
declare v_org uuid; v_phone text; v jsonb; pend app_private.verify_codes; v_last timestamptz; n_hour int; n_day int; v_lock timestamptz;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  v_org := app_private.my_owned_carrier_org();
  if v_org is null then return jsonb_build_object('applies', false); end if;
  v_phone := app_private.carrier_owner_phone(v_org);
  select * into pend from app_private.verify_codes
   where org_id = v_org and purpose = 'carrier_phone' and consumed_at is null and expires_at > now() and attempts < 5
   order by created_at desc limit 1;
  select max(created_at), count(*) filter (where created_at > now() - interval '1 hour'), count(*)
    into v_last, n_hour, n_day
    from app_private.verify_codes where org_id = v_org and purpose = 'carrier_phone' and created_at > now() - interval '24 hours';
  select max(created_at) + interval '1 hour' into v_lock from app_private.verify_codes
   where org_id = v_org and purpose = 'carrier_phone' and attempts >= 5 and consumed_at is null and created_at > now() - interval '1 hour';
  return jsonb_build_object(
    'applies', true,
    'phone', v_phone,
    'verified', app_private.carrier_phone_verified(v_org),
    'verified_at', (select verified_at from app_private.carrier_phone_verify where org_id = v_org and phone = v_phone),
    'required_for_dispatcher', app_private.carrier_phone_required(v_org),
    'pending', case when pend.id is null then null else jsonb_build_object('to', pend.to_number, 'expires_at', pend.expires_at, 'new_number', pend.to_number is distinct from v_phone) end,
    'next_call_at', case when v_last is null then null else greatest(v_last + interval '60 seconds', now()) end,
    'calls_left_hour', greatest(0, 3 - coalesce(n_hour, 0)),
    'calls_left_day', greatest(0, 6 - coalesce(n_day, 0)),
    'locked_until', v_lock);
end $$;

create or replace function public.carrier_phone_call(p_phone text default null) returns jsonb
language plpgsql security definer set search_path = app_private, public, pg_temp as $$
declare v_org uuid; v_to text; d text; v_company text; v_code text; v_hash text; v_call bigint; cfg app_private.retell_config;
        v_last timestamptz; n_hour int; n_day int;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  v_org := app_private.my_owned_carrier_org();
  if v_org is null then return jsonb_build_object('ok', false, 'why', 'Only the account owner can verify the phone number.'); end if;
  select * into cfg from app_private.retell_config where id = 1;
  if cfg.api_key is null or cfg.verify_agent_id is null then return jsonb_build_object('ok', false, 'why', 'Verification calls are not switched on yet. Please try again later.'); end if;

  if nullif(btrim(coalesce(p_phone, '')), '') is null then
    v_to := app_private.carrier_owner_phone(v_org);
    if v_to is null then return jsonb_build_object('ok', false, 'why', 'There is no US phone number on your account. Enter one to continue.'); end if;
  else
    d := regexp_replace(p_phone, '[^0-9]', '', 'g');
    if d !~ '^1?[2-9][0-9]{2}[2-9][0-9]{6}$' then return jsonb_build_object('ok', false, 'why', 'Enter a US phone number with area code, like (704) 555-0142.'); end if;
    v_to := '+1' || right(d, 10);
  end if;
  if app_private.carrier_phone_verified(v_org) and v_to = app_private.carrier_owner_phone(v_org) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if exists (select 1 from app_private.voice_dnc x where x.last10 = right(v_to, 10)) then
    return jsonb_build_object('ok', false, 'why', 'We can''t call this number. Reply to our email or use Support and we''ll verify it with you.');
  end if;

  perform 1 from public.organizations where id = v_org for update;   -- serialise the limits below
  if exists (select 1 from app_private.verify_codes where org_id = v_org and purpose = 'carrier_phone' and attempts >= 5
                and consumed_at is null and created_at > now() - interval '1 hour') then
    return jsonb_build_object('ok', false, 'why', 'Too many wrong codes. Try again in an hour.');
  end if;
  select max(created_at), count(*) filter (where created_at > now() - interval '1 hour'), count(*)
    into v_last, n_hour, n_day
    from app_private.verify_codes where org_id = v_org and purpose = 'carrier_phone' and created_at > now() - interval '24 hours';
  if v_last > now() - interval '60 seconds' then return jsonb_build_object('ok', false, 'why', 'We just called. Give it a minute to ring.', 'next_call_at', v_last + interval '60 seconds'); end if;
  if n_hour >= 3 then return jsonb_build_object('ok', false, 'why', 'Three calls in an hour is the limit. Try again a little later.'); end if;
  if n_day >= 6 then return jsonb_build_object('ok', false, 'why', 'Six calls in a day is the limit. Try again tomorrow.'); end if;

  select name into v_company from public.organizations where id = v_org;
  declare b bytea := extensions.gen_random_bytes(4); begin
    v_code := lpad(((get_byte(b,0)::bigint * 16777216 + get_byte(b,1) * 65536 + get_byte(b,2) * 256 + get_byte(b,3)) % 1000000)::text, 6, '0');
  end;
  v_hash := encode(extensions.digest(v_code || ':' || v_org::text, 'sha256'), 'hex');
  insert into app_private.lc_calls (direction, from_number, to_number, contact_name, topic, contact_role, context, status, requested_by, source, org_id)
  values ('outbound', app_private.retell_out_from(), v_to, v_company, 'verification', 'carrier',
          'Automated phone verification code call · carrier account ' || coalesce(v_company, ''), 'requested', auth.uid(), 'verify', v_org)
  returning id into v_call;
  insert into app_private.verify_codes (org_id, purpose, to_number, code_hash, call_id, expires_at, created_by, channel)
  values (v_org, 'carrier_phone', v_to, v_hash, v_call, now() + interval '10 minutes', auth.uid(), 'call');
  perform app_private.retell_dial_verify(v_call, jsonb_build_object(
    'company', coalesce(v_company, 'your company'), 'mc', '', 'purpose', 'phone number verification for a LoadBoot carrier account',
    'requester', '', 'code', trim(regexp_replace(v_code, '(.)', '\1 ', 'g')),
    'script', 'This is LoadBoot calling to confirm the phone number on the carrier account for ' || coalesce(v_company, 'your company')
              || '. Someone signed in to that account asked for this call. I will read you a one-time code to type into the LoadBoot app. If you did not ask for this, simply hang up.'));
  perform app_private.log_audit('carrier.phone_verify_call', 'org', v_org::text, v_org, 'code call to ' || app_private.mask_phone(v_to), null, null);
  return jsonb_build_object('ok', true, 'to', v_to, 'expires_at', now() + interval '10 minutes', 'next_call_at', now() + interval '60 seconds',
                            'calls_left_hour', greatest(0, 3 - n_hour - 1));
end $$;

create or replace function public.carrier_phone_code(p_code text) returns jsonb
language plpgsql security definer set search_path = app_private, public, pg_temp as $$
declare v_org uuid; vc app_private.verify_codes; v_code text; v_hash text; v_hit boolean := false; v_n int := 0; v_owner uuid; v_old text;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  v_org := app_private.my_owned_carrier_org();
  if v_org is null then return jsonb_build_object('ok', false, 'why', 'Only the account owner can verify the phone number.'); end if;
  v_code := regexp_replace(coalesce(p_code, ''), '\D', '', 'g');
  if length(v_code) <> 6 then return jsonb_build_object('ok', false, 'why', 'Enter the 6-digit code.'); end if;
  if exists (select 1 from app_private.verify_codes where org_id = v_org and purpose = 'carrier_phone' and attempts >= 5
                and consumed_at is null and created_at > now() - interval '1 hour') then
    return jsonb_build_object('ok', false, 'why', 'Too many wrong codes. Try again in an hour.');
  end if;
  v_hash := encode(extensions.digest(v_code || ':' || v_org::text, 'sha256'), 'hex');
  for vc in select * from app_private.verify_codes
             where org_id = v_org and purpose = 'carrier_phone' and consumed_at is null and expires_at > now() and attempts < 5
             order by created_at desc for update loop
    v_n := v_n + 1;
    if vc.code_hash = v_hash then v_hit := true; exit; end if;
  end loop;
  if v_n = 0 then return jsonb_build_object('ok', false, 'why', 'No live code. Tap "Call me" to get a new one (codes last 10 minutes).'); end if;
  if not v_hit then
    update app_private.verify_codes set attempts = attempts + 1
     where org_id = v_org and purpose = 'carrier_phone' and consumed_at is null and expires_at > now() and attempts < 5;
    return jsonb_build_object('ok', false, 'why', 'That code doesn''t match. Check the code from the call and try again.');
  end if;

  update app_private.verify_codes set consumed_at = now() where id = vc.id;
  select owner_user_id into v_owner from public.organizations where id = v_org;
  v_old := app_private.carrier_owner_phone(v_org);
  if v_old is distinct from vc.to_number then
    update public.profiles set phone = vc.to_number where id = v_owner;
  end if;
  insert into app_private.carrier_phone_verify (org_id, phone, verified_at, verified_by, method, updated_at)
  values (v_org, vc.to_number, now(), auth.uid(), 'voice_code', now())
  on conflict (org_id) do update set phone = excluded.phone, verified_at = now(), verified_by = auth.uid(), method = 'voice_code', updated_at = now();
  perform app_private.log_audit('carrier.phone_verified', 'org', v_org::text, v_org,
    'phone ' || app_private.mask_phone(vc.to_number) || ' verified by voice code' || case when v_old is distinct from vc.to_number then ' (changed from ' || coalesce(app_private.mask_phone(v_old), 'none') || ')' else '' end, null, null);
  return jsonb_build_object('ok', true, 'phone', vc.to_number, 'verified_at', now(), 'changed', v_old is distinct from vc.to_number);
end $$;

create or replace function public.cc_carrier_phone_status(p_org uuid) returns jsonb
language plpgsql stable security definer set search_path = app_private, public, pg_temp as $$
begin
  if not public.has_global_permission('carriers.view') then raise exception 'not authorized' using errcode = '42501'; end if;
  return jsonb_build_object(
    'phone', app_private.carrier_owner_phone(p_org),
    'verified', app_private.carrier_phone_verified(p_org),
    'verified_at', (select verified_at from app_private.carrier_phone_verify where org_id = p_org),
    'verified_phone', (select phone from app_private.carrier_phone_verify where org_id = p_org),
    'required_for_dispatcher', app_private.carrier_phone_required(p_org));
end $$;

revoke all on function public.carrier_phone_status(), public.carrier_phone_call(text), public.carrier_phone_code(text),
                       public.cc_carrier_phone_status(uuid) from public, anon;
grant execute on function public.carrier_phone_status(), public.carrier_phone_call(text), public.carrier_phone_code(text),
                          public.cc_carrier_phone_status(uuid) to authenticated, service_role;

-- the gate: no dedicated dispatcher until the phone is verified (new carriers only)
do $mig$
declare d text; n text;
begin
  d := pg_get_functiondef('public.cc_dispatcher_assign(uuid, uuid, jsonb)'::regprocedure);
  if position('bl_onb_0490' in d) = 0 then
    n := replace(d, $a$  if v_kind is null then return jsonb_build_object('error','carrier not found'); end if;$a$,
$a$  if v_kind is null then return jsonb_build_object('error','carrier not found'); end if;
  -- bl_onb_0490: new carriers verify their phone (voice code) before a dispatcher is assigned
  if app_private.carrier_phone_required(v_org) and not app_private.carrier_phone_verified(v_org) then
    return jsonb_build_object('error', 'This carrier has not verified their phone number yet. They do it from the dashboard card "Verify your phone number" (a code call). Assign after that.');
  end if;$a$);
    if n = d then raise exception 'bl_onb_0490: cc_dispatcher_assign anchor not found'; end if;
    execute n;
  end if;
end $mig$;

commit;
