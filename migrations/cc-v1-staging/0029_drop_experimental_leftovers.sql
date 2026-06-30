-- cc_v1_0029 — remove orphaned public functions left by experimental 0021-0026
-- (their tables were removed in the staging reset). STAGING ONLY. Idempotent.
drop function if exists public.cc_assign_load(uuid,uuid);
drop function if exists public.cc_delete_load(uuid);
drop function if exists public.cc_delete_page(uuid);
drop function if exists public.cc_delete_post(uuid);
drop function if exists public.cc_get_page(uuid);
drop function if exists public.cc_get_post(uuid);
drop function if exists public.cc_list_pages();
drop function if exists public.cc_list_posts(text);
drop function if exists public.cc_set_post_status(uuid,text);
drop function if exists public.cc_set_site_config(text,jsonb);
drop function if exists public.cc_upsert_load(jsonb);
drop function if exists public.cc_upsert_page(jsonb);
drop function if exists public.cc_upsert_post(jsonb);
drop function if exists public.cc_set_carrier_status(uuid,text);   -- 2-arg experimental overload (V1 uses 3-arg)
drop function if exists public.get_carrier_detail(uuid);
drop function if exists public.get_carriers_directory(text,text,integer,integer);
drop function if exists public.get_cc_overview_stats();
drop function if exists public.get_documents_queue(text,integer,integer);
drop function if exists public.get_fleet_locations();
drop function if exists public.get_lane_analytics();
drop function if exists public.get_live_visitors();
drop function if exists public.get_load_matches(uuid);
drop function if exists public.get_loads_list(text,text,integer,integer);
drop function if exists public.get_messages_recent(integer);
drop function if exists public.get_post_by_slug(text);
drop function if exists public.get_published_posts(integer,integer);
drop function if exists public.get_settlements_list(text,integer,integer);
drop function if exists public.get_site_config(text);
drop function if exists public.get_site_page(text);
drop function if exists public.get_web_analytics(integer);
drop function if exists public.get_web_analytics_pro(integer);
drop function if exists public.track_web_event(jsonb);
