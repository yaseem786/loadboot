-- bl_ship_0500c — CC journey: a shipper's "Business confirmed" step reads the 0491 identity gate (29 Sep 2026).
-- Follow-up from 0500b. partner_journey still built the shipper's business step from the pre-0491 domain check
-- (shipper_trust.verified_at / check_outcome: "Domain check running", "FREE_MAIL — verify by hand"), plus a separate
-- "Company email verified" step. Since 0491 the truth is shipper_lane_gate(org,'identity') → shipper_stage:
-- legal entity, address, signer, company email, signer phone, and (conditional) call-back / EIN letter / address proof.
-- Now, for shippers only (carrier / broker / agent steps untouched):
--   * hold                → blocked, with the hold reason (same text the portal shows);
--   * identity gate ok    → done, detail = the stage (identity_verified / broker_ready / direct_ready / both_ready);
--   * an item rejected    → blocked, names it;
--   * otherwise           → todo, lists what is still missing (first 4 + "and N more");
--   * the old "Company email verified" step is dropped — email_verify is one of the identity items above;
--   * the "Can request" stage sentence names the lane that is open instead of the old packet wording.
-- Anchor-patched, idempotent. Run after 0500b.

do $do$
declare d text; p_start int; p_end int;
  a_start text := $a$  elsif v_role = 'shipper' then
    if st.verified_at is not null then$a$;
  a_end   text := $a$
  if v_agr_kind is not null then$a$;
  a_next  text := $a$    v_stage := 'Can request'; v_tone := 'blue'; v_next := 'Business confirmed. Packet (billing, claims contact, agreement) unlocks booking.';$a$;
  b_block text := $b$  elsif v_role = 'shipper' then  -- bl_ship_0500c: business step = 0491 identity gate, not the old domain check
    declare v_ss text := app_private.shipper_stage(p_org);
            v_ig jsonb := app_private.shipper_lane_gate(p_org, 'identity');
            v_miss jsonb := coalesce(v_ig->'missing', '[]'::jsonb);
            v_rej text;
    begin
      select string_agg(m->>'label', ', ') into v_rej from jsonb_array_elements(v_miss) m where m->>'status' = 'rejected';
      if v_ss = 'hold' then
        steps := steps || jsonb_build_object('key','business','label','Business confirmed','state','blocked','at',null,
                   'detail','On hold: ' || coalesce(v_ig->>'hold','?') || '. Release from Trust actions once fixed.','action','trust');
      elsif coalesce((v_ig->>'ok')::boolean, false) then
        steps := steps || jsonb_build_object('key','business','label','Business confirmed','state','done','at',st.verified_at,
                   'detail','Identity checks verified · ' || replace(v_ss, '_', ' ') || coalesce(' · domain ' || st.domain, ''));
      elsif v_rej is not null then
        steps := steps || jsonb_build_object('key','business','label','Business confirmed','state','blocked','at',null,
                   'detail','Rejected, waiting on the shipper: ' || v_rej || '.','action','packet');
      else
        steps := steps || jsonb_build_object('key','business','label','Business confirmed','state','todo','at',null,
                   'detail','Identity checks still open: '
                     || coalesce((select string_agg(m->>'label', ', ') from (select m from jsonb_array_elements(v_miss) m limit 4) s), '?')
                     || case when jsonb_array_length(v_miss) > 4 then ' and ' || (jsonb_array_length(v_miss) - 4) || ' more' else '' end
                     || '. Shown to them under Verification in the portal.','action','packet');
      end if;
    end;
  end if;
$b$;
  b_next  text := $b$    v_stage := 'Can request'; v_tone := 'blue';  -- bl_ship_0500c
    v_next := case app_private.shipper_stage(p_org)
                when 'broker_ready' then 'Broker lane open. The direct lane still needs the carrier terms and its load items (Verification).'
                else 'Identity confirmed. Each lane opens once its items in Verification are done.' end;$b$;
begin
  d := pg_get_functiondef('app_private.partner_journey(uuid)'::regprocedure);
  if position('bl_ship_0500c' in d) = 0 then
    p_start := position(a_start in d);
    if p_start = 0 or position(a_next in d) = 0 then raise exception 'bl_ship_0500c: partner_journey anchor not found'; end if;
    if position(a_start in substr(d, p_start + 1)) > 0 then raise exception 'bl_ship_0500c: start anchor not unique'; end if;
    p_end := p_start + position(a_end in substr(d, p_start)) - 1;
    if p_end < p_start then raise exception 'bl_ship_0500c: end anchor not found after start'; end if;
    d := substr(d, 1, p_start - 1) || b_block || substr(d, p_end);
    d := replace(d, a_next, b_next);
    execute d;
  end if;
end $do$;
