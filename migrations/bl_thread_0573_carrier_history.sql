-- bl_thread_0573 — a carrier's thread keeps its history across dispatchers
-- When a carrier is moved to a new dispatcher, the new assignment opened an EMPTY thread: the new dispatcher could
-- not see what the carrier had already said (availability, rules, lanes, complaints). Now dispatcher_thread_list
-- returns the carrier's earlier conversations too (carrier / dispatcher / staff messages of the carrier's previous
-- assignments — the old system boilerplate is left out), each previous assignment opened by a divider line
-- "Earlier conversation — previous dispatcher X (dates)". Messages from earlier assignments carry history:true and
-- the previous dispatcher is labelled "· previous dispatcher". Replying to an earlier message is allowed (same carrier).
-- Who can read is unchanged: app_private.disp_role_for(carrier) — the CURRENT dispatcher, the carrier, staff.
-- A removed dispatcher loses access as before.

create or replace function public.dispatcher_thread_list(p_assignment uuid, p_limit integer default 200)
returns jsonb language plpgsql stable security definer
set search_path to 'app_private', 'public' as $function$
declare v_a record; v_role text;
begin
  select * into v_a from app_private.dispatcher_assignments where id = p_assignment;
  if v_a.id is null then return jsonb_build_object('error','not found'); end if;
  v_role := app_private.disp_role_for(v_a.carrier_org_id);
  if v_role is null then return jsonb_build_object('error','not authorized'); end if;
  return jsonb_build_object('role', v_role, 'status', v_a.status, 'participants', jsonb_build_object(
      'dispatcher', (select full_name from app_private.dispatcher_profiles where user_id = v_a.dispatcher_user_id),
      'carrier', (select coalesce(nullif(p.contact_name,''), o.name) from public.organizations o left join public.profiles p on p.id = o.owner_user_id where o.id = v_a.carrier_org_id),
      'staff', 'LoadBoot'),
    'messages', coalesce((select jsonb_agg(x.j order by x.at) from (
      -- real messages: this assignment + the carrier's earlier assignments (no old system boilerplate)
      select m.created_at as at, jsonb_build_object('id', m.id, 'role', m.sender_role, 'body', m.body, 'at', m.created_at,
          'mine', m.sender_user = auth.uid(), 'dept', m.sender_dept, 'history', m.assignment_id <> p_assignment,
          'by', app_private.disp_msg_by(m.sender_role, m.sender_user, m.sender_dept)
                || case when m.assignment_id <> p_assignment and m.sender_role = 'dispatcher' then ' · previous dispatcher' else '' end,
          'reply_to', case when q.id is null then null else jsonb_build_object('id', q.id, 'role', q.sender_role,
              'by', app_private.disp_msg_by(q.sender_role, q.sender_user, q.sender_dept), 'body', left(q.body, 160)) end) as j
        from (select * from app_private.dispatcher_messages dm
               where dm.assignment_id = p_assignment
                  or (dm.carrier_org_id = v_a.carrier_org_id and dm.assignment_id <> p_assignment
                      and dm.sender_role <> 'system' and dm.created_at <= coalesce(v_a.created_at, now()) + interval '1 second'
                      and exists (select 1 from app_private.dispatcher_assignments pa where pa.id = dm.assignment_id and pa.carrier_org_id = v_a.carrier_org_id))
               order by dm.created_at desc limit p_limit) m
        left join app_private.dispatcher_messages q on q.id = m.reply_to
      union all
      -- one divider per earlier assignment that has messages in the window
      select pa.created_at - interval '1 millisecond', jsonb_build_object('id', 'hist-' || pa.id::text, 'role', 'system', 'history', true,
          'at', pa.created_at - interval '1 millisecond', 'mine', false,
          'body', 'Earlier conversation — previous dispatcher ' || coalesce((select full_name from app_private.dispatcher_profiles where user_id = pa.dispatcher_user_id), '—')
                  || ' (' || to_char(pa.created_at at time zone 'America/New_York', 'Mon DD') || ' – '
                  || coalesce(to_char(coalesce((to_jsonb(pa)->>'ended_at')::timestamptz, (to_jsonb(pa)->>'updated_at')::timestamptz) at time zone 'America/New_York', 'Mon DD'), '') || ')')
        from app_private.dispatcher_assignments pa
       where pa.carrier_org_id = v_a.carrier_org_id and pa.id <> p_assignment and pa.created_at < v_a.created_at
         and exists (select 1 from app_private.dispatcher_messages hm where hm.assignment_id = pa.id and hm.sender_role <> 'system')
    ) x), '[]'::jsonb));
end $function$;

-- replying to an earlier message of the SAME carrier is fine now (was: same assignment only)
do $$
declare d text;
begin
  d := pg_get_functiondef('public.dispatcher_thread_send(uuid,text,uuid,text)'::regprocedure);
  if position('where id = p_reply_to and assignment_id = p_assignment)' in d) > 0 then
    d := replace(d, 'where id = p_reply_to and assignment_id = p_assignment)',
                    'where id = p_reply_to and carrier_org_id = v_a.carrier_org_id)');
    execute d;
  end if;
end $$;
