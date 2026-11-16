-- bl_fleet_0609 — truck save failed with "invalid input syntax for type integer: 5.1" (22P02)
-- when a carrier typed a decimal into a whole-number field (payload, inches, deck length ft, radius, temps...).
-- cc_pocket_upsert_truck(jsonb) now rounds those 14 inputs instead of rejecting the save.
-- Applied to staging + prod 16 Nov 2026.
do $$ declare d text; n int; begin
  select pg_get_functiondef('public.cc_pocket_upsert_truck(jsonb)'::regprocedure) into d;
  select count(*) into n from regexp_matches(d, 'nullif\(p->>''[a-z_]+'',''''\)::int\M', 'g');
  if n = 0 then raise notice 'no int casts found'; return; end if;
  d := regexp_replace(d, 'nullif\(p->>''([a-z_]+)'',''''\)::int\M', 'round(nullif(p->>''\1'','''')::numeric)::int', 'g');
  execute d;
  raise notice 'patched % casts', n;
end $$;
