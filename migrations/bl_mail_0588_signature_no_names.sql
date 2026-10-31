-- bl_mail_0588 — owner ask 31 Oct 2026: no personal name or title in any CC mailbox signature.
-- Every mailbox signs as a team desk. hello@ was the only one carrying a person ("Muhammad Yaseen / Founder, LoadBoot");
-- it now signs as "LoadBoot Operations / Support and Partnerships". dispatch@ / billing@ / loads@ were already desk names.
update app_private.mail_boxes
   set signature_html = replace(replace(signature_html,
         '>Muhammad Yaseen</div>', '>LoadBoot Operations</div>'),
         '>Founder, LoadBoot</div>', '>Support and Partnerships</div>')
 where address = 'hello@loadboot.com';

do $$ begin
  if exists (select 1 from app_private.mail_boxes where signature_html ~* '(yaseen|founder)') then
    raise exception 'bl_mail_0588: a mailbox signature still carries a personal name/title';
  end if;
end $$;
