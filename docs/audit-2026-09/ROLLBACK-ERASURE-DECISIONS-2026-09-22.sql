-- Rollback for bl_audit_0365 (staging). Restores the processor gate to the 0364 body (md5 1fb9c012cc900cf21e4420dda2bf7ef3),
-- then drops the four functions and the decisions table. Guarded: refuses if any decision row has removal evidence (evidence is kept).
do $m$ declare d text; n text;
  old_gate constant text := E'  n := app_private.capture_account_erasure_inventory(p_id);\n  if n > 0 then\n    return jsonb_build_object(''ok'',false,''status'',''requested'',''code'',''ERASURE_REVIEW_REQUIRED'',\n      ''error'',''File review is required before account deletion can be completed.'',''file_references'',n);\n  end if;\n';
  a int; b int;
begin
  if exists (select 1 from app_private.erasure_item_decisions where removed_at is not null and removal_result = 'removed') then
    raise exception 'rollback 0365: removal evidence exists — export it before rolling back'; end if;
  d := pg_get_functiondef('public.cc_account_deletion_process(bigint,text,text)'::regprocedure);
  a := position('  n := app_private.capture_account_erasure_inventory(p_id);' in d);
  b := position(E'  -- 1) contact details' in d);
  if a = 0 or b = 0 or b < a then raise exception 'rollback 0365: gate block not found'; end if;
  n := substr(d,1,a-1) || old_gate || E'\n' || substr(d,b); execute n;
  if md5(pg_get_functiondef('public.cc_account_deletion_process(bigint,text,text)'::regprocedure)) <> '1fb9c012cc900cf21e4420dda2bf7ef3' then
    raise exception 'rollback 0365: restored body does not match the 0364 hash'; end if;
end $m$;
drop function if exists public.cc_erasure_items(bigint);
drop function if exists public.cc_erasure_decide(bigint, text, text, text, date, text);
drop function if exists public.erasure_removal_candidates(bigint);
drop function if exists public.erasure_removal_mark(bigint, text, text);
drop table if exists app_private.erasure_item_decisions;
