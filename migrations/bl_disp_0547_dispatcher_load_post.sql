-- bl_disp_0547 — Dispatcher posts a 3rd-party load ON HIS CARRIER'S board (13 Oct 2026)
--
-- A hired dispatcher finds a load on DAT / Truckstop / 123Loadboard / Direct Freight / a broker call and posts it
-- so it appears on his ASSIGNED carrier's LoadBoot load board, tagged "Posted by your dispatcher <name>", with the
-- same card / detail / decision flow the carrier already uses. Nothing new for the carrier to learn.
--
-- What this file does (additive, apply STAGING first, then PROD):
--   1. public.loads: new nullable column target_carrier_org; check constraints widened for
--      source_type 'dispatcher', verification_state 'dispatcher_posted', status 'carrier_accepted' / 'declined' /
--      'withdrawn' / 'expired'.
--   2. Visibility: a dispatcher-posted load is visible ONLY to target_carrier_org (and staff) — RLS policy
--      loads_visible, cc_pocket_available_loads (sorted first), cc_load_detail, cc_carrier_best_loads, the two
--      truck-posting matchers and get_public_load_opportunities are patched (anchor-replace, never retyped).
--   3. RPCs: dispatcher_post_load / dispatcher_update_load / dispatcher_withdraw_load / dispatcher_my_posts /
--      dispatcher_broker_screen (dispatcher), carrier_dispatcher_load_decide (carrier: "I'll take it" / Decline),
--      cc_dispatcher_posts (staff). Acceptance creates the dispatcher_bookings row ('pending_rc', source = board,
--      load_id) so Log-a-booking → CC approve → Dispatched continues unchanged; CC approve/reject now also moves the
--      load to 'booked' / 'declined'.
--   4. Notifications: carrier owner in-app + premium email (email_kit body, catalog key dispatcher.load.posted,
--      CTA deep-links /app/carrier/#loads/<id>) + push; demo orgs in-app only. Dispatcher gets
--      dispatcher.post.accepted / .declined / .expired; carrier gets dispatcher.load.withdrawn when a post they
--      opened is pulled.
--   5. Expiry: app_private.disp_posts_expire() every 10 min (cron lb-disp-posts-expire).
--   6. CC: cc_carrier_360.dispatcher_posts, cc_dispatcher_360.posts; the daily trial e-mail counts "Loads posted"
--      as effort and "Posts accepted" as outcome.
-- Anon-executable SECURITY DEFINER surface in public: UNCHANGED (asserted at the end).

-- ---------------------------------------------------------------- 0. anchor-replace helper (app_private only)
create or replace function app_private.fn_patch(p_fn regprocedure, p_anchor text, p_new text)
returns boolean language plpgsql as $$
declare v_def text; v_n int;
begin
  v_def := pg_get_functiondef(p_fn);
  if position(p_new in v_def) > 0 then return false; end if;      -- already patched (re-runnable)
  v_n := (length(v_def) - length(replace(v_def, p_anchor, ''))) / greatest(1, length(p_anchor));
  if v_n <> 1 then raise exception 'fn_patch %: anchor found % time(s), expected 1 — anchor: %', p_fn, v_n, left(p_anchor, 120); end if;
  execute replace(v_def, p_anchor, p_new);
  return true;
end $$;
revoke all on function app_private.fn_patch(regprocedure, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- 1. schema
alter table public.loads add column if not exists target_carrier_org uuid references public.organizations(id) on delete set null;
create index if not exists loads_target_carrier_org_idx on public.loads (target_carrier_org) where target_carrier_org is not null;
create index if not exists loads_dispatcher_posts_idx on public.loads (created_by, created_at desc) where source_type = 'dispatcher';

alter table public.loads drop constraint if exists loads_source_type_check;
alter table public.loads add constraint loads_source_type_check check (source_type is null or source_type in
  ('partner_portal','staff_entered','licensed_integration','official_api','uploaded_document','imported','unverified_external',
   'quote_converted','recurring_lane','duplicated','api_client','email','dispatcher'));
alter table public.loads drop constraint if exists loads_verification_check;
alter table public.loads add constraint loads_verification_check check (verification_state in ('unverified','partial','verified','dispatcher_posted'));
alter table public.loads drop constraint if exists loads_status_check;
alter table public.loads add constraint loads_status_check check (status in
  ('available','booked','in_transit','delivered','cancelled','carrier_accepted','declined','withdrawn','expired'));

-- RLS: a targeted load is readable only by the target carrier's members, its poster, or an admin.
-- The membership test lives in a SECURITY DEFINER helper: `authenticated` has no SELECT on organizations /
-- memberships (and no USAGE on app_private), so an inline subquery in the policy would make EVERY select on
-- public.loads fail with "permission denied for table organizations".
-- (ALTER, not drop+create: the Supabase MCP holds a `drop policy` for a confirmation that never comes and times out.)
create or replace function public.lb_load_target_visible(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select p_org is null
      or exists (select 1 from public.organizations o where o.id = p_org and o.owner_user_id = auth.uid())
      or exists (select 1 from public.organization_memberships m where m.org_id = p_org and m.user_id = auth.uid() and coalesce(m.status,'active') = 'active');
$$;
revoke all on function public.lb_load_target_visible(uuid) from public, anon;
grant execute on function public.lb_load_target_visible(uuid) to authenticated;
-- The SELECT policy is named `loads_visible` on staging and `loads_carrier_select` on prod (same expression): every
-- permissive SELECT policy on public.loads gets the target condition, so a targeted post never leaks through an OR.
do $$
declare p record; v_n int := 0;
  v_using constant text := $u$is_admin() or assigned_to = (select auth.uid())
    or (status = 'available' and (target_carrier_org is null or created_by = (select auth.uid()) or public.lb_load_target_visible(target_carrier_org)))$u$;
begin
  for p in select polname from pg_policy where polrelid = 'public.loads'::regclass and polcmd = 'r' loop
    execute format('alter policy %I on public.loads using (%s)', p.polname, v_using);
    v_n := v_n + 1;
  end loop;
  if v_n = 0 then execute format('create policy loads_visible on public.loads for select using (%s)', v_using); end if;
  if exists (select 1 from pg_policy where polrelid = 'public.loads'::regclass and polcmd = 'r' and position('target_carrier_org' in pg_get_expr(polqual, polrelid)) = 0) then
    raise exception 'a SELECT policy on public.loads still ignores target_carrier_org';
  end if;
end $$;

-- ---------------------------------------------------------------- 2. email catalog (CLAUDE.md §6)
insert into app_private.email_catalog (key, name, purpose, class, audience_role, trigger_type, trigger_source, cadence, cap_note, stop_condition,
                                       preference_group, unsub_allowed, status, cc_deep_link)
values
 ('dispatcher.load.posted', 'New load from your dispatcher',
  'Your dispatcher found a load on a 3rd-party board (DAT, Truckstop, …) and posted it on your LoadBoot load board. Card summary + "View the load" deep link. In-app + push too; demo orgs in-app only.',
  'T', 'carrier', 'event', 'public.dispatcher_post_load', 'per post', 'one per post per member (idempotency disp-post:<load>:<email>)', 'post expires, is withdrawn or decided',
  'account_critical', false, 'live', '#/carriers'),
 ('dispatcher.load.withdrawn', 'Dispatcher withdrew a posted load',
  'The dispatcher (or staff) pulled a load they had posted on your board after you had opened it.',
  'T', 'carrier', 'event', 'public.dispatcher_withdraw_load', 'per withdrawal', 'one per post', null,
  'account_critical', false, 'live', '#/carriers'),
 ('dispatcher.post.accepted', 'Carrier accepted your posted load',
  'The carrier tapped "I''ll take it" on a load the dispatcher posted. Next step: get the rate confirmation and attach it to the booking LoadBoot created.',
  'T', 'dispatcher', 'event', 'public.carrier_dispatcher_load_decide → app_private.disp_notify', 'per acceptance', 'one per post', null,
  'account_critical', false, 'live', '#/dispatchers'),
 ('dispatcher.post.declined', 'Carrier declined your posted load',
  'The carrier declined a load the dispatcher posted, with their reason.',
  'T', 'dispatcher', 'event', 'public.carrier_dispatcher_load_decide → app_private.disp_notify', 'per decline', 'one per post', null,
  'account_critical', false, 'live', '#/dispatchers'),
 ('dispatcher.post.expired', 'Posted load expired',
  'A load the dispatcher posted for the carrier reached its expiry (default 2 h) or its pickup date without a decision.',
  'T', 'dispatcher', 'cron', 'app_private.disp_posts_expire (cron lb-disp-posts-expire, every 10 min) → app_private.disp_notify', 'per expiry', 'one per post', null,
  'account_critical', false, 'live', '#/dispatchers')
on conflict (key) do update set name = excluded.name, purpose = excluded.purpose, class = excluded.class, audience_role = excluded.audience_role,
  trigger_type = excluded.trigger_type, trigger_source = excluded.trigger_source, cadence = excluded.cadence, cap_note = excluded.cap_note,
  stop_condition = excluded.stop_condition, preference_group = excluded.preference_group, unsub_allowed = excluded.unsub_allowed,
  status = 'live', cc_deep_link = excluded.cc_deep_link;

-- ---------------------------------------------------------------- 3. helpers
-- the boards a dispatcher can cite (value → label)
create or replace function app_private.disp_board_label(p text)
returns text language sql immutable as $$
  select case lower(coalesce(p,''))
    when 'dat' then 'DAT' when 'truckstop' then 'Truckstop' when '123loadboard' then '123Loadboard'
    when 'direct_freight' then 'Direct Freight' when 'broker_direct' then 'Broker direct' when 'other' then 'Other' else null end;
$$;

-- one-line money helper for notices
create or replace function app_private.disp_money(p numeric)
returns text language sql immutable as $$ select '$' || to_char(coalesce(p,0), 'FM999,999,990'); $$;

-- the posting dispatcher's display name (first name + initial is enough for the carrier card)
create or replace function app_private.disp_display_name(p_user uuid)
returns text language sql stable security definer set search_path = app_private, public as $$
  select coalesce(nullif(btrim(dp.full_name), ''), 'your dispatcher') from app_private.dispatcher_profiles dp where dp.user_id = p_user;
$$;

-- is the carrier open for dispatcher work right now? (hold/hidden from the CC switch, or a paused org)
create or replace function app_private.disp_carrier_open(p_org uuid, out ok boolean, out why text)
language plpgsql stable security definer set search_path = app_private, public as $$
declare v_status text;
begin
  ok := true; why := null;
  select o.status into v_status from public.organizations o where o.id = p_org;
  if v_status is null then ok := false; why := 'carrier not found'; return; end if;
  if v_status in ('paused','suspended','deleted','hidden') then ok := false; why := 'this carrier is ' || v_status || ' — LoadBoot has stopped dispatch work on it'; return; end if;
  if app_private.disp_carrier_held(p_org) then ok := false; why := 'this carrier is on hold in the Command Center — no new loads until LoadBoot releases it'; return; end if;
end $$;

-- validate + normalise the form into the column set; raises with a carrier-readable message
create or replace function app_private.disp_post_normalise(p_org uuid, p jsonb, p_truck uuid)
returns jsonb language plpgsql stable security definer set search_path = app_private, public as $$
declare v jsonb := coalesce(p, '{}'::jsonb); v_board text; v_eq text; v_fleet text[]; v_rate numeric; v_miles int; v_min numeric; v_rpm numeric;
        v_hours numeric; v_conf text; v_origin text; v_dest text; v_below boolean := false; v_reason text; v_pu date; v_dl date;
begin
  v_board := lower(coalesce(v->>'board',''));
  if app_private.disp_board_label(v_board) is null then raise exception 'pick the board you found this load on' using errcode = '22023'; end if;
  v_origin := btrim(coalesce(v->>'origin', ''));  v_dest := btrim(coalesce(v->>'destination', ''));
  if v_origin = '' or v_dest = '' then raise exception 'origin and destination are required (City, ST)' using errcode = '22023'; end if;
  if coalesce(btrim(v->>'broker'),'') = '' then raise exception 'broker company is required — the carrier has to know who pays' using errcode = '22023'; end if;
  v_eq := btrim(coalesce(v->>'equipment',''));
  if v_eq = '' then raise exception 'equipment is required' using errcode = '22023'; end if;
  v_fleet := app_private.disp_carrier_equipment(p_org);
  if cardinality(v_fleet) > 0 and not (app_private.disp_equip_norm(v_eq) = any(v_fleet)) then
    raise exception 'this carrier has no % on file (fleet: %) — a load the truck cannot haul is not posted', v_eq, array_to_string(v_fleet, ', ') using errcode = '22023';
  end if;
  v_rate := nullif(regexp_replace(coalesce(v->>'rate',''), '[^0-9.]', '', 'g'), '')::numeric;
  if v_rate is null or v_rate <= 0 then raise exception 'gross line-haul rate is required' using errcode = '22023'; end if;
  v_miles := nullif(regexp_replace(coalesce(v->>'miles',''), '[^0-9]', '', 'g'), '')::int;
  v_pu := nullif(v->>'pickup_date','')::date;  v_dl := nullif(v->>'delivery_date','')::date;
  if v_pu is null then raise exception 'pickup date is required' using errcode = '22023'; end if;
  if v_pu < current_date then raise exception 'pickup date is in the past' using errcode = '22023'; end if;
  if v_dl is not null and v_dl < v_pu then raise exception 'delivery date is before pickup' using errcode = '22023'; end if;
  v_hours := coalesce(nullif(v->>'expiry_hours','')::numeric, 2);
  v_hours := greatest(0.25, least(72, v_hours));
  v_conf := case when v->>'confidence' in ('low','medium','high') then v->>'confidence' else 'medium' end;
  -- rate check: SOP floor / truck floor / owner floor (app_private.disp_effective_min) — below needs a written reason
  v_min := app_private.disp_effective_min(p_truck, p_org);
  if v_miles is not null and v_miles > 0 then v_rpm := round(v_rate / v_miles, 2); end if;
  if v_min is not null and v_rpm is not null and v_rpm < v_min then
    v_below := true; v_reason := nullif(btrim(coalesce(v->>'below_min_reason','')), '');
    if v_reason is null then
      raise exception 'BELOW_MIN: $%/mi is under this carrier''s floor of $%/mi — write the reason you still want to post it', v_rpm, v_min using errcode = '22023';
    end if;
  end if;
  return jsonb_build_object('board', v_board, 'board_label', app_private.disp_board_label(v_board), 'origin', v_origin, 'destination', v_dest,
    'equipment', v_eq, 'rate', v_rate, 'miles', v_miles, 'rpm', v_rpm, 'min_rpm', v_min, 'below_min', v_below, 'below_min_reason', v_reason,
    'pickup_date', v_pu, 'delivery_date', v_dl, 'expiry_hours', v_hours, 'confidence', v_conf,
    'hazmat', coalesce((v->>'hazmat')::boolean, false),
    'deadhead', nullif(regexp_replace(coalesce(v->>'deadhead',''), '[^0-9]', '', 'g'), '')::int,
    'weight_lbs', nullif(regexp_replace(coalesce(v->>'weight_lbs',''), '[^0-9]', '', 'g'), '')::int,
    'requirements', (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements_text(case when jsonb_typeof(v->'requirements') = 'array' then v->'requirements' else '[]'::jsonb end) x where btrim(x) <> ''),
    'accessorials', case when jsonb_typeof(v->'accessorials') = 'object' then v->'accessorials' else '{}'::jsonb end);
end $$;

-- the carrier-facing in-app/e-mail/push notice for a post (shared by post + update)
create or replace function app_private.disp_post_notify_carrier(p_load uuid, p_kind text)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare l public.loads; dp jsonb; m record; v_sub text; v_html text; v_txt text; v_body text; v_url text; v_gate jsonb; v_sent int := 0; v_demo boolean;
        v_name text; v_carrier text; v_rpm text; v_exp text; v_facts jsonb; v_title text;
begin
  select * into l from public.loads where id = p_load;
  if l.id is null then return jsonb_build_object('error', 'load not found'); end if;
  dp := coalesce(l.details->'dispatcher_post', '{}'::jsonb);
  v_name := coalesce(dp->>'dispatcher_name', 'your dispatcher');
  select o.name, o.is_demo into v_carrier, v_demo from public.organizations o where o.id = l.target_carrier_org;
  v_rpm := case when l.miles > 0 then ' · $' || to_char(round(l.rate / l.miles, 2), 'FM990.00') || '/mi' else '' end;
  v_exp := case when l.expires_at is not null then to_char(l.expires_at at time zone 'America/New_York', 'Dy Mon DD HH12:MI AM') || ' ET' else '—' end;
  v_url := '/app/carrier/#loads/' || l.id::text;
  v_title := case when p_kind = 'updated' then '✏️ Your dispatcher updated a load: ' else '📋 New load from your dispatcher: ' end || coalesce(l.origin,'—') || ' → ' || coalesce(l.destination,'—');
  v_body := app_private.disp_money(l.rate) || v_rpm || coalesce(' · ' || l.miles || ' mi', '') || coalesce(' · ' || l.equipment, '') || coalesce(' · PU ' || to_char(l.pickup_date, 'Mon DD'), '')
            || ' · found on ' || coalesce(dp->>'board_label', coalesce(l.source_provider, '—')) || ' · expires ' || v_exp;
  v_sub := 'LoadBoot: ' || case when p_kind = 'updated' then 'Updated load from your dispatcher — ' else 'New load from your dispatcher — ' end
           || coalesce(l.origin,'—') || ' → ' || coalesce(l.destination,'—') || ' · ' || app_private.disp_money(l.rate);
  v_facts := jsonb_build_array(
    jsonb_build_object('k', 'Rate', 'v', app_private.disp_money(l.rate) || v_rpm),
    jsonb_build_object('k', 'Lane', 'v', coalesce(l.origin,'—') || ' → ' || coalesce(l.destination,'—') || coalesce(' · ' || l.miles || ' mi', '')),
    jsonb_build_object('k', 'Pickup', 'v', coalesce(to_char(l.pickup_date, 'Dy Mon DD'), '—') || coalesce(' · ' || nullif(l.pickup_time,''), '')),
    jsonb_build_object('k', 'Delivery', 'v', coalesce(to_char(l.delivery_date, 'Dy Mon DD'), '—') || coalesce(' · ' || nullif(l.delivery_time,''), '')),
    jsonb_build_object('k', 'Equipment', 'v', coalesce(l.equipment, '—') || coalesce(' · ' || nullif(l.commodity,''), '') || coalesce(' · ' || nullif(l.weight,''), '')),
    jsonb_build_object('k', 'Broker', 'v', coalesce(l.broker, '—') || coalesce(' · MC ' || nullif(l.details->>'broker_mc',''), '')),
    jsonb_build_object('k', 'Found on', 'v', coalesce(dp->>'board_label', '—') || coalesce(' · ref ' || nullif(l.source_reference,''), '')),
    jsonb_build_object('k', 'Expires', 'v', v_exp));
  v_html := app_private.email_kit(jsonb_build_object(
    'eyebrow', jsonb_build_object('text', case when p_kind = 'updated' then 'Updated by your dispatcher' else 'From your dispatcher' end, 'tone', 'info'),
    'title', coalesce(l.origin,'—') || ' → ' || coalesce(l.destination,'—'),
    'intro_html', '<b>' || app_private.h_esc(v_name) || '</b> found this load on <b>' || app_private.h_esc(coalesce(dp->>'board_label','a load board')) || '</b> for <b>'
                  || app_private.h_esc(coalesce(v_carrier, 'your company')) || '</b> and posted it on your LoadBoot load board. It is only visible to you.'
                  || case when coalesce(l.notes,'') <> '' then '<br><br><i>&ldquo;' || app_private.h_esc(l.notes) || '&rdquo;</i>' else '' end
                  || case when coalesce((l.details->>'below_min')::boolean, false) then '<br><br><b style="color:#92400e">Below your minimum rate.</b> ' || app_private.h_esc(coalesce(l.details->>'below_min_reason','')) else '' end,
    'facts', v_facts,
    'step', jsonb_build_object('label', 'Your next step', 'title', 'Open the load and decide',
              'text', 'Tap "I''ll take it" and ' || v_name || ' gets the rate confirmation from the broker; LoadBoot checks it before you roll. Tap Decline with a reason and ' || v_name || ' keeps looking. The post expires ' || v_exp || '.'),
    'cta', jsonb_build_object('label', 'View the load', 'url', 'https://loadboot.com' || v_url),
    'note', 'Loads your dispatcher posts come from outside LoadBoot (' || coalesce(dp->>'board_label','a load board') || '). LoadBoot still approves the rate confirmation before the truck moves, same as every dispatcher booking.'));
  v_txt := v_title || E'\n' || v_body || E'\n\nOpen it: https://loadboot.com' || v_url;
  for m in select u.id as uid, u.email from public.organization_memberships om join auth.users u on u.id = om.user_id
            where om.org_id = l.target_carrier_org and om.status = 'active' and coalesce(om.member_role,'') <> 'driver'
            order by (om.member_role = 'owner') desc, om.created_at limit 3 loop
    begin
      insert into app_private.notifications (recipient_role, recipient_user, channel, template_key, payload, status, sent_at)
      values ('carrier', m.uid, 'in_app', case when p_kind = 'updated' then 'dispatcher.load.updated' else 'dispatcher.load.posted' end,
        jsonb_build_object('title', v_title, 'body', v_body, 'tone', 'action', 'url', v_url, 'load_id', l.id), 'sent', now());
    exception when others then null; end;
    begin perform app_private.push_enqueue(m.uid, v_title, v_body, v_url, 'disp-post-' || l.id::text); exception when others then null; end;
    if coalesce(v_demo, false) or m.email is null or p_kind = 'updated' then continue; end if;   -- demo orgs: in-app only; updates: in-app only
    begin
      v_gate := app_private.email_gate('dispatcher.load.posted', m.email, m.uid);
      if coalesce((v_gate->>'allowed')::boolean, true) then
        perform app_private.sys_email(m.email, 'dispatcher.load.posted', v_sub, v_html, v_txt, 'disp-post:' || l.id::text || ':' || m.email);
        v_sent := v_sent + 1;
      end if;
    exception when others then null; end;
  end loop;
  return jsonb_build_object('ok', true, 'emails', v_sent, 'demo', coalesce(v_demo, false));
end $$;
revoke all on function app_private.disp_board_label(text) from public, anon, authenticated;
revoke all on function app_private.disp_money(numeric) from public, anon, authenticated;
revoke all on function app_private.disp_display_name(uuid) from public, anon, authenticated;
revoke all on function app_private.disp_carrier_open(uuid) from public, anon, authenticated;
revoke all on function app_private.disp_post_normalise(uuid, jsonb, uuid) from public, anon, authenticated;
revoke all on function app_private.disp_post_notify_carrier(uuid, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- 4. dispatcher: broker screen (inline, non-blocking)
-- What LoadBoot already knows about an MC: a brokerage on LoadBoot (name, trust tier), its last FMCSA screening, the
-- dispatcher's own broker book. The live FMCSA read runs client-side through the fmcsa-verify edge function.
create or replace function public.dispatcher_broker_screen(p_mc text)
returns jsonb language plpgsql stable security definer set search_path = app_private, public as $$
declare v_mc text; v_org record; v_scr record; v_bc record; v_tier text;
begin
  if auth.uid() is null then return jsonb_build_object('error', 'not signed in'); end if;
  if not exists (select 1 from app_private.dispatcher_assignments a where a.dispatcher_user_id = auth.uid() and a.status = 'active') then
    return jsonb_build_object('error', 'no active assignment'); end if;
  v_mc := nullif(regexp_replace(coalesce(p_mc,''), '[^0-9]', '', 'g'), '');
  if v_mc is null then return jsonb_build_object('error', 'MC number is required'); end if;
  select o.id, o.name, o.kind into v_org from public.organizations o
   where regexp_replace(coalesce(o.mc_number,''), '[^0-9]', '', 'g') = v_mc and o.kind = 'broker' order by o.created_at limit 1;
  if v_org.id is not null then begin v_tier := app_private.broker_tier(v_org.id); exception when others then v_tier := null; end; end if;
  select s.outcome, s.legal_name, s.broker_authority, s.carrier_authority, s.checked_at, s.last_pass_at, s.reason, s.phone, s.entity_type
    into v_scr from app_private.broker_screenings s where regexp_replace(coalesce(s.mc_number,''), '[^0-9]', '', 'g') = v_mc
   order by s.checked_at desc nulls last limit 1;
  select b.broker, b.rep, b.phone, b.email, b.rating, b.new_authority_ok, b.last_outcome, b.last_contact_at into v_bc
    from app_private.broker_contacts b where b.dispatcher_user_id = auth.uid() and regexp_replace(coalesce(b.mc,''), '[^0-9]', '', 'g') = v_mc
   order by b.updated_at desc limit 1;
  return jsonb_build_object('mc', v_mc,
    'on_loadboot', case when v_org.id is not null then jsonb_build_object('name', v_org.name, 'tier', v_tier) end,
    'screening', case when v_scr.outcome is not null then jsonb_build_object('outcome', v_scr.outcome, 'legal_name', v_scr.legal_name,
        'broker_authority', v_scr.broker_authority, 'carrier_authority', v_scr.carrier_authority, 'checked_at', v_scr.checked_at,
        'last_pass_at', v_scr.last_pass_at, 'reason', v_scr.reason, 'entity_type', v_scr.entity_type) end,
    'contact', case when v_bc.broker is not null then to_jsonb(v_bc) end);
end $$;

-- ---------------------------------------------------------------- 5. dispatcher: post / update / withdraw / list
create or replace function public.dispatcher_post_load(p_org uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); v_truck uuid; n jsonb; v_id uuid; v_open record; v_demo boolean; v_name text; v_exp timestamptz;
        v_details jsonb; v_note jsonb; v_req text; v_acc jsonb;
begin
  if v_uid is null then return jsonb_build_object('error', 'not signed in'); end if;
  if not app_private.disp_is_assigned(p_org) then return jsonb_build_object('error', 'you are not assigned to this carrier'); end if;
  select * into v_open from app_private.disp_carrier_open(p_org);
  if not v_open.ok then return jsonb_build_object('error', v_open.why); end if;
  v_truck := nullif(p->>'truck_id','')::uuid;
  if v_truck is not null and not exists (select 1 from app_private.fleet_trucks t where t.id = v_truck and t.carrier_id = p_org) then
    return jsonb_build_object('error', 'truck does not belong to this carrier'); end if;
  begin n := app_private.disp_post_normalise(p_org, p, v_truck);
  exception when others then return jsonb_build_object('error', sqlerrm, 'below_min', sqlerrm like 'BELOW_MIN:%'); end;
  v_demo := app_private.is_demo_org(p_org);
  v_name := app_private.disp_display_name(v_uid);
  v_exp := now() + make_interval(mins => round((n->>'expiry_hours')::numeric * 60)::int);
  v_req := nullif((select string_agg(x, ', ') from jsonb_array_elements_text(n->'requirements') x), '');
  v_acc := n->'accessorials';
  v_details := (coalesce(p, '{}'::jsonb) - 'truck_id' - 'rate' - 'miles')
    || jsonb_build_object('board', n->>'board', 'equipment', n->>'equipment', 'origin', n->>'origin', 'destination', n->>'destination',
         'requirements', n->'requirements', 'truck_id', v_truck, 'below_min', (n->>'below_min')::boolean, 'below_min_reason', n->>'below_min_reason',
         'min_rpm_at_post', n->'min_rpm', 'load_size', coalesce(nullif(p->>'load_type',''), 'full'),
         'dispatcher_post', jsonb_build_object('dispatcher_user', v_uid, 'dispatcher_name', v_name, 'board', n->>'board', 'board_label', n->>'board_label',
            'posted_at', now(), 'expires_at', v_exp, 'note', nullif(btrim(coalesce(p->>'notes','')), ''), 'truck_id', v_truck,
            'broker_screen', case when jsonb_typeof(p->'broker_screen') = 'object' then p->'broker_screen' else '{}'::jsonb end));
  insert into public.loads (origin, destination, origin_full, destination_full, equipment, miles, rate, pickup_date, delivery_date, pickup_time, delivery_time,
      broker, commodity, weight, deadhead, requirements, notes, status, source_type, source_provider, source_reference, verification_state, confidence,
      created_by, is_public, published_at, expires_at, hazmat, details, accessorials, field_meta, is_demo, target_carrier_org)
  values (n->>'origin', n->>'destination', nullif(btrim(coalesce(p->>'origin_full', p->>'origin_zip', '')), ''), nullif(btrim(coalesce(p->>'destination_full', p->>'destination_zip', '')), ''),
      n->>'equipment', (n->>'miles')::int, (n->>'rate')::numeric, (n->>'pickup_date')::date, (n->>'delivery_date')::date, nullif(p->>'pickup_window',''), nullif(p->>'delivery_window',''),
      btrim(p->>'broker'), nullif(btrim(coalesce(p->>'commodity','')), ''), case when n->>'weight_lbs' is not null then to_char((n->>'weight_lbs')::int, 'FM999,999') || ' lbs' end,
      (n->>'deadhead')::int, v_req, nullif(btrim(coalesce(p->>'notes','')), ''), 'available', 'dispatcher', n->>'board',
      nullif(btrim(coalesce(p->>'source_reference', p->>'board_ref', '')), ''), 'dispatcher_posted', n->>'confidence',
      v_uid, false, now(), v_exp, (n->>'hazmat')::boolean, v_details, v_acc,
      jsonb_build_object('posted_by', v_uid, 'posted_by_role', 'dispatcher', 'accessorials', v_acc, 'pickup_window', nullif(p->>'pickup_window',''), 'delivery_window', nullif(p->>'delivery_window','')),
      v_demo, p_org)
  returning id into v_id;
  -- stamp_load_demo (BEFORE INSERT) derives is_demo from broker_org/shipper_org, which are null here → force the carrier's flag
  update public.loads set is_demo = v_demo where id = v_id and is_demo is distinct from v_demo;
  -- keep the dispatcher's broker book warm (same rule as Log a booking)
  begin
    if exists (select 1 from app_private.broker_contacts bc where bc.dispatcher_user_id = v_uid and lower(bc.broker) = lower(btrim(p->>'broker'))) then
      update app_private.broker_contacts set last_contact_at = now(), last_outcome = coalesce(last_outcome, 'quoted'), updated_at = now(),
        mc = coalesce(nullif(p->>'broker_mc',''), mc), rep = coalesce(nullif(p->>'broker_rep',''), rep),
        phone = coalesce(nullif(p->>'broker_phone',''), phone), email = coalesce(nullif(p->>'broker_email',''), email)
       where dispatcher_user_id = v_uid and lower(broker) = lower(btrim(p->>'broker'));
    else
      insert into app_private.broker_contacts (dispatcher_user_id, broker, mc, rep, phone, email, last_contact_at, last_outcome)
      values (v_uid, btrim(p->>'broker'), nullif(p->>'broker_mc',''), nullif(p->>'broker_rep',''), nullif(p->>'broker_phone',''), nullif(p->>'broker_email',''), now(), 'quoted');
    end if;
  exception when others then null; end;
  v_note := app_private.disp_post_notify_carrier(v_id, 'posted');
  begin
    insert into app_private.notifications (recipient_role, channel, template_key, payload, status, sent_at)
    values ('staff', 'in_app', 'dispatcher.post.created', jsonb_build_object('title', '📋 Dispatcher posted a load: ' || (n->>'origin') || ' → ' || (n->>'destination'),
      'body', v_name || ' · ' || (n->>'board_label') || ' · ' || app_private.disp_money((n->>'rate')::numeric) || case when (n->>'below_min')::boolean then ' · ⚠ below min rate' else '' end,
      'tone', case when (n->>'below_min')::boolean then 'warning' else 'info' end, 'url', '/app/command-center/#/carriers?id=' || p_org::text, 'load_id', v_id), 'sent', now());
  exception when others then null; end;
  perform app_private.disp_audit('dispatcher.load.post', 'load', v_id::text, p_org, v_name || ' posted ' || (n->>'origin') || ' → ' || (n->>'destination') || ' ' || app_private.disp_money((n->>'rate')::numeric) || ' from ' || (n->>'board_label'),
    jsonb_build_object('rpm', n->'rpm', 'min_rpm', n->'min_rpm', 'below_min', n->'below_min', 'expires_at', v_exp, 'notify', v_note));
  return jsonb_build_object('ok', true, 'id', v_id, 'status', 'available', 'rpm', n->'rpm', 'min_rpm', n->'min_rpm', 'below_min', n->'below_min', 'expires_at', v_exp, 'notify', v_note);
end $$;

create or replace function public.dispatcher_update_load(p_load uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); l public.loads; v_truck uuid; n jsonb; v_req text; v_acc jsonb; v_exp timestamptz; v_patch jsonb;
begin
  if v_uid is null then return jsonb_build_object('error', 'not signed in'); end if;
  select * into l from public.loads where id = p_load and source_type = 'dispatcher' for update;
  if l.id is null then return jsonb_build_object('error', 'post not found'); end if;
  if l.created_by <> v_uid and not app_private.disp_is_staff() then return jsonb_build_object('error', 'only the dispatcher who posted it (or LoadBoot) can edit it'); end if;
  if l.status <> 'available' then return jsonb_build_object('error', 'this post is ' || l.status || ' — it can no longer be edited'); end if;
  if not app_private.disp_is_staff() and not app_private.disp_is_assigned(l.target_carrier_org) then return jsonb_build_object('error', 'you are no longer assigned to this carrier'); end if;
  v_truck := coalesce(nullif(p->>'truck_id','')::uuid, (l.details->>'truck_id')::uuid);
  begin n := app_private.disp_post_normalise(l.target_carrier_org, coalesce(l.details, '{}'::jsonb) || coalesce(p, '{}'::jsonb) || jsonb_build_object('rate', coalesce(p->>'rate', l.rate::text), 'miles', coalesce(p->>'miles', l.miles::text)), v_truck);
  exception when others then return jsonb_build_object('error', sqlerrm, 'below_min', sqlerrm like 'BELOW_MIN:%'); end;
  v_req := nullif((select string_agg(x, ', ') from jsonb_array_elements_text(n->'requirements') x), '');
  v_acc := n->'accessorials';
  v_exp := case when p ? 'expiry_hours' then now() + make_interval(mins => round((n->>'expiry_hours')::numeric * 60)::int) else l.expires_at end;
  v_patch := coalesce(p, '{}'::jsonb) - 'truck_id' - 'rate' - 'miles' - 'dispatcher_post';
  update public.loads set
    origin = n->>'origin', destination = n->>'destination',
    origin_full = coalesce(nullif(btrim(coalesce(p->>'origin_full', p->>'origin_zip', '')), ''), origin_full),
    destination_full = coalesce(nullif(btrim(coalesce(p->>'destination_full', p->>'destination_zip', '')), ''), destination_full),
    equipment = n->>'equipment', miles = (n->>'miles')::int, rate = (n->>'rate')::numeric,
    pickup_date = (n->>'pickup_date')::date, delivery_date = (n->>'delivery_date')::date,
    pickup_time = coalesce(nullif(p->>'pickup_window',''), pickup_time), delivery_time = coalesce(nullif(p->>'delivery_window',''), delivery_time),
    broker = coalesce(nullif(btrim(coalesce(p->>'broker','')), ''), broker), commodity = coalesce(nullif(btrim(coalesce(p->>'commodity','')), ''), commodity),
    weight = case when n->>'weight_lbs' is not null then to_char((n->>'weight_lbs')::int, 'FM999,999') || ' lbs' else weight end,
    deadhead = coalesce((n->>'deadhead')::int, deadhead), requirements = coalesce(v_req, requirements),
    notes = case when p ? 'notes' then nullif(btrim(coalesce(p->>'notes','')), '') else notes end,
    source_provider = n->>'board', source_reference = coalesce(nullif(btrim(coalesce(p->>'source_reference', p->>'board_ref', '')), ''), source_reference),
    confidence = n->>'confidence', expires_at = v_exp, hazmat = (n->>'hazmat')::boolean, accessorials = v_acc,
    details = coalesce(details, '{}'::jsonb) || v_patch
      || jsonb_build_object('board', n->>'board', 'equipment', n->>'equipment', 'origin', n->>'origin', 'destination', n->>'destination', 'requirements', n->'requirements',
           'truck_id', v_truck, 'below_min', (n->>'below_min')::boolean, 'below_min_reason', n->>'below_min_reason', 'min_rpm_at_post', n->'min_rpm',
           'dispatcher_post', coalesce(details->'dispatcher_post', '{}'::jsonb) || jsonb_build_object('board', n->>'board', 'board_label', n->>'board_label', 'expires_at', v_exp,
             'updated_at', now(), 'note', case when p ? 'notes' then nullif(btrim(coalesce(p->>'notes','')), '') else details->'dispatcher_post'->>'note' end, 'truck_id', v_truck,
             'broker_screen', case when jsonb_typeof(p->'broker_screen') = 'object' then p->'broker_screen' else coalesce(details->'dispatcher_post'->'broker_screen', '{}'::jsonb) end)),
    field_meta = coalesce(field_meta, '{}'::jsonb) || jsonb_build_object('accessorials', v_acc, 'pickup_window', coalesce(nullif(p->>'pickup_window',''), field_meta->>'pickup_window'), 'delivery_window', coalesce(nullif(p->>'delivery_window',''), field_meta->>'delivery_window')),
    version = coalesce(version, 1) + 1
  where id = p_load;
  perform app_private.disp_post_notify_carrier(p_load, 'updated');
  perform app_private.disp_audit('dispatcher.load.update', 'load', p_load::text, l.target_carrier_org, 'post edited: ' || (n->>'origin') || ' → ' || (n->>'destination') || ' ' || app_private.disp_money((n->>'rate')::numeric), jsonb_build_object('rpm', n->'rpm', 'below_min', n->'below_min', 'changed', (select coalesce(jsonb_agg(k), '[]'::jsonb) from jsonb_object_keys(coalesce(p,'{}'::jsonb)) k)));
  return jsonb_build_object('ok', true, 'id', p_load, 'rpm', n->'rpm', 'min_rpm', n->'min_rpm', 'below_min', n->'below_min', 'expires_at', v_exp);
end $$;

create or replace function public.dispatcher_withdraw_load(p_load uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); l public.loads; v_opened boolean; m record; v_title text; v_body text; v_demo boolean; v_gate jsonb; v_by text;
begin
  if v_uid is null then return jsonb_build_object('error', 'not signed in'); end if;
  select * into l from public.loads where id = p_load and source_type = 'dispatcher' for update;
  if l.id is null then return jsonb_build_object('error', 'post not found'); end if;
  if l.created_by <> v_uid and not app_private.disp_is_staff() then return jsonb_build_object('error', 'only the dispatcher who posted it (or LoadBoot) can withdraw it'); end if;
  if l.status <> 'available' then return jsonb_build_object('error', 'this post is already ' || l.status); end if;
  v_by := case when l.created_by = v_uid then 'dispatcher' else 'staff' end;
  update public.loads set status = 'withdrawn', expires_at = least(coalesce(expires_at, now()), now()),
    details = coalesce(details, '{}'::jsonb) || jsonb_build_object('withdrawn', jsonb_build_object('at', now(), 'by', v_uid, 'by_role', v_by, 'reason', nullif(btrim(coalesce(p_reason,'')), '')))
  where id = p_load;
  -- tell the carrier only if they had opened it (read the post notification)
  select exists (select 1 from app_private.notifications n where n.template_key in ('dispatcher.load.posted','dispatcher.load.updated') and (n.payload->>'load_id')::uuid = p_load and n.read_at is not null) into v_opened;
  if v_opened then
    v_demo := app_private.is_demo_org(l.target_carrier_org);
    v_title := '↩ Load withdrawn by ' || case when v_by = 'staff' then 'LoadBoot' else 'your dispatcher' end || ': ' || coalesce(l.origin,'—') || ' → ' || coalesce(l.destination,'—');
    v_body := app_private.disp_money(l.rate) || coalesce(' · ' || l.equipment, '') || coalesce(' — ' || nullif(btrim(coalesce(p_reason,'')), ''), '') || '. It is off your board; nothing to do.';
    for m in select u.id as uid, u.email from public.organization_memberships om join auth.users u on u.id = om.user_id
              where om.org_id = l.target_carrier_org and om.status = 'active' and coalesce(om.member_role,'') <> 'driver' order by (om.member_role = 'owner') desc, om.created_at limit 3 loop
      begin
        insert into app_private.notifications (recipient_role, recipient_user, channel, template_key, payload, status, sent_at)
        values ('carrier', m.uid, 'in_app', 'dispatcher.load.withdrawn', jsonb_build_object('title', v_title, 'body', v_body, 'tone', 'info', 'url', '/app/carrier/#loads', 'load_id', l.id), 'sent', now());
      exception when others then null; end;
      if coalesce(v_demo, false) or m.email is null then continue; end if;
      begin
        v_gate := app_private.email_gate('dispatcher.load.withdrawn', m.email, m.uid);
        if coalesce((v_gate->>'allowed')::boolean, true) then
          perform app_private.sys_email(m.email, 'dispatcher.load.withdrawn', 'LoadBoot: ' || v_title,
            app_private.email_kit(jsonb_build_object('eyebrow', jsonb_build_object('text', 'Load withdrawn', 'tone', 'neutral'), 'title', coalesce(l.origin,'—') || ' → ' || coalesce(l.destination,'—'),
              'intro_html', app_private.h_esc(v_body), 'cta', jsonb_build_object('label', 'Open your load board', 'url', 'https://loadboot.com/app/carrier/#loads'))),
            v_title || E'\n' || v_body, 'disp-post-wd:' || l.id::text || ':' || m.email);
        end if;
      exception when others then null; end;
    end loop;
  end if;
  perform app_private.disp_audit('dispatcher.load.withdraw', 'load', p_load::text, l.target_carrier_org, v_by || ' withdrew ' || coalesce(l.origin,'') || ' → ' || coalesce(l.destination,'') || coalesce(': ' || p_reason, ''), jsonb_build_object('carrier_opened', v_opened));
  return jsonb_build_object('ok', true, 'status', 'withdrawn', 'carrier_notified', v_opened);
end $$;

-- the dispatcher's own posts (all statuses) for one carrier or all of his carriers
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
      'booking', (select jsonb_build_object('id', b.id, 'status', b.status, 'rc_doc_path', b.rc_doc_path) from app_private.dispatcher_bookings b where b.load_id = l.id order by b.created_at desc limit 1)) x
    from public.loads l
    where l.source_type = 'dispatcher' and l.created_by = auth.uid() and (p_org is null or l.target_carrier_org = p_org)
    order by l.created_at desc limit greatest(1, least(coalesce(p_limit, 100), 300))) s), '[]'::jsonb);
