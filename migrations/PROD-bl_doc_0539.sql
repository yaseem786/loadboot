-- PROD — bl_doc_0539 / 0539b / 0539c (item O: wrong-slot uploads) — APPLIED on prod 13 Oct 2026 (3 SQL blocks + doc-precheck v6 = prod version 11)
-- Project: rwscphuhpjoudvljvmdk. Apply through a Claude session with the Supabase MCP (apply_migration), one block per
-- migration name below — not the browser SQL editor (it mis-splits long plpgsql).
--
-- ORDER (matters):
--   1. these three SQL blocks (doc_set_ai_verdict, upload trigger + admin_review_document patch, cc_reclassify_document)
--   2. deploy edge function doc-precheck from supabase/functions/doc-precheck/index.ts (v6) to prod
--      — BEFORE the frontend: the new portal sends slot/detect_only, which the old function ignores (it would run the
--        strict generic check on a bank check and could show a reject modal)
--   3. merge the branch to main (Netlify deploys the portal + CC)
-- AFTER: anon SECDEF must still read 36 with the baseline names (no new public functions here).
--   select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
--    where n.nspname='public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');
-- All three are additive/replace-only: no table change, no data change.

-- ===================================================================== migration name: bl_doc_0539_precheck_failed_state
CREATE OR REPLACE FUNCTION public.doc_set_ai_verdict(p_doc uuid, p_verdict jsonb, p_source text DEFAULT 'carrier-client')
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_owner uuid; v_existing jsonb; v_staff boolean; v_source text;
begin
  if p_verdict is null or jsonb_typeof(p_verdict) <> 'object' then
    raise exception 'verdict must be a JSON object' using errcode='22023'; end if;
  select carrier_id, ai_verdict into v_owner, v_existing from public.documents where id = p_doc;
  if v_owner is null then raise exception 'document not found' using errcode='22023'; end if;
  v_staff := coalesce(public.is_admin(), false)
          or coalesce(public.has_global_permission('documents.review'), false)
          or coalesce(public.has_global_permission('compliance.verify'), false)
          or coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role', '') = 'service_role';
  if not v_staff and v_owner is distinct from auth.uid() then
    raise exception 'not your document' using errcode='42501'; end if;
  -- write-once for a verdict the AI actually produced; a failed / never-run check may be replaced
  if v_existing is not null and coalesce(v_existing->>'verdict', '') in ('pass', 'warning', 'reject') then return false; end if;
  v_source := case when v_staff then coalesce(nullif(trim(p_source), ''), 'staff-rerun') else 'carrier-client' end;
  update public.documents
     set ai_verdict = (p_verdict - 'recorded_by' - 'recorded_at')
                      || jsonb_build_object('recorded_by', v_source, 'recorded_at', now())
                      || case when v_existing is not null then jsonb_build_object('replaced', v_existing->>'verdict') else '{}'::jsonb end
   where id = p_doc and ai_verdict is not distinct from v_existing;
  return found;
end $function$;

revoke all on function public.doc_set_ai_verdict(uuid, jsonb, text) from public, anon;
grant execute on function public.doc_set_ai_verdict(uuid, jsonb, text) to authenticated, service_role;

do $chk$
begin
  if exists (select 1 from information_schema.routine_privileges where specific_schema='public' and routine_name='doc_set_ai_verdict' and grantee in ('anon','PUBLIC')) then
    raise exception 'bl_doc_0539: anon/PUBLIC can execute doc_set_ai_verdict'; end if;
end $chk$;

-- ===================================================================== migration name: bl_doc_0539b_no_silent_supersede
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

