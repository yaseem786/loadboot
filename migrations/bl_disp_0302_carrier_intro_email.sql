-- bl_disp_0302 — premium "meet your dispatcher" e-mail to the carrier + acknowledgement model.
-- Why (Yaseen, 29 Aug): the carrier already signed LoadBoot's Dispatch Service Agreement (§4 limited
-- authorization: LoadBoot books loads on the carrier's behalf within their preferences). Assigning a
-- named dispatcher is therefore ALREADY authorised — no second consent is needed and nothing may block
-- on it. "Confirm" is an acknowledgement of the disclosure (what the dispatcher can see, how a load
-- flows, the one-channel rule), not a contract step. So:
--   * cc_dispatcher_assign sends a branded intro e-mail (delivery-worker wraps it in the LoadBoot shell)
--     with a one-tap "Got it" link → /app/carrier/?ack=<assignment>, plus the in-app notice;
--   * dispatcher_assignments.carrier_notified_at records the notice; after 72 h without a tap the
--     assignment counts as "acknowledged by notice" (ack_state = 'notified') — the card stops asking,
--     the dispatcher's Today queue stops nagging, the disclosure stays one click away;
--   * cc_dispatcher_resend_intro(p_assignment) lets staff re-send the intro (existing assignments);
--   * carrier_dispatcher_ack is idempotent.
-- Additive. Staging first, then prod.
alter table app_private.dispatcher_assignments add column if not exists carrier_notified_at timestamptz;

create or replace function app_private.disp_assign_email_html(p_assignment uuid)
returns text language plpgsql stable security definer set search_path = app_private, public as $$
declare a record; d record; c record; v_sop jsonb; v_rules text := ''; v_hours text; h text;
begin
  select * into a from app_private.dispatcher_assignments where id = p_assignment;
  if a.id is null then return null; end if;
  select dp.full_name, dp.phone, dp.country, dp.skills into d from app_private.dispatcher_profiles dp where dp.user_id = a.dispatcher_user_id;
  select o.name, p.contact_name, p.mc into c from public.organizations o left join public.profiles p on p.id = o.owner_user_id where o.id = a.carrier_org_id;
  v_sop := coalesce(a.sop, '{}'::jsonb);
  v_hours := nullif(coalesce(d.skills->>'timezone',''), '');
  if v_sop->>'min_rate' is not null then v_rules := v_rules || '<li>Floor rate <b>$' || to_char((v_sop->>'min_rate')::numeric, 'FM999990.00') || '/mi</b>' || coalesce(' — ' || (v_sop->>'min_rate_note'), '') || '</li>'; end if;
  if coalesce(v_sop->>'home_time','') <> '' then v_rules := v_rules || '<li>Home time: ' || (v_sop->>'home_time') || '</li>'; end if;
  if coalesce(v_sop->>'scope_value','') <> '' then v_rules := v_rules || '<li>Scope: ' || (v_sop->>'scope_value') || '</li>'; end if;
  if coalesce(v_sop->>'rules','') <> '' then v_rules := v_rules || '<li>' || (v_sop->>'rules') || '</li>'; end if;
  h := '<p style="margin:0 0 6px;font-size:12px;font-weight:700;letter-spacing:.06em;color:#0883F7;text-transform:uppercase">Your dedicated dispatcher</p>'
    || '<h2 style="margin:0 0 10px;color:#10223B;font-size:24px">Meet ' || coalesce(d.full_name, 'your LoadBoot dispatcher') || '</h2>'
    || '<p style="margin:0 0 14px;color:#475569;font-size:15px;line-height:1.6">Hi ' || coalesce(nullif(split_part(coalesce(c.contact_name,''), ' ', 1),''), 'there') || ' — from today <b>' || coalesce(d.full_name,'your dispatcher') || '</b> works your truck for ' || coalesce(c.name,'your company') || coalesce(' (MC ' || c.mc || ')', '') || '. They are LoadBoot''s own dispatcher, working only under <b>your</b> authority, under the Dispatch Service Agreement you already signed. Nothing new to sign — this e-mail is so you know exactly how it works.</p>'
    || '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;font-size:14px;color:#334155">'
    || '<tr><td style="padding:12px 14px;background:#f1f5f9;border-radius:10px"><div style="font-weight:800;color:#10223B;margin-bottom:6px">What they do for you</div>'
    || 'Find and negotiate loads on DAT/Truckstop and the LoadBoot board · set you up with brokers using your packet · send every rate confirmation to LoadBoot · keep the broker updated with check calls · log detention, TONU and layover claims · keep your truck loaded around your home time.</td></tr>'
    || '<tr><td style="height:10px"></td></tr>'
    || '<tr><td style="padding:12px 14px;background:#f1f5f9;border-radius:10px"><div style="font-weight:800;color:#10223B;margin-bottom:6px">How a load moves — every time</div>'
    || '<ol style="margin:0;padding-left:18px;line-height:1.7"><li>They post the load in your WhatsApp group — lane, rate, dates, weight. <b>You say OK</b> (a thumbs-up is enough).</li><li>They book it under your MC and send the rate confirmation to LoadBoot.</li><li><b>LoadBoot checks the RC</b> against your floor rate and rules and approves it — you get it in your portal.</li><li>Only then does your driver roll. Check calls at pickup, in transit and delivery go in the group.</li></ol></td></tr>'
    || '<tr><td style="height:10px"></td></tr>'
    || '<tr><td style="padding:12px 14px;background:#f1f5f9;border-radius:10px"><div style="font-weight:800;color:#10223B;margin-bottom:6px">What they can see — and cannot</div>'
    || '<div style="line-height:1.7">✅ Truck specs, driver name and phone, where the truck is empty, your home-time rules<br>✅ Your approved authority, COI, W-9 and factoring NOA — to set you up with brokers<br>✅ The shared thread and the loads they book for you<br>❌ Your bank details, voided check, settlements or LoadBoot fees — <b>never</b><br>❌ Your DAT/Truckstop login — they use their own<br>❌ They cannot move your driver without LoadBoot''s approval on the RC</div></td></tr>'
    || case when v_rules <> '' then '<tr><td style="height:10px"></td></tr><tr><td style="padding:12px 14px;background:#f1f5f9;border-radius:10px"><div style="font-weight:800;color:#10223B;margin-bottom:6px">The rules they work to (from what you told us)</div><ul style="margin:0;padding-left:18px;line-height:1.7">' || v_rules || '</ul><div style="color:#64748b;font-size:13px;margin-top:6px">Want to change any of these? Reply to this e-mail or write in the thread.</div></td></tr>' else '' end
    || '<tr><td style="height:10px"></td></tr>'
    || '<tr><td style="padding:12px 14px;background:#fff7ed;border:1px solid #fed7aa;border-radius:10px"><div style="font-weight:800;color:#9a3412;margin-bottom:6px">One channel</div>'
    || 'Everything happens in your WhatsApp group and the thread in your portal — LoadBoot reads both. Your dispatcher calls the driver only in an emergency and posts a summary in the group right after. No private numbers, no side deals.</td></tr>'
    || '</table>'
    || '<p style="margin:22px 0 8px"><a href="https://loadboot.com/app/carrier/?ack=' || a.id::text || '" style="background:#0883F7;color:#fff;padding:13px 20px;border-radius:10px;text-decoration:none;font-weight:800;display:inline-block">Got it — confirm my dispatcher</a></p>'
    || '<p style="margin:0 0 16px;color:#64748b;font-size:13px">One tap tells us you read this. Not ready? Open your dashboard and press <b>Pause dispatcher</b> — LoadBoot dispatch covers your truck meanwhile.</p>'
    || '<p style="margin:0;color:#334155;font-size:14px;line-height:1.7"><b>' || coalesce(d.full_name,'Your dispatcher') || '</b>' || coalesce(' · ' || nullif(d.phone,''), '') || coalesce(' · hours ' || v_hours, '') || '<br>Questions for LoadBoot: reply to this e-mail or <a href="mailto:dispatch@loadboot.com" style="color:#0883F7">dispatch@loadboot.com</a></p>'
    || '<p style="margin:14px 0 0;color:#94a3b8;font-size:12px">Sent under §4 of your Dispatch Service Agreement (limited authorization). This is a transactional notice about your account, not a marketing e-mail.</p>';
  return h;
