-- bl_onb_0565 — premium email on EVERY partner onboarding decision (owner, 23 Oct 2026)
--
-- public.cc_onboarding_review_item (brokers + shippers) only emailed on reject and on the final
-- verify. Owner: "har reject/accept pe premium branded email jani chahiye, jaise carrier ko jati hai".
-- Fixes, all inside the email loop (the rest of the function is untouched — patched by anchor):
--   1. verify (not last)  -> onboarding.item_verified  (NEW key)
--   2. waive              -> onboarding.item_waived    (NEW key)
--   3. reject / complete  -> same keys, now built with app_private.email_kit (the ONE premium body, §10)
--   4. idempotency key carried no recipient and no time: only the FIRST member got the email, and a
--      second rejection of the same item never emailed again. Now <org>:<key>:<action>:<second>:<email>.
--   5. reviewer note was concatenated raw into HTML; email_kit escapes every text field.
-- SMS: not added — §6.6 limits catalog SMS to carrier emails; brokers/shippers are not carriers.

insert into app_private.email_catalog as c
  (key, name, purpose, class, audience_role, trigger_type, trigger_source, cadence, cap_note, stop_condition,
   preference_group, unsub_allowed, status, cc_deep_link, owner_note)
values
  ('onboarding.item_verified', 'Partner item verified',
   'Broker/shipper onboarding: one packet item was verified by staff and more required items remain. '
   || 'email_kit body: what was verified, how many required items are left, Open onboarding.',
   'T', 'partner', 'event', 'public.cc_onboarding_review_item (verify, not last)', 'per decision',
   'one per item decision per recipient', 'n/a — transactional',
   'compliance', false, 'live', '#/partners', 'Created 23 Oct 2026 (bl_onb_0565).'),
  ('onboarding.item_waived', 'Partner item waived',
   'Broker/shipper onboarding: staff waived one packet item with a written reason. email_kit body with the reason.',
   'T', 'partner', 'event', 'public.cc_onboarding_review_item (waive)', 'per decision',
   'one per item decision per recipient', 'n/a — transactional',
   'compliance', false, 'live', '#/partners', 'Created 23 Oct 2026 (bl_onb_0565).')
on conflict (key) do update set
  name = excluded.name, purpose = excluded.purpose, class = excluded.class, audience_role = excluded.audience_role,
  trigger_type = excluded.trigger_type, trigger_source = excluded.trigger_source, cadence = excluded.cadence,
  cap_note = excluded.cap_note, stop_condition = excluded.stop_condition, preference_group = excluded.preference_group,
  unsub_allowed = excluded.unsub_allowed, status = excluded.status, cc_deep_link = excluded.cc_deep_link,
  owner_note = excluded.owner_note, updated_at = now();

update app_private.email_catalog
   set owner_note = coalesce(owner_note || ' ', '') || 'Body moved to email_kit + per-recipient idempotency (bl_onb_0565, 23 Oct 2026).',
       updated_at = now()
 where key in ('onboarding.item_reject', 'onboarding.complete');

