-- bl_bp_0451 — ONE definition of a "mandatory" packet item (audit claude/BROKER-AGENT-AUDIT-2026-09-26.md §3, §7 item 5).
--
-- Before: two readings of onboarding_packet_templates.status_tag lived side by side on prod.
--   A. status_tag in ('legal','required')   → 7 broker / 3 shipper items. Used by the posting gate
--      (app_private.org_onboarding_complete → tier 'verified'), partner_trust_status.packet_required_*,
--      both trust queues, cc_onboarding_board, cc_partner_overview, cc_prebook_check, cc_trust_profile,
--      cc_pocket_trip_docs, cc_my_onboarding_packet ('complete'), cc_book_request_carrier_packet.
--   B. status_tag <> 'optional'  (= A + 'conditional') → 8 broker / 6 shipper. Used by CC "Approve account"
--      (cc_partner_set_status), reject-parks-the-account + auto-activate (cc_onboarding_review_item), the
--      Partners directory x/N (cc_partners_accounts), cc_chat_onboarding_status, and Broker 360's KPI (JS).
--   So a broker could be tier 'verified' and posting (A satisfied) while CC refused to approve the account
--   and the directory read 7/8 (B unsatisfied) until someone waived the COI by hand.
--
-- Decision (26 Sep 2026): mandatory = 'legal' or 'required'. 'conditional' items (broker: coi; shipper:
-- credit_application, payment_terms, special_commodity) are asked for, shown, revalidated and reviewed,
-- but never gate verification, approval, activation or posting. Why A and not B: A is what the posting
-- gate has enforced since bl_bp_0312/0315 (the 0315 header already calls COI "when conditional"), the
-- partner portal already files 'conditional' under "Before your first booking" rather than the gating list,
-- and a CC approval stricter than the posting gate only ever produced hand-waives. On 26 Sep no prod org
-- differed between A and B and no conditional item was in 'rejected', so the switch changes nothing today.
--
-- After:
--   app_private.packet_tag_mandatory(tag) boolean immutable — the ONLY place the rule is written. To change
--   the rule later, change that one body; every consumer below reads it.
--   app_private.org_onboarding_complete is re-created in full here (it existed only on the live DBs, §7 item 7).
--   16 functions are anchor-patched from their live definition (bl_bp_0448 style: raise if an anchor is
--   missing, so a silent no-op is impossible). cc_chat_onboarding_status exists on prod only → skipped where absent.
--   cc_partner_360 and cc_my_onboarding_packet now emit 'mandatory' per packet item so the JS (broker360.js
--   KPI + reject wording, partner app.js summary) stops re-deriving the rule from the tag.
--
-- Grants: every patched function is create-or-replaced from its own definition, so its ACL is untouched.
-- The new helper lives in app_private and is revoked from public/anon/authenticated (secdef callers run as owner).
-- Anon SECURITY DEFINER surface: unchanged (34 prod / 33 staging) — verified by name after apply.

-- 1. The definition ---------------------------------------------------------------------------------
create or replace function app_private.packet_tag_mandatory(p_tag text) returns boolean
language sql immutable parallel safe as $$
  select lower(coalesce(p_tag, '')) in ('legal', 'required')
$$;
revoke all on function app_private.packet_tag_mandatory(text) from public, anon, authenticated;
comment on function app_private.packet_tag_mandatory(text) is
  'bl_bp_0451: the one rule for whether an onboarding_packet_templates.status_tag gates verification/approval/posting. legal|required = yes; conditional|optional = no.';

-- 2. The posting gate, now in a migration file (was live-only) ------------------------------------------
create or replace function app_private.org_onboarding_complete(p_org uuid) returns boolean
language sql stable security definer set search_path = app_private, public as $$
  select count(*) = 0
  from public.organizations o
  join app_private.onboarding_packet_templates t on t.org_kind = o.kind
  left join app_private.org_onboarding_items i on i.org_id = o.id and i.item_key = t.item_key
  where o.id = p_org and app_private.packet_tag_mandatory(t.status_tag)
    and coalesce(i.status,'pending') not in ('verified','waived');
$$;
revoke all on function app_private.org_onboarding_complete(uuid) from public, anon, authenticated;

