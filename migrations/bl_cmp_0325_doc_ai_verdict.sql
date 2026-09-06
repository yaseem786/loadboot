-- bl_cmp_0325 — persist the upload-time AI document verdict (audit F31, Sprint 2 item 3)
-- 2026-09-05 · Claude · staging first, prod on Yaseen's "go and complete all"
--
-- WHY (prod evidence, 5 Sep)
--   documents.ai_verdict is NULL on 58 of 58 documents in 30 days. The carrier portal DOES run an AI pre-check
--   (edge fn doc-precheck, called from app/carrier/app.js lbAiPrecheck) and shows the carrier a reject modal, but the
--   verdict is never written: app/shared/api.js carrierUploadDocument() inserts {type,file_name,file_path} only.
--   The reviewer therefore never sees what the AI already found (GABE's COI holder problem, for one).
--
-- WHAT THIS DOES (additive)
--   1. BEFORE INSERT trigger documents_ai_verdict_stamp: when the caller is not an admin and ai_verdict is present,
--      stamp recorded_by='carrier-client' + recorded_at=now() INTO the jsonb (overwriting whatever the client claimed),
--      so a client can never pass its verdict off as server-side. Admin/service inserts are left alone.
--   2. RPC public.doc_set_ai_verdict(p_doc uuid, p_verdict jsonb, p_source text default 'carrier-client') returns boolean
--      — owner-or-admin, WRITE-ONCE (only when ai_verdict is null). Owner calls are always stamped 'carrier-client'
--      whatever p_source says; only admin/service_role may set another source (e.g. 'doc-precheck'). Returns false when
--      already set. Grants: authenticated + service_role; revoke anon/public.
--   3. Hygiene: revoke ALL on public.documents from anon (every policy is `to authenticated`; anon had full table +
--      column grants with nothing to use them — defence in depth).
--   No existing row is modified. No column added (ai_verdict jsonb already exists).
--
-- CLIENT SIDE (separate commit, app/shared/api.js + app/carrier/app.js): carrierUploadDocument({…, aiVerdict})
--   passes the precheck verdict in the insert; the 4 lbAiPrecheck call sites hand over pv9.
-- CC SIDE: Document review row shows the verdict pill + first issue, labelled by recorded_by.
--
-- TEST: docs/audit-2026-09/tests/bl_cmp_0325_rollback_test.sql
-- ROLLBACK: drop trigger documents_ai_verdict_stamp on public.documents; drop function public.doc_set_ai_verdict(uuid,jsonb,text);
--           drop function public.tg_documents_ai_verdict_stamp(); (anon grants stay revoked — they were never used)

-- 1. stamp trigger
CREATE OR REPLACE FUNCTION public.tg_documents_ai_verdict_stamp()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if new.ai_verdict is not null and jsonb_typeof(new.ai_verdict) = 'object' and not coalesce(public.is_admin(), false) then
    new.ai_verdict := (new.ai_verdict - 'recorded_by' - 'recorded_at')
                      || jsonb_build_object('recorded_by', 'carrier-client', 'recorded_at', now());
  end if;
  return new;
end $function$;

drop trigger if exists documents_ai_verdict_stamp on public.documents;
create trigger documents_ai_verdict_stamp
  before insert on public.documents
  for each row execute function public.tg_documents_ai_verdict_stamp();

-- 2. write-once RPC
CREATE OR REPLACE FUNCTION public.doc_set_ai_verdict(p_doc uuid, p_verdict jsonb, p_source text DEFAULT 'carrier-client')
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_owner uuid; v_existing jsonb; v_admin boolean; v_source text;
begin
  if p_verdict is null or jsonb_typeof(p_verdict) <> 'object' then
    raise exception 'verdict must be a JSON object' using errcode='22023'; end if;
  select carrier_id, ai_verdict into v_owner, v_existing from public.documents where id = p_doc;
  if v_owner is null then raise exception 'document not found' using errcode='22023'; end if;
  v_admin := coalesce(public.is_admin(), false) or current_setting('request.jwt.claims', true)::jsonb->>'role' = 'service_role';
  if not v_admin and v_owner is distinct from auth.uid() then
    raise exception 'not your document' using errcode='42501'; end if;
  if v_existing is not null then return false; end if;                       -- write-once
  v_source := case when v_admin then coalesce(nullif(trim(p_source),''), 'staff') else 'carrier-client' end;
  update public.documents
     set ai_verdict = (p_verdict - 'recorded_by' - 'recorded_at') || jsonb_build_object('recorded_by', v_source, 'recorded_at', now())
   where id = p_doc and ai_verdict is null;
  return found;
end $function$;

revoke all on function public.doc_set_ai_verdict(uuid, jsonb, text) from public, anon;
grant execute on function public.doc_set_ai_verdict(uuid, jsonb, text) to authenticated, service_role;
revoke all on function public.tg_documents_ai_verdict_stamp() from public, anon, authenticated;

-- 3. hygiene
revoke all on table public.documents from anon;

-- ACL re-check
do $chk$
begin
  if exists (select 1 from information_schema.routine_privileges where specific_schema='public' and routine_name='doc_set_ai_verdict' and grantee in ('anon','PUBLIC')) then
    raise exception 'bl_cmp_0325: anon/PUBLIC can execute doc_set_ai_verdict'; end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema='public' and table_name='documents' and grantee='anon') then
    raise exception 'bl_cmp_0325: anon still has table grants on documents'; end if;
  raise notice 'bl_cmp_0325: ACL ok';
end $chk$;
