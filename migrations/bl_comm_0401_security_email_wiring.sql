-- ============================================================================
-- bl_comm_0401 — Pack C (Security): wire the 4 security emails.
--   tx.security_alert (new-device sign-in) · security.password_changed
--   security.email_changed · security.payout_changed
--
-- RE-VERIFIED 22 Sep 2026 against BOTH databases. The plan
-- (claude/EMAIL-WIRING-PLAN-0399.md, repeated in the Pack A/B docs) said:
-- "new state auth_device_seen + a sweep over auth.audit_log_entries".
--
--   plan said                          | what is actually there
--   -----------------------------------|---------------------------------------
--   sweep auth.audit_log_entries       | the table is EMPTY on prod AND staging
--                                      | (0 rows, ever). Auth audit events are not
--                                      | written to the database on these projects,
--                                      | so a sweep over it would never fire.
--   (no login capture assumed)         | auth.sessions has one row per sign-in with
--                                      | ip + user_agent (prod: 217 rows, every one
--                                      | with both). This is the server-side truth
--                                      | and what the sweep reads instead.
--   (not mentioned)                    | app_private.user_devices + public.device_seen
--                                      | already exist (client-reported device key).
--                                      | NOT used for alerts: the key lives in browser
--                                      | storage, and users are told to clear site
--                                      | data after deploys -> false alerts. Used only
--                                      | to seed history.
--
-- Design choices:
--   * New-device = a new "browser on system" label (e.g. "Chrome on Windows") for
--     that user. Browser version bumps do not count. IP is shown, never used to
--     decide (mobile IPs change constantly). No location is shown - we do not
--     have one, so we do not invent one.
--   * A user's very first sign-in is seeded silently (that is signup, not an alert).
--   * History is seeded at apply time from auth.sessions + user_devices, so
--     nobody gets a flood of alerts when this goes Live.
--   * The sweep is a cron over auth.sessions, NOT a trigger on it - nothing here
--     can ever slow down or fail a sign-in.
--   * Password / email triggers on auth.users are wrapped so they can never raise.
--   * All four are account_critical (cannot be unsubscribed), start in TEST.
-- ============================================================================

-- ------------------------------------------------------------------ state --
create table if not exists app_private.auth_device_seen (
  user_id       uuid not null references auth.users(id) on delete cascade,
  fp            text not null,
  label         text not null,
  first_seen    timestamptz not null default now(),
  last_seen     timestamptz not null default now(),
  last_ip       inet,
  first_session uuid,
  primary key (user_id, fp)
);
alter table app_private.auth_device_seen enable row level security;
revoke all on app_private.auth_device_seen from public, anon, authenticated;
comment on table app_private.auth_device_seen is
  'bl_comm_0401 — which "browser on system" each user has signed in from. Fed by cron_security_sweep() from auth.sessions.';

-- ---------------------------------------------------------------- helpers --
create or replace function app_private.sec_esc(p text) returns text
language sql immutable as $$
  select replace(replace(replace(replace(coalesce(p,''),'&','&amp;'),'<','&lt;'),'>','&gt;'),'"','&quot;');
$$;

create or replace function app_private.sec_when(p timestamptz) returns text
language sql immutable as $$
  select to_char(p at time zone 'UTC', 'Mon DD, YYYY HH24:MI') || ' UTC';
$$;

create or replace function app_private.sec_mask_email(p text) returns text
language sql immutable as $$
  select case when p is null or position('@' in p) = 0 then 'another address'
              else left(p,1) || '***@' || split_part(p,'@',2) end;
$$;

