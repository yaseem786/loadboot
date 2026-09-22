-- bl_comm_0395: sys_email v2 — the send path stops lying and starts honouring consent.
--
-- What changes, and why (audit bl_comm_0391, findings F1, F2, F3):
--   F1  meta.category was hard-coded 'transactional' on every single email. It now comes
--       from the catalog class: only class 'M' is marketing, everything else stays
--       transactional, so the delivery-worker's behaviour does not change for the
--       ~100 operational keys while the label finally tells the truth. The row also
--       carries class, preference_group and the sender identity for the CC screens.
--   F2  preference groups are enforced. account_critical and staff_internal can never be
--       blocked; a group whose opt_out_allowed is false can never be blocked; and a person
--       we cannot identify is never blocked (fail open — a missing profile must not stop
--       a carrier's paperwork). A blocked send is written to email_blocked_log so the
--       Command Center can say why an email never arrived.
--   F3  recipient_user and org_id are filled in, so per-person email history is possible
--       at all. Existing rows are backfilled once, by email match.
--   Plus: override_active from the catalog is honoured, and any key that is not in the
--   catalog is filed on first use instead of sending invisibly.
--
-- Additive and fail-open by design: if a lookup finds nothing, the email still goes.

create table if not exists app_private.email_pref_optouts(
  user_id     uuid not null,
  group_code  text not null references app_private.email_pref_groups(code),
  opted_out   boolean not null default true,
  source      text,
  updated_at  timestamptz not null default now(),
  primary key (user_id, group_code)
);
comment on table app_private.email_pref_optouts is
 'bl_comm_0395. Per-group opt-out ledger, one row per person per preference group. The legacy app_private.comm_preferences columns still count; this table is what the 360 page writes.';

create table if not exists app_private.email_blocked_log(
  id              bigserial primary key,
  template_key    text,
  recipient_email text,
  recipient_user  uuid,
  group_code      text,
  reason          text,
  created_at      timestamptz not null default now()
);
create index if not exists email_blocked_log_at_idx on app_private.email_blocked_log(created_at desc);
create index if not exists email_blocked_log_email_idx on app_private.email_blocked_log(lower(recipient_email));

-- Who is this address? Definer, so an RLS-restricted caller still resolves the person.
create or replace function app_private.email_identify(p_to text)
returns table(user_id uuid, org_id uuid)
language sql stable security definer set search_path = public, app_private as $$
  with u as (
    select p.id
      from public.profiles p
     where lower(btrim(coalesce(p.email,''))) = lower(btrim(coalesce(p_to,'')))
       and coalesce(btrim(p_to),'') <> ''
     order by p.created_at nulls last
     limit 1)
  select u.id,
         coalesce(
           (select m.org_id from public.organization_memberships m
             where m.user_id = u.id and coalesce(m.status,'active') <> 'removed'
             order by m.created_at limit 1),
           (select o.id from public.organizations o
             where o.owner_user_id = u.id order by o.created_at limit 1))
    from u;
$$;

-- May this key be sent to this person? Fail open everywhere it is not certain.
create or replace function app_private.email_pref_allows(p_key text, p_user uuid)
returns boolean language plpgsql stable security definer set search_path = public, app_private as $$
declare v_group text; v_opt_out_allowed boolean; v_pref record; v_off boolean;
begin
  select c.preference_group, coalesce(g.opt_out_allowed,false)
    into v_group, v_opt_out_allowed
    from app_private.email_catalog c
    left join app_private.email_pref_groups g on g.code = c.preference_group
   where c.key = p_key;

  if v_group is null or v_group in ('account_critical','staff_internal') then return true; end if;
  if not v_opt_out_allowed then return true; end if;
  if p_user is null then return true; end if;

  if exists (select 1 from app_private.email_pref_optouts o
              where o.user_id = p_user and o.group_code = v_group and o.opted_out) then
    return false;
  end if;

  select * into v_pref from app_private.comm_preferences where user_id = p_user;
  if v_pref is null then return true; end if;
  if coalesce(v_pref.unsubscribed_all,false) then return false; end if;

  v_off := case v_group
             when 'marketing'             then v_pref.marketing_email is false
             when 'product_announcements' then v_pref.product_announcements is false
             when 'digests'               then v_pref.weekly_summaries is false
             when 'load_ops'              then v_pref.load_offers is false
             else false end;
  return not coalesce(v_off,false);
end $$;

-- File a key the catalog has not seen. Definer: never let this fail a send.
create or replace function app_private.email_catalog_touch(p_key text)
returns void language plpgsql security definer set search_path = public, app_private as $$
begin
  if coalesce(btrim(p_key),'') = '' then return; end if;
  insert into app_private.email_catalog(key, discovered_in)
  values (p_key, array['code']) on conflict (key) do nothing;
exception when others then
  return;
end $$;

create or replace function app_private.email_block_note(
  p_key text, p_to text, p_user uuid, p_group text, p_reason text)
returns void language plpgsql security definer set search_path = public, app_private as $$
begin
  insert into app_private.email_blocked_log(template_key,recipient_email,recipient_user,group_code,reason)
  values (p_key, lower(p_to), p_user, p_group, p_reason);
exception when others then
  return;
end $$;

revoke all on function app_private.email_identify(text) from public, anon, authenticated;
revoke all on function app_private.email_pref_allows(text,uuid) from public, anon, authenticated;
revoke all on function app_private.email_catalog_touch(text) from public, anon, authenticated;
revoke all on function app_private.email_block_note(text,text,uuid,text,text) from public, anon, authenticated;

create or replace function app_private.sys_email(
  p_to text, p_template text, p_subject text, p_html text,
  p_text text default null, p_idem text default null)
returns void language plpgsql as $function$
declare
  v_user uuid; v_org uuid; v_cat text; v_group text; v_class text;
  v_subj text := p_subject; v_html text := p_html;
  v_sub_ov text; v_html_ov text; v_ov boolean;
begin
  if p_to is null or p_to !~ '^[^@]+@[^@]+\.[^@]+$' then return; end if;
  if exists (select 1 from app_private.suppressions
              where channel='email' and lower(btrim(address))=lower(btrim(p_to))
                and (reason is distinct from 'unsubscribed'
                     or coalesce(p_template ~* '^outreach[._-]', false))) then return; end if;

  -- a key that is not in the catalog gets filed, not hidden
  perform app_private.email_catalog_touch(p_template);

  select c.class, c.preference_group, c.subject_override, c.html_override, coalesce(c.override_active,false)
    into v_class, v_group, v_sub_ov, v_html_ov, v_ov
    from app_private.email_catalog c where c.key = p_template;

  select e.user_id, e.org_id into v_user, v_org from app_private.email_identify(p_to) e;

  if not app_private.email_pref_allows(p_template, v_user) then
    perform app_private.email_block_note(p_template, p_to, v_user, v_group, 'preference group opted out');
    return;
  end if;

  if v_ov then
    v_subj := coalesce(nullif(btrim(coalesce(v_sub_ov,'')),''), p_subject);
    if coalesce(btrim(coalesce(v_html_ov,'')),'') <> '' then
      v_html := case when v_html_ov like '%{{BODY}}%'
                     then replace(v_html_ov, '{{BODY}}', coalesce(p_html,''))
                     else v_html_ov end;
    end if;
  end if;

  v_cat := case when v_class = 'M' then 'marketing' else 'transactional' end;

  insert into app_private.message_deliveries(
      source, channel, provider, recipient_email, recipient_user, org_id,
      idempotency_key, status, scheduled_at, template_key, meta)
  values ('transactional','email','resend', lower(p_to), v_user, v_org,
    coalesce(p_idem, 'sys:'||p_template||':'||lower(p_to)||':'||extract(epoch from now())::bigint::text),
    'queued', now(), p_template,
    jsonb_build_object('subject', app_private.contact_expand(v_subj, true),
                       'body_html', app_private.contact_expand(v_html, false),
                       'body_text', app_private.contact_expand(coalesce(p_text, v_subj), true),
                       'category', v_cat,
                       'class', coalesce(v_class,'unclassified'),
                       'preference_group', v_group,
                       'sender', app_private.email_sender_for(p_template),
                       'override', v_ov))
  on conflict (idempotency_key) do nothing;
end $function$;

-- F3 backfill: one pass over the existing log so per-person history is not empty.
update app_private.message_deliveries d
   set recipient_user = p.id
  from public.profiles p
 where d.recipient_user is null
   and d.recipient_email is not null
   and lower(btrim(p.email)) = lower(btrim(d.recipient_email));

update app_private.message_deliveries d
   set org_id = m.org_id
  from public.organization_memberships m
 where d.org_id is null and d.recipient_user is not null
   and m.user_id = d.recipient_user and coalesce(m.status,'active') <> 'removed';

update app_private.message_deliveries d
   set org_id = o.id
  from public.organizations o
 where d.org_id is null and d.recipient_user is not null
   and o.owner_user_id = d.recipient_user;
