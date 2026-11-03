-- bl_fleet_0595 — driver invite + dispatcher card fixes (owner, 3 Nov 2026; Cascade Cargo case)
-- Across all carriers 8 invites had gone out and 0 were ever accepted. What this closes:
--   1. cc_driver_invite_peek: also says whether a NEWER live invite exists, with masked email hints. The invite page reads it
--      through the driver-join edge function (service role) — peek stays OFF the anon surface.
--   2. cc_accept_driver_invite: a revoked/expired link now joins through the newest live invite of the same carrier IF the
--      caller's CONFIRMED login email is that invite's email. Everyone else gets a plain sentence, never "invite is revoked".
--   3. cc_my_driver_context: role 'unlinked' now carries the login email and, for a confirmed match, the live invite to join.
--   4. carrier_dispatcher_desk readiness: "driver" also counts fleet_trucks.default_driver_id (the Fleet tab, bl_fleet_0592);
--      "availability" also counts an active truck_postings row confirmed in the last 24 h (what the carrier form writes).
--      The 24 h window is unchanged on purpose: avail_expire_stale expires postings at 24 h and daily posting is the owner's rule.
--   5. cc_carrier_invite_driver: the driver record follows the email the owner just typed (it only filled a blank before).
-- Security: no new public function; anon surface unchanged.

create or replace function app_private.lb_mask_email(p text) returns text
language sql immutable as $$
  select case when coalesce(p,'') !~ '@' then null
              else left(split_part(lower(p),'@',1),1) || '***@' || split_part(lower(p),'@',2) end
$$;
revoke execute on function app_private.lb_mask_email(text) from public, anon, authenticated;

do $mig$
declare r record; d text;
begin
  for r in select * from (values
    -- 1. peek
    ('public.cc_driver_invite_peek(text)',
     $a$'require_android_app', coalesce(v_req,true), 'expires_at', inv.expires_at);$a$,
     $b$'require_android_app', coalesce(v_req,true), 'expires_at', inv.expires_at,
    'email_hint', app_private.lb_mask_email(inv.email)) || coalesce((select jsonb_build_object('newer_pending', true, 'newer_email_hint', app_private.lb_mask_email(n.email))
      from app_private.carrier_driver_invites n where n.carrier_org = inv.carrier_org and n.id <> inv.id and n.status = 'pending' and n.expires_at > now()
       and (n.fleet_driver_id = inv.fleet_driver_id or lower(n.email) = lower(inv.email)) order by n.created_at desc limit 1), jsonb_build_object('newer_pending', false));$b$),
    -- 2. accept
    ('public.cc_accept_driver_invite(text,text)',
     $a$declare inv record;$a$,
     $b$declare v_new record; v_email text; inv record;$b$),
    ('public.cc_accept_driver_invite(text,text)',
     $a$  if inv.status <> 'pending' then raise exception 'invite is %', inv.status using errcode='22023'; end if;
  if inv.expires_at < now() then
    update app_private.carrier_driver_invites set status='expired' where id=inv.id;
    raise exception 'invite has expired — ask the carrier to resend' using errcode='22023';
  end if;$a$,
     $b$  if inv.status = 'accepted' then raise exception 'invite is accepted' using errcode='22023'; end if;
  if inv.status <> 'pending' or inv.expires_at < now() then   -- bl_fleet_0595: an old link still works for the person the newest invite was sent to
    select lower(u.email) into v_email from auth.users u where u.id = auth.uid() and u.email_confirmed_at is not null;
    select i.* into v_new from app_private.carrier_driver_invites i
     where v_email is not null and i.carrier_org = inv.carrier_org and i.id <> inv.id and i.status = 'pending' and i.expires_at > now() and lower(i.email) = v_email
     order by i.created_at desc limit 1 for update;
    if v_new.id is null then
      if inv.status = 'revoked' then raise exception 'This invite link was replaced by a newer one. Open the newest invite email from your carrier, or ask them to send a new invite.' using errcode='22023'; end if;
      raise exception 'This invite has expired — ask the carrier to resend it.' using errcode='22023';
    end if;
    inv := v_new;
  end if;$b$),
    -- 3. unlinked
    ('public.cc_my_driver_context()',
     $a$return jsonb_build_object('role','unlinked','reason','no_carrier');$a$,
     $b$return (select jsonb_build_object('role','unlinked','reason','no_carrier','email',u.email,'invite',
        (select jsonb_build_object('token',i.token,'carrier',o.name) from app_private.carrier_driver_invites i join public.organizations o on o.id = i.carrier_org
          where u.email_confirmed_at is not null and lower(i.email) = lower(u.email) and i.status = 'pending' and i.expires_at > now() order by i.created_at desc limit 1))
        from auth.users u where u.id = auth.uid());$b$),
    -- 4. readiness
    ('public.carrier_dispatcher_desk()',
     $a$av.updated_at av_at, av.driver_name av_driver,$a$,
     $b$greatest(av.updated_at, (select max(coalesce(tp.last_confirmed_at, tp.created_at)) from app_private.truck_postings tp where tp.truck_id = t.id and tp.carrier_id = t.carrier_id and tp.status = 'active' and coalesce(tp.available_to, current_date) >= current_date)) av_at,
                           coalesce(nullif(av.driver_name,''), (select coalesce(nullif(dd.name,''),'set') from app_private.fleet_drivers dd where dd.id = t.default_driver_id and dd.carrier_id = t.carrier_id and coalesce(dd.status,'active') <> 'inactive')) av_driver,$b$),
    ('public.carrier_dispatcher_desk()',
     $a$then 'fleet/add-driver' else 'dashboard/availability' end$a$,
     $b$then 'fleet/add-driver' else 'fleet' end$b$),
    ('public.carrier_dispatcher_desk()',
     $a$no driver set' else 'Every truck has a driver' end$a$,
     $b$no driver set — pick one in Fleet' else 'Every truck has a driver' end$b$),
    -- 5. email sync
    ('public.cc_carrier_invite_driver(uuid,text,text,text[],text,text[])',
     $a$where id = p_fleet_driver and (email is null or email = '');$a$,
     $b$where id = p_fleet_driver and lower(coalesce(email,'')) <> v_email;$b$)
  ) as x(fn, anchor, repl) loop
    d := pg_get_functiondef(r.fn::regprocedure);
    if position(r.anchor in d) = 0 then raise exception 'bl_fleet_0595: anchor not found in %: %', r.fn, left(r.anchor, 70); end if;
    execute replace(d, r.anchor, r.repl);
  end loop;
end $mig$;

-- The one record the old rule left wrong: the owner's latest invite went to this address.
update app_private.fleet_drivers d set email = i.email, updated_at = now()
  from app_private.carrier_driver_invites i
 where d.id = '1663235a-82df-4ace-aa17-c4b2bcfce833' and i.id = 'f0bdf9c7-55b6-4cbc-89c7-bc9481cb5bad'
   and i.fleet_driver_id = d.id and i.status = 'pending' and lower(coalesce(d.email,'')) <> lower(i.email);
