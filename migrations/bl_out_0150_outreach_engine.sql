-- bl_out_0150 — OUTREACH AUTOMATION ENGINE (email marketing, spam-safe by design).
-- Contacts (CRM) + templates (drip D1..D7 per audience) + state (auto-ramp caps) +
-- daily cron run through the EXISTING outbox (sys_email -> message_deliveries -> Resend).
-- Deep safety details: per-contact 3-day gap between emails; weekly-doubling cap
-- (base_cap * 2^weeks, never above max_cap); one-click unsubscribe with HMAC-style token;
-- bounce/failure auto-blocks the contact; idempotent send keys. STAGING then PROD.
create table if not exists app_private.outreach_contacts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('carrier','broker','shipper')),
  email text not null,
  company text, state text, trucks int, dot text, source text default 'fmcsa_census',
  status text not null default 'active' check (status in ('active','unsubscribed','bounced','completed','suppressed')),
  emails_sent int not null default 0,
  last_sent_at timestamptz, created_at timestamptz not null default now()
);
create unique index if not exists outreach_contacts_email_uq on app_private.outreach_contacts (lower(email));
create index if not exists outreach_contacts_pick on app_private.outreach_contacts (status, emails_sent, last_sent_at);

create table if not exists app_private.outreach_templates (
  id uuid primary key default gen_random_uuid(),
  audience text not null check (audience in ('carrier','broker','shipper')),
  day int not null check (day between 1 and 7),
  subject text not null, html text not null, active boolean not null default true,
  unique (audience, day)
);

create table if not exists app_private.outreach_state (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default false,
  started_on date,
  base_cap int not null default 100,
  max_cap int not null default 5000,
  sent_today int not null default 0,
  last_run date,
  unsub_secret text not null default encode(gen_random_bytes(16),'hex')
);
insert into app_private.outreach_state (id) values (1) on conflict do nothing;

create or replace function app_private.outreach_unsub_token(p_email text)
returns text language sql stable security definer set search_path to 'app_private, public' as $$
  select md5(lower(trim(p_email)) || (select unsub_secret from app_private.outreach_state where id=1));
$$;

-- Public one-click unsubscribe (anon-callable from unsub page)
create or replace function public.outreach_unsubscribe(p_email text, p_token text)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
begin
  if p_token is distinct from app_private.outreach_unsub_token(p_email) then
    return jsonb_build_object('error','invalid link');
  end if;
  update app_private.outreach_contacts set status='unsubscribed' where lower(email)=lower(trim(p_email));
  return jsonb_build_object('ok', true);
end $$;
grant execute on function public.outreach_unsubscribe(text, text) to anon, authenticated;

-- Daily run: ramped cap, per-contact 3-day gap, next drip day, via existing outbox.
create or replace function app_private.outreach_run_daily()
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
declare st app_private.outreach_state; v_cap int; v_sent int := 0; c record; t record; v_html text; v_unsub text;
begin
  select * into st from app_private.outreach_state where id=1;
  if not st.enabled then return jsonb_build_object('skipped','disabled'); end if;
  if st.started_on is null then update app_private.outreach_state set started_on=current_date where id=1; st.started_on := current_date; end if;
  if st.last_run is distinct from current_date then update app_private.outreach_state set last_run=current_date, sent_today=0 where id=1; st.sent_today := 0; end if;
  v_cap := least(st.max_cap, st.base_cap * (2 ^ floor((current_date - st.started_on) / 7.0))::int) - st.sent_today;
  if v_cap <= 0 then return jsonb_build_object('skipped','cap reached'); end if;
  for c in
    select oc.* from app_private.outreach_contacts oc
    where oc.status='active' and oc.emails_sent < 7
      and (oc.last_sent_at is null or oc.last_sent_at < now() - interval '3 days')
      and exists (select 1 from app_private.outreach_templates tt where tt.audience=oc.kind and tt.day=oc.emails_sent+1 and tt.active)
    order by oc.emails_sent asc, oc.created_at asc
    limit v_cap
  loop
    select * into t from app_private.outreach_templates where audience=c.kind and day=c.emails_sent+1 and active;
    v_unsub := 'https://loadboot.com/unsub.html?e=' || replace(lower(trim(c.email)),'+','%2B') || '&t=' || app_private.outreach_unsub_token(c.email);
    v_html := replace(replace(t.html, '{NAME}', coalesce(nullif(trim(c.company),''),'there')), '{UNSUB}', v_unsub);
    begin
      perform app_private.sys_email(c.email, 'outreach.'||c.kind||'-d'||t.day, t.subject, v_html, null,
        'outr:'||c.id::text||':d'||t.day);
      update app_private.outreach_contacts
        set emails_sent = emails_sent + 1, last_sent_at = now(),
            status = case when emails_sent + 1 >= 7 then 'completed' else status end
        where id = c.id;
      v_sent := v_sent + 1;
    exception when others then null; end;
  end loop;
  update app_private.outreach_state set sent_today = sent_today + v_sent where id=1;
  return jsonb_build_object('ok', true, 'sent', v_sent, 'cap', v_cap);
