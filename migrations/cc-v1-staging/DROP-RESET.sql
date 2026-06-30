-- DROP-RESET for the V1 operator surface + provisioning (cc_v1_0030/0031). STAGING ONLY.
-- Reverts exactly what 0030/0031 created; does NOT touch base tables or the 0015-0020
-- foundation (use migrations/down/ + migrations/emergency-down/ for those, and the
-- reviewed scripts/staging-reset/ package for a full wipe).
drop function if exists app_private.provision_staging_owner(uuid);
drop function if exists public.cc_get_overview();
drop function if exists public.cc_list_carriers(text,text,int);
drop function if exists public.cc_get_carrier(uuid);
drop function if exists public.cc_set_carrier_status(uuid,text,text);
drop function if exists public.cc_list_documents(text,int);
drop function if exists public.cc_list_loads(text,text,int);
drop function if exists public.cc_get_load(uuid);
drop function if exists public.cc_create_load(text,text,text,numeric,int,text,date);
drop function if exists public.cc_assign_load(uuid,uuid);
drop function if exists public.cc_set_load_status(uuid,text);