create or replace function app_private.sec_ua_label(p_ua text) returns text
language sql immutable as $$
  select case
    when coalesce(btrim(p_ua),'') = '' then 'an unknown device'
    when p_ua !~* '(mozilla|applewebkit|gecko)' then 'a script or non-browser app'
    else
      (case when p_ua ~* 'edg(e|a|ios)?/'                 then 'Edge'
            when p_ua ~* '(opr/|opera)'                   then 'Opera'
            when p_ua ~* 'samsungbrowser'                 then 'Samsung Internet'
            when p_ua ~* '(fxios|firefox/)'               then 'Firefox'
            when p_ua ~* '(; wv\)|version/4\.0 chrome)'   then 'an in-app browser'
            when p_ua ~* '(crios|chrome/)'                then 'Chrome'
            when p_ua ~* '(safari|version/)'              then 'Safari'
            else 'an app or in-app browser' end)
      || ' on ' ||
      (case when p_ua ~* 'iphone'                then 'iPhone'
            when p_ua ~* 'ipad'                  then 'iPad'
            when p_ua ~* 'android'               then 'Android'
            when p_ua ~* 'cros'                  then 'ChromeOS'
            when p_ua ~* 'windows'               then 'Windows'
            when p_ua ~* '(macintosh|mac os x)'  then 'Mac'
            when p_ua ~* 'linux'                 then 'Linux'
            else 'an unknown system' end)
  end;
$$;

-- [[label, value], ...] -> small two-column table. Values are escaped here.
create or replace function app_private.sec_rows(p jsonb) returns text
language sql immutable as $$
  select '<table style="border-collapse:collapse;margin:8px 0 16px;font-size:14px">'
      || coalesce(string_agg('<tr><td style="padding:4px 16px 4px 0;color:#666">'
           || app_private.sec_esc(e->>0) || '</td><td style="padding:4px 0;font-weight:600">'
           || app_private.sec_esc(e->>1) || '</td></tr>', '' order by o), '')
      || '</table>'
  from jsonb_array_elements(p) with ordinality as t(e, o);
$$;

create or replace function app_private.sec_not_you(p_can_reset boolean) returns text
language sql immutable as $$
  select '<p>If this was you, you don''t need to do anything.</p>'
      || '<p><b>If this wasn''t you</b>, someone may have access to your account. '
      || case when p_can_reset
              then 'Open <a href="https://loadboot.com/app/">loadboot.com/app</a>, choose '
                || '<b>Forgot password</b> to set a new password, and then '
              else '' end
      || 'reply to this email or write to <a href="mailto:hello@loadboot.com">hello@loadboot.com</a> '
      || 'straight away so we can check the account with you.</p>';
$$;

-- Which of the watched keys changed between two jsonb rows (ignoring empty->empty).
create or replace function app_private.sec_changed(o jsonb, n jsonb, keys text[]) returns text[]
language sql immutable as $$
  select coalesce(array_agg(k order by ord), '{}')
  from unnest(keys) with ordinality as u(k, ord)
  where coalesce(nullif(btrim(o->>k),''), '') is distinct from coalesce(nullif(btrim(n->>k),''), '');
$$;

create or replace function app_private.sec_field_label(k text) returns text
language sql immutable as $$
  select case k
    when 'payment_method' then 'payment method'   when 'payout_method' then 'payout method'
    when 'bank_name' then 'bank name'             when 'account_title' then 'account holder name'
    when 'account_number' then 'account number'   when 'account' then 'account number'
    when 'routing_number' then 'routing number'   when 'routing' then 'routing number'
    when 'account_type' then 'account type'       when 'swift_bic' then 'SWIFT / BIC'
    when 'swift' then 'SWIFT / BIC'               when 'iban' then 'IBAN'
    when 'bank_address' then 'bank address'       when 'beneficiary_address' then 'beneficiary address'
    when 'remittance_email' then 'remittance email' when 'email' then 'payout email'
    when 'factoring_company' then 'factoring company' when 'wallet' then 'wallet address'
    when 'wallet_network' then 'wallet network'   when 'other' then 'other payout details'
    else k end;
$$;

create or replace function app_private.sec_last4(p text) returns text
language sql immutable as $$
  select case when length(regexp_replace(coalesce(p,''),'[^A-Za-z0-9]','','g')) >= 4
              then 'ending ' || right(regexp_replace(p,'[^A-Za-z0-9]','','g'), 4) end;
$$;

