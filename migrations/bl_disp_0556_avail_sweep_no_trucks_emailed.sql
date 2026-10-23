-- bl_disp_0556 — availability notice: skip carriers with no trucks; `emailed` only when sys_email really queued it (15 Oct 2026)
--
-- Yaseen 15 Oct (follow-up to bl_disp_0555, first sweep run 21:41 UTC):
--   1. A carrier with no active fleet truck (carrier_availability_fresh.reason = 'no_trucks', e.g. THE WAY HOME LLC) cannot
--      post availability, so the "Post your availability" notice is noise for them and wrongly counts them as "did not post"
--      in the 22 Oct review. disp_avail_notice now returns false for them: no in-app notice, no e-mail, no notices row, no
--      24 h cap used. Covers both callers (cron lb-disp-avail-sweep and cc_dispatcher_assign). The gate itself is unchanged.
--   2. disp_avail_notices.emailed was set true after sys_email returned, but sys_email returns void and silently refuses
--      (unsubscribed, suppressed, exit hold, catalog off, bad address) — Sprint Shift (unsubscribed_all) read emailed=true.
--      New column email_status: queued | test | blocked | demo | no_email | error (null = pre-0556 row not backfilled).
--      queued/test = a message_deliveries row exists for the notice's idempotency key and no trigger marked it suppressed
--      (staging: training/.invalid addresses are suppressed at insert) (test = catalog send_mode test, went to test_to, not the carrier). emailed = (email_status = 'queued'). Review counts still come from message_deliveries.
--
-- Anchor-replaced (each anchor must occur exactly once), apply STAGING first, then PROD. Additive; no anon surface change.

alter table app_private.disp_avail_notices add column if not exists email_status text;
do $$ begin
  alter table app_private.disp_avail_notices add constraint disp_avail_notices_email_status_chk
    check (email_status is null or email_status in ('pending','queued','test','blocked','demo','no_email','error'));
exception when duplicate_object then null; end $$;

do $mig$
declare r record; v_def text; v_n int;
begin
  for r in
    select * from (values
      (1, 'v_enf boolean; v_body text;',
          'v_enf boolean; v_body text; v_nid bigint; v_key text; v_st text;'),
      (2, 'or (g->>''fresh'')::boolean then return false; end if;',
          'or (g->>''fresh'')::boolean or (g->>''reason'') = ''no_trucks'' then return false; end if;'),
      (3, 'insert into app_private.disp_avail_notices (carrier_org_id, assignment_id, kind, reason, emailed) values (p_org, v_a.id, p_kind, g->>''reason'', false);',
          'insert into app_private.disp_avail_notices (carrier_org_id, assignment_id, kind, reason, emailed, email_status) values (p_org, v_a.id, p_kind, g->>''reason'', false, ''pending'') returning id into v_nid;'),
      (4, 'if v_demo then return true; end if;',
          'if v_demo then update app_private.disp_avail_notices set email_status = ''demo'' where id = v_nid; return true; end if;'),
      (5, 'if v_mail is null then return true; end if;',
          'if v_mail is null then update app_private.disp_avail_notices set email_status = ''no_email'' where id = v_nid; return true; end if;'),
      (6, 'perform app_private.sys_email(v_mail, ''carrier.availability.required'', v_sub, v_html, v_txt, ''availreq:'' || p_org::text || '':'' || to_char(now(), ''YYYYMMDDHH24''));',
          'v_key := ''availreq:'' || p_org::text || '':'' || to_char(now(), ''YYYYMMDDHH24'');
    perform app_private.sys_email(v_mail, ''carrier.availability.required'', v_sub, v_html, v_txt, v_key);'),
      (7, 'update app_private.disp_avail_notices set emailed = true where id = (select max(id) from app_private.disp_avail_notices where carrier_org_id = p_org);',
          '-- bl_disp_0556: sys_email returns void and refuses silently; only a delivery row that a trigger did not mark suppressed means it was queued
    v_st := coalesce((select case when d.status::text = ''suppressed'' then ''blocked'' when d.idempotency_key = v_key then ''queued'' else ''test'' end from app_private.message_deliveries d
                       where d.idempotency_key in (v_key, v_key || '':test'') order by (d.idempotency_key = v_key) desc limit 1), ''blocked'');
    update app_private.disp_avail_notices set email_status = v_st, emailed = (v_st = ''queued'') where id = v_nid;'),
      (8, 'exception when others then null; end;',
          'exception when others then update app_private.disp_avail_notices set email_status = ''error'' where id = v_nid; end;')
    ) t(ord, anchor, repl) order by ord
  loop
    v_def := pg_get_functiondef('app_private.disp_avail_notice(uuid,text)'::regprocedure);
    v_n := (length(v_def) - length(replace(v_def, r.anchor, ''))) / length(r.anchor);
    if v_n <> 1 then raise exception 'bl_disp_0556 patch % on disp_avail_notice: anchor found % times (expected 1)', r.ord, v_n; end if;
    execute replace(v_def, r.anchor, r.repl);
  end loop;
end $mig$;
revoke all on function app_private.disp_avail_notice(uuid, text) from public, anon, authenticated;

-- backfill rows written before this file (first sweep, 15 Oct 21:41 UTC)
update app_private.disp_avail_notices n
   set email_status = case
         when app_private.is_demo_org(n.carrier_org_id) then 'demo'
         when exists (select 1 from app_private.message_deliveries d where d.status::text <> 'suppressed'
                       and d.idempotency_key = 'availreq:' || n.carrier_org_id::text || ':' || to_char(n.sent_at, 'YYYYMMDDHH24')) then 'queued'
         when exists (select 1 from app_private.message_deliveries d where d.status::text <> 'suppressed'
                       and d.idempotency_key = 'availreq:' || n.carrier_org_id::text || ':' || to_char(n.sent_at, 'YYYYMMDDHH24') || ':test') then 'test'
         else 'blocked' end
 where n.email_status is null;
update app_private.disp_avail_notices set emailed = (email_status = 'queued') where emailed is distinct from (email_status = 'queued');

-- catalog row: say who is skipped (§6 — the row describes the stop condition)
update app_private.email_catalog
   set stop_condition = coalesce(nullif(rtrim(stop_condition, ' .'), '') || '. ', '') || 'Never sent to a carrier with no active truck (bl_disp_0556).'
 where key = 'carrier.availability.required' and coalesce(stop_condition, '') not like '%bl_disp_0556%';