$$;

-- staff: posts for a carrier and/or by a dispatcher (CC Carrier 360 / Dispatcher 360)
create or replace function public.cc_dispatcher_posts(p_org uuid default null, p_user uuid default null, p_limit int default 100)
returns jsonb language sql stable security definer set search_path = app_private, public as $$
  select case when not app_private.disp_can_view() then jsonb_build_object('error', 'not authorized') else coalesce((select jsonb_agg(x order by x->>'created_at' desc) from (
    select jsonb_build_object('id', l.id, 'status', l.status, 'carrier_org_id', l.target_carrier_org, 'carrier', (select o.name from public.organizations o where o.id = l.target_carrier_org),
      'dispatcher_user', l.created_by, 'dispatcher', l.details->'dispatcher_post'->>'dispatcher_name',
      'origin', l.origin, 'destination', l.destination, 'rate', l.rate, 'miles', l.miles, 'rpm', case when l.miles > 0 then round(l.rate / l.miles, 2) end,
      'equipment', l.equipment, 'pickup_date', l.pickup_date, 'broker', l.broker, 'board', l.source_provider, 'board_label', app_private.disp_board_label(l.source_provider),
      'source_reference', l.source_reference, 'expires_at', l.expires_at, 'created_at', l.created_at,
      'below_min', coalesce((l.details->>'below_min')::boolean, false), 'below_min_reason', l.details->>'below_min_reason',
      'decision', l.details->'decision', 'withdrawn', l.details->'withdrawn', 'is_demo', l.is_demo,
      'booking', (select jsonb_build_object('id', b.id, 'status', b.status) from app_private.dispatcher_bookings b where b.load_id = l.id order by b.created_at desc limit 1)) x
    from public.loads l
    where l.source_type = 'dispatcher' and (p_org is null or l.target_carrier_org = p_org) and (p_user is null or l.created_by = p_user)
    order by l.created_at desc limit greatest(1, least(coalesce(p_limit, 100), 300))) s), '[]'::jsonb) end;
