-- bl_wa_0488 — staff opening an ownerless (Command Center) WhatsApp chat clears its unread count on the server.
--
-- WHY: wa_thread only marked messages read when the OWNER opened the chat. Threads with no owner (the ones
-- Command Center handles) had nobody who could ever clear them, so the unread badge came back on every
-- refresh even after staff had read the chat (the client-side fix in bl_wa_0475 only hid it locally).
--
-- WHAT: in public.wa_thread, the mark-read branch now also runs when the thread has no owner and the viewer
-- is staff. A staff member opening a DISPATCHER's chat still does not clear it — that badge is the
-- dispatcher's. Side effect, accepted: an ownerless chat that staff has read shows no unread count in the
-- dispatchers' "available" list either (someone at LoadBoot has read it).
--
-- Patched by ANCHOR on the live definition, not retyped; fails if the anchor is missing. No new function,
-- no grant change — the anon SECDEF surface is untouched.

do $mig$
declare d text; n text;
begin
  d := pg_get_functiondef('public.wa_thread(uuid, timestamptz)'::regprocedure);
  n := replace(d, 'if t.owner_user_id = v_uid then',
                  'if t.owner_user_id = v_uid or (t.owner_user_id is null and v_role = ''staff'') then');
  if n = d then raise exception 'bl_wa_0488: wa_thread anchor not found'; end if;
  execute n;
end $mig$;
