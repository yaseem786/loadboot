-- bl_priv_0437 — Deletion desk: the Command Center screen for account-deletion requests.
--
-- WHY: request_account_deletion() has filed requests since bl_priv_0211, and cc_account_deletion_process()
-- erases them, but the CC never had a screen. The staff notification pointed at '/automation' (the task
-- queue), where deletion requests do not appear. A real carrier (AEH CARGO LLC, 23-24 Sep 2026) asked to be
-- deleted and nobody could see it. 30-day completion is the promise made to the user.
--
-- 1) public.cc_account_deletions(p_view) — one read for the whole desk: rows enriched with who the account is
--    (name, role, company, org, MC/DOT, created, last sign-in), what is on file (documents, storage files,
--    file-review state), the 30-day deadline, who processed it; plus summary counts for the KPI strip.
--    Same gate as cc_account_deletion_queue (carriers.approve OR finance.approve). Read-only.
-- 2) request_account_deletion(): the staff notification now links to '/deletions' (anchor replace, rest unchanged).
-- 3) Existing staff notifications for deletion requests are re-pointed to '/deletions'.
--
-- Anon surface: the new function is revoked from PUBLIC/anon explicitly (baseline 33 prod / 32 staging unchanged).
-- STAGING: applied + verified 2026-09-24 (owner@lb.test staff probe; test request #71 removed).
-- PRODUCTION: applied 2026-09-24; anon SECURITY DEFINER surface verified 33, names unchanged; notification link fixed.

create or replace function public.cc_account_deletions(p_view text default 'open')
returns jsonb language plpgsql stable security definer set search_path = app_private, public as $$
declare v_rows jsonb; v_sum jsonb; v_view text := lower(coalesce(nullif(btrim(p_view),''),'open'));
begin
  if not (public.has_global_permission('carriers.approve') or public.has_global_permission('finance.approve')) then
    raise exception 'not authorized' using errcode = '42501';
  end if;
  if v_view not in ('open','completed','closed','all') then v_view := 'open'; end if;

  select coalesce(jsonb_agg(x.j order by x.sort_key), '[]'::jsonb) into v_rows from (
    select r.requested_at as sort_key, jsonb_build_object(
      'id', r.id, 'user_id', r.user_id, 'email', r.email, 'status', r.status,
      'reason', r.reason, 'note', r.note,
      'requested_at', r.requested_at, 'processed_at', r.processed_at,
      'due_at', r.requested_at + interval '30 days',
      'days_open', floor(extract(epoch from (coalesce(r.processed_at, now()) - r.requested_at)) / 86400)::int,
      'days_left', ceil(extract(epoch from (r.requested_at + interval '30 days' - now())) / 86400)::int,
      'processed_by', (select coalesce(nullif(pp.contact_name,''), pu.email) from auth.users pu
                         left join public.profiles pp on pp.id = pu.id where pu.id = r.processed_by),
      'name', nullif(p.contact_name,''), 'company', nullif(p.company,''), 'role', p.role, 'phone_on_file', p.phone is not null,
      'account_created_at', coalesce(p.created_at, u.created_at), 'last_sign_in_at', u.last_sign_in_at,
      'org_id', o.id, 'org_kind', o.kind, 'org_name', o.name, 'mc_number', o.mc_number, 'dot_number', o.dot_number,
      'documents', (select count(*) from public.documents d where d.carrier_id = r.user_id),
      'files', (select count(*) from storage.objects so where so.owner = r.user_id),
      'review', (select jsonb_build_object(
                   'items', count(*),
                   'undecided', count(*) filter (where dd.decision is null),
                   'pending_removal', count(*) filter (where dd.decision = 'remove' and dd.removed_at is null),
                   'held', count(*) filter (where dd.decision = 'hold'))
                 from app_private.account_erasure_inventories i
                 cross join lateral jsonb_array_elements(i.items) e(item)
                 left join app_private.erasure_item_decisions dd on dd.request_id = i.request_id and dd.item_key = md5(e.item::text)
                 where i.request_id = r.id)
    ) as j
    from app_private.account_deletion_requests r
    left join auth.users u on u.id = r.user_id
    left join public.profiles p on p.id = r.user_id
    left join lateral (select oo.* from public.organizations oo where oo.owner_user_id = r.user_id order by oo.created_at limit 1) o on true
    where case v_view when 'open' then r.status = 'requested'
                      when 'completed' then r.status = 'completed'
                      when 'closed' then r.status <> 'requested' and r.status <> 'completed'
                      else true end
    order by r.requested_at desc
    limit 200
  ) x;

  select jsonb_build_object(
    'open',           count(*) filter (where status = 'requested'),
    'overdue',        count(*) filter (where status = 'requested' and requested_at + interval '30 days' < now()),
    'due_7d',         count(*) filter (where status = 'requested' and requested_at + interval '30 days' >= now()
                                         and requested_at + interval '30 days' < now() + interval '7 days'),
    'completed_30d',  count(*) filter (where status = 'completed' and processed_at > now() - interval '30 days'),
    'closed_30d',     count(*) filter (where status not in ('requested','completed') and coalesce(processed_at, requested_at) > now() - interval '30 days'),
    'completed_total',count(*) filter (where status = 'completed'),
    'avg_days_to_complete', round((avg(extract(epoch from (processed_at - requested_at)) / 86400)
                                     filter (where status = 'completed' and processed_at is not null))::numeric, 1)
  ) into v_sum from app_private.account_deletion_requests;

  return jsonb_build_object('view', v_view, 'rows', v_rows, 'summary', v_sum);
end $$;

revoke all on function public.cc_account_deletions(text) from public, anon;
grant execute on function public.cc_account_deletions(text) to authenticated, service_role;

-- 2) notification deep link (anchor replace; fails loudly if the anchor is gone)
do $m$ declare d text; begin
  d := pg_get_functiondef('public.request_account_deletion(text)'::regprocedure);
  if position('''url'',''/automation''' in d) = 0 then
    if position('''url'',''/deletions''' in d) > 0 then return; end if;
    raise exception 'bl_priv_0437: anchor not found in request_account_deletion';
  end if;
  execute replace(d, '''url'',''/automation''', '''url'',''/deletions''');
end $m$;

-- 3) re-point the staff notifications already filed
update app_private.notifications set payload = jsonb_set(payload, '{url}', '"/deletions"')
 where template_key = 'account.deletion_requested' and payload->>'url' = '/automation';
