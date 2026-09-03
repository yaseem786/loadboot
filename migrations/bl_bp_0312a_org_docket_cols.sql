-- bl_bp_0312a — prerequisite columns prod already has (bl_ob_0286); staging lacked them (2 Sep 2026). Safe everywhere.
alter table public.organizations add column if not exists mc_number text;
alter table public.organizations add column if not exists dot_number text;
