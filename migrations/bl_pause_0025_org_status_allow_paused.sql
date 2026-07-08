-- bl_pause_0025: organizations.status must allow 'paused' (cc_pause_carrier writes it).
-- Old check only allowed active|suspended -> pause failed with 23514 in CC.
-- Applied: staging snslhvmkjusozgjelghi + prod rwscphuhpjoudvljvmdk (2026-07-07).
alter table public.organizations drop constraint organizations_status_check;
alter table public.organizations add constraint organizations_status_check
  check (status = any (array['active'::text,'suspended'::text,'paused'::text,'pending'::text]));
