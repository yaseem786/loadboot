-- bl_voice_0596 — Riley follow-up: stop mailing wrong addresses, and queue every promise (owner, 3 Nov 2026)
-- Audit: the auto follow-up ran on 2 of 8 real calls in 5 days and both went to wrong addresses.
-- Root causes, from the transcripts:
--   * lc_extract_email treated a spelled letter "I" as the stop word "I", and walked back at most 14 tokens. "K H O U N E A B I at
--     gmail" produced nothing, so it fell back to the FIRST written address (the caller's typo: call 540). "M I T C H E L L F R E I
--     G H T G R O U P" produced "ghtgroup" (call 500).
--   * Call 526: the caller really said the wrong domain and Riley confirmed it. No parser can catch that, only the account record.
--   * riley_needs_human_callback ignored a promise unless Retell also set needs_human (call 553).
-- Now:
--   * lc_extract_email fixed (letter I, 40 tokens, last written address, never our own address).
--   * lc_followup_email_gate: no send if Riley's last read-back differs, or the address is a near typo of an existing profile.
--     The call is flagged (analysis.followup_hold) and put in CC → Riley → Open callbacks. No suppression is written (CLAUDE.md 6.5).
--   * riley_promised_followup: an agent line like "I'll have the team email you" queues the callback even if needs_human is false.
-- Security: no new public function; anon surface unchanged. lc_call_followup exists on prod only, so that patch is conditional.

create extension if not exists fuzzystrmatch schema extensions;

create or replace function app_private.lc_followup_email_gate(p_email text, p_transcript text) returns jsonb
language plpgsql stable security definer set search_path to 'app_private','public' as $$
declare v_em text := lower(btrim(coalesce(p_email,''))); v_rb text; v_near text; v_loc text; v_dom text;
begin
  if v_em = '' then return jsonb_build_object('ok', false, 'reason', 'no_email', 'email', v_em); end if;
  v_rb := app_private.lc_extract_email(p_transcript);
  if v_rb is not null and v_rb <> v_em then
    return jsonb_build_object('ok', false, 'reason', 'readback_differs', 'email', v_em, 'suggest', v_rb);
  end if;
  v_loc := split_part(v_em,'@',1); v_dom := split_part(v_em,'@',2);
  select lower(p.email) into v_near from public.profiles p
   where coalesce(p.email,'') <> '' and lower(p.email) <> v_em
     and ((length(v_em) >= 8 and abs(length(p.email) - length(v_em)) <= 2 and extensions.levenshtein(lower(p.email), v_em) <= 2)
       or (lower(split_part(p.email,'@',2)) = v_dom and length(split_part(p.email,'@',1)) >= 8 and position(lower(split_part(p.email,'@',1)) in v_loc) > 0))
   order by extensions.levenshtein(lower(p.email), v_em) limit 1;
  if v_near is not null then return jsonb_build_object('ok', false, 'reason', 'near_existing_account', 'email', v_em, 'suggest', v_near); end if;
  return jsonb_build_object('ok', true, 'email', v_em);
end $$;

create or replace function app_private.riley_followup_hold(p_call text, p_gate jsonb) returns void
language plpgsql security definer set search_path to 'app_private','public' as $$
declare rec app_private.lc_calls; v_phone text; v_d10 text; v_name text; v_note text;
begin
  select * into rec from app_private.lc_calls where call_id = p_call;
  if not found then return; end if;
  v_note := left('Auto follow-up NOT sent: saved address ' || coalesce(p_gate->>'email','?')
    || case p_gate->>'reason' when 'readback_differs' then ' differs from what Riley last read back (' || coalesce(p_gate->>'suggest','?') || ').'
                              when 'near_existing_account' then ' looks like a typo of an existing account (' || coalesce(p_gate->>'suggest','?') || ').'
                              else ' could not be checked.' end
    || ' Check the call, then email them by hand.', 500);
  update app_private.lc_calls set analysis = coalesce(analysis,'{}'::jsonb) || jsonb_build_object('followup_hold', p_gate || jsonb_build_object('at', now())) where call_id = p_call;
  v_phone := case when rec.direction = 'inbound' then rec.from_number else rec.to_number end;
  v_d10 := right(regexp_replace(coalesce(v_phone,''), '[^0-9]', '', 'g'), 10);
  v_name := coalesce(nullif(rec.contact_name,''), nullif(rec.analysis->>'caller_name',''), nullif(rec.analysis->>'company_name',''));
  if length(v_d10) = 10 then
    insert into app_private.dialer_callbacks (dispatcher_user_id, call_id, number, contact_name, reason, due_at, note, lc_call_id)
    values (null, null, '+1' || v_d10, v_name, 'riley', now(), v_note, p_call)
    on conflict (lc_call_id) where lc_call_id is not null do update set note = left(coalesce(dialer_callbacks.note,'') || E'\n' || excluded.note, 1000);
  end if;
  begin
    insert into app_private.notifications (recipient_role, recipient_user, channel, template_key, payload, status, sent_at)
    values ('staff', null, 'in_app', 'voice.riley_callback',
      jsonb_build_object('title', '✉️ Riley follow-up held for ' || coalesce(v_name, '+1' || v_d10), 'body', v_note, 'tone', 'warning', 'url', '/command-center/#/riley'), 'sent', now());
  exception when others then null; end;
