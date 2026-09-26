-- bl_bp_0449 — broker agent: tell the agent when the MC they declared is not a brokerage (audit 26 Sep 2026 §7 item 3)
--
-- Before: agent_parent_screened only told the agent anything on outcome 'fail' (a generic in-app line, no e-mail,
-- repeated on every re-screen). An MC that FMCSA does not know, or one that resolves to a trucking company
-- (SALAYIM declared "MC-2026" -> KMG ENTERPRISES LLC, 1 truck, outcome 'unknown'), sat silently in CC "Needs a human".
--
-- After: app_private.agent_parent_mc_nudge(agent_parents.id) — once per declared brokerage row — sends an in-app
-- card + the catalogued e-mail broker.agent_parent_mc_check with the legal name FMCSA returned and asks for the
-- right MC. It fires only on a concrete FMCSA signal, never on a lookup that simply failed:
--   not_found          — screening outcome 'not_found' (FMCSA has no record of that MC)
--   no_broker_authority — outcome fail/unknown AND broker_authority = false (authority lookup answered "no")
--   carrier_record     — outcome fail/unknown AND broker_authority unknown AND FMCSA lists power units (trucks)
--                        AND not brokerOnly. The wording stays "we could not find broker authority", because a
--                        carrier+broker company with a failed authority lookup would also land here.
-- NOT a trigger on its own: entity_type = 'CARRIER'. FMCSA census returns CARRIER for real brokerages too
-- (LinkLane and M&M both read CARRIER and passed) — using it would e-mail genuine agents.
-- Outcome 'error' (fetch failed) never nudges. Confirmed / declined / revoked rows never nudge.
-- Once: agent_parents.mc_nudge_at + idempotency key agentmcnudge:<agent_parents.id>. A new MC is a new row.
-- On 'fail' the existing generic in-app line is skipped when the nudge covers it (no double card).
-- No backfill: rows already screened (SALAYIM) are NOT e-mailed by this migration; they nudge on the next screen.
-- Catalog: broker.agent_parent_mc_check (T, broker, account_critical, unsub not allowed).
-- Anon SECURITY DEFINER surface: unchanged (app_private only; anchor patch on an existing app_private function).

alter table app_private.agent_parents add column if not exists mc_nudge_at timestamptz;

create or replace function app_private.agent_parent_mc_nudge(p_ap uuid) returns boolean
language plpgsql security definer set search_path = app_private, public as $$
declare ap app_private.agent_parents; s app_private.broker_screenings; v_why text; v_pu int; v_mail text; v_name text;
        v_mc text; v_legal text; v_fact text; v_fact_txt text; v_html text; v_text text; v_title text;
