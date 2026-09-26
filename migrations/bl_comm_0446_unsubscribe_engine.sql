-- bl_comm_0446 — Unsubscribe engine: one ledger, one gate, one Command Center screen.
-- Applied: staging 2026-09-25. Prod: after the owner's staging check (see claude/UNSUBSCRIBE-ENGINE-0446.md).
--
-- Owner's ask (25 Sep 2026): whoever unsubscribes — a signed-in carrier/agent, or a cold-outreach
-- address that never signed up — the system must capture the FULL picture at the moment they do it
-- (which kind of email, from which email, by which route, why), show every bit of it in CC in the
-- right place, and refuse — with the reason — when anyone (a staff member, Claude in a session, a
-- cron) later tries to send that person the thing they opted out of. Amazon / Uber standard:
-- per-category preferences, one-click honoured instantly, reasons collected, nothing silent.
--
-- What existed before (kept, now fed by the engine instead of bypassing it):
--   app_private.suppressions          reason='unsubscribed' = marketing-only; bounced/complained = hard
--   app_private.email_pref_optouts    per-user, per-group opt-outs (signed-in users only)
--   app_private.comm_preferences      the carrier app's toggles (marketing_email, unsubscribed_all …)
--   app_private.email_blocked_log     what sys_email refused, with a one-line reason
--   Entry points: outreach footer {UNSUB} (public.outreach_unsubscribe, anon), RFC 8058 one-click +
--   footer link (cc_delivery_worker_unsubscribe, service_role), reply "unsubscribe"
--   (cc_mail_unsubscribe_from, service_role), the carrier app (cc_pocket_save_preferences).
--   None of them recorded WHICH category or WHY, and CC only showed the flat suppression list.
--
-- What this adds:
--   app_private.unsub_reasons         the reason dictionary the preference page offers (CC-editable)
--   app_private.unsub_settings        one row: what one-click / reply / legacy links unsubscribe from
--   app_private.unsub_prefs           CURRENT state per address × group ('*' = every optional email)
--   app_private.unsub_events          IMMUTABLE ledger: every unsubscribe / resubscribe, with source,
--                                     scope, groups, reason, the email it came from, who did it
--   app_private.unsub_apply(...)      the ONE writer. Every entry point above now calls it. It mirrors
--                                     into the legacy tables so every old gate keeps working.
--   app_private.email_gate(...)       the ONE decision: may template X go to address Y? Returns
--                                     allowed + code + a human sentence. sys_email uses it and files
--                                     the sentence in email_blocked_log; CC shows it.
--   public.unsub_link_get / unsub_link_apply   service_role RPCs behind the preference page
--                                     (supabase/functions/unsubscribe). Accept the per-delivery uuid
--                                     token AND the legacy outreach e+t token. NOT anon: the edge
--                                     function holds the service key, so the anon surface is unchanged.
--   public.cc_unsub_*                 staff RPCs for the CC "Unsubscribes" screen (#/unsubscribes)
--   public.cc_email_can_send(to,key)  "may I send this?" — the question to ask BEFORE any hand send.
--   Backfill: existing suppressions / opt-outs / unsubscribed outreach contacts become prefs + events
--   (source='backfill', dated from the original row) so the ledger is complete from day one.
-- anon SECURITY DEFINER surface: unchanged (34 prod / 33 staging). Every new public function is
-- revoked from public + anon explicitly (CLAUDE.md §4).

-- ---------------------------------------------------------------- 1. tables
create table if not exists app_private.unsub_reasons (
  code   text primary key check (code ~ '^[a-z0-9_]+$'),
  label  text not null,
  sort   integer not null default 100,
  active boolean not null default true
);
insert into app_private.unsub_reasons (code, label, sort) values
  ('too_many',        'Too many emails',                         10),
  ('not_relevant',    'The emails are not relevant to me',       20),
  ('never_signed_up', 'I never signed up for this',              30),
  ('no_longer_needed','I no longer need this',                   40),
  ('wrong_person',    'Wrong person or company',                 50),
  ('spam',            'These emails look like spam',             60),
  ('other',           'Other',                                   90)
on conflict (code) do nothing;

create table if not exists app_private.unsub_settings (
  id                integer primary key default 1 check (id = 1),
  one_click_scope   text not null default 'group'     check (one_click_scope in ('group','marketing','all')),
  reply_scope       text not null default 'marketing' check (reply_scope     in ('group','marketing','all')),
  legacy_link_scope text not null default 'marketing' check (legacy_link_scope in ('marketing','all')),
  page_offer_all    boolean not null default true,    -- the preference page offers "stop every optional email"
  ask_reason        boolean not null default true,    -- the preference page asks why (never required)
  resubscribe_via_link boolean not null default true, -- the page lets the person switch a group back on
  updated_by        uuid,
  updated_at        timestamptz not null default now()
);
insert into app_private.unsub_settings (id) values (1) on conflict (id) do nothing;

create table if not exists app_private.unsub_prefs (
  email           text not null,
  group_code      text not null,                       -- email_pref_groups.code, or '*' = every optional email
  opted_out       boolean not null default true,
  source          text not null,
  reason_code     text,
  reason_text     text,
  origin_template text,
  user_id         uuid,
  last_event_id   bigint,
  updated_at      timestamptz not null default now(),
  primary key (email, group_code),
  check (email = lower(btrim(email)))
);
create index if not exists unsub_prefs_user_idx on app_private.unsub_prefs (user_id) where user_id is not null;
create index if not exists unsub_prefs_out_idx  on app_private.unsub_prefs (group_code) where opted_out;

create table if not exists app_private.unsub_events (
  id              bigserial primary key,
  at              timestamptz not null default now(),
  email           text not null,
  user_id         uuid,
  org_id          uuid,
  channel         text not null default 'email' check (channel in ('email','sms')),
  action          text not null check (action in ('unsubscribe','resubscribe')),
  scope           text not null check (scope in ('group','marketing','all')),
  groups          text[] not null default '{}',
  reason_code     text,
  reason_text     text,
  source          text not null check (source in ('one_click','preference_page','legacy_link','reply','app_prefs','cc_manual','sms_stop','backfill')),
  origin_template text,
  origin_delivery uuid,
  origin_campaign uuid,
  ip              text,
  user_agent      text,
  actor           uuid,
  meta            jsonb not null default '{}'::jsonb
);
create index if not exists unsub_events_email_idx on app_private.unsub_events (lower(email), at desc);
create index if not exists unsub_events_at_idx    on app_private.unsub_events (at desc);

alter table app_private.email_blocked_log add column if not exists code text;

comment on table app_private.unsub_prefs  is 'Current opt-out state per address × preference group. ''*'' = every optional email. Written only by app_private.unsub_apply.';
comment on table app_private.unsub_events is 'Immutable ledger of every unsubscribe / resubscribe, whatever the route. Written only by app_private.unsub_apply.';

-- ---------------------------------------------------------------- 2. helpers
create or replace function app_private.unsub_group_label(p_code text)
returns text language sql stable security definer set search_path to 'app_private, public' as $$
  select case when p_code = '*' then 'every optional email'
              else coalesce((select label from app_private.email_pref_groups where code = p_code), p_code) end;
$$;
revoke all on function app_private.unsub_group_label(text) from public, anon, authenticated;

create or replace function app_private.unsub_source_label(p_source text)
returns text language sql immutable as $$
  select case p_source
    when 'one_click'       then 'one-click unsubscribe in their mail app'
    when 'preference_page' then 'the email preferences page'
    when 'legacy_link'     then 'the unsubscribe link in an older email'
    when 'reply'           then 'a reply saying "unsubscribe"'
    when 'app_prefs'       then 'the notification settings in the app'
    when 'cc_manual'       then 'Command Center (staff)'
    when 'sms_stop'        then 'an SMS STOP'
    when 'backfill'        then 'the pre-engine record (backfilled 25 Sep 2026)'
    else coalesce(p_source, 'unknown') end;
$$;

-- The group a template belongs to, for deciding what a one-click from that email means.
create or replace function app_private.unsub_template_group(p_key text)
returns text language sql stable security definer set search_path to 'app_private, public' as $$
  select coalesce(
    (select c.preference_group from app_private.email_catalog c where c.key = p_key),
    case when coalesce(p_key ~* '^outreach[._-]', false) then 'marketing' end);
$$;
revoke all on function app_private.unsub_template_group(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- 3. the one writer
create or replace function app_private.unsub_apply(
  p_email text, p_action text, p_scope text, p_groups text[],
  p_reason_code text, p_reason_text text, p_source text,
  p_origin_template text default null, p_origin_delivery uuid default null,
  p_actor uuid default null, p_meta jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare
  v_email text := lower(btrim(p_email));
  v_user uuid; v_org uuid; v_groups text[]; v_g text; v_ev bigint; v_camp uuid;
  v_reason text; v_touch_marketing boolean := false; v_all boolean := false; v_state jsonb;
begin
  if v_email is null or v_email !~ '^[^@]+@[^@]+\.[^@]+$' then
    return jsonb_build_object('ok', false, 'error', 'invalid email');
  end if;
  if p_action not in ('unsubscribe','resubscribe') then
    return jsonb_build_object('ok', false, 'error', 'invalid action');
  end if;
  if p_scope not in ('group','marketing','all') then
    return jsonb_build_object('ok', false, 'error', 'invalid scope');
  end if;
  if p_source not in ('one_click','preference_page','legacy_link','reply','app_prefs','cc_manual','sms_stop','backfill') then
    return jsonb_build_object('ok', false, 'error', 'invalid source');
  end if;

  select e.user_id, e.org_id into v_user, v_org from app_private.email_identify(v_email) e;
  if p_origin_delivery is not null then
    select campaign_id into v_camp from app_private.message_deliveries where id = p_origin_delivery;
  end if;

  -- Which groups. Essential groups can never be opted out of, whatever the caller passes.
  if p_scope = 'all' then
    v_groups := array['*'];
  elsif p_scope = 'marketing' then
    v_groups := array['marketing'];
  else
    select coalesce(array_agg(distinct g.code), '{}')
      into v_groups
      from unnest(coalesce(p_groups, '{}')) x(code)
      join app_private.email_pref_groups g on g.code = x.code and g.opt_out_allowed;
    if coalesce(array_length(v_groups, 1), 0) = 0 and p_origin_template is not null then
      v_g := app_private.unsub_template_group(p_origin_template);
      if v_g is not null and exists (select 1 from app_private.email_pref_groups where code = v_g and opt_out_allowed) then
        v_groups := array[v_g];
      end if;
    end if;
    if coalesce(array_length(v_groups, 1), 0) = 0 then
      return jsonb_build_object('ok', false, 'error', 'nothing to change — only essential emails were named');
    end if;
  end if;
  v_all := '*' = any(v_groups);
  v_touch_marketing := v_all or 'marketing' = any(v_groups);

  -- Already off → no second event. Opening the preferences page again (or a second one-click) must not
  -- count the same person twice; the caller gets the existing event back. (26 Sep 2026, owner's test:
  -- three page opens had written three "unsubscribed from Summaries" rows.)
  if p_action = 'unsubscribe'
     and not exists (select 1 from unnest(v_groups) g
                      where not exists (select 1 from app_private.unsub_prefs p
                                         where p.email = v_email and p.group_code = g and p.opted_out)) then
    return jsonb_build_object('ok', true, 'noop', true, 'email', v_email, 'user_id', v_user, 'action', p_action, 'groups', v_groups,
      'event_id', (select max(p.last_event_id) from app_private.unsub_prefs p where p.email = v_email and p.group_code = any(v_groups)),
      'state', app_private.unsub_state(v_email));
  end if;

  v_reason := nullif(btrim(p_reason_text), '');
  if p_reason_code is not null and not exists (select 1 from app_private.unsub_reasons where code = p_reason_code) then
    -- keep the text, drop the unknown code
    v_reason := coalesce(v_reason, p_reason_code);
    p_reason_code := null;
  end if;

  -- 1. the ledger
  insert into app_private.unsub_events(email, user_id, org_id, channel, action, scope, groups, reason_code, reason_text,
                                       source, origin_template, origin_delivery, origin_campaign, ip, user_agent, actor, meta)
  values (v_email, v_user, v_org, 'email', p_action, p_scope, v_groups, p_reason_code, v_reason,
          p_source, p_origin_template, p_origin_delivery, v_camp,
          nullif(p_meta->>'ip',''), left(nullif(p_meta->>'user_agent',''), 300), p_actor,
          coalesce(p_meta, '{}'::jsonb) - 'ip' - 'user_agent')
  returning id into v_ev;

  -- 2. current state
  foreach v_g in array v_groups loop
    insert into app_private.unsub_prefs(email, group_code, opted_out, source, reason_code, reason_text, origin_template, user_id, last_event_id, updated_at)
    values (v_email, v_g, p_action = 'unsubscribe', p_source, p_reason_code, v_reason, p_origin_template, v_user, v_ev, now())
    on conflict (email, group_code) do update
      set opted_out = excluded.opted_out, source = excluded.source, reason_code = excluded.reason_code,
          reason_text = excluded.reason_text, origin_template = excluded.origin_template,
          user_id = coalesce(excluded.user_id, app_private.unsub_prefs.user_id),
          last_event_id = excluded.last_event_id, updated_at = now();
  end loop;

  -- 3. mirror into the legacy stores so every existing gate agrees with the engine
  if v_user is not null then
    insert into app_private.comm_preferences(user_id, consent_source, updated_at)
    values (v_user, p_source, now()) on conflict (user_id) do nothing;
    if p_action = 'unsubscribe' then
      update app_private.comm_preferences set
        unsubscribed_all      = case when v_all then true else unsubscribed_all end,
        marketing_email       = case when v_all or 'marketing' = any(v_groups) then false else marketing_email end,
        product_announcements = case when v_all or 'product_announcements' = any(v_groups) then false else product_announcements end,
        weekly_summaries      = case when v_all or 'digests' = any(v_groups) then false else weekly_summaries end,
        load_offers           = case when v_all or 'load_ops' = any(v_groups) then false else load_offers end,
        updated_at = now()
      where user_id = v_user;
      insert into app_private.email_pref_optouts(user_id, group_code, opted_out, source, updated_at)
      select v_user, g.code, true, p_source, now()
        from app_private.email_pref_groups g
       where g.opt_out_allowed and (v_all or g.code = any(v_groups))
      on conflict (user_id, group_code) do update set opted_out = true, source = excluded.source, updated_at = now();
    else
      update app_private.comm_preferences set
        unsubscribed_all      = case when v_all then false else unsubscribed_all end,
        marketing_email       = case when v_all or 'marketing' = any(v_groups) then true else marketing_email end,
        product_announcements = case when v_all or 'product_announcements' = any(v_groups) then true else product_announcements end,
        weekly_summaries      = case when v_all or 'digests' = any(v_groups) then true else weekly_summaries end,
        load_offers           = case when v_all or 'load_ops' = any(v_groups) then true else load_offers end,
        updated_at = now()
      where user_id = v_user;
      update app_private.email_pref_optouts set opted_out = false, source = p_source, updated_at = now()
       where user_id = v_user and (v_all or group_code = any(v_groups));
      -- resubscribing one group while '*' is still on would be a lie: clear '*' too, keep the other groups off
      if not v_all and exists (select 1 from app_private.unsub_prefs where email = v_email and group_code = '*' and opted_out) then
        insert into app_private.unsub_prefs(email, group_code, opted_out, source, user_id, last_event_id, updated_at)
        select v_email, g.code, true, 'preference_page', v_user, v_ev, now()
          from app_private.email_pref_groups g where g.opt_out_allowed and g.code <> all(v_groups)
        on conflict (email, group_code) do update set opted_out = true, last_event_id = excluded.last_event_id, updated_at = now();
        update app_private.unsub_prefs set opted_out = false, last_event_id = v_ev, updated_at = now()
         where email = v_email and group_code = '*';
      end if;
    end if;
  elsif p_action = 'resubscribe' and not v_all
        and exists (select 1 from app_private.unsub_prefs where email = v_email and group_code = '*' and opted_out) then
    insert into app_private.unsub_prefs(email, group_code, opted_out, source, last_event_id, updated_at)
    select v_email, g.code, true, 'preference_page', v_ev, now()
      from app_private.email_pref_groups g where g.opt_out_allowed and g.code <> all(v_groups)
    on conflict (email, group_code) do update set opted_out = true, last_event_id = excluded.last_event_id, updated_at = now();
    update app_private.unsub_prefs set opted_out = false, last_event_id = v_ev, updated_at = now()
     where email = v_email and group_code = '*';
  end if;

  if v_touch_marketing then
    if p_action = 'unsubscribe' then
      insert into app_private.suppressions(channel, address, reason)
      select 'email', v_email, 'unsubscribed'
      where not exists (select 1 from app_private.suppressions s where s.channel = 'email' and lower(btrim(s.address)) = v_email);
      update app_private.outreach_contacts set status = 'unsubscribed'
       where lower(btrim(email)) = v_email and status <> 'unsubscribed';
      update app_private.message_deliveries
         set status = 'unsubscribed', failure_reason = 'recipient opted out of marketing/outreach', updated_at = now()
       where channel = 'email' and lower(btrim(recipient_email)) = v_email
         and (template_key ~* '^outreach[._-]' or source = 'campaign')
         and status in ('queued','claimed','scheduled');
    else
      -- only the soft 'unsubscribed' row goes; a bounce or complaint is never undone here
      delete from app_private.suppressions where channel = 'email' and lower(btrim(address)) = v_email and reason = 'unsubscribed';
      update app_private.outreach_contacts set status = 'active'
       where lower(btrim(email)) = v_email and status = 'unsubscribed';
    end if;
  end if;

  -- 4. queued optional mail in the groups they just left does not go out either
  if p_action = 'unsubscribe' then
    update app_private.message_deliveries d
       set status = 'unsubscribed', failure_reason = 'recipient unsubscribed from ' || app_private.unsub_group_label(case when v_all then '*' else coalesce(c.preference_group, 'marketing') end), updated_at = now()
      from app_private.email_catalog c
     where c.key = d.template_key and d.channel = 'email'
       and lower(btrim(d.recipient_email)) = v_email
       and d.status in ('queued','scheduled')
       and c.preference_group not in ('account_critical','staff_internal')
       and not (c.preference_group = 'billing' and c.unsub_allowed is false)
       and (v_all or c.preference_group = any(v_groups));
  end if;

  perform app_private.log_audit(
    case when p_action = 'unsubscribe' then 'comm.unsubscribe' else 'comm.resubscribe' end,
    'email', v_email, v_org,
    v_email || ' ' || p_action || 'd from ' || array_to_string(array(select app_private.unsub_group_label(x) from unnest(v_groups) x), ', ') || ' via ' || app_private.unsub_source_label(p_source),
    jsonb_build_object('event_id', v_ev, 'scope', p_scope, 'groups', v_groups, 'reason_code', p_reason_code, 'reason_text', v_reason,
                       'source', p_source, 'origin_template', p_origin_template, 'actor', p_actor));

  select app_private.unsub_state(v_email) into v_state;
  return jsonb_build_object('ok', true, 'event_id', v_ev, 'email', v_email, 'user_id', v_user,
                            'action', p_action, 'groups', v_groups, 'state', v_state);
end $$;
revoke all on function app_private.unsub_apply(text,text,text,text[],text,text,text,text,uuid,uuid,jsonb) from public, anon, authenticated;

-- Current state for one address: every optional group with on/off + how it got that way.
create or replace function app_private.unsub_state(p_email text)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $$
declare v_email text := lower(btrim(p_email)); v_user uuid; v_all record; v_hard record; v_pref record;
begin
  select e.user_id into v_user from app_private.email_identify(v_email) e;
  select * into v_all  from app_private.unsub_prefs where email = v_email and group_code = '*';
  select reason, created_at into v_hard from app_private.suppressions
   where channel = 'email' and lower(btrim(address)) = v_email and reason is distinct from 'unsubscribed' limit 1;
  select * into v_pref from app_private.comm_preferences where user_id = v_user;
  return jsonb_build_object(
    'email', v_email, 'user_id', v_user,
    'all_off', coalesce(v_all.opted_out, false) or coalesce(v_pref.unsubscribed_all, false),
    'all_off_since', case when coalesce(v_all.opted_out,false) then v_all.updated_at when coalesce(v_pref.unsubscribed_all,false) then v_pref.updated_at end,
    'all_off_source', case when coalesce(v_all.opted_out,false) then v_all.source when coalesce(v_pref.unsubscribed_all,false) then 'app_prefs' end,
    'hard_suppressed', v_hard.reason is not null,
    'hard_reason', v_hard.reason, 'hard_since', v_hard.created_at,
    'groups', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'code', g.code, 'label', g.label, 'description', g.description,
               'opt_out_allowed', g.opt_out_allowed,
               'opted_out', g.opt_out_allowed and (
                   coalesce(p.opted_out, false)
                   or coalesce(v_all.opted_out, false)
                   or coalesce(v_pref.unsubscribed_all, false)
                   or (g.code = 'marketing' and (v_pref.marketing_email is false
                        or exists (select 1 from app_private.suppressions s where s.channel='email' and lower(btrim(s.address)) = v_email and s.reason = 'unsubscribed')))
                   or (g.code = 'product_announcements' and v_pref.product_announcements is false)
                   or (g.code = 'digests'  and v_pref.weekly_summaries is false)
                   or (g.code = 'load_ops' and v_pref.load_offers is false)
                   or exists (select 1 from app_private.email_pref_optouts o where o.user_id = v_user and o.group_code = g.code and o.opted_out)),
               'source', p.source, 'reason_code', p.reason_code, 'reason_text', p.reason_text,
               'origin_template', p.origin_template, 'since', p.updated_at) order by g.sort), '[]'::jsonb)
        from app_private.email_pref_groups g
        left join app_private.unsub_prefs p on p.email = v_email and p.group_code = g.code
       where g.code <> 'staff_internal'));