-- ===================================================================== migration name: bl_doc_0539c_reclassify_restore
CREATE OR REPLACE FUNCTION public.cc_reclassify_document(p_doc uuid, p_type text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'app_private', 'public'
AS $function$
declare d public.documents; v_old text; v_key text; v_old_key text; v_org uuid; v_restored uuid; v_restored_status text;
        v_left text; v_cur_status text; v_cur_doc uuid; v_pick record;
begin
  if not (public.has_global_permission('documents.review') or public.has_global_permission('compliance.verify')
          or public.has_global_permission('carriers.manage')) then
    raise exception 'not authorized' using errcode='42501';
  end if;
  select * into d from public.documents where id = p_doc;
  if d.id is null then raise exception 'document not found' using errcode='22023'; end if;
  if not exists (select 1 from app_private.compliance_requirements r where r.active and r.doc_type = p_type)
     and p_type not in ('rate_con','bol','pod','agreement','other','noa') then
    raise exception 'invalid document type: %', p_type using errcode='22023';
  end if;
  v_old := d.type;
  if p_type = v_old and d.status is distinct from 'superseded' then
    return jsonb_build_object('id', p_doc, 'from', v_old, 'to', p_type, 'noop', true);
  end if;

  select o.id into v_org from public.organizations o where o.kind='carrier' and o.owner_user_id = d.carrier_id limit 1;
  if v_org is null then
    select m.org_id into v_org from public.organization_memberships m
      join public.organizations o on o.id = m.org_id and o.kind='carrier'
     where m.user_id = d.carrier_id limit 1;
  end if;
  select key into v_key from app_private.compliance_requirements
   where active and doc_type = (case when p_type = 'agreement' then 'dispatch_agreement' else p_type end) limit 1;
  select key into v_old_key from app_private.compliance_requirements
   where active and doc_type = (case when v_old = 'agreement' then 'dispatch_agreement' else v_old end) limit 1;

  -- the document itself: a moved (or restored) file is judged again in its new slot
  update public.documents
     set type = p_type,
         status = case when status in ('approved','superseded') then 'pending' else status end,
         review_note = case when status in ('approved','superseded')
                            then concat_ws(' · ', nullif(review_note, ''), 'Moved from ' || v_old || ' by staff — needs review as ' || p_type)
                            else review_note end
   where id = p_doc;

  -- the slot it leaves: hand the requirement back if it pointed at this file
  if p_type <> v_old and v_old_key is not null and v_org is not null then
    select status, document_id into v_cur_status, v_cur_doc from app_private.carrier_compliance
     where carrier_id = v_org and requirement_key = v_old_key;
    if v_cur_doc = p_doc then
      -- 1st choice: the file this upload superseded (newest superseded one of the old type, uploaded before it)
      select id, status into v_pick from public.documents
       where carrier_id = d.carrier_id and type = v_old and id <> p_doc and status = 'superseded' and created_at <= d.created_at
       order by created_at desc limit 1;
      if v_pick.id is null then
        -- 2nd: the newest other live document of the old type
        select id, status into v_pick from public.documents
         where carrier_id = d.carrier_id and type = v_old and id <> p_doc and status in ('approved','pending','rejected')
         order by (status = 'approved') desc, created_at desc limit 1;
      end if;
      if v_pick.id is not null then
        if v_pick.status = 'superseded' then
          update public.documents set status = 'pending' where id = v_pick.id;
          v_restored := v_pick.id; v_restored_status := 'pending';
        else v_restored_status := v_pick.status; end if;
        update app_private.carrier_compliance
           set document_id = v_pick.id,
               status = case v_pick.status when 'approved' then 'valid' when 'rejected' then 'rejected' else 'pending' end,
               note = 'A misfiled document was moved out by staff — ' || case when v_pick.status = 'superseded'
                        then 'the earlier file is back in review' else 'pointing at the earlier file' end,
               updated_at = now()
         where carrier_id = v_org and requirement_key = v_old_key;
        v_left := 'handed back';
      else
        update app_private.carrier_compliance
           set document_id = null, status = 'missing', note = 'A misfiled document was moved out by staff — nothing on file', updated_at = now()
         where carrier_id = v_org and requirement_key = v_old_key;
        v_left := 'missing';
      end if;
    end if;
  end if;

  -- the slot it enters (or is restored into): never knock out an approved document
  if v_key is not null and v_org is not null then
    select status, document_id into v_cur_status, v_cur_doc from app_private.carrier_compliance
     where carrier_id = v_org and requirement_key = v_key;
    if v_cur_status = 'valid' and v_cur_doc is distinct from p_doc then
      null;  -- an approved document satisfies it; this file waits in the queue as a replacement
    else
      insert into app_private.carrier_compliance (carrier_id, requirement_key, status, document_id, note, updated_at)
        values (v_org, v_key, 'pending', d.id, case when p_type = v_old then 'Restored by staff — awaiting review'
                                                    else 'Reclassified by staff — awaiting review' end, now())
      on conflict (carrier_id, requirement_key) do update
        set status = 'pending', document_id = excluded.document_id, note = excluded.note, updated_at = now();
    end if;
  end if;

  perform app_private.log_audit('document.reclassify','document',p_doc::text,v_org,
    case when p_type = v_old then format('restored %s', p_type) else format('%s -> %s', v_old, p_type) end,
    jsonb_build_object('from', v_old, 'to', p_type, 'prev_status', d.status, 'left_slot', v_left, 'restored', v_restored));
  return jsonb_build_object('id', p_doc, 'from', v_old, 'to', p_type, 'requirement', v_key,
                            'left_slot', v_left, 'restored', v_restored, 'restored_status', v_restored_status);
end; $function$;

revoke all on function public.cc_reclassify_document(uuid, text) from public, anon;
grant execute on function public.cc_reclassify_document(uuid, text) to authenticated, service_role;

do $chk$
begin
  if exists (select 1 from information_schema.routine_privileges where specific_schema='public' and routine_name='cc_reclassify_document' and grantee in ('anon','PUBLIC')) then
    raise exception 'bl_doc_0539c: anon/PUBLIC can execute cc_reclassify_document'; end if;
end $chk$;

