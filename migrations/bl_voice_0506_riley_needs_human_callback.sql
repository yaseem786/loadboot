-- bl_voice_0506 — Riley promises a follow-up → a real callback exists (30 Sep 2026)
--
-- Owner decision (30 Sep): Riley handles as much as she can herself; when SHE says a person must follow up,
-- a callback task is created. Until now the inbound prompt told callers "I've made a note, our team follows up
-- within the hour" and Retell's post-call analysis set needs_human = true, but the database only filed a task
-- for interest_level = 'hot'. Everything else was a promise nobody saw.
--
-- What this does
--  * dialer_callbacks gets reason 'riley' and a column lc_call_id (one callback per Riley call, idempotent —
--    Retell can send call_ended + call_analyzed, and replays).
--  * app_private.riley_needs_human_callback(call_id): needs_human = true, not a voicemail, not a verify-code
--    call, a usable phone → one open callback, due now.
--      - caller's carrier has a RELEASED dedicated dispatcher → the callback is theirs (dock → Callbacks) and
--        they get an in-app alert;
--      - everyone else → dispatcher NULL = CC → Riley → "Open callbacks from the line", staff in-app alert.
--    note = Riley's next_step (else the summary), so whoever calls back knows why.
--  * retell_webhook calls it on call_ended / call_analyzed (anchor patch, never breaks the webhook).
--  * cc_riley_calls returns contact_name + note on wa_callbacks so the Riley screen can show them.
-- No public function added; anon SECDEF surface unchanged.

begin;

alter table app_private.dialer_callbacks add column if not exists lc_call_id text;
create unique index if not exists dialer_callbacks_lc_call_uq on app_private.dialer_callbacks (lc_call_id) where lc_call_id is not null;
comment on column app_private.dialer_callbacks.lc_call_id is 'bl_voice_0506: Retell call id (lc_calls.call_id) when Riley asked for a human follow-up; one callback per call.';

alter table app_private.dialer_callbacks drop constraint if exists dialer_callbacks_reason_check;
alter table app_private.dialer_callbacks add constraint dialer_callbacks_reason_check
  check (reason = any (array['missed','voicemail','scheduled','forwarded','riley']));

create or replace function app_private.riley_needs_human_callback(p_call text) returns uuid
language plpgsql security definer set search_path = app_private, public as $fn$
declare
  rec  app_private.lc_calls;
  v_phone text; v_d10 text; v_disp uuid; v_name text; v_note text; v_id uuid;
begin
  select * into rec from app_private.lc_calls where call_id = p_call;
  if not found then return null; end if;
  if coalesce(rec.source,'') = 'verify' then return null; end if;
  if lower(coalesce(rec.analysis->>'needs_human','')) <> 'true' then return null; end if;
  if lower(coalesce(rec.analysis->>'in_voicemail','')) = 'true'
     or coalesce(rec.analysis->>'disconnection_reason','') in ('voicemail_reached','machine_detected') then return null; end if;

  v_phone := case when rec.direction = 'inbound' then rec.from_number else rec.to_number end;
  v_d10 := right(regexp_replace(coalesce(v_phone,''), '[^0-9]', '', 'g'), 10);
  if length(v_d10) <> 10 then return null; end if;

  select d.dispatcher_user_id into v_disp from app_private.riley_caller_dispatcher(v_phone) d where d.released limit 1;

  v_name := coalesce(nullif(rec.contact_name,''), nullif(rec.analysis->>'caller_name',''), nullif(rec.analysis->>'company_name',''));
  v_note := left('Riley: ' || coalesce(nullif(rec.analysis->>'next_step',''), nullif(rec.summary,''), 'caller asked for a person'), 500);

  insert into app_private.dialer_callbacks (dispatcher_user_id, call_id, number, contact_name, reason, due_at, note, lc_call_id)
  values (v_disp, null, '+1' || v_d10, v_name, 'riley', now(), v_note, p_call)
  on conflict (lc_call_id) where lc_call_id is not null do nothing
  returning id into v_id;
  if v_id is null then return null; end if;   -- already filed for this call

  begin
    insert into app_private.notifications (recipient_role, recipient_user, channel, template_key, payload, status, sent_at)
    values (case when v_disp is null then 'staff' end, v_disp, 'in_app', 'voice.riley_callback',
      jsonb_build_object(
        'title', '📞 Call back ' || coalesce(v_name, '+1' || v_d10) || ' — Riley promised a follow-up',
        'body', v_note,
        'tone', 'warning',
        'url', case when v_disp is null then '/command-center/#/riley' else '/app/agent/#today' end),
      'sent', now());
  exception when others then null; end;

  return v_id;
end $fn$;
revoke execute on function app_private.riley_needs_human_callback(text) from public, anon, authenticated;
comment on function app_private.riley_needs_human_callback(text) is 'bl_voice_0506: Riley call with needs_human=true → one open dialer_callbacks row (reason riley): released dispatcher if the caller has one, else the Riley screen.';

-- retell_webhook: file the callback after the lead / plan steps (anchor patch; never breaks the webhook)
do $mig$
declare d text; n text;
begin
  d := pg_get_functiondef('public.retell_webhook(jsonb)'::regprocedure);
  if position('bl_voice_0506' in d) = 0 then
    n := replace(d, $a$  -- bl_voice_0485: a booked call plan learns what happened and asks for the next step$a$,
$a$  -- bl_voice_0506: Riley said a person follows up (needs_human) → one callback per call
  if event in ('call_ended','call_analyzed') then
    begin perform app_private.riley_needs_human_callback(v_id); exception when others then raise warning 'riley_needs_human_callback: %', sqlerrm; end;
  end if;

  -- bl_voice_0485: a booked call plan learns what happened and asks for the next step$a$);
    if n = d then raise exception 'bl_voice_0506: retell_webhook anchor not found'; end if;
    execute n;
  end if;
end $mig$;

-- cc_riley_calls: the Riley screen shows who and why
do $mig$
declare d text; n text;
begin
  d := pg_get_functiondef('public.cc_riley_calls(integer)'::regprocedure);
  if position('''note'', k.note' in d) = 0 then
    n := replace(d, $a$'created_at', k.created_at, 'call_id', k.call_id)$a$,
                    $a$'created_at', k.created_at, 'call_id', k.call_id, 'contact_name', k.contact_name, 'note', k.note)$a$);
    if n = d then raise exception 'bl_voice_0506: cc_riley_calls anchor not found'; end if;
    execute n;
  end if;
end $mig$;

commit;
