-- STAGING ONLY: account deletion prerequisites and narrow correctness fixes.
-- Captured production contracts 2026-09-09; no backfill or live deletion.
-- This does not establish full storage erasure, legal retention or session revocation.
DO $guard$ BEGIN
 IF to_regclass('app_private.account_deletion_requests') IS NOT NULL THEN
  RAISE EXCEPTION 'Deletion table already exists; re-sync before applying';
 END IF;
 IF to_regprocedure('public.cancel_account_deletion()') IS NOT NULL THEN RAISE EXCEPTION 'Deletion RPC already exists; re-sync'; END IF;
 IF to_regprocedure('public.cc_account_deletion_process(bigint,text,text)') IS NOT NULL THEN RAISE EXCEPTION 'Deletion RPC already exists; re-sync'; END IF;
 IF to_regprocedure('public.cc_account_deletion_queue()') IS NOT NULL THEN RAISE EXCEPTION 'Deletion RPC already exists; re-sync'; END IF;
 IF to_regprocedure('public.my_account_deletion_status()') IS NOT NULL THEN RAISE EXCEPTION 'Deletion RPC already exists; re-sync'; END IF;
 IF to_regprocedure('public.request_account_deletion(text)') IS NOT NULL THEN RAISE EXCEPTION 'Deletion RPC already exists; re-sync'; END IF;
END $guard$;
CREATE TABLE app_private.account_deletion_requests (
 id bigserial PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 email text,
 status text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested','cancelled','completed','rejected')),
 reason text,
 requested_at timestamptz NOT NULL DEFAULT now(),
 processed_at timestamptz,
 processed_by uuid,
 note text
);
CREATE UNIQUE INDEX account_deletion_open_uniq ON app_private.account_deletion_requests(user_id) WHERE status='requested';
CREATE INDEX account_deletion_status_idx ON app_private.account_deletion_requests(status,requested_at DESC);
ALTER TABLE app_private.account_deletion_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app_private.account_deletion_requests FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON SEQUENCE app_private.account_deletion_requests_id_seq FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cancel_account_deletion()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
begin
  if auth.uid() is null then raise exception 'not authorized' using errcode='42501'; end if;
  update app_private.account_deletion_requests
     set status='cancelled', processed_at=now(), processed_by=auth.uid()
   where user_id = auth.uid() and status='requested';
  if not found then raise exception 'no open deletion request' using errcode='22023'; end if;
  return jsonb_build_object('ok', true, 'status','cancelled');
end $function$
;
REVOKE ALL ON FUNCTION public.cancel_account_deletion() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cancel_account_deletion() TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.cc_account_deletion_process(p_id bigint, p_action text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
declare r app_private.account_deletion_requests; v_done jsonb := '{}'::jsonb; n int;
begin
  if not (public.has_global_permission('carriers.approve') or public.has_global_permission('finance.approve')) then
    raise exception 'not authorized' using errcode='42501';
  end if;
  if p_action IS NULL OR p_action NOT IN ('reject','complete') then
    raise exception 'unknown action' using errcode='22023';
  end if;
  select * into r from app_private.account_deletion_requests where id = p_id FOR UPDATE;
  if r.id is null then raise exception 'request not found' using errcode='22023'; end if;
  if r.status <> 'requested' then raise exception 'request already %', r.status using errcode='22023'; end if;

  if p_action = 'reject' then
    if coalesce(trim(coalesce(p_note,'')),'') = '' then
      raise exception 'a reason is required to reject' using errcode='22023';
    end if;
    update app_private.account_deletion_requests
       set status='rejected', processed_at=now(), processed_by=auth.uid(), note=p_note where id=p_id;
    return jsonb_build_object('ok', true, 'status','rejected');
  end if;


  -- 1) contact details
  update public.profiles
     set email = 'deleted+' || r.user_id::text || '@deleted.invalid',
         contact_name = null, phone = null, company = 'Deleted account'
   where id = r.user_id;
  get diagnostics n = row_count; v_done := v_done || jsonb_build_object('profile', n);

  -- 2) agent payout + tax + address block (holds IBAN, wallet, DOB, ID doc refs)
  update app_private.agent_profiles
     set full_name='Deleted account', phone=null, street=null, zip=null, city=null,
         state=null, country=null, payout_details='{}'::jsonb, tax_id_last4=null
   where user_id = r.user_id;
  get diagnostics n = row_count; v_done := v_done || jsonb_build_object('agent_profile', n);

  -- 3) banking for every org this user owns
  update app_private.org_payment_profiles p
     set account_number=null, routing_number=null, tax_id=null, swift_bic=null,
         bank_address=null, beneficiary_address=null, remittance_email=null, bank_phone=null
   where exists (select 1 from public.organizations o
                  where o.id = p.org_id and o.owner_user_id = r.user_id);
  get diagnostics n = row_count; v_done := v_done || jsonb_build_object('payment_profiles', n);

  -- 4) document metadata belongs to profiles(id), not organizations(id).
  -- Storage objects and retained transaction records require separate lifecycle handling.
  delete from public.documents d where d.carrier_id = r.user_id;
  get diagnostics n = row_count; v_done := v_done || jsonb_build_object('documents', n);

  -- 5) conversations and messages
  update app_private.lc_conversations set email=null, name=null where user_id = r.user_id;
  get diagnostics n = row_count; v_done := v_done || jsonb_build_object('chats', n);
  delete from app_private.agent_messages where user_id = r.user_id;
  get diagnostics n = row_count; v_done := v_done || jsonb_build_object('agent_messages', n);

  -- 6) marketing/CRM traces + suppress the address so nothing is ever sent again
  begin
    delete from app_private.crm_contacts where lower(email) = lower(coalesce(r.email,''));
    delete from app_private.outreach_contacts where lower(email) = lower(coalesce(r.email,''));
  exception when others then null; end;

  -- 7) close the login. The auth row is kept (not dropped) so the retained financial
  --    records keep a stable foreign key — but it can never be signed into again.
  update auth.users
     set encrypted_password = extensions.crypt(gen_random_uuid()::text, extensions.gen_salt('bf')),
         email = 'deleted+' || r.user_id::text || '@deleted.invalid',
         phone = null, raw_user_meta_data = '{}'::jsonb,
         banned_until = 'infinity', updated_at = now()
   where id = r.user_id;

  update app_private.account_deletion_requests
     set status='completed', processed_at=now(), processed_by=auth.uid(),
         note = coalesce(p_note,'') || ' | erased: ' || v_done::text
   where id = p_id;

  return jsonb_build_object('ok', true, 'status','completed', 'erased', v_done);
