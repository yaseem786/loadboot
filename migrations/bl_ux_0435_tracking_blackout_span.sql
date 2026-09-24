-- bl_ux_0435 — "Tracking dark for 9275 min" → "Tracking dark for 6 d 10 h" (24 Sep 2026, ux-audit C12)
--
-- app_private.cron_tracking_blackout prints the blackout as raw minutes in the carrier alert title,
-- the broker notice, the staff notice and the audit line. After a day that is a five-digit number
-- nobody can read. Same humanising rule as the carrier's own overdue countdown (C9):
--   ≥ 48 h → "6 d 10 h" · ≥ 2 h → "3 h 15 min" · else "45 min".
-- Anchor replace on the LIVE definition (staging and prod differ elsewhere in this function; the
-- four v_min lines are identical on both — checked 24 Sep). Every anchor is counted before anything
-- runs; a miss raises and changes nothing. app_private only; no grants, no anon surface.
-- Rollback: re-create from the pre-change definition (md5 staging 9bf40ce9… / prod af29d6fb…).

do $$
declare v_def text; v_new text;
begin
  select pg_get_functiondef('app_private.cron_tracking_blackout'::regproc) into v_def;
  if (length(v_def) - length(replace(v_def, 'declare t record; m record; v_min int;', ''))) / length('declare t record; m record; v_min int;') <> 1 then raise exception 'anchor A1 not found once'; end if;
  if (length(v_def) - length(replace(v_def, '/ 60)::int);', ''))) / length('/ 60)::int);') <> 1 then raise exception 'anchor A2 not found once'; end if;
  if (length(v_def) - length(replace(v_def, ''' || v_min || '' min', ''))) / length(''' || v_min || '' min') <> 4 then raise exception 'anchor A3 not found 4 times'; end if;
  v_new := replace(v_def, 'declare t record; m record; v_min int;', 'declare t record; m record; v_min int; v_span text;');
  v_new := replace(v_new, '/ 60)::int);',
    '/ 60)::int);' || E'\n' ||
    '    v_span := case when v_min >= 2880 then (v_min / 1440)::text || '' d '' || ((v_min % 1440) / 60)::text || '' h''' || E'\n' ||
    '                    when v_min >= 120 then (v_min / 60)::text || '' h '' || (v_min % 60)::text || '' min''' || E'\n' ||
    '                    else v_min::text || '' min'' end;');
  v_new := replace(v_new, ''' || v_min || '' min', ''' || v_span || ''');
  execute v_new;
end $$;
