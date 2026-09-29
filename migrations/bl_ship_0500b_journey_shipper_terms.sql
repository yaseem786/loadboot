-- bl_ship_0500b — CC journey: a shipper's agreement step is the Platform Terms, not broker_shipper (29 Sep 2026).
-- Found while answering the owner's screenshot (CC → Partners, "Next for staff: No published agreement of kind
-- broker_shipper — Publish it under Legal"). Since 0491 the shipper gate is shipper_platform (+ shipper_carrier for
-- the direct lane, shown in Verification). partner_journey still pointed staff at broker_shipper — publishing that
-- would have been the wrong document. Now:
--   * v_agr_kind = shipper_platform for shippers;
--   * "done" only when the shipper signed the LATEST published+approved version (shipper_item_status), so a v1
--     signer shows as to-do after v2 is published;
--   * "published" also requires legal_approved, same as the portal.
-- Anchor-patched, idempotent. Run after 0500.

do $do$
declare d text;
  a1 text := $a$    v_agr_kind := 'broker_shipper';$a$;
  a2 text := $a$    select exists (select 1 from app_private.master_agreements where kind = v_agr_kind and published) into v_agr_pub;$a$;
begin
  d := pg_get_functiondef('app_private.partner_journey(uuid)'::regprocedure);
  if position('bl_ship_0500b' in d) = 0 then
    if position(a1 in d) = 0 or position(a2 in d) = 0 then raise exception 'bl_ship_0500b: partner_journey anchor not found'; end if;
    d := replace(d, a1, $b$    v_agr_kind := 'shipper_platform';  -- bl_ship_0500b (was broker_shipper)$b$);
    d := replace(d, a2, $b$    select exists (select 1 from app_private.master_agreements where kind = v_agr_kind and published and legal_approved) into v_agr_pub;
    if v_role = 'shipper' and app_private.shipper_item_status(p_org, 'platform_terms') <> 'verified' then v_agr_at := null; end if;  -- bl_ship_0500b: latest version only$b$);
    execute d;
  end if;
end $do$;