begin
  select * into ap from app_private.agent_parents where id = p_ap;
  if ap.id is null or ap.revoked_at is not null or ap.confirmed_at is not null or ap.declined_at is not null then return false; end if;
  select * into s from app_private.broker_screenings where org_id = ap.agent_org;
  if s.org_id is null or s.outcome is null or s.outcome not in ('fail','unknown','not_found') then return false; end if;
  -- the screening row is per org; only act when it is the screen of THIS declared MC
  if nullif(regexp_replace(coalesce(s.mc_number,''), '\D', '', 'g'), '') is distinct from ap.parent_mc then return false; end if;

  v_pu := case when coalesce(s.raw->>'powerUnits','') ~ '^\d{1,6}$' then (s.raw->>'powerUnits')::int end;
  v_why := case
    when s.outcome = 'not_found' then 'not_found'
    when s.broker_authority is false then 'no_broker_authority'
    when s.broker_authority is null and coalesce(v_pu,0) > 0 and coalesce(s.raw->>'brokerOnly','') <> 'true' then 'carrier_record'
  end;
  if v_why is null then return false; end if;
  if ap.mc_nudge_at is not null then return true; end if;   -- already told for this row

  select lower(u.email), coalesce(nullif(btrim(u.raw_user_meta_data->>'full_name'), ''), nullif(btrim(o.name), ''))
    into v_mail, v_name
    from public.organizations o join auth.users u on u.id = o.owner_user_id where o.id = ap.agent_org;

  v_mc := 'MC-' || ap.parent_mc;
  v_legal := coalesce(nullif(btrim(s.legal_name), ''), ap.fmcsa_legal_name);
  v_fact_txt := case v_why
    when 'not_found' then 'FMCSA has no record of ' || v_mc || '.'
    when 'no_broker_authority' then 'FMCSA lists ' || v_mc || ' as ' || coalesce(v_legal, 'a company') || ', with no active broker authority.'
    else 'FMCSA lists ' || v_mc || ' as ' || coalesce(v_legal, 'a company') || ', a motor carrier with ' || v_pu || ' truck' || case when v_pu = 1 then '' else 's' end
         || ', and we could not find broker authority on it.' end;
  v_fact := case v_why
    when 'not_found' then 'FMCSA has no record of <b>' || v_mc || '</b>.'
    when 'no_broker_authority' then 'FMCSA lists <b>' || v_mc || '</b> as <b>' || app_private.disp_esc(coalesce(v_legal, 'a company')) || '</b>, with <b>no active broker authority</b>.'
    else 'FMCSA lists <b>' || v_mc || '</b> as <b>' || app_private.disp_esc(coalesce(v_legal, 'a company')) || '</b>, a motor carrier with ' || v_pu || ' truck' || case when v_pu = 1 then '' else 's' end
         || ' &mdash; we could not find broker authority on it.' end;
  v_title := case v_why when 'not_found' then '⚠ ' || v_mc || ' was not found on FMCSA' else '⚠ ' || v_mc || ' does not look like a brokerage' end;

  perform app_private.notify_partner(ap.agent_org, v_title,
    v_fact_txt || ' You post under the MC of the licensed brokerage you work for. Check the MC with them, remove this one and add the right MC in "Post under your brokerage''s authority" — we re-check FMCSA and e-mail that brokerage a confirmation code automatically.',
    'warning', '/app/partner/#onboarding');

  if v_mail is not null then
    v_html :=
      '<h2 style="margin:0 0 10px;font-size:22px">Please check the brokerage MC you entered</h2>'
      || '<p style="font-size:15px;color:#334155">Hi ' || app_private.disp_esc(coalesce(v_name, 'there')) || ', you signed up on LoadBoot as a broker agent and gave us '
      || '<b>' || v_mc || '</b>' || coalesce(' (' || app_private.disp_esc(nullif(btrim(ap.parent_legal_name), '')) || ')', '') || ' as the brokerage you post for.</p>'
      || '<p style="font-size:15px;color:#334155;background:#fff7ed;border-left:4px solid #FC5305;padding:12px 14px;border-radius:6px">' || v_fact || '</p>'
      || '<p style="font-size:15px;color:#334155">A broker agent posts under the MC of a <b>licensed freight brokerage</b> &mdash; the company whose name goes on the rate confirmation. '
      || 'Until a brokerage confirms you, your loads cannot go live to carriers.</p>'
      || '<p style="font-size:15px;color:#334155"><b>What to do:</b> check the MC number with the brokerage you work for, then on your dashboard remove '
      || v_mc || ' and add the right MC under <i>Post under your brokerage''s authority</i>. We check it on FMCSA and e-mail that brokerage a confirmation code on its own &mdash; nothing else is needed from you.</p>'
      || '<p style="margin:14px 0 20px"><a href="https://loadboot.com/app/partner/#onboarding" style="background:#0883F7;color:#fff;padding:13px 22px;border-radius:10px;text-decoration:none;font-weight:800">Fix my brokerage MC →</a></p>'
      || '<p style="font-size:13px;color:#64748b">If ' || case when v_why = 'not_found' then 'you are sure this MC is right' else app_private.disp_esc(coalesce(v_legal, 'this company')) || ' really is your brokerage' end
      || ', reply to this e-mail or {{contact_inline}} &mdash; our team will check it by hand.</p>'
      || '<p style="font-size:12px;color:#94a3b8">Transactional notice about your LoadBoot partner account.</p>';
    v_text := 'Hi ' || coalesce(v_name, 'there') || E',\n\nYou signed up on LoadBoot as a broker agent and gave us ' || v_mc
      || coalesce(' (' || nullif(btrim(ap.parent_legal_name), '') || ')', '') || E' as the brokerage you post for.\n\n' || v_fact_txt
      || E'\n\nA broker agent posts under the MC of a licensed freight brokerage. Until a brokerage confirms you, your loads cannot go live to carriers.'
      || E'\n\nCheck the MC with the brokerage you work for, then on your dashboard remove ' || v_mc || ' and add the right MC. We check it on FMCSA and e-mail that brokerage a confirmation code automatically.'
      || E'\n\nhttps://loadboot.com/app/partner/#onboarding\n\nIf you believe this is wrong, reply to this e-mail or {{contact_inline}}.';
    perform app_private.sys_email(v_mail, 'broker.agent_parent_mc_check',
      case when v_why = 'not_found' then v_mc || ' was not found on FMCSA — please check your brokerage MC'
           else v_mc || ' is not a brokerage on FMCSA — please check your brokerage MC' end,
      v_html, v_text, 'agentmcnudge:' || ap.id::text);
  end if;

  update app_private.agent_parents set mc_nudge_at = now(), updated_at = now() where id = ap.id;
  return true;
