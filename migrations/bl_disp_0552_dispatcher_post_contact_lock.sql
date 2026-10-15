-- bl_disp_0552 — dispatcher posts: broker contact + board load ID stay locked until the carrier accepts.
--
-- Owner, 15 Oct 2026 (dispatch agreement Art. 10.2): a carrier must not get the broker's phone / e-mail / rep, or the
-- board load ID / link, from a load their dispatcher posted until they have accepted it — otherwise the carrier can
-- book the load around the dispatcher. Broker NAME + MC (and the FMCSA screen) stay visible so the carrier can still
-- judge the broker. Staff (CC) and the dispatcher's own views are unchanged.
--
-- Locked while loads.status is available / declined / expired / withdrawn (i.e. the carrier never said yes).
-- From carrier_accepted on (booked, in transit, ...) the carrier sees everything, as before.
--
-- Surfaces closed (the only three that hand a dispatcher post's details to a carrier before accept):
--   public.cc_load_detail            — the load overview: source_reference null, details redacted, + contact_locked
--   public.cc_pocket_available_loads — the board list: details redacted for dispatcher posts
--   app_private.disp_post_notify_carrier — the "new load from your dispatcher" e-mail: "· ref <board ID>" dropped
--
-- Each function is patched by replacing one anchor string in its current definition (asserted to occur exactly once),
-- so nothing else in the body moves. ACLs are kept by CREATE OR REPLACE. No new public function → the anon SECURITY
-- DEFINER surface does not change.

create or replace function app_private.disp_post_redact(p jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select (coalesce(p, '{}'::jsonb) - array['broker_phone', 'broker_email', 'broker_rep', 'board_ref', 'source_link'])
         #- '{broker_screen,phone}' #- '{broker_screen,email}'
$$;
revoke execute on function app_private.disp_post_redact(jsonb) from public, anon, authenticated;

do $mig$
declare
  v_def text;
begin
  -- helper: replace exactly-once anchors in a function definition and re-create it
  create temporary table if not exists _p0552 (fn text, old text, new text, ord int) on commit drop;
  insert into _p0552 values
    -- cc_load_detail
    ('public.cc_load_detail(uuid)',
     'fm jsonb; v_org uuid;',
     'fm jsonb; v_org uuid; v_hide boolean;', 1),
    ('public.cc_load_detail(uuid)',
     E'  v_appt := coalesce(pl.appointment_required, (fm->>''appointment_required'')::boolean, false);\n',
     E'  v_appt := coalesce(pl.appointment_required, (fm->>''appointment_required'')::boolean, false);\n'
     || E'  -- bl_disp_0552: a dispatcher post keeps broker contact + board load ID locked until the carrier accepts (Art. 10.2)\n'
     || E'  v_hide := l.source_type = ''dispatcher'' and l.status in (''available'', ''declined'', ''expired'', ''withdrawn'') and not public.is_active_staff();\n', 2),
    ('public.cc_load_detail(uuid)',
     '''source_reference'', l.source_reference,',
     '''source_reference'', case when v_hide then null else l.source_reference end,', 3),
    ('public.cc_load_detail(uuid)',
     '''dispatcher_post'', case when l.source_type = ''dispatcher'' then l.details->''dispatcher_post'' end,',
     '''dispatcher_post'', case when l.source_type = ''dispatcher'' then l.details->''dispatcher_post'' end, ''contact_locked'', v_hide,', 4),
    ('public.cc_load_detail(uuid)',
     '''details'', coalesce(pl.details, l.details, ''{}''::jsonb)',
     '''details'', case when v_hide then app_private.disp_post_redact(coalesce(pl.details, l.details)) else coalesce(pl.details, l.details, ''{}''::jsonb) end', 5),
    -- cc_pocket_available_loads (status = 'available' only, so every dispatcher post here is pre-accept)
    ('public.cc_pocket_available_loads(integer,integer)',
     'declare v_me uuid;',
     'declare v_me uuid; v_staff boolean := public.is_active_staff();', 1),
    ('public.cc_pocket_available_loads(integer,integer)',
     '(coalesce(l.details,''{}''::jsonb) - ''load_source'')',
     '(case when l.source_type = ''dispatcher'' and not v_staff then app_private.disp_post_redact(l.details) else coalesce(l.details,''{}''::jsonb) end - ''load_source'')  -- bl_disp_0552', 2),
    -- the carrier's "new / updated load from your dispatcher" in-app + e-mail facts
    ('app_private.disp_post_notify_carrier(uuid,text)',
     'coalesce(dp->>''board_label'', ''—'') || coalesce('' · ref '' || nullif(l.source_reference,''''), '''')',
     'coalesce(dp->>''board_label'', ''—'')', 1);

  for v_def in select distinct fn from _p0552 loop
    declare r record; d text; c int;
    begin
      d := pg_get_functiondef(v_def::regprocedure);
      for r in select * from _p0552 where fn = v_def order by ord loop
        c := (length(d) - length(replace(d, r.old, ''))) / length(r.old);
        if c <> 1 then raise exception 'bl_disp_0552: anchor % of % found % times', r.ord, r.fn, c; end if;
        d := replace(d, r.old, r.new);
      end loop;
      execute d;
    end;
  end loop;
end $mig$;