end $$;

-- Bounce/failure on an outreach email -> block that contact (list hygiene, automatic)
create or replace function app_private.trg_outreach_bounce() returns trigger
language plpgsql security definer set search_path to 'app_private, public' as $$
begin
  if NEW.template_key like 'outreach.%' and NEW.status in ('failed','bounced')
     and (OLD.status is distinct from NEW.status) then
    update app_private.outreach_contacts set status='bounced' where lower(email)=lower(coalesce(NEW.recipient_email,'')) and status='active';
  end if;
  return NEW;
end $$;
drop trigger if exists trg_outreach_bounce on app_private.message_deliveries;
create trigger trg_outreach_bounce after update on app_private.message_deliveries
  for each row execute function app_private.trg_outreach_bounce();

-- Staff controls + stats
create or replace function public.cc_outreach_crm(p_days int default 30)
returns jsonb language sql stable security definer set search_path to 'app_private, public' as $$
  select case when not (public.has_global_permission('marketing.view') or public.has_global_permission('carriers.approve') or public.has_global_permission('dispatch.manage'))
    then jsonb_build_object('error','not authorized') else jsonb_build_object(
    'state', (select to_jsonb(s) - 'unsub_secret' from app_private.outreach_state s where id=1),
    'contacts', (select jsonb_object_agg(k, n) from (select kind||':'||status k, count(*) n from app_private.outreach_contacts group by 1) x),
    'sends', (select coalesce(jsonb_agg(jsonb_build_object('tpl',template_key,'status',status,'n',n) order by template_key), '[]'::jsonb)
              from (select template_key, status, count(*) n from app_private.message_deliveries
                    where template_key like 'outreach.%' and created_at > now() - (p_days||' days')::interval
                    group by 1,2) y)
  ) end;
$$;
create or replace function public.cc_outreach_control(p_action text, p_value int default null)
returns jsonb language plpgsql security definer set search_path to 'app_private, public' as $$
begin
  if not (public.has_global_permission('marketing.view') or public.has_global_permission('carriers.approve') or public.has_global_permission('dispatch.manage')) then
    return jsonb_build_object('error','not authorized'); end if;
  if p_action='enable' then update app_private.outreach_state set enabled=true, started_on=coalesce(started_on,current_date) where id=1;
  elsif p_action='disable' then update app_private.outreach_state set enabled=false where id=1;
  elsif p_action='base_cap' and p_value is not null then update app_private.outreach_state set base_cap=greatest(10,p_value) where id=1;
  elsif p_action='max_cap' and p_value is not null then update app_private.outreach_state set max_cap=greatest(100,p_value) where id=1;
  elsif p_action='run_now' then return app_private.outreach_run_daily();
  else return jsonb_build_object('error','bad action'); end if;
  return jsonb_build_object('ok',true);
end $$;
grant execute on function public.cc_outreach_crm(int) to authenticated;
grant execute on function public.cc_outreach_control(text,int) to authenticated;

-- Daily cron 13:00 UTC (~9am US East)
select cron.schedule('lb-outreach-daily','0 13 * * *', $$select app_private.outreach_run_daily()$$)
where not exists (select 1 from cron.job where jobname='lb-outreach-daily');