-- --------------------------------------------------- 1. new-device sweep --
create or replace function app_private.cron_security_sweep()
returns integer
language plpgsql
security definer
set search_path to 'app_private', 'public'
as $$
declare r record; v_label text; v_known int; v_new boolean; v_first uuid; v_n int := 0;
begin
  for r in
    select s.id, s.user_id, s.created_at, s.ip, s.user_agent, u.email
      from auth.sessions s
      join auth.users u on u.id = s.user_id
     where s.created_at > now() - interval '20 minutes'
       and u.email is not null and u.deleted_at is null
     order by s.created_at
  loop
    v_label := app_private.sec_ua_label(r.user_agent);
    select count(*) into v_known from app_private.auth_device_seen where user_id = r.user_id;

    insert into app_private.auth_device_seen as d
           (user_id, fp, label, first_seen, last_seen, last_ip, first_session)
    values (r.user_id, md5(v_label), v_label, r.created_at, r.created_at, r.ip, r.id)
    on conflict (user_id, fp) do update
       set last_seen = greatest(d.last_seen, excluded.last_seen),
           last_ip   = case when excluded.last_seen >= d.last_seen then excluded.last_ip else d.last_ip end
    returning (xmax = 0), d.first_session into v_new, v_first;

    -- alert only on a brand-new label, for a user we already know (not first sign-in)
    if v_new and v_known > 0 and v_first = r.id then
      if app_private.fin_mail(r.email, 'tx.security_alert',
           'New sign-in to your LoadBoot account',
           app_private.fin_mail_html('New sign-in to your account', app_private.sec_esc(r.email),
             '<p>Your LoadBoot account was just signed in to from a device we haven''t seen '
             || 'on this account before.</p>'
             || app_private.sec_rows(jsonb_build_array(
                  jsonb_build_array('Device', v_label),
                  jsonb_build_array('When',   app_private.sec_when(r.created_at)),
                  jsonb_build_array('IP address', coalesce(host(r.ip), 'not recorded'))))
             || '<p style="color:#666;font-size:13px">We don''t store a location for sign-ins, '
             || 'so none is shown.</p>'
             || app_private.sec_not_you(true)),
           'secdev:' || r.id) then
        v_n := v_n + 1;
      end if;
    end if;
  end loop;
  return v_n;
end $$;

comment on function app_private.cron_security_sweep() is
  'bl_comm_0401 — every 2 min: new "browser on system" in auth.sessions -> tx.security_alert. First-ever sign-in is seeded silently. Never touches the sign-in path.';

-- seed history so going Live does not alert on devices people already use
insert into app_private.auth_device_seen (user_id, fp, label, first_seen, last_seen, last_ip, first_session)
select x.user_id, md5(x.l), x.l, min(x.at), max(x.at),
       (array_agg(x.ip order by x.at desc))[1], (array_agg(x.sid order by x.at))[1]
from (
  select s.user_id, app_private.sec_ua_label(s.user_agent) l, s.created_at at, s.ip, s.id sid
    from auth.sessions s join auth.users u on u.id = s.user_id
  union all
  select d.user_id, app_private.sec_ua_label(d.ua), d.created_at, null::inet, null::uuid
    from app_private.user_devices d join auth.users u on u.id = d.user_id
   where coalesce(btrim(d.ua),'') <> ''
) x
group by x.user_id, x.l
on conflict (user_id, fp) do nothing;

select cron.schedule('lb-security-sweep', '*/2 * * * *', $c$select app_private.cron_security_sweep();$c$);

