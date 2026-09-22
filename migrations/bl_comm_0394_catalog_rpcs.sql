-- bl_comm_0394: Command Center API for the email catalog.
-- Staff-only, never anon. Read, edit, override, preview, create.

update app_private.email_catalog
   set name = initcap(replace(replace(regexp_replace(key,'^(tx|mk|ops|test)\.','') ,'.',' '),'_',' '))
 where name is null or btrim(name) = '';
update app_private.email_catalog set preference_group = 'staff_internal'
 where preference_group is null and class = 'S';
update app_private.email_catalog set preference_group = 'account_critical'
 where preference_group is null and status in ('live','legacy');

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
      'owner_note',c.owner_note
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
    'summary',(select jsonb_object_agg(status, n) from (select status, count(*) n from app_private.email_catalog group by 1) z));
end $$;

create or replace function public.cc_email_detail(p_key text)
returns jsonb language plpgsql security definer set search_path = public, app_private as $$
declare v_row jsonb; v_sample jsonb; v_recent jsonb;
begin
  if not public.has_global_permission('comm.view') then
    raise exception 'not authorized' using errcode='42501'; end if;
  select to_jsonb(c) || jsonb_build_object(
           'sender', app_private.email_sender_for(c.key),
           'from_address',(select from_address from app_private.email_sender_identities
                            where code = app_private.email_sender_for(c.key)))
    into v_row from app_private.email_catalog c where c.key = p_key;
  if v_row is null then raise exception 'unknown template key' using errcode='22023'; end if;

  -- the real thing that left the building: last body actually sent under this key
  select jsonb_build_object('subject', d.meta->>'subject', 'html', d.meta->>'body_html',
                            'text', d.meta->>'body_text', 'sent_at', d.created_at)
    into v_sample from app_private.message_deliveries d
   where d.template_key = p_key and coalesce(d.meta->>'body_html','') <> ''
   order by d.created_at desc limit 1;

  select coalesce(jsonb_agg(jsonb_build_object('to',r.recipient_email,'status',r.status,
           'at',r.created_at,'opened',r.opened_at,'clicked',r.clicked_at,'failure',r.failure_reason)
           order by r.created_at desc),'[]'::jsonb)
    into v_recent from (select * from app_private.message_deliveries
                         where template_key = p_key order by created_at desc limit 10) r;

  return jsonb_build_object('ok',true,'row',v_row,'sample',coalesce(v_sample,'null'::jsonb),'recent',v_recent);
end $$;

