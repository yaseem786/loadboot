-- bl_dmail_0357 — Dispatcher Mailbox, owner decisions 20 Sep 2026:
--   1. A DISPATCHER CAN NEVER DELETE MAIL. Only staff can move to Trash or delete forever. dmail_bootstrap now tells the
--      UI (can_delete) and the dmail edge function enforces it (it refuses move→trash / delete unless dmail_access says staff).
--   2. The Command Center sees EVERYTHING: cc_dmail_activity = one feed of every email received / sent / replied across all
--      dispatcher mailboxes, with the mailbox, who it is assigned to, and who pressed Send.
-- Additive. Authenticated-only; nothing granted to anon.

create or replace function public.dmail_bootstrap(p_account uuid default null) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare a app_private.dmail_accounts; v_staff boolean := app_private.disp_is_staff();
begin
  if auth.uid() is null then return jsonb_build_object('error','not signed in'); end if;
  if p_account is not null and v_staff then select * into a from dmail_accounts where id = p_account;
  else select * into a from dmail_accounts where assigned_to = auth.uid(); end if;
  if a.id is null then return jsonb_build_object('enabled', false, 'reason', 'no_mailbox'); end if;
  if not app_private.dmail_can(a.id) then return jsonb_build_object('enabled', false, 'reason', case when a.status = 'paused' then 'paused' else 'not_active' end); end if;
  return jsonb_build_object('enabled', true, 'staff_view', v_staff and a.assigned_to is distinct from auth.uid(), 'can_delete', v_staff,
    'account', jsonb_build_object('id', a.id, 'address', a.address, 'display_name', a.display_name, 'signature_html', a.signature_html,
      'status', a.status, 'last_sync_at', a.last_sync_at, 'sync_problem', a.status = 'error',
      'assigned_name', (select full_name from dispatcher_profiles where user_id = a.assigned_to)),
    'counts', app_private.dmail_counts(a.id));
end $$;

create or replace function public.cc_dmail_activity(p jsonb) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_acc uuid := nullif(p->>'account','')::uuid; v_dir text := nullif(p->>'dir',''); v_q text := nullif(btrim(coalesce(p->>'q','')),'');
  v_before timestamptz := nullif(p->>'before','')::timestamptz; v_limit int := least(greatest(coalesce((p->>'limit')::int, 60), 1), 200);
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  return jsonb_build_object(
    'today', (select jsonb_build_object('received', count(*) filter (where folder <> 'sent'), 'sent', count(*) filter (where folder = 'sent'),
                'unread', (select count(*) from dmail_messages where folder = 'inbox' and not seen),
                'waiting', (select count(*) from dmail_messages where folder = 'inbox' and not answered and msg_date > now() - interval '7 days'))
              from dmail_messages where folder <> 'drafts' and msg_date >= date_trunc('day', now() at time zone 'America/New_York') at time zone 'America/New_York'),
    'rows', coalesce((select jsonb_agg(r order by (r->>'date') desc) from (
      select jsonb_build_object('id', m.id, 'account', m.account_id, 'address', a.address, 'assigned_name', d.full_name, 'folder', m.folder,
        'dir', case when m.folder = 'sent' then 'out' else 'in' end, 'from_name', m.from_name, 'from_email', m.from_email, 'to', m.to_addrs,
        'subject', m.subject, 'snippet', m.snippet, 'date', m.msg_date, 'thread', m.thread_key, 'seen', m.seen, 'answered', m.answered,
        'has_attach', m.has_attach, 'is_reply', m.in_reply_to is not null,
        'sent_by', case when m.folder = 'sent' then coalesce(sb.full_name, case when m.sent_by is null then 'Webmail / other' else 'LoadBoot staff' end) end) r
      from dmail_messages m join dmail_accounts a on a.id = m.account_id
        left join dispatcher_profiles d on d.user_id = a.assigned_to left join dispatcher_profiles sb on sb.user_id = m.sent_by
      where m.folder <> 'drafts' and (v_acc is null or m.account_id = v_acc)
        and (v_dir is null or (v_dir = 'out') = (m.folder = 'sent'))
        and (v_before is null or m.msg_date < v_before)
        and (v_q is null or m.fts @@ plainto_tsquery('simple', v_q) or m.subject ilike '%' || v_q || '%' or m.from_email ilike '%' || v_q || '%' or m.to_addrs::text ilike '%' || v_q || '%')
      order by m.msg_date desc limit v_limit) s), '[]'::jsonb));
end $$;

revoke all on function public.cc_dmail_activity(jsonb) from public, anon;
grant execute on function public.cc_dmail_activity(jsonb) to authenticated;
revoke all on function public.dmail_bootstrap(uuid) from public, anon;
grant execute on function public.dmail_bootstrap(uuid) to authenticated;
