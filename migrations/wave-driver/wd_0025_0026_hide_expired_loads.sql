-- wd_0025 (STAGING 2026-07-09) — hide expired loads from the carrier Load Board.
-- Industry practice (DAT: postings expire same-day; Truckstop: auto-removes outdated posts):
-- a load whose pickup DAY has fully passed leaves the board. Broker keeps seeing it in
-- My Loads with the EXPIRED chip + "Update pickup time" reschedule (wd_0024); reschedule
-- puts it back on the board automatically (status stays 'available', date becomes future).
do $$
declare src text; n int;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n2 on n2.oid=p.pronamespace
   where n2.nspname='public' and p.proname='cc_pocket_available_loads';
  n := (length(src) - length(replace(src, 'where l.status=''available''', ''))) / length('where l.status=''available''');
  if n <> 1 then raise exception 'marker count % (expected 1)', n; end if;
  src := replace(src,
    'where l.status=''available''',
    'where l.status=''available''
      and (l.pickup_date is null or l.pickup_date >= current_date)');
  execute src;
end $$;

-- wd_0026 (STAGING 2026-07-09) — same rule for the public marketing teaser.
do $$
declare src text; n int;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n2 on n2.oid=p.pronamespace
   where n2.nspname='public' and p.proname='get_public_load_opportunities';
  n := (length(src) - length(replace(src, 'where status=''available''', ''))) / length('where status=''available''');
  if n <> 1 then raise exception 'marker count % (expected 1)', n; end if;
  src := replace(src,
    'where status=''available''',
    'where status=''available'' and (pickup_date is null or pickup_date >= current_date)');
  execute src;
end $$;
notify pgrst, 'reload schema';
