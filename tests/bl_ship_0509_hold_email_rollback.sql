-- bl_ship_0509 + 0509b rollback test (staging only). One DO block that ends with RAISE, so nothing is kept (deliveries, bells, pg_net).
-- Throwaway shippers: A (hold → re-hold → release), B (release while not held), C (failed call-back).
-- Staff = the 0499 staging test staff user.
do $$
declare
  v_staff uuid := '4e57f205-4dc6-4379-9d68-b66c3db151f8';
  u uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  o uuid[] := array[gen_random_uuid(), gen_random_uuid(), gen_random_uuid()];
  i int; n int; j text; m jsonb; b text; ok text[] := '{}'; bad text[] := '{}';
begin
  for i in 1..3 loop
    insert into auth.users(id, email, email_confirmed_at, aud, role) values (u[i], 'bl0509-' || left(u[i]::text, 8) || '@bl0509test.com', now(), 'authenticated', 'authenticated');
    insert into public.organizations(id, kind, name, owner_user_id) values (o[i], 'shipper', 'BL0509 Test ' || i || ' LLC', u[i]);
    insert into app_private.shipper_trust(org_id) values (o[i]) on conflict do nothing;
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);

  -- T1 hold on a new shipper: one shipper.hold email, bell without "..", no double space
  perform public.cc_shipper_trust_set(o[1], 'hold', 'Our team needs to confirm your company by phone on a number we look up ourselves.');
  select count(*) into n from app_private.message_deliveries where recipient_email = 'bl0509-' || left(u[1]::text, 8) || '@bl0509test.com' and template_key = 'shipper.hold';
  select meta into m from app_private.message_deliveries where recipient_email = 'bl0509-' || left(u[1]::text, 8) || '@bl0509test.com' and template_key = 'shipper.hold' limit 1;
  select body into b from app_private.partner_notifications where partner_org = o[1] and title = '⛔ Posting paused' limit 1;
  if n = 1 then ok := ok || text 'T1 hold → 1 email'; else bad := bad || ('T1 hold emails=' || n); end if;
  if b like '%ourselves. Contact support%' and b not like '%..%' and b not like '%  %' then ok := ok || text 'T1 bell text clean'; else bad := bad || ('T1 bell: ' || coalesce(b, 'null')); end if;
  if m->>'body_html' like '%ourselves.</p>%' and m->>'body_html' not like '%{{%' and m->>'body_text' not like '%{{%'
     and m->>'body_html' not like '%253-7575%' and m->>'body_html' like '%815%' and m->>'preference_group' = 'account_critical'
    then ok := ok || text 'T1 email body (tokens filled, contact switch, account_critical)'; else bad := bad || ('T1 email meta: ' || left(coalesce(m::text, 'null'), 300)); end if;

  -- T2 journey line has a single stop
  j := app_private.partner_journey(o[1])::text || (select reason from app_private.shipper_can_post(o[1]));
  if j like '%ourselves. Release from Trust%' and j like '%ourselves. Contact hello@%' and j not like '%ourselves..%' then ok := ok || text 'T2 journey single stop'; else bad := bad || ('T2 journey: ' || left(j, 300)); end if;

  -- T3 re-hold (note edited): bell yes, no second email
  perform public.cc_shipper_trust_set(o[1], 'hold', 'Updated note');
  select count(*) into n from app_private.message_deliveries where recipient_email = 'bl0509-' || left(u[1]::text, 8) || '@bl0509test.com' and template_key = 'shipper.hold';
  if n = 1 and (select count(*) from app_private.partner_notifications where partner_org = o[1]) = 2 then ok := ok || text 'T3 rehold → bell only';
  else bad := bad || ('T3 rehold emails=' || n); end if;

  -- T4 release of a held shipper → shipper.released email + bell
  perform public.cc_shipper_trust_set(o[1], 'release', 'Thanks — confirmed by phone.');
  select count(*) into n from app_private.message_deliveries where recipient_email = 'bl0509-' || left(u[1]::text, 8) || '@bl0509test.com' and template_key = 'shipper.released';
  b := case when exists (select 1 from app_private.partner_notifications where partner_org = o[1] and title = '✅ Posting restored' and body = 'Thanks — confirmed by phone.') then 'ok' end;
  if n = 1 and b = 'ok' then ok := ok || text 'T4 release → email + bell'; else bad := bad || ('T4 released emails=' || n || ' bell=' || coalesce(b, 'null')); end if;

  -- T5 release of a shipper that was never held → nothing
  perform public.cc_shipper_trust_set(o[2], 'release', null);
  if not exists (select 1 from app_private.message_deliveries where recipient_email = 'bl0509-' || left(u[2]::text, 8) || '@bl0509test.com' and template_key like 'shipper.%')
     and not exists (select 1 from app_private.partner_notifications where partner_org = o[2]) then ok := ok || text 'T5 release not-held → silent';
  else bad := bad || text 'T5 release not-held sent something'; end if;

  -- T6 failed call-back holds silently (internal reason)
  perform public.cc_shipper_callback_fail(o[3], 'Corporate said they never heard of this company');
  if (select hold_reason is not null from app_private.shipper_trust where org_id = o[3])
     and not exists (select 1 from app_private.message_deliveries where recipient_email = 'bl0509-' || left(u[3]::text, 8) || '@bl0509test.com' and template_key like 'shipper.%')
     and not exists (select 1 from app_private.partner_notifications where partner_org = o[3]) then ok := ok || text 'T6 call-back fail → hold, silent';
  else bad := bad || text 'T6 call-back fail sent something / no hold'; end if;

  -- T8 (0509b) the call-back note is internal: the gate, can_post and the shipper's own status give the neutral line
  j := coalesce(app_private.shipper_lane_gate(o[3], 'direct')->>'hold', '') || ' | ' || coalesce((select reason from app_private.shipper_can_post(o[3])), '');
  perform set_config('request.jwt.claims', json_build_object('sub', u[3], 'role', 'authenticated')::text, true);
  j := j || ' | ' || coalesce(public.partner_shipper_status()->>'hold_reason', '');
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff, 'role', 'authenticated')::text, true);
  if j not like '%Corporate%' and j like '%could not confirm the company%' then ok := ok || text 'T8 call-back note not shown to shipper';
  else bad := bad || ('T8 shipper sees: ' || j); end if;

  -- T7 both keys documented (not filed as undocumented on use)
  if (select count(*) from app_private.email_catalog where key in ('shipper.hold', 'shipper.released') and status = 'live') = 2
    then ok := ok || text 'T7 catalog rows live'; else bad := bad || text 'T7 catalog status'; end if;

  raise exception 'bl_ship_0509 test: % pass, % fail | PASS: % | FAIL: %', cardinality(ok), cardinality(bad), array_to_string(ok, '; '), array_to_string(bad, '; ');
end $$;
