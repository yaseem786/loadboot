-- bl_doc_0539c — item O.5: CC "Move to correct slot" (cc_reclassify_document) cleans up the slot it leaves and can
-- restore a superseded document
-- 2026-10-11 · Claude · staging first; prod copy in migrations/PROD-bl_doc_0539.sql (owner says "laga do")
--
-- WHY (prod, read-only, 11 Oct — carrier a77f8156…, 10 Oct)
--   cc_reclassify_document only changed documents.type and pointed the NEW requirement at the file. The requirement
--   it LEFT still pointed at the moved file, and the document that upload had superseded stayed superseded: the real
--   bank check b1705893 is still 'superseded' after the COI that pushed it out was moved to insurance; COI ea335508
--   (moved out of the authority slot) is 'pending' with no requirement pointing at it. The function also overwrote a
--   VALID requirement in the target slot with 'pending'. It is in no migration file (applied from a session); staging
--   and prod bodies differ only in a nested declare — this file replaces both with one definition.
--
-- WHAT THIS DOES — public.cc_reclassify_document(p_doc uuid, p_type text) returns jsonb (same signature, same grants)
--   - same permission gate (documents.review | compliance.verify | carriers.manage) and type check
--   - p_type = current type and the document is 'superseded' → RESTORE: back to 'pending' and the requirement points at
--     it again (unless an approved document satisfies it). Any other same-type call is a no-op.
--   - moving: an 'approved' or 'superseded' document goes back to 'pending' (it was approved/judged as something else).
--   - the slot it leaves: if that requirement pointed at this document, it is handed back to the document this one
--     superseded (restored to 'pending'), else to the newest other live document of that type, else 'missing'.
--   - the slot it enters: a 'valid' requirement is left alone (this file waits as a replacement); otherwise 'pending'
--     pointing at this document. Nothing is superseded by a reclassify.
--   - audit: document.reclassify with from/to/restored/left_slot in the detail.
--
-- ROLLBACK: re-create the previous body — prod's definition is quoted verbatim in claude/O-WRONG-SLOT-0539.md.

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
