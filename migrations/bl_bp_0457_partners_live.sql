-- bl_bp_0457 — `partners:live`: the partner 360s and the Partners directory stop waiting 30 s.
--   app_private is not in the realtime publication (by design — see app/shared/dispatch-live.js), so the 360s
--   poll. This adds a server-side broadcast: realtime.send() on the PUBLIC topic 'partners:live', event 'partner',
--   payload {org_id, type, at, ...}. The payload is a REFETCH HINT, never data — the CC re-reads cc_partner_360 /
--   cc_partners_accounts; a dropped socket only makes the screen slower (the 30 s poll stays).
--   Fired from: notify_partner (every partner in-app notice, 43 callers) and row triggers on the trust tables
--   (broker_trust, broker_screenings, shipper_trust, broker_identity, agent_parents), the onboarding packet
--   (org_onboarding_items), agreement acceptances and organizations (broker/shipper status or name changes).
--   Every emit is wrapped so a realtime hiccup can never fail the business write.
--   Anon SECDEF surface: unchanged (no public function). Safe to re-run.

create or replace function app_private.partners_live(p_org uuid, p_type text, p_extra jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path to 'app_private, public' as $$
begin
  if p_org is null then return; end if;
  perform realtime.send(jsonb_build_object('org_id', p_org, 'type', coalesce(p_type, 'change'), 'at', now()) || coalesce(p_extra, '{}'::jsonb),
                        'partner', 'partners:live', false);
exception when others then null;   -- a broadcast must never break the write that triggered it
end $$;
revoke all on function app_private.partners_live(uuid, text, jsonb) from public, anon, authenticated;

-- 1. every partner in-app notice announces itself
do $p$
declare src text; a1 text;
begin
  src := pg_get_functiondef('app_private.notify_partner(uuid,text,text,text,text)'::regprocedure);
  if src like '%partners_live%' then raise notice 'bl_bp_0457: notify_partner already patched'; return; end if;
  a1 := E'  values (p_org, p_title, p_body, coalesce(p_kind,''info''), p_url);';
  if src not like '%' || a1 || '%' then raise exception 'bl_bp_0457: notify_partner anchor missing'; end if;
  src := replace(src, a1, a1 || E'\n  perform app_private.partners_live(p_org, ''notice'', jsonb_build_object(''kind'', coalesce(p_kind,''info'')));  -- bl_bp_0457');
  execute src;
end $p$;

-- 2. trust / packet / agreement / account rows
create or replace function app_private.trg_partners_live()
returns trigger language plpgsql security definer set search_path to 'app_private, public' as $$
declare j jsonb; v_org uuid; v_kind text;
begin
  j := to_jsonb(coalesce(NEW, OLD));
  if TG_TABLE_NAME = 'organizations' then
    v_kind := j->>'kind';
    if v_kind not in ('broker','shipper') then return null; end if;
    if TG_OP = 'UPDATE' and NEW.status is not distinct from OLD.status and NEW.name is not distinct from OLD.name
       and NEW.mc_number is not distinct from OLD.mc_number then return null; end if;
    v_org := (j->>'id')::uuid;
  elsif TG_TABLE_NAME = 'agent_parents' then
    v_org := (j->>'agent_org')::uuid;
    if TG_OP <> 'DELETE' and NEW.parent_org_id is not null then
      perform app_private.partners_live(NEW.parent_org_id, 'agent_parents', jsonb_build_object('op', TG_OP, 'agent_org', v_org));
    end if;
  else
    v_org := (j->>'org_id')::uuid;
  end if;
  perform app_private.partners_live(v_org, TG_TABLE_NAME, jsonb_build_object('op', TG_OP));
  return null;
exception when others then return null;
end $$;
revoke all on function app_private.trg_partners_live() from public, anon, authenticated;

do $t$
declare r record;
begin
  for r in select * from (values
      ('app_private','broker_trust'), ('app_private','broker_screenings'), ('app_private','shipper_trust'),
      ('app_private','broker_identity'), ('app_private','agent_parents'), ('app_private','org_onboarding_items'),
      ('app_private','org_agreement_acceptances'), ('public','organizations')) as v(sch, tbl) loop
    if to_regclass(r.sch || '.' || r.tbl) is null then raise notice 'bl_bp_0457: % missing, skipped', r.tbl; continue; end if;
    execute format('drop trigger if exists trg_zz_partners_live on %I.%I', r.sch, r.tbl);
    execute format('create trigger trg_zz_partners_live after insert or update or delete on %I.%I for each row execute function app_private.trg_partners_live()', r.sch, r.tbl);
  end loop;
end $t$;

do $$
declare n int; names text;
begin
  select count(*), string_agg(p.proname, ',' order by p.proname) into n, names
    from pg_proc p join pg_namespace n2 on n2.oid = p.pronamespace
   where n2.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');
  raise notice 'bl_bp_0457: anon SECDEF public = % → %', n, names;
end $$;
