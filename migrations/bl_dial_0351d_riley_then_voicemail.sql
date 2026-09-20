-- bl_dial_0351d — full unanswered chain: dispatcher browser → (dispatcher mobile, if set) → Riley → VOICEMAIL.
-- Before: with a fallback number set, the call was handed to Riley and that was the end — if Riley did not pick up,
-- the caller got nothing. Now the Riley leg is tracked ('b:' client state + fallback_tried); if it ends unanswered the
-- hook runs the fallback again and, with every option used, takes a voicemail (greeting → beep → recording → callback task).
-- A Riley-answered call is marked 'forwarded' (not 'active'): it is not the dispatcher's live call and is not recorded by us.
-- Patches 0351's hook in place (idempotent). STAGING first.

alter table app_private.dialer_calls add column if not exists fallback_tried boolean not null default false;

do $$
declare s text;
begin
  s := pg_get_functiondef('public.dialer_hook_event(jsonb,boolean)'::regprocedure);
  if position('fallback_tried' in s) = 0 then
    -- 1) Riley leg answered → 'forwarded'
    if position($o$    elsif c.status in ('dialing','ringing') and (c.direction = 'outbound' or v_leg = 'b') then$o$ in s) = 0 then
      raise exception 'bl_dial_0351d: expected text not found in hook/answered'; end if;
    s := replace(s, $o$    elsif c.status in ('dialing','ringing') and (c.direction = 'outbound' or v_leg = 'b') then$o$,
$n$    elsif c.status = 'ringing' and v_leg = 'b' and c.fallback_tried then
      update app_private.dialer_calls set status = 'forwarded', updated_at = now() where id = c.id;
    elsif c.status in ('dialing','ringing') and (c.direction = 'outbound' or v_leg = 'b') then$n$);
    -- 2) Riley attempt: once, tracked, still 'ringing' until somebody answers
    if position($o$    elsif nullif(cfg.fallback_number,'') is not null then
      update app_private.dialer_calls set status = 'forwarded', updated_at = now() where id = c.id;
      act := jsonb_build_object('type','transfer','call_control_id', c.telnyx_call_control_id, 'to', cfg.fallback_number, 'from', c.counterparty,
               'timeout_secs', 30, 'client_state', encode(convert_to(c.id::text,'UTF8'),'base64'));$o$ in s) = 0 then
      raise exception 'bl_dial_0351d: expected text not found in hook/riley'; end if;
    s := replace(s, $o$    elsif nullif(cfg.fallback_number,'') is not null then
      update app_private.dialer_calls set status = 'forwarded', updated_at = now() where id = c.id;
      act := jsonb_build_object('type','transfer','call_control_id', c.telnyx_call_control_id, 'to', cfg.fallback_number, 'from', c.counterparty,
               'timeout_secs', 30, 'client_state', encode(convert_to(c.id::text,'UTF8'),'base64'));$o$,
$n$    elsif nullif(cfg.fallback_number,'') is not null and not c.fallback_tried then
      update app_private.dialer_calls set fallback_tried = true, updated_at = now() where id = c.id;
      act := jsonb_build_object('type','transfer','fwd', true, 'call_control_id', c.telnyx_call_control_id, 'to', cfg.fallback_number, 'from', c.counterparty,
               'timeout_secs', 20, 'client_state', encode(convert_to(c.id::text,'UTF8'),'base64'),
               'target_leg_client_state', encode(convert_to('b:' || c.id::text,'UTF8'),'base64'));$n$);
    execute s;
  end if;
end $$;
