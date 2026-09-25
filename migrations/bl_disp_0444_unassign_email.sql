-- bl_disp_0444 — the dispatcher's unassign e-mail becomes a branded, catalogued notice (owner, 25 Sep 2026)
--
-- Before: cc_dispatcher_unassign sent the dispatcher a generic disp_notify e-mail ("LoadBoot: Assignment ended",
-- one line of reason, no branding) under the key dispatcher.unassigned, which was NOT in email_catalog (rule §6 bug).
-- The carrier side was already branded (disp_carrier_change_email → dispatcher.changed.carrier) and stays as is.
--
-- After: the in-app card stays; the e-mail is app_private.disp_unassign_email():
--   * which carrier ended / paused, the reason from CC,
--   * what the dispatcher STILL holds (so "you keep PICK N NETT" is explicit),
--   * on a trial with a carrier still assigned: the capacity rule (trial = 1 carrier; up to 3 / 5 trucks after
--     3 delivered loads, added by LoadBoot) — the numbers come from app_private.disp_capacity_policy(),
--   * "do not contact the carrier" — the contact rule still applies to an ended assignment.
--   One e-mail per assignment (idempotency disp.unassigned:<assignment>:<mode>). Two carriers ended on the same day
--   = two e-mails; each shows the current state, so the second one lists both as ended.
-- Catalog: dispatcher.unassigned (T, dispatcher, account_critical).
-- Anon SECURITY DEFINER surface: unchanged (only app_private objects + an anchor patch on an existing function).

create or replace function app_private.disp_unassign_email(p_assignment uuid, p_mode text, p_reason text) returns void
language plpgsql security definer set search_path = app_private, public as $$
declare a record; d record; v_mail text; v_cname text; v_paused boolean := (p_mode = 'paused'); v_first text;
        v_keep text; v_keep_n int; v_ended_today text; v_reason text; v_html text; v_text text; pol jsonb := app_private.disp_capacity_policy();
        v_contact text := app_private.disp_contact()->>'email';
begin
  select * into a from app_private.dispatcher_assignments where id = p_assignment;
  if a.id is null then return; end if;
  select full_name, status into d from app_private.dispatcher_profiles where user_id = a.dispatcher_user_id;
  select u.email into v_mail from auth.users u where u.id = a.dispatcher_user_id;
  if v_mail is null then return; end if;
  select name into v_cname from public.organizations where id = a.carrier_org_id;
  v_first := coalesce(nullif(split_part(trim(coalesce(d.full_name,'')), ' ', 1), ''), 'Dispatcher');
  v_reason := nullif(btrim(coalesce(p_reason,'')), '');

  select string_agg(o.name, ', ' order by x.assigned_at), count(*) into v_keep, v_keep_n
    from app_private.dispatcher_assignments x join public.organizations o on o.id = x.carrier_org_id
   where x.dispatcher_user_id = a.dispatcher_user_id and x.status = 'active';
  select string_agg(distinct o.name, ', ' order by o.name) into v_ended_today
    from app_private.dispatcher_assignments x join public.organizations o on o.id = x.carrier_org_id
   where x.dispatcher_user_id = a.dispatcher_user_id and x.status in ('ended','paused') and x.updated_at::date = current_date;

  v_html := '<div style="font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;font-size:15px;line-height:1.65">'
    || app_private.disp_head('LoadBoot Dispatch &middot; Assignment update',
         case when v_paused then 'Your assignment for ' || app_private.disp_esc(coalesce(v_cname,'a carrier')) || ' is paused'
              else 'Your assignment for ' || app_private.disp_esc(coalesce(v_cname,'a carrier')) || ' has ended' end)
    || '<p style="margin:0 0 14px">Dear ' || app_private.disp_esc(v_first) || ', LoadBoot has ' || case when v_paused then 'paused' else 'ended' end
    || ' your dispatcher assignment for <b>' || app_private.disp_esc(coalesce(v_cname,'this carrier')) || '</b>, effective now.</p>'
    || app_private.disp_strip('Carrier', app_private.disp_esc(coalesce(v_cname,'—')),
         'Status', '<span style="color:' || case when v_paused then '#FC5305' else '#f87171' end || '">' || case when v_paused then 'PAUSED' else 'ENDED' end || '</span>',
         'You still dispatch for', case when coalesce(v_keep_n,0) > 0 then '<span style="color:#4ade80">' || app_private.disp_esc(v_keep) || '</span>' else 'no carrier right now' end)
    || case when v_reason is not null then app_private.disp_box('Reason from LoadBoot', replace(app_private.disp_esc(v_reason), E'\n', '<br>'), 'note') else '' end
    || case when d.status = 'trial' and coalesce(v_keep_n,0) > 0 then
         app_private.disp_box('Why — the carrier rule',
              'During the paid trial every dispatcher holds <b>' || (pol->>'trial_max_carriers') || ' carrier</b>. You keep <b>' || app_private.disp_esc(v_keep) || '</b> &mdash; put everything into it. '
           || 'After the trial LoadBoot can add more, up to <b>' || (pol->>'max_carriers') || ' carriers / ' || (pol->>'max_trucks') || ' trucks</b>, once you have <b>'
           || (pol->>'proof_loads') || ' delivered loads</b> and no carrier report against you. You never add a carrier yourself; LoadBoot does, based on that record.', 'ok')
       else '' end
    || app_private.disp_box('What this means for you',
         case when v_paused
              then 'Do not work this carrier''s loads or contact the carrier while the pause lasts. Anything already booked is covered by LoadBoot Dispatch. We will tell you if the assignment resumes.'
              else 'Your access to ' || app_private.disp_esc(coalesce(v_cname,'this carrier')) || ' in the workspace is closed. Loads you already booked that are delivered are settled as normal. '
                || 'Do not contact the carrier, the driver or any broker about this account from now on &mdash; the contact rule you accepted still applies after an assignment ends.' end
       || case when coalesce(v_ended_today,'') <> '' and position(',' in v_ended_today) > 0 then '<br><br><b>Changed today:</b> ' || app_private.disp_esc(v_ended_today) || '.' else '' end)
    || app_private.disp_btn('Open my workspace', 'https://loadboot.com/app/agent/#dashboard')
    || '<p style="margin:0 0 16px"><b>LoadBoot Dispatch</b><br><span style="color:#64748b;font-size:13px">{{contact_inline}}<br>' || v_contact || '</span></p>'
    || '<p style="color:#8ea2c3;font-size:12px;margin:0">Transactional notice about your LoadBoot dispatcher account.</p></div>';

  v_text := 'Dear ' || v_first || E',\n\nLoadBoot has ' || case when v_paused then 'paused' else 'ended' end || ' your dispatcher assignment for ' || coalesce(v_cname,'this carrier') || ', effective now.'
    || coalesce(E'\n\nReason: ' || v_reason, '')
    || E'\n\nYou still dispatch for: ' || coalesce(v_keep, 'no carrier right now') || '.'
    || case when d.status = 'trial' and coalesce(v_keep_n,0) > 0 then E'\n\nDuring the paid trial every dispatcher holds ' || (pol->>'trial_max_carriers') || ' carrier. After the trial LoadBoot can add up to '
         || (pol->>'max_carriers') || ' carriers / ' || (pol->>'max_trucks') || ' trucks once you have ' || (pol->>'proof_loads') || ' delivered loads and no carrier report.' else '' end
    || E'\n\nDo not contact this carrier, its driver or any broker about this account from now on.\n\nhttps://loadboot.com/app/agent/#dashboard\n\nLoadBoot Dispatch - {{contact_inline}} - ' || v_contact;

  perform app_private.sys_email(v_mail, 'dispatcher.unassigned',
    case when v_paused then 'Your LoadBoot assignment for ' || coalesce(v_cname,'a carrier') || ' is paused'
         else 'Your LoadBoot assignment for ' || coalesce(v_cname,'a carrier') || ' has ended' end,
    v_html, v_text, 'disp.unassigned:' || p_assignment::text || ':' || coalesce(p_mode,'ended'));