-- ------------------------------------ 2+3. password / sign-in email change --
create or replace function app_private.trg_comm_auth_user_sec()
returns trigger
language plpgsql
security definer
set search_path to 'app_private', 'public'
as $$
begin
  begin
    -- password changed (skip: first password set on invite, and GoTrue re-hashing
    -- an imported non-bcrypt hash to bcrypt on sign-in - neither is a change)
    if new.encrypted_password is distinct from old.encrypted_password
       and coalesce(old.encrypted_password,'') <> ''
       and coalesce(new.encrypted_password,'') <> ''
       and not (old.encrypted_password !~ '^\$2' and new.encrypted_password ~ '^\$2')
       and new.email is not null then
      perform app_private.fin_mail(new.email, 'security.password_changed',
        'Your LoadBoot password was changed',
        app_private.fin_mail_html('Your password was changed', app_private.sec_esc(new.email),
          '<p>The password for your LoadBoot account was just changed.</p>'
          || app_private.sec_rows(jsonb_build_array(jsonb_build_array('When', app_private.sec_when(now()))))
          || app_private.sec_not_you(true)),
        'pwchg:' || new.id || ':' || extract(epoch from now())::bigint);
    end if;

    -- sign-in email changed: tell the OLD address (it can no longer reset the
    -- password, so the only route is to contact us) and the NEW one.
    if new.email is distinct from old.email and old.email is not null and new.email is not null then
      perform app_private.fin_mail(old.email, 'security.email_changed',
        'The sign-in email on your LoadBoot account was changed',
        app_private.fin_mail_html('Your sign-in email was changed', app_private.sec_esc(old.email),
          '<p>The email address used to sign in to your LoadBoot account was just changed. '
          || 'This address will no longer receive account emails.</p>'
          || app_private.sec_rows(jsonb_build_array(
               jsonb_build_array('Old email', old.email),
               jsonb_build_array('New email', app_private.sec_mask_email(new.email)),
               jsonb_build_array('When', app_private.sec_when(now()))))
          || app_private.sec_not_you(false)),
        'emlchg:' || new.id || ':' || md5(lower(new.email)) || ':o');

      perform app_private.fin_mail(new.email, 'security.email_changed',
        'This is now the sign-in email for your LoadBoot account',
        app_private.fin_mail_html('Your sign-in email was changed', app_private.sec_esc(new.email),
          '<p>This address is now the email you use to sign in to LoadBoot. '
          || 'The previous address has been told about the change.</p>'
          || app_private.sec_rows(jsonb_build_array(
               jsonb_build_array('Previous email', app_private.sec_mask_email(old.email)),
               jsonb_build_array('When', app_private.sec_when(now()))))
          || app_private.sec_not_you(false)),
        'emlchg:' || new.id || ':' || md5(lower(new.email)) || ':n');
    end if;
  exception when others then
    null;  -- a mail problem must never block a password or email change
  end;
  return new;
end $$;

drop trigger if exists comm_auth_user_sec on auth.users;
create trigger comm_auth_user_sec
  after update of encrypted_password, email on auth.users
  for each row execute function app_private.trg_comm_auth_user_sec();

-- ------------------------------------------------ 4. payout details changed --
create or replace function app_private.sec_payout_mail(
  p_to text, p_who text, p_added boolean, p_changed text[], p_rows jsonb, p_idem text)
returns boolean
language sql
security definer
set search_path to 'app_private', 'public'
as $$
  select app_private.fin_mail(p_to, 'security.payout_changed',
    'Your LoadBoot payout details were ' || case when p_added then 'added' else 'changed' end,
    app_private.fin_mail_html('Payout details ' || case when p_added then 'added' else 'changed' end,
      app_private.sec_esc(p_who),
      '<p>The bank / payout details LoadBoot uses to pay you were just '
      || case when p_added then 'added' else 'changed' end || '.</p>'
      || app_private.sec_rows(p_rows || jsonb_build_array(
           jsonb_build_array('What changed',
             (select string_agg(app_private.sec_field_label(k), ', ') from unnest(p_changed) k)),
           jsonb_build_array('When', app_private.sec_when(now()))))
      || '<p style="color:#666;font-size:13px">For your safety we never show full account numbers.</p>'
      || app_private.sec_not_you(false)),
    p_idem);
$$;

create or replace function app_private.trg_comm_payout_org()
returns trigger
language plpgsql
security definer
set search_path to 'app_private', 'public'
as $$
declare
  k  text[] := array['payment_method','bank_name','account_title','account_number','routing_number',
                     'account_type','swift_bic','bank_address','beneficiary_address','remittance_email',
                     'factoring_company'];
  o  jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  n  jsonb := to_jsonb(new);
  ch text[]; v_to text; v_name text; v_demo boolean; v_rows jsonb := '[]'::jsonb;
