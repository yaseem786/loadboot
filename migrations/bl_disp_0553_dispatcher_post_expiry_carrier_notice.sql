-- bl_disp_0553 — tell the carrier when a load their dispatcher posted expires (15 Oct 2026)
--
-- Gap found 15 Oct: app_private.disp_posts_expire() flipped a dispatcher post to 'expired' and told only the
-- DISPATCHER. The carrier's board drops the post at expires_at (cc_pocket_available_loads), so for the carrier a
-- load they were notified about simply vanished. Owner decision 15 Oct: expired posts stay on record as 'expired'
-- (never deleted) and stay off the board; the carrier gets an in-app notice saying why it is gone.
--
-- What changes: ONE function, by two exact-once anchor patches (app_private.fn_patch raises if an anchor is not
-- found exactly once; re-running is a no-op). Per expired post, up to 3 active non-driver members of the target
-- carrier get an in-app notification 'dispatcher.load.expired' (deep link /app/carrier/#loads + load_id; opening
-- the load shows "⏰ This post expired."). In-app only, no e-mail, so no email_catalog row — same as the other
-- in-app-only keys dispatcher.load.accepted / dispatcher.load.updated. One notice per post per member (guarded).
-- No new function, no grant change: the anon SECURITY DEFINER surface must stay 36 (prod) / 35 (staging).

do $$
begin
  perform app_private.fn_patch('app_private.disp_posts_expire()',
    $a$declare r record; v_n int := 0; v_disp uuid;$a$,
    $a$declare r record; v_n int := 0; v_disp uuid; m record; v_ctitle text; v_cbody text;$a$);

  perform app_private.fn_patch('app_private.disp_posts_expire()',
    $a$    begin perform app_private.disp_audit('dispatcher.load.expire', 'load', r.id::text, r.target_carrier_org, 'post expired without a decision', '{}'::jsonb); exception when others then null; end;$a$,
    $a$    -- bl_disp_0553: the carrier is told too, so the post does not just vanish from their board
    if r.target_carrier_org is not null then
      v_ctitle := '⏰ Load expired: ' || coalesce(r.origin,'—') || ' → ' || coalesce(r.destination,'—');
      v_cbody := app_private.disp_money(r.rate) || coalesce(' · ' || r.miles || ' mi', '')
        || ' — your dispatcher posted it for you and it '
        || case when r.expires_at is not null and r.expires_at <= now() then 'timed out' else 'passed its pickup date' end
        || ' before a decision. It is off your board; nothing to do. Still want it? Ask your dispatcher to post it again.';
      for m in select om.user_id as uid from public.organization_memberships om
                where om.org_id = r.target_carrier_org and om.status = 'active' and coalesce(om.member_role,'') <> 'driver'
                order by (om.member_role = 'owner') desc, om.created_at limit 3 loop
        begin
          if not exists (select 1 from app_private.notifications n where n.template_key = 'dispatcher.load.expired'
                           and n.recipient_user = m.uid and n.payload->>'load_id' = r.id::text) then
            insert into app_private.notifications (recipient_role, recipient_user, channel, template_key, payload, status, sent_at)
            values ('carrier', m.uid, 'in_app', 'dispatcher.load.expired',
                    jsonb_build_object('title', v_ctitle, 'body', v_cbody, 'tone', 'info', 'url', '/app/carrier/#loads', 'load_id', r.id), 'sent', now());
          end if;
        exception when others then null; end;
      end loop;
    end if;
    begin perform app_private.disp_audit('dispatcher.load.expire', 'load', r.id::text, r.target_carrier_org, 'post expired without a decision', '{}'::jsonb); exception when others then null; end;$a$);
end $$;
