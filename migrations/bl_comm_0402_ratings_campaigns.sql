-- bl_comm_0402 — Pack D: rating invite + campaign shells, plus the two open Pack B decisions.
-- 22 Sep 2026. Same file applies to staging and production (every DB-specific branch is
-- decided from the database itself, not hard-coded).
--
--  1. Billing: receipts / invoices / settlement / dispute notices ALWAYS send.
--     Only billing reminders (invoice.reminder, pay.reminder, pay.confirm_nag) stay opt-out-able.
--  2. fee.invoice_due / fee.invoice_paid: set to 'planned' ONLY on a database where no function
--     sends that key. (Prod: fee.invoice_due IS sent by auto_invoice_on_delivery -> stays live;
--     fee.invoice_paid has no sender -> planned. Staging: both have senders -> unchanged.)
--  3. rating.invite: moved from the delivered-trigger to an hourly sweep. Invite once the trip is
--     delivered AND its POD is approved, one reminder 72h later, stop the moment that side rates.
--  4. mk.* campaign shells: cc_campaign_enqueue now honours the catalog Test/Off switch, and the
--     marketing preference-centre opt-out is honoured at enqueue AND at send time.

-- ─────────────────────────────────────────────────────────────── 1. billing always-send
create or replace function app_private.email_pref_allows(p_key text, p_user uuid)
 returns boolean
 language plpgsql
 stable security definer
 set search_path to 'public', 'app_private'
as $function$
declare v_group text; v_opt_out_allowed boolean; v_unsub boolean; v_pref record; v_off boolean;
begin
  select c.preference_group, coalesce(g.opt_out_allowed,false), c.unsub_allowed
    into v_group, v_opt_out_allowed, v_unsub
    from app_private.email_catalog c
    left join app_private.email_pref_groups g on g.code = c.preference_group
   where c.key = p_key;

  if v_group is null or v_group in ('account_critical','staff_internal') then return true; end if;
  -- bl_comm_0402: a billing notice about the person's own money (invoice, receipt, settlement,
  -- dispute outcome) is transactional and always sends. Billing reminders keep unsub_allowed=true.
  if v_group = 'billing' and v_unsub is false then return true; end if;
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
end $function$;

update app_private.email_catalog
   set unsub_allowed = false, updated_at = now(),
       owner_note = coalesce(owner_note || ' | ', '') || '0402: money notice — always sends, cannot be unsubscribed.'
 where key in ('tx.invoice_ready','tx.payment_update','tx.settlement_ready','tx.invoice_dispute_update')
   and unsub_allowed;

update app_private.email_pref_groups
   set description = 'Invoices, receipts, payment and settlement notices always send. Only payment reminders can be switched off.'
 where code = 'billing';

