-- bl_pay_0115: carrier_factoring_packet referenced c.note; the column is
-- c.submitted_note (app_private.load_document_checklist). The RPC 400'd on every
-- call, so the "📦 Factoring packet" modal never worked. Applied to STAGING 2026-07-18.
-- Only the rate-confirmation subselect line changed:
--   select c.status, c.submitted_at, c.submitted_note
-- (was: c.note as submitted_note). Full function recreated below.
create or replace function public.carrier_factoring_packet(p_trip uuid)
 returns jsonb language plpgsql security definer
 set search_path to 'app_private, public'
as $fn$
declare v_org uuid; t record; l record; prof record; v_rc jsonb; v_docs jsonb; v_inv record; v_missing jsonb := '[]'::jsonb;
begin
  v_org := app_private.my_carrier_org();
  if v_org is null then raise exception 'carrier account required' using errcode='42501'; end if;
  select * into t from app_private.trips where id = p_trip and carrier_id = v_org;
  if t.id is null then raise exception 'trip not found' using errcode='22023'; end if;
  select * into l from public.loads where id = t.load_id;
  select * into prof from app_private.org_payment_profiles where org_id = v_org;
  select to_jsonb(x) into v_rc from (
    select c.status, c.submitted_at, c.submitted_note
    from app_private.load_document_checklist c
    join app_private.partner_loads pl on pl.id = c.subject_id
    where pl.posted_load_id = t.load_id and c.doc_key='rate_confirmation'
    limit 1) x;
  select coalesce(jsonb_agg(jsonb_build_object('kind', df.kind, 'file_name', df.file_name, 'path', df.path, 'bucket', df.bucket, 'uploaded_at', df.created_at) order by df.created_at), '[]'::jsonb)
    into v_docs
  from app_private.document_files df
  where df.owner_type='trip' and df.owner_id = t.id::text
    and df.kind in ('pod','pod_signed','bol_signed','lumper_receipt','gate_ticket','stop_photo');
  select * into v_inv from app_private.fin_invoices where trip_id = t.id order by created_at desc limit 1;
  if t.status <> 'delivered' then v_missing := v_missing || to_jsonb('Trip not delivered yet — factors fund after delivery'::text); end if;
  if not (v_docs @> '[{"kind":"pod"}]' or v_docs @> '[{"kind":"pod_signed"}]') then v_missing := v_missing || to_jsonb('Signed POD — upload it at delivery (the #1 funding requirement)'::text); end if;
  if v_rc is null then v_missing := v_missing || to_jsonb('Executed rate confirmation — ask the broker to sign it in their Docs panel'::text); end if;
  return jsonb_build_object(
    'trip', jsonb_build_object('id', t.id, 'origin', l.origin, 'destination', l.destination, 'rate', t.rate,
      'delivered_at', t.delivered_at, 'status', t.status, 'broker', (select name from public.organizations where id=l.broker_org)),
    'factor', case when prof.org_id is not null and coalesce(prof.factoring_noa,false) then jsonb_build_object(
      'company', prof.factoring_company, 'noa_status', prof.noa_status,
      'remittance_email', prof.factor_details->>'remittance_email',
      'advance_pct', prof.factor_details->>'advance_pct',
      'terms_days_broker', coalesce(prof.factor_details->>'terms_days_broker','30')) end,
    'rate_confirmation', v_rc,
    'documents', v_docs,
    'invoice', case when v_inv.id is null then null else jsonb_build_object('invoice_no', v_inv.invoice_no, 'gross', v_inv.gross, 'status', v_inv.status, 'issued_at', v_inv.issued_at) end,
    'gps_proof', jsonb_build_object('started_at', t.started_at, 'delivered_at', t.delivered_at,
      'note', 'GPS arrival/departure stamps for every stop are on record and appear on the claim/POD trail — factors accept these as delivery evidence.'),
    'missing', v_missing,
    'how_to_fund', 'Send the factor: (1) your invoice, (2) the executed rate confirmation, (3) the signed POD/BOL, (4) any lumper/accessorial receipts. All of it is collected on this trip automatically — download each item and email the bundle to ' || coalesce(prof.factor_details->>'remittance_email','your factor') || '. Typical funding: same or next business day after clean paperwork.');
end; $fn$;
