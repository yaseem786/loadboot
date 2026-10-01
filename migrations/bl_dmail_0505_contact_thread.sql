-- bl_dmail_0505 — CC Web leads: email a lead straight from the submission and see every email
-- with that address (in + out) across LoadBoot mailboxes, plus the shared mailboxes staff can send from.
-- Staff only. Sending itself stays in the `dmail` edge function (action 'send'), which already lets staff
-- use any account (dmail_can → disp_is_staff).
create or replace function public.cc_dmail_contact(p_email text, p_limit int default 100)
returns jsonb
language plpgsql stable security definer
set search_path to 'app_private', 'public'
as $$
declare v_e text := lower(btrim(coalesce(p_email, '')));
begin
  if not app_private.disp_is_staff() then raise exception 'not authorized' using errcode = '42501'; end if;
  return jsonb_build_object(
    'enabled', coalesce((select enabled from app_private.dmail_config where id = 1), false),
    -- shared mailboxes = not assigned to a dispatcher (hello@, billing@, loads@, dispatch@ …)
    'mailboxes', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'address', a.address, 'name', a.display_name,
                     'alias', a.parent_id is not null, 'last_ok_at', a.last_ok_at, 'error', a.last_error) order by a.address)
                   from app_private.dmail_accounts a
                  where a.assigned_to is null and a.status = 'active'), '[]'::jsonb),
    'messages', case when v_e = '' or position('@' in v_e) = 0 then '[]'::jsonb else coalesce((
      select jsonb_agg(x order by (x->>'at')) from (
        select jsonb_build_object('id', m.id, 'account_id', m.account_id, 'mailbox', a.address, 'folder', m.folder,
                 'out', lower(m.from_email) = lower(a.address) or m.folder = 'sent',
                 'from_email', m.from_email, 'from_name', m.from_name, 'to', m.to_addrs, 'cc', m.cc_addrs,
                 'subject', m.subject, 'snippet', m.snippet, 'text', left(m.body_text, 20000), 'html', left(m.body_html, 60000),
                 'has_attach', m.has_attach, 'at', coalesce(m.msg_date, m.created_at), 'thread_key', m.thread_key) x
          from app_private.dmail_messages m
          join app_private.dmail_accounts a on a.id = m.account_id
         where m.folder in ('inbox', 'sent', 'spam')
           and coalesce(m.routed, false) = false
           and (lower(m.from_email) = v_e
                or m.to_addrs @> jsonb_build_array(jsonb_build_object('email', v_e))
                or exists (select 1 from jsonb_array_elements(coalesce(m.to_addrs, '[]'::jsonb) || coalesce(m.cc_addrs, '[]'::jsonb)) t where lower(t->>'email') = v_e))
         order by coalesce(m.msg_date, m.created_at) desc
         limit least(greatest(coalesce(p_limit, 100), 1), 200)
      ) s), '[]'::jsonb) end);
end $$;
revoke all on function public.cc_dmail_contact(text, int) from public, anon;
grant execute on function public.cc_dmail_contact(text, int) to authenticated;