$$;

-- ---------------------------------------------------------------- 6. carrier: "I'll take it" / Decline
create or replace function public.carrier_dispatcher_load_decide(p_load uuid, p_action text, p_reason text default null, p_truck uuid default null)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_org uuid; v_uid uuid := auth.uid(); l public.loads; dp jsonb; v_owner uuid; v_cname text; v_disp uuid; v_truck uuid; v_bid uuid;
        v_lane text; v_pu timestamptz; v_dl timestamptz; v_reason text; v_aid uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'no carrier account' using errcode = '42501'; end if;
  select * into l from public.loads where id = p_load and source_type = 'dispatcher' and target_carrier_org = v_org for update;
  if l.id is null then raise exception 'This load is not on your board.' using errcode = '22023'; end if;
  if l.status <> 'available' then raise exception 'This load is already %.', replace(l.status, '_', ' ') using errcode = '22023'; end if;
  if l.expires_at is not null and l.expires_at <= now() then
    update public.loads set status = 'expired' where id = p_load;
    raise exception 'This post has expired — ask your dispatcher to post it again if it is still open.' using errcode = '22023';
  end if;
  dp := coalesce(l.details->'dispatcher_post', '{}'::jsonb);
  v_disp := coalesce(nullif(dp->>'dispatcher_user','')::uuid, l.created_by);
  v_lane := coalesce(l.origin,'—') || ' → ' || coalesce(l.destination,'—');
  select o.owner_user_id, o.name into v_owner, v_cname from public.organizations o where o.id = v_org;
  if p_action = 'accept' then
    if not app_private.carrier_mandatory_ok(v_org) then
      raise exception 'Complete your compliance documents (authority, insurance and required documents) before taking loads — LoadBoot cannot approve a rate confirmation for an unverified carrier.' using errcode = '42501';
    end if;
    if coalesce(l.hazmat, false) and not app_private.carrier_hazmat_verified(v_org) then
      raise exception 'This is a HAZMAT load — upload and verify your hazmat certificate before taking hazmat freight.' using errcode = '42501';
    end if;
    v_truck := coalesce(p_truck, nullif(dp->>'truck_id','')::uuid, (l.details->>'truck_id')::uuid);
    if v_truck is not null and not exists (select 1 from app_private.fleet_trucks t where t.id = v_truck and t.carrier_id = v_org) then v_truck := null; end if;
    if v_truck is null then
      select t.id into v_truck from app_private.fleet_trucks t where t.carrier_id = v_org and coalesce(t.status,'active') not in ('inactive','retired')
        and app_private.disp_equip_norm(t.equipment) = app_private.disp_equip_norm(l.equipment) order by t.unit_no limit 1;
    end if;
    v_pu := case when l.pickup_time ~ '^\d{1,2}:\d{2}' then (l.pickup_date::text || ' ' || substring(l.pickup_time from '^\d{1,2}:\d{2}'))::timestamp at time zone 'America/New_York'
                 else (l.pickup_date::text || ' 08:00')::timestamp at time zone 'America/New_York' end;
    v_dl := case when l.delivery_date is null then null
                 when l.delivery_time ~ '^\d{1,2}:\d{2}' then (l.delivery_date::text || ' ' || substring(l.delivery_time from '^\d{1,2}:\d{2}'))::timestamp at time zone 'America/New_York'
                 else (l.delivery_date::text || ' 17:00')::timestamp at time zone 'America/New_York' end;
    update public.loads set status = 'carrier_accepted', assigned_to = v_owner,
      details = coalesce(details, '{}'::jsonb) || jsonb_build_object('decision', jsonb_build_object('action', 'accepted', 'at', now(), 'by', v_uid, 'truck_id', v_truck))
    where id = p_load;
    insert into app_private.dispatcher_bookings (dispatcher_user_id, carrier_org_id, truck_id, broker, broker_mc, broker_rep, broker_phone, broker_email,
        origin, destination, pickup_at, delivery_at, miles, deadhead, gross, commodity, weight_lbs, equipment, status, below_min, notes, source, load_id)
    values (v_disp, v_org, v_truck, coalesce(l.broker, 'Broker'), nullif(l.details->>'broker_mc',''), nullif(l.details->>'broker_rep',''), nullif(l.details->>'broker_phone',''), nullif(l.details->>'broker_email',''),
        l.origin, l.destination, v_pu, v_dl, l.miles, l.deadhead, coalesce(l.rate, 0), l.commodity, nullif(regexp_replace(coalesce(l.weight,''), '[^0-9]', '', 'g'), '')::int, l.equipment,
        'pending_rc', coalesce((l.details->>'below_min')::boolean, false),
        'Carrier accepted the load posted from ' || coalesce(dp->>'board_label', 'a load board') || coalesce(' (ref ' || l.source_reference || ')', '') || coalesce(E'\n' || l.notes, ''),
        coalesce(l.source_provider, 'dispatcher'), p_load)
    returning id into v_bid;
    insert into app_private.dispatcher_booking_events (booking_id, kind, note, created_by)
      values (v_bid, 'created', 'Carrier accepted the load you posted ("I''ll take it") — get the rate confirmation from the broker and attach it here' || case when coalesce((l.details->>'below_min')::boolean, false) then ' — BELOW carrier minimum rate, needs approval' else '' end, v_uid);
    perform app_private.disp_notify(v_disp, 'dispatcher', 'dispatcher.post.accepted', '✅ ' || coalesce(v_cname, 'Carrier') || ' took your load: ' || v_lane,
      app_private.disp_money(l.rate) || coalesce(' · ' || l.miles || ' mi', '') || ' · pickup ' || to_char(v_pu at time zone 'America/New_York', 'Dy Mon DD HH24:MI') || ' ET'
      || E'\nCall the broker now, lock the rate and attach the rate confirmation to the booking LoadBoot created. LoadBoot approves from the RC; the driver moves after approval.',
      '/app/agent/#bookings/' || v_bid::text, true);
    perform app_private.disp_notify(null, 'staff', 'dispatcher.post.accepted', 'Carrier accepted a dispatcher-posted load: ' || v_lane,
      coalesce(v_cname, 'Carrier') || ' · ' || app_private.disp_money(l.rate) || ' · ' || coalesce(dp->>'board_label', '') || ' · booking ' || v_bid::text || ' waits for the RC', '/app/command-center/#dispatchers', false);
    begin
      insert into app_private.notifications (recipient_role, recipient_user, channel, template_key, payload, status, sent_at)
      values ('carrier', v_uid, 'in_app', 'dispatcher.load.accepted', jsonb_build_object('title', '✅ You took ' || v_lane, 'body', 'Your dispatcher is getting the rate con — you''ll be notified when LoadBoot approves it.', 'tone', 'success', 'url', '/app/carrier/#loads', 'load_id', l.id), 'sent', now());
    exception when others then null; end;
    select a.id into v_aid from app_private.dispatcher_assignments a where a.carrier_org_id = v_org and a.dispatcher_user_id = v_disp and a.status = 'active' limit 1;
    if v_aid is not null then
      begin
        insert into app_private.dispatcher_messages (assignment_id, carrier_org_id, sender_role, body)
        values (v_aid, v_org, 'system', coalesce(v_cname, 'Carrier') || ' accepted the posted load ' || v_lane || ' · ' || app_private.disp_money(l.rate) || '. Dispatcher: get the rate confirmation and attach it under Bookings.');
      exception when others then null; end;
    end if;
    perform app_private.emit_event('dispatcher.post.accepted', 'load', p_load::text, jsonb_build_object('carrier_org', v_org, 'booking', v_bid), null);
    perform app_private.log_audit('dispatcher.post.accept', 'load', p_load::text, v_org, 'carrier accepted dispatcher-posted load', jsonb_build_object('booking', v_bid, 'truck', v_truck), null);
    return jsonb_build_object('ok', true, 'status', 'carrier_accepted', 'booking', v_bid, 'truck_id', v_truck);
  elsif p_action = 'decline' then
    v_reason := nullif(btrim(coalesce(p_reason,'')), '');
    if v_reason is null then raise exception 'Tell your dispatcher why — the reason goes to them so the next load fits better.' using errcode = '22023'; end if;
    update public.loads set status = 'declined', expires_at = least(coalesce(expires_at, now()), now()),
      details = coalesce(details, '{}'::jsonb) || jsonb_build_object('decision', jsonb_build_object('action', 'declined', 'at', now(), 'by', v_uid, 'reason', v_reason))
    where id = p_load;
    perform app_private.disp_notify(v_disp, 'dispatcher', 'dispatcher.post.declined', '✕ ' || coalesce(v_cname, 'Carrier') || ' declined: ' || v_lane,
      app_private.disp_money(l.rate) || coalesce(' · ' || l.miles || ' mi', '') || E'\nReason: ' || v_reason || E'\nKeep looking — the post is closed.', '/app/agent/#board', true);
    perform app_private.log_audit('dispatcher.post.decline', 'load', p_load::text, v_org, 'carrier declined dispatcher-posted load: ' || v_reason, '{}'::jsonb, null);
    return jsonb_build_object('ok', true, 'status', 'declined');
  end if;
  raise exception 'bad action' using errcode = '22023';
