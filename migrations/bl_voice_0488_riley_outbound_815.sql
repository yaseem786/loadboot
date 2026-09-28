-- bl_voice_0488 — One main line: Riley calls OUT from +1 (815) 365-1168 (TASKS-RILEY-CALLS-0486, Builds #1).
--
-- Why: since bl_comm_0464 every surface shows ONE number, 815 (Telnyx; calls forward to Riley, WhatsApp on the same
-- number). Riley's outbound calls still showed the old Retell line 469-253-7575 as caller id, so a carrier who calls
-- back / saves the number gets the line we no longer publish.
--
-- How (owner side, outside SQL): 815 stays on its Telnyx Call Control app for INBOUND (dialer_hook_event → dispatcher
-- or Riley, unchanged). A separate Telnyx SIP connection (credentials, outbound only) lets Retell terminate calls
-- through Telnyx, and 815 is imported into Retell (Phone numbers → Import) with that termination URI + credentials.
-- Only after that is the number typed into CC → Riley → Settings; the CC card checks Retell has it before trusting it.
--
-- What changes here:
--   * retell_config.outbound_from_number (nullable). NULL = old behaviour (from_number = 469 for everything).
--   * app_private.retell_out_from() = coalesce(outbound_from_number, from_number) — the one place that decides.
--   * retell_dial / retell_dial_verify dial from it and write the number actually used onto the lc_calls row.
--   * retell_webhook accepts calls on EITHER number (469 inbound/legacy + 815 outbound); anything else stays ignored.
--   * cc_riley_settings_get/_set + retell_admin_config expose / set it (staff only; E.164 +1 only; never the
--     escalation number). Test call = the existing cc_retell_callback from CC, so no new public function.
--
-- Patched by ANCHOR on the live definitions (same as bl_wa_0487); each anchor is asserted.
-- anon SECDEF surface: unchanged (no new public function; retell_out_from is app_private and revoked).
-- STAGING FIRST, then prod. Idempotent (re-running finds the anchors already replaced → it checks for the new text).

begin;

alter table app_private.retell_config add column if not exists outbound_from_number text;
alter table app_private.retell_config drop constraint if exists retell_config_outbound_from_e164;
alter table app_private.retell_config add constraint retell_config_outbound_from_e164
  check (outbound_from_number is null or outbound_from_number ~ '^\+1[0-9]{10}$');
comment on column app_private.retell_config.outbound_from_number is
  'bl_voice_0488: caller id Riley dials FROM (imported into Retell via Telnyx SIP, outbound only). NULL = use from_number. Set in CC → Riley → Settings.';

create or replace function app_private.retell_out_from() returns text
language sql stable security definer set search_path = app_private, public, pg_temp as $$
  select coalesce(nullif(outbound_from_number, ''), from_number) from app_private.retell_config where id = 1
$$;
revoke all on function app_private.retell_out_from() from public, anon, authenticated;

do $mig$
declare d text; n text;
begin
  -- 1. retell_dial: dial from the outbound number, record it
  d := pg_get_functiondef('app_private.retell_dial(bigint)'::regprocedure);
  if position('retell_out_from()' in d) = 0 then
    n := replace(d, '''from_number'', cfg.from_number,', '''from_number'', app_private.retell_out_from(),   -- bl_voice_0488');
    n := replace(n, 'update app_private.lc_calls set status = ''dialing'', updated_at = now() where id = p_id;',
                    'update app_private.lc_calls set status = ''dialing'', from_number = app_private.retell_out_from(), updated_at = now() where id = p_id;');
    if n = d or position('from_number = app_private.retell_out_from()' in n) = 0 then raise exception 'bl_voice_0488: retell_dial anchor not found'; end if;
    execute n;
  end if;

  -- 2. retell_dial_verify (voice OTP calls) — same
  d := pg_get_functiondef('app_private.retell_dial_verify(bigint, jsonb)'::regprocedure);
  if position('retell_out_from()' in d) = 0 then
    n := replace(d, 'body := jsonb_build_object(''from_number'', cfg.from_number,', 'body := jsonb_build_object(''from_number'', app_private.retell_out_from(),');
    n := replace(n, 'update app_private.lc_calls set status = ''dialing'', updated_at = now() where id = p_call;',
                    'update app_private.lc_calls set status = ''dialing'', from_number = app_private.retell_out_from(), updated_at = now() where id = p_call;');
    if n = d or position('from_number = app_private.retell_out_from()' in n) = 0 then raise exception 'bl_voice_0488: retell_dial_verify anchor not found'; end if;
    execute n;
  end if;

  -- 3. retell_webhook: accept both numbers
  d := pg_get_functiondef('public.retell_webhook(jsonb)'::regprocedure);
  if position('bl_voice_0488' in d) = 0 then
    n := replace(d, 'or (call->>''from_number'' is distinct from cfg.from_number and call->>''to_number'' is distinct from cfg.from_number)',
                    'or not coalesce(call->>''from_number'' in (cfg.from_number, cfg.outbound_from_number) or call->>''to_number'' in (cfg.from_number, cfg.outbound_from_number), false)   -- bl_voice_0488: 469 + 815 (coalesce: a NULL outbound must not open the gate)');
    n := replace(n, 'case when call->>''from_number'' = cfg.from_number then ''outbound'' else ''inbound'' end',
                    'case when call->>''from_number'' in (cfg.from_number, cfg.outbound_from_number) then ''outbound'' else ''inbound'' end');
    if n = d or position('call->>''from_number'' in (cfg.from_number, cfg.outbound_from_number) then' in n) = 0 then raise exception 'bl_voice_0488: retell_webhook anchor not found'; end if;
    execute n;
  end if;

  -- 4. retell_admin_config (service_role only; read by the retell-admin edge function)
  d := pg_get_functiondef('public.retell_admin_config()'::regprocedure);
  if position('outbound_from_number' in d) = 0 then
    n := replace(d, '''from_number'', c.from_number,', '''from_number'', c.from_number, ''outbound_from_number'', c.outbound_from_number,');
    if n = d then raise exception 'bl_voice_0488: retell_admin_config anchor not found'; end if;
    execute n;
  end if;

  -- 5. cc_riley_settings_get: show both numbers
  d := pg_get_functiondef('public.cc_riley_settings_get()'::regprocedure);
  if position('outbound_from_number' in d) = 0 then
    n := replace(d, '''riley_number_set'', nullif(r.from_number,'''') is not null,',
                    '''riley_number_set'', nullif(r.from_number,'''') is not null,
      ''riley_number'', r.from_number, ''outbound_from_number'', r.outbound_from_number,
      ''outbound_from_effective'', coalesce(nullif(r.outbound_from_number,''''), r.from_number),');
    if n = d then raise exception 'bl_voice_0488: cc_riley_settings_get anchor not found'; end if;
    execute n;
  end if;

  -- 6. cc_riley_settings_set: set / clear it
  d := pg_get_functiondef('public.cc_riley_settings_set(jsonb)'::regprocedure);
  if position('outbound_from_number' in d) = 0 then
    n := replace(d, '  -- bl_voice_0484: balance typed from the Retell dashboard. Empty string clears it.',
'  -- bl_voice_0488: Riley''s outbound caller id. Empty clears it (back to the Riley number).
  if p ? ''outbound_from_number'' then
    v_esc := nullif(app_private.dial_e164(p->>''outbound_from_number''), '''');
    if nullif(trim(p->>''outbound_from_number''), '''') is not null and coalesce(v_esc, '''') !~ ''^\+1[0-9]{10}$'' then
      return jsonb_build_object(''error'',''a US number is required, e.g. +18153651168'');
    end if;
    if v_esc is not null and v_esc = (select escalation_number from app_private.retell_config where id = 1) then
      return jsonb_build_object(''error'',''the outbound number cannot be the escalation number'');
    end if;
    update app_private.retell_config set outbound_from_number = v_esc where id = 1;
  end if;
  -- bl_voice_0484: balance typed from the Retell dashboard. Empty string clears it.');
    if n = d then raise exception 'bl_voice_0488: cc_riley_settings_set anchor not found'; end if;
    execute n;
  end if;
end $mig$;

commit;

-- Checks (run after):
--   select app_private.retell_out_from();                                   -- 469 until the owner sets 815
--   select public.cc_riley_settings_get()->>'outbound_from_effective';      -- as staff
--   anon SECDEF names = docs/audit-2026-09/anon-secdef-baseline.md (36 prod / 35 staging)
