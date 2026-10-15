-- bl_disp_0551 — dispatcher load posts: "seen" tracking, full detail for staff + dispatcher, staff hide / delete / alert.
-- Owner 15 Oct 2026: "har cheez jo dispatcher ne load mein post ki hai nazar aaye; carrier ki taraf se kya action hua —
-- accept, decline, seen ya nahi — dispatcher ko bhi dikhe; CC delete ya hide kar sake ya alert bhej sake; jo missing hai
-- woh bhi dikhe." (0550 was reserved for the training session; skipped so the two never collide.)
--
--   1. app_private.dispatcher_post_views — one row per (load, carrier user): first time the post was on their board,
--      first / last time they opened it, how many opens. Written only by carrier_dispatcher_post_seen (the carrier app
--      calls it when the card renders and when the detail opens). The poster and staff never count as "seen".
--   2. app_private.dispatcher_post_staff — staff state per post: hidden (CC list only), deleted (off the carrier's board,
--      off the dispatcher's list, kept for audit and restorable), and the alerts staff sent the dispatcher.
--   3. public.cc_dispatcher_post_action(load, hide|unhide|delete|restore, reason) and public.cc_dispatcher_post_alert(load,
--      message) — disp_is_staff() only (dispatch.manage / carriers.approve). Delete withdraws an open post first through
--      the existing dispatcher_withdraw_load (so the carrier is told exactly as before) and refuses a post that has a live
--      booking. Alert = in-app + push to the dispatcher who posted it. No email (no catalog key needed).
--   4. cc_dispatcher_posts / dispatcher_my_posts: same signatures, now return everything the dispatcher entered
--      (details, accessorials, windows, freight), the seen summary and the staff state; the dispatcher's list drops
--      deleted posts and carries staff alerts. View-only CC roles keep the 0509 redaction (broker phone/e-mail).
--
-- Both list RPCs were byte-identical on staging and prod before this file (md5 of prosrc checked 15 Oct), so they are
-- replaced whole here with the same signature (grants unchanged). Two new public functions + one carrier RPC, each
-- `revoke … from public, anon` → anon SECURITY DEFINER surface stays 36 prod / 35 staging, same names.

do $$ begin
  if to_regprocedure('public.dispatcher_post_load(uuid,jsonb)') is null or to_regprocedure('public.dispatcher_withdraw_load(uuid,text)') is null then
    raise exception 'STOP: bl_disp_0549 is not applied on this database';
  end if;
end $$;

-- ---------------------------------------------------------------- 1. tables
create table if not exists app_private.dispatcher_post_views (
  load_id uuid not null references public.loads(id) on delete cascade,
  user_id uuid not null,
  first_board_at timestamptz,
  first_opened_at timestamptz,
  last_opened_at timestamptz,
  opens int not null default 0,
  primary key (load_id, user_id)
);
create table if not exists app_private.dispatcher_post_staff (
  load_id uuid primary key references public.loads(id) on delete cascade,
  hidden_at timestamptz, hidden_by uuid, hidden_reason text,
  deleted_at timestamptz, deleted_by uuid, deleted_reason text,
  alerts jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
alter table app_private.dispatcher_post_views enable row level security;
alter table app_private.dispatcher_post_staff enable row level security;
revoke all on app_private.dispatcher_post_views from public, anon, authenticated;
revoke all on app_private.dispatcher_post_staff from public, anon, authenticated;

-- ---------------------------------------------------------------- 2. helpers
create or replace function app_private.disp_post_seen(p_load uuid)
returns jsonb language sql stable security definer set search_path = app_private, public as $$
  select jsonb_build_object(
    'board_at', (select min(v.first_board_at) from app_private.dispatcher_post_views v where v.load_id = p_load),
    'opened_at', (select min(v.first_opened_at) from app_private.dispatcher_post_views v where v.load_id = p_load),
    'last_opened_at', (select max(v.last_opened_at) from app_private.dispatcher_post_views v where v.load_id = p_load),
    'opens', (select coalesce(sum(v.opens), 0) from app_private.dispatcher_post_views v where v.load_id = p_load),
    'opened_by', (select string_agg(distinct coalesce(nullif(btrim(p.contact_name), ''), split_part(u.email, '@', 1)), ', ')
                    from app_private.dispatcher_post_views v join auth.users u on u.id = v.user_id left join public.profiles p on p.id = v.user_id
                   where v.load_id = p_load and v.first_opened_at is not null),
    'notif_read_at', (select min(n.read_at) from app_private.notifications n
                       where n.template_key in ('dispatcher.load.posted', 'dispatcher.load.updated') and n.payload->>'load_id' = p_load::text and n.read_at is not null));
$$;
revoke all on function app_private.disp_post_seen(uuid) from public, anon, authenticated;

create or replace function app_private.disp_staff_name(p_uid uuid)
returns text language sql stable security definer set search_path = app_private, public as $$
  select case when p_uid is null then null else coalesce(app_private.disp_display_name(p_uid),
    (select nullif(btrim(p.contact_name), '') from public.profiles p where p.id = p_uid),
    (select split_part(u.email, '@', 1) from auth.users u where u.id = p_uid), 'LoadBoot') end;
$$;
revoke all on function app_private.disp_staff_name(uuid) from public, anon, authenticated;

create or replace function app_private.disp_post_staff_state(p_load uuid)
returns jsonb language sql stable security definer set search_path = app_private, public as $$
  select coalesce((select jsonb_build_object('hidden_at', s.hidden_at, 'hidden_reason', s.hidden_reason,
      'hidden_by', app_private.disp_staff_name(s.hidden_by), 'deleted_at', s.deleted_at, 'deleted_reason', s.deleted_reason,
      'deleted_by', app_private.disp_staff_name(s.deleted_by), 'alerts', s.alerts)
    from app_private.dispatcher_post_staff s where s.load_id = p_load), '{}'::jsonb);
$$;
revoke all on function app_private.disp_post_staff_state(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- 3. carrier: seen on board / opened
create or replace function public.carrier_dispatcher_post_seen(p_load uuid, p_kind text default 'board')
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); l record; v_open boolean := (p_kind = 'detail');
begin
  if v_uid is null then return jsonb_build_object('error', 'not signed in'); end if;
  select x.id, x.target_carrier_org, x.created_by, x.source_type into l from public.loads x where x.id = p_load;
  if l.id is null or l.source_type is distinct from 'dispatcher' or l.target_carrier_org is null then return jsonb_build_object('ok', false); end if;
  if l.created_by = v_uid or app_private.disp_is_staff() then return jsonb_build_object('ok', true, 'counted', false); end if;
  if not exists (select 1 from public.organization_memberships m where m.org_id = l.target_carrier_org and m.user_id = v_uid and coalesce(m.status, 'active') = 'active')
     and not exists (select 1 from public.organizations o where o.id = l.target_carrier_org and o.owner_user_id = v_uid) then
    return jsonb_build_object('ok', false);
  end if;
  insert into app_private.dispatcher_post_views as v (load_id, user_id, first_board_at, first_opened_at, last_opened_at, opens)
  values (p_load, v_uid, now(), case when v_open then now() end, case when v_open then now() end, case when v_open then 1 else 0 end)
  on conflict (load_id, user_id) do update set
    first_board_at = coalesce(v.first_board_at, now()),
    first_opened_at = case when v_open then coalesce(v.first_opened_at, now()) else v.first_opened_at end,
    last_opened_at = case when v_open then now() else v.last_opened_at end,
    opens = v.opens + case when v_open then 1 else 0 end;
  return jsonb_build_object('ok', true, 'counted', true);
end $$;
revoke all on function public.carrier_dispatcher_post_seen(uuid, text) from public, anon;
grant execute on function public.carrier_dispatcher_post_seen(uuid, text) to authenticated;

-- ---------------------------------------------------------------- 4. staff: hide / unhide / delete / restore
create or replace function public.cc_dispatcher_post_action(p_load uuid, p_action text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); l public.loads; v_reason text := nullif(btrim(coalesce(p_reason, '')), ''); v_wd jsonb; v_lane text;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error', 'not authorized'); end if;
  select * into l from public.loads where id = p_load;
  if l.id is null or l.source_type is distinct from 'dispatcher' then return jsonb_build_object('error', 'not a dispatcher post'); end if;
  v_lane := coalesce(l.origin, '—') || ' → ' || coalesce(l.destination, '—');
  if p_action = 'hide' then
    insert into app_private.dispatcher_post_staff as s (load_id, hidden_at, hidden_by, hidden_reason) values (p_load, now(), v_uid, v_reason)
    on conflict (load_id) do update set hidden_at = now(), hidden_by = v_uid, hidden_reason = v_reason, updated_at = now();
  elsif p_action = 'unhide' then
    update app_private.dispatcher_post_staff set hidden_at = null, hidden_by = null, hidden_reason = null, updated_at = now() where load_id = p_load;
  elsif p_action = 'delete' then
    if exists (select 1 from app_private.dispatcher_bookings b where b.load_id = p_load and coalesce(b.status, '') not in ('rejected', 'cancelled', 'canceled', 'void')) then
      return jsonb_build_object('error', 'this post has a live booking — cancel or reject the booking first');
    end if;
    if l.status = 'available' and (l.expires_at is null or l.expires_at > now()) then   -- still on the carrier's board → withdraw through the normal path (carrier told if they opened it)
      v_wd := public.dispatcher_withdraw_load(p_load, coalesce(v_reason, 'Removed by LoadBoot'));
      if v_wd ? 'error' then return v_wd; end if;
    end if;
    insert into app_private.dispatcher_post_staff as s (load_id, deleted_at, deleted_by, deleted_reason) values (p_load, now(), v_uid, v_reason)
    on conflict (load_id) do update set deleted_at = now(), deleted_by = v_uid, deleted_reason = v_reason, updated_at = now();
  elsif p_action = 'restore' then
    update app_private.dispatcher_post_staff set deleted_at = null, deleted_by = null, deleted_reason = null, updated_at = now() where load_id = p_load;
  else
    return jsonb_build_object('error', 'unknown action');
  end if;
  perform app_private.disp_audit('dispatcher.post.' || p_action, 'load', p_load::text, l.target_carrier_org,
    'LoadBoot ' || p_action || ' on dispatcher post ' || v_lane || coalesce(': ' || v_reason, ''), jsonb_build_object('withdraw', v_wd));
  return jsonb_build_object('ok', true, 'action', p_action, 'withdraw', v_wd, 'staff', app_private.disp_post_staff_state(p_load));
end $$;
revoke all on function public.cc_dispatcher_post_action(uuid, text, text) from public, anon;
grant execute on function public.cc_dispatcher_post_action(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------- 5. staff: alert the dispatcher who posted it
create or replace function public.cc_dispatcher_post_alert(p_load uuid, p_message text)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); l public.loads; v_msg text := nullif(btrim(coalesce(p_message, '')), ''); v_title text; v_by text; v_entry jsonb;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error', 'not authorized'); end if;
  if v_msg is null then return jsonb_build_object('error', 'write the message for the dispatcher'); end if;
  if length(v_msg) > 1000 then return jsonb_build_object('error', 'keep it under 1000 characters'); end if;
  select * into l from public.loads where id = p_load;
  if l.id is null or l.source_type is distinct from 'dispatcher' or l.created_by is null then return jsonb_build_object('error', 'not a dispatcher post'); end if;
  v_by := app_private.disp_staff_name(v_uid);
  v_title := '⚠ LoadBoot about your post ' || coalesce(l.origin, '—') || ' → ' || coalesce(l.destination, '—');
  insert into app_private.notifications (recipient_role, recipient_user, channel, template_key, payload, status, sent_at)
  values ('user', l.created_by, 'in_app', 'dispatcher.post.staff_alert',
    jsonb_build_object('title', v_title, 'body', v_msg, 'tone', 'warning', 'url', '/app/agent/#board', 'load_id', l.id, 'user', l.created_by), 'sent', now());
  begin perform app_private.push_enqueue(l.created_by, v_title, v_msg, '/app/agent/#board', 'disp-post-alert-' || l.id::text); exception when others then null; end;
  v_entry := jsonb_build_object('at', now(), 'by', v_by, 'message', v_msg);
  insert into app_private.dispatcher_post_staff as s (load_id, alerts) values (p_load, jsonb_build_array(v_entry))
  on conflict (load_id) do update set alerts = s.alerts || jsonb_build_array(v_entry), updated_at = now();
  perform app_private.disp_audit('dispatcher.post.alert', 'load', p_load::text, l.target_carrier_org, v_by || ' alerted the dispatcher: ' || left(v_msg, 200), '{}'::jsonb);
  return jsonb_build_object('ok', true, 'alert', v_entry);
end $$;
revoke all on function public.cc_dispatcher_post_alert(uuid, text) from public, anon;
grant execute on function public.cc_dispatcher_post_alert(uuid, text) to authenticated;

-- ---------------------------------------------------------------- 6. CC list: everything the dispatcher entered + seen + staff state
create or replace function public.cc_dispatcher_posts(p_org uuid default null, p_user uuid default null, p_limit int default 100)
returns jsonb language sql stable security definer set search_path = app_private, public as $$
  select case when not app_private.disp_can_view() then jsonb_build_object('error', 'not authorized') else coalesce((select jsonb_agg(x order by x->>'created_at' desc) from (
    select jsonb_build_object('id', l.id, 'status', l.status, 'carrier_org_id', l.target_carrier_org, 'carrier', (select o.name from public.organizations o where o.id = l.target_carrier_org),
      'dispatcher_user', l.created_by, 'dispatcher', l.details->'dispatcher_post'->>'dispatcher_name',
      'origin', l.origin, 'destination', l.destination, 'rate', l.rate, 'miles', l.miles, 'rpm', case when l.miles > 0 then round(l.rate / l.miles, 2) end,
      'equipment', l.equipment, 'pickup_date', l.pickup_date, 'delivery_date', l.delivery_date, 'pickup_window', l.pickup_time, 'delivery_window', l.delivery_time,
      'broker', l.broker, 'commodity', l.commodity, 'weight', l.weight, 'deadhead', l.deadhead, 'hazmat', l.hazmat, 'requirements', l.requirements, 'notes', l.notes,
      'board', l.source_provider, 'board_label', app_private.disp_board_label(l.source_provider),
      'source_reference', l.source_reference, 'expires_at', l.expires_at, 'created_at', l.created_at, 'confidence', l.confidence,
      'below_min', coalesce((l.details->>'below_min')::boolean, false), 'below_min_reason', l.details->>'below_min_reason',
      'details', app_private.disp_view_redact(l.details), 'accessorials', l.accessorials,
      'decision', l.details->'decision', 'withdrawn', l.details->'withdrawn', 'is_demo', l.is_demo,
      'expired', (l.status = 'available' and l.expires_at is not null and l.expires_at <= now()),
      'seen', app_private.disp_post_seen(l.id), 'staff', app_private.disp_post_staff_state(l.id),
      'booking', (select jsonb_build_object('id', b.id, 'status', b.status, 'created_at', b.created_at) from app_private.dispatcher_bookings b where b.load_id = l.id order by b.created_at desc limit 1)) x
    from public.loads l
    where l.source_type = 'dispatcher' and (p_org is null or l.target_carrier_org = p_org) and (p_user is null or l.created_by = p_user)
    order by l.created_at desc limit greatest(1, least(coalesce(p_limit, 100), 300))) s), '[]'::jsonb) end;
$$;

-- ---------------------------------------------------------------- 7. dispatcher's own list: + seen, + LoadBoot alerts, − deleted
create or replace function public.dispatcher_my_posts(p_org uuid default null, p_limit int default 100)
returns jsonb language sql stable security definer set search_path = app_private, public as $$
  select coalesce((select jsonb_agg(x order by x->>'created_at' desc) from (
    select jsonb_build_object('id', l.id, 'status', l.status, 'carrier_org_id', l.target_carrier_org, 'carrier', (select o.name from public.organizations o where o.id = l.target_carrier_org),
      'origin', l.origin, 'destination', l.destination, 'rate', l.rate, 'miles', l.miles, 'rpm', case when l.miles > 0 then round(l.rate / l.miles, 2) end,
      'equipment', l.equipment, 'pickup_date', l.pickup_date, 'delivery_date', l.delivery_date, 'pickup_window', l.pickup_time, 'delivery_window', l.delivery_time,
      'broker', l.broker, 'commodity', l.commodity, 'weight', l.weight, 'deadhead', l.deadhead, 'hazmat', l.hazmat, 'requirements', l.requirements, 'notes', l.notes,
      'board', l.source_provider, 'board_label', app_private.disp_board_label(l.source_provider), 'source_reference', l.source_reference,
      'expires_at', l.expires_at, 'created_at', l.created_at, 'confidence', l.confidence,
      'below_min', coalesce((l.details->>'below_min')::boolean, false), 'below_min_reason', l.details->>'below_min_reason',
      'details', l.details, 'accessorials', l.accessorials,
      'decision', l.details->'decision', 'withdrawn', l.details->'withdrawn',
      'expired', (l.status = 'available' and l.expires_at is not null and l.expires_at <= now()),
      'seen', app_private.disp_post_seen(l.id),
      'staff_alerts', (select s.alerts from app_private.dispatcher_post_staff s where s.load_id = l.id),
      'booking', (select jsonb_build_object('id', b.id, 'status', b.status, 'rc_doc_path', b.rc_doc_path) from app_private.dispatcher_bookings b where b.load_id = l.id order by b.created_at desc limit 1)) x
    from public.loads l
    where l.source_type = 'dispatcher' and l.created_by = auth.uid() and (p_org is null or l.target_carrier_org = p_org)
      and not exists (select 1 from app_private.dispatcher_post_staff s where s.load_id = l.id and s.deleted_at is not null)
    order by l.created_at desc limit greatest(1, least(coalesce(p_limit, 100), 300))) s), '[]'::jsonb);
$$;
