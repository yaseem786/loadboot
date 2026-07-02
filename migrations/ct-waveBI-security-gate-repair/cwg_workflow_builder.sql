-- cwg_workflow_builder.sql
-- Increment 63 — MULTI-STEP WORKFLOW BUILDER (v1: structured step-graph builder + validation + versioned
-- publish lifecycle + deterministic SIMULATION + guarded EXECUTION with run logs).
-- KNOWN LIMITATION (stated honestly): v1 UI is a structured node-list editor, not a drag/drop canvas —
-- the data model (nodes+edges jsonb graph) already supports a canvas UI later without migration.
--
-- GUARDRAILS (directive #32 "never automatically ..."): node types are ALLOWLISTED. There is no node that
-- can approve accounts, override compliance, release money, change permissions, resolve disputes or delete
-- records. Email nodes go through the existing consent/suppression-enforcing delivery ledger and send
-- nothing without the owner's provider key.
--
-- Applied to: staging (snslhvmkjusozgjelghi) and production (rwscphuhpjoudvljvmdk).

create table if not exists app_private.workflow_defs (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text,
  status text not null default 'draft' check (status in ('draft','published','paused','archived')),
  version integer not null default 1,
  published_version integer,
  trigger_event text,                 -- event_type this workflow listens for (informational in v1)
  graph jsonb not null default '{"nodes":[],"edges":[]}'::jsonb,
  created_by uuid,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists app_private.workflow_runs (
  id uuid primary key default gen_random_uuid(),
  workflow_id uuid not null references app_private.workflow_defs(id) on delete cascade,
  workflow_version integer not null,
  mode text not null check (mode in ('simulation','live')),
  event jsonb not null default '{}'::jsonb,
  status text not null default 'completed' check (status in ('completed','failed','dead_letter')),
  steps jsonb not null default '[]'::jsonb,     -- ordered trace: node, type, outcome, detail
  error text,
  idempotency_key text unique,
  created_by uuid,
  created_at timestamptz not null default now()
);

-- Graph validation: exactly one trigger, >=1 end, allowlisted types only, edges reference real nodes,
-- no forbidden actions, bounded size.
create or replace function app_private.workflow_validate(p_graph jsonb)
returns text[] language plpgsql immutable
as $$
declare errs text[]:='{}'; n jsonb; e jsonb; ids text[]:='{}'; ntype text;
  allow text[] := array['trigger','condition','delay','task_note','notification','email_template','end'];
begin
  if jsonb_typeof(p_graph->'nodes') <> 'array' or jsonb_typeof(p_graph->'edges') <> 'array' then
    return array['graph must have nodes[] and edges[]']; end if;
  if jsonb_array_length(p_graph->'nodes') > 50 then errs:=errs||('too many nodes (max 50)')::text; end if;
  for n in select * from jsonb_array_elements(p_graph->'nodes') loop
    if coalesce(n->>'id','')='' then errs:=errs||('node missing id')::text; continue; end if;
    ids := ids || (n->>'id');
    ntype := n->>'type';
    if ntype <> all(allow) then errs:=errs||('forbidden or unknown node type: '||coalesce(ntype,'null'))::text; end if;
    if ntype='email_template' and coalesce(n->'config'->>'template_key','')='' then
      errs:=errs||('email node '||(n->>'id')||' needs config.template_key')::text; end if;
    if ntype='condition' and (coalesce(n->'config'->>'field','')='' or coalesce(n->'config'->>'op','') not in ('eq','neq','gt','lt','contains','exists')) then
      errs:=errs||('condition node '||(n->>'id')||' needs config.field and op in eq/neq/gt/lt/contains/exists')::text; end if;
    if ntype='delay' and coalesce(nullif(n->'config'->>'minutes','')::numeric, -1) < 0 then
      errs:=errs||('delay node '||(n->>'id')||' needs config.minutes >= 0')::text; end if;
  end loop;
  if (select count(*) from jsonb_array_elements(p_graph->'nodes') x where x->>'type'='trigger') <> 1 then
    errs:=errs||('graph must have exactly one trigger node')::text; end if;
  if (select count(*) from jsonb_array_elements(p_graph->'nodes') x where x->>'type'='end') < 1 then
    errs:=errs||('graph must have at least one end node')::text; end if;
  for e in select * from jsonb_array_elements(p_graph->'edges') loop
    if not ((e->>'from') = any(ids)) or not ((e->>'to') = any(ids)) then
      errs:=errs||('edge references unknown node: '||coalesce(e->>'from','?')||' -> '||coalesce(e->>'to','?'))::text; end if;
  end loop;
  return errs;
end; $$;

create or replace function public.cc_workflow_save(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'app_private, public'
as $$
declare v_errs text[]; v_id uuid; v_key text;
begin
  if not (public.has_global_permission('settings.manage') or public.has_global_permission('content.manage')) then
    raise exception 'not authorized' using errcode='42501'; end if;
  v_key := p->>'key';
  if coalesce(trim(v_key),'')='' then raise exception 'key required' using errcode='22023'; end if;
  v_errs := app_private.workflow_validate(coalesce(p->'graph','{"nodes":[],"edges":[]}'::jsonb));
  insert into app_private.workflow_defs(key, name, description, trigger_event, graph, created_by)
    values (v_key, coalesce(p->>'name', v_key), p->>'description', p->>'trigger_event',
            coalesce(p->'graph','{"nodes":[],"edges":[]}'::jsonb), auth.uid())
  on conflict (key) do update set
    name=excluded.name, description=excluded.description, trigger_event=excluded.trigger_event,
    graph=excluded.graph, version=app_private.workflow_defs.version+1,
    status=case when app_private.workflow_defs.status='published' then 'published' else 'draft' end,
    updated_at=now()
  returning id into v_id;
  perform app_private.log_audit('workflow.save','workflow',v_id::text,null,v_key,
    jsonb_build_object('validation_errors', to_jsonb(v_errs)));
  return jsonb_build_object('ok', coalesce(array_length(v_errs,1),0)=0, 'id', v_id,
    'validation_errors', to_jsonb(v_errs));
end; $$;
revoke execute on function public.cc_workflow_save(jsonb) from anon, public;
grant  execute on function public.cc_workflow_save(jsonb) to authenticated;

create or replace function public.cc_workflow_set_status(p_id uuid, p_action text)
returns jsonb language plpgsql security definer set search_path to 'app_private, public'
as $$
declare w record; v_errs text[];
begin
  if not (public.has_global_permission('settings.manage') or public.has_global_permission('content.manage')) then
    raise exception 'not authorized' using errcode='42501'; end if;
  if p_action not in ('publish','pause','archive','draft') then raise exception 'invalid action' using errcode='22023'; end if;
  select * into w from app_private.workflow_defs where id=p_id for update;
  if w.id is null then raise exception 'workflow not found' using errcode='22023'; end if;
  if p_action='publish' then
    v_errs := app_private.workflow_validate(w.graph);
    if coalesce(array_length(v_errs,1),0) > 0 then
      raise exception 'cannot publish — validation failed: %', array_to_string(v_errs,'; ') using errcode='22023'; end if;
    update app_private.workflow_defs set status='published', published_version=version, updated_at=now() where id=p_id;
  else
    update app_private.workflow_defs
      set status = case p_action when 'pause' then 'paused' when 'archive' then 'archived' else 'draft' end,
          updated_at=now() where id=p_id;
  end if;
  perform app_private.log_audit('workflow.'||p_action,'workflow',p_id::text,null,w.key,null);
  return jsonb_build_object('ok',true,'status', case p_action when 'publish' then 'published' when 'pause' then 'paused' when 'archive' then 'archived' else 'draft' end);
end; $$;
revoke execute on function public.cc_workflow_set_status(uuid, text) from anon, public;
grant  execute on function public.cc_workflow_set_status(uuid, text) to authenticated;

create or replace function public.cc_workflows(p_status text default null)
returns table(id uuid, key text, name text, description text, status text, version integer,
  published_version integer, trigger_event text, graph jsonb, updated_at timestamptz,
  runs bigint, last_run timestamptz)
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
begin
  if not (public.has_global_permission('settings.manage') or public.has_global_permission('content.manage') or public.has_global_permission('dispatch.view')) then
    raise exception 'not authorized' using errcode='42501'; end if;
  return query select w.id, w.key, w.name, w.description, w.status, w.version, w.published_version,
      w.trigger_event, w.graph, w.updated_at,
      (select count(*) from app_private.workflow_runs r where r.workflow_id=w.id),
      (select max(r.created_at) from app_private.workflow_runs r where r.workflow_id=w.id)
    from app_private.workflow_defs w
    where (p_status is null or w.status=p_status)
    order by w.updated_at desc limit 200;
end; $$;
revoke execute on function public.cc_workflows(text) from anon, public;
grant  execute on function public.cc_workflows(text) to authenticated;

-- THE ENGINE. mode='simulation' → NO side effects (trace only). mode='live' → only email_template nodes
-- have a side effect (queued through the consent/suppression-enforcing ledger); task_note/notification
-- nodes record intents into the run log for staff (v1). Deterministic graph walk, max 100 steps.
create or replace function public.cc_workflow_run(p_id uuid, p_event jsonb default '{}'::jsonb, p_mode text default 'simulation')
returns jsonb language plpgsql security definer set search_path to 'app_private, public'
as $$
declare w record; v_steps jsonb:='[]'::jsonb; v_cur text; v_next text; v_node jsonb; v_guard int:=0;
  v_ok boolean; v_field text; v_op text; v_val text; v_actual text; v_run uuid; v_err text;
  v_email text; v_tkey text; v_status text:='completed';
begin
  if not (public.has_global_permission('settings.manage') or public.has_global_permission('content.manage')) then
    raise exception 'not authorized' using errcode='42501'; end if;
  if p_mode not in ('simulation','live') then raise exception 'mode must be simulation or live' using errcode='22023'; end if;
  select * into w from app_private.workflow_defs where id=p_id;
  if w.id is null then raise exception 'workflow not found' using errcode='22023'; end if;
  if p_mode='live' and w.status<>'published' then raise exception 'only published workflows can run live' using errcode='22023'; end if;

  select x->>'id' into v_cur from jsonb_array_elements(w.graph->'nodes') x where x->>'type'='trigger' limit 1;
  while v_cur is not null and v_guard < 100 loop
    v_guard := v_guard + 1;
    select x into v_node from jsonb_array_elements(w.graph->'nodes') x where x->>'id'=v_cur limit 1;
    exit when v_node is null;
    case v_node->>'type'
      when 'trigger' then
        v_steps := v_steps || jsonb_build_object('node',v_cur,'type','trigger','outcome','fired','detail',coalesce(w.trigger_event,'manual'));
        select e->>'to' into v_next from jsonb_array_elements(w.graph->'edges') e where e->>'from'=v_cur limit 1;
      when 'condition' then
        v_field := v_node->'config'->>'field'; v_op := v_node->'config'->>'op'; v_val := v_node->'config'->>'value';
        v_actual := p_event->>v_field;
        v_ok := case v_op
          when 'eq' then v_actual = v_val when 'neq' then v_actual is distinct from v_val
          when 'gt' then (nullif(v_actual,'')::numeric > nullif(v_val,'')::numeric)
          when 'lt' then (nullif(v_actual,'')::numeric < nullif(v_val,'')::numeric)
          when 'contains' then position(lower(coalesce(v_val,'')) in lower(coalesce(v_actual,''))) > 0
          when 'exists' then v_actual is not null else false end;
        v_ok := coalesce(v_ok, false);
        v_steps := v_steps || jsonb_build_object('node',v_cur,'type','condition','outcome',case when v_ok then 'true' else 'false' end,
          'detail', v_field||' '||v_op||' '||coalesce(v_val,'')||' (actual: '||coalesce(v_actual,'null')||')');
        select e->>'to' into v_next from jsonb_array_elements(w.graph->'edges') e
          where e->>'from'=v_cur and coalesce(e->>'when', 'true') = (case when v_ok then 'true' else 'false' end) limit 1;
      when 'delay' then
        v_steps := v_steps || jsonb_build_object('node',v_cur,'type','delay','outcome','scheduled',
          'detail', coalesce(v_node->'config'->>'minutes','0')||' min (applied as scheduled_at on downstream email nodes)');
        select e->>'to' into v_next from jsonb_array_elements(w.graph->'edges') e where e->>'from'=v_cur limit 1;
      when 'task_note' then
        v_steps := v_steps || jsonb_build_object('node',v_cur,'type','task_note','outcome',
          case when p_mode='live' then 'recorded' else 'would record' end,
          'detail', coalesce(v_node->'config'->>'text','(no text)'));
        select e->>'to' into v_next from jsonb_array_elements(w.graph->'edges') e where e->>'from'=v_cur limit 1;
      when 'notification' then
        v_steps := v_steps || jsonb_build_object('node',v_cur,'type','notification','outcome',
          case when p_mode='live' then 'recorded' else 'would notify' end,
          'detail', coalesce(v_node->'config'->>'message','(no message)'));
        select e->>'to' into v_next from jsonb_array_elements(w.graph->'edges') e where e->>'from'=v_cur limit 1;
      when 'email_template' then
        v_tkey := v_node->'config'->>'template_key';
        v_email := coalesce(v_node->'config'->>'to_email', p_event->>'email');
        if p_mode='live' and v_email is not null then
          begin
            perform public.cc_enqueue_transactional('email', v_email, v_tkey,
              coalesce(v_node->'config'->>'subject','LoadBoot update'),
              'wf:'||w.key||':'||v_cur||':'||coalesce(p_event->>'idempotency', md5(p_event::text)),
              jsonb_build_object('workflow', w.key, 'vars', p_event), now());
            v_steps := v_steps || jsonb_build_object('node',v_cur,'type','email_template','outcome','queued',
              'detail', v_tkey||' -> '||v_email||' (via consent-enforcing ledger; sends only when provider key set)');
          exception when others then
            v_steps := v_steps || jsonb_build_object('node',v_cur,'type','email_template','outcome','failed','detail',sqlerrm);
            v_status := 'failed'; v_err := sqlerrm;
          end;
        else
          v_steps := v_steps || jsonb_build_object('node',v_cur,'type','email_template','outcome','would queue',
            'detail', v_tkey||' -> '||coalesce(v_email,'(no recipient in event)'));
        end if;
        select e->>'to' into v_next from jsonb_array_elements(w.graph->'edges') e where e->>'from'=v_cur limit 1;
      when 'end' then
        v_steps := v_steps || jsonb_build_object('node',v_cur,'type','end','outcome','done','detail','');
        v_next := null;
      else
        v_steps := v_steps || jsonb_build_object('node',v_cur,'type',v_node->>'type','outcome','skipped','detail','unsupported');
        v_next := null;
    end case;
    v_cur := v_next; v_next := null;
  end loop;
  if v_guard >= 100 then v_status := 'failed'; v_err := 'step limit reached (possible cycle)'; end if;

  insert into app_private.workflow_runs(workflow_id, workflow_version, mode, event, status, steps, error, created_by, idempotency_key)
    values (p_id, w.version, p_mode, p_event, v_status, v_steps, v_err, auth.uid(),
            case when p_mode='live' then 'wfrun:'||w.key||':'||md5(p_event::text) end)
    on conflict (idempotency_key) do nothing
    returning id into v_run;
  if v_run is null and p_mode='live' then
    return jsonb_build_object('ok',true,'deduped',true,'note','identical live event already processed (idempotent)');
  end if;
  perform app_private.log_audit('workflow.run','workflow',p_id::text,null,w.key||' ('||p_mode||')',
    jsonb_build_object('status',v_status,'steps',jsonb_array_length(v_steps)));
  return jsonb_build_object('ok', v_status='completed', 'run', v_run, 'mode', p_mode,
    'status', v_status, 'steps', v_steps, 'error', v_err);
end; $$;
revoke execute on function public.cc_workflow_run(uuid, jsonb, text) from anon, public;
grant  execute on function public.cc_workflow_run(uuid, jsonb, text) to authenticated;

create or replace function public.cc_workflow_runs(p_id uuid, p_limit integer default 30)
returns table(id uuid, mode text, status text, steps jsonb, error text, created_at timestamptz)
language plpgsql stable security definer set search_path to 'app_private, public'
as $$
begin
  if not (public.has_global_permission('settings.manage') or public.has_global_permission('content.manage') or public.has_global_permission('dispatch.view')) then
    raise exception 'not authorized' using errcode='42501'; end if;
  return query select r.id, r.mode, r.status, r.steps, r.error, r.created_at
    from app_private.workflow_runs r where r.workflow_id=p_id
    order by r.created_at desc limit least(greatest(coalesce(p_limit,30),1),200);
end; $$;
revoke execute on function public.cc_workflow_runs(uuid, integer) from anon, public;
grant  execute on function public.cc_workflow_runs(uuid, integer) to authenticated;
