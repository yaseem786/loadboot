-- bl_dmail_0501 — CC → Dispatcher mailboxes: delete a mailbox (29 Sep 2026).
-- Owner: "abdulaziz@ wala user delete kar diya tha — mailbox delete karne ka option bhi ho". Until now a mailbox could only be
-- paused, so a dead one (dispatcher removed, password changed at Namecheap) stayed in the list with "Login failed" forever.
--   * staff only (disp_is_staff), and only a PAUSED mailbox that is assigned to nobody and has no aliases pointing at it;
--   * p_confirm must be the mailbox address (the CC dialog sends it) — a stale id can never delete the wrong mailbox;
--   * removes LoadBoot's copy only: the account row, its synced messages (dmail_messages ON DELETE CASCADE) and its
--     password in Vault. The mailbox itself and its mail stay at Namecheap until someone deletes it there;
--   * audit row written first, with the message count.
-- Anon surface: unchanged (revoked from public, anon; granted to authenticated — the staff check is inside).

create or replace function public.cc_dmail_delete(p_account uuid, p_confirm text)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare a app_private.dmail_accounts; n_msgs int; n_alias int;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error', 'not authorized'); end if;
  select * into a from app_private.dmail_accounts where id = p_account for update;
  if a.id is null then return jsonb_build_object('error', 'Mailbox not found'); end if;
  if lower(btrim(coalesce(p_confirm, ''))) <> a.address then return jsonb_build_object('error', 'Confirmation does not match the mailbox address'); end if;
  if a.status <> 'paused' then return jsonb_build_object('error', 'Pause the mailbox first, then delete it'); end if;
  if a.assigned_to is not null then return jsonb_build_object('error', 'Unassign the dispatcher first'); end if;
  select count(*) into n_alias from app_private.dmail_accounts where parent_id = a.id;
  if n_alias > 0 then return jsonb_build_object('error', 'Delete its ' || n_alias || ' alias mailbox(es) first — they use this mailbox''s login'); end if;
  select count(*) into n_msgs from app_private.dmail_messages where account_id = a.id;
  perform app_private.disp_audit('dmail.delete', 'dmail_account', a.id::text, null, a.address,
    jsonb_build_object('address', a.address, 'display_name', a.display_name, 'messages', n_msgs, 'last_error', a.last_error));
  delete from app_private.dmail_accounts where id = a.id;
  if a.secret_id is not null then
    begin delete from vault.secrets where id = a.secret_id;
    exception when others then raise warning 'bl_dmail_0501: vault secret % not removed: %', a.secret_id, sqlerrm; end;
  end if;
  return jsonb_build_object('ok', true, 'address', a.address, 'messages_removed', n_msgs);
end $$;

revoke execute on function public.cc_dmail_delete(uuid, text) from public, anon;
grant execute on function public.cc_dmail_delete(uuid, text) to authenticated;
