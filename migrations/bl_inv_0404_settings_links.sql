-- bl_inv_0404 — investor settings: allow a 'links' key (public places LoadBoot lives:
-- Facebook page, Capterra listing, … — set in CC, shown in the investor portal) and
-- return it from inv_settings(). Additive only.
create or replace function public.cc_inv_settings_set(p_key text, p_value jsonb)
returns jsonb language plpgsql volatile security definer
set search_path to 'app_private, public' as $$
begin
  if not app_private.inv_can_manage() then raise exception 'not authorized' using errcode='42501'; end if;
  if p_key not in ('payment_instructions','fx','forecast','vendors','links') then
    raise exception 'unknown setting' using errcode='22023'; end if;
  insert into app_private.inv_settings (key, value, updated_by) values (p_key, coalesce(p_value,'{}'::jsonb), auth.uid())
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = auth.uid();
  perform app_private.log_audit('investor.setting_saved','investor', p_key, null, 'Investor setting saved', p_value);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.inv_settings()
returns jsonb language plpgsql stable security definer
set search_path to 'app_private, public' as $$
begin
  if app_private.inv_my_investor() is null and not app_private.inv_is_staff() then
    raise exception 'not authorized' using errcode='42501'; end if;
  return jsonb_build_object(
    'payment_instructions', (select value from app_private.inv_settings where key = 'payment_instructions'),
    'fx',       (select value from app_private.inv_settings where key = 'fx'),
    'forecast', (select value from app_private.inv_settings where key = 'forecast'),
    'links',    (select value from app_private.inv_settings where key = 'links'));
end $$;
