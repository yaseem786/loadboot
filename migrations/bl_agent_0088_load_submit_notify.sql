-- bl_agent_0088 — partner-load SUBMIT notifications (was: total silence at submit time).
-- On insert/update to status='submitted':
--   staff  -> in-app "📦 Load awaiting review" (agent loads flagged 🤝 + LOAD SOURCE reminder)
--   agent  -> in-app + email "submitted — goes LIVE on the carrier board once dispatch approves;
--             source rate con + billing contact due in 2 hours"
-- Applied to staging 2026-07-13. NOTE: canonical SQL was applied via execute_sql; this file is the replay copy for PROD.

create or replace function app_private.trg_partner_load_submit_notify()
 returns trigger language plpgsql security definer
 set search_path to 'app_private, public'
as $$
declare v_agent boolean; v_org text; v_email text;
begin
  if new.status <> 'submitted' then return new; end if;
  if tg_op = 'UPDATE' and old.status = 'submitted' then return new; end if;
  v_agent := app_private.is_agent_org(new.broker_org);
  select name into v_org from public.organizations where id = new.broker_org;
  begin
    insert into app_private.notifications(recipient_role, channel, template_key, payload)
    values ('staff', 'in_app', 'load.review_requested', jsonb_build_object(
      'title', case when v_agent then '🤝📦 AGENT load awaiting review' else '📦 Load awaiting review' end,
      'body', coalesce(v_org,'') || ' — ' || coalesce(new.origin,'') || ' → ' || coalesce(new.destination,'') || ' · $' || coalesce(new.rate::text,'—')
        || case when v_agent then ' · check LOAD SOURCE (proof due in 2h)' else '' end,
      'partner_load', new.id));
  exception when others then null; end;
  if v_agent and new.created_by is not null then
    begin
      insert into app_private.notifications(recipient_user, channel, template_key, payload, status, sent_at)
      values (new.created_by, 'in_app', 'agent.load_submitted', jsonb_build_object(
        'title', '📦 Load submitted — dispatch is reviewing',
        'body', coalesce(new.origin,'') || ' → ' || coalesce(new.destination,'') || ' · $' || coalesce(new.rate::text,'—')
          || '. It goes LIVE on the carrier board once dispatch approves. Reminder: source rate confirmation + billing contact are due within 2 hours.',
        'tone', 'info', 'url', '/app/agent/#loads'), 'sent', now());
    exception when others then null; end;
    begin
      select email into v_email from auth.users where id = new.created_by;
      if v_email is not null then
        perform app_private.sys_email(v_email, 'agent.load_submitted',
          'LoadBoot: load submitted — in dispatch review 📦',
          '<div style="font-family:Inter,Arial,sans-serif"><h2>📦 Your load is in dispatch review</h2>'
          || '<p><b>' || coalesce(new.origin,'') || ' → ' || coalesce(new.destination,'') || '</b> · $' || coalesce(new.rate::text,'—') || '</p>'
          || '<p>It goes <b>LIVE on the carrier board</b> the moment dispatch approves it. Two things speed this up:</p>'
          || '<ul><li>Upload the source <b>rate confirmation</b> (due within 2 hours)</li><li>Confirm the source <b>billing contact</b></li></ul>'
          || '<p><a href="https://loadboot.com/app/agent/#loads">Track it in Chain Loads →</a></p></div>',
          null, 'agentloadsubmit:' || new.id::text);
      end if;
    exception when others then null; end;
  end if;
  return new;
end; $$;

drop trigger if exists trg_partner_load_submit_notify_t on app_private.partner_loads;
create trigger trg_partner_load_submit_notify_t
  after insert or update of status on app_private.partner_loads
  for each row execute function app_private.trg_partner_load_submit_notify();

notify pgrst, 'reload schema';