end $$;

-- staff: (re)send the intro to the carrier owner; stamps carrier_notified_at
create or replace function public.cc_dispatcher_resend_intro(p_assignment uuid)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare a record; v_owner uuid; v_email text; v_html text; v_dname text; v_cname text;
begin
  if not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  select * into a from app_private.dispatcher_assignments where id = p_assignment;
  if a.id is null then return jsonb_build_object('error','assignment not found'); end if;
  select owner_user_id, name into v_owner, v_cname from public.organizations where id = a.carrier_org_id;
  select email into v_email from auth.users where id = v_owner;
  select full_name into v_dname from app_private.dispatcher_profiles where user_id = a.dispatcher_user_id;
  v_html := app_private.disp_assign_email_html(p_assignment);
  if v_email is null or v_html is null then return jsonb_build_object('error','no owner e-mail on file'); end if;
  perform app_private.sys_email(v_email, 'dispatcher.assigned.carrier', 'Meet ' || coalesce(v_dname,'your dispatcher') || ' — your LoadBoot dispatcher for ' || coalesce(v_cname,'your trucks'), v_html,
    coalesce(v_dname,'Your dispatcher') || ' is your LoadBoot dispatcher. They book loads under your MC after your OK in the group; LoadBoot approves every rate confirmation before the driver moves. They never see your bank details. Confirm: https://loadboot.com/app/carrier/?ack=' || p_assignment::text,
    'dispatcher.intro:' || p_assignment::text || ':' || extract(epoch from now())::bigint::text);
  update app_private.dispatcher_assignments set carrier_notified_at = now(), updated_at = now() where id = p_assignment;
  perform app_private.disp_audit('dispatcher.intro_sent', 'assignment', p_assignment::text, a.carrier_org_id, 'intro e-mail sent to ' || v_email, '{}'::jsonb);
  return jsonb_build_object('ok', true, 'to', v_email);
