-- bl_dial_0351c — "portal is closed" without forwarding: HOLD THE CALLER RINGING while the dispatcher gets a push,
-- opens LoadBoot, and the call is handed to their browser the moment their phone registers.
--   inbound + dispatcher offline + no forward_number  →  action 'wait' (35 s; the caller just hears ringing; push goes out)
--   dispatcher opens the portal → dialer registers → telnyx-token {claim:true} → dialer_claim_waiting() → transfer to their browser
--   nobody came within 35 s → dialer_wait_expired() → the normal fallback (Riley / voicemail + callback task)
-- A line WITH forward_number keeps the 0351b behaviour (mobile rings at once) — waiting and then forwarding would keep a
-- broker ringing for a minute. Patches 0351's hook in place (idempotent). STAGING first.

alter table app_private.dialer_calls add column if not exists claimed_at timestamptz;

do $$
declare s text;
begin
  s := pg_get_functiondef('public.dialer_hook_event(jsonb,boolean)'::regprocedure);
  if position('wait_call_id' in s) = 0 then
    if position($o$      else
        act := jsonb_build_object('type','fallback');$o$ in s) = 0 then raise exception 'bl_dial_0351c: expected text not found in hook/offline'; end if;
    s := replace(s, $o$      else
        act := jsonb_build_object('type','fallback');$o$, $n$      else
        act := case when nullif(ln.forward_number,'') is null
                    then jsonb_build_object('type','wait','wait_call_id', c.id, 'secs', 35)
                    else jsonb_build_object('type','fallback') end;$n$);
    execute s;
  end if;
end $$;

-- the dispatcher's phone just registered: is a caller still ringing for them? → hand the call to their browser
create or replace function public.dialer_claim_waiting(p_user uuid) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare c app_private.dialer_calls; ln app_private.dialer_lines;
begin
  select * into ln from app_private.dialer_lines where dispatcher_user_id = p_user and status = 'active';
  if ln.id is null or ln.sip_username is null then return jsonb_build_object('ok', true, 'action', null); end if;
  update app_private.dialer_lines set last_seen_at = now() where id = ln.id;
  update app_private.dialer_calls set claimed_at = now(), updated_at = now()
   where id = (select id from app_private.dialer_calls
                where dispatcher_user_id = p_user and direction = 'inbound' and status = 'ringing' and answered_at is null
                  and claimed_at is null and not forward_tried and telnyx_call_control_id is not null
                  and started_at > now() - interval '50 seconds'
                order by started_at desc limit 1 for update skip locked)
  returning * into c;
  if c.id is null then return jsonb_build_object('ok', true, 'action', null); end if;
  return jsonb_build_object('ok', true, 'call_id', c.id, 'action', jsonb_build_object('type','transfer','call_control_id', c.telnyx_call_control_id,
    'to', 'sip:' || ln.sip_username || '@sip.telnyx.com', 'from', c.counterparty, 'timeout_secs', 20,
    'client_state', encode(convert_to(c.id::text,'UTF8'),'base64'),
    'target_leg_client_state', encode(convert_to('b:' || c.id::text,'UTF8'),'base64')));
end $$;

-- the wait window ran out. If nobody claimed the call and it is still ringing → run the normal fallback.
create or replace function public.dialer_wait_expired(p_call uuid) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare c app_private.dialer_calls; r jsonb;
begin
  select * into c from app_private.dialer_calls where id = p_call;
  if c.id is null or c.status <> 'ringing' or c.answered_at is not null or c.claimed_at is not null then return null; end if;
  r := public.dialer_hook_event(jsonb_build_object('id', 'wait-' || p_call::text, 'event_type', 'call.hangup',
         'payload', jsonb_build_object('client_state', encode(convert_to('b:' || p_call::text,'UTF8'),'base64'), 'hangup_cause', 'wait_expired')), true);
  return r->'action';
end $$;

revoke all on function public.dialer_claim_waiting(uuid) from public, anon, authenticated;
revoke all on function public.dialer_wait_expired(uuid) from public, anon, authenticated;
grant execute on function public.dialer_claim_waiting(uuid) to service_role;
grant execute on function public.dialer_wait_expired(uuid) to service_role;
