-- bl_doc_0539b — item O.4: a new upload never silently replaces an approved document, nor supersedes the previous file
-- when the new one is (probably) a different kind of document
-- 2026-10-11 · Claude · staging first; prod copy in migrations/PROD-bl_doc_0539.sql (owner says "laga do")
--
-- WHY (prod, read-only, 11 Oct — carrier a77f8156…, 10 Oct)
--   17:26:48 a bank check (b1705893) was uploaded to the bank slot; 14 s later a COI (d4e5d6cd) went into the SAME
--   bank slot. app_private.sync_doc_upload_compliance (AFTER INSERT on documents) moved bank_verification to the COI
--   and set the real bank check to 'superseded' — silently. Staff later reclassified the COI to insurance; the bank
--   check stayed superseded. The same trigger also flips a VALID requirement back to 'pending' on any new upload, and
--   admin_review_document, on REJECTING the newcomer, overwrote a still-valid requirement with 'rejected'.
--
-- WHAT THIS DOES
--   1. sync_doc_upload_compliance:
--      - requirement currently 'valid' (an approved document on file) → the row is NOT touched (status, document_id
--        stay); the new upload waits in the review queue as a replacement, and only its approval moves the pointer.
--      - the new row's ai_verdict says it is probably a different kind (wrong_slot, or the carrier kept a file whose
--        NAME names another document: name_kept) → the previous document is NOT superseded; when the previous one is
--        still pending, the requirement keeps pointing at it.
--      - otherwise unchanged (pending → new doc, previous pending/rejected doc superseded).
--   2. admin_review_document (anchor patch): a REJECT of a document that is not the one a 'valid' requirement points
--      at leaves that requirement valid (the approved document is still the one on file).
--   No table change, no data change, no grant change.
--
-- ROLLBACK: re-apply the previous definitions (sync: staging = prod md5 aac7b3b5…; admin_review_document: remove the
--           "where not (…)" clause this file adds).

CREATE OR REPLACE FUNCTION app_private.sync_doc_upload_compliance()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'app_private', 'public'
AS $function$
declare v_key text; v_name text; v_org uuid; v_prev text; v_prev_doc uuid; v_type text; v_suspect boolean; v_prev_doc_status text;
begin
  v_type := case when new.type = 'agreement' then 'dispatch_agreement' else new.type end;
  select key, name into v_key, v_name from app_private.compliance_requirements where doc_type = v_type and active limit 1;
  if v_key is null then return new; end if;
  select o.id into v_org from public.organizations o where o.kind = 'carrier' and o.owner_user_id = new.carrier_id limit 1;
  if v_org is null then
    select m.org_id into v_org from public.organization_memberships m
      join public.organizations o on o.id = m.org_id and o.kind = 'carrier'
     where m.user_id = new.carrier_id limit 1;
  end if;
  if v_org is null then return new; end if;
  select status, document_id into v_prev, v_prev_doc from app_private.carrier_compliance where carrier_id = v_org and requirement_key = v_key;
  -- bl_doc_0539b: the pre-check (carrier portal) says this file is probably another kind of document
  v_suspect := jsonb_typeof(new.ai_verdict) = 'object'
               and (coalesce(new.ai_verdict->>'wrong_slot', '') = 'true' or coalesce(new.ai_verdict->>'name_kept', '') = 'true');
  if v_prev_doc is not null then select status into v_prev_doc_status from public.documents where id = v_prev_doc; end if;
  if v_prev = 'valid' and v_prev_doc is not null and v_prev_doc <> new.id then
    -- an approved document is on file: the newcomer is a replacement candidate, nothing changes until it is approved
    null;
  elsif v_suspect and v_prev_doc is not null and v_prev_doc <> new.id and v_prev_doc_status = 'pending' then
    -- probably the wrong kind of file: keep the requirement on the pending document already in review
    update app_private.carrier_compliance
       set note = 'Another upload arrived that may be a different document — check the review queue', updated_at = now()
     where carrier_id = v_org and requirement_key = v_key;
  else
    insert into app_private.carrier_compliance (carrier_id, requirement_key, status, document_id, note, updated_at)
      values (v_org, v_key, 'pending', new.id, 'Uploaded — awaiting review', now())
    on conflict (carrier_id, requirement_key) do update
      set status = 'pending', document_id = excluded.document_id,
          note = 'Uploaded — awaiting review (replaced previous file)', updated_at = now();
    if v_prev_doc is not null and v_prev_doc <> new.id and not v_suspect then
      update public.documents set status = 'superseded' where id = v_prev_doc and status in ('pending','rejected');
    end if;
  end if;
  begin
    insert into app_private.notifications(recipient_user, channel, template_key, payload)
    values (new.carrier_id, 'in_app', 'document.received',
      jsonb_build_object(
        'title', '✓ ' || coalesce(v_name, 'Document') || ' received',
        'body', case when v_prev = 'valid'
                     then 'Your new file is in review. The approved one stays active until the new one is approved.'
                     when v_prev in ('rejected','expired')
                     then 'Your corrected document is back in the review queue — we will notify you as soon as it is decided.'
                     else 'Uploaded successfully — awaiting review.' end,
        'tone', 'success', 'url', '/app/carrier/#documents'));
  exception when others then null; end;
  return new;
end; $function$;

-- 2. admin_review_document: anchor patch (staging and prod bodies differ elsewhere; the anchor line is identical)
do $patch$
declare v_def text; v_old text := '      document_id = excluded.document_id, verified_by = excluded.verified_by, verified_at = now(), note = excluded.note, updated_at = now();';
        v_new text := '      document_id = excluded.document_id, verified_by = excluded.verified_by, verified_at = now(), note = excluded.note, updated_at = now()
      -- bl_doc_0539b: rejecting a replacement must not overwrite a requirement that an approved document still satisfies
      where not (excluded.status = ''rejected'' and app_private.carrier_compliance.status = ''valid''
                 and app_private.carrier_compliance.document_id is distinct from excluded.document_id);';
begin
  v_def := pg_get_functiondef('public.admin_review_document(uuid,text,text)'::regprocedure);
  if position('bl_doc_0539b' in v_def) > 0 then raise notice 'admin_review_document already patched'; return; end if;
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception 'bl_doc_0539b: anchor not found exactly once in admin_review_document'; end if;
  execute replace(v_def, v_old, v_new);
end $patch$;

do $chk$
begin
  if position('bl_doc_0539b' in pg_get_functiondef('public.admin_review_document(uuid,text,text)'::regprocedure)) = 0 then
    raise exception 'bl_doc_0539b: admin_review_document patch missing'; end if;
  if exists (select 1 from information_schema.routine_privileges where specific_schema='public' and routine_name='admin_review_document' and grantee in ('anon','PUBLIC')) then
    raise exception 'bl_doc_0539b: anon/PUBLIC can execute admin_review_document'; end if;
end $chk$;
