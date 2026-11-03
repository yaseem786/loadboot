-- bl_mail_0593 — dispatcher mailboxes: sends get recorded again and alias routing stops failing (owner, 3 Nov 2026)
-- bl_mail_0576 changed the unique index to (account_id, coalesce(imap_box, folder), uidvalidity, imap_uid), but
-- dmail_sent_store and dmail_route still said ON CONFLICT (account_id, folder, uidvalidity, imap_uid). Postgres refuses that:
--   * dmail_sent_store ran AFTER SMTP had delivered the mail, so the email went out but the draft stayed in Drafts and
--     nothing reached Sent. The dispatcher saw "Draft" and pressed Send again, so the carrier got repeat copies.
--   * dmail_route failed inside dmail_ingest on any message routed to an alias, so the dispatch@ sync stopped succeeding.
-- Fix: one anchor in each function. Nothing else changes.

do $$
declare r record; d text; n int;
  v_old text := 'on conflict (account_id, folder, uidvalidity, imap_uid) where imap_uid is not null';
  v_new text := 'on conflict (account_id, (coalesce(imap_box, folder)), uidvalidity, imap_uid) where imap_uid is not null';
begin
  for r in select * from (values ('public.dmail_sent_store(uuid,uuid,jsonb,uuid)'), ('app_private.dmail_route(uuid)')) v(fn) loop
    d := pg_get_functiondef(r.fn::regprocedure);
    if position(v_new in d) > 0 then continue; end if;
    n := (length(d) - length(replace(d, v_old, ''))) / length(v_old);
    if n <> 1 then raise exception 'bl_mail_0593: anchor found % times in %', n, r.fn; end if;
    execute replace(d, v_old, v_new);
  end loop;
end $$;