end $$;
revoke all on function app_private.disp_unassign_email(uuid, text, text) from public, anon;

-- cc_dispatcher_unassign: the dispatcher's generic e-mail off (in-app card stays), the branded one on. Anchor patches.
do $p$
declare src text; a1 text; a2 text;
begin
  src := pg_get_functiondef('public.cc_dispatcher_unassign(uuid, text, boolean)'::regprocedure);
  a1 := 'your carrier assignment.''), ''/app/agent/#dashboard'', true);';
  a2 := 'begin perform app_private.disp_carrier_change_email(p_assignment, case when p_pause then ''paused'' else ''ended'' end); exception when others then null; end;';
  if src like '%disp_unassign_email%' then raise notice 'cc_dispatcher_unassign already patched'; return; end if;
  if src not like '%' || a1 || '%' then raise exception 'bl_disp_0444: dispatcher notify anchor missing'; end if;
  if src not like '%' || a2 || '%' then raise exception 'bl_disp_0444: carrier change e-mail anchor missing'; end if;
  src := replace(src, a1, 'your carrier assignment.''), ''/app/agent/#dashboard'', false);');
  src := replace(src, a2, a2 || E'\n  begin perform app_private.disp_unassign_email(p_assignment, case when p_pause then ''paused'' else ''ended'' end, p_reason); exception when others then null; end;   -- bl_disp_0444');
  execute src;
end $p$;

insert into app_private.email_catalog
  (key, name, purpose, class, audience_role, trigger_type, trigger_source, cadence, cap_note,
   preference_group, unsub_allowed, cc_deep_link, status, discovered_in)
values ('dispatcher.unassigned', 'Assignment ended / paused — dispatcher',
   'Tells the dispatcher that CC ended or paused one carrier assignment: carrier, reason, what they still hold, the trial carrier rule when on trial, do-not-contact line',
   'T', 'dispatcher', 'event', 'public.cc_dispatcher_unassign → app_private.disp_unassign_email', 'once per assignment change', 'once (idempotency disp.unassigned:<assignment>:<mode>)',
   'account_critical', false, '#/dispatchers', 'live', '{code}')
on conflict (key) do update set name = excluded.name, purpose = excluded.purpose, class = excluded.class, audience_role = excluded.audience_role,
  trigger_type = excluded.trigger_type, trigger_source = excluded.trigger_source, cadence = excluded.cadence, cap_note = excluded.cap_note,
  preference_group = excluded.preference_group, unsub_allowed = excluded.unsub_allowed, cc_deep_link = excluded.cc_deep_link,
  status = 'live', updated_at = now();
