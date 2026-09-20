-- Rollback for bl_audit_0357. Restores cc_account_deletion_process to md5 bc38da2b07e0606095b291df91041eb6 (guarded). Touches no data.
-- ORDER: Codex's ROLLBACK-ERASURE-PROMOTION-2026-09-15.sql checks that OLD processor hash - run THIS file first if it is ever needed.
do $m$
declare d text; n text;
  add constant text := E'  -- 7b) bl_audit_0357: kill every live session + refresh token for this user now.\n  delete from auth.refresh_tokens where user_id = r.user_id::text;\n  delete from auth.sessions where user_id = r.user_id;\n';
begin
  d := pg_get_functiondef('public.cc_account_deletion_process(bigint,text,text)'::regprocedure);
  if md5(d) <> '3037026e0b305560166be98f5a90e789' then raise exception 'rollback 0357: not the 0357 body (md5 %)', md5(d); end if;
  n := replace(d, add, '');
  execute n;
  if md5(pg_get_functiondef('public.cc_account_deletion_process(bigint,text,text)'::regprocedure)) <> 'bc38da2b07e0606095b291df91041eb6' then
    raise exception 'rollback 0357: restored body does not match the pre-0357 hash';
  end if;
end $m$;