begin
  begin
    ch := app_private.sec_changed(o, n, k);
    if cardinality(ch) = 0 then return new; end if;
    -- everything wiped (account deletion) is not a "change" worth alerting
    if cardinality(app_private.sec_changed('{}'::jsonb, n, k)) = 0 then return new; end if;

    select p.email, coalesce(g.name, 'your company'), coalesce(g.is_demo, false)
      into v_to, v_name, v_demo
      from public.organizations g left join public.profiles p on p.id = g.owner_user_id
     where g.id = new.org_id;
    if v_demo or v_to is null then return new; end if;

    if coalesce(btrim(new.payment_method),'') <> '' then
      v_rows := v_rows || jsonb_build_array(jsonb_build_array('Payment method', new.payment_method)); end if;
    if coalesce(btrim(new.bank_name),'') <> '' then
      v_rows := v_rows || jsonb_build_array(jsonb_build_array('Bank', new.bank_name)); end if;
    if app_private.sec_last4(new.account_number) is not null then
      v_rows := v_rows || jsonb_build_array(jsonb_build_array('Account', app_private.sec_last4(new.account_number))); end if;
    if coalesce(btrim(new.factoring_company),'') <> '' then
      v_rows := v_rows || jsonb_build_array(jsonb_build_array('Factoring company', new.factoring_company)); end if;

    perform app_private.sec_payout_mail(v_to, v_name,
      cardinality(app_private.sec_changed('{}'::jsonb, o, k)) = 0, ch, v_rows,
      'payout:org:' || new.org_id || ':' ||
      md5((select jsonb_object_agg(x, n->x) from unnest(k) x)::text));
  exception when others then null;
  end;
  return new;
end $$;

drop trigger if exists comm_payout_org on app_private.org_payment_profiles;
create trigger comm_payout_org
  after insert or update on app_private.org_payment_profiles
  for each row execute function app_private.trg_comm_payout_org();

create or replace function app_private.trg_comm_payout_agent()
returns trigger
language plpgsql
security definer
set search_path to 'app_private', 'public'
as $$
declare
  k  text[] := array['payout_method','bank_name','account_title','account','iban','routing','swift',
                     'bank_address','beneficiary_address','email','wallet','wallet_network','other'];
  o  jsonb; n jsonb; ch text[]; v_to text; v_rows jsonb := '[]'::jsonb;
begin
  begin
    if coalesce(new.status,'draft') = 'draft' then return new; end if;  -- still onboarding
    o := case when tg_op = 'UPDATE'
              then jsonb_build_object('payout_method', old.payout_method)
                   || case when jsonb_typeof(old.payout_details) = 'object' then old.payout_details else '{}'::jsonb end
              else '{}'::jsonb end;
    n := jsonb_build_object('payout_method', new.payout_method)
         || case when jsonb_typeof(new.payout_details) = 'object' then new.payout_details else '{}'::jsonb end;
    ch := app_private.sec_changed(o, n, k);
    if cardinality(ch) = 0 then return new; end if;
    if cardinality(app_private.sec_changed('{}'::jsonb, n, k)) = 0 then return new; end if;

    select email into v_to from auth.users where id = new.user_id;
    if v_to is null then return new; end if;

    if coalesce(btrim(n->>'payout_method'),'') <> '' then
      v_rows := v_rows || jsonb_build_array(jsonb_build_array('Payout method', n->>'payout_method')); end if;
    if coalesce(btrim(n->>'bank_name'),'') <> '' then
      v_rows := v_rows || jsonb_build_array(jsonb_build_array('Bank', n->>'bank_name')); end if;
    if app_private.sec_last4(coalesce(n->>'account', n->>'iban')) is not null then
      v_rows := v_rows || jsonb_build_array(jsonb_build_array('Account',
                  app_private.sec_last4(coalesce(n->>'account', n->>'iban')))); end if;
    if app_private.sec_last4(n->>'wallet') is not null then
      v_rows := v_rows || jsonb_build_array(jsonb_build_array('Wallet', app_private.sec_last4(n->>'wallet'))); end if;

    perform app_private.sec_payout_mail(v_to, coalesce(nullif(btrim(new.full_name),''), v_to),
      cardinality(app_private.sec_changed('{}'::jsonb, o, k)) = 0, ch, v_rows,
      'payout:agent:' || new.user_id || ':' ||
      md5((select jsonb_object_agg(x, n->x) from unnest(k) x)::text));
  exception when others then null;
  end;
  return new;
