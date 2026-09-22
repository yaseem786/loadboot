-- bl_comm_0391a: email_catalog_sync() could not notify staff about new keys.
--
-- 0391 called app_private.emit_notification() with named arguments but left out
-- p_recipient_user, which has no default on either database. The call only runs when
-- sync finds a key that is not in the catalog, so it never fired on staging (the catalog
-- was already complete there) and would have failed on the first production run.
--
-- Staging's live function had been hand-patched to the positional form after 0391 was
-- recorded, so this migration accepts both shapes and leaves the call fully named.
-- Applied to production (22 Sep 2026) and to staging (recorded there as 0391a + 0391b).
-- Verified on staging with a throwaway comm_templates key: sync returned
-- {"ok":true,"new":["test.catalog_selftest"],...} and the throwaway rows were removed.
do $do$
declare src text;
begin
  select pg_get_functiondef(p.oid) into src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app_private' and p.proname = 'email_catalog_sync';

  if src is null then
    raise exception 'app_private.email_catalog_sync() not found - apply bl_comm_0391 first';
  end if;

  if position('p_payload := jsonb_build_object(''keys''' in src) > 0
     or position('p_recipient_user := null' in src) > 0 then
    raise notice 'bl_comm_0391a: already patched, nothing to do';
    return;
  end if;

  if position('p_recipient_role := ''staff'', p_channel := ''in_app'',' in src) > 0 then
    -- the shape 0391 shipped: named arguments, p_recipient_user missing
    src := replace(src,
      'p_recipient_role := ''staff'', p_channel := ''in_app'',',
      'p_recipient_role := ''staff'', p_recipient_user := null, p_channel := ''in_app'',');
  elsif position('emit_notification(''staff'', null, ''ops.email_catalog.new_keys'',' in src) > 0 then
    -- the hand-patched positional shape found on staging
    src := replace(src,
      'emit_notification(''staff'', null, ''ops.email_catalog.new_keys'',',
      'emit_notification(p_recipient_role := ''staff'', p_recipient_user := null,'
      || ' p_template_key := ''ops.email_catalog.new_keys'', p_channel := ''in_app'', p_payload :=');
    src := replace(src, 'catalog entry.''), ''in_app'');', 'catalog entry.''));');
  else
    raise exception 'bl_comm_0391a: anchor not found in email_catalog_sync() - inspect by hand';
  end if;

  execute src;
end $do$;

revoke all on function app_private.email_catalog_sync() from public, anon, authenticated;
