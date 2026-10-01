-- bl_comm_0513 — the broker welcome email stops saying "your account is live".
-- welcome.broker / welcome.broker_agent (app_private.trg_partner_org_welcome) is rendered the moment the org row is
-- inserted, BEFORE the FMCSA screen runs. It told every new broker "your broker account is live" and "we read your broker
-- authority live from FMCSA (seconds)". On 1 Oct 2026 TQL (MC 322572) got that email while its screen came back UNKNOWN,
-- the account sat pending / cannot post, and nobody told the broker a person was checking it by hand.
-- Now: subject and opening say the account is created and posting opens once authority clears; step 1 says most MCs
-- clear in seconds and, when FMCSA's record is unclear, our team checks it by hand and emails them.
-- Shipper branch untouched. Anchor patch, not retyped; CREATE OR REPLACE keeps the ACL. No public function changes,
-- so the anon SECURITY DEFINER surface is unaffected.

do $$
declare
  d text;
  a1 text := $a$else ' — your ' || v_label || ' account is live' end,$a$;
  b1 text := $b$when v_agent then ' — next, confirm the brokerage you post for' else ' — next, we check your broker authority' end,$b$;
  a2 text := $a$else 'live. Three steps to your first covered load:</p>' end$a$;
  b2 text := $b$when v_agent then 'created. You can post once the brokerage you post for is confirmed. Three steps to your first covered load:</p>' else 'created. You can post once your broker authority clears. Three steps to your first covered load:</p>' end$b$;
  a3 text := $a$1️⃣ Screen your MC — we read your broker authority live from FMCSA (seconds, nothing to upload) and you accept one master agreement<br>$a$;
  b3 text := $b$1️⃣ We check your MC with FMCSA — most clear in seconds, nothing to upload. If FMCSA''s record does not clearly show active broker authority, our team checks it by hand and emails you. Then you accept one master agreement<br>$b$;
begin
  select pg_get_functiondef('app_private.trg_partner_org_welcome()'::regprocedure) into d;
  if position('next, we check your broker authority' in d) > 0 then return; end if;   -- already applied
  if position(a1 in d) = 0 then raise exception 'bl_comm_0513: subject anchor not found'; end if;
  if position(a2 in d) = 0 then raise exception 'bl_comm_0513: opening anchor not found'; end if;
  if position(a3 in d) = 0 then raise exception 'bl_comm_0513: step-1 anchor not found'; end if;
  execute replace(replace(replace(d, a1, b1), a2, b2), a3, b3);
end $$;
