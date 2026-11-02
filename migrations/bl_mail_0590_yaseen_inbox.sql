-- bl_mail_0590 — CC Mailbox: yaseen@loadboot.com gets its own inbox, and replies leave FROM yaseen@ (owner, 2 Nov 2026)
-- yaseen@ is a Namecheap alias of hello@. A PrivateEmail filter on hello@ (To contains yaseen@ → Forward to
-- hello@in.loadboot.com, keep a copy) brings that mail into the CC Mailbox, but the relay files it under hello@.
-- The IMAP copy of the same message (hello@ is connected over IMAP since bl_mail_0584) carries the envelope recipients,
-- so whichever of the two arrives second moves the Mailbox row to yaseen@ by Message-ID.
--   * mail_boxes row "Yaseen": owner-level visibility (mail.box.billing, like billing@), tpl_prefix 'yaseen.mail.'
--   * email_catalog rows yaseen.mail.compose / yaseen.mail.reply (copies of the billing.mail.* rows)
--   * email_sender_identities row 'yaseen' (delivery-worker v23 sends yaseen.mail.* as LoadBoot Operations <yaseen@loadboot.com>)
--   * signature = the generic team signature already on hello@ (no personal name or title — owner rule)

insert into app_private.mail_boxes (address, label, from_name, purpose, color, icon, view_perm, tpl_prefix, signature_html, sort, updated_at)
select 'yaseen@loadboot.com', 'Yaseen', 'LoadBoot Operations',
       'Owner inbox: mail sent to yaseen@ (alias of hello@). Replies leave from yaseen@.',
       '#5f6368', 'label', 'mail.box.billing', 'yaseen.mail.', h.signature_html, 50, now()
  from app_private.mail_boxes h where h.address = 'hello@loadboot.com'
on conflict (address) do nothing;

insert into app_private.email_catalog
select (jsonb_populate_record(null::app_private.email_catalog,
          to_jsonb(c) || jsonb_build_object(
            'key', replace(c.key, 'billing.', 'yaseen.'),
            'name', replace(coalesce(c.name, ''), 'Billing', 'Yaseen'),
            'purpose', 'Hand-written mail from the CC Mailbox Yaseen inbox (yaseen@loadboot.com). Copy of ' || c.key || '.',
            'sends_total', 0, 'sends_30d', 0, 'first_seen', null, 'last_seen', null,
            'created_at', now(), 'updated_at', now()))).*
  from app_private.email_catalog c where c.key in ('billing.mail.compose', 'billing.mail.reply')
on conflict (key) do nothing;

insert into app_private.email_sender_identities (code, from_address, reply_to, note)
values ('yaseen', 'LoadBoot Operations <yaseen@loadboot.com>', 'yaseen@loadboot.com', 'CC Mailbox Yaseen inbox (yaseen.mail.*). delivery-worker v23 YASEEN. bl_mail_0590.')
on conflict do nothing;

-- relay row arrives (filed under hello@) after the IMAP copy that names yaseen@ as a recipient
create or replace function app_private.trg_mail_yaseen_box()
returns trigger language plpgsql security definer set search_path to 'app_private', 'public' as $function$
begin
  if new.direction = 'in' and lower(coalesce(new.mailbox, '')) = 'hello@loadboot.com' and new.provider_message_id is not null
     and exists (select 1 from app_private.dmail_messages d join app_private.dmail_accounts a on a.id = d.account_id
                  where a.address = 'hello@loadboot.com' and d.message_id = new.provider_message_id
                    and d.rcpts @> array['yaseen@loadboot.com']) then
    new.mailbox := 'yaseen@loadboot.com';
  end if;
  return new;
end $function$;
drop trigger if exists a2_mail_yaseen_box on app_private.mail_messages;
create trigger a2_mail_yaseen_box before insert on app_private.mail_messages
  for each row execute function app_private.trg_mail_yaseen_box();

-- IMAP copy arrives after the relay row
create or replace function app_private.trg_dmail_yaseen_box()
returns trigger language plpgsql security definer set search_path to 'app_private', 'public' as $function$
begin
  if new.message_id is not null and new.rcpts @> array['yaseen@loadboot.com']
     and exists (select 1 from app_private.dmail_accounts a where a.id = new.account_id and a.address = 'hello@loadboot.com') then
    update app_private.mail_messages set mailbox = 'yaseen@loadboot.com'
     where provider_message_id = new.message_id and direction = 'in' and lower(mailbox) = 'hello@loadboot.com';
  end if;
  return new;
end $function$;
drop trigger if exists zz_dmail_yaseen_box on app_private.dmail_messages;
create trigger zz_dmail_yaseen_box after insert on app_private.dmail_messages
  for each row execute function app_private.trg_dmail_yaseen_box();

-- backfill: mail already in the Mailbox
update app_private.mail_messages m set mailbox = 'yaseen@loadboot.com'
 where m.direction = 'in' and lower(m.mailbox) = 'hello@loadboot.com' and m.provider_message_id is not null
   and exists (select 1 from app_private.dmail_messages d join app_private.dmail_accounts a on a.id = d.account_id
                where a.address = 'hello@loadboot.com' and d.message_id = m.provider_message_id
                  and d.rcpts @> array['yaseen@loadboot.com']);

-- bl_mail_0590b (applied separately): the DB mirror of delivery-worker's identity choice learns yaseen.mail.*
do $$
declare d text;
begin
  d := pg_get_functiondef('app_private.email_sender_for(text,text)'::regprocedure);
  if position('yaseen' in d) = 0 then
    d := replace(d, $a$    when coalesce(p_key,'') ~* '^loads\.mail\.' then 'loads'$a$,
                    $a$    when coalesce(p_key,'') ~* '^loads\.mail\.' then 'loads'
    when coalesce(p_key,'') ~* '^yaseen\.mail\.' then 'yaseen'$a$);
    if position('yaseen' in d) = 0 then raise exception 'anchor not found in email_sender_for'; end if;
    execute d;
  end if;
end $$;
