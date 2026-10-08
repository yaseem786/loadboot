-- bl_dial_0514 — call recording transcripts (Telnyx speech-to-text), shown in CC → Dialer calls.
-- Written only by the telnyx-transcribe edge function (service_role); read by CC staff or the call's own dispatcher.
create table if not exists app_private.dialer_call_transcripts (
  call_id uuid primary key references app_private.dialer_calls(id) on delete cascade,
  model text,
  language text,
  text text,
  segments jsonb,
  raw jsonb,
  requested_by uuid,
  created_at timestamptz not null default now()
);
revoke all on app_private.dialer_call_transcripts from public, anon, authenticated;

create or replace function public.dialer_transcript_get(p_call uuid)
returns jsonb language plpgsql security definer set search_path = public, app_private as $$
declare c app_private.dialer_calls; t app_private.dialer_call_transcripts;
begin
  if auth.uid() is null then return jsonb_build_object('error','not signed in'); end if;
  select * into c from app_private.dialer_calls where id = p_call;
  if not found then return jsonb_build_object('error','not found'); end if;
  if c.dispatcher_user_id <> auth.uid() and not app_private.disp_is_staff() then return jsonb_build_object('error','not authorized'); end if;
  select * into t from app_private.dialer_call_transcripts where call_id = p_call;
  if not found then return jsonb_build_object('ok', true, 'exists', false); end if;
  return jsonb_build_object('ok', true, 'exists', true, 'model', t.model, 'language', t.language, 'text', t.text, 'segments', t.segments, 'created_at', t.created_at, 'error', t.raw->>'error');
end $$;
revoke all on function public.dialer_transcript_get(uuid) from public, anon;
grant execute on function public.dialer_transcript_get(uuid) to authenticated;

create or replace function public.dialer_transcript_save(p_call uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = public, app_private as $$
begin
  insert into app_private.dialer_call_transcripts(call_id, model, language, text, segments, raw, requested_by)
  values (p_call, p->>'model', p->>'language', p->>'text', p->'segments', p->'raw', nullif(p->>'requested_by','')::uuid)
  on conflict (call_id) do update set model = excluded.model, language = excluded.language, text = excluded.text,
    segments = excluded.segments, raw = excluded.raw, requested_by = excluded.requested_by, created_at = now();
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.dialer_transcript_save(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.dialer_transcript_save(uuid, jsonb) to service_role;
