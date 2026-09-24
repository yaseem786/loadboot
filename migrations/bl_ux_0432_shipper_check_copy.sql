-- bl_ux_0432 — shipper business-check notice reads like a sentence for a shipper (ux-audit 2026-09, O14).
-- Before: "domain acme.com has no mail (MX) records. Enter an address on your company's real domain under
--          Onboarding — we send it a code."   (developer-speak; check_reason in CC keeps the technical wording)
-- After:  "Email at acme.com does not receive mail, so we could not confirm your business automatically.
--          Add an address on your company's own domain under Onboarding and we will send it a code there."
-- Anchor replace on the live definition of app_private.shipper_check_collect (staging + prod both md5
-- 59428b60e95842148a3678efd405e2c2 before). In-app notification only (notify_partner sends no email).
do $m$
declare d text; n int;
  a text := $a$v_reason || '. Enter an address on your company''s real domain under Onboarding — we send it a code.'$a$;
  b text := $b$'Email at ' || coalesce(body->>'domain','your domain') || ' does not receive mail, so we could not confirm your business automatically. Add an address on your company''s own domain under Onboarding and we will send it a code there.'$b$;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'app_private' and p.proname = 'shipper_check_collect';
  n := (length(d) - length(replace(d, a, ''))) / length(a);
  if n <> 1 then raise exception 'bl_ux_0432: anchor count % (expected 1) — nothing applied', n; end if;
  execute replace(d, a, b);
end $m$;
