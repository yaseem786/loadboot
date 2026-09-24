-- bl_ux_0431 — ux-audit 2026-09-24 (broker portal, Track live modal)
-- The broker "Track live" modal asked cc_load_stops(<partner_loads.id>) — but that function
-- looks up public.loads, so every open of the modal logged a 400 "load not found" and the
-- extra-stop geofences never drew on the map. cc_partner_track_load never told the client the
-- board load's id. Additive: the 'board' object now carries 'load_id' (= loads.id, null while
-- unposted). Nothing else in the function changes — applied as an anchor replace on the live
-- definition (prod md5 37b6b79a…, staging f6254f67…; the two differ elsewhere by feature revision).
-- Not anon-executable before or after; anon-SECDEF names compared on prod: unchanged.
-- Rollback: run the same block with the two literals swapped.
do $$ begin
  execute replace(pg_get_functiondef('public.cc_partner_track_load(uuid)'::regprocedure),
    $a$'posted', l.id is not null, 'posted_at', l.created_at,$a$,
    $a$'posted', l.id is not null, 'load_id', l.id, 'posted_at', l.created_at,$a$);
end $$;
