-- bl_doc_0539 — item O.1: an AI pre-check that did not run is recorded as FAILED, and staff can re-run it
-- 2026-10-11 · Claude · staging first; prod copy in migrations/PROD-bl_doc_0539.sql (owner says "laga do")
--
-- WHY (prod, read-only, 11 Oct)
--   documents.ai_verdict: 6 of 85 documents in 45 days. The portal only began saving the verdict on 30 Sep (5167ce4),
--   and since then ~28 uploads went to a checked slot (insurance/authority/w9/noa) — 4 real verdicts, 2 "queued".
--   Edge logs, 10 Oct: three doc-precheck POSTs booted at 17:01:14 / 17:02:03 / 17:02:53 and never logged a response;
--   the documents were inserted at 17:01:59 / 17:02:49 / 17:03:39 — exactly the portal's 45 s abort, after which
--   lbAiPrecheck returned null and the upload carried no verdict. Successful calls took 11–35 s (gemini-2.5-flash
--   thinking by default; a fresh worker per request, so the model cache never sticks). The two "queued" rows were
--   truncated JSON reported as ai:true, and CC painted "QUEUED" green. Two upload paths (reinstatement attach,
--   dashboard NOA card) never called the check at all (9 Oct 19:54 NOA — no call in the logs).
--
-- WHAT THIS DOES
--   doc_set_ai_verdict: still write-once for a REAL verdict (pass|warning|reject). A row whose verdict is missing,
--   'unchecked' or 'queued' (= no check ran) may now be replaced — that is what CC → Documents "Run AI check" does.
--   Staff with documents.review / compliance.verify may record (was is_admin() only), stamped 'staff-rerun'.
--   The carrier-owner path is unchanged (own document, stamped 'carrier-client').
--   No table change, no data change. Existing 'queued' rows are shown by CC as "AI check failed" (client side).
--
-- ROLLBACK: re-apply public.doc_set_ai_verdict from migrations/bl_cmp_0325_doc_ai_verdict.sql.

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
