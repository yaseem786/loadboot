-- bl_ux_0430 — ux-audit 2026-09-24 (broker portal, finding O9)
-- The broker "Shipper freight — open pool" list returned the shipper's pickup and delivery
-- contacts (names + phone numbers) to EVERY approved broker before anyone had claimed the
-- load. Uber/Amazon pattern: contact details are revealed only to the party that took the job.
-- Change: while s.assigned_broker IS NULL the two contact fields come back NULL and a new flag
-- 'contacts_hidden' = true tells the UI to say why. The claiming broker sees them as before.
-- Everything else in the function is byte-for-byte the prod definition (md5 c0879c50…).
-- Rollback: re-run the previous definition (identical minus the two CASE expressions + flag).
CREATE OR REPLACE FUNCTION public.cc_broker_shipment_inbox()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
declare v_broker uuid;
begin
  v_broker := app_private.my_broker_org_strict();
  if v_broker is null then raise exception 'broker account required' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id',s.id,'origin',s.origin,'destination',s.destination,
      'ready_date',s.ready_date,'equipment',s.equipment,'weight',s.weight,'commodity',s.commodity,'pieces',s.pieces,
      'facility_notes',s.facility_notes,'dock_hours',s.dock_hours,'appointment_required',s.appointment_required,
      'terms',s.terms,'notes',s.notes,'status',s.status,'quote_amount',s.quote_amount,'requested_at',s.created_at,
      'ref_po',s.ref_po,
      'pickup_contact',   case when s.assigned_broker is null then null else s.pickup_contact end,
      'delivery_contact', case when s.assigned_broker is null then null else s.delivery_contact end,
      'contacts_hidden',  (s.assigned_broker is null),
      'cargo_value',s.cargo_value,'temperature',s.temperature,'hazmat',s.hazmat,'hazmat_info',s.hazmat_info,
      'seal_required',s.seal_required,'dims',s.dims,'special_instructions',s.special_instructions,
      'open_pool', (s.assigned_broker is null), 'shipper_trust', app_private.shipper_badge(s.shipper_org))
      order by (s.assigned_broker is null) desc, s.created_at desc)
    from app_private.partner_shipments s
    where (s.assigned_broker = v_broker and s.status in ('assigned','quoted','accepted','tendered'))
       or (s.assigned_broker is null and coalesce(s.status,'new') in ('new','requested'))), '[]'::jsonb);
end; $function$;