create or replace function public.cc_email_save(p_key text, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path = public, app_private as $$
begin
  if not app_private.can_manage_comms() then
    raise exception 'not authorized' using errcode='42501'; end if;
  update app_private.email_catalog set
    name            = coalesce(p_patch->>'name', name),
    purpose         = coalesce(p_patch->>'purpose', purpose),
    class           = coalesce(p_patch->>'class', class),
    audience_role   = coalesce(p_patch->>'audience_role', audience_role),
    cadence         = coalesce(p_patch->>'cadence', cadence),
    cap_note        = coalesce(p_patch->>'cap_note', cap_note),
    stop_condition  = coalesce(p_patch->>'stop_condition', stop_condition),
    preference_group= coalesce(p_patch->>'preference_group', preference_group),
    unsub_allowed   = coalesce((p_patch->>'unsub_allowed')::boolean, unsub_allowed),
    status          = coalesce(p_patch->>'status', status),
    replaced_by     = coalesce(p_patch->>'replaced_by', replaced_by),
    cc_deep_link    = coalesce(p_patch->>'deep_link', cc_deep_link),
    owner_note      = coalesce(p_patch->>'owner_note', owner_note),
    updated_at      = now()
  where key = p_key;
  if not found then raise exception 'unknown template key' using errcode='22023'; end if;
  return jsonb_build_object('ok',true);
end $$;

-- Override: lets the owner rewrite an email that is hard-coded inside a SQL function.
-- {{BODY}} is replaced with whatever the sending function built, so dynamic data survives.
create or replace function public.cc_email_override_save(p_key text, p_subject text, p_html text, p_active boolean)
returns jsonb language plpgsql security definer set search_path = public, app_private as $$
declare v_code boolean; v_warn text;
begin
  if not app_private.can_manage_comms() then
    raise exception 'not authorized' using errcode='42501'; end if;
  select 'code' = any(discovered_in) into v_code from app_private.email_catalog where key = p_key;
  if v_code is null then raise exception 'unknown template key' using errcode='22023'; end if;
  if coalesce(p_active,false) and v_code and coalesce(p_html,'') not like '%{{BODY}}%' then
    v_warn := 'This email is built in code. Without {{BODY}} in the HTML the dynamic part (names, amounts, links) will be dropped.';
  end if;
  update app_private.email_catalog
     set subject_override = nullif(btrim(coalesce(p_subject,'')),''),
         html_override    = nullif(btrim(coalesce(p_html,'')),''),
         override_active  = coalesce(p_active,false),
         override_updated_by = auth.uid(), override_updated_at = now(), updated_at = now()
   where key = p_key;
  return jsonb_build_object('ok',true,'warning',v_warn);
end $$;

-- Preview: merges an override draft with the last real body, so the owner sees the
-- actual email, not a mock-up. Never sends anything.
create or replace function public.cc_email_preview(p_key text, p_subject text default null, p_html text default null)
returns jsonb language plpgsql security definer set search_path = public, app_private as $$
declare v_body text; v_subj text; v_html text; v_sample record;
begin
  if not public.has_global_permission('comm.view') then
    raise exception 'not authorized' using errcode='42501'; end if;
  select meta->>'body_html' h, meta->>'subject' s into v_sample
    from app_private.message_deliveries
   where template_key = p_key and coalesce(meta->>'body_html','') <> ''
   order by created_at desc limit 1;
  v_body := coalesce(v_sample.h, '<p style="color:#64748b">This template has not been sent yet, so there is no real body to show. Send a test to see it.</p>');
  v_html := coalesce(nullif(btrim(coalesce(p_html,'')),''),
                     (select html_override from app_private.email_catalog where key = p_key));
  v_subj := coalesce(nullif(btrim(coalesce(p_subject,'')),''),
                     (select subject_override from app_private.email_catalog where key = p_key),
                     v_sample.s, p_key);
  if v_html is null then v_html := v_body; else v_html := replace(v_html, '{{BODY}}', v_body); end if;
  return jsonb_build_object('ok',true,'subject',v_subj,'html',v_html,
    'from',(select from_address from app_private.email_sender_identities
             where code = app_private.email_sender_for(p_key)),
    'note','The Command Center shows the inner fragment. delivery-worker wraps it in the brand shell before it leaves.');
end $$;

-- Create a brand new email from the Command Center. It lands in comm_templates
-- (so cc_enqueue_transactional can send it) and in the catalog (so it is never invisible).
create or replace function public.cc_email_template_new(
  p_key text, p_name text, p_subject text, p_html text,
  p_class text default 'T', p_group text default 'account_critical',
  p_audience text default 'carrier', p_purpose text default null)
returns jsonb language plpgsql security definer set search_path = public, app_private as $$
begin
  if not app_private.can_manage_comms() then
    raise exception 'not authorized' using errcode='42501'; end if;
  if p_key !~ '^[a-z0-9]+([._-][a-z0-9]+)+$' then
    raise exception 'key must look like area.thing, lower case' using errcode='22023'; end if;
  if exists (select 1 from app_private.email_catalog where key = p_key) then
    raise exception 'that key already exists' using errcode='23505'; end if;
  if coalesce(btrim(p_html),'') = '' then
    raise exception 'body is required' using errcode='22023'; end if;

  insert into app_private.comm_templates(key,name,channel,subject,body,active,category,status)
  values (p_key, p_name, 'email', p_subject, p_html, true,
          case when p_class in ('M','P') then 'marketing' else 'transactional' end, 'published')
  on conflict (key) do update set name=excluded.name, subject=excluded.subject,
          body=excluded.body, active=true, status='published';

  insert into app_private.email_catalog(key,name,purpose,class,audience_role,trigger_type,
         trigger_source,cadence,preference_group,unsub_allowed,status,cc_deep_link,discovered_in)
  values (p_key,p_name,coalesce(p_purpose,'Created in the Command Center'),p_class,p_audience,'manual',
         'public.cc_enqueue_transactional','on demand',p_group,
         (p_class in ('M','P')),'live','#/comms',array['templates']);

  return jsonb_build_object('ok',true,'key',p_key);
end $$;

revoke all on function public.cc_email_catalog(text,text) from public, anon;
revoke all on function public.cc_email_detail(text) from public, anon;
revoke all on function public.cc_email_save(text,jsonb) from public, anon;
revoke all on function public.cc_email_override_save(text,text,text,boolean) from public, anon;
revoke all on function public.cc_email_preview(text,text,text) from public, anon;
revoke all on function public.cc_email_template_new(text,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.cc_email_catalog(text,text) to authenticated;
grant execute on function public.cc_email_detail(text) to authenticated;
grant execute on function public.cc_email_save(text,jsonb) to authenticated;
grant execute on function public.cc_email_override_save(text,text,text,boolean) to authenticated;
grant execute on function public.cc_email_preview(text,text,text) to authenticated;
grant execute on function public.cc_email_template_new(text,text,text,text,text,text,text,text) to authenticated;
