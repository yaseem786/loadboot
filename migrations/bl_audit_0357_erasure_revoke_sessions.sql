-- bl_audit_0357 — ERASURE gate: revoke every login session when an account deletion COMPLETES.
-- Before: the processor scrambled the password and set banned_until = infinity, but left auth.sessions / auth.refresh_tokens
-- in place, so an already-open app kept a usable refresh path until the next ban check and the rows themselves outlived the account.
-- After: on completion the user's sessions and refresh tokens are removed in the same transaction.
-- Limit (honest): an access JWT already issued stays cryptographically valid until it expires (Supabase default <= 1 hour);
-- Postgres cannot recall it. Sensitive RPCs are covered by the separate session guards (Codex, 14-15 Sep).
-- Runs only inside cc_account_deletion_process(...,'complete') for the ONE user being erased. md5-guarded patch of the live body.
do $m$
declare d text; n text;
  anchor constant text := E'banned_until = ''infinity'', updated_at = now()\n   where id = r.user_id;\n';
  add constant text := E'  -- 7b) bl_audit_0357: kill every live session + refresh token for this user now.\n  delete from auth.refresh_tokens where user_id = r.user_id::text;\n  delete from auth.sessions where user_id = r.user_id;\n';
begin
  d := pg_get_functiondef('public.cc_account_deletion_process(bigint,text,text)'::regprocedure);
  if md5(d) <> 'bc38da2b07e0606095b291df91041eb6' then
    raise exception 'bl_audit_0357: processor baseline moved (md5 %), refusing to patch', md5(d);
  end if;
  if (length(d)-length(replace(d,anchor,'')))/length(anchor) <> 1 then
    raise exception 'bl_audit_0357: anchor count differs from the reviewed source';
  end if;
  n := replace(d, anchor, anchor || add);
  execute n;
end $m$;