end $$;

drop trigger if exists comm_payout_agent on app_private.agent_profiles;
create trigger comm_payout_agent
  after insert or update on app_private.agent_profiles
  for each row execute function app_private.trg_comm_payout_agent();

-- --------------------------------------------------------- catalog rows ----
insert into app_private.email_catalog as c
  (key, name, purpose, class, audience_role, trigger_type, trigger_source, cadence, cap_note,
   stop_condition, preference_group, unsub_allowed, cc_deep_link, status, owner_note,
   send_mode, send_mode_note, send_mode_at)
select v.key, v.name, v.purpose, 'T', v.aud, v.ttype, v.src, v.cadence, v.cap, 'n/a - single event',
       'account_critical', false, '#/email-catalog', 'live', v.note,
       'test', 'bl_comm_0401 - wired 22 Sep 2026, starts in Test until the owner flips it to Live', now()
from (values
 ('tx.security_alert', 'Security Alert',
  'Sign-in from a device (browser on system) not seen on this account before',
  'carrier,broker,shipper,agent,dispatcher,staff', 'cron',
  'app_private.cron_security_sweep() - cron lb-security-sweep */2 over auth.sessions',
  'per new device', 'once per session (idem secdev:<session id>); first-ever sign-in is silent',
  'auth.audit_log_entries is empty on both DBs, so the plan''s sweep over it could never fire - this reads auth.sessions (ip + user_agent on every row). A "device" is a browser-on-system label, so browser updates and IP changes do not alert. Known limit: a second computer with the same browser and system looks the same. No location is stored, so none is shown.'),
 ('security.password_changed', 'Password changed',
  'Confirms a password change and tells the user what to do if it was not them',
  'carrier,broker,shipper,agent,dispatcher,staff', 'event',
  'app_private.trg_comm_auth_user_sec() on auth.users - encrypted_password changed',
  'per change', 'once per change (idem pwchg:<user>:<epoch>)',
  'Covers Forgot-password resets too. Skips the first password set on an invite and GoTrue re-hashing an imported hash. The trigger can never raise, so it cannot block a password change. No device/IP is shown - auth.users does not carry one.'),
 ('security.email_changed', 'Sign-in email changed',
  'Tells BOTH the old and the new address that the sign-in email changed',
  'carrier,broker,shipper,agent,dispatcher,staff', 'event',
  'app_private.trg_comm_auth_user_sec() on auth.users - email changed',
  'per change', '2 per change - old + new address (idem emlchg:<user>:<md5 new>:o|n)',
  'The old address gets the new one masked (j***@domain). It cannot reset the password any more, so its only route is to contact hello@loadboot.com.'),
 ('security.payout_changed', 'Payout details changed',
  'Bank / payout details were added or changed - carrier org or agent',
  'carrier,agent', 'event',
  'app_private.trg_comm_payout_org() on org_payment_profiles + trg_comm_payout_agent() on agent_profiles',
  'per change', 'once per distinct set of details (idem payout:org|agent:<id>:<md5 of details>)',
  'Only the detail fields count (verification flips, NOA docs and account wipes do not). Shows bank name and last 4 only. Agent drafts (still onboarding) are silent. Goes to the org owner (carrier) or the agent.')
) as v(key, name, purpose, aud, ttype, src, cadence, cap, note)
on conflict (key) do update set
  name = excluded.name, purpose = excluded.purpose, class = excluded.class,
  audience_role = excluded.audience_role, trigger_type = excluded.trigger_type,
  trigger_source = excluded.trigger_source, cadence = excluded.cadence, cap_note = excluded.cap_note,
  stop_condition = excluded.stop_condition, preference_group = excluded.preference_group,
  unsub_allowed = excluded.unsub_allowed, cc_deep_link = excluded.cc_deep_link, status = excluded.status,
  owner_note = excluded.owner_note, send_mode = excluded.send_mode, send_mode_note = excluded.send_mode_note,
  send_mode_at = excluded.send_mode_at, updated_at = now();

select app_private.email_catalog_sync();
