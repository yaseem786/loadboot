-- bl_disp_0319 — APPLIED staging + prod 19 Sep 2026.
-- (A) the skills-test invite tells the truth, (B) an application can no longer contradict itself on load-board access.
-- A1  The invite counted EVERY active bank item (24 q / 118 pts). A v2 attempt draws ONE item per bank_group
--     (18 q / 100 pts). Count what the candidate will actually get.
-- A2  Default duration 45 -> 75 min (both functions): the bank's own suggested_minutes sum to 72 for one draw.
-- A3  The invite promised "one 15-minute call"; the negotiation drill has been a voice note since 13 Sep.
-- B   dispatcher_apply refuses, ON SUBMIT ONLY, a skills block whose own_board_access is empty or holds
--     "No own access" together with an own login. The portal (app/carrier/app.js) now asks ONE single-choice
--     question (skills.board_status: own_paid | employer | none_willing | none | learning) and DERIVES the legacy
--     can_source_loads / own_board_access, so a current client cannot produce either state; this guard is for
--     stale service-worker clients and direct API calls. Drafts (p_submit = false) are never blocked.
-- Patches by anchor replacement against the live definitions; aborts if any anchor is missing. Idempotent for B.
do $mig$
declare d text; n text;
  procedure_missing constant text := 'bl_disp_0319: anchor not found: ';
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace s on s.oid=p.pronamespace
   where s.nspname='app_private' and p.proname='disp_test_invite';
  n := d;
  if position('select count(*), coalesce(sum(max_points),0) into v_qs, v_pts from app_private.skills_test_questions where active;' in n) = 0 then raise exception '%count', procedure_missing; end if;
  n := replace(n, 'select count(*), coalesce(sum(max_points),0) into v_qs, v_pts from app_private.skills_test_questions where active;',
    'select count(*), coalesce(sum(mp),0) into v_qs, v_pts from (select max(max_points) mp from app_private.skills_test_questions where active and bank_version = (select max(bank_version) from app_private.skills_test_questions where active) group by coalesce(bank_group, id::text)) g;');
  if position('After the written test there is one 15-minute call where you negotiate a real load with me. Answer in your own words — that call makes borrowed answers obvious' in n) = 0 then raise exception '%call', procedure_missing; end if;
  n := replace(n, 'After the written test there is one 15-minute call where you negotiate a real load with me. Answer in your own words — that call makes borrowed answers obvious',
    'After the written test there is one short negotiation drill by voice note: I send you a real load and you reply with a voice note negotiating it. Answer in your own words — that drill makes borrowed answers obvious');
  if position('p_minutes integer DEFAULT 45' in n) = 0 then raise exception '%default', procedure_missing; end if;
  n := replace(n, 'p_minutes integer DEFAULT 45', 'p_minutes integer DEFAULT 75');
  execute n;

  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='cc_dispatcher_test_invite';
  if position('p_minutes integer DEFAULT 45' in d) = 0 then raise exception '%cc default', procedure_missing; end if;
  execute replace(d, 'p_minutes integer DEFAULT 45', 'p_minutes integer DEFAULT 75');

  select pg_get_functiondef(p.oid) into d from pg_proc p where p.pronamespace='public'::regnamespace and p.proname='dispatcher_apply';
  if position('bl_disp_0319' in d) = 0 then
    if position(E'  if v_uid is null then return jsonb_build_object(''error'',''not signed in''); end if;\n' in d) = 0 then raise exception '%apply', procedure_missing; end if;
    execute replace(d, E'  if v_uid is null then return jsonb_build_object(''error'',''not signed in''); end if;\n',
      E'  if v_uid is null then return jsonb_build_object(''error'',''not signed in''); end if;\n'
   || E'  -- bl_disp_0319: a submitted application must answer the own-load-board question, and must not contradict itself.\n'
   || E'  if p_submit then\n'
   || E'    if jsonb_typeof(p->''skills''->''own_board_access'') is distinct from ''array'' or jsonb_array_length(p->''skills''->''own_board_access'') = 0 then\n'
   || E'      return jsonb_build_object(''error'',''Please answer the load-board access question in section 2 (refresh the page if you do not see it).'');\n'
   || E'    end if;\n'
   || E'    if (p->''skills''->''own_board_access'') ? ''No own access'' and jsonb_array_length(p->''skills''->''own_board_access'') > 1 then\n'
   || E'      return jsonb_build_object(''error'',''Your load-board answers contradict each other: you ticked both an own login and "No own access". Please keep only the one that is true.'');\n'
   || E'    end if;\n'
   || E'  end if;\n');
  end if;
end $mig$;
