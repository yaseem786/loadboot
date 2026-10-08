-- bl_fill_0535 — call → field suggestions: nothing saves without a click (8 Oct 2026)
--
-- After a dialer call the dispatcher can ask the brain to read THAT call's note + transcript and list candidate
-- values for app_private.carrier_fill_fields only — each with the exact quote it came from. The dispatcher portal
-- shows them as "From this call" rows: [Save] [Edit] [Skip]. Save on an empty field = the normal
-- dispatcher fill path (cfs_write, stamped dispatcher); on a locked field = a bl_fill_0534 suggestion
-- (source 'call_ai', source_call_id set) that the carrier or LoadBoot confirms. The brain never writes a field.
--
-- Uses the Claude Ops Brain that already exists (bl_brain_0470/0472/0475): a new SOURCE + ROUTE 'call_fields',
-- its brain_permissions row in this same file (CLAUDE.md §9), model/effort/max_tokens per route in brain_config
-- (owner-editable, default claude-sonnet-5 / low / 4000), lean system block (no KB inline), no tools.
-- The job result's `reply` is a JSON array (the brain's fixed output schema keeps reply a string); the sink parses it,
-- validates every candidate against the catalog, the carrier's trucks and the call text (the quote must literally
-- appear in the note or transcript), and stores them in app_private.call_field_candidates.
--
--   public.dispatcher_call_fields_request(p_call)              enqueue (the call's own dispatcher, active assignment)
--   public.dispatcher_call_fields(p_call)                       job state + candidates with the field's current state
--   public.dispatcher_call_field_apply(p_candidate, p_action, p_value)   'save' | 'skip' (p_value = edited value)
--   app_private.call_fields_prompt(ctx) / call_fields_sink(job) / brain_sink branch
-- Additive + reversible: drop the 3 public functions, the 2 app_private ones, the table; remove the brain_sink branch,
-- the brain_user_text line, the permission row and the config keys (comments at the end).

begin;

-- 1. the brain may carry the new source
alter table app_private.brain_jobs drop constraint if exists brain_jobs_source_check;
alter table app_private.brain_jobs add constraint brain_jobs_source_check check (source = any (array[
  'chat','assist','email','wa','onboarding','dispatch','sales','sweep','voice','test','loads_email','call_fields']));

-- 2. the permission row (§9) — on, 100 calls/day, $2/day; mode 'prep' = it only ever PROPOSES
insert into app_private.brain_permissions
  (key, kind, name, label, description, enabled, mode, risk, status, max_per_day, usd_cap_daily, builtin, note)
values
  ('source.call_fields', 'source', 'call_fields', 'Call → carrier field suggestions',
   'After a dispatcher call, Claude reads that call''s note + transcript and lists candidate values for the carrier work-sheet fields, each with the exact quote. Nothing is written: the dispatcher clicks Save (empty field) or it becomes a suggestion the carrier confirms (locked field). No tools.',
   true, 'prep', 'low', 'live', 100, 2.00, false,
   'bl_fill_0535. Model/effort/max_tokens: brain_config.model_by_route / effort / max_tokens ->> call_fields.')
on conflict (key) do nothing;
select app_private.brain_log('source.call_fields', 'add', null,
  (select to_jsonb(p) from app_private.brain_permissions p where p.key = 'source.call_fields'),
  'bl_fill_0535: call → field suggestions');

-- 3. model + effort + max_tokens for the route; lean system block (rules + facts, no KB inline)
update app_private.brain_config
   set model_by_route = model_by_route || '{"call_fields":"claude-sonnet-5"}'::jsonb,
       effort         = effort         || '{"call_fields":"low"}'::jsonb,
       max_tokens     = max_tokens     || '{"call_fields":4000}'::jsonb,
       lean_routes    = case when 'call_fields' = any(coalesce(lean_routes, '{}')) then lean_routes else array_append(coalesce(lean_routes, '{}'), 'call_fields') end,
       updated_at     = now()
 where id and not (model_by_route ? 'call_fields');
select app_private.brain_log('config', 'config', null,
  jsonb_build_object('model_by_route', jsonb_build_object('call_fields', 'claude-sonnet-5'), 'effort', jsonb_build_object('call_fields', 'low'), 'max_tokens', jsonb_build_object('call_fields', 4000), 'lean_routes', '+call_fields'),
  'bl_fill_0535: route call_fields');

-- 4. candidates
create table if not exists app_private.call_field_candidates (
  id                 bigserial primary key,
  call_id            uuid not null references app_private.dialer_calls(id) on delete cascade,
  job_id             bigint,
  carrier_org_id     uuid not null,
  dispatcher_user_id uuid not null,
  tbl                text not null,
  field              text not null,
  truck_id           uuid,
  value              jsonb not null,
  quote              text not null,
  note               text,
  status             text not null default 'new' check (status in ('new','saved','suggested','skipped')),
  suggestion_id      bigint,
  created_at         timestamptz not null default now(),
  decided_at         timestamptz
);
create index if not exists cfc_call_idx on app_private.call_field_candidates (call_id, status);
alter table app_private.call_field_candidates enable row level security;
revoke all on table app_private.call_field_candidates from public, anon, authenticated;

-- 5. the prompt (user turn). Everything the model may touch is in here; the system block is the brain's own.
create or replace function app_private.call_fields_prompt(p_context jsonb)
returns text language sql stable set search_path = app_private, public as $$
  select 'TASK: read ONE phone call between a LoadBoot dispatcher and a carrier (owner-operator) and list the carrier-profile FIELDS the carrier answered on this call.'
    || E'\n\nRESPONSE FORMAT — put ONLY a JSON array in "reply" (no prose, no markdown fences). Empty array [] when nothing was clearly said. Each item:'
    || E'\n  {"tbl": "<profile|prefs|truck>", "field": "<field>", "truck_id": "<uuid or null>", "value": <typed value>, "quote": "<the carrier''s exact words, copied verbatim from the NOTE or TRANSCRIPT>", "note": "<condition or context, or empty>"}'
    || E'\nSet "lang" to en or es, "confidence" to your overall confidence (0-1), "escalate" false, "escalate_reason" "", "actions" [].'
    || E'\n\nRULES (hard):'
    || E'\n- Only fields from the CATALOG below. Never invent a field. Never invent a value.'
    || E'\n- Only what the CARRIER said about THEMSELVES. The dispatcher''s questions, guesses or offers are not answers.'
    || E'\n- Unclear, hedged, contradictory, or a guess → leave it out. One field at most once.'
    || E'\n- A range or a condition ("$2 if it''s local, $2.50 OTR", "weekends only in summer") → put the literal value that was said in "value" and the condition in "note"; if no single value was said, leave it out.'
    || E'\n- "quote" MUST be a verbatim substring of the NOTE or the TRANSCRIPT text below (copy it exactly, keep it short: one sentence). No quote → no item.'
    || E'\n- Types: bool → true/false; number/money → a plain number (no $ or units); list → an array of strings, using the catalog OPTIONS spelling when the option exists; text → a short string.'
    || E'\n- haul_types values: OTR / Regional / Local. preferred_equipment: use the OPTIONS spelling ("Sprinter Van" is a Cargo Van-class unit; say "Cargo Van" unless the carrier names a listed option).'
    || E'\n- weekend_ok: true only if the carrier clearly runs weekends; false only if they clearly do not.'
    || E'\n- truck fields: "truck_id" must be one of the carrier''s units below; with exactly one unit use that one; otherwise only when the carrier named the unit.'
    || E'\n- The transcript is speech-to-text: numbers and names may be garbled. When a number is not clearly stated, leave it out.'
    || E'\n\nCALL: ' || coalesce(p_context ->> 'call_date', '?') || ' · carrier ' || coalesce(p_context ->> 'carrier_name', '?') || ' · duration ' || coalesce(p_context ->> 'duration', '?')
    || E'\n\nCATALOG (tbl.field · kind · label · options):\n'
    || coalesce((select string_agg(f.tbl || '.' || f.field || ' · ' || f.kind || ' · ' || f.label || coalesce(' · options: ' || array_to_string(array(select jsonb_array_elements_text(f.options)), ' / '), ''), E'\n' order by f.sort)
                  from app_private.carrier_fill_fields f), '(none)')
    || E'\n\nCARRIER''S UNITS (truck_id · unit · equipment):\n' || coalesce((select string_agg((t ->> 'id') || ' · ' || coalesce(t ->> 'unit_no', '?') || ' · ' || coalesce(t ->> 'equipment', '?'), E'\n') from jsonb_array_elements(coalesce(p_context -> 'trucks', '[]'::jsonb)) t), '(none)')
    || E'\n\nVALUES ALREADY ON FILE (do not repeat a value that is already there):\n' || left(coalesce(jsonb_pretty(p_context -> 'on_file'), '{}'), 4000)
    || E'\n\nDISPATCHER''S NOTE:\n' || coalesce(nullif(p_context ->> 'note', ''), '(no note)')
    || E'\n\nTRANSCRIPT:\n' || coalesce(nullif(left(p_context ->> 'transcript', 60000), ''), '(no transcript)');
$$;
revoke execute on function app_private.call_fields_prompt(jsonb) from public, anon, authenticated;

-- 6. brain_user_text learns the route (anchor patch — the chat/assist/voice branches are untouched)
do $$
declare v_src text; v_new text; v_anchor text := E'  when p_route = ''voice_followup'' then app_private.riley_followup_prompt(p_context)';
begin
  select pg_get_functiondef(p.oid) into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app_private' and p.proname = 'brain_user_text';
  if v_src is null then raise exception 'brain_user_text not found'; end if;
  if position('call_fields' in v_src) > 0 then return; end if;   -- already patched
  v_new := replace(v_src, v_anchor, E'  when p_route = ''call_fields'' then app_private.call_fields_prompt(p_context)   -- bl_fill_0535\n' || v_anchor);
  if v_new = v_src then raise exception 'bl_fill_0535: brain_user_text anchor not found — aborting'; end if;
  execute v_new;
end $$;

-- 7. the sink: job done → candidates (validated), job failed → nothing (the UI shows the job error)
create or replace function app_private.call_fields_sink(p_job app_private.brain_jobs)
returns void language plpgsql security definer set search_path = app_private, public as $$
declare v_call uuid; c app_private.dialer_calls; v_reply text; v_arr jsonb; it jsonb; f app_private.carrier_fill_fields;
        v_val jsonb; v_truck uuid; v_quote text; v_text text; v_n int := 0; v_cur jsonb; v_units int;
begin
  v_call := nullif(p_job.ref_id, '')::uuid;
  if v_call is null or p_job.status <> 'done' then return; end if;
  select * into c from app_private.dialer_calls where id = v_call;
  if c.id is null or c.carrier_org_id is null then return; end if;
  v_reply := btrim(coalesce(p_job.result ->> 'reply', ''));
  v_reply := regexp_replace(v_reply, '^```[a-z]*\s*', '');
  v_reply := regexp_replace(v_reply, '\s*```$', '');
  begin
    v_arr := v_reply::jsonb;
  exception when others then
    -- the model wrapped prose around it: take the first [...] block
    v_arr := null;
    begin v_arr := substring(v_reply from '\[.*\]')::jsonb; exception when others then v_arr := null; end;
  end;
  if v_arr is null or jsonb_typeof(v_arr) <> 'array' then
    update app_private.brain_jobs set error = coalesce(error, '') || ' call_fields: reply was not a JSON array' where id = p_job.id;
    return;
  end if;
  v_text := lower(coalesce(c.note, '') || E'\n' || coalesce((select t.text from app_private.dialer_call_transcripts t where t.call_id = c.id), ''));
  select count(*) into v_units from app_private.fleet_trucks where carrier_id = c.carrier_org_id and coalesce(status, 'active') not in ('inactive', 'retired');
  -- a re-run replaces the undecided candidates of this call; decided ones stay as the record of what was done
  delete from app_private.call_field_candidates where call_id = c.id and status = 'new';
  for it in select * from jsonb_array_elements(v_arr) loop
    if jsonb_typeof(it) <> 'object' then continue; end if;
    select * into f from app_private.carrier_fill_fields where tbl = it ->> 'tbl' and field = it ->> 'field';
    if f.field is null then continue; end if;
    v_quote := nullif(btrim(coalesce(it ->> 'quote', '')), '');
    if v_quote is null or position(lower(v_quote) in v_text) = 0 then continue; end if;   -- no verbatim quote → no candidate
    v_val := it -> 'value';
    if f.kind = 'list' and v_val is not null and jsonb_typeof(v_val) = 'string' then
      v_val := to_jsonb(array(select btrim(x) from unnest(string_to_array(v_val #>> '{}', ',')) x where btrim(x) <> ''));
    end if;
    if f.kind = 'bool' and v_val is not null and jsonb_typeof(v_val) = 'string' then
      v_val := case when lower(btrim(v_val #>> '{}')) in ('true','yes','y','1') then 'true'::jsonb
                    when lower(btrim(v_val #>> '{}')) in ('false','no','n','0') then 'false'::jsonb else null end;
    end if;
    if f.kind in ('number', 'money') and v_val is not null and jsonb_typeof(v_val) = 'string' then
      begin v_val := to_jsonb(regexp_replace(v_val #>> '{}', '[^0-9.]', '', 'g')::numeric); exception when others then v_val := null; end;
    end if;
    if app_private.cfs_is_empty(v_val) then continue; end if;
    v_truck := null;
    if f.tbl = 'truck' then
      begin v_truck := nullif(it ->> 'truck_id', '')::uuid; exception when others then v_truck := null; end;
      if v_truck is not null and not exists (select 1 from app_private.fleet_trucks where id = v_truck and carrier_id = c.carrier_org_id) then v_truck := null; end if;
      if v_truck is null and v_units = 1 then
        select id into v_truck from app_private.fleet_trucks where carrier_id = c.carrier_org_id and coalesce(status, 'active') not in ('inactive', 'retired') limit 1;
      end if;
      if v_truck is null then continue; end if;
    end if;
    v_cur := app_private.cfs_current(c.carrier_org_id, f.tbl, f.field, v_truck);
    if v_cur is not distinct from v_val then continue; end if;   -- already on file exactly like this
    if exists (select 1 from app_private.call_field_candidates where call_id = c.id and tbl = f.tbl and field = f.field and coalesce(truck_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(v_truck, '00000000-0000-0000-0000-000000000000'::uuid)) then continue; end if;
    insert into app_private.call_field_candidates (call_id, job_id, carrier_org_id, dispatcher_user_id, tbl, field, truck_id, value, quote, note)
    values (c.id, p_job.id, c.carrier_org_id, c.dispatcher_user_id, f.tbl, f.field, v_truck, v_val, left(v_quote, 400), nullif(left(coalesce(it ->> 'note', ''), 300), ''));
    v_n := v_n + 1;
  end loop;
  perform app_private.disp_audit('dispatcher.call_fields', 'call', c.id::text, c.carrier_org_id,
    v_n || ' field candidate(s) extracted from the call of ' || to_char(c.started_at, 'DD Mon') || ' — nothing saved yet',
    jsonb_build_object('call_id', c.id, 'job_id', p_job.id, 'candidates', v_n, 'returned', jsonb_array_length(v_arr)));
end $$;
revoke execute on function app_private.call_fields_sink(app_private.brain_jobs) from public, anon, authenticated;

-- brain_sink branch (anchor patch)
do $$
declare v_src text; v_new text; v_anchor text := E'    when ''test'' then null;';
begin
  select pg_get_functiondef(p.oid) into v_src from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app_private' and p.proname = 'brain_sink';
  if v_src is null then raise exception 'brain_sink not found'; end if;
  if position('call_fields_sink' in v_src) > 0 then return; end if;
  v_new := replace(v_src, v_anchor, E'    when ''call_fields'' then perform app_private.call_fields_sink(p_job);   -- bl_fill_0535\n' || v_anchor);
  if v_new = v_src then raise exception 'bl_fill_0535: brain_sink anchor not found — aborting'; end if;
  execute v_new;
end $$;

-- 8. who may work a call: its own dispatcher with an active assignment on the carrier (staff may read)
create or replace function app_private.call_fields_access(p_call uuid, p_write boolean)
returns jsonb language plpgsql stable security definer set search_path = app_private, public as $$
declare v_uid uuid := auth.uid(); c app_private.dialer_calls; a app_private.dispatcher_assignments;
begin
  if v_uid is null then return jsonb_build_object('error', 'not signed in'); end if;
  select * into c from app_private.dialer_calls where id = p_call;
  if c.id is null then return jsonb_build_object('error', 'call not found'); end if;
  if c.carrier_org_id is null then return jsonb_build_object('error', 'this call is not linked to a carrier'); end if;
  if c.dispatcher_user_id = v_uid then
    select * into a from app_private.dispatcher_assignments where dispatcher_user_id = v_uid and carrier_org_id = c.carrier_org_id and status = 'active' order by assigned_at desc limit 1;
    if a.id is null or not app_private.disp_is_assigned(c.carrier_org_id) then return jsonb_build_object('error', 'you are not assigned to this carrier'); end if;
    return jsonb_build_object('ok', true, 'call', to_jsonb(c), 'assignment_id', a.id, 'role', 'dispatcher');
  end if;
  if not p_write and app_private.disp_is_staff() then return jsonb_build_object('ok', true, 'call', to_jsonb(c), 'assignment_id', null, 'role', 'staff'); end if;
  return jsonb_build_object('error', 'not your call');
end $$;
revoke execute on function app_private.call_fields_access(uuid, boolean) from public, anon, authenticated;

create or replace function public.dispatcher_call_fields_request(p_call uuid)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare acc jsonb; c app_private.dialer_calls; v_tx text; v_note text; j app_private.brain_jobs; r jsonb; v_name text; v_owner uuid; v_prefs jsonb; v_prof jsonb;
begin
  acc := app_private.call_fields_access(p_call, true);
  if acc ? 'error' then return acc; end if;
  select * into c from app_private.dialer_calls where id = p_call;
  select t.text into v_tx from app_private.dialer_call_transcripts t where t.call_id = p_call;
  v_note := nullif(btrim(coalesce(c.note, '')), '');
  if v_note is null and nullif(btrim(coalesce(v_tx, '')), '') is null then
    return jsonb_build_object('error', 'Nothing to read yet: add a call note (Recent → the call → Save call), or let the transcript finish.');
  end if;
  select * into j from app_private.brain_jobs where source = 'call_fields' and ref_id = p_call::text and status in ('queued', 'running') order by created_at desc limit 1;
  if j.id is not null then return jsonb_build_object('ok', true, 'job_id', j.id, 'status', j.status, 'already', true); end if;
  select o.name, o.owner_user_id into v_name, v_owner from public.organizations o where o.id = c.carrier_org_id;
  select to_jsonb(pf) - 'carrier_id' - 'updated_by' - 'updated_at' - 'prefs_sections' - 'external_boards' - 'equipment_detail' into v_prefs from app_private.carrier_dispatch_prefs pf where pf.carrier_id = c.carrier_org_id;
  select jsonb_build_object('mc', p.mc, 'dot', p.dot, 'contact_name', p.contact_name, 'phone', p.phone, 'whatsapp', p.whatsapp) into v_prof from public.profiles p where p.id = v_owner;
  r := app_private.brain_enqueue('call_fields', p_call::text, 'call_fields', left(coalesce(v_note, '(no note — transcript only)'), 2000),
         jsonb_build_object(
           'call_id', c.id, 'carrier_org_id', c.carrier_org_id, 'carrier_name', v_name, 'dispatcher_user_id', c.dispatcher_user_id,
           'call_date', to_char(c.started_at, 'DD Mon YYYY HH24:MI'), 'duration', coalesce(c.duration_sec, 0)::text || ' s',
           'note', v_note, 'transcript', left(v_tx, 60000),
           'on_file', jsonb_build_object('profile', jsonb_strip_nulls(coalesce(v_prof, '{}'::jsonb)), 'prefs', jsonb_strip_nulls(coalesce(v_prefs, '{}'::jsonb))),
           'trucks', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'unit_no', t.unit_no, 'equipment', t.equipment)) from app_private.fleet_trucks t
                       where t.carrier_id = c.carrier_org_id and coalesce(t.status, 'active') not in ('inactive', 'retired')), '[]'::jsonb)),
         null, '{}'::text[], 'en');
  return jsonb_build_object('ok', true) || r;
end $$;

create or replace function public.dispatcher_call_fields(p_call uuid)
returns jsonb language plpgsql stable security definer set search_path = app_private, public as $$
declare acc jsonb; v_uid uuid := auth.uid(); j app_private.brain_jobs; v_rows jsonb;
begin
  acc := app_private.call_fields_access(p_call, false);
  if acc ? 'error' then return acc; end if;
  select * into j from app_private.brain_jobs where source = 'call_fields' and ref_id = p_call::text order by created_at desc limit 1;
  select coalesce(jsonb_agg(x order by (x ->> 'status' = 'new') desc, x ->> 'tbl', x ->> 'field'), '[]'::jsonb) into v_rows from (
    select jsonb_build_object(
      'id', k.id, 'tbl', k.tbl, 'field', k.field, 'truck_id', k.truck_id,
      'unit_no', (select unit_no from app_private.fleet_trucks where id = k.truck_id),
      'label', f.label, 'kind', f.kind, 'options', f.options, 'why', f.why,
      'value', k.value, 'value_text', app_private.cfs_value_text(k.value), 'quote', k.quote, 'note', k.note,
      'status', k.status, 'suggestion_id', k.suggestion_id, 'decided_at', k.decided_at,
      'current', cur.v, 'current_text', coalesce(nullif(app_private.cfs_value_text(cur.v), ''), '—'),
      'empty', app_private.cfs_is_empty(cur.v),
      'locked', (not app_private.cfs_is_empty(cur.v)) and not coalesce(s.set_by_role = 'dispatcher' and s.set_by = v_uid, false),
      'source_role', s.set_by_role) x
    from app_private.call_field_candidates k
    join app_private.carrier_fill_fields f on f.tbl = k.tbl and f.field = k.field
    cross join lateral (select app_private.cfs_current(k.carrier_org_id, k.tbl, k.field, k.truck_id) v) cur
    left join app_private.carrier_field_sources s on s.carrier_org_id = k.carrier_org_id and s.tbl = k.tbl and s.field = k.field
         and coalesce(s.truck_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(k.truck_id, '00000000-0000-0000-0000-000000000000'::uuid)
    where k.call_id = p_call) q;
  return jsonb_build_object('ok', true, 'role', acc ->> 'role', 'assignment_id', acc -> 'assignment_id',
    'has_note', nullif(btrim(coalesce(acc #>> '{call,note}', '')), '') is not null,
    'has_transcript', exists (select 1 from app_private.dialer_call_transcripts t where t.call_id = p_call),
    'job', case when j.id is null then null else jsonb_build_object('id', j.id, 'status', j.status, 'error', j.error, 'created_at', j.created_at, 'done_at', j.done_at, 'usd', j.usd) end,
    'candidates', v_rows);
end $$;

create or replace function public.dispatcher_call_field_apply(p_candidate bigint, p_action text, p_value jsonb default null)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare k app_private.call_field_candidates; acc jsonb; v_uid uuid := auth.uid(); v_val jsonb; v_cur jsonb; s record; w jsonb;
        f app_private.carrier_fill_fields; c app_private.dialer_calls; v_reason text;
begin
  select * into k from app_private.call_field_candidates where id = p_candidate for update;
  if k.id is null then return jsonb_build_object('error', 'not found'); end if;
  if k.status <> 'new' then return jsonb_build_object('error', 'already ' || k.status); end if;
  acc := app_private.call_fields_access(k.call_id, true);
  if acc ? 'error' then return acc; end if;
  if p_action = 'skip' then
    update app_private.call_field_candidates set status = 'skipped', decided_at = now() where id = k.id;
    return jsonb_build_object('ok', true, 'status', 'skipped');
  end if;
  if p_action <> 'save' then return jsonb_build_object('error', 'action must be save or skip'); end if;
  select * into f from app_private.carrier_fill_fields where tbl = k.tbl and field = k.field;
  select * into c from app_private.dialer_calls where id = k.call_id;
  v_val := coalesce(p_value, k.value);
  if app_private.cfs_is_empty(v_val) then return jsonb_build_object('error', 'empty value'); end if;
  v_cur := app_private.cfs_current(k.carrier_org_id, k.tbl, k.field, k.truck_id);
  select set_by_role, set_by into s from app_private.carrier_field_sources where carrier_org_id = k.carrier_org_id and tbl = k.tbl and field = k.field
     and coalesce(truck_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(k.truck_id, '00000000-0000-0000-0000-000000000000'::uuid);
  v_reason := 'Said on call ' || to_char(c.started_at, 'DD Mon') || ': "' || k.quote || '"' || coalesce(' — ' || nullif(k.note, ''), '');
  if app_private.cfs_is_empty(v_cur) or coalesce(s.set_by_role = 'dispatcher' and s.set_by = v_uid, false) then
    -- empty (or my own earlier entry) → the normal dispatcher fill path
    w := app_private.cfs_write(k.carrier_org_id, k.tbl, k.field, k.truck_id, v_val, v_uid, 'dispatcher', 'from call ' || to_char(c.started_at, 'DD Mon') || ' (' || k.call_id::text || ')');
    if w ? 'error' then return w; end if;
    perform app_private.disp_audit('dispatcher.carrier_fill', 'carrier', k.carrier_org_id::text, k.carrier_org_id,
      f.label || ' = ' || left(app_private.cfs_value_text(w -> 'value'), 120) || ' — by dispatcher, from the call of ' || to_char(c.started_at, 'DD Mon'),
      jsonb_build_object('assignment_id', acc -> 'assignment_id', 'tbl', k.tbl, 'field', k.field, 'truck_id', k.truck_id, 'value', w -> 'value', 'call_id', k.call_id, 'candidate_id', k.id));
    update app_private.call_field_candidates set status = 'saved', decided_at = now(), value = coalesce(w -> 'value', v_val) where id = k.id;
    return jsonb_build_object('ok', true, 'status', 'saved', 'value', w -> 'value');
  end if;
  -- locked → a suggestion the carrier (or LoadBoot) confirms
  w := app_private.cfs_suggest(k.carrier_org_id, k.tbl, k.field, k.truck_id, v_val, v_reason, 'call_ai', k.call_id, k.quote, v_uid);
  if w ? 'error' then return w; end if;
  update app_private.call_field_candidates set status = 'suggested', decided_at = now(), value = v_val, suggestion_id = (w #>> '{suggestion,id}')::bigint where id = k.id;
  return jsonb_build_object('ok', true, 'status', 'suggested', 'suggestion', w -> 'suggestion');
end $$;

revoke execute on function public.dispatcher_call_fields_request(uuid) from public, anon;
revoke execute on function public.dispatcher_call_fields(uuid) from public, anon;
revoke execute on function public.dispatcher_call_field_apply(bigint, text, jsonb) from public, anon;
grant execute on function public.dispatcher_call_fields_request(uuid) to authenticated, service_role;
grant execute on function public.dispatcher_call_fields(uuid) to authenticated, service_role;
grant execute on function public.dispatcher_call_field_apply(bigint, text, jsonb) to authenticated, service_role;

do $$
declare n int; bad text;
begin
  select string_agg(p.proname, ', ') into bad from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.proname in ('dispatcher_call_fields_request','dispatcher_call_fields','dispatcher_call_field_apply')
     and has_function_privilege('anon', p.oid, 'execute');
  if bad is not null then raise exception 'bl_fill_0535: anon can execute %', bad; end if;
  if not exists (select 1 from app_private.brain_permissions where key = 'source.call_fields') then raise exception 'bl_fill_0535: permission row missing'; end if;
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');
  raise notice 'bl_fill_0535: anon SECURITY DEFINER surface in public = % (expect 36 prod / 35 staging)', n;
end $$;

commit;

-- rollback notes:
--   update app_private.brain_config set model_by_route = model_by_route - 'call_fields', effort = effort - 'call_fields',
--     max_tokens = max_tokens - 'call_fields', lean_routes = array_remove(lean_routes, 'call_fields') where id;
--   delete from app_private.brain_permissions where key = 'source.call_fields';
--   re-create brain_sink / brain_user_text without the two added lines; drop the functions and the table above.
