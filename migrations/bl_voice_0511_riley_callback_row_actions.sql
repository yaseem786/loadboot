-- bl_voice_0511 — CC → Riley → WhatsApp line → "Open callbacks from the line": each row can now be acted on.
--
-- Before: a row showed who/why/note and a bare "Done" button — no way to call from it, no way to hear what
-- Riley promised, and Done recorded nothing about what happened. The UI now adds Call / WhatsApp, an
-- "Open call" link (recording + transcript) and an outcome note on Done (appended to the row's note by the
-- client; cc_riley_callback_done already takes p_note).
--
-- The only DB change: cc_riley_calls.wa_callbacks carries lc_call_id so the screen can open the Riley call a
-- callback came from (reason 'riley' rows always have it — 0506's idempotency key). Patched by anchor, not
-- retyped; CREATE OR REPLACE keeps the existing ACL. Read-only RPC; anon SECDEF surface unchanged.

do $$
declare
  d text;
  a text := $a$'contact_name', k.contact_name, 'note', k.note)$a$;
begin
  select pg_get_functiondef('public.cc_riley_calls(integer)'::regprocedure) into d;
  if position('''lc_call_id'', k.lc_call_id' in d) > 0 then return; end if;   -- already applied
  if position(a in d) = 0 then raise exception 'bl_voice_0511: anchor not found in cc_riley_calls'; end if;
  execute replace(d, a, $b$'contact_name', k.contact_name, 'note', k.note, 'lc_call_id', k.lc_call_id)$b$);
end $$;
