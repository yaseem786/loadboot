-- bl_disp_0528 — moving a candidate forward from 'rejected' no longer carries the old reject note.
--
-- cc_dispatcher_decide set review_note = coalesce(p_note, review_note). When staff advanced a rejected candidate
-- (rejected → screening / skills_test / trial …) without typing a new note, the "we are not moving forward" note stayed
-- on their portal next to the new status — the leftover bl_disp_0526 had to clear by hand.
--
-- Now: on rejected → anything else, the old note is archived in app_private.dispatcher_note_archive (a plain insert,
-- not the error-swallowing disp_audit, so the note cannot be lost silently) and review_note becomes p_note (may be
-- null). Every other transition keeps the coalesce behaviour. Anchor-replace of the update's first two lines only;
-- CREATE OR REPLACE keeps the function's ACL, so the anon SECURITY DEFINER baseline does not move.

create table if not exists app_private.dispatcher_note_archive (
  id          bigserial primary key,
  user_id     uuid not null,
  old_status  text not null,
  new_status  text not null,
  action      text not null,
  old_note    text not null,
  archived_by uuid,
  archived_at timestamptz not null default now()
);
create index if not exists dispatcher_note_archive_user_idx on app_private.dispatcher_note_archive (user_id, archived_at desc);
revoke all on table app_private.dispatcher_note_archive from public, anon, authenticated;
revoke all on sequence app_private.dispatcher_note_archive_id_seq from public, anon, authenticated;

do $$
declare
  v_def    text := pg_get_functiondef('public.cc_dispatcher_decide(uuid,text,text)'::regprocedure);
  v_anchor constant text := E'  update app_private.dispatcher_profiles\n     set status = v_new, review_note = coalesce(p_note, review_note),';
  v_repl   constant text := E'  if v_old = \'rejected\' and v_new <> \'rejected\' then -- bl_disp_0528: archive the reject note, do not carry it forward\n'
    || E'    insert into app_private.dispatcher_note_archive (user_id, old_status, new_status, action, old_note, archived_by)\n'
    || E'      select user_id, v_old, v_new, p_action, review_note, auth.uid() from app_private.dispatcher_profiles\n'
    || E'       where user_id = p_user and review_note is not null and review_note is distinct from p_note;\n'
    || E'  end if;\n'
    || E'  update app_private.dispatcher_profiles\n'
    || E'     set status = v_new, review_note = case when v_old = \'rejected\' and v_new <> \'rejected\' then p_note else coalesce(p_note, review_note) end,';
begin
  if (length(v_def) - length(replace(v_def, v_anchor, ''))) / length(v_anchor) <> 1 then
    raise exception 'bl_disp_0528: anchor not found exactly once in cc_dispatcher_decide';
  end if;
  execute replace(v_def, v_anchor, v_repl);
end $$;
