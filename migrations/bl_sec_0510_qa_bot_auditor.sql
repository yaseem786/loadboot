-- bl_sec_0510 — QA bot staff login (qa-bot@loadboot.com) with the read-only AUDITOR role. Prod only.
-- Owner 30 Sep created the auth user himself in the Supabase dashboard (password never seen here) and said
-- "user add kr deya". Purpose: automated checks / Claude sessions open Command Center pages without the
-- owner's own login, which can approve payouts. Auditor = 16 *.view permissions, no write permission.
--
-- Mirrors how the owner's staff login is built: app_private.staff_members (active) + 'staff' membership in the
-- internal "LoadBoot" org (is_active_staff) + a global role assignment (has_global_permission).
--
-- handle_new_user auto-created a CARRIER org "qa-bot" (kind carrier, is_demo = false) for this signup. Same fix
-- as bl_sec_0490: is_demo = true puts it behind the symmetric demo isolation (CLAUDE.md §4), so no real carrier,
-- broker, KPI, reminder mail or Riley dial ever sees it. profiles.role stays 'carrier' on purpose: 'admin' there
-- would make public.is_admin() true, which is far wider than auditor.
-- Dispatcher 360 for this login is read-only and redacted (bl_sec_0509).

insert into app_private.staff_members (user_id, status)
select u.id, 'active' from auth.users u
 where u.id = '20b2ae25-d96e-4159-8640-23e1857130c2' and u.email = 'qa-bot@loadboot.com'
on conflict (user_id) do update set status = 'active';

insert into public.organization_memberships (org_id, user_id, member_role, status)
select 'f9d70bb3-a082-41f3-84f5-374e0d92828d', '20b2ae25-d96e-4159-8640-23e1857130c2', 'staff', 'active'
 where not exists (select 1 from public.organization_memberships
                    where org_id = 'f9d70bb3-a082-41f3-84f5-374e0d92828d' and user_id = '20b2ae25-d96e-4159-8640-23e1857130c2');

insert into app_private.user_role_assignments (user_id, role_id, scope_type, status, granted_by)
select '20b2ae25-d96e-4159-8640-23e1857130c2', r.id, 'global', 'active', 'b7b28e16-608a-4ff7-9197-f763b80857e8'
  from app_private.roles r
 where r.key = 'auditor'
   and not exists (select 1 from app_private.user_role_assignments a
                    where a.user_id = '20b2ae25-d96e-4159-8640-23e1857130c2' and a.role_id = r.id and a.scope_type = 'global');

update public.organizations
   set is_demo = true
 where id = 'f87dc57e-34a5-43a3-85a7-549c102fd334' and name = 'qa-bot' and kind = 'carrier' and not is_demo;

select app_private.log_audit('staff.grant_role', 'user', '20b2ae25-d96e-4159-8640-23e1857130c2', null::uuid,
  'QA bot (qa-bot@loadboot.com) added as staff with global auditor role; its auto-created carrier org set is_demo=true',
  jsonb_build_object('migration', 'bl_sec_0510', 'role', 'auditor', 'carrier_org', 'f87dc57e-34a5-43a3-85a7-549c102fd334'), null);
