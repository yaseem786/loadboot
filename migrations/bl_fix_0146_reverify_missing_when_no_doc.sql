-- bl_fix_0146 — Re-verify flag showed "Pending" even when NO document was on file.
-- Bug: cc_carrier_request_reverify blindly set status='pending' when a carrier changed a
--   verified business detail (MC/DOT/entity). With no document attached, BOTH the CC and
--   the carrier portal showed "Pending" — staff thought it awaited review, the carrier
--   thought it was submitted, and nobody acted (found on WARREN'S COURIER AGENCY).
-- Fix: status = 'pending' only when a document is on file to re-review; otherwise
--   'missing' (carrier must upload). Additive & reversible. STAGING then PROD.
create or replace function public.cc_carrier_request_reverify(p_requirement text, p_reason text default null)
returns text language plpgsql security definer set search_path to 'app_private, public' as $function$
declare v_org uuid; v_req app_private.compliance_requirements; v_new text;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'not a carrier account' using errcode='42501'; end if;
  select * into v_req from app_private.compliance_requirements where key = p_requirement and active;
  if v_req.key is null then raise exception 'unknown requirement' using errcode='22023'; end if;
  -- pending only makes sense when there is a document to re-review; otherwise it's missing
  select case when exists (
      select 1 from app_private.carrier_compliance c
      where c.carrier_id = v_org and c.requirement_key = p_requirement and c.document_id is not null)
    then 'pending' else 'missing' end into v_new;
  insert into app_private.carrier_compliance(carrier_id, requirement_key, status, note, updated_at)
    values (v_org, p_requirement, v_new, coalesce(p_reason,'carrier changed a verified detail'), now())
  on conflict (carrier_id, requirement_key) do update
    set status = case when app_private.carrier_compliance.document_id is not null then 'pending' else 'missing' end,
        note = coalesce(excluded.note, app_private.carrier_compliance.note), updated_at = now();
  perform app_private.log_audit('compliance.reverify_requested','carrier', v_org::text, null,
     format('carrier changed %s -> re-review requested', p_requirement),
     jsonb_build_object('requirement', p_requirement, 'reason', p_reason));
  perform app_private.emit_event('compliance.reverify_requested','carrier', v_org::text,
     jsonb_build_object('requirement', p_requirement, 'reason', p_reason));
  return v_new;
end; $function$;

-- Data fix: any existing doc-less 'pending' reverify rows -> 'missing'
update app_private.carrier_compliance
   set status = 'missing', updated_at = now()
 where status = 'pending' and document_id is null
   and note ilike '%business detail changed%';
