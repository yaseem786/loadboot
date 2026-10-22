-- bl_trip_0562 (22 Oct 2026) — the "valid driver" gate said "your driver's license/medical has expired" even when the
-- carrier had NO driver on file at all (seen on the first sandbox trip). Same gate, honest wording for both cases.
do $mig$
declare f text; d text;
  a text := $a$your driver''s license/medical has expired. Open Fleet → Drivers and update the expiry dates (or add a current driver), then book.$a$;
  b text := $b$no driver on file has a current license and medical. Open Fleet → Drivers and add a driver (or update the expiry dates), then book.$b$;
begin
  foreach f in array array['app_private.trg_trip_valid_driver()'] loop
    d := pg_get_functiondef(f::regprocedure);
    if position(a in d) = 0 then
      if position(b in d) > 0 then continue; end if;
      raise exception 'bl_trip_0562: anchor not found in %', f;
    end if;
    execute replace(d, a, b);
  end loop;
end $mig$;