end $$;
revoke all on function app_private.agent_parent_mc_nudge(uuid) from public, anon, authenticated;

-- agent_parent_screened: nudge on unknown / not_found; on fail, the nudge replaces the generic line when it applies.
do $p$
declare src text; a1 text;
begin
  src := pg_get_functiondef('app_private.agent_parent_screened(uuid)'::regprocedure);
  if src like '%agent_parent_mc_nudge%' then raise notice 'agent_parent_screened already patched'; return; end if;
  a1 := E'  elsif s.outcome = ''fail'' then\n    perform app_private.notify_partner(p_org, ''Brokerage check did not pass';
  if src not like '%' || a1 || '%' then raise exception 'bl_bp_0449: fail-branch anchor missing'; end if;
  src := replace(src, a1,
       E'  elsif s.outcome in (''unknown'', ''not_found'') and ap.confirmed_at is null and ap.declined_at is null then\n'
    || E'    perform app_private.agent_parent_mc_nudge(ap.id);  -- bl_bp_0449\n'
    || E'  elsif s.outcome = ''fail'' and not app_private.agent_parent_mc_nudge(ap.id) then  -- bl_bp_0449\n'
    || E'    perform app_private.notify_partner(p_org, ''Brokerage check did not pass');
  execute src;
end $p$;

insert into app_private.email_catalog
  (key, name, purpose, class, audience_role, trigger_type, trigger_source, cadence, cap_note, stop_condition,
   preference_group, unsub_allowed, cc_deep_link, status, discovered_in)
values ('broker.agent_parent_mc_check', 'Broker agent — declared MC is not a brokerage',
   'Tells a broker agent that the brokerage MC they declared is not found on FMCSA, has no broker authority, or is a trucking company; shows the legal name FMCSA returned and asks them to add the right MC',
   'T', 'broker', 'event', 'app_private.agent_parent_screened → app_private.agent_parent_mc_nudge', 'once per declared brokerage MC',
   'once (agent_parents.mc_nudge_at + idempotency agentmcnudge:<agent_parents.id>)', 'row confirmed / declined / revoked, or screening passes',
   'account_critical', false, '#/broker-trust', 'live', '{code}')
on conflict (key) do update set name = excluded.name, purpose = excluded.purpose, class = excluded.class, audience_role = excluded.audience_role,
  trigger_type = excluded.trigger_type, trigger_source = excluded.trigger_source, cadence = excluded.cadence, cap_note = excluded.cap_note,
  stop_condition = excluded.stop_condition, preference_group = excluded.preference_group, unsub_allowed = excluded.unsub_allowed,
  cc_deep_link = excluded.cc_deep_link, status = 'live', updated_at = now();
