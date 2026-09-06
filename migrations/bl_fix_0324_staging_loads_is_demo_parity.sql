-- bl_fix_0324 — STAGING PARITY REPAIR (found 6 Sep 2026 while testing bl_haul_0323).
-- public.loads.is_demo exists on production (boolean not null default false) but was missing on
-- staging, while app_private.tp_match_new_load() — called by the tg_load_posted_match trigger on
-- every load insert — selects "... and not is_demo". Result: EVERY load insert on staging failed
-- with 42703 column "is_demo" does not exist, so no broker/shipper load could be posted there.
-- Applied to staging 6 Sep 2026. Production already has the column; this is a no-op there.
alter table public.loads add column if not exists is_demo boolean not null default false;