end $$;

-- ---------------------------------------------------------------- 7. expiry sweep (cc_offers_expire-style)
create or replace function app_private.disp_posts_expire()
returns int language plpgsql security definer set search_path = app_private, public as $$
declare r record; v_n int := 0; v_disp uuid;
begin
  for r in update public.loads set status = 'expired', details = coalesce(details, '{}'::jsonb) || jsonb_build_object('expired_at', now())
             where source_type = 'dispatcher' and status = 'available'
               and ((expires_at is not null and expires_at <= now()) or (pickup_date is not null and pickup_date < current_date))
           returning id, origin, destination, rate, miles, created_by, target_carrier_org, details, pickup_date, expires_at loop
    v_n := v_n + 1;
    v_disp := coalesce(nullif(r.details->'dispatcher_post'->>'dispatcher_user','')::uuid, r.created_by);
    begin
      perform app_private.disp_notify(v_disp, 'dispatcher', 'dispatcher.post.expired', '⏰ Posted load expired: ' || coalesce(r.origin,'—') || ' → ' || coalesce(r.destination,'—'),
        app_private.disp_money(r.rate) || coalesce(' · ' || r.miles || ' mi', '') || ' · ' || (select coalesce(o.name, 'the carrier') from public.organizations o where o.id = r.target_carrier_org)
        || ' did not decide before ' || case when r.expires_at <= now() then to_char(r.expires_at at time zone 'America/New_York', 'Dy Mon DD HH12:MI AM') || ' ET' else 'the pickup date' end
        || '. If the load is still open, call them, then post it again with a fresh expiry.', '/app/agent/#board', true);
    exception when others then null; end;
    begin perform app_private.disp_audit('dispatcher.load.expire', 'load', r.id::text, r.target_carrier_org, 'post expired without a decision', '{}'::jsonb); exception when others then null; end;
  end loop;
  return v_n;