end $$;

create or replace function app_private.riley_promised_followup(p_transcript text) returns boolean
language sql immutable as $$
  select coalesce(p_transcript,'') ~* '(^|\n)\s*agent:[^\n]*(i''ll|i will|we''ll|we will|team will|have the team|someone will|team to)[^.\n]{0,60}\m(email|send|sends)\M'
$$;

revoke execute on function app_private.lc_followup_email_gate(text,text) from public, anon, authenticated;
revoke execute on function app_private.riley_followup_hold(text,jsonb) from public, anon, authenticated;
revoke execute on function app_private.riley_promised_followup(text) from public, anon, authenticated;

do $mig$
declare r record; d text;
begin
  for r in select * from (values
    ('app_private.lc_extract_email(text)', true,
     $a$while k >= 1 and i - k <= 14 loop$a$,
     $b$while k >= 1 and i - k <= 40 loop$b$),
    ('app_private.lc_extract_email(text)', true,
     $a$exit when tok = '' or tok = any(stop) or w[k] ~ '[,?!]$';$a$,
     $b$exit when tok = '' or w[k] ~ '[,?!]$' or (tok = any(stop) and not (tok = 'i' and (length(regexp_replace(coalesce(w[k - 1],''), '[^a-z0-9]', '', 'g')) = 1 or (k + 1 < i and length(regexp_replace(coalesce(w[k + 1],''), '[^a-z0-9]', '', 'g')) = 1))));$b$),
    ('app_private.lc_extract_email(text)', true,
     $a$select lower(m[1]) into best from regexp_matches(p_transcript,$a$,
     $b$select lower(m.x[1]) into best from regexp_matches(p_transcript,$b$),
    ('app_private.lc_extract_email(text)', true,
     $a$'g') as m;$a$,
     $b$'g') with ordinality as m(x, o) where lower(m.x[1]) !~ '@loadboot\.com$' order by m.o desc limit 1;$b$),
    ('app_private.riley_needs_human_callback(text)', true,
     $a$if lower(coalesce(rec.analysis->>'needs_human','')) <> 'true' then return null; end if;$a$,
     $b$if lower(coalesce(rec.analysis->>'needs_human','')) <> 'true' and not app_private.riley_promised_followup(rec.transcript) then return null; end if;   -- bl_voice_0596$b$),
    ('app_private.lc_call_followup(integer)', false,
     $a$declare r record;$a$,
     $b$declare v_gate jsonb; r record;$b$),
    ('app_private.lc_call_followup(integer)', false,
     $a$select c.id, c.created_at, c.from_number,$a$,
     $b$select c.id, c.call_id, c.transcript, c.created_at, c.from_number,$b$),
    ('app_private.lc_call_followup(integer)', false,
     $a$and c.created_at > now() - interval '3 days'$a$,
     $b$and not (coalesce(c.analysis,'{}'::jsonb) ? 'followup_hold')
       and c.created_at > now() - interval '3 days'$b$),
    ('app_private.lc_call_followup(integer)', false,
     $a$    v_first := coalesce(nullif(split_part(btrim(r.name), ' ', 1), ''), 'there');$a$,
     $b$    v_gate := app_private.lc_followup_email_gate(r.email, r.transcript);   -- bl_voice_0596: never mail a doubtful address, flag it for staff
    if not coalesce((v_gate->>'ok')::boolean, false) then perform app_private.riley_followup_hold(r.call_id, v_gate); continue; end if;
    v_first := coalesce(nullif(split_part(btrim(r.name), ' ', 1), ''), 'there');$b$)
  ) as x(fn, required, anchor, repl) loop
    if to_regprocedure(r.fn) is null then
      if r.required then raise exception 'bl_voice_0596: % is missing', r.fn; end if;
      continue;
    end if;
    d := pg_get_functiondef(r.fn::regprocedure);
    if position(r.anchor in d) = 0 then raise exception 'bl_voice_0596: anchor not found in %: %', r.fn, left(r.anchor, 70); end if;
    execute replace(d, r.anchor, r.repl);
  end loop;
end $mig$;
