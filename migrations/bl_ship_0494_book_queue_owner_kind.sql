-- bl_ship_0494 — the booking-requests queue says whose load it is, so Command Center shows "Shipper decides"
-- instead of an Approve button on a shipper's load (cc_decide_book_request refuses a staff approval there anyway, 0492).
do $$ declare d text; n int; a text := $a$'equipment',l.equipment,$a$; begin
  d := pg_get_functiondef('public.cc_book_requests_queue(text)'::regprocedure);
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  if n <> 1 then raise exception 'bl_ship_0494: anchor found % times — refusing', n; end if;
  execute replace(d, a, a || $b$ 'owner_kind', (select o2.kind from public.organizations o2 where o2.id = pl.broker_org),$b$);
end $$;
