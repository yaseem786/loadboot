-- ENTERPRISE COMPLETION WAVE 5 — TRACKING & COMMS FOUNDATION.
-- Carrier-CONSENTED trip location pings from the Pocket App (blocked without consent), staff
-- location timeline, ELD provider config abstraction. Real maps/ELD = owner-credentialed.
-- Applied to STAGING + PRODUCTION as ledger name ec5_tracking_0001.
alter table app_private.trips add column if not exists location_consent boolean not null default false;
alter table app_private.trips add column if not exists last_lat double precision;
alter table app_private.trips add column if not exists last_lng double precision;
alter table app_private.trips add column if not exists last_loc_at timestamptz;
create table if not exists app_private.trip_locations (id uuid primary key default gen_random_uuid(), trip_id uuid not null references app_private.trips(id) on delete cascade, lat double precision not null, lng double precision not null, label text, source text not null default 'carrier' check (source in ('carrier','driver','eld','manual')), created_at timestamptz not null default now());
create index if not exists trip_locations_idx on app_private.trip_locations(trip_id, created_at desc);
create table if not exists app_private.eld_integrations (id uuid primary key default gen_random_uuid(), carrier_id uuid not null references public.organizations(id) on delete cascade, provider text not null, external_id text, status text not null default 'disconnected' check (status in ('disconnected','connected','error')), created_at timestamptz not null default now());
alter table app_private.trip_locations enable row level security; alter table app_private.eld_integrations enable row level security;
revoke all on all tables in schema app_private from public, anon, authenticated;
-- RPCs: cc_pocket_set_consent / cc_pocket_post_location (consent-gated) / cc_trip_locations
-- (full bodies as applied; see session record / production schema).
