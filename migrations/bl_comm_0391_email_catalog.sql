-- bl_comm_0391: the email registry. One row per email LoadBoot can send.
-- Additive only: nothing here changes how mail is sent yet (that is 0392).

create table if not exists app_private.email_sender_identities(
  code text primary key,
  from_address text not null,
  reply_to text,
  note text
);
insert into app_private.email_sender_identities(code, from_address, reply_to, note) values
 ('dispatch','LoadBoot Dispatch <dispatch@loadboot.com>','dispatch@loadboot.com','Operational load/trip/carrier mail. delivery-worker DISPATCH_RE.'),
 ('billing','LoadBoot Billing <billing@loadboot.com>','billing@loadboot.com','Money mail. delivery-worker BILLING_RE.'),
 ('support','LoadBoot Support <hello@loadboot.com>','hello@loadboot.com','Default identity: account, onboarding, compliance, human replies.'),
 ('marketing','SENDER_MARKETING env (cold-outreach subdomain mail.loadboot.com)','hello@loadboot.com','outreach.* and campaigns only. Never shares a domain with operational mail.')
on conflict (code) do update set from_address=excluded.from_address, reply_to=excluded.reply_to, note=excluded.note;

create table if not exists app_private.email_pref_groups(
  code text primary key,
  label text not null,
  description text not null,
  opt_out_allowed boolean not null default true,
  default_on boolean not null default true,
  sort int not null default 100
);
insert into app_private.email_pref_groups(code,label,description,opt_out_allowed,default_on,sort) values
 ('account_critical','Account & security','Sign-in and security alerts, account status, legal and authority notices.',false,true,10),
 ('load_ops','Loads & trips','Offers, booking, dispatch, pickup, delivery, POD and tracking notices.',true,true,20),
 ('compliance','Documents & compliance','Document review results, expiring paperwork, packet and authority checks.',true,true,30),
 ('billing','Billing & payouts','Invoices, payment and settlement notices. Receipts always send.',true,true,40),
 ('digests','Summaries','Weekly and monthly summaries of your account.',true,true,50),
 ('product_announcements','Product news','New features and product announcements.',true,true,60),
 ('marketing','Marketing','Cold outreach, campaigns and re-engagement. Consent required.',true,false,70),
 ('staff_internal','Internal (staff)','Alerts that only reach LoadBoot staff.',false,true,80)
on conflict (code) do update set label=excluded.label, description=excluded.description,
  opt_out_allowed=excluded.opt_out_allowed, default_on=excluded.default_on, sort=excluded.sort;

create table if not exists app_private.email_catalog(
  key             text primary key,
  name            text,
  purpose         text,
  class           text not null default 'unclassified'
                  check (class in ('T','O','P','M','S','unclassified')),
  audience_role   text,
  trigger_type    text check (trigger_type in ('event','cron','manual','inbound','unknown')),
  trigger_source  text,
  cadence         text,
  cap_note        text,
  stop_condition  text,
  preference_group text references app_private.email_pref_groups(code),
  unsub_allowed   boolean not null default false,
  cc_deep_link    text,
  status          text not null default 'undocumented'
                  check (status in ('live','legacy','retired','dead','test','planned','undocumented')),
  replaced_by     text,
  owner_note      text,
  discovered_in   text[] not null default '{}',
  first_seen      timestamptz,
  last_seen       timestamptz,
  sends_total     int not null default 0,
  sends_30d       int not null default 0,
  subject_override text,
  html_override    text,
  override_active  boolean not null default false,
  override_updated_by uuid,
  override_updated_at timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists email_catalog_status_idx on app_private.email_catalog(status, class);
create index if not exists email_catalog_group_idx  on app_private.email_catalog(preference_group);

-- Mirrors delivery-worker categoryOf() EXACTLY, including its order. If the worker
-- changes, change this too or the Command Center will lie about the sender.
create or replace function app_private.email_sender_for(p_key text, p_source text default 'transactional')
returns text language sql immutable as $$
  select case
    when coalesce(p_key,'') ~* '^outreach[._-]' then 'marketing'
    when coalesce(p_key,'') ~* '(billing|invoice|payment|settlement|payout|statement|receipt|factoring)' then 'billing'
    when coalesce(p_key,'') ~* '(load|trip|offer|dispatch|booking|tracking|pod|detention|checkin|carrier|driver|ops\.)' then 'dispatch'
    when coalesce(p_source,'') = 'campaign' then 'marketing'
    else 'support' end
$$;

-- Discovers every key that exists in code, in the delivery log, or in comm_templates,
-- and files anything new as 'undocumented' so nothing can send in silence.
create or replace function app_private.email_catalog_sync()
returns jsonb language plpgsql security definer set search_path = public, app_private as $$
declare v_new text[]; v_total int; v_undoc int;
begin
  create temp table _ek(k text, src text) on commit drop;

  insert into _ek(k,src)
  select distinct (regexp_matches(p.prosrc,'sys_email\s*\(\s*[^,()]{0,200},\s*''([a-z0-9_.\-]+)''','g'))[1], 'code'
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.prosrc ~ 'sys_email' and n.nspname in ('public','app_private');

  insert into _ek(k,src)
  select distinct template_key, 'log' from app_private.message_deliveries
   where template_key is not null;

  insert into _ek(k,src)
  select distinct key, 'templates' from app_private.comm_templates where key is not null;

  delete from _ek where k is null or btrim(k) = '' or k ~ '[{}]';

  select coalesce(array_agg(distinct k),'{}') into v_new
    from _ek where k not in (select key from app_private.email_catalog);

  insert into app_private.email_catalog(key)
  select distinct k from _ek
  on conflict (key) do nothing;

  update app_private.email_catalog c
     set discovered_in = s.srcs, updated_at = now()
    from (select k, array_agg(distinct src order by src) srcs from _ek group by k) s
   where c.key = s.k and c.discovered_in is distinct from s.srcs;

  update app_private.email_catalog c
     set first_seen = d.f, last_seen = d.l, sends_total = d.n, sends_30d = d.n30, updated_at = now()
    from (select template_key k, min(created_at) f, max(created_at) l, count(*)::int n,
                 count(*) filter (where created_at > now() - interval '30 days')::int n30
            from app_private.message_deliveries group by 1) d
   where c.key = d.k;

  -- a key that is only in the log and never in code is either retired or sent by hand
  update app_private.email_catalog
     set status = 'legacy', updated_at = now()
   where status = 'undocumented' and discovered_in = array['log']
     and coalesce(last_seen, now()) < now() - interval '30 days';

  select count(*), count(*) filter (where status='undocumented')
    into v_total, v_undoc from app_private.email_catalog;

  if array_length(v_new,1) > 0 then
    perform app_private.emit_notification(
      p_recipient_role := 'staff', p_channel := 'in_app',
      p_template_key := 'ops.email_catalog.new_keys',
      p_payload := jsonb_build_object('keys', to_jsonb(v_new),
                    'title','New email template keys found',
                    'body', array_length(v_new,1)||' email key(s) are sending without a catalog entry.'));
  end if;

  return jsonb_build_object('ok',true,'total',v_total,'undocumented',v_undoc,
                            'new', coalesce(to_jsonb(v_new),'[]'::jsonb));
end $$;

revoke all on function app_private.email_catalog_sync() from public, anon, authenticated;
comment on table app_private.email_catalog is
 'bl_comm_0391. One row per email LoadBoot can send: what it is, who gets it, what fires it, how often, which preference group governs it, and which sender identity it leaves from. Kept honest by app_private.email_catalog_sync().';
