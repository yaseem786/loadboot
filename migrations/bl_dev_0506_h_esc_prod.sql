-- bl_dev_0506 — app_private.h_esc() was missing on prod (30 Sep 2026).
-- bl_dev_0502c ("escape developer emails") calls app_private.h_esc(), which exists on staging but was never created on
-- prod. Tests ran on staging, so it passed there. On prod every call path hit
--   ERROR 42883: function app_private.h_esc(text) does not exist
-- which rolled back the whole staff action, not just the email:
--   app_private.dev_send_email   → cc_api360_revoke_key, cc_api360_set_status (approve / deny / suspend) all failed
--   public.dev_request_production → a developer could not ask for production access
-- Found when revoking two unused keys from API 360 on the owner's instruction; nothing had been revoked, approved or
-- requested before this (0 approved, 0 open requests), so no customer saw a failure.
-- Fix: create the function on prod with the staging body, byte for byte (prosrc md5 f05b0ded14913e713decbb0251cc03ac).
-- Security: app_private, not SECURITY DEFINER, no grant to anon/authenticated. Anon SECDEF surface in public unchanged.
-- Applied: prod 2026-09-30. Staging already has it (no-op there).

create or replace function app_private.h_esc(t text) returns text
language sql immutable set search_path = app_private, public, extensions, pg_temp as $$
  select replace(replace(replace(coalesce(t,''),'&','&amp;'),'<','&lt;'),'>','&gt;');
$$;

revoke execute on function app_private.h_esc(text) from public, anon, authenticated;
