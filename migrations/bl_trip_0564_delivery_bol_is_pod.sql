-- bl_trip_0564 (22 Oct 2026) — the live-trip map has a "Signed BOL/POD" button at the stop. It stored kind 'bol_signed',
-- which CC POD review (kind = 'pod') never sees and the trip card's POD list never shows — so a driver who uploaded the
-- POD "on the delivery screen" (Sprint Shift, 22 Oct) had uploaded nothing LoadBoot would act on.
-- A signed BOL/POD taken at the DELIVERY (delivery arrival recorded, or the trip already delivered) is now filed as the
-- trip's POD. At the pickup it stays 'bol_signed' (the pickup BOL is not a proof of delivery).
do $mig$
declare d text;
  a text := $a$  insert into app_private.document_files(owner_type, owner_id, kind, path, file_name, content_type, size_bytes, uploaded_by, status)
  values ('trip', p_trip::text, p_kind,$a$;
begin
  d := pg_get_functiondef('public.cc_pocket_upload_trip_doc(uuid,text,text,text,text,bigint)'::regprocedure);
  if position('bl_trip_0564' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'bl_trip_0564: anchor not found exactly once'; end if;
  d := replace(d, a, $b$  -- bl_trip_0564: the signed paperwork at the DELIVERY is the proof of delivery
  if p_kind in ('bol_signed','pod_signed') and (
       exists (select 1 from app_private.trips t where t.id = p_trip and t.status in ('delivered','invoiced'))
    or exists (select 1 from app_private.trip_dwell_events e where e.trip_id = p_trip and e.stop_type = 'delivery' and e.arrived_at is not null)) then
    p_kind := 'pod';
  end if;
$b$ || a);
  execute d;
end $mig$;