end $$;
revoke all on function app_private.unsub_state(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- 4. the one decision
-- May template p_key go to p_to? {allowed, code, reason, group, group_label, essential}
create or replace function app_private.email_gate(p_key text, p_to text, p_user uuid default null)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $$
declare
  v_email text := lower(btrim(p_to)); v_group text; v_label text; v_unsub boolean; v_ooa boolean;
  v_is_outreach boolean := coalesce(p_key ~* '^outreach[._-]', false);
  v_user uuid := p_user; r record; v_ev record; v_prefix text;
begin
  if v_email is null or v_email !~ '^[^@]+@[^@]+\.[^@]+$' then
    return jsonb_build_object('allowed', false, 'code', 'invalid_address', 'reason', 'That is not a valid email address.');
  end if;

  -- 1. hard suppression: bounced / complained / manual block — nothing goes, ever
  select reason, created_at into r from app_private.suppressions
   where channel = 'email' and lower(btrim(address)) = v_email and reason is distinct from 'unsubscribed'
   order by created_at limit 1;
  if found then
    return jsonb_build_object('allowed', false, 'code', 'suppressed', 'group', null,
      'reason', 'Address is on the suppression list (' || r.reason || ') since ' || to_char(r.created_at, 'DD Mon YYYY') || '. Nothing is sent to a suppressed address.');
  end if;

  -- 2. what kind of email is this?
  select c.preference_group, c.unsub_allowed, g.label, coalesce(g.opt_out_allowed, false)
    into v_group, v_unsub, v_label, v_ooa
    from app_private.email_catalog c left join app_private.email_pref_groups g on g.code = c.preference_group
   where c.key = p_key;
  if v_group is null and v_is_outreach then v_group := 'marketing'; v_label := 'Marketing'; v_ooa := true; v_unsub := true; end if;

  if v_group in ('account_critical','staff_internal') or (v_group = 'billing' and v_unsub is false) or (v_group is not null and not v_ooa) then
    return jsonb_build_object('allowed', true, 'code', 'essential', 'group', v_group, 'group_label', v_label, 'essential', true,
      'reason', coalesce(v_label, v_group) || ' emails are essential and always send, even to someone who unsubscribed from everything optional.');
  end if;

  if v_user is null then select e.user_id into v_user from app_private.email_identify(v_email) e; end if;

  -- 3. "stop every optional email"
  select p.*, e.at as ev_at, e.reason_code as ev_reason, e.reason_text as ev_text
    into r
    from app_private.unsub_prefs p left join app_private.unsub_events e on e.id = p.last_event_id
   where p.email = v_email and p.group_code = '*' and p.opted_out;
  if found then
    return jsonb_build_object('allowed', false, 'code', 'unsubscribed_all', 'group', v_group, 'group_label', v_label,
      'reason', v_email || ' stopped every optional email on ' || to_char(r.updated_at, 'DD Mon YYYY') || ' via ' || app_private.unsub_source_label(r.source)
        || coalesce(' (reason: ' || coalesce((select label from app_private.unsub_reasons where code = r.reason_code), r.reason_code) || coalesce(' — ' || r.reason_text, '') || ')', coalesce(' (reason: ' || r.reason_text || ')', ''))
        || '. This email is in ' || coalesce(v_label, 'an optional group') || ', so it is blocked.');
  end if;
  if v_user is not null and exists (select 1 from app_private.comm_preferences where user_id = v_user and coalesce(unsubscribed_all,false)) then
    return jsonb_build_object('allowed', false, 'code', 'unsubscribed_all', 'group', v_group, 'group_label', v_label,
      'reason', v_email || ' paused every optional email in the app. This email is in ' || coalesce(v_label, 'an optional group') || ', so it is blocked.');
  end if;

  -- 4. this group
  if v_group is not null then
    select p.* into r from app_private.unsub_prefs p where p.email = v_email and p.group_code = v_group and p.opted_out;
    if found then
      return jsonb_build_object('allowed', false, 'code', 'unsubscribed_group', 'group', v_group, 'group_label', v_label,
        'reason', v_email || ' unsubscribed from ' || coalesce(v_label, v_group) || ' emails on ' || to_char(r.updated_at, 'DD Mon YYYY') || ' via ' || app_private.unsub_source_label(r.source)
          || coalesce(' (reason: ' || coalesce((select label from app_private.unsub_reasons where code = r.reason_code), r.reason_code) || coalesce(' — ' || r.reason_text, '') || ')', coalesce(' (reason: ' || r.reason_text || ')', ''))
          || coalesce(', from the email "' || r.origin_template || '"', '') || '.');
    end if;
  end if;

  -- 5. marketing: the legacy soft suppression and the outreach contact status
  if v_is_outreach or v_group = 'marketing' then
    select reason, created_at into r from app_private.suppressions
     where channel = 'email' and lower(btrim(address)) = v_email and reason = 'unsubscribed' limit 1;
    if found then
      return jsonb_build_object('allowed', false, 'code', 'unsubscribed_marketing', 'group', v_group, 'group_label', v_label,
        'reason', v_email || ' unsubscribed from marketing on ' || to_char(r.created_at, 'DD Mon YYYY') || '. No cold outreach or campaign email goes to them.');
    end if;
    if v_is_outreach and exists (select 1 from app_private.outreach_contacts oc where lower(btrim(oc.email)) = v_email and oc.status = 'unsubscribed') then
      return jsonb_build_object('allowed', false, 'code', 'unsubscribed_marketing', 'group', v_group, 'group_label', v_label,
        'reason', v_email || ' is an unsubscribed outreach contact. No cold outreach goes to them.');
    end if;
  end if;

  -- 6. the signed-in user's own preference toggles
  if v_user is not null and v_group is not null and not app_private.email_pref_allows(p_key, v_user) then
    return jsonb_build_object('allowed', false, 'code', 'preference_opted_out', 'group', v_group, 'group_label', v_label,
      'reason', v_email || ' switched off ' || coalesce(v_label, v_group) || ' emails in their notification settings.');
  end if;

  return jsonb_build_object('allowed', true, 'code', 'ok', 'group', v_group, 'group_label', v_label, 'essential', false,
    'reason', case when v_group is null then 'No preference group on this key yet (it will be filed as undocumented); nothing blocks it.'
                   else coalesce(v_label, v_group) || ' emails are on for this address.' end);
end $$;
revoke all on function app_private.email_gate(text,text,uuid) from public, anon, authenticated;

-- email_block_note now carries the machine code next to the sentence.
create or replace function app_private.email_block_note(p_key text, p_to text, p_user uuid, p_group text, p_reason text, p_code text default null)
returns void language plpgsql security definer set search_path to 'public', 'app_private' as $$
begin
  insert into app_private.email_blocked_log(template_key, recipient_email, recipient_user, group_code, reason, code)
  values (p_key, lower(p_to), p_user, p_group, p_reason, p_code);
exception when others then
  return;
end $$;
revoke all on function app_private.email_block_note(text,text,uuid,text,text,text) from public, anon, authenticated;

-- ---------------------------------------------------------------- 5. sys_email goes through the gate
do $mig$
declare src text; out_src text;
begin
  src := pg_get_functiondef('app_private.sys_email(text,text,text,text,text,text)'::regprocedure);

  out_src := replace(src,
    '  v_user uuid; v_org uuid; v_cat text; v_group text; v_class text;',
    '  v_user uuid; v_org uuid; v_cat text; v_group text; v_class text; v_gate jsonb;');
  if out_src = src then raise exception 'bl_comm_0446: sys_email declare line not found'; end if;
  src := out_src;

  -- early check keeps only the HARD suppressions (bounce / complaint / manual) and now files the reason
  out_src := replace(src,
    E'  if exists (select 1 from app_private.suppressions\n'
    || E'              where channel=''email'' and lower(btrim(address))=lower(btrim(p_to))\n'
    || E'                and (reason is distinct from ''unsubscribed''\n'
    || E'                     or coalesce(p_template ~* ''^outreach[._-]'', false))) then return; end if;',
    E'  v_gate := app_private.email_gate(p_template, p_to, null);\n'
    || E'  if coalesce(v_gate->>''code'','''') in (''suppressed'',''unsubscribed_all'',''unsubscribed_group'',''unsubscribed_marketing'') then\n'
    || E'    perform app_private.email_block_note(p_template, p_to, null, v_gate->>''group'', v_gate->>''reason'', v_gate->>''code'');\n'
    || E'    return;\n'
    || E'  end if;');
  if out_src = src then raise exception 'bl_comm_0446: sys_email suppression check not found'; end if;
  src := out_src;

  out_src := replace(src,
    E'  if not app_private.email_pref_allows(p_template, v_user) then\n'
    || E'    perform app_private.email_block_note(p_template, p_to, v_user, v_group, ''preference group opted out'');\n'
    || E'    return;',
    E'  v_gate := app_private.email_gate(p_template, p_to, v_user);\n'
    || E'  if not coalesce((v_gate->>''allowed'')::boolean, true) then\n'
    || E'    perform app_private.email_block_note(p_template, p_to, v_user, coalesce(v_gate->>''group'', v_group), v_gate->>''reason'', v_gate->>''code'');\n'
    || E'    return;');
  if out_src = src then raise exception 'bl_comm_0446: sys_email preference check not found'; end if;
  execute out_src;
end
$mig$;

-- The worker's last guard before Resend also honours the engine's state.
create or replace function public.cc_delivery_worker_marketing_allowed(p_id uuid)
returns boolean language sql stable security definer set search_path to 'app_private', 'public' as $$
  select coalesce((
    select
      d.status = 'claimed'
      and not exists (
        select 1 from app_private.suppressions s
         where s.channel = d.channel and lower(btrim(s.address)) = lower(btrim(d.recipient_email))
           and (s.reason in ('bounced','complained') or coalesce(d.template_key ~* '^outreach[._-]', false) or d.source = 'campaign'))
      and not exists (
        select 1 from app_private.unsub_prefs p
         where p.email = lower(btrim(d.recipient_email)) and p.opted_out and p.group_code in ('*','marketing'))
      and (
        not coalesce(d.template_key ~* '^outreach[._-]', false)
        or exists (
          select 1 from app_private.outreach_contacts oc
           where lower(trim(oc.email)) = lower(btrim(d.recipient_email))
             and oc.status in ('active','completed') and oc.replied_at is null and oc.converted_at is null))
      and (
        d.source <> 'campaign' or d.recipient_user is null
        or (not exists (select 1 from app_private.email_pref_optouts po where po.user_id = d.recipient_user and po.group_code = 'marketing' and po.opted_out)
            and not exists (select 1 from app_private.comm_preferences cp where cp.user_id = d.recipient_user and (cp.marketing_email is false or coalesce(cp.unsubscribed_all,false)))))
    from app_private.message_deliveries d
    where d.id = p_id and d.channel = 'email'
      and (coalesce(d.template_key ~* '^outreach[._-]', false) or d.source = 'campaign')
  ), false);
$$;
revoke all on function public.cc_delivery_worker_marketing_allowed(uuid) from public, anon, authenticated;
grant execute on function public.cc_delivery_worker_marketing_allowed(uuid) to service_role;

-- Optional (non-essential, non-marketing) mail: the worker asks this right before Resend, so a
-- one-click that landed after the row was queued still wins.
create or replace function public.cc_delivery_worker_optional_allowed(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'app_private', 'public' as $$
declare d record;
begin
  select id, template_key, recipient_email, recipient_user, status into d from app_private.message_deliveries where id = p_id and channel = 'email';
  if d.id is null or d.status <> 'claimed' then return jsonb_build_object('allowed', false, 'code', 'not_claimed', 'reason', 'row is not claimed'); end if;
  return app_private.email_gate(d.template_key, d.recipient_email, d.recipient_user);
end $$;
revoke all on function public.cc_delivery_worker_optional_allowed(uuid) from public, anon, authenticated;
grant execute on function public.cc_delivery_worker_optional_allowed(uuid) to service_role;

-- ---------------------------------------------------------------- 6. every entry point → unsub_apply
-- Reply "unsubscribe" (inbound-mail, service_role)
create or replace function public.cc_mail_unsubscribe_from(p_email text)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare v_scope text; v_out jsonb;
begin
  select reply_scope into v_scope from app_private.unsub_settings where id = 1;
  v_out := app_private.unsub_apply(p_email, 'unsubscribe', coalesce(nullif(v_scope,'group'), 'marketing'), null, null, null, 'reply', null, null, null, '{}'::jsonb);
  return jsonb_build_object('ok', coalesce((v_out->>'ok')::boolean, false), 'reason', v_out->>'error');
end $$;
revoke all on function public.cc_mail_unsubscribe_from(text) from public, anon, authenticated;
grant execute on function public.cc_mail_unsubscribe_from(text) to service_role;

-- Old outreach footer links already in inboxes (anon, unchanged name; body now records the event)
create or replace function public.outreach_unsubscribe(p_email text, p_token text)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare v_email text := lower(trim(p_email)); v_scope text; v_out jsonb;
begin
  if v_email is null or v_email !~ '^[^@]+@[^@]+[.][^@]+$' then
    return jsonb_build_object('ok', false, 'error', 'invalid link');
  end if;
  if p_token is null or btrim(p_token) = ''
     or not exists (select 1 from app_private.outreach_state where id=1 and nullif(unsub_secret,'') is not null)
     or app_private.outreach_unsub_token(v_email) is null
     or p_token is distinct from app_private.outreach_unsub_token(v_email) then
    return jsonb_build_object('ok', false, 'error', 'invalid link');
  end if;
  select legacy_link_scope into v_scope from app_private.unsub_settings where id = 1;
  v_out := app_private.unsub_apply(v_email, 'unsubscribe', coalesce(v_scope, 'marketing'), null, null, null, 'legacy_link', 'outreach', null, null, '{}'::jsonb);
  return jsonb_build_object('ok', coalesce((v_out->>'ok')::boolean, false), 'scope', coalesce(v_scope, 'marketing'), 'error', v_out->>'error');
end $$;

-- RFC 8058 one-click + the old footer link (token = message_deliveries.correlation_id), service_role.
create or replace function public.cc_delivery_worker_unsubscribe(p_token uuid)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare d app_private.message_deliveries%rowtype; v_scope text; v_out jsonb; v_group text;
begin
  select * into d from app_private.message_deliveries where correlation_id = p_token limit 1;
  if d.id is null then return jsonb_build_object('ok', false, 'reason', 'unknown token'); end if;

  if d.channel = 'email' and d.recipient_email is not null then
    select one_click_scope into v_scope from app_private.unsub_settings where id = 1;
    v_group := app_private.unsub_template_group(d.template_key);
    if d.source = 'campaign' then v_group := 'marketing'; end if;
    if coalesce(v_scope, 'group') = 'group'
       and not exists (select 1 from app_private.email_pref_groups g where g.code = v_group and g.opt_out_allowed) then
      v_scope := 'marketing';   -- a token from an essential email (old operational mail) still means "no marketing"
    end if;
    v_out := app_private.unsub_apply(d.recipient_email, 'unsubscribe', coalesce(v_scope, 'group'),
               case when coalesce(v_scope,'group') = 'group' then array[v_group] end,
               null, null, 'one_click', d.template_key, d.id, null, '{}'::jsonb);
    if not coalesce((v_out->>'ok')::boolean, false) then
      return jsonb_build_object('ok', false, 'reason', v_out->>'error');
    end if;
    return jsonb_build_object('ok', true, 'channel', 'email', 'scope', coalesce(v_scope,'group'), 'groups', v_out->'groups', 'email', d.recipient_email);
  elsif d.channel = 'sms' and d.recipient_phone is not null then
    insert into app_private.suppressions(channel, address, reason) values ('sms', d.recipient_phone, 'unsubscribed') on conflict do nothing;
    update app_private.message_deliveries set status = 'unsubscribed', updated_at = now() where id = d.id and status in ('queued','claimed','scheduled');
    perform app_private.log_audit('comm.unsubscribe', 'delivery', d.id::text, null, 'recipient unsubscribed from SMS through one-click link', jsonb_build_object('channel','sms'));
    return jsonb_build_object('ok', true, 'channel', 'sms');
  end if;
  return jsonb_build_object('ok', false, 'reason', 'unsupported channel');
end $$;
revoke all on function public.cc_delivery_worker_unsubscribe(uuid) from public, anon, authenticated;
grant execute on function public.cc_delivery_worker_unsubscribe(uuid) to service_role;

-- The carrier app's toggles: each flip is an event too.
create or replace function public.cc_pocket_save_preferences(p jsonb)
returns boolean language plpgsql security definer set search_path to 'app_private, public' as $$
declare v_old record; v_email text; m record;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into v_old from app_private.comm_preferences where user_id = auth.uid();
  insert into app_private.comm_preferences(user_id, marketing_email, product_announcements, load_offers, sms, push, weekly_summaries, unsubscribed_all, consent_source, updated_at)
  values (auth.uid(),
    coalesce((p->>'marketing_email')::boolean, true), coalesce((p->>'product_announcements')::boolean, true),
    coalesce((p->>'load_offers')::boolean, true), coalesce((p->>'sms')::boolean, false),
    coalesce((p->>'push')::boolean, true), coalesce((p->>'weekly_summaries')::boolean, true),
    coalesce((p->>'unsubscribed_all')::boolean, false), 'carrier_portal', now())
  on conflict (user_id) do update set
    marketing_email=excluded.marketing_email, product_announcements=excluded.product_announcements,
    load_offers=excluded.load_offers, sms=excluded.sms, push=excluded.push,
    weekly_summaries=excluded.weekly_summaries, unsubscribed_all=excluded.unsubscribed_all, updated_at=now();
  perform app_private.log_audit('consent.update','comm_preferences', auth.uid()::text, null, 'carrier updated preferences', p);

  select lower(btrim(email)) into v_email from public.profiles where id = auth.uid();
  if v_email is not null and v_email ~ '^[^@]+@[^@]+\.[^@]+$' then
    for m in
      select * from (values
        ('unsubscribed_all',      '*',                     coalesce((p->>'unsubscribed_all')::boolean,false),        coalesce(v_old.unsubscribed_all,false),        true),
        ('marketing_email',       'marketing',             coalesce((p->>'marketing_email')::boolean,true),          coalesce(v_old.marketing_email,true),          false),
        ('product_announcements', 'product_announcements', coalesce((p->>'product_announcements')::boolean,true),    coalesce(v_old.product_announcements,true),    false),
        ('weekly_summaries',      'digests',               coalesce((p->>'weekly_summaries')::boolean,true),         coalesce(v_old.weekly_summaries,true),         false),
        ('load_offers',           'load_ops',              coalesce((p->>'load_offers')::boolean,true),              coalesce(v_old.load_offers,true),              false)
      ) as t(pref, grp, new_val, old_val, inverted)
    loop
      -- inverted: unsubscribed_all=true means OFF; the others: false means OFF
      if m.new_val <> m.old_val then
        perform app_private.unsub_apply(v_email,
          case when (m.inverted and m.new_val) or (not m.inverted and not m.new_val) then 'unsubscribe' else 'resubscribe' end,
          case when m.grp = '*' then 'all' else 'group' end,
          case when m.grp = '*' then null else array[m.grp] end,
          null, null, 'app_prefs', null, null, auth.uid(), '{}'::jsonb);
      end if;
    end loop;
  end if;
  return true;
end $$;
revoke all on function public.cc_pocket_save_preferences(jsonb) from public, anon;
grant execute on function public.cc_pocket_save_preferences(jsonb) to authenticated;

-- ---------------------------------------------------------------- 7. the preference page (service_role, via the edge function)
-- Resolve a link: either the per-delivery uuid (p_token) or the legacy outreach pair (p_email + p_sig).
create or replace function app_private.unsub_link_resolve(p_token text, p_email text, p_sig text,
  out o_email text, out o_template text, out o_delivery uuid, out o_error text)
language plpgsql stable security definer set search_path to 'app_private, public' as $$
declare d record;
begin
  if p_token ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select recipient_email, template_key, id into d from app_private.message_deliveries where correlation_id = p_token::uuid and channel = 'email' limit 1;
    if d.id is null then o_error := 'unknown token'; return; end if;
    o_email := lower(btrim(d.recipient_email)); o_template := d.template_key; o_delivery := d.id; return;
  end if;
  if p_email is not null and p_sig is not null then
    o_email := lower(btrim(p_email));
    if o_email !~ '^[^@]+@[^@]+[.][^@]+$'
       or not exists (select 1 from app_private.outreach_state where id=1 and nullif(unsub_secret,'') is not null)
       or p_sig is distinct from app_private.outreach_unsub_token(o_email) then
      o_email := null; o_error := 'invalid link'; return;
    end if;
    o_template := 'outreach'; return;
  end if;
  o_error := 'invalid link';
end $$;
revoke all on function app_private.unsub_link_resolve(text,text,text) from public, anon, authenticated;

create or replace function public.unsub_link_get(p_token text default null, p_email text default null, p_sig text default null)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $$
declare r record; v_name text; v_group text; v_state jsonb; s record; v_tpl_name text;
begin
  select * into r from app_private.unsub_link_resolve(p_token, p_email, p_sig);
  if r.o_error is not null then return jsonb_build_object('ok', false, 'error', r.o_error); end if;
  select * into s from app_private.unsub_settings where id = 1;
  v_group := app_private.unsub_template_group(r.o_template);
  select c.name into v_tpl_name from app_private.email_catalog c where c.key = r.o_template;
  v_state := app_private.unsub_state(r.o_email);
  select coalesce(nullif(btrim(p.contact_name),''), nullif(btrim(p.company),'')) into v_name
    from public.profiles p where lower(btrim(p.email)) = r.o_email order by p.created_at nulls last limit 1;
  return jsonb_build_object(
    'ok', true, 'email', r.o_email, 'name', v_name,
    'origin', jsonb_build_object('template', r.o_template, 'name', coalesce(v_tpl_name, case when r.o_template = 'outreach' then 'a LoadBoot outreach email' end),
                                 'group', v_group, 'group_label', app_private.unsub_group_label(coalesce(v_group,'marketing'))),
    'state', v_state,
    'reasons', (select coalesce(jsonb_agg(jsonb_build_object('code', code, 'label', label) order by sort), '[]'::jsonb) from app_private.unsub_reasons where active),
    'settings', jsonb_build_object('offer_all', s.page_offer_all, 'ask_reason', s.ask_reason, 'resubscribe', s.resubscribe_via_link));
end $$;
revoke all on function public.unsub_link_get(text,text,text) from public, anon, authenticated;
grant execute on function public.unsub_link_get(text,text,text) to service_role;

create or replace function public.unsub_link_apply(p_token text, p_email text, p_sig text,
  p_action text, p_scope text, p_groups text[], p_reason_code text, p_reason_text text, p_source text, p_meta jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare r record; s record; v_scope text := p_scope; v_groups text[] := p_groups; v_group text; v_out jsonb;
begin
  select * into r from app_private.unsub_link_resolve(p_token, p_email, p_sig);
  if r.o_error is not null then return jsonb_build_object('ok', false, 'error', r.o_error); end if;
  select * into s from app_private.unsub_settings where id = 1;
  if p_source not in ('one_click','preference_page') then return jsonb_build_object('ok', false, 'error', 'invalid source'); end if;
  if p_action = 'resubscribe' and not coalesce(s.resubscribe_via_link, true) then
    return jsonb_build_object('ok', false, 'error', 'resubscribing through the link is switched off');
  end if;
  -- A one-click, or a bare link click (scope group, no groups named), means: the category this email
  -- belonged to — or whatever the CC one-click setting says.
  if p_source = 'one_click' or (p_action = 'unsubscribe' and coalesce(v_scope,'group') = 'group' and v_groups is null) then
    v_scope := coalesce(s.one_click_scope, 'group');
    v_group := app_private.unsub_template_group(r.o_template);
    if v_scope = 'group' then
      if exists (select 1 from app_private.email_pref_groups g where g.code = v_group and g.opt_out_allowed) then v_groups := array[v_group];
      else v_scope := 'marketing'; end if;
    end if;
  end if;
  v_out := app_private.unsub_apply(r.o_email, p_action, v_scope, v_groups, p_reason_code, left(p_reason_text, 500), p_source,
             r.o_template, r.o_delivery, null, coalesce(p_meta, '{}'::jsonb));
  return v_out;
end $$;
revoke all on function public.unsub_link_apply(text,text,text,text,text,text[],text,text,text,jsonb) from public, anon, authenticated;
grant execute on function public.unsub_link_apply(text,text,text,text,text,text[],text,text,text,jsonb) to service_role;

-- ---------------------------------------------------------------- 8. Command Center
create or replace function app_private.unsub_can_view()
returns boolean language sql stable security definer set search_path to 'app_private, public' as $$
  select public.has_global_permission('comm.view') or public.has_global_permission('comm.manage')
      or public.has_global_permission('content.view') or public.has_global_permission('content.manage')
      or public.has_global_permission('settings.manage');
$$;
revoke all on function app_private.unsub_can_view() from public, anon, authenticated;

-- "May I send this?" — ask BEFORE any hand send. Verdict + the person's whole picture.
create or replace function public.cc_email_can_send(p_to text, p_key text default null)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $$
declare v_email text := lower(btrim(p_to)); v_gate jsonb; v_state jsonb;
begin
  if not app_private.unsub_can_view() then raise exception 'not authorized' using errcode = '42501'; end if;
  v_state := app_private.unsub_state(v_email);
  if p_key is not null then v_gate := app_private.email_gate(p_key, v_email, null); end if;
  return jsonb_build_object(
    'email', v_email, 'key', p_key,
    'allowed', case when p_key is null then not (coalesce((v_state->>'hard_suppressed')::boolean,false)) else (v_gate->>'allowed')::boolean end,
    'code', coalesce(v_gate->>'code', case when coalesce((v_state->>'hard_suppressed')::boolean,false) then 'suppressed' else 'ok' end),
    'reason', coalesce(v_gate->>'reason', case when coalesce((v_state->>'hard_suppressed')::boolean,false)
                 then 'Address is on the suppression list (' || (v_state->>'hard_reason') || ').'
                 else 'No template key given: only the hard suppression list was checked. Pass the catalog key for the full answer.' end),
    'group', v_gate->>'group', 'group_label', v_gate->>'group_label', 'essential', coalesce((v_gate->>'essential')::boolean, false),
    'state', v_state,
    'blocked_groups', (select coalesce(jsonb_agg(g->>'label'), '[]'::jsonb) from jsonb_array_elements(v_state->'groups') g where (g->>'opted_out')::boolean),
    'recent_events', (select coalesce(jsonb_agg(jsonb_build_object('at', e.at, 'action', e.action, 'scope', e.scope, 'groups', e.groups,
                         'source', e.source, 'source_label', app_private.unsub_source_label(e.source), 'reason_code', e.reason_code, 'reason_text', e.reason_text,
                         'origin_template', e.origin_template) order by e.at desc), '[]'::jsonb)
                        from (select * from app_private.unsub_events where lower(email) = v_email order by at desc limit 10) e),
    'recent_blocks', (select coalesce(jsonb_agg(jsonb_build_object('at', b.created_at, 'key', b.template_key, 'reason', b.reason, 'code', b.code) order by b.created_at desc), '[]'::jsonb)
                        from (select * from app_private.email_blocked_log where lower(recipient_email) = v_email order by created_at desc limit 10) b));
end $$;
revoke all on function public.cc_email_can_send(text,text) from public, anon;
grant execute on function public.cc_email_can_send(text,text) to authenticated, service_role;

create or replace function public.cc_unsub_overview(p_days integer default 30)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $$
declare v_days integer := least(greatest(coalesce(p_days,30),1),365); v_from timestamptz := now() - (least(greatest(coalesce(p_days,30),1),365) || ' days')::interval;
begin
  if not app_private.unsub_can_view() then raise exception 'not authorized' using errcode = '42501'; end if;
  return jsonb_build_object(
    'days', v_days,
    'kpis', jsonb_build_object(
      'unsubs_7d',  (select count(*) from app_private.unsub_events where action='unsubscribe' and at >= now() - interval '7 days'),
      'unsubs_period', (select count(*) from app_private.unsub_events where action='unsubscribe' and at >= v_from),
      'resubs_period', (select count(*) from app_private.unsub_events where action='resubscribe' and at >= v_from),
      'addresses_out', (select count(distinct email) from app_private.unsub_prefs where opted_out),
      'all_off', (select count(*) from app_private.unsub_prefs where opted_out and group_code='*'),
      'marketing_off', (select count(distinct email) from app_private.unsub_prefs where opted_out and group_code in ('*','marketing')),
      'hard_suppressed', (select count(*) from app_private.suppressions where channel='email' and reason is distinct from 'unsubscribed'),
      'blocked_period', (select count(*) from app_private.email_blocked_log where created_at >= v_from),
      'blocked_unsub_period', (select count(*) from app_private.email_blocked_log where created_at >= v_from and code like 'unsubscribed%'),
      'sent_period', (select count(*) from app_private.message_deliveries where channel='email' and status in ('sent','delivered','opened','clicked') and coalesce(sent_at, created_at) >= v_from)),
    'by_source', (select coalesce(jsonb_agg(jsonb_build_object('source', source, 'label', app_private.unsub_source_label(source), 'n', n) order by n desc), '[]'::jsonb)
                    from (select source, count(*) n from app_private.unsub_events where action='unsubscribe' and at >= v_from group by 1) x),
    'by_group', (select coalesce(jsonb_agg(jsonb_build_object('group', g, 'label', app_private.unsub_group_label(g), 'n', n) order by n desc), '[]'::jsonb)
                   from (select g, count(*) n from app_private.unsub_events e, unnest(e.groups) g where e.action='unsubscribe' and e.at >= v_from group by 1) x),
    'by_reason', (select coalesce(jsonb_agg(jsonb_build_object('reason', coalesce(reason_code,'(none given)'), 'label', coalesce((select label from app_private.unsub_reasons r where r.code = x.reason_code), '(no reason given)'), 'n', n) order by n desc), '[]'::jsonb)
                    from (select reason_code, count(*) n from app_private.unsub_events where action='unsubscribe' and at >= v_from group by 1) x),
    'by_template', (select coalesce(jsonb_agg(jsonb_build_object('template', origin_template, 'name', (select name from app_private.email_catalog c where c.key = x.origin_template), 'n', n) order by n desc), '[]'::jsonb)
                      from (select origin_template, count(*) n from app_private.unsub_events where action='unsubscribe' and at >= v_from and origin_template is not null group by 1 order by 2 desc limit 12) x),
    'by_day', (select coalesce(jsonb_agg(jsonb_build_object('d', d, 'unsub', u, 'resub', r) order by d), '[]'::jsonb)
                 from (select date_trunc('day', at)::date d,
                              count(*) filter (where action='unsubscribe') u, count(*) filter (where action='resubscribe') r
                         from app_private.unsub_events where at >= v_from group by 1) x),
    'settings', (select to_jsonb(s) - 'id' from app_private.unsub_settings s where id = 1),
    'reasons', (select coalesce(jsonb_agg(to_jsonb(r) order by sort), '[]'::jsonb) from app_private.unsub_reasons r));
end $$;
revoke all on function public.cc_unsub_overview(integer) from public, anon;
grant execute on function public.cc_unsub_overview(integer) to authenticated;

create or replace function public.cc_unsub_events(p_q text default null, p_group text default null, p_source text default null,
  p_reason text default null, p_action text default null, p_from date default null, p_to date default null,
  p_limit integer default 100, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $$
declare v_lim integer := least(greatest(coalesce(p_limit,100),1),2000); v_off integer := greatest(coalesce(p_offset,0),0); v_q text := nullif(lower(btrim(p_q)),'');
begin
  if not app_private.unsub_can_view() then raise exception 'not authorized' using errcode = '42501'; end if;
  return (
    with f as (
      select e.*, pr.contact_name, pr.company, pr.role as profile_role, o.name as org_name
        from app_private.unsub_events e
        left join public.profiles pr on pr.id = e.user_id
        left join public.organizations o on o.id = e.org_id
       where (v_q is null or lower(e.email) like '%'||v_q||'%' or lower(coalesce(pr.company,'')) like '%'||v_q||'%' or lower(coalesce(pr.contact_name,'')) like '%'||v_q||'%' or lower(coalesce(o.name,'')) like '%'||v_q||'%')
         and (p_group is null or p_group = any(e.groups))
         and (p_source is null or e.source = p_source)
         and (p_reason is null or coalesce(e.reason_code,'') = p_reason)
         and (p_action is null or e.action = p_action)
         and (p_from is null or e.at >= p_from)
         and (p_to is null or e.at < p_to + 1))
    select jsonb_build_object(
      'total', (select count(*) from f),
      'rows', (select coalesce(jsonb_agg(jsonb_build_object(
                 'id', f.id, 'at', f.at, 'email', f.email, 'user_id', f.user_id, 'org_id', f.org_id, 'org_name', f.org_name,
                 'name', coalesce(f.contact_name, f.company), 'role', f.profile_role,
                 'is_user', f.user_id is not null,
                 'action', f.action, 'scope', f.scope, 'groups', f.groups,
                 'group_labels', (select array_agg(app_private.unsub_group_label(g)) from unnest(f.groups) g),
                 'reason_code', f.reason_code, 'reason_label', (select label from app_private.unsub_reasons r where r.code = f.reason_code), 'reason_text', f.reason_text,
                 'source', f.source, 'source_label', app_private.unsub_source_label(f.source),
                 'origin_template', f.origin_template, 'origin_name', (select name from app_private.email_catalog c where c.key = f.origin_template),
                 'origin_delivery', f.origin_delivery, 'origin_campaign', f.origin_campaign,
                 'actor', f.actor, 'actor_name', (select coalesce(contact_name, email) from public.profiles where id = f.actor),
                 'ip', f.ip, 'user_agent', f.user_agent, 'meta', f.meta) order by f.at desc), '[]'::jsonb)
               from (select * from f order by at desc limit v_lim offset v_off) f)));
end $$;
revoke all on function public.cc_unsub_events(text,text,text,text,text,date,date,integer,integer) from public, anon;
grant execute on function public.cc_unsub_events(text,text,text,text,text,date,date,integer,integer) to authenticated;

create or replace function public.cc_unsub_addresses(p_q text default null, p_group text default null, p_limit integer default 100, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $$
declare v_lim integer := least(greatest(coalesce(p_limit,100),1),2000); v_off integer := greatest(coalesce(p_offset,0),0); v_q text := nullif(lower(btrim(p_q)),'');
begin
  if not app_private.unsub_can_view() then raise exception 'not authorized' using errcode = '42501'; end if;
  return (
    with a as (
      select p.email, max(p.updated_at) last_at, array_agg(p.group_code order by p.group_code) groups,
             bool_or(p.group_code = '*') all_off, max(p.user_id::text)::uuid user_id
        from app_private.unsub_prefs p
       where p.opted_out and (v_q is null or p.email like '%'||v_q||'%') and (p_group is null or p.group_code = p_group)
       group by p.email)
    select jsonb_build_object(
      'total', (select count(*) from a),
      'rows', (select coalesce(jsonb_agg(jsonb_build_object(
                 'email', a.email, 'last_at', a.last_at, 'groups', a.groups,
                 'group_labels', (select array_agg(app_private.unsub_group_label(g)) from unnest(a.groups) g),
                 'all_off', a.all_off, 'user_id', a.user_id, 'is_user', a.user_id is not null,
                 'name', (select coalesce(contact_name, company) from public.profiles where id = a.user_id),
                 'hard', (select reason from app_private.suppressions s where s.channel='email' and lower(btrim(s.address)) = a.email and s.reason is distinct from 'unsubscribed' limit 1),
                 'blocked_30d', (select count(*) from app_private.email_blocked_log b where lower(b.recipient_email) = a.email and b.created_at >= now() - interval '30 days'),
                 'events', (select count(*) from app_private.unsub_events e where lower(e.email) = a.email)) order by a.last_at desc), '[]'::jsonb)
               from (select * from a order by last_at desc limit v_lim offset v_off) a)));
end $$;
revoke all on function public.cc_unsub_addresses(text,text,integer,integer) from public, anon;
grant execute on function public.cc_unsub_addresses(text,text,integer,integer) to authenticated;

-- One person, the whole picture.
create or replace function public.cc_unsub_person(p_email text)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $$
declare v_email text := lower(btrim(p_email)); v_user uuid; v_org uuid;
begin
  if not app_private.unsub_can_view() then raise exception 'not authorized' using errcode = '42501'; end if;
  select e.user_id, e.org_id into v_user, v_org from app_private.email_identify(v_email) e;
  return jsonb_build_object(
    'email', v_email,
    'identity', (select jsonb_build_object('user_id', v_user, 'org_id', v_org, 'name', coalesce(pr.contact_name, pr.company), 'company', pr.company,
                   'role', pr.role, 'org_name', o.name, 'org_kind', o.kind, 'is_demo', o.is_demo, 'status', pr.status)
                   from (select 1) x left join public.profiles pr on pr.id = v_user left join public.organizations o on o.id = v_org),
    'outreach', (select jsonb_build_object('status', oc.status, 'kind', oc.kind, 'company', oc.company, 'emails_sent', oc.emails_sent, 'last_sent_at', oc.last_sent_at, 'replied_at', oc.replied_at, 'converted_at', oc.converted_at)
                   from app_private.outreach_contacts oc where lower(btrim(oc.email)) = v_email order by oc.created_at desc limit 1),
    'state', app_private.unsub_state(v_email),
    'suppressions', (select coalesce(jsonb_agg(jsonb_build_object('channel', s.channel, 'reason', s.reason, 'since', s.created_at) order by s.created_at), '[]'::jsonb)
                       from app_private.suppressions s where lower(btrim(s.address)) = v_email),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'at', e.at, 'action', e.action, 'scope', e.scope, 'groups', e.groups,
                 'group_labels', (select array_agg(app_private.unsub_group_label(g)) from unnest(e.groups) g),
                 'reason_code', e.reason_code, 'reason_label', (select label from app_private.unsub_reasons r where r.code = e.reason_code), 'reason_text', e.reason_text,
                 'source', e.source, 'source_label', app_private.unsub_source_label(e.source),
                 'origin_template', e.origin_template, 'origin_name', (select name from app_private.email_catalog c where c.key = e.origin_template),
                 'actor_name', (select coalesce(contact_name, email) from public.profiles where id = e.actor), 'ip', e.ip, 'user_agent', e.user_agent, 'meta', e.meta) order by e.at desc), '[]'::jsonb)
                 from app_private.unsub_events e where lower(e.email) = v_email),
    'blocked', (select coalesce(jsonb_agg(jsonb_build_object('at', b.created_at, 'key', b.template_key, 'name', (select name from app_private.email_catalog c where c.key = b.template_key), 'group', b.group_code, 'reason', b.reason, 'code', b.code) order by b.created_at desc), '[]'::jsonb)
                  from (select * from app_private.email_blocked_log where lower(recipient_email) = v_email order by created_at desc limit 50) b),
    'deliveries', (select coalesce(jsonb_agg(jsonb_build_object('at', coalesce(d.sent_at, d.created_at), 'key', d.template_key, 'name', (select name from app_private.email_catalog c where c.key = d.template_key), 'status', d.status, 'source', d.source, 'reason', d.failure_reason, 'group', d.meta->>'preference_group') order by coalesce(d.sent_at, d.created_at) desc), '[]'::jsonb)
                     from (select * from app_private.message_deliveries where channel='email' and lower(btrim(recipient_email)) = v_email order by coalesce(sent_at, created_at) desc limit 30) d),
    'sms', (select jsonb_build_object('opted_out_at', max(o.at), 'keyword', max(o.keyword))
              from app_private.dialer_sms_optout o, public.profiles p
             where p.id = v_user and length(regexp_replace(coalesce(p.phone,''),'[^0-9]','','g')) >= 10
               and right(regexp_replace(o.number,'[^0-9]','','g'),10) = right(regexp_replace(p.phone,'[^0-9]','','g'),10)));
end $$;
revoke all on function public.cc_unsub_person(text) from public, anon;
grant execute on function public.cc_unsub_person(text) to authenticated;

-- Staff action: unsubscribe / resubscribe on the person's behalf (recorded with who did it and why).
create or replace function public.cc_unsub_set(p_email text, p_action text, p_scope text default 'group', p_groups text[] default null,
  p_reason_code text default null, p_reason_text text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_action = 'resubscribe' and nullif(btrim(p_note),'') is null then
    return jsonb_build_object('ok', false, 'error', 'A resubscribe needs a note: where the consent came from (their reply, a call, a form).');
  end if;
  return app_private.unsub_apply(p_email, p_action, p_scope, p_groups, p_reason_code, p_reason_text, 'cc_manual', null, null, auth.uid(),
           jsonb_build_object('note', nullif(btrim(p_note),'')));
end $$;
revoke all on function public.cc_unsub_set(text,text,text,text[],text,text,text) from public, anon;
grant execute on function public.cc_unsub_set(text,text,text,text[],text,text,text) to authenticated;

create or replace function public.cc_unsub_settings_set(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode = '42501'; end if;
  update app_private.unsub_settings set
    one_click_scope      = coalesce(p->>'one_click_scope', one_click_scope),
    reply_scope          = coalesce(p->>'reply_scope', reply_scope),
    legacy_link_scope    = coalesce(p->>'legacy_link_scope', legacy_link_scope),
    page_offer_all       = coalesce((p->>'page_offer_all')::boolean, page_offer_all),
    ask_reason           = coalesce((p->>'ask_reason')::boolean, ask_reason),
    resubscribe_via_link = coalesce((p->>'resubscribe_via_link')::boolean, resubscribe_via_link),
    updated_by = auth.uid(), updated_at = now()
  where id = 1;
  perform app_private.log_audit('comm.unsub_settings', 'unsub_settings', '1', null, 'unsubscribe engine settings changed', p);
  return (select to_jsonb(s) - 'id' from app_private.unsub_settings s where id = 1);
end $$;
revoke all on function public.cc_unsub_settings_set(jsonb) from public, anon;
grant execute on function public.cc_unsub_settings_set(jsonb) to authenticated;

create or replace function public.cc_unsub_reason_set(p_code text, p_label text, p_sort integer default null, p_active boolean default null)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare v_code text := lower(regexp_replace(btrim(p_code), '[^a-zA-Z0-9]+', '_', 'g'));
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode = '42501'; end if;
  if v_code = '' or nullif(btrim(p_label),'') is null then return jsonb_build_object('ok', false, 'error', 'code and label are required'); end if;
  insert into app_private.unsub_reasons(code, label, sort, active) values (v_code, btrim(p_label), coalesce(p_sort, 100), coalesce(p_active, true))
  on conflict (code) do update set label = excluded.label, sort = coalesce(p_sort, app_private.unsub_reasons.sort), active = coalesce(p_active, app_private.unsub_reasons.active);
  return (select coalesce(jsonb_agg(to_jsonb(r) order by sort), '[]'::jsonb) from app_private.unsub_reasons r);
end $$;
revoke all on function public.cc_unsub_reason_set(text,text,integer,boolean) from public, anon;
grant execute on function public.cc_unsub_reason_set(text,text,integer,boolean) to authenticated;

-- Blocked sends, engine-wide (what the gate refused and why), for the CC screen.
create or replace function public.cc_unsub_blocked(p_q text default null, p_limit integer default 100, p_offset integer default 0)
returns jsonb language plpgsql stable security definer set search_path to 'app_private, public' as $$
declare v_lim integer := least(greatest(coalesce(p_limit,100),1),1000); v_off integer := greatest(coalesce(p_offset,0),0); v_q text := nullif(lower(btrim(p_q)),'');
begin
  if not app_private.unsub_can_view() then raise exception 'not authorized' using errcode = '42501'; end if;
  return (
    with f as (select * from app_private.email_blocked_log b where v_q is null or lower(b.recipient_email) like '%'||v_q||'%' or lower(b.template_key) like '%'||v_q||'%')
    select jsonb_build_object(
      'total', (select count(*) from f),
      'rows', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'at', f.created_at, 'email', f.recipient_email, 'key', f.template_key,
                 'name', (select name from app_private.email_catalog c where c.key = f.template_key), 'group', f.group_code,
                 'group_label', app_private.unsub_group_label(coalesce(f.group_code,'')), 'reason', f.reason, 'code', f.code) order by f.created_at desc), '[]'::jsonb)
               from (select * from f order by created_at desc limit v_lim offset v_off) f)));
end $$;
revoke all on function public.cc_unsub_blocked(text,integer,integer) from public, anon;
grant execute on function public.cc_unsub_blocked(text,integer,integer) to authenticated;

-- ---------------------------------------------------------------- 9. backfill: the ledger starts complete
do $bf$
declare r record; v_ev bigint; v_email text;
begin
  -- a. soft 'unsubscribed' suppressions → marketing off
  for r in select lower(btrim(address)) email, created_at from app_private.suppressions where channel='email' and reason='unsubscribed' loop
    if exists (select 1 from app_private.unsub_prefs where email = r.email and group_code = 'marketing') then continue; end if;
    insert into app_private.unsub_events(at, email, user_id, org_id, action, scope, groups, source, meta)
    select r.created_at, r.email, e.user_id, e.org_id, 'unsubscribe', 'marketing', array['marketing'], 'backfill', jsonb_build_object('from', 'suppressions')
      from app_private.email_identify(r.email) e returning id into v_ev;
    insert into app_private.unsub_prefs(email, group_code, opted_out, source, last_event_id, updated_at, user_id)
    values (r.email, 'marketing', true, 'backfill', v_ev, r.created_at, (select user_id from app_private.email_identify(r.email)))
    on conflict do nothing;
  end loop;
  -- b. outreach contacts already unsubscribed but never suppressed
  for r in select lower(btrim(oc.email)) email, coalesce(oc.last_sent_at, oc.created_at) at from app_private.outreach_contacts oc
            where oc.status = 'unsubscribed' and not exists (select 1 from app_private.unsub_prefs p where p.email = lower(btrim(oc.email)) and p.group_code = 'marketing') loop
    insert into app_private.unsub_events(at, email, action, scope, groups, source, meta)
    values (r.at, r.email, 'unsubscribe', 'marketing', array['marketing'], 'backfill', jsonb_build_object('from', 'outreach_contacts')) returning id into v_ev;
    insert into app_private.unsub_prefs(email, group_code, opted_out, source, last_event_id, updated_at) values (r.email, 'marketing', true, 'backfill', v_ev, r.at) on conflict do nothing;
  end loop;
  -- c. per-user group opt-outs
  for r in select o.user_id, o.group_code, o.updated_at, lower(btrim(p.email)) email from app_private.email_pref_optouts o join public.profiles p on p.id = o.user_id
            where o.opted_out and nullif(btrim(p.email),'') is not null loop
    if exists (select 1 from app_private.unsub_prefs where email = r.email and group_code = r.group_code) then continue; end if;
    insert into app_private.unsub_events(at, email, user_id, action, scope, groups, source, meta)
    values (coalesce(r.updated_at, now()), r.email, r.user_id, 'unsubscribe', 'group', array[r.group_code], 'backfill', jsonb_build_object('from', 'email_pref_optouts')) returning id into v_ev;
    insert into app_private.unsub_prefs(email, group_code, opted_out, source, last_event_id, updated_at, user_id) values (r.email, r.group_code, true, 'backfill', v_ev, coalesce(r.updated_at, now()), r.user_id) on conflict do nothing;
  end loop;
  -- d. the carrier app toggles
  for r in select c.*, lower(btrim(p.email)) email from app_private.comm_preferences c join public.profiles p on p.id = c.user_id
            where nullif(btrim(p.email),'') is not null
              and (coalesce(c.unsubscribed_all,false) or c.marketing_email is false or c.product_announcements is false or c.weekly_summaries is false or c.load_offers is false) loop
    if coalesce(r.unsubscribed_all,false) and not exists (select 1 from app_private.unsub_prefs where email = r.email and group_code = '*') then
      insert into app_private.unsub_events(at, email, user_id, action, scope, groups, source, meta)
      values (coalesce(r.updated_at, now()), r.email, r.user_id, 'unsubscribe', 'all', array['*'], 'backfill', jsonb_build_object('from', 'comm_preferences')) returning id into v_ev;
      insert into app_private.unsub_prefs(email, group_code, opted_out, source, last_event_id, updated_at, user_id) values (r.email, '*', true, 'backfill', v_ev, coalesce(r.updated_at, now()), r.user_id) on conflict do nothing;
    end if;
    for v_email in select g from unnest(array[
        case when r.marketing_email is false then 'marketing' end,
        case when r.product_announcements is false then 'product_announcements' end,
        case when r.weekly_summaries is false then 'digests' end,
        case when r.load_offers is false then 'load_ops' end]) g where g is not null loop
      if exists (select 1 from app_private.unsub_prefs where email = r.email and group_code = v_email) then continue; end if;
      insert into app_private.unsub_events(at, email, user_id, action, scope, groups, source, meta)
      values (coalesce(r.updated_at, now()), r.email, r.user_id, 'unsubscribe', 'group', array[v_email], 'backfill', jsonb_build_object('from', 'comm_preferences')) returning id into v_ev;
      insert into app_private.unsub_prefs(email, group_code, opted_out, source, last_event_id, updated_at, user_id) values (r.email, v_email, true, 'backfill', v_ev, coalesce(r.updated_at, now()), r.user_id) on conflict do nothing;
    end loop;
  end loop;
end
$bf$;

-- ---------------------------------------------------------------- 10. catalog rows for the two emails this feature can send (none yet: the
-- preference page is a web page, not an email). Nothing to register in email_catalog.

-- ---------------------------------------------------------------- 11. the page's "tell us why" (attaches to what just happened)
create or replace function public.unsub_link_reason(p_token text, p_email text, p_sig text, p_reason_code text, p_reason_text text)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare r record; v_ev bigint; v_code text := p_reason_code; v_text text := left(nullif(btrim(p_reason_text),''), 500);
begin
  select * into r from app_private.unsub_link_resolve(p_token, p_email, p_sig);
  if r.o_error is not null then return jsonb_build_object('ok', false, 'error', r.o_error); end if;
  if v_code is not null and not exists (select 1 from app_private.unsub_reasons where code = v_code) then
    v_text := coalesce(v_text, v_code); v_code := null;
  end if;
  if v_code is null and v_text is null then return jsonb_build_object('ok', false, 'error', 'nothing to record'); end if;
  select id into v_ev from app_private.unsub_events
   where email = r.o_email and action = 'unsubscribe' and source in ('preference_page','one_click','legacy_link')
   order by at desc limit 1;   -- the latest unsubscribe from a link, whatever its age (a re-open no longer writes a new one)
  if v_ev is null then return jsonb_build_object('ok', false, 'error', 'no recent unsubscribe to attach this to'); end if;
  update app_private.unsub_events set reason_code = v_code, reason_text = v_text where id = v_ev;
  update app_private.unsub_prefs set reason_code = v_code, reason_text = v_text where email = r.o_email and last_event_id = v_ev;
  return jsonb_build_object('ok', true, 'event_id', v_ev);
end $$;
revoke all on function public.unsub_link_reason(text,text,text,text,text) from public, anon, authenticated;
grant execute on function public.unsub_link_reason(text,text,text,text,text) to service_role;

-- ---------------------------------------------------------------- 12. "Fewer emails" (frequency caps) — 26 Sep 2026
-- Owner's choice after the staging test: instead of losing a subscriber, let the person say "at most
-- one a week / one a month" for a category. Sender code is untouched: the gate counts what this
-- address actually received in that category and holds the next one back until the window passes,
-- with the sentence ("… chose at most one Summaries email every 30 days; the last went on …").
-- Offered for the groups in unsub_settings.frequency_groups (default: digests, product news, marketing).
-- Operational groups (loads, compliance, billing) never get a cap: capping a POD notice breaks work.
alter table app_private.unsub_prefs add column if not exists max_per_days integer;
do $c$ begin
  alter table app_private.unsub_prefs drop constraint if exists unsub_prefs_max_per_days_check;
  alter table app_private.unsub_prefs add constraint unsub_prefs_max_per_days_check check (max_per_days is null or max_per_days in (7, 30));
  alter table app_private.unsub_events drop constraint if exists unsub_events_action_check;
  alter table app_private.unsub_events add constraint unsub_events_action_check check (action in ('unsubscribe','resubscribe','frequency'));
end $c$;
alter table app_private.unsub_settings add column if not exists frequency_groups text[] not null default '{digests,product_announcements,marketing}';

create or replace function app_private.unsub_set_frequency(p_email text, p_group text, p_days integer, p_source text,
  p_actor uuid default null, p_meta jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare v_email text := lower(btrim(p_email)); v_user uuid; v_org uuid; v_ev bigint; v_off boolean; v_label text;
begin
  if v_email is null or v_email !~ '^[^@]+@[^@]+\.[^@]+$' then return jsonb_build_object('ok', false, 'error', 'invalid email'); end if;
  if p_days is not null and p_days not in (7, 30) then return jsonb_build_object('ok', false, 'error', 'choose every email, one a week, or one a month'); end if;
  if not exists (select 1 from app_private.unsub_settings s where s.id = 1 and p_group = any(s.frequency_groups))
     or not exists (select 1 from app_private.email_pref_groups g where g.code = p_group and g.opt_out_allowed) then
    return jsonb_build_object('ok', false, 'error', 'this category cannot be set to fewer emails');
  end if;
  select label into v_label from app_private.email_pref_groups where code = p_group;
  select e.user_id, e.org_id into v_user, v_org from app_private.email_identify(v_email) e;

  -- choosing "fewer" for a category that is off means: turn it back on, at that pace
  select coalesce((g->>'opted_out')::boolean, false) into v_off
    from jsonb_array_elements(app_private.unsub_state(v_email)->'groups') g where g->>'code' = p_group;
  if coalesce(v_off, false) and p_days is not null then
    perform app_private.unsub_apply(v_email, 'resubscribe', 'group', array[p_group], null, null, p_source, null, null, p_actor, coalesce(p_meta,'{}'::jsonb) || jsonb_build_object('via', 'fewer_emails'));
  end if;

  insert into app_private.unsub_events(email, user_id, org_id, channel, action, scope, groups, source, ip, user_agent, actor, meta)
  values (v_email, v_user, v_org, 'email', 'frequency', 'group', array[p_group], p_source,
          nullif(p_meta->>'ip',''), left(nullif(p_meta->>'user_agent',''), 300), p_actor,
          (coalesce(p_meta,'{}'::jsonb) - 'ip' - 'user_agent') || jsonb_build_object('max_per_days', p_days))
  returning id into v_ev;

  insert into app_private.unsub_prefs(email, group_code, opted_out, source, user_id, last_event_id, max_per_days, updated_at)
  values (v_email, p_group, false, p_source, v_user, v_ev, p_days, now())
  on conflict (email, group_code) do update set max_per_days = excluded.max_per_days, source = excluded.source,
      user_id = coalesce(excluded.user_id, app_private.unsub_prefs.user_id), last_event_id = excluded.last_event_id, updated_at = now();

  perform app_private.log_audit('comm.frequency', 'email', v_email, v_org,
    v_email || ' set ' || coalesce(v_label, p_group) || ' to ' || case p_days when 7 then 'at most one a week' when 30 then 'at most one a month' else 'every email' end
      || ' via ' || app_private.unsub_source_label(p_source),
    jsonb_build_object('event_id', v_ev, 'group', p_group, 'max_per_days', p_days, 'actor', p_actor));
  return jsonb_build_object('ok', true, 'event_id', v_ev, 'email', v_email, 'group', p_group, 'max_per_days', p_days, 'state', app_private.unsub_state(v_email));
end $$;
revoke all on function app_private.unsub_set_frequency(text,text,integer,text,uuid,jsonb) from public, anon, authenticated;

-- state: carry the cap and whether the category offers one
do $m$
declare src text; out_src text;
begin
  src := pg_get_functiondef('app_private.unsub_state(text)'::regprocedure);
  out_src := replace(src,
    $a$'origin_template', p.origin_template, 'since', p.updated_at) order by g.sort), '[]'::jsonb)$a$,
    $b$'origin_template', p.origin_template, 'since', p.updated_at,
               'max_per_days', case when coalesce(p.opted_out, false) then null else p.max_per_days end,
               'frequency_allowed', g.opt_out_allowed and g.code = any(coalesce((select s.frequency_groups from app_private.unsub_settings s where s.id = 1), '{}'))) order by g.sort), '[]'::jsonb)$b$);
  if out_src = src then raise exception 'bl_comm_0446 §12: unsub_state anchor not found'; end if;
  execute out_src;

  -- gate: the cap is checked after every opt-out rule, right before "allowed"
  src := pg_get_functiondef('app_private.email_gate(text,text,uuid)'::regprocedure);
  out_src := replace(src,
    $a$  return jsonb_build_object('allowed', true, 'code', 'ok', 'group', v_group,$a$,
    $b$  if v_group is not null then
    select p.max_per_days into r from app_private.unsub_prefs p
     where p.email = v_email and p.group_code = v_group and not p.opted_out and p.max_per_days is not null;
    if found and r.max_per_days is not null then
      select max(coalesce(d.sent_at, d.created_at)) as last_at into v_ev
        from app_private.message_deliveries d
       where d.channel = 'email' and lower(btrim(d.recipient_email)) = v_email
         and d.status in ('sent','delivered','opened','clicked')
         and (d.meta->>'preference_group' = v_group
              or (v_group = 'marketing' and (coalesce(d.template_key ~* '^outreach[._-]', false) or d.source = 'campaign')))
         and coalesce(d.sent_at, d.created_at) > now() - make_interval(days => r.max_per_days);
      if v_ev.last_at is not null then
        return jsonb_build_object('allowed', false, 'code', 'frequency_cap', 'group', v_group, 'group_label', v_label,
          'reason', v_email || ' chose at most one ' || coalesce(v_label, v_group) || ' email every ' || r.max_per_days || ' days. The last one went on '
            || to_char(v_ev.last_at, 'DD Mon YYYY') || ', so this one is held back until ' || to_char(v_ev.last_at + make_interval(days => r.max_per_days), 'DD Mon YYYY') || '.');
      end if;
    end if;
  end if;

  return jsonb_build_object('allowed', true, 'code', 'ok', 'group', v_group,$b$);
  if out_src = src then raise exception 'bl_comm_0446 §12: email_gate anchor not found'; end if;
  execute out_src;

  -- overview: how many chose "fewer"
  src := pg_get_functiondef('public.cc_unsub_overview(integer)'::regprocedure);
  out_src := replace(src,
    $a$'all_off', (select count(*) from app_private.unsub_prefs where opted_out and group_code='*'),$a$,
    $b$'all_off', (select count(*) from app_private.unsub_prefs where opted_out and group_code='*'),
      'fewer', (select count(distinct email) from app_private.unsub_prefs where not opted_out and max_per_days is not null),
      'fewer_period', (select count(*) from app_private.unsub_events where action='frequency' and at >= v_from),$b$);
  if out_src = src then raise exception 'bl_comm_0446 §12: cc_unsub_overview anchor not found'; end if;
  execute out_src;

  -- the preference page: action 'frequency', days in p_meta.max_per_days
  src := pg_get_functiondef('public.unsub_link_apply(text,text,text,text,text,text[],text,text,text,jsonb)'::regprocedure);
  out_src := replace(src,
    $a$  if p_action = 'resubscribe' and not coalesce(s.resubscribe_via_link, true) then$a$,
    $b$  if p_action = 'frequency' then
    return app_private.unsub_set_frequency(r.o_email, p_groups[1], nullif(p_meta->>'max_per_days','')::integer, 'preference_page', null,
             (coalesce(p_meta, '{}'::jsonb) - 'max_per_days') || jsonb_build_object('origin_template', r.o_template));
  end if;
  if p_action = 'resubscribe' and not coalesce(s.resubscribe_via_link, true) then$b$);
  if out_src = src then raise exception 'bl_comm_0446 §12: unsub_link_apply anchor not found'; end if;
  execute out_src;
end $m$;

-- the worker's marketing guard honours the cap too (campaign rows do not pass through sys_email)
do $w$
declare src text; out_src text;
begin
  src := pg_get_functiondef('public.cc_delivery_worker_marketing_allowed(uuid)'::regprocedure);
  out_src := replace(src,
    $a$    from app_private.message_deliveries d
    where d.id = p_id and d.channel = 'email'$a$,
    $b$      and coalesce(app_private.email_gate(d.template_key, d.recipient_email, d.recipient_user)->>'code', '') <> 'frequency_cap'
    from app_private.message_deliveries d
    where d.id = p_id and d.channel = 'email'$b$);
  if out_src = src then raise exception 'bl_comm_0446 §12: marketing guard anchor not found'; end if;
  execute out_src;
end $w$;

-- staff: set the pace on someone's behalf (recorded with who and why)
create or replace function public.cc_unsub_frequency_set(p_email text, p_group text, p_days integer, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
begin
  if not app_private.can_manage_comms() then raise exception 'not authorized' using errcode = '42501'; end if;
  return app_private.unsub_set_frequency(p_email, p_group, p_days, 'cc_manual', auth.uid(), jsonb_build_object('note', nullif(btrim(p_note),'')));
end $$;
revoke all on function public.cc_unsub_frequency_set(text,text,integer,text) from public, anon;
grant execute on function public.cc_unsub_frequency_set(text,text,integer,text) to authenticated;

-- ---------------------------------------------------------------- 13. every send path, and the old complaints — 26 Sep 2026
-- Applied on staging as bl_comm_0446c. Two gaps the owner's CC review surfaced:
--  a. delivery-worker v20 now runs email_gate on EVERY non-marketing row (v19 only did it when the row's meta
--     carried preference_group; cc_enqueue_transactional / fire_comm_trigger / reminder_dispatch / lb_email_notify
--     never set it, so catalog-marketing keys queued as "transactional" skipped the unsubscribe check). Those rows
--     still carry no meta.preference_group, so the "fewer emails" cap now also counts a sent row by its catalog group.
--  b. Spam complaints are the strongest "stop" there is. They were only a hard suppression, invisible in CC →
--     Unsubscribes. Backfill them into the ledger as "every optional email" (idempotent; the hard suppression stays).
do $s13$
declare src text; out_src text;
begin
  src := pg_get_functiondef('app_private.email_gate(text,text,uuid)'::regprocedure);
  out_src := replace(src,
    $a$         and (d.meta->>'preference_group' = v_group
$a$,
    $b$         and (d.meta->>'preference_group' = v_group
              or exists (select 1 from app_private.email_catalog c where c.key = d.template_key and c.preference_group = v_group)
$b$);
  if out_src = src then raise exception 'bl_comm_0446 §13: email_gate cap anchor not found'; end if;
  execute out_src;
end
$s13$;

do $s13b$
declare r record; v_ev bigint;
begin
  for r in select lower(btrim(address)) email, min(created_at) created_at from app_private.suppressions
            where channel = 'email' and reason = 'complained' group by 1 loop
    if exists (select 1 from app_private.unsub_prefs where email = r.email and group_code = '*') then continue; end if;
    insert into app_private.unsub_events(at, email, user_id, org_id, action, scope, groups, source, meta)
    select r.created_at, r.email, e.user_id, e.org_id, 'unsubscribe', 'all', array['*'], 'backfill', jsonb_build_object('from', 'suppressions', 'reason', 'complained')
      from app_private.email_identify(r.email) e returning id into v_ev;
    insert into app_private.unsub_prefs(email, group_code, opted_out, source, last_event_id, updated_at, user_id)
    values (r.email, '*', true, 'backfill', v_ev, r.created_at, (select user_id from app_private.email_identify(r.email)))
    on conflict do nothing;
  end loop;
end
$s13b$;