end $$;
revoke all on function public.cc_dispatcher_resend_intro(uuid) from public, anon;
grant execute on function public.cc_dispatcher_resend_intro(uuid) to authenticated;

-- cc_dispatcher_assign: in-app notice stays, the plain e-mail is replaced by the branded intro
do $$
declare src text;
begin
  src := pg_get_functiondef('public.cc_dispatcher_assign(uuid,uuid,jsonb)'::regprocedure);
  if position('''/app/carrier/'', true);' in src) = 0 then raise exception 'cc_dispatcher_assign: expected carrier notify call not found'; end if;
  src := replace(src, '''/app/carrier/'', true);', '''/app/carrier/'', false);
  begin
    perform app_private.sys_email((select email from auth.users where id = v_owner), ''dispatcher.assigned.carrier'',
      ''Meet '' || coalesce(v_dname,''your dispatcher'') || '' — your LoadBoot dispatcher for '' || coalesce(v_cname,''your trucks''),
      app_private.disp_assign_email_html(v_id),
      coalesce(v_dname,''Your dispatcher'') || '' is your LoadBoot dispatcher. Confirm: https://loadboot.com/app/carrier/?ack='' || v_id::text,
      ''dispatcher.intro:'' || v_id::text);
    update app_private.dispatcher_assignments set carrier_notified_at = now() where id = v_id;
  exception when others then null; end;');
  execute src;
end $$;

-- carrier_dispatcher_ack: idempotent (a second tap is a no-op, no duplicate system message)
create or replace function public.carrier_dispatcher_ack(p_assignment uuid)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_a record;
begin
  select * into v_a from app_private.dispatcher_assignments where id = p_assignment;
  if v_a.id is null or not app_private.disp_is_carrier_member(v_a.carrier_org_id) then return jsonb_build_object('error','not authorized'); end if;
  if v_a.carrier_ack_at is not null then return jsonb_build_object('ok', true, 'already', true, 'ack_at', v_a.carrier_ack_at); end if;
  update app_private.dispatcher_assignments set carrier_ack_at = now(), carrier_ack_by = auth.uid(), updated_at = now() where id = p_assignment;
  insert into app_private.dispatcher_messages(assignment_id, carrier_org_id, sender_role, body) values (p_assignment, v_a.carrier_org_id, 'system', 'The carrier confirmed the dispatcher assignment.');
  perform app_private.disp_notify(v_a.dispatcher_user_id, 'dispatcher', 'dispatcher.carrier_ack', 'Carrier confirmed you', (select name from public.organizations where id = v_a.carrier_org_id) || ' read the introduction and confirmed the assignment.', '/app/agent/#dashboard', false);
  perform app_private.disp_audit('dispatcher.carrier_ack', 'assignment', p_assignment::text, v_a.carrier_org_id, 'carrier confirmed the dispatcher assignment', '{}'::jsonb);
  return jsonb_build_object('ok', true);
end $$;

-- carrier_my_dispatcher: expose ack_state (confirmed | pending | notified) so the card knows when to stop asking
do $$
declare src text;
begin
  src := pg_get_functiondef('public.carrier_my_dispatcher()'::regprocedure);
  if position('''carrier_ack_at'', a.carrier_ack_at,' in src) = 0 then raise exception 'carrier_my_dispatcher: expected key not found'; end if;
  src := replace(src, '''carrier_ack_at'', a.carrier_ack_at,', '''carrier_ack_at'', a.carrier_ack_at, ''carrier_notified_at'', a.carrier_notified_at, ''ack_state'', case when a.carrier_ack_at is not null then ''confirmed'' when coalesce(a.carrier_notified_at, a.assigned_at) < now() - interval ''72 hours'' then ''notified'' else ''pending'' end,');
  execute src;
end $$;
-- dispatcher feed: same flag so the Today queue nags only during the first 72 h
do $$
declare src text;
begin
  src := pg_get_functiondef('public.dispatcher_workspace_feed()'::regprocedure);
  if position('''carrier_ack_at'', a.carrier_ack_at,' in src) = 0 then raise exception 'dispatcher_workspace_feed: expected key not found'; end if;
  src := replace(src, '''carrier_ack_at'', a.carrier_ack_at,', '''carrier_ack_at'', a.carrier_ack_at, ''ack_state'', case when a.carrier_ack_at is not null then ''confirmed'' when coalesce(a.carrier_notified_at, a.assigned_at) < now() - interval ''72 hours'' then ''notified'' else ''pending'' end,');
  execute src;
end $$;
