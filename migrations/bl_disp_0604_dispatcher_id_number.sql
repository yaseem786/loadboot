-- bl_disp_0604 — dispatcher applications carry a government ID number, and it is the first identity key (15 Nov 2026)
--
-- Yaseen 15 Nov, on the limit left open by bl_disp_0602 ("naya Gmail aur naya number dono hon to nikal jayega"):
-- "ye bnao". A phone is whatever the applicant types; an ID number is much harder to change.
--   * app_private.dispatcher_identity (user_id, id_type, id_number, id_key). Separate table on purpose: several
--     functions hand to_jsonb(dispatcher_profiles) to the dispatcher, the carrier desk and view-only staff, and an
--     ID number must not ride along.
--   * dispatcher_apply: stores id_type / id_number from the form; a SUBMIT without an ID number on file is refused.
--   * disp_identity_matches: 'id' match first (letters+digits only, upper-cased), then phone, then e-mail. A match
--     is held exactly like bl_disp_0602 (dispatcher_dup_holds.via now allows 'id').
--   * cc_dispatcher_identity: returns the applicant's declared ID ('self') and each match's ID number (staff only).
-- Applications submitted before today have no ID number, so they can only be matched by phone / e-mail / name.
-- No e-mail, no new public function; anon surface unchanged.
-- Rollback: re-apply dispatcher_apply + disp_identity_matches + cc_dispatcher_identity from bl_disp_0602;
--           drop table app_private.dispatcher_identity; drop function app_private.disp_id_key(text).

create or replace function app_private.disp_id_key(p text)
returns text language sql immutable set search_path = app_private, public as $$
  select case when length(x.k) >= 5 then x.k end
    from (select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g')) k) x
$$;
revoke all on function app_private.disp_id_key(text) from public, anon, authenticated;

create table if not exists app_private.dispatcher_identity (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  id_type    text,
  id_number  text not null,
  id_key     text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists dispatcher_identity_key_idx on app_private.dispatcher_identity (id_key);
alter table app_private.dispatcher_identity enable row level security;
revoke all on app_private.dispatcher_identity from public, anon, authenticated;

alter table app_private.dispatcher_dup_holds drop constraint if exists dispatcher_dup_holds_via_check;
alter table app_private.dispatcher_dup_holds add constraint dispatcher_dup_holds_via_check check (via in ('id','phone','email'));

create or replace function app_private.disp_identity_matches(p_user uuid, p_phone text default null)
returns table (user_id uuid, via text)
language sql stable security definer set search_path = app_private, public as $$
  with me as (
    select app_private.disp_phone_key(coalesce(nullif(btrim(p_phone), ''),
             (select dp.phone from app_private.dispatcher_profiles dp where dp.user_id = p_user))) pk,
           app_private.disp_email_key((select u.email from auth.users u where u.id = p_user)) ek,
           (select i.id_key from app_private.dispatcher_identity i where i.user_id = p_user) ik)
  select d.user_id,
         case when i2.id_key = me.ik then 'id'
              when app_private.disp_phone_key(d.phone) = me.pk then 'phone' else 'email' end
    from app_private.dispatcher_profiles d
    left join auth.users u on u.id = d.user_id
    left join app_private.dispatcher_identity i2 on i2.user_id = d.user_id
   cross join me
   where d.user_id <> p_user
     and (i2.id_key = me.ik or app_private.disp_phone_key(d.phone) = me.pk or app_private.disp_email_key(u.email) = me.ek)
$$;
revoke all on function app_private.disp_identity_matches(uuid, text) from public, anon, authenticated;

do $$
declare d text; miss constant text := 'bl_disp_0604: anchor not found: ';
  a_app  constant text := '  -- bl_disp_0602: one person, one application.';
  a_hold constant text := '    ''hold'', (select jsonb_build_object(''dup_of''';
  a_m    constant text := '''phone'', d.phone, ''country'', d.country,';
begin
  d := pg_get_functiondef('public.dispatcher_apply(jsonb,boolean)'::regprocedure);
  if position(a_app in d) = 0 then raise exception '%dispatcher_apply', miss; end if;
  execute replace(d, a_app, $ins$  -- bl_disp_0604: the government ID number identifies the person; a submit needs one on file
  if app_private.disp_id_key(p->>'id_number') is not null then
    insert into app_private.dispatcher_identity as i (user_id, id_type, id_number, id_key)
    values (v_uid, nullif(btrim(p->>'id_type'), ''), btrim(p->>'id_number'), app_private.disp_id_key(p->>'id_number'))
    on conflict (user_id) do update set id_type = excluded.id_type, id_number = excluded.id_number, id_key = excluded.id_key, updated_at = now();
  end if;
  if p_submit and not exists (select 1 from app_private.dispatcher_identity i where i.user_id = v_uid) then
    return jsonb_build_object('error','Please enter your government ID type and number in section 1 (refresh the page if you do not see those fields).');
  end if;
$ins$ || a_app);

  d := pg_get_functiondef('public.cc_dispatcher_identity(uuid)'::regprocedure);
  if position(a_hold in d) = 0 then raise exception '%cc_dispatcher_identity hold', miss; end if;
  if position(a_m in d) = 0 then raise exception '%cc_dispatcher_identity match', miss; end if;
  d := replace(d, a_hold, '    ''self'', (select jsonb_build_object(''id_type'', i.id_type, ''id_number'', i.id_number) from app_private.dispatcher_identity i where i.user_id = p_user),   -- bl_disp_0604' || E'\n' || a_hold);
  d := replace(d, a_m, a_m || ' ''id_number'', (select i.id_number from app_private.dispatcher_identity i where i.user_id = d.user_id),');
  execute d;
end $$;
