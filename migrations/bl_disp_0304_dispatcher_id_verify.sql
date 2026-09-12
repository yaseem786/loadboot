-- bl_disp_0304 — identity verification AFTER the application is submitted.
--
-- Yaseen 06 Sep 2026: the ID upload on the application form is optional and most candidates skip it
-- (Yusuf Madadov, US applicant, did). Once the profile leaves status 'applied' the whole form
-- disappears from the portal, so there was no way for a candidate to supply the ID later — staff had
-- to take it over WhatsApp, off-record. LoadBoot needs the country + identity on file so a candidate
-- who fails the skills test cannot simply re-apply from a fresh account.
--
-- dispatcher_apply() could not be used for this: it does `skills = coalesce(excluded.skills, ...)`,
-- so a partial call from the client would overwrite the whole skills object (and load_boards/refs).
-- This RPC merges server-side and touches nothing else. Additive; staging first, then prod.

create or replace function public.dispatcher_submit_id(p_path text, p_name text default null)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); v_name text;
begin
  if v_uid is null then return jsonb_build_object('error','not signed in'); end if;
  if coalesce(trim(p_path),'') = '' then return jsonb_build_object('error','no document'); end if;

  update app_private.dispatcher_profiles d
     set skills = coalesce(d.skills, '{}'::jsonb) || jsonb_build_object(
           'id_doc', p_path,
           'id_name', coalesce(nullif(trim(p_name),''), 'identity document'),
           'id_uploaded_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')),
         updated_at = now()
   where d.user_id = v_uid
   returning d.full_name into v_name;

  if not found then return jsonb_build_object('error','no dispatcher application found'); end if;

  begin
    insert into app_private.notifications(recipient_role, channel, template_key, payload, status, sent_at)
    values ('staff','in_app','dispatcher.id_uploaded',
      jsonb_build_object('user', v_uid, 'title', '🪪 Dispatcher ID uploaded',
        'body', coalesce(v_name,'A candidate') || ' uploaded an identity document. Open Dispatchers to verify country and identity.',
        'tone','info','url','/app/command-center/#/dispatchers?user=' || v_uid::text),
      'sent', now());
  exception when others then null; end;

  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.dispatcher_submit_id(text, text) to authenticated;
