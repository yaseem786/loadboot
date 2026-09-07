-- bl_sec_0329b_retell_hook_verify.sql — audit F14. The signature verifier for the retell-hook edge function.
-- The Retell API key NEVER leaves the database: the edge function sends the raw body + the header value and gets
-- back a verdict. Retell signs HMAC-SHA256(raw_body || timestamp, api_key) and sends
--   X-Retell-Signature: v=<unix_ms>,d=<hex digest>
-- A delivery outside the skew window is refused so a captured signature cannot be replayed for ever.
-- If api_key is not configured the answer is verified=null with reason 'api_key_not_configured' — UNKNOWN, said
-- out loud, rather than a silent failure of every delivery.
-- STAGING RESULT 2026-09-06: tests/bl_sec_0329b_verify_test.sql → RESULT PASS (4 cases). PROD: not applied.
create or replace function public.retell_hook_verify(p_raw text, p_sig text, p_skew_seconds int default 900)
returns jsonb
language plpgsql
security definer
set search_path to 'app_private, public, extensions'
as $$
declare v_key text; v_enforce boolean; v_ts text; v_d text; v_calc text; v_age numeric; ok boolean;
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role','') <> 'service_role'
     and current_user not in ('postgres','service_role') then
    return jsonb_build_object('ok', false, 'error','forbidden','code','LB403');
  end if;

  select api_key, not coalesce(allow_unsigned_webhook, true) into v_key, v_enforce
    from app_private.retell_config where id = 1;
  if v_key is null or length(v_key) = 0 then
    return jsonb_build_object('ok', false, 'verified', null, 'enforce', v_enforce, 'reason','api_key_not_configured');
  end if;

  v_ts := substring(coalesce(p_sig,'') from 'v=([0-9]+)');
  v_d  := lower(coalesce(substring(coalesce(p_sig,'') from 'd=([0-9a-fA-F]+)'), ''));
  if v_ts is null or v_d = '' then
    return jsonb_build_object('ok', true, 'verified', false, 'enforce', v_enforce, 'reason','signature_header_unparsable');
  end if;

  v_age := abs(extract(epoch from now()) - (v_ts::numeric / 1000));
  v_calc := encode(extensions.hmac(convert_to(coalesce(p_raw,'') || v_ts, 'utf8'), convert_to(v_key,'utf8'), 'sha256'), 'hex');
  ok := (length(v_calc) = length(v_d)) and (v_calc = v_d);
  if ok and v_age > p_skew_seconds then
    return jsonb_build_object('ok', true, 'verified', false, 'enforce', v_enforce, 'reason','timestamp_outside_skew', 'age_seconds', round(v_age));
  end if;
  return jsonb_build_object('ok', true, 'verified', ok, 'enforce', v_enforce,
                            'reason', case when ok then 'signature_ok' else 'digest_mismatch' end);
end $$;
revoke all on function public.retell_hook_verify(text, text, int) from public, anon, authenticated;
grant execute on function public.retell_hook_verify(text, text, int) to service_role;