do $mig$
declare
  d text := pg_get_functiondef('public.cc_onboarding_review_item(uuid,text,text,text)'::regprocedure);
  a_decl text := 'declare m record; v_label text; v_name text; v_complete boolean; v_sub text; v_html text;';
  a_from text := '  for m in select u.id uid, u.email';
  a_to   text := '  return jsonb_build_object(''ok'', true';
  p1 int; p2 int;
  blk text := $blk$  -- bl_onb_0565: one premium email per decision, email_kit body, per-recipient idempotency.
  select count(*)::int into v_left
    from app_private.onboarding_packet_templates t
    join public.organizations o on o.kind = t.org_kind and o.id = p_org
    left join app_private.org_onboarding_items i on i.org_id = p_org and i.item_key = t.item_key
   where app_private.packet_tag_mandatory(t.status_tag) and coalesce(i.status, 'pending') not in ('verified', 'waived');
  v_kit := null; v_ekey := null;
  if p_action = 'reject' then
    v_ekey := 'onboarding.item_reject';
    v_sub := 'Action needed — ' || v_label || ' was not accepted';
    v_kit := jsonb_build_object(
      'eyebrow', jsonb_build_object('text', 'Action needed', 'tone', 'danger'),
      'title', v_label || ' was not accepted',
      'intro', 'Hi ' || coalesce(v_name, 'there') || ', our compliance team reviewed this onboarding item and could not accept it yet.',
      'card', jsonb_build_object('title', 'Reviewer note', 'tone', 'danger', 'items', jsonb_build_array(coalesce(p_note, ''))),
      'facts', jsonb_build_array(jsonb_build_object('k', 'Item', 'v', v_label), jsonb_build_object('k', 'Status', 'v', 'Needs a fix')),
      'step', jsonb_build_object('title', 'Fix it and resubmit', 'text', 'Open Onboarding, replace this item and resubmit. We review within 1 business day.'),
      'cta', jsonb_build_object('label', 'Open onboarding', 'url', 'https://loadboot.com/app/partner/#onboarding'));
  elsif p_action = 'waive' then
    v_ekey := 'onboarding.item_waived';
    v_sub := v_label || ' — waived, nothing to send';
    v_kit := jsonb_build_object(
      'eyebrow', jsonb_build_object('text', 'Item waived', 'tone', 'info'),
      'title', v_label || ' is waived',
      'intro', 'Hi ' || coalesce(v_name, 'there') || ', you do not need to submit this item. Our compliance team waived it for your account.',
      'card', jsonb_build_object('title', 'Reviewer note', 'tone', 'info', 'items', jsonb_build_array(coalesce(p_note, ''))),
      'facts', jsonb_build_array(jsonb_build_object('k', 'Item', 'v', v_label),
                                 jsonb_build_object('k', 'Required items still open', 'v', v_left::text)),
      'cta', jsonb_build_object('label', 'Open onboarding', 'url', 'https://loadboot.com/app/partner/#onboarding'));
  elsif p_action = 'verify' and v_complete then
    v_ekey := 'onboarding.complete';
    v_sub := 'Onboarding complete — you are fully verified';
    v_kit := jsonb_build_object(
      'eyebrow', jsonb_build_object('text', 'Fully verified', 'tone', 'success'),
      'title', 'Welcome aboard — your onboarding is complete',
      'intro', 'Hi ' || coalesce(v_name, 'there') || ', every required onboarding item is now verified. Your account is active.',
      'card', jsonb_build_object('title', 'What is open for you', 'tone', 'success', 'items', case when v_kind = 'shipper'
        then jsonb_build_array('Request quotes and tender shipments', 'GPS-verified tracking from pickup to delivery')
        else jsonb_build_array('Post loads to the LoadBoot board', 'Send direct offers to verified carriers', 'GPS-verified tracking from pickup to delivery') end),
      'facts', jsonb_build_array(jsonb_build_object('k', 'Last item verified', 'v', v_label), jsonb_build_object('k', 'Account', 'v', 'Active')),
      'step', jsonb_build_object('title', case when v_kind = 'shipper' then 'Send your first shipment' else 'Post your first load' end,
                                 'text', 'Open your dashboard. The first eligible carrier to accept books it.'),
      'cta', jsonb_build_object('label', 'Open dashboard', 'url', 'https://loadboot.com/app/partner/'));
  elsif p_action = 'verify' then
    v_ekey := 'onboarding.item_verified';
    v_sub := '✓ ' || v_label || ' verified';
    v_kit := jsonb_build_object(
      'eyebrow', jsonb_build_object('text', 'Verified', 'tone', 'success'),
      'title', v_label || ' is verified',
      'intro', 'Hi ' || coalesce(v_name, 'there') || ', our compliance team reviewed and verified this onboarding item. One step closer.',
      'facts', jsonb_build_array(jsonb_build_object('k', 'Item', 'v', v_label),
                                 jsonb_build_object('k', 'Status', 'v', 'Verified'),
                                 jsonb_build_object('k', 'Required items still open', 'v', v_left::text)),
      'step', jsonb_build_object('title', 'Finish the rest of your packet', 'text', 'Open Onboarding to see what is still in review or missing.'),
      'cta', jsonb_build_object('label', 'Open onboarding', 'url', 'https://loadboot.com/app/partner/#onboarding'));
  end if;
  if v_kit is not null then
    v_html := app_private.email_kit(v_kit);
    for m in select u.id uid, u.email from public.organization_memberships om join auth.users u on u.id = om.user_id
             where om.org_id = p_org and om.status = 'active' and u.email is not null limit 3 loop
      begin
        perform app_private.sys_email(m.email, v_ekey, v_sub, v_html, v_sub,
          'onbitem:' || p_org || ':' || p_key || ':' || p_action || ':' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISS') || ':' || lower(m.email));
      exception when others then null; end;
    end loop;
  end if;
$blk$;
begin
  if position(a_decl in d) = 0 then raise exception 'bl_onb_0565: declare anchor not found'; end if;
  d := replace(d, a_decl, a_decl || ' v_left int; v_kit jsonb; v_ekey text; v_kind text := (select kind from public.organizations where id = p_org);');
  p1 := position(a_from in d); p2 := position(a_to in d);
  if p1 = 0 or p2 = 0 or p2 < p1 then raise exception 'bl_onb_0565: loop anchors not found'; end if;
  d := substr(d, 1, p1 - 1) || blk || substr(d, p2);
  execute d;
end $mig$;
