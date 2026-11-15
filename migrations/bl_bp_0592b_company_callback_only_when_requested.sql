-- bl_bp_0592b — Verify identity records method 'company_callback' only when the broker actually used the company path
-- (bl_bp_0592 set it for every no-FMCSA-contact verify, e.g. TransPak verified by company domain on the owner's call).
do $$
declare d text; a text := $a$       and not coalesce(((app_private.broker_fmcsa_contact(p_org))->>'has_phone')::boolean, false);$a$;
begin
  d := pg_get_functiondef('public.cc_broker_trust_set(uuid,text,text)'::regprocedure);
  if position('bl_bp_0592b' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'bl_bp_0592b: anchor not unique'; end if;
  execute replace(d, a, $b$       and not coalesce(((app_private.broker_fmcsa_contact(p_org))->>'has_phone')::boolean, false)
       and company_requested_at is not null;   -- bl_bp_0592b$b$);
end $$;
