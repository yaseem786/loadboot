-- bl_disp_0363 — the carrier portal's dispatcher card shows the dispatcher's OWN LoadBoot line + LoadBoot mailbox
-- (same source as the assignment e-mail: app_private.disp_official_contacts, bl_disp_0361). Either may be null → the
-- card keeps showing the shared dispatch@ contact. Patch = one anchor insert into carrier_my_dispatcher; idempotent.
do $$
declare v_def text; v_anchor text := '''country'', dp.country,';
begin
  v_def := pg_get_functiondef('public.carrier_my_dispatcher'::regproc);
  if position('disp_official_contacts' in v_def) > 0 then return; end if;
  if position(v_anchor in v_def) = 0 then raise exception 'bl_disp_0363: anchor not found in carrier_my_dispatcher'; end if;
  execute replace(v_def, v_anchor, v_anchor || ' ''official'', app_private.disp_official_contacts(dp.user_id),');
end $$;
