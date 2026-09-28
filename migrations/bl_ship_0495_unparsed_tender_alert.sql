-- bl_ship_0495 — a forwarded tender that the load-mail parser could not read (Gemini 429/503 after retries) is
-- already filed in the CC Mailbox by inbound-mail v6 as "[loads@ unparsed] …" (27 Sep 2026). What was missing is
-- the ALERT: nobody was told. This trigger raises one staff notification per unparsed mail. Staging first.
create or replace function app_private.trg_mail_unparsed_alert()
returns trigger language plpgsql security definer set search_path = app_private, public as $$
begin
  if new.direction = 'in' and coalesce(new.subject, '') like '[loads@ unparsed]%' then
    begin
      insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
      values ('staff', 'in_app', 'mail.loads_unparsed', jsonb_build_object(
        'title', '⚠ Tender email not parsed — handle by hand',
        'body', coalesce(new.peer_email, '?') || ': ' || left(regexp_replace(new.subject, '^\[loads@ unparsed\]\s*', ''), 120)
                || ' · the parser was out of quota or down; the email is in the Mailbox (loads@).',
        'tone', 'action', 'url', '/app/command-center/#/mailbox'), 'sent', now());
    exception when others then null; end;
  end if;
  return new;
end $$;
revoke execute on function app_private.trg_mail_unparsed_alert() from public, anon;
drop trigger if exists trg_mail_unparsed_alert on app_private.mail_messages;
create trigger trg_mail_unparsed_alert after insert on app_private.mail_messages
  for each row execute function app_private.trg_mail_unparsed_alert();
