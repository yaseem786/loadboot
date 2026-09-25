-- bl_lc_0392 — live chat: the "somebody asked for a human and got nothing" safety net
--
-- WHY (audit 22 Sep 2026, production):
--   25 open conversations. 15 of them are mode='human' with first_staff_reply_at NULL —
--   a person asked for a human and never got one. NOTHING was alerting on any of them:
--
--   1) lc_sla_alert() required `staff_unread > 0`, but cc_lc_get() (just OPENING the
--      conversation in Command Center to read it) sets staff_unread = 0. So "read" was
--      being treated as "answered": one click and the alarm was disarmed for good.
--      On prod, 0 of 25 open conversations had staff_unread > 0 → the SLA alert was dead.
--   2) lc_watchdog() pass 2 required `pending_human AND mode='bot'`, but lc_do_handoff()
--      and cc_lc_assign() both set pending_human = false. 0 of 25 open conversations had
--      pending_human → the stranded rescue was dead too.
--   3) lc_sla_alert() also gave up after 24h, so nothing ever re-surfaced a backlog.
--
-- WHAT THIS DOES (additive; no table changes, no new public surface):
--   a) app_private.lc_unanswered_alert() — a net that does not depend on staff_unread or
--      pending_human. It asks the only question that matters: has a real staff message
--      landed since the visitor last spoke / since the handoff? Re-alerts every 6h, gives
--      up after 7 days so an old backlog is a human judgement call, never a blast.
--   b) lc_sla_alert() — the `staff_unread > 0` clause is replaced by the same real test,
--      and the 24h horizon widened to 72h.
--   c) lc_reply_notify() — internal [[note]] and [[sys]] staff messages are excluded, so an
--      internal note can never be emailed to the customer as "you have a reply" (latent:
--      the v3 console plans internal notes through cc_lc_reply, which writes sender='staff').
--      The 2h window is widened to 24h so a delivery-worker outage no longer silently eats
--      the visitor's reply notification.
--
-- Rollback: `drop function app_private.lc_unanswered_alert(integer);` and re-apply the
-- previous definitions of lc_sla_alert / lc_reply_notify from bl_lc_ history.