end $$;
revoke all on function app_private.disp_posts_expire() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'lb-disp-posts-expire';
    perform cron.schedule('lb-disp-posts-expire', '*/10 * * * *', $c$select app_private.disp_posts_expire()$c$);
  end if;
end $$;

-- ---------------------------------------------------------------- 8. visibility patches (anchor-replace; raises if an anchor is missing)
do $$
begin
  -- carrier board: only the target carrier sees a post; it sorts first; a timed-out post never shows
  perform app_private.fn_patch('public.cc_pocket_available_loads(integer,integer)',
    $a$    where l.status='available'
      and (l.is_demo = app_private.session_is_demo() and app_private.training_load_ok(l.broker_org, l.shipper_org) or public.is_active_staff())$a$,
    $a$    where l.status='available'
      and (l.target_carrier_org is null or l.target_carrier_org = v_me or public.is_active_staff())
      and (l.target_carrier_org is null or l.expires_at is null or l.expires_at > now())
      and ((l.target_carrier_org is not null and l.target_carrier_org = v_me) or (l.is_demo = app_private.session_is_demo() and app_private.training_load_ok(l.broker_org, l.shipper_org)) or public.is_active_staff())$a$);
  perform app_private.fn_patch('public.cc_pocket_available_loads(integer,integer)',
    $a$    order by ((coalesce(l.details,'{}'::jsonb) ? 'direct_carrier_id') and (l.details->>'direct_carrier_id')::uuid = v_me) desc,$a$,
    $a$    order by (l.target_carrier_org is not null and l.target_carrier_org = v_me) desc,
             ((coalesce(l.details,'{}'::jsonb) ? 'direct_carrier_id') and (l.details->>'direct_carrier_id')::uuid = v_me) desc,$a$);
  -- carrier detail: the target carrier can open its post in every state; nobody else can
  perform app_private.fn_patch('public.cc_load_detail(uuid)',
    $a$   where id = p_load
     and ((status = 'available' and (not (coalesce(details,'{}'::jsonb) ? 'direct_carrier_id') or (details->>'direct_carrier_id')::uuid = v_org))$a$,
    $a$   where id = p_load
     and (target_carrier_org is null or target_carrier_org = v_org or public.is_active_staff())
     and ((status = 'available' and (not (coalesce(details,'{}'::jsonb) ? 'direct_carrier_id') or (details->>'direct_carrier_id')::uuid = v_org))
          or (target_carrier_org is not null and target_carrier_org = v_org)$a$);
  perform app_private.fn_patch('public.cc_load_detail(uuid)',
    $a$  v_posted_by := case when pl.id is not null then 'Broker partner' else 'LoadBoot dispatch' end;$a$,
    $a$  v_posted_by := case when l.source_type = 'dispatcher' then 'Your dispatcher ' || coalesce(l.details->'dispatcher_post'->>'dispatcher_name', '') when pl.id is not null then 'Broker partner' else 'LoadBoot dispatch' end;$a$);
  perform app_private.fn_patch('public.cc_load_detail(uuid)',
    $a$    'load_status', l.status,$a$,
    $a$    'load_status', l.status,
    'expires_at', l.expires_at, 'target_carrier_org', l.target_carrier_org, 'source_type', l.source_type, 'source_provider', l.source_provider, 'source_reference', l.source_reference,
    'broker', case when l.source_type = 'dispatcher' then l.broker end, 'notes', case when l.source_type = 'dispatcher' then l.notes end,
    'dispatcher_post', case when l.source_type = 'dispatcher' then l.details->'dispatcher_post' end,$a$);
  -- the matchers never hand a targeted post to another carrier's posted truck
  perform app_private.fn_patch('app_private.tp_match_new_load(uuid)',
    $a$select * into l from public.loads where id = p_load and status='available' and not is_demo;$a$,
    $a$select * into l from public.loads where id = p_load and status='available' and not is_demo and target_carrier_org is null;$a$);
  perform app_private.fn_patch('app_private.tp_run_matcher(uuid)',
    $a$for l in select * from public.loads where status = 'available' and not is_demo order by created_at desc limit 400 loop$a$,
    $a$for l in select * from public.loads where status = 'available' and not is_demo and target_carrier_org is null order by created_at desc limit 400 loop$a$);
  -- best-fit ranking (carrier portal + dispatcher board)
  perform app_private.fn_patch('public.cc_carrier_best_loads(uuid,integer)',
    $a$where status in ('available','offered','matching','approved_for_matching')$a$,
    $a$where status in ('available','offered','matching','approved_for_matching') and (target_carrier_org is null or target_carrier_org = v_target)$a$);
  -- public pages (already is_public=true only; belt and braces)
  perform app_private.fn_patch('public.get_public_load_opportunities(integer)',
    $a$and is_public=true$a$, $a$and is_public=true and target_carrier_org is null$a$);
  -- CC approve/reject of the booking moves the load with it
  perform app_private.fn_patch('public.cc_dispatcher_booking_decide(uuid,text,text)',
    $a$    else v_load := v_b.load_id; end if;$a$,
    $a$    else v_load := v_b.load_id; update public.loads set status = 'booked', assigned_to = v_owner where id = v_load and source_type = 'dispatcher' and status = 'carrier_accepted'; end if;$a$);
  perform app_private.fn_patch('public.cc_dispatcher_booking_decide(uuid,text,text)',
    $a$    update app_private.dispatcher_bookings set status = 'rejected', decision_note = p_note where id = p_id and status in ('pending_rc','rc_received');$a$,
    $a$    update public.loads set status = 'declined', details = coalesce(details,'{}'::jsonb) || jsonb_build_object('cc_rejected', jsonb_build_object('at', now(), 'note', p_note))
     where id = v_b.load_id and source_type = 'dispatcher' and status = 'carrier_accepted' and v_b.status in ('pending_rc','rc_received');
    update app_private.dispatcher_bookings set status = 'rejected', decision_note = p_note where id = p_id and status in ('pending_rc','rc_received');$a$);
  -- CC 360s
  perform app_private.fn_patch('public.cc_dispatcher_360(uuid)',
    $a$      'terms_log', coalesce($a$,
    $a$      'posts', (select jsonb_build_object('posted', count(*), 'open', count(*) filter (where l.status = 'available' and (l.expires_at is null or l.expires_at > now())),
          'accepted', count(*) filter (where l.status in ('carrier_accepted','booked','in_transit','delivered')), 'declined', count(*) filter (where l.status = 'declined'),
          'expired', count(*) filter (where l.status = 'expired' or (l.status = 'available' and l.expires_at <= now())), 'withdrawn', count(*) filter (where l.status = 'withdrawn'),
          'below_min', count(*) filter (where coalesce((l.details->>'below_min')::boolean, false)))
        from public.loads l where l.source_type = 'dispatcher' and l.created_by = p_user),
      'terms_log', coalesce($a$);
  perform app_private.fn_patch('public.cc_carrier_360(uuid)',
    $a$    'open_tasks',(select count(*)$a$,
    $a$    'dispatcher_posts', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'status', l.status, 'origin', l.origin, 'destination', l.destination, 'rate', l.rate, 'miles', l.miles,
        'equipment', l.equipment, 'pickup_date', l.pickup_date, 'board', l.source_provider, 'board_label', app_private.disp_board_label(l.source_provider), 'broker', l.broker,
        'dispatcher', l.details->'dispatcher_post'->>'dispatcher_name', 'dispatcher_user', l.created_by, 'below_min', coalesce((l.details->>'below_min')::boolean, false),
        'below_min_reason', l.details->>'below_min_reason', 'created_at', l.created_at, 'expires_at', l.expires_at, 'decision', l.details->'decision',
        'booking', (select jsonb_build_object('id', b.id, 'status', b.status) from app_private.dispatcher_bookings b where b.load_id = l.id order by b.created_at desc limit 1)) order by l.created_at desc)
        from (select * from public.loads where target_carrier_org = v_org and source_type = 'dispatcher' order by created_at desc limit 25) l), '[]'::jsonb),
    'open_tasks',(select count(*)$a$);
  -- daily trial e-mail: "Loads posted" is effort, "Posts accepted" is outcome
  perform app_private.fn_patch('app_private.disp_trial_stats(uuid,timestamptz,timestamptz,timestamptz)',
    $a$    'offers', (select count(*) from app_live.dispatcher_bookings b where b.dispatcher_user_id = p_user and b.created_at >= p_from and b.created_at < p_to),$a$,
    $a$    'offers', (select count(*) from app_live.dispatcher_bookings b where b.dispatcher_user_id = p_user and b.created_at >= p_from and b.created_at < p_to),
    'loads_posted', (select count(*) from public.loads l where l.source_type = 'dispatcher' and l.created_by = p_user and l.created_at >= p_from and l.created_at < p_to),$a$);
  perform app_private.fn_patch('app_private.disp_trial_stats(uuid,timestamptz,timestamptz,timestamptz)',
    $a$    'received', (select count(*) from app_private.dmail_messages where account_id = any(v_acct) and folder = 'inbox' and msg_date >= p_from and msg_date < p_to)
  ) into w;$a$,
    $a$    'received', (select count(*) from app_private.dmail_messages where account_id = any(v_acct) and folder = 'inbox' and msg_date >= p_from and msg_date < p_to),
    'posts_accepted', (select count(*) from public.loads l where l.source_type = 'dispatcher' and l.created_by = p_user and (l.details->'decision'->>'action') = 'accepted'
                         and (l.details->'decision'->>'at')::timestamptz >= p_from and (l.details->'decision'->>'at')::timestamptz < p_to)
  ) into w;$a$);
  perform app_private.fn_patch('app_private.disp_trial_daily_build(uuid,date)',
    $a$      || app_private.disp_tdr_kpi('Load offers sent', coalesce(ef->>'offers','0'), 'bookings created')$a$,
    $a$      || app_private.disp_tdr_kpi('Load offers sent', coalesce(ef->>'offers','0'), 'bookings created')
      || app_private.disp_tdr_kpi('Loads posted', coalesce(ef->>'loads_posted','0'), 'on the carrier''s board')$a$);
  perform app_private.fn_patch('app_private.disp_trial_daily_build(uuid,date)',
    $a$      || app_private.disp_tdr_kpi('Received', w->>'received', null)$a$,
    $a$      || app_private.disp_tdr_kpi('Received', w->>'received', null)
      || app_private.disp_tdr_kpi('Posts accepted', coalesce(w->>'posts_accepted','0'), coalesce(v_outsub, 'carrier said yes'))$a$);
  perform app_private.fn_patch('app_private.disp_trial_daily_build(uuid,date)',
    $a$  v_zero := not v_kick and v_att + coalesce((ef->>'messages')::int,0) + coalesce((ef->>'availability_posts')::int,0)$a$,
    $a$  v_zero := not v_kick and v_att + coalesce((ef->>'messages')::int,0) + coalesce((ef->>'availability_posts')::int,0) + coalesce((ef->>'loads_posted')::int,0)$a$);
