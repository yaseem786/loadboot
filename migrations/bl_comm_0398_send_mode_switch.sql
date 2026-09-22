-- bl_comm_0398: a plain switch on every email — Live / Test / Off.
--
-- Why: the next migrations wire up the 29 planned emails (POD chase, detention, money,
-- security, ratings). Nothing new should reach a real carrier until the owner has seen it
-- with his own eyes. A feature flag in a config table is invisible; a switch on the email's
-- own row in the Command Center is not.
--
--   live  — goes to the real person (what every email does today)
--   test  — goes ONLY to the test address; the real recipient is written in the subject
--           and kept in meta, so nothing is lost and nobody outside is contacted
--   off   — sends to nobody; the attempt is written to email_blocked_log so it is visible
--
-- Everything that exists today is set to 'live', so this migration changes no behaviour.
-- Anything wired from here on is created as 'test'.

alter table app_private.email_catalog
  add column if not exists send_mode text not null default 'live'
    check (send_mode in ('live','test','off')),
  add column if not exists test_to text,
  add column if not exists send_mode_note text,
  add column if not exists send_mode_at timestamptz,
  add column if not exists send_mode_by uuid;

comment on column app_private.email_catalog.send_mode is
 'bl_comm_0398. live = real recipients · test = only the test address, real recipient named in the subject · off = nobody, attempt logged.';

-- where test copies land when a row does not name its own
alter table app_private.email_send_policy
  add column if not exists test_to text not null default 'hello@loadboot.com';

create or replace function app_private.sys_email(
  p_to text, p_template text, p_subject text, p_html text,
  p_text text default null, p_idem text default null)
returns void language plpgsql as $function$
declare
  v_user uuid; v_org uuid; v_cat text; v_group text; v_class text;
  v_subj text := p_subject; v_html text := p_html;
  v_sub_ov text; v_html_ov text; v_ov boolean;
  v_slot timestamptz; v_status text; v_sched timestamptz;
  v_mode text; v_test_to text; v_real_to text := lower(btrim(coalesce(p_to,'')));
begin
  if p_to is null or p_to !~ '^[^@]+@[^@]+\.[^@]+$' then return; end if;
  if exists (select 1 from app_private.suppressions
              where channel='email' and lower(btrim(address))=lower(btrim(p_to))
                and (reason is distinct from 'unsubscribed'
                     or coalesce(p_template ~* '^outreach[._-]', false))) then return; end if;

  perform app_private.email_catalog_touch(p_template);

  select c.class, c.preference_group, c.subject_override, c.html_override,
         coalesce(c.override_active,false), coalesce(c.send_mode,'live'), c.test_to
    into v_class, v_group, v_sub_ov, v_html_ov, v_ov, v_mode, v_test_to
    from app_private.email_catalog c where c.key = p_template;

  -- the switch, before anything else is spent
  if v_mode = 'off' then
    perform app_private.email_block_note(p_template, p_to, null, v_group, 'switched off in the catalog');
    return;
  end if;

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

  v_slot := app_private.email_next_slot(p_to, v_class, v_group);
  if v_slot is null then v_status := 'queued'; v_sched := now();
  else                   v_status := 'scheduled'; v_sched := v_slot; end if;

  if v_mode = 'test' then
    v_test_to := coalesce(nullif(btrim(coalesce(v_test_to,'')),''),
                          (select test_to from app_private.email_send_policy where id),
                          'hello@loadboot.com');
    v_subj := '[TEST → ' || v_real_to || '] ' || coalesce(v_subj,'');
    -- a test copy is not held back: the point is to see it now
    v_status := 'queued'; v_sched := now(); v_slot := null;
  end if;

  insert into app_private.message_deliveries(
      source, channel, provider, recipient_email, recipient_user, org_id,
      idempotency_key, status, scheduled_at, template_key, meta)
  values ('transactional','email','resend',
    case when v_mode = 'test' then lower(v_test_to) else v_real_to end,
    case when v_mode = 'test' then null else v_user end,
    case when v_mode = 'test' then null else v_org end,
    coalesce(p_idem, 'sys:'||p_template||':'||v_real_to||':'||extract(epoch from now())::bigint::text)
      || case when v_mode='test' then ':test' else '' end,
    v_status, v_sched, p_template,
    jsonb_build_object('subject', app_private.contact_expand(v_subj, true),
                       'body_html', app_private.contact_expand(v_html, false),
                       'body_text', app_private.contact_expand(coalesce(p_text, v_subj), true),
                       'category', v_cat,
                       'class', coalesce(v_class,'unclassified'),
                       'preference_group', v_group,
                       'sender', app_private.email_sender_for(p_template),
                       'override', v_ov,
                       'held_until', v_slot,
                       'send_mode', v_mode,
                       'intended_for', case when v_mode='test' then v_real_to else null end))
  on conflict (idempotency_key) do nothing;
