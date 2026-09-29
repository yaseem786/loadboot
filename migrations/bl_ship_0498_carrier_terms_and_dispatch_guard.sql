-- bl_ship_0498 — carrier side of the Master Shipper–Carrier Terms + LoadBoot dispatch never negotiates with a shipper
-- (29 Sep 2026, owner agreement review of bl_ship_0491; STAGING first, prod only on "prod pe chalao").
--
-- 1. A carrier accepts the standard Shipper–Carrier Terms (master_agreements kind 'shipper_carrier', the same
--    template every shipper signs) ONCE per published version, in its own app, signed by a carrier owner/office
--    user. Without that signature no shipper load can be requested or accepted. A LoadBoot dispatcher can never
--    sign it for the carrier — LoadBoot must not be the one forming the shipper's transportation contract.
-- 2. On a shipper's load a LoadBoot dispatcher (acting for an assigned carrier) cannot send a note or a counter-offer
--    to the shipper: the carrier requests at the shipper's posted rate. FMCSA 88 FR 39368 (16 Jun 2023), IV.F:
--    a dispatch service that "interacts with or negotiates any shipment of freight directly with the shipper" is an
--    indicator that broker authority is needed. The carrier's own users may still counter — that is carrier ↔ shipper.

-- ───────────── helpers ─────────────
create or replace function app_private.is_shipper_load(p_load uuid)
returns boolean language sql stable security definer set search_path = app_private, public as $$
  select coalesce((select o.kind = 'shipper' from public.loads l join public.organizations o on o.id = l.broker_org
                    where l.id = p_load), false)
$$;

-- true when p_user is NOT an active member of the carrier org, i.e. a dispatcher acting through app.dispatch_as
create or replace function app_private.is_dispatch_actor(p_carrier uuid, p_user uuid default auth.uid())
returns boolean language sql stable security definer set search_path = app_private, public as $$
  select not exists (select 1 from public.organization_memberships om
                      where om.org_id = p_carrier and om.user_id = p_user and om.status = 'active')
$$;

create or replace function app_private.carrier_shipper_terms_ok(p_carrier uuid)
returns boolean language sql stable security definer set search_path = app_private, public as $$
  select exists (select 1 from app_private.agreement_signatures s
                  where s.org_id = p_carrier and s.kind = 'shipper_carrier'
                    and s.version = (select max(version) from app_private.master_agreements
                                      where kind = 'shipper_carrier' and published and legal_approved))
$$;

-- the carrier's own owner/office user (never a driver, never a dispatcher)
create or replace function app_private.my_carrier_signer_org()
returns uuid language sql stable security definer set search_path = app_private, public as $$
  select om.org_id from public.organization_memberships om join public.organizations o on o.id = om.org_id
   where om.user_id = auth.uid() and om.status = 'active' and o.kind = 'carrier' and om.member_role in ('owner','staff')
   order by om.created_at limit 1
$$;

-- ───────────── carrier RPCs ─────────────
create or replace function public.cc_carrier_shipper_terms()
returns jsonb language plpgsql stable security definer set search_path = app_private, public as $$
declare v_org uuid; a app_private.master_agreements; s app_private.agreement_signatures;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode = '42501'; end if;
  select * into a from app_private.master_agreements where kind = 'shipper_carrier' and published and legal_approved order by version desc limit 1;
  if a.kind is null then
    return jsonb_build_object('available', false, 'message', 'Shipper loads open once the Shipper–Carrier Terms are published.');
  end if;
  select * into s from app_private.agreement_signatures where org_id = v_org and kind = 'shipper_carrier' and version = a.version order by signed_at desc limit 1;
  return jsonb_build_object('available', true, 'kind', a.kind, 'version', a.version, 'title', a.title, 'body_md', a.body_md,
    'body_sha256', encode(extensions.digest(a.body_md, 'sha256'), 'hex'),
    'signed', s.id is not null, 'signed_at', s.signed_at, 'signer_name', s.signer_name, 'signer_title', s.signer_title,
    'can_sign', app_private.my_carrier_signer_org() = v_org);
end $$;

create or replace function public.cc_carrier_shipper_terms_sign(p_version int, p_body_sha256 text,
  p_signer_name text, p_signer_title text, p_consent boolean)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_org uuid; a app_private.master_agreements; v_hash text; v_hdr jsonb; v_consent text;