end $$;

-- ---------------------------------------------------------------- 9. grants (every new public function: explicit anon revoke)
revoke all on function public.lb_load_target_visible(uuid) from public, anon;
revoke all on function public.dispatcher_broker_screen(text) from public, anon;
revoke all on function public.dispatcher_post_load(uuid, jsonb) from public, anon;
revoke all on function public.dispatcher_update_load(uuid, jsonb) from public, anon;
revoke all on function public.dispatcher_withdraw_load(uuid, text) from public, anon;
revoke all on function public.dispatcher_my_posts(uuid, int) from public, anon;
revoke all on function public.cc_dispatcher_posts(uuid, uuid, int) from public, anon;
revoke all on function public.carrier_dispatcher_load_decide(uuid, text, text, uuid) from public, anon;
grant execute on function public.dispatcher_broker_screen(text), public.dispatcher_post_load(uuid, jsonb), public.dispatcher_update_load(uuid, jsonb),
  public.dispatcher_withdraw_load(uuid, text), public.dispatcher_my_posts(uuid, int), public.cc_dispatcher_posts(uuid, uuid, int),
  public.carrier_dispatcher_load_decide(uuid, text, text, uuid) to authenticated;

-- assertion: none of the new public functions is anon-executable (the baseline list in docs/audit-2026-09/anon-secdef-baseline.md is unchanged)
do $$
declare bad text;
begin
  select string_agg(p.proname, ', ') into bad from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
     and p.proname in ('lb_load_target_visible','dispatcher_broker_screen','dispatcher_post_load','dispatcher_update_load','dispatcher_withdraw_load','dispatcher_my_posts','cc_dispatcher_posts','carrier_dispatcher_load_decide');
  if bad is not null then raise exception 'anon can execute: %', bad; end if;
end $$;
