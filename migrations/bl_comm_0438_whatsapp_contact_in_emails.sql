-- bl_comm_0438 — Every email follows the ONE contact switch (CC → contact channel), never a hard-coded phone.
--
-- WHY (owner, 24 Sep 2026): emails still showed the Retell/"Riley" phone line +1 (469) 253-7575 while the
-- contact channel has been 'whatsapp' since 22 Sep. bl_wa_0391 made the site follow the switch; email was
-- missed in three places:
--   1) the delivery-worker footer on EVERY email ("Rather just talk? Call us 24/7 …")  → edge fn v-next (same commit)
--   2) 8 cold-outreach templates: "loadboot.com · +1 (469) 253-7575 · available 24/7"   → {{contact_inline}}
--   3) two sys_email bodies with the number in the signature (request_account_deletion,
--      cc_agent_payout_request_details)                                                → {{contact_inline}}
-- {{contact_inline}} is expanded at send time by app_private.contact_expand (sys_email + outreach_prepare), so
-- flipping the CC switch back to 'phone' restores the phone line everywhere without another deploy.
--
-- 4) Account erasure (cc_account_deletion_process) rewrites auth.users.email to deleted+<id>@deleted.invalid and
--    scrambles the password. trg_comm_auth_user_sec treated that as a real change and queued "your password was
--    changed" / "your sign-in email was changed — if this wasn't you…" to the person who just asked to be deleted
--    (seen 24 Sep, caught only because those keys were in test mode). Erased accounts are now skipped.
--
-- Not touched on purpose: sms_consent_set_self ("Text START to +1 469-253-7575") — SMS START must go to the SMS
-- number; retell_config.from_number — Riley's own caller id.
-- STAGING: applied + verified 2026-09-24.  PRODUCTION: applied 2026-09-24 (0 templates left with the number,
-- 2 signatures tokenised, trigger guarded, anon surface 33). delivery-worker v18: staging v20, prod v21; a
-- test email to hello@ delivered through v18 at 22:59 UTC.

update app_private.outreach_templates
   set html = replace(html, '+1 (469) 253-7575', '{{contact_inline}}')
 where html like '%+1 (469) 253-7575%';

do $m$ declare f text; d text; n int := 0; begin
  foreach f in array array['public.request_account_deletion(text)', 'public.cc_agent_payout_request_details(uuid,text[],text)'] loop
    if to_regprocedure(f) is null then continue; end if;
    d := pg_get_functiondef(f::regprocedure);
    if position('&middot; +1 (469) 253-7575</p>' in d) > 0 then
      execute replace(d, '&middot; +1 (469) 253-7575</p>', '&middot; {{contact_inline}}</p>');
      n := n + 1;
    end if;
  end loop;
  raise notice 'bl_comm_0438: % signature(s) switched to {{contact_inline}}', n;
end $m$;

do $m$ declare d text; a text := '    if new.encrypted_password is distinct from old.encrypted_password'; begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.proname = 'trg_comm_auth_user_sec' limit 1;
  if d is null then raise notice 'bl_comm_0438: trg_comm_auth_user_sec not found'; return; end if;
  if position('deleted\.invalid' in d) > 0 then return; end if;            -- already guarded
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then
    raise exception 'bl_comm_0438: anchor not unique/absent in trg_comm_auth_user_sec';
  end if;
  execute replace(d, a,
    '    -- bl_comm_0438: account erasure rewrites email/password; never send security alerts for it.' || chr(10) ||
    '    if new.email ~ ''^deleted\+.*@deleted\.invalid$'' then return new; end if;' || chr(10) || a);
end $m$;
