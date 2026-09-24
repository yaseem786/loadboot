-- bl_ux_0434 — trip_locations.source check never learned the new writers (24 Sep 2026, ux-audit C10)
--
-- Symptom: every phone GPS ping from the carrier portal / driver mode failed with
--   23514 "trip_locations_source_check" — cc_pocket_post_location (bl_drv_0345a) writes
--   source = 'owner_app' | 'driver_app', and public.eld_ingest writes 'eld:<provider>', but
--   the constraint from cvy_trip_tracking still allows only
--   pocket_gps | manual_checkin | carrier_update | dispatcher_update | eld | telematics | carrier.
--   The client swallows the error (postLoc → false; trip-map .catch(() => {})), so nobody saw it:
--   prod has ONE trip_locations row ever (1 Jul 2026), staging only 'carrier' rows, and the
--   "Tracking dark" reminders fire because no ping ever lands. Found by the carrier-portal
--   Request-to-book walk on staging (geolocation granted → 400 on cc_pocket_post_location).
--
-- Fix: widen the check to the writers that exist. DDL only; no function changes, no grants.
-- Idempotent. Rollback: re-add the old seven-value check (below, commented).

alter table app_private.trip_locations drop constraint if exists trip_locations_source_check;
alter table app_private.trip_locations add constraint trip_locations_source_check
  check (
    source = any (array['pocket_gps','manual_checkin','carrier_update','dispatcher_update','eld','telematics','carrier','driver_app','owner_app'])
    or source like 'eld:%'
  );

-- rollback:
-- alter table app_private.trip_locations drop constraint if exists trip_locations_source_check;
-- alter table app_private.trip_locations add constraint trip_locations_source_check
--   check (source = any (array['pocket_gps','manual_checkin','carrier_update','dispatcher_update','eld','telematics','carrier']));
