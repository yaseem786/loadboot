-- bl_sec_0509 — Dispatcher 360 opens READ-ONLY for dispatch.view (auditor, finance), with personal data hidden.
-- Owner 30 Sep: "sugest and implment" (hide CV/ID/phone from view-only roles).
--
-- Before: every Dispatcher 360 read RPC was guarded by app_private.disp_is_staff()
-- (carriers.approve OR dispatch.manage), so an auditor (QA bot) could not open the page at all.
--
-- After:
--   * app_private.disp_can_view() = disp_is_staff() OR dispatch.view. Swapped in on the 9 STABLE read RPCs
--     the page loads (360, kpis, activity, choices, reports, trial_reports, bookings, commission_list,
--     test_review). Every write RPC keeps disp_is_staff() — untouched.
--   * View-only callers get a redacted payload (staff see exactly what they saw before):
--       profile: phone -> "•••• 1951", refs / wa_alert_number removed, skills.cv_doc / id_doc / cv_name /
--                id_name / linkedin removed, view_only=true
--       email:   a•••@gmail.com
--       assignments.carrier_contact: name only (no phone)
--       bookings: broker_phone / broker_email / rc_doc_path removed
--   * dispatcher_thread_list (private carrier ↔ dispatcher messages) stays staff/participant only — on purpose.
--
-- Patches are anchor replacements on the live definitions (CLAUDE.md §3); each anchor must occur exactly once
-- or the whole migration aborts. No public function is created, so the anon SECDEF surface is unchanged
-- (prod 36 / staging 35 — names checked before and after). The three helpers are app_private and revoked
-- from public/anon/authenticated; only the SECURITY DEFINER RPCs call them.

create or replace function app_private.disp_can_view()
returns boolean language sql stable security definer set search_path to 'app_private', 'public' as $$
  select app_private.disp_is_staff() or public.has_global_permission('dispatch.view');
$$;

create or replace function app_private.disp_view_redact(j jsonb)
returns jsonb language sql stable security definer set search_path to 'app_private', 'public' as $$
  select case when j is null or app_private.disp_is_staff() then j
    else (j - array['refs', 'wa_alert_number', 'broker_phone', 'broker_email', 'rc_doc_path'])
      || case when j ? 'phone' then jsonb_build_object('phone',
           case when coalesce(j->>'phone', '') = '' then null else '•••• ' || right(regexp_replace(j->>'phone', '\D', '', 'g'), 4) end)
         else '{}'::jsonb end
      || case when jsonb_typeof(j->'skills') = 'object'
           then jsonb_build_object('skills', (j->'skills') - array['cv_doc', 'id_doc', 'cv_name', 'id_name', 'linkedin'])
         else '{}'::jsonb end
      || jsonb_build_object('view_only', true)
  end;
$$;

create or replace function app_private.disp_view_mask_email(p text)
returns text language sql stable security definer set search_path to 'app_private', 'public' as $$
  select case when p is null or app_private.disp_is_staff() then p
    else left(split_part(p, '@', 1), 1) || '•••@' || split_part(p, '@', 2) end;
$$;

revoke execute on function app_private.disp_can_view() from public, anon, authenticated;
revoke execute on function app_private.disp_view_redact(jsonb) from public, anon, authenticated;
revoke execute on function app_private.disp_view_mask_email(text) from public, anon, authenticated;

do $mig$
declare
  r record; v_oid oid; v_def text; v_n int;
begin
  for r in
    select * from (values
      (1,  'cc_dispatcher_360',             'not app_private.disp_is_staff()', 'not app_private.disp_can_view()'),
      (2,  'cc_dispatcher_kpis',            'not app_private.disp_is_staff()', 'not app_private.disp_can_view()'),
      (3,  'cc_dispatcher_activity',        'not app_private.disp_is_staff()', 'not app_private.disp_can_view()'),
      (4,  'cc_dispatcher_choices',         'not app_private.disp_is_staff()', 'not app_private.disp_can_view()'),
      (5,  'cc_dispatcher_reports',         'not app_private.disp_is_staff()', 'not app_private.disp_can_view()'),
      (6,  'cc_dispatcher_trial_reports',   'not app_private.disp_is_staff()', 'not app_private.disp_can_view()'),
      (7,  'cc_dispatcher_bookings',        'not app_private.disp_is_staff()', 'not app_private.disp_can_view()'),
      (8,  'cc_dispatcher_commission_list', 'not app_private.disp_is_staff()', 'not app_private.disp_can_view()'),
      (9,  'cc_dispatcher_test_review',     'not app_private.disp_is_staff()', 'not app_private.disp_can_view()'),
      (10, 'cc_dispatcher_360',
           '(select to_jsonb(d) - ''base_salary'' - ''per_truck'' from',
           '(select app_private.disp_view_redact(to_jsonb(d) - ''base_salary'' - ''per_truck'') from'),
      (11, 'cc_dispatcher_360',
           '''email'', (select email from auth.users u where u.id = p_user)',
           '''email'', (select app_private.disp_view_mask_email(email) from auth.users u where u.id = p_user)'),
      (12, 'cc_dispatcher_360',
           '|| coalesce('' · '' || p.phone, '''')',
           '|| case when app_private.disp_is_staff() then coalesce('' · '' || p.phone, '''') else '''' end'),
      (13, 'cc_dispatcher_bookings',
           'jsonb_agg(to_jsonb(b) || jsonb_build_object(',
           'jsonb_agg(app_private.disp_view_redact(to_jsonb(b)) || jsonb_build_object(')
    ) t(ord, fn, anchor, repl) order by ord
  loop
    select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn;
    v_def := pg_get_functiondef(v_oid);
    v_n := (length(v_def) - length(replace(v_def, r.anchor, ''))) / length(r.anchor);
    if v_n <> 1 then raise exception 'bl_sec_0509 patch % on %: anchor found % times (expected 1)', r.ord, r.fn, v_n; end if;
    execute replace(v_def, r.anchor, r.repl);
  end loop;
end $mig$;