-- 3. Every other consumer reads the same rule ----------------------------------------------------------
do $mig$
declare r record; src text; out_src text; n int := 0;
begin
  for r in select * from (values
    ('public.cc_book_request_carrier_packet(uuid)',        't.status_tag in (''legal'',''required'')',  'app_private.packet_tag_mandatory(t.status_tag)',  false),
    ('public.cc_broker_trust_queue()',                     'tp.status_tag in (''legal'',''required'')', 'app_private.packet_tag_mandatory(tp.status_tag)', false),
    ('public.cc_chat_onboarding_status()',                 't.status_tag <> ''optional''',              'app_private.packet_tag_mandatory(t.status_tag)',  true),
    ('public.cc_my_onboarding_packet()',                   't.status_tag in (''legal'',''required'')',  'app_private.packet_tag_mandatory(t.status_tag)',  false),
    ('public.cc_my_onboarding_packet()',                   '''tag'',t.status_tag,',                     '''tag'',t.status_tag,''mandatory'',app_private.packet_tag_mandatory(t.status_tag),', false),
    ('public.cc_onboarding_board(text)',                   't.status_tag in (''legal'',''required'')',  'app_private.packet_tag_mandatory(t.status_tag)',  false),
    ('public.cc_onboarding_review_item(uuid,text,text,text)', 't.status_tag <> ''optional''',           'app_private.packet_tag_mandatory(t.status_tag)',  false),
    ('public.cc_partner_overview()',                       't.status_tag in (''legal'',''required'')',  'app_private.packet_tag_mandatory(t.status_tag)',  false),
    ('public.cc_partner_set_status(uuid,text,text)',       't.status_tag <> ''optional''',              'app_private.packet_tag_mandatory(t.status_tag)',  false),
    ('public.cc_partners_accounts()',                      't.status_tag <> ''optional''',              'app_private.packet_tag_mandatory(t.status_tag)',  false),
    ('public.cc_pocket_trip_docs(uuid)',                   'tp.status_tag in (''legal'',''required'')', 'app_private.packet_tag_mandatory(tp.status_tag)', false),
    ('public.cc_prebook_check(uuid,uuid)',                 't.status_tag in (''legal'',''required'')',  'app_private.packet_tag_mandatory(t.status_tag)',  false),
    ('public.cc_shipper_trust_queue()',                    'tp.status_tag in (''legal'',''required'')', 'app_private.packet_tag_mandatory(tp.status_tag)', false),
    ('public.cc_trust_profile(uuid)',                      't.status_tag in (''legal'',''required'')',  'app_private.packet_tag_mandatory(t.status_tag)',  false),
    ('public.partner_shipper_status()',                    'e->>''tag'' in (''legal'',''required'')',   'app_private.packet_tag_mandatory(e->>''tag'')',   false),
    ('public.partner_trust_status()',                      'e->>''tag'' in (''legal'',''required'')',   'app_private.packet_tag_mandatory(e->>''tag'')',   false),
    ('public.cc_partner_360(uuid)',                        '''key'', t.item_key, ''label'', t.label, ''tag'', t.status_tag,',
                                                           '''key'', t.item_key, ''label'', t.label, ''tag'', t.status_tag, ''mandatory'', app_private.packet_tag_mandatory(t.status_tag),', false)
  ) v(fn, anchor, repl, optional) loop
    if to_regprocedure(r.fn) is null then
      if r.optional then raise notice 'bl_bp_0451: % absent on this database - skipped', r.fn; continue; end if;
      raise exception 'bl_bp_0451: % not found', r.fn;
    end if;
    src := pg_get_functiondef(to_regprocedure(r.fn));
    out_src := replace(src, r.anchor, r.repl);
    if out_src = src then raise exception 'bl_bp_0451: anchor not found in %: %', r.fn, r.anchor; end if;
    execute out_src;
    n := n + 1;
  end loop;
  raise notice 'bl_bp_0451: % patches applied', n;
end
$mig$;

-- 4. Nothing in public/app_private may still spell the rule by hand (cron_packet_revalidation's
--    status_tag = 'legal' is a different question - which items get expiry reminders - and stays).
do $chk$
declare v_left text;
begin
  select string_agg(n.nspname||'.'||p.proname, ', ' order by 1) into v_left
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public','app_private') and p.prokind = 'f'
     and (pg_get_functiondef(p.oid) like '%status_tag in (''legal'',''required'')%'
          or pg_get_functiondef(p.oid) like '%status_tag <> ''optional''%'
          or pg_get_functiondef(p.oid) like '%''tag'' in (''legal'',''required'')%');
  if v_left is not null then raise exception 'bl_bp_0451: hand-written mandatory rule still in: %', v_left; end if;
end
$chk$;
