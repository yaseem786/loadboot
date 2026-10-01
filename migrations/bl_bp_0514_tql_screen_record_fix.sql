-- bl_bp_0514 — data correction for TQL (org 0f2b9548-653f-4dd4-ba83-95eb39f876b4, MC-322572).
-- Its 1 Oct 12:05 screen ran before fmcsa-verify v35 and stored USDOT 739918 — an inactive 1998 carrier
-- registration under the same MC — as "the" record: DOT 739918, entity CARRIER, phone 513-831-2600. Staff
-- passed the screen and confirmed identity by hand (14:01 / 14:02), which changed the verdict but not the
-- stored record, so CC kept showing 322572 / 739918 · CARRIER. FMCSA's active record is USDOT 2223295,
-- SHIPPER/BROKER, phone 513-495-6760 (SAFER, checked 1 Oct 2026).
-- Record fields only: outcome, reason, identity status and verified_at are untouched. Not re-screened on
-- purpose (live customer account). Idempotent: only rewrites a row still carrying 739918.

do $$
declare v_org uuid := '0f2b9548-653f-4dd4-ba83-95eb39f876b4'; n int;
begin
  update app_private.broker_screenings
     set dot_number  = '2223295',
         entity_type = 'SHIPPER/BROKER',
         phone       = '5134956760',
         raw = coalesce(raw, '{}'::jsonb) || jsonb_build_object(
           'dotNumber', 2223295, 'entityType', 'SHIPPER/BROKER', 'phone', '5134956760',
           'registrationStatus', 'active', 'allowedToOperate', 'Y',
           'physicalAddress', '4289 IVY POINTE BLVD, CINCINNATI, OH, 45245',
           'mailingAddress', '4289 IVY POINTE BLVD, CINCINNATI, OH, 45245',
           'mcOtherDots', jsonb_build_array(739918),
           'correctedBy', 'bl_bp_0514',
           'correctionNote', 'Record corrected from inactive USDOT 739918 to active USDOT 2223295 (FMCSA SAFER, 1 Oct 2026). Screen verdict unchanged.'),
         updated_at = now()
   where org_id = v_org and dot_number = '739918';
  get diagnostics n = row_count;
  if n = 0 then return; end if;   -- already corrected

  update app_private.broker_identity
     set fmcsa_phone = '5134956760', updated_at = now()
   where org_id = v_org and fmcsa_phone = '5138312600';

  insert into app_private.audit_logs(action, summary, detail, target_id, target_type, target_org_id, actor_is_staff)
  values ('broker.trust.record_corrected',
          'FMCSA record on file corrected: USDOT 739918 (inactive carrier) -> 2223295 (active SHIPPER/BROKER), phone 513-495-6760. Verdict unchanged.',
          jsonb_build_object('migration', 'bl_bp_0514', 'from_dot', '739918', 'to_dot', '2223295',
                             'from_phone', '5138312600', 'to_phone', '5134956760'),
          v_org, 'organization', v_org, true);
end $$;
