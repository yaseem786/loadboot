-- bl_camp_0326_cmp_save_empty_string_coercion.sql
-- Applied: staging 6 Sep 2026, production 6 Sep 2026.
--
-- Bug: the Campaign manager's New-campaign form could not be saved with the Schedule
-- field left blank. save() does `if (f.scheduledAt) ...` so '' survives, and cmpSave does
-- `?? null`, which only replaces null/undefined — so '' was sent. PostgREST then cast
-- ''::timestamptz and raised 22007 (invalid_datetime_format) BEFORE the function body ran,
-- surfacing in the UI as "Something went wrong. Please try again. (code 22007)".
-- The same shape breaks on an unselected Audience: ''::uuid -> 22P02.
--
-- Fix: p_audience and p_scheduled_at become text and are coerced with nullif(btrim(...),'')
-- inside the function, so the RPC tolerates an empty form field whatever the client sends.
-- Blank objective/template are normalized to NULL too rather than stored as ''.
-- Param types change, so this is a drop + recreate, not CREATE OR REPLACE.
--
-- NOTE: recreating a public function re-applies Supabase's default EXECUTE grant to anon.
-- The explicit revoke below is required; without it the prod anon-executable SECURITY
-- DEFINER count goes 32 -> 33. Verified back at 32 after applying.

drop function if exists public.cc_cmp_save(uuid, text, text, uuid, text, text[], text, text, timestamp with time zone, text);

create or replace function public.cc_cmp_save(p_id uuid, p_name text, p_objective text, p_audience text, p_template text, p_channels text[], p_subject text, p_body text, p_scheduled_at text, p_status text)
returns uuid
language plpgsql security definer
set search_path to 'app_private, public'
as $function$
declare v_id uuid; v_slug text; v_aud uuid; v_sched timestamptz;
begin
  if not (public.has_global_permission('campaigns.view') or public.has_global_permission('content.manage') or public.has_global_permission('settings.manage')) then
    raise exception 'not authorized' using errcode='42501'; end if;
  if p_name is null or btrim(p_name)='' then raise exception 'campaign name is required' using errcode='22023'; end if;
  if coalesce(p_status,'draft') not in ('draft','scheduled','sent','paused') then raise exception 'invalid status' using errcode='22023'; end if;

  v_aud   := nullif(btrim(coalesce(p_audience,'')), '')::uuid;
  v_sched := nullif(btrim(coalesce(p_scheduled_at,'')), '')::timestamptz;

  if p_id is null then
    v_id := gen_random_uuid();
    v_slug := btrim(regexp_replace(lower(p_name), '[^a-z0-9]+', '-', 'g'), '-');
    v_slug := left(coalesce(nullif(v_slug,''), 'campaign'), 48) || '-' || left(v_id::text, 8);
    insert into app_private.campaigns(id, name, utm_campaign, objective, audience_id, template_key, channels, subject, body, scheduled_at, status, created_by)
    values (v_id, p_name, v_slug, nullif(btrim(coalesce(p_objective,'')),''), v_aud, nullif(btrim(coalesce(p_template,'')),''),
            coalesce(p_channels,'{push}'), p_subject, p_body, v_sched, coalesce(p_status,'draft'), auth.uid())
    returning id into v_id;
  else
    update app_private.campaigns set name=p_name, objective=nullif(btrim(coalesce(p_objective,'')),''), audience_id=v_aud,
      template_key=nullif(btrim(coalesce(p_template,'')),''), channels=coalesce(p_channels,'{push}'),
      subject=p_subject, body=p_body, scheduled_at=v_sched, status=coalesce(p_status,'draft'), updated_at=now()
    where id=p_id returning id into v_id;
  end if;
  perform app_private.log_audit('campaign.save','campaign', v_id::text, null, coalesce(p_status,'draft'), jsonb_build_object('name',p_name));
  return v_id;
end; $function$;

revoke all on function public.cc_cmp_save(uuid, text, text, text, text, text[], text, text, text, text) from public;
revoke execute on function public.cc_cmp_save(uuid, text, text, text, text, text[], text, text, text, text) from anon;
grant execute on function public.cc_cmp_save(uuid, text, text, text, text, text[], text, text, text, text) to authenticated;