begin
  v_org := app_private.my_carrier_signer_org();
  if v_org is null then
    raise exception 'Only the carrier''s owner or office staff can accept these Terms — a dispatcher or driver cannot sign for the carrier.' using errcode = '42501';
  end if;
  select * into a from app_private.master_agreements where kind = 'shipper_carrier' and version = p_version and published and legal_approved;
  if a.kind is null then raise exception 'This agreement version is not open for signing.' using errcode = '22023'; end if;
  if exists (select 1 from app_private.master_agreements where kind = 'shipper_carrier' and published and legal_approved and version > p_version) then
    raise exception 'A newer version was published — reload and sign that one.' using errcode = '22023'; end if;
  v_hash := encode(extensions.digest(a.body_md, 'sha256'), 'hex');
  if p_body_sha256 is distinct from v_hash then raise exception 'The agreement text changed while you were reading it — reload and sign again.' using errcode = '22023'; end if;
  if not coalesce(p_consent, false) then raise exception 'Tick the box to agree to sign electronically.' using errcode = '22023'; end if;
  if length(trim(coalesce(p_signer_name,''))) < 4 or trim(p_signer_name) !~ '\s' then raise exception 'Type your full name (first and last) to sign.' using errcode = '22023'; end if;
  if length(trim(coalesce(p_signer_title,''))) < 2 then raise exception 'Enter your title.' using errcode = '22023'; end if;
  v_consent := 'I agree to sign electronically, I have authority to bind ' || coalesce((select name from public.organizations where id = v_org),'the carrier')
            || ', these Terms apply to every shipper load it is accepted for on LoadBoot, and my typed name is my signature (ESIGN Act, 15 U.S.C. 7001).';
  begin v_hdr := current_setting('request.headers', true)::jsonb; exception when others then v_hdr := null; end;
  insert into app_private.agreement_signatures(org_id, kind, version, signer_user, signer_name, signer_title, consent_text, body_sha256, ip, user_agent)
  values (v_org, 'shipper_carrier', p_version, auth.uid(), trim(p_signer_name), trim(p_signer_title), v_consent, v_hash,
          left(split_part(coalesce(v_hdr->>'x-forwarded-for', v_hdr->>'x-real-ip', ''), ',', 1), 64), left(v_hdr->>'user-agent', 300));
  insert into app_private.org_agreement_acceptances(org_id, kind, version, accepted_by, accepted_at)
  values (v_org, 'shipper_carrier', p_version, auth.uid(), now()) on conflict (org_id, kind, version) do nothing;
  perform app_private.log_audit('agreement.signed', 'org', v_org::text, v_org, 'shipper_carrier v' || p_version || ' accepted by carrier, signed by ' || trim(p_signer_name), null);
  return jsonb_build_object('ok', true, 'version', p_version);
end $$;

-- ───────────── book requests on shipper loads ─────────────
create or replace function app_private.trg_bookreq_shipper_terms()
returns trigger language plpgsql security definer set search_path = app_private, public as $$
declare v_note text;
begin
  if not app_private.is_shipper_load(NEW.load_id) then return NEW; end if;
  if not app_private.carrier_shipper_terms_ok(NEW.carrier_org) then
    raise exception 'SHIPPER_TERMS: This is a shipper''s own load. The carrier''s owner must accept the Shipper–Carrier Terms once (Carrier app → Loads) before requesting it — a dispatcher cannot accept them for the carrier.' using errcode = '42501';
  end if;
  if app_private.is_dispatch_actor(NEW.carrier_org, NEW.carrier_user) then
    v_note := trim(regexp_replace(coalesce(NEW.note, ''), '\s*\[requested by dispatcher\]\s*$', ''));
    if v_note <> '' then
      raise exception 'On a shipper''s own load LoadBoot dispatch cannot message the shipper — the carrier requests at the posted rate. Remove the note and request again.' using errcode = '42501';
    end if;
    NEW.note := 'Requested at your posted rate by the carrier''s LoadBoot dispatcher.';
  end if;
  return NEW;
end $$;

drop trigger if exists bookreq_shipper_terms on app_private.load_book_requests;
create trigger bookreq_shipper_terms before insert on app_private.load_book_requests
  for each row execute function app_private.trg_bookreq_shipper_terms();

-- ───────────── offers on shipper loads (cc_offer_respond) ─────────────
do $do$
declare d text; a text := $a$  if p_action='view' then$a$;
begin
  d := pg_get_functiondef('public.cc_offer_respond(uuid,text,text,numeric,text)'::regprocedure);
  if position('bl_ship_0498' in d) > 0 then return; end if;
  if position(a in d) = 0 then raise exception 'bl_ship_0498: cc_offer_respond anchor not found'; end if;
  execute replace(d, a, $b$  if app_private.is_shipper_load(o.load_id) then  -- bl_ship_0498
    if p_action = 'accept' and not app_private.carrier_shipper_terms_ok(v_org) then
      raise exception 'SHIPPER_TERMS: This is a shipper''s own load. The carrier''s owner must accept the Shipper–Carrier Terms once (Carrier app → Loads) before accepting it.' using errcode = '42501';
    end if;
    if p_action = 'counter' and app_private.is_dispatch_actor(v_org) then
      raise exception 'On a shipper''s own load LoadBoot dispatch cannot counter-offer — only the carrier''s own staff can.' using errcode = '42501';
    end if;
  end if;
$b$ || a);
end $do$;

-- ───────────── grants (CLAUDE.md §4: explicit revoke from public, anon) ─────────────
revoke execute on function app_private.is_shipper_load(uuid) from public, anon;
revoke execute on function app_private.is_dispatch_actor(uuid, uuid) from public, anon;
revoke execute on function app_private.carrier_shipper_terms_ok(uuid) from public, anon;
revoke execute on function app_private.my_carrier_signer_org() from public, anon;
revoke execute on function app_private.trg_bookreq_shipper_terms() from public, anon;
revoke execute on function public.cc_carrier_shipper_terms() from public, anon;
revoke execute on function public.cc_carrier_shipper_terms_sign(int, text, text, text, boolean) from public, anon;
grant execute on function public.cc_carrier_shipper_terms() to authenticated;
grant execute on function public.cc_carrier_shipper_terms_sign(int, text, text, text, boolean) to authenticated;
