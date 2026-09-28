-- bl_ship_0492 — wires the 0491 gates into posting/booking, and fixes the gaps found on 28 Sep 2026.
-- Run AFTER bl_ship_0491. Staging first.
--
--   1. Posting trigger: shipper posts go through the lane gate (direct = partner_loads, broker = partner_shipments),
--      with load-specific checks (hazmat / food / high value) and the new-shipper limits.
--   2. Booking trigger: a shipper's load is never instant-booked — the SHIPPER accepts every carrier
--      (request-to-book or its own direct offer). Legal line: LoadBoot never selects the carrier.
--   3. cc_decide_book_request: on a shipper's load only the shipper can approve; staff can decline/block only.
--      'decline' is accepted as a synonym of 'reject' (the portal's Decline button sent 'decline' and always failed).
--   4. cc_decide_partner_shipment: staff can no longer 'book' or 'quote' shipper freight — decline (block) only.
--   5. cc_partner_update_profile: patch semantics — a field that is not sent keeps its value (MII lost contact/email/address).
--   6. Upload guard: server-side fingerprint (storage eTag + size) — same file in two items is refused; a load document
--      (tender, rate con, BOL, POD, invoice) in an onboarding slot is refused; the same file on two accounts flags human review.
--   7. Business-check collector stores the domain-check v6 risk signals; its "request your first quote" copy is corrected.
--   8. welcome.shipper: says "verify your company", not "your account is live".
--   9. Broker lane: no tender while zero verified brokers exist (polite, specific message); partner_shipments gets lane columns.

-- helper: replace ONE exact anchor in a live function, refuse if the anchor is missing or ambiguous
create or replace function app_private._bl0492_patch(p_fn regprocedure, p_old text, p_new text)
returns void language plpgsql as $$
declare d text; n int;
begin
  d := pg_get_functiondef(p_fn);
  n := (length(d) - length(replace(d, p_old, ''))) / greatest(length(p_old), 1);
  if n <> 1 then raise exception 'bl_ship_0492 patch: anchor found % times in % — refusing', n, p_fn; end if;
  execute replace(d, p_old, p_new);
end $$;

-- ───────────── 1. posting trigger ─────────────
select app_private._bl0492_patch('app_private.enforce_partner_onboarded()'::regprocedure,
$a$  if exists (select 1 from public.organizations o where o.id = v_org and o.kind = 'shipper') then
    perform app_private.assert_shipper_can_post(v_org);$a$,
$b$  if exists (select 1 from public.organizations o where o.id = v_org and o.kind = 'shipper') then
    -- bl_ship_0491: partner_loads = Direct lane (carriers), partner_shipments = Broker lane (tender)
    perform app_private.assert_shipper_lane(v_org, case when TG_TABLE_NAME = 'partner_shipments' then 'broker' else 'direct' end, to_jsonb(NEW));$b$);

-- ───────────── 2. booking trigger ─────────────
select app_private._bl0492_patch('app_private.enforce_trust_gate_not_bookable()'::regprocedure,
$a$    v_tier := app_private.shipper_tier(NEW.broker_org);
    if v_tier = 'verified' then
      if NEW.verification_state = 'partial' then NEW.verification_state := 'verified'; end if;
      return NEW;
    end if;$a$,
$b$    v_tier := app_private.shipper_tier(NEW.broker_org);
    -- bl_ship_0491: no instant booking on shipper freight, ever — the shipper accepts each carrier (FMCSA 2023 guidance:
    -- the platform must not be the one assigning the load). Verified only upgrades the label.
    if v_tier = 'verified' and NEW.verification_state = 'partial' then NEW.verification_state := 'verified'; end if;$b$);

select app_private._bl0492_patch('app_private.enforce_trust_gate_not_bookable()'::regprocedure,
$a$    raise exception 'This load is from a shipper new to LoadBoot — book it with "Request to book" (the shipper approves and LoadBoot confirms the rate confirmation). Instant booking unlocks once their onboarding is reviewed.' using errcode = '42501';$a$,
$b$    raise exception 'Shipper loads are booked with "Request to book" — the shipper reviews your carrier profile and accepts the carrier.' using errcode = '42501';$b$);

-- ───────────── 3. book-request decisions ─────────────
select app_private._bl0492_patch('public.cc_decide_book_request(uuid,text,text)'::regprocedure,
$a$  v_staff := public.is_active_staff(); v_broker := app_private.my_partner_org('broker');$a$,
$b$  v_staff := public.is_active_staff(); v_broker := app_private.my_partner_org('broker');
  if p_action = 'decline' then p_action := 'reject'; end if;  -- bl_ship_0491: the portal's Decline button$b$);

select app_private._bl0492_patch('public.cc_decide_book_request(uuid,text,text)'::regprocedure,
$a$  if r.status = 'expired' then raise exception$a$,
$b$  -- bl_ship_0491: on a SHIPPER's load only the shipper accepts a carrier. Staff may decline/block, never approve.
  if p_action = 'approve' and exists (select 1 from app_private.partner_loads pl join public.organizations o on o.id = pl.broker_org
                                       where pl.posted_load_id = r.load_id and o.kind = 'shipper')
     and (v_broker is null or not exists (select 1 from app_private.partner_loads pl where pl.posted_load_id = r.load_id and pl.broker_org = v_broker)) then
    raise exception 'Only the shipper can accept a carrier for its own load. LoadBoot staff can decline or block a request, never approve one.' using errcode = '42501';
  end if;
  if r.status = 'expired' then raise exception$b$);

-- ───────────── 4. staff cannot book or quote shipper freight ─────────────
select app_private._bl0492_patch('public.cc_decide_partner_shipment(uuid,text)'::regprocedure,
$a$  if p_action not in ('quote','book','decline') then raise exception 'invalid action' using errcode='22023'; end if;$a$,
$b$  -- bl_ship_0491: LoadBoot is not a broker — staff never quote or book shipper freight; they may only decline (block).
  if p_action in ('quote','book') then raise exception 'LoadBoot staff cannot quote or book shipper freight — the shipper chooses a broker or a carrier. Staff can only decline (block) a shipment.' using errcode='42501'; end if;
  if p_action not in ('decline') then raise exception 'invalid action' using errcode='22023'; end if;$b$);

-- ───────────── 5. profile patch semantics ─────────────
create or replace function public.cc_partner_update_profile(p_company text, p_contact_name text default null, p_phone text default null,
  p_email text default null, p_address text default null)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_org uuid;
begin
  select org_id into v_org from app_private.my_partner_context();
  if v_org is null then raise exception 'not a partner account' using errcode='42501'; end if;
  if coalesce(trim(p_company),'') <> '' then
    update public.organizations set name = trim(p_company), updated_at = now() where id = v_org;
  end if;
  -- bl_ship_0491: a field that is not sent (null / blank) keeps its saved value — never overwritten with NULL
  insert into app_private.partner_profiles(org_id, contact_name, phone, email, address, updated_at)
    values (v_org, nullif(trim(p_contact_name),''), nullif(trim(p_phone),''), nullif(trim(p_email),''), nullif(trim(p_address),''), now())
  on conflict (org_id) do update set
    contact_name = coalesce(excluded.contact_name, app_private.partner_profiles.contact_name),
    phone        = coalesce(excluded.phone,        app_private.partner_profiles.phone),
    email        = coalesce(excluded.email,        app_private.partner_profiles.email),
    address      = coalesce(excluded.address,      app_private.partner_profiles.address),
    updated_at   = now();
  return jsonb_build_object('ok', true);
end; $$;
revoke execute on function public.cc_partner_update_profile(text,text,text,text,text) from public, anon;
grant execute on function public.cc_partner_update_profile(text,text,text,text,text) to authenticated;

-- ───────────── 6. upload guard ─────────────
create or replace function app_private.onboarding_file_guard(p_org uuid, p_kind text, p_key text, p_ref text)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_path text; m jsonb; v_md5 text; v_size bigint; v_mime text; v_name text; v_other text; v_label text; tp app_private.onboarding_packet_templates; o uuid[];
begin
  if p_kind not in ('shipper','broker') then return null; end if;          -- carriers keep their existing flow
  select * into tp from app_private.onboarding_packet_templates where org_kind = p_kind and item_key = p_key;
  if p_kind = 'shipper' and tp.item_type in ('form','ack','accept','system','staff','legacy') then
    raise exception '"%" is filled in on the form in Onboarding, not uploaded.', tp.label using errcode = '22023'; end if;
  v_path := substring(coalesce(p_ref,'') from 'file:(\S+)');
  if v_path is null then
    if p_kind = 'shipper' and tp.item_type = 'upload' then raise exception 'Attach the document (PDF or a clear photo).' using errcode = '22023'; end if;
    return null;
  end if;
  if split_part(v_path, '/', 1) <> auth.uid()::text then raise exception 'That file was not uploaded from your account.' using errcode = '42501'; end if;
  select metadata into m from storage.objects where bucket_id = 'documents' and name = v_path;
  if m is null then raise exception 'The upload did not finish — please attach the file again.' using errcode = '22023'; end if;
  v_md5 := trim(both '"' from coalesce(m->>'eTag',''));
  v_size := nullif(m->>'size','')::bigint;
  v_mime := lower(coalesce(m->>'mimetype',''));
  if v_mime not in ('application/pdf','image/jpeg','image/png','image/heic','image/heif','image/webp') then
    raise exception 'Upload a PDF or a photo (JPG, PNG, HEIC). Other file types are refused for safety.' using errcode = '22023'; end if;
  v_name := lower(regexp_replace(v_path, '^.*/\d+-[a-z0-9]+-', ''));
  if v_name ~ '(tender|rate[ _.-]?con|ratecon|bill[ _.-]?of[ _.-]?lading|(^|[^a-z])bol([^a-z]|$)|(^|[^a-z])pod([^a-z]|$)|invoice|load[ _.-]?confirm)' then
    raise exception 'This file ("%") looks like a load document, not your %. Please upload the right document.', regexp_replace(v_path, '^.*/\d+-[a-z0-9]+-', ''), coalesce(tp.label, p_key) using errcode = '22023'; end if;
  if v_md5 <> '' then
    select i.item_key into v_other from app_private.org_onboarding_items i
     where i.org_id = p_org and i.item_key <> p_key and i.file_md5 = v_md5 and i.file_size is not distinct from v_size limit 1;
    if v_other is not null then
      select label into v_label from app_private.onboarding_packet_templates where org_kind = p_kind and item_key = v_other;
      raise exception 'You already uploaded this exact file for "%". Each item needs its own document.', coalesce(v_label, v_other) using errcode = '22023'; end if;
    -- same file on ANOTHER account: not blocked (could be a public form), but a human looks at both
    select array_agg(distinct i.org_id) into o from app_private.org_onboarding_items i
     where i.org_id <> p_org and i.file_md5 = v_md5 and i.file_size is not distinct from v_size;
    if o is not null and p_kind = 'shipper' then
      insert into app_private.shipper_trust(org_id, shared_doc_orgs) values (p_org, o)
      on conflict (org_id) do update set shared_doc_orgs = (select array_agg(distinct x) from unnest(app_private.shipper_trust.shared_doc_orgs || o) x), updated_at = now();
    end if;
  end if;
  return jsonb_build_object('path', v_path, 'md5', nullif(v_md5,''), 'size', v_size);
end $$;
revoke execute on function app_private.onboarding_file_guard(uuid,text,text,text) from public, anon;

select app_private._bl0492_patch('public.cc_onboarding_submit_item(text,text,text)'::regprocedure,
$a$declare v_org uuid; v_kind text; v_name text; v_label text; v_auto boolean := false;$a$,
$b$declare v_org uuid; v_kind text; v_name text; v_label text; v_auto boolean := false; v_fp jsonb;$b$);
select app_private._bl0492_patch('public.cc_onboarding_submit_item(text,text,text)'::regprocedure,
$a$  insert into app_private.org_onboarding_items(org_id, item_key, status, ref, note, submitted_by, submitted_at)
    values (v_org, p_key, 'submitted', trim(p_ref), p_note, auth.uid(), now())$a$,
$b$  v_fp := app_private.onboarding_file_guard(v_org, v_kind, p_key, p_ref);  -- bl_ship_0491
  insert into app_private.org_onboarding_items(org_id, item_key, status, ref, note, submitted_by, submitted_at, file_path, file_md5, file_size)
    values (v_org, p_key, 'submitted', trim(p_ref), p_note, auth.uid(), now(), v_fp->>'path', v_fp->>'md5', (v_fp->>'size')::bigint)$b$);
select app_private._bl0492_patch('public.cc_onboarding_submit_item(text,text,text)'::regprocedure,
$a$    submitted_by = auth.uid(), submitted_at = now(), reviewed_by = null, reviewed_at = null;$a$,
$b$    submitted_by = auth.uid(), submitted_at = now(), reviewed_by = null, reviewed_at = null,
    file_path = excluded.file_path, file_md5 = excluded.file_md5, file_size = excluded.file_size;$b$);

-- ───────────── 7. business-check collector ─────────────
select app_private._bl0492_patch('app_private.shipper_check_collect()'::regprocedure,
$a$free_mail = coalesce((body->>'free_mail')::boolean, false),$a$,
$b$free_mail = coalesce((body->>'free_mail')::boolean, false), risk_signals = body - 'company_tokens' - 'matched_tokens',$b$);
select app_private._bl0492_patch('app_private.shipper_check_collect()'::regprocedure,
$a$'✅ Business confirmed — request your first quote',$a$,
$b$'✅ Company email checked — next, verify your company',$b$);
select app_private._bl0492_patch('app_private.shipper_check_collect()'::regprocedure,
$a$'. Post a shipment now — brokers quote it within the hour. Payment terms and the rest of the packet come before your first booking.'$a$,
$b$'. Next: finish company verification under Onboarding (legal entity, address, signer, agreements). Then you can post to verified carriers or send a tender to a verified broker.'$b$);

-- ───────────── 8. welcome.shipper copy ─────────────
select app_private._bl0492_patch('app_private.trg_partner_org_welcome()'::regprocedure,
$a$      'Welcome to LoadBoot, ' || v_who || ' — your ' || v_label || ' account is live',$a$,
$b$      'Welcome to LoadBoot, ' || v_who || case when new.kind = 'shipper' then ' — next, verify your company' else ' — your ' || v_label || ' account is live' end,$b$);
select app_private._bl0492_patch('app_private.trg_partner_org_welcome()'::regprocedure,
$a$'</b> account is live. Three steps to your first covered load:</p>'$a$,
$b$'</b> account is ' || case when new.kind = 'shipper' then 'created. Before anything reaches a carrier or a broker we verify your company — it protects you from look-alike fraud, and it is what carriers and brokers trust. Three steps:</p>' else 'live. Three steps to your first covered load:</p>' end$b$);
select app_private._bl0492_patch('app_private.trg_partner_org_welcome()'::regprocedure,
$a$1️⃣ Complete your shipper packet (credit application, agreement, payment terms — 10 minutes)<br>2️⃣ Post your first shipment with the full wizard — exact addresses, schedule, rate<br>3️⃣ Verified carriers book it — GPS-tracked door to door, every document collected for you$a$,
$b$1️⃣ Verify your company — legal entity, address, signer, and a call-back to your company''s public number (about 15 minutes)<br>2️⃣ Sign the LoadBoot agreements in the portal and add your billing, cargo and pickup/delivery locations<br>3️⃣ Choose for each load: post it to verified carriers (you pick the carrier) or send a tender to a verified broker — GPS-tracked door to door$b$);

-- ───────────── 9. broker lane ─────────────
alter table app_private.partner_shipments
  add column if not exists lane text not null default 'broker' check (lane in ('broker','direct')),
  add column if not exists accepted_by uuid,
  add column if not exists accepted_at timestamptz;

-- A broker a shipper may tender to: broker tier verified (FMCSA authority read live + full packet incl. the
-- $75,000 BMC-84/85 bond item), not a demo account, not on hold.
create or replace function app_private.verified_broker_orgs()
returns setof uuid language sql stable security definer set search_path = app_private, public as $$
  select o.id from public.organizations o
   where o.kind = 'broker' and not coalesce(o.is_demo, false) and o.status = 'active'
     and app_private.broker_tier(o.id) = 'verified'
     and exists (select 1 from app_private.org_onboarding_items i where i.org_id = o.id and i.item_key = 'bmc84_bond' and i.status = 'verified')
$$;
revoke execute on function app_private.verified_broker_orgs() from public, anon;

select app_private._bl0492_patch('public.cc_shipper_post_load(jsonb)'::regprocedure,
$a$  if v_org is null then raise exception 'not a shipper account' using errcode='42501'; end if;$a$,
$b$  if v_org is null then raise exception 'not a shipper account' using errcode='42501'; end if;
  -- bl_ship_0491: the broker lane opens only when a verified broker exists to receive the tender
  if not exists (select 1 from app_private.verified_broker_orgs()) then
    raise exception 'We are onboarding verified brokers on LoadBoot right now — none is live yet. Post this load to verified carriers instead, or check back in 2–3 days.' using errcode = '22023';
  end if;$b$);

drop function app_private._bl0492_patch(regprocedure, text, text);
