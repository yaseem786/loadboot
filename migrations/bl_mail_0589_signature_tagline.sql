-- bl_mail_0589 — owner correction 31 Oct 2026: the LoadBoot tagline is "The Operating System for Trucking".
-- Replaces the "Keep Your Wheels Earning" line in every CC mailbox signature.
update app_private.mail_boxes set signature_html = replace(signature_html, '>Keep Your Wheels Earning</span>', '>The Operating System for Trucking</span>');
do $$ begin
  if exists (select 1 from app_private.mail_boxes where signature_html !~ 'The Operating System for Trucking' or signature_html ~* 'wheels earning') then
    raise exception 'bl_mail_0589: tagline not updated on every mailbox';
  end if;
end $$;
