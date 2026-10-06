-- bl_disp_0526 — the "own active load board subscription" reject note contradicts the owner rule.
--
-- Owner rule (21 Sep 2026): a load-board login does NOT have to be in the candidate's own name — an employer's or a
-- carrier's login counts, and a board is only one sourcing route (freight groups, known brokers, direct shippers).
-- The re-application checklist (app/agent/dispatcher-gaps.js) says exactly that. But 35 applicants (21 Sep – 6 Oct)
-- were rejected with one pasted note demanding "their own active load board subscription (DAT, Truckstop or
-- 123Loadboard)", and that note sits on their portal right above the checklist saying the opposite. All 35 are legacy
-- applications (no board_status, no sourcing_channels): the old form only asked about a board in their OWN name, so
-- "that requirement is not met" was never something their answers could show either way.
--
-- This migration:
--   1. keeps every original note in app_private.dispatcher_note_bak_0526 (and in the audit log);
--   2. rewrites the note on the REJECTED rows to wording that matches the rule (no e-mail: review_note is not a
--      trigger column — trg_dispatcher_applied_email fires on status only);
--   3. clears the note on any row that has since moved FORWARD (status is no longer rejected): a "we are not moving
--      forward" note on a candidate in skills_test is simply false. cc_dispatcher_decide keeps the old note when staff
--      advance someone without typing a new one, which is how it stayed.
-- Rows are matched on the exact text (md5), so no other note is touched.
-- CC's reject dialogs now warn before a note that sets the retired rule is sent (noteContradictsBoardRule).

create table if not exists app_private.dispatcher_note_bak_0526 (
  user_id    uuid primary key,
  status     text,
  old_note   text not null,
  new_note   text,
  changed_at timestamptz not null default now()
);
revoke all on table app_private.dispatcher_note_bak_0526 from public, anon, authenticated;

do $$
declare
  v_old_md5 constant text := '70c26a19f6d00fd458788580bed7af97';
  v_new constant text := 'Thank you for applying to LoadBoot Dispatch. For this role we need dispatchers who can find and book loads on their own from the first week. That does not have to be a load board in your own name: a login you use through an employer or a carrier, Facebook or WhatsApp freight groups, brokers you already know or direct shippers all count, as long as you find the load and book it yourself. Your application did not show this, so we are not moving forward at this time. This is not a reflection of your effort. When you re-apply, tick every route you use to find loads and name two loads you booked yourself.';
  r record; v_rewritten int := 0; v_cleared int := 0;
begin
  for r in select d.user_id, d.status, d.full_name, d.review_note from app_private.dispatcher_profiles d
           where md5(d.review_note) = v_old_md5 for update loop
    insert into app_private.dispatcher_note_bak_0526 (user_id, status, old_note, new_note)
      values (r.user_id, r.status, r.review_note, case when r.status = 'rejected' then v_new end)
      on conflict (user_id) do nothing;
    if r.status = 'rejected' then
      update app_private.dispatcher_profiles set review_note = v_new where user_id = r.user_id;
      v_rewritten := v_rewritten + 1;
    else
      update app_private.dispatcher_profiles set review_note = null where user_id = r.user_id;
      v_cleared := v_cleared + 1;
    end if;
    perform app_private.disp_audit('dispatcher.note.board_rule_0526', 'dispatcher', r.user_id::text, null,
      coalesce(r.full_name, 'dispatcher') || ': reject note ' || case when r.status = 'rejected' then 'reworded to the 21 Sep board rule' else 'cleared (candidate moved forward to ' || r.status || ')' end,
      jsonb_build_object('old_note', r.review_note, 'status', r.status));
  end loop;
  raise notice 'bl_disp_0526: % reworded, % cleared', v_rewritten, v_cleared;
end $$;