end $function$
;
REVOKE ALL ON FUNCTION public.cc_account_deletion_process(bigint,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cc_account_deletion_process(bigint,text,text) TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.cc_account_deletion_queue()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
  select case when public.has_global_permission('carriers.approve')
              or public.has_global_permission('finance.approve')
    then coalesce((select jsonb_agg(jsonb_build_object(
           'id', r.id, 'user_id', r.user_id, 'email', r.email, 'status', r.status,
           'reason', r.reason, 'requested_at', r.requested_at,
           'processed_at', r.processed_at, 'note', r.note,
           'days_open', extract(day from now() - r.requested_at)::int)
         order by r.requested_at)
         from app_private.account_deletion_requests r
         where r.status = 'requested'), '[]'::jsonb)
    else '[]'::jsonb end;
$function$
;
REVOKE ALL ON FUNCTION public.cc_account_deletion_queue() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.cc_account_deletion_queue() TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.my_account_deletion_status()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
  select coalesce(
    (select jsonb_build_object('status', r.status, 'requested_at', r.requested_at, 'id', r.id)
       from app_private.account_deletion_requests r
      where r.user_id = auth.uid() and r.status = 'requested'
      order by r.requested_at desc limit 1),
    jsonb_build_object('status','none'));
$function$
;
REVOKE ALL ON FUNCTION public.my_account_deletion_status() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.my_account_deletion_status() TO authenticated,service_role;

CREATE OR REPLACE FUNCTION public.request_account_deletion(p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
declare v_email text; v_name text; v_id bigint;
begin
  if auth.uid() is null then raise exception 'not authorized' using errcode='42501'; end if;
  select email into v_email from auth.users where id = auth.uid();
  select coalesce(nullif(contact_name,''), split_part(coalesce(v_email,''),'@',1))
    into v_name from public.profiles where id = auth.uid();

  insert into app_private.account_deletion_requests (user_id, email, reason)
  values (auth.uid(), v_email, nullif(trim(coalesce(p_reason,'')),''))
  on conflict (user_id) where status = 'requested' do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from app_private.account_deletion_requests
     where user_id = auth.uid() and status = 'requested';
    return jsonb_build_object('ok', true, 'already_open', true, 'id', v_id);
  end if;

  begin
    insert into app_private.notifications(recipient_role, channel, template_key, payload)
    values ('staff','in_app','account.deletion_requested', jsonb_build_object(
      'title','🗑 Account deletion requested',
      'body', coalesce(v_email,'A user') || ' asked for their account and personal data to be deleted. Complete within 30 days.',
      'url','/automation'));
  exception when others then null; end;

  begin
    if v_email is not null then
      perform app_private.sys_email(v_email, 'account.deletion_requested',
        'We received your account deletion request',
        '<p style="font-size:16px;line-height:1.6;margin:0 0 16px;">Hi ' || coalesce(v_name,'there') || ',</p>'
        || '<p style="font-size:16px;line-height:1.6;margin:0 0 16px;">We have received your request to delete your LoadBoot account and personal data. Nothing else is needed from you.</p>'
        || '<p style="font-size:16px;line-height:1.6;margin:0 0 16px;"><strong>What happens next.</strong> A person reviews the request and completes it within <strong>30 days</strong>. We erase your profile, contact details, uploaded documents, banking details and location history. Records that United States law requires us to keep &mdash; delivered load paperwork for three years, invoices and settlements for seven &mdash; are retained with your personal details stripped out of them.</p>'
        || '<p style="font-size:16px;line-height:1.6;margin:0 0 16px;">Changed your mind? You can cancel from your portal, or just reply to this email, any time before it is completed.</p>'
        || '<p style="margin:0 0 16px;"><a href="https://loadboot.com/delete-account.html" style="display:inline-block;background:#1d4ed8;border-radius:8px;padding:12px 24px;text-decoration:none;"><span style="color:#ffffff !important;font-size:16px;font-weight:bold;">Read what gets deleted</span></a></p>'
        || '<p style="font-size:16px;line-height:1.6;margin:0;">Riley<br>Support, LoadBoot<br><a href="https://loadboot.com" style="color:#1d4ed8;"><span style="color:#1d4ed8 !important;">loadboot.com</span></a> &middot; +1 (469) 253-7575</p>',
        null, 'accountdel:' || auth.uid()::text || ':' || v_id::text);
    end if;
  exception when others then null; end;

  return jsonb_build_object('ok', true, 'id', v_id, 'status', 'requested');
end $function$
;
REVOKE ALL ON FUNCTION public.request_account_deletion(text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.request_account_deletion(text) TO authenticated,service_role;