-- ── a) the net ───────────────────────────────────────────────────────────────────────
create or replace function app_private.lc_unanswered_alert(p_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path to 'app_private, public'
as $function$
declare r record; n int := 0; v_subj text; v_html text; v_hrs int;
begin
  for r in
    select c.id, c.name, c.email, c.visitor_role, c.origin, c.page, c.last_msg_at,
           greatest(coalesce(c.handoff_at, c.created_at), c.last_msg_at) as waiting_since
      from app_private.lc_conversations c
     where c.status = 'open'
       and (c.mode = 'human' or c.handoff_at is not null)
       -- a real staff message has NOT landed since the visitor last spoke
       and coalesce((select max(m.created_at) from app_private.lc_messages m
                      where m.conversation_id = c.id and m.sender = 'staff'
                        and m.body not like '[[note]]%' and m.body not like '[[sys]]%'),
                    '-infinity'::timestamptz)
           < greatest(coalesce(c.handoff_at, c.created_at),
                      coalesce((select max(m.created_at) from app_private.lc_messages m
                                 where m.conversation_id = c.id and m.sender = 'visitor'),
                               c.created_at))
       and c.last_msg_at < now() - interval '15 minutes'
       and c.last_msg_at > now() - interval '7 days'
       and (c.sla_alerted_at is null or c.sla_alerted_at < now() - interval '6 hours')
     order by c.last_msg_at
     limit greatest(1, p_limit)
  loop
    v_hrs  := greatest(1, (extract(epoch from (now() - r.waiting_since))::int / 3600));
    v_subj := '🙋 ' || v_hrs || 'h with no human reply — ' || coalesce(r.name, 'a visitor')
              || ' (' || coalesce(r.visitor_role, 'unknown role') || ')';
    v_html := '<h2 style="margin:0 0 8px;font-size:20px;color:#b91c1c">' || v_subj || '</h2>'
      || '<p style="color:#475569;line-height:1.6;margin:0 0 14px">They asked for a person and no one has answered. '
      || 'Origin: ' || coalesce(r.origin, 'website') || coalesce(' · page ' || r.page, '')
      || coalesce('<br>Email: ' || r.email, '<br>No email on file — they can only be reached inside the chat.') || '</p>'
      || '<div style="background:#f6f9fd;border-left:3px solid #FC5305;padding:12px 14px;border-radius:8px;white-space:pre-wrap;color:#0b1220">'
      || coalesce((select string_agg(case m.sender when 'visitor' then '👤 ' when 'staff' then '🧑 ' else '⚡ ' end
                     || left(regexp_replace(m.body, '\[\[[^\]]*\]\]', '', 'g'), 300), E'\n' order by m.id)
                     from (select * from app_private.lc_messages
                            where conversation_id = r.id and body not like '[[note]]%'
                            order by id desc limit 6) m), '')
      || '</div><p style="margin:16px 0 0"><a href="https://loadboot.com/app/command-center/#/live-chat?id=' || r.id::text
      || '" style="display:inline-block;padding:12px 22px;background:#FC5305;color:#fff;border-radius:10px;text-decoration:none;font-weight:700">Open this chat →</a></p>';
    begin
      perform app_private.sys_email(app_private.lc_alert_email(), 'chat.unanswered', v_subj, v_html,
        v_subj || ' — https://loadboot.com/app/command-center/#/live-chat?id=' || r.id::text,
        'lcunans:' || r.id::text || ':' || to_char(now(), 'YYYYMMDDHH24'));
      insert into app_private.notifications (recipient_role, channel, template_key, payload, status, sent_at)
      values ('staff','in_app','livechat.unanswered',
        jsonb_build_object('title', v_subj, 'body', 'Nobody has replied. Open Live chat and answer.',
                           'tone','urgent','url','/live-chat?id=' || r.id::text), 'sent', now());
    exception when others then raise warning 'lc_unanswered_alert failed for %: %', r.id, sqlerrm; end;
    update app_private.lc_conversations set sla_alerted_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return jsonb_build_object('alerted', n);
end $function$;

revoke all on function app_private.lc_unanswered_alert(integer) from public, anon, authenticated;

-- ── b) lc_sla_alert: stop treating "read" as "answered" ──────────────────────────────
-- ── c) lc_reply_notify: never email an internal note to the customer ─────────────────
-- Both are anchor-string patches of the live definition (cheaper and safer than retyping
-- a 90-line body). Re-running this block is a no-op once the anchors are gone.
do $patch$
declare d text;
begin
  d := pg_get_functiondef('app_private.lc_sla_alert()'::regprocedure);
  d := replace(d,
    'and c.staff_unread > 0',
    'and coalesce((select max(m.created_at) from app_private.lc_messages m
                      where m.conversation_id = c.id and m.sender = ''staff''
                        and m.body not like ''[[note]]%'' and m.body not like ''[[sys]]%''),
                    ''-infinity''::timestamptz)
           < greatest(coalesce(c.handoff_at, c.created_at),
                      coalesce((select max(m.created_at) from app_private.lc_messages m
                                 where m.conversation_id = c.id and m.sender = ''visitor''),
                               c.created_at))');
  d := replace(d, 'c.last_msg_at > now() - interval ''24 hours''',
                  'c.last_msg_at > now() - interval ''72 hours''');
  execute d;

  d := pg_get_functiondef('app_private.lc_reply_notify(integer)'::regprocedure);
  d := replace(d,
    'where m2.conversation_id = c.id',
    'where m2.conversation_id = c.id
           and m2.body not like ''[[note]]%''
           and m2.body not like ''[[sys]]%''');
  d := replace(d, 'm.created_at > now() - interval ''2 hours''',
                  'm.created_at > now() - interval ''24 hours''');
  execute d;
end $patch$;

-- ── d) schedule ──────────────────────────────────────────────────────────────────────
-- Applied 22 Sep 2026: staging jobid 46, prod jobid 50.
-- select cron.schedule('lb-lc-unanswered','*/15 * * * *','select app_private.lc_unanswered_alert(20)');