end $function$;

-- the switch, from the Command Center
create or replace function public.cc_email_mode(p_key text, p_mode text, p_test_to text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, app_private as $$
begin
  if not app_private.can_manage_comms() then
    raise exception 'not authorized' using errcode='42501'; end if;
  if coalesce(p_mode,'') not in ('live','test','off') then
    raise exception 'mode must be live, test or off' using errcode='22023'; end if;

  update app_private.email_catalog
     set send_mode = p_mode,
         test_to = nullif(btrim(coalesce(p_test_to,'')),''),
         send_mode_note = nullif(btrim(coalesce(p_note,'')),''),
         send_mode_at = now(), send_mode_by = auth.uid(), updated_at = now()
   where key = p_key;
  if not found then raise exception 'unknown template key' using errcode='22023'; end if;

  return jsonb_build_object('ok',true,'key',p_key,'send_mode',p_mode);
end $$;

revoke all on function public.cc_email_mode(text,text,text,text) from public, anon;
grant execute on function public.cc_email_mode(text,text,text,text) to authenticated;

-- surface the switch in the list and the drawer
create or replace function public.cc_email_catalog(p_status text default null, p_q text default null)
returns jsonb language plpgsql security definer set search_path = public, app_private as $$
declare v jsonb;
begin
  if not public.has_global_permission('comm.view') then
    raise exception 'not authorized' using errcode='42501'; end if;
  select coalesce(jsonb_agg(x order by x->>'group_sort', x->>'name'),'[]'::jsonb) into v from (
    select jsonb_build_object(
      'key',c.key,'name',c.name,'purpose',c.purpose,'class',c.class,
      'class_label', case c.class when 'T' then 'Transactional' when 'O' then 'Operational'
                                  when 'P' then 'Lifecycle' when 'M' then 'Marketing'
                                  when 'S' then 'Staff alert' else 'Unclassified' end,
      'audience_role',c.audience_role,'trigger_type',c.trigger_type,'trigger_source',c.trigger_source,
      'cadence',c.cadence,'cap_note',c.cap_note,'stop_condition',c.stop_condition,
      'preference_group',c.preference_group,'group_label',g.label,'group_sort',lpad(coalesce(g.sort,99)::text,3,'0'),
      'opt_out_allowed',coalesce(g.opt_out_allowed,false),'unsub_allowed',c.unsub_allowed,
      'sender', s.code, 'from_address', s.from_address, 'reply_to', s.reply_to,
      'status',c.status,'replaced_by',c.replaced_by,'deep_link',c.cc_deep_link,
      'sends_total',c.sends_total,'sends_30d',c.sends_30d,'last_seen',c.last_seen,
      'has_override',c.override_active,'discovered_in',to_jsonb(c.discovered_in),
      'owner_note',c.owner_note,
      'send_mode',coalesce(c.send_mode,'live'),'test_to',c.test_to,'send_mode_note',c.send_mode_note
    ) x
    from app_private.email_catalog c
    left join app_private.email_pref_groups g on g.code = c.preference_group
    left join app_private.email_sender_identities s on s.code = app_private.email_sender_for(c.key)
    where (p_status is null or c.status = p_status)
      and (p_q is null or c.key ilike '%'||p_q||'%' or coalesce(c.name,'') ilike '%'||p_q||'%'
           or coalesce(c.purpose,'') ilike '%'||p_q||'%' or coalesce(c.trigger_source,'') ilike '%'||p_q||'%')
  ) t;
  return jsonb_build_object('ok',true,'rows',v,
    'groups',(select coalesce(jsonb_agg(to_jsonb(g) order by g.sort),'[]'::jsonb) from app_private.email_pref_groups g),
    'senders',(select coalesce(jsonb_agg(to_jsonb(s) order by s.code),'[]'::jsonb) from app_private.email_sender_identities s),
    'modes',(select jsonb_object_agg(send_mode, n) from (select coalesce(send_mode,'live') send_mode, count(*) n from app_private.email_catalog group by 1) m),
    'summary',(select jsonb_object_agg(status, n) from (select status, count(*) n from app_private.email_catalog group by 1) z));
end $$;