-- ─────────────────────────────────────────────────────────────── 2. fee.* orphans
update app_private.email_catalog c
   set status = 'planned', updated_at = now(),
       owner_note = coalesce(c.owner_note || ' | ', '') || '0402: set to planned — no function on this database sends this key.'
 where c.key in ('fee.invoice_due','fee.invoice_paid')
   and c.status = 'live'
   and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname in ('public','app_private')
                      and p.prosrc like '%''' || c.key || '''%');

update app_private.email_catalog c
   set trigger_source = case
         when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                       where n.nspname = 'public' and p.proname = 'cc_fee_invoice_mark_paid')
         then 'public.cc_fee_invoice_mark_paid'
         else 'none on this database (public.cc_fee_invoice_mark_paid exists on staging only)' end,
       updated_at = now()
 where c.key = 'fee.invoice_paid';

-- ─────────────────────────────────────────────────────────────── 3. rating invite
-- The delivered-trigger keeps its in-app notices; the e-mail moves to the sweep below.
create or replace function app_private.trg_trip_rating_invite()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'app_private', 'public'
as $function$
declare l record; m record; v_cname text; v_bname text;
begin
  if new.status <> 'delivered' or old.status = 'delivered' then return new; end if;
  select * into l from public.loads where id = new.load_id;
  select name into v_cname from public.organizations where id = new.carrier_id;
  select name into v_bname from public.organizations where id = l.broker_org;
  for m in select om.user_id as uid from public.organization_memberships om
            where om.org_id = new.carrier_id and om.status='active' limit 3 loop
    begin
      insert into app_private.notifications(recipient_user, channel, template_key, payload)
      values (m.uid, 'in_app', 'rating.invite',
        jsonb_build_object('title','⭐ Rate this trip — how was ' || coalesce(v_bname,'the broker') || '?',
          'body', coalesce(l.origin,'') || ' → ' || coalesce(l.destination,'') || ' · 10 seconds: tap the stars on your dashboard. Ratings keep bad actors off LoadBoot.',
          'tone','info','url','/app/carrier/#dashboard'));
    exception when others then null; end;
  end loop;
  if l.broker_org is not null then
    begin
      perform app_private.notify_partner(l.broker_org,
        '⭐ Rate this carrier — how did ' || coalesce(v_cname,'the carrier') || ' perform?',
        coalesce(l.origin,'') || ' → ' || coalesce(l.destination,'') || ' delivered. 10 seconds on your dashboard — your rating powers every broker''s carrier choice.',
        'info', '/app/partner/#dashboard');
    exception when others then null; end;
  end if;
  -- bl_comm_0402: the rating.invite e-mail is sent by app_private.cron_rating_invite()
  -- (after POD approval, one reminder at 72h, stops when that side rates).
  return new;
end; $function$;

create or replace function app_private.cron_rating_invite()
 returns integer
 language plpgsql
 security definer
 set search_path to 'app_private', 'public'
as $function$
declare
  t record; s record; v_sent int := 0; v_key text; v_inv timestamptz; v_stage text;
  v_uid uuid; v_to text; v_other text; v_subj text; v_head text; v_body text; v_url text; v_btn text;
begin
  if coalesce((select send_mode from app_private.email_catalog where key = 'rating.invite'), 'live') = 'off' then
    return 0;
  end if;

  for t in
    select tr.id, tr.carrier_id, tr.delivered_at,
           coalesce(l.origin,'?') || ' -> ' || coalesce(l.destination,'?') as lane,
           -- same broker resolution as public.cc_rate_counterparty, so we only invite a broker who can rate
           (select pl.broker_org from app_private.partner_loads pl where pl.posted_load_id = tr.load_id limit 1) as broker_org,
           (select max(d.reviewed_at) from app_private.document_files d
             where d.owner_type = 'trip' and d.owner_id = tr.id::text and d.kind = 'pod' and d.status = 'approved') as pod_at
      from app_private.trips tr
      left join public.loads l on l.id = tr.load_id
     where tr.status in ('delivered','invoiced')
       and tr.delivered_at > now() - interval '14 days'
  loop
    continue when t.pod_at is null;
    continue when exists (select 1 from public.organizations o
                           where o.id in (t.carrier_id, t.broker_org) and coalesce(o.is_demo,false));

    for s in
      select 'c'::text as side, t.carrier_id as rater, t.broker_org as rated
      union all
      select 'b', t.broker_org, t.carrier_id where t.broker_org is not null
    loop
      continue when exists (select 1 from app_private.party_ratings r
                             where r.trip_id = t.id and r.rater_org = s.rater);

      select p.id, lower(p.email) into v_uid, v_to
        from public.organizations o join public.profiles p on p.id = o.owner_user_id
       where o.id = s.rater;
      continue when coalesce(btrim(coalesce(v_to,'')),'') = '';

      v_key := 'rateinv:' || s.side || ':' || t.id::text;   -- same key the old trigger used
      -- a Test-mode copy is stored as <key>:test by sys_email; it counts as that stage done
      select min(created_at) into v_inv from app_private.message_deliveries where idempotency_key in (v_key, v_key || ':test');
      if v_inv is null then
        v_stage := 'invite';
      elsif v_inv <= now() - interval '72 hours' and v_inv > now() - interval '7 days'
            and not exists (select 1 from app_private.message_deliveries where idempotency_key in (v_key || ':r', v_key || ':r:test')) then
        v_stage := 'reminder'; v_key := v_key || ':r';
      else
        continue;
      end if;

      -- opted out: log the block once, not every hour
      if not app_private.email_pref_allows('rating.invite', v_uid) then
        continue when exists (select 1 from app_private.email_blocked_log b
                               where b.template_key = 'rating.invite' and b.recipient_email = v_to
                                 and b.created_at > t.pod_at);
      end if;

      select name into v_other from public.organizations where id = s.rated;
      if s.side = 'c' then
        v_url := 'https://loadboot.com/app/carrier/#dashboard'; v_btn := '#FC5305';
        v_head := case when s.rated is null then 'How did this trip go?'
                       else 'How was working with ' || app_private.sec_esc(coalesce(v_other,'this broker')) || '?' end;
        v_body := '<p>The trip is delivered and the POD is approved. Rating it takes about 10 seconds on your dashboard. '
               || 'Honest ratings keep slow payers and bad docks visible to every carrier.</p>';
      else
        v_url := 'https://loadboot.com/app/partner/#dashboard'; v_btn := '#0883F7';
        v_head := 'How did ' || app_private.sec_esc(coalesce(v_other,'the carrier')) || ' perform?';
        v_body := '<p>The trip is delivered and the POD is approved. Rating it takes about 10 seconds on your dashboard. '
               || 'Your rating shows on the carrier''s profile, marked as trip-verified.</p>';
      end if;
      if v_stage = 'reminder' then
        v_subj := 'Reminder: rate your trip ' || t.lane;
        v_body := v_body || '<p style="color:#64748b">This is the only reminder we will send for this trip.</p>';
      else
        v_subj := 'Rate your trip: ' || t.lane;
      end if;
      v_body := v_body || '<p style="margin:16px 0"><a href="' || v_url || '" style="background:' || v_btn
             || ';color:#fff;padding:11px 20px;border-radius:9px;text-decoration:none;font-weight:800">Rate this trip</a></p>';

      begin
        perform app_private.sys_email(v_to, 'rating.invite', v_subj,
                  app_private.trip_mail_html(v_head, app_private.sec_esc(t.lane), v_body), null, v_key);
        if exists (select 1 from app_private.message_deliveries where idempotency_key in (v_key, v_key || ':test')) then
          v_sent := v_sent + 1;
        end if;
      exception when others then null;
      end;
    end loop;
  end loop;
  return v_sent;
end $function$;

revoke all on function app_private.cron_rating_invite() from public, anon, authenticated;

update app_private.email_catalog
   set status = 'live', send_mode = 'test', send_mode_at = now(),
       send_mode_note = '0402: wired, starts in Test',
       trigger_type = 'cron',
       trigger_source = 'app_private.cron_rating_invite() — cron lb-rating-invite (hourly at :17)',
       cadence = 'invite once the trip is delivered AND its POD is approved (delivered within 14 days); one reminder 72h after the invite',
       cap_note = '2 per side per trip (invite + 1 reminder); reminder only while the invite is under 7 days old',
       stop_condition = 'that side has a party_ratings row for the trip (public.cc_rate_counterparty)',
       updated_at = now()
 where key = 'rating.invite';

do $$ begin
  if exists (select 1 from cron.job where jobname = 'lb-rating-invite') then
    perform cron.unschedule('lb-rating-invite');
  end if;
  perform cron.schedule('lb-rating-invite', '17 * * * *', 'select app_private.cron_rating_invite();');
end $$;

-- ─────────────────────────────────────────────────────────────── 4. campaign shells
-- 4a. cc_campaign_enqueue honours the catalog switch for its template_key (anchor patch).
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.cc_campaign_enqueue(uuid,integer)'::regprocedure);
  if position('bl_comm_0402' in d) > 0 then return; end if;
  n := replace(d, 'v_nvar int;', 'v_nvar int; v_mode text; v_test_to text;');
  n := replace(n, $a$  if v_nvar = 0 then
$a$, $p$  -- bl_comm_0402: the Email catalog Test/Off switch applies to campaigns too.
  select coalesce(ec.send_mode,'live'), ec.test_to into v_mode, v_test_to
    from app_private.email_catalog ec where ec.key = c.template_key;
  if v_mode = 'off' then
    raise exception '% is switched Off in the Email catalog', c.template_key using errcode='22023';
  end if;
  if v_mode = 'test' then
    v_test_to := lower(coalesce(nullif(btrim(coalesce(v_test_to,'')),''),
                          (select test_to from app_private.email_send_policy where id),
                          'hello@loadboot.com'));
    insert into app_private.message_deliveries(org_id,source,campaign_id,template_key,channel,provider,recipient_user,recipient_email,idempotency_key,status,scheduled_at,meta)
    values (null,'campaign',c.id,c.template_key,'email','resend',null,v_test_to,
            c.id::text||':test:'||extract(epoch from clock_timestamp())::bigint::text,'queued',now(),
            jsonb_build_object('subject','[TEST → '||v_final||' recipients] '||coalesce(v_subj,''),
              'utm_campaign',c.utm_campaign,'body_html',v_html,'body_text',v_text,
              'send_mode','test','real_recipients',v_final));
    perform app_private.log_audit('campaign.enqueue_test','campaign',c.id::text,null,
      format('Test mode: 1 copy to %s instead of %s recipients', v_test_to, v_final), '{}'::jsonb);
    return jsonb_build_object('final_recipients',v_final,'newly_queued',1,'variants',v_nvar,
                              'status','test','test_mode',true,'test_to',v_test_to);
  end if;

  if v_nvar = 0 then
$p$);
  if n = d or position('v_mode text' in n) = 0 or position('bl_comm_0402' in n) = 0 then
    raise exception 'bl_comm_0402: cc_campaign_enqueue anchors not found — definition drifted, patch by hand';
  end if;
  execute n;
end $$;

-- 4b. audience resolution: the preference-centre marketing opt-out now counts (both overloads).
do $$
declare f regprocedure; d text; n text;
begin
  foreach f in array array['app_private.resolve_audience_emails(text,jsonb)'::regprocedure,
                           'app_private.resolve_audience_emails(text)'::regprocedure] loop
    d := pg_get_functiondef(f);
    continue when position('email_pref_optouts' in d) > 0;
    n := replace(d, 'and not coalesce(cp.unsubscribed_all, false))',
      'and not coalesce(cp.unsubscribed_all, false) and not exists (select 1 from app_private.email_pref_optouts po where po.user_id = p.id and po.group_code = ''marketing'' and po.opted_out))');
    n := replace(n, 'and not coalesce(cp.unsubscribed_all,false))',
      'and not coalesce(cp.unsubscribed_all,false) and not exists (select 1 from app_private.email_pref_optouts po where po.user_id = p.id and po.group_code = ''marketing'' and po.opted_out))');
    if n = d then raise exception 'bl_comm_0402: % anchor not found — patch by hand', f; end if;
    execute n;
  end loop;
end $$;

-- 4c. send-time guard: a campaign row is re-checked against the person's marketing preference
--     (a scheduled campaign can wait days between enqueue and send).
create or replace function public.cc_delivery_worker_marketing_allowed(p_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'app_private', 'public'
as $function$
  select coalesce((
    select
      d.status = 'claimed'
      and not exists (
        select 1
          from app_private.suppressions s
         where s.channel = d.channel
           and lower(btrim(s.address)) = lower(btrim(d.recipient_email))
           and (
             s.reason in ('bounced', 'complained')
             or coalesce(d.template_key ~* '^outreach[._-]', false)
             or d.source = 'campaign'
           )
      )
      and (
        not coalesce(d.template_key ~* '^outreach[._-]', false)
        or exists (
          select 1
            from app_private.outreach_contacts oc
           where lower(trim(oc.email)) = lower(btrim(d.recipient_email))
             and oc.status in ('active', 'completed')
             and oc.replied_at is null
             and oc.converted_at is null
        )
      )
      -- bl_comm_0402
      and (
        d.source <> 'campaign' or d.recipient_user is null
        or (
          not exists (select 1 from app_private.email_pref_optouts po
                       where po.user_id = d.recipient_user and po.group_code = 'marketing' and po.opted_out)
          and not exists (select 1 from app_private.comm_preferences cp
                           where cp.user_id = d.recipient_user
                             and (cp.marketing_email is false or coalesce(cp.unsubscribed_all,false)))
        )
      )
    from app_private.message_deliveries d
    where d.id = p_id
      and d.channel = 'email'
      and (coalesce(d.template_key ~* '^outreach[._-]', false) or d.source = 'campaign')
  ), false);
$function$;

-- 4d. catalog: the four shells are wired and start in Test.
update app_private.email_catalog
   set status = 'live', send_mode = 'test', send_mode_at = now(),
       send_mode_note = '0402: campaign shell, starts in Test (enqueue sends 1 copy to the test address)',
       trigger_type = 'manual',
       trigger_source = 'public.cc_campaign_enqueue — pick this template in CC Campaigns',
       cadence = 'per campaign, after approval',
       cap_note = 'one per recipient per campaign (idempotency campaign:email:address)',
       stop_condition = 'recipient has no marketing consent, opted out, unsubscribed, bounced or complained',
       updated_at = now()
 where key in ('mk.newsletter','mk.promotion','mk.reengagement','mk.referral_invite');

select app_private.email_catalog_sync();
