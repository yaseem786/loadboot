-- bl_ship_0509 — a shipper hold / release now also goes out by email, through the catalog (30 Sep 2026).
--   1. Two catalog rows (CLAUDE.md §6): shipper.hold and shipper.released — class T, audience shipper, account_critical,
--      unsub_allowed = false (an account-state notice about the shipper's own account, like broker.authority_paused).
--   2. app_private.shipper_hold_notice(org, kind, note) — the one sender for the bell + email. Kinds:
--        hold    → bell "⛔ Posting paused" + email shipper.hold (once per hold: idempotency shipper.hold:<org>:<held_at>)
--        rehold  → the note of an already-held shipper was changed: bell only, no second email
--        release → bell "✅ Posting restored" + email shipper.released
--      The note is what staff typed as "the shipper sees this". Its trailing full stop is stripped before the sender
--      adds its own, so the bell no longer reads "ourselves..  Contact support" (double stop + double space).
--   3. cc_shipper_trust_set (anchor-patched): hold on a shipper not yet held → 'hold'; on one already held → 'rehold';
--      release of a held shipper → 'release'; release of a shipper that was NOT held now sends nothing (it used to bell
--      "✅ Posting restored" to a shipper whose posting was never paused).
--      NOT changed: cc_shipper_callback_fail. Its hold reason is what the company told staff on the call-back — internal,
--      never shown or mailed to the shipper (the portal hero filters it too).
--   4. partner_journey (anchor-patched): "On hold: <note>. Release…" / "Hold: <note>. Release…" strip the note's own
--      trailing stop first — the CC journey line read "…a number we look up ourselves.. Release from Trust actions".
--   Not retroactive: nothing is sent to anyone already on hold (MII stays silent, per the owner's 30 Sep decision).
-- Anchor-patched: each anchor must be found exactly once or the file refuses. Idempotent (skips a function that already
-- carries the bl_ship_0509 marker). New function is app_private, revoked from public/anon/authenticated. The file raises
-- if the anon SECURITY DEFINER names in public change.

drop table if exists pg_temp._bl0509_anon;
create temp table _bl0509_anon as
select p.proname::text n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
 where s.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');

create or replace function pg_temp._bl0509_sub(d text, p_old text, p_new text)
returns text language plpgsql as $$
declare n int;
begin
  n := (length(d) - length(replace(d, p_old, ''))) / greatest(length(p_old), 1);
  if n <> 1 then raise exception 'bl_ship_0509: anchor found % times — refusing: %', n, left(p_old, 80); end if;
  return replace(d, p_old, p_new);
end $$;

-- 1. catalog rows ---------------------------------------------------------------------------------------------------
insert into app_private.email_catalog (key, name, purpose, class, audience_role, trigger_type, trigger_source, cadence, cap_note,
                                       stop_condition, preference_group, unsub_allowed, status, cc_deep_link)
values
  ('shipper.hold', 'Shipper account on hold',
   'Tells a shipper that staff put its account on hold: the reason staff wrote for the shipper (neutral wording), that nothing reaches carriers or brokers meanwhile, that nothing already booked was cancelled, and how to reach us. Not sent for a failed independent call-back (that reason is internal) or when an already-held shipper''s note is edited.',
   'T', 'shipper', 'manual', 'public.cc_shipper_trust_set (hold) → app_private.shipper_hold_notice', 'on each new hold',
   'once per hold (idempotency shipper.hold:<org>:<held_at>)', 'hold released', 'account_critical', false, 'live', '#/partners'),
  ('shipper.released', 'Shipper hold lifted',
   'Tells a held shipper that the hold was lifted, with the optional note staff wrote, and that each lane opens as soon as its Verification items are complete. Sent only when the shipper really was on hold.',
   'T', 'shipper', 'manual', 'public.cc_shipper_trust_set (release) → app_private.shipper_hold_notice', 'on each release of a held shipper',
   'once per release (idempotency shipper.released:<org>:<time>)', 'n/a — one send per release', 'account_critical', false, 'live', '#/partners')
on conflict (key) do update set name = excluded.name, purpose = excluded.purpose, class = excluded.class, audience_role = excluded.audience_role,
  trigger_type = excluded.trigger_type, trigger_source = excluded.trigger_source, cadence = excluded.cadence, cap_note = excluded.cap_note,
  stop_condition = excluded.stop_condition, preference_group = excluded.preference_group, unsub_allowed = excluded.unsub_allowed,
  status = 'live', cc_deep_link = excluded.cc_deep_link;

-- 2. the sender -----------------------------------------------------------------------------------------------------
create or replace function app_private.shipper_hold_notice(p_org uuid, p_kind text, p_note text)
returns void language plpgsql security definer set search_path to 'app_private, public' as $$
declare
  v_name text; v_mail text; v_owner text; v_held timestamptz;
  v_note text := nullif(regexp_replace(btrim(coalesce(p_note, '')), '[.[:space:]]+$', ''), '');
  v_subj text; v_head text; v_fact text; v_html text; v_text text; v_key text; v_idem text;
  p text := '<p style="font-size:15px;color:#334155">';
begin
  if p_kind not in ('hold', 'rehold', 'release') then raise exception 'bl_ship_0509: unknown kind %', p_kind; end if;
  select o.name, lower(u.email), coalesce(nullif(btrim(u.raw_user_meta_data->>'full_name'), ''), nullif(btrim(o.name), ''))
    into v_name, v_mail, v_owner
    from public.organizations o left join auth.users u on u.id = o.owner_user_id
   where o.id = p_org and o.kind = 'shipper';
  if v_name is null then return; end if;

  if p_kind in ('hold', 'rehold') then
    perform app_private.notify_partner(p_org, '⛔ Posting paused',
      coalesce(v_note || '. ', '') || 'Contact support to resolve it.', 'urgent', '/app/partner/#onboarding');
    if p_kind = 'rehold' then return; end if;
    select held_at into v_held from app_private.shipper_trust where org_id = p_org;
    v_key  := 'shipper.hold';
    v_idem := 'shipper.hold:' || p_org::text || ':' || extract(epoch from coalesce(v_held, now()))::bigint::text;
    v_subj := 'Your LoadBoot account is on hold — ' || v_name;
    v_head := 'Your account is on hold';
    v_fact := coalesce(v_note, 'Our team needs to confirm a few details before your account can go further') || '.';
    v_html := p || '<b>What this means:</b> nothing is posted to carriers or brokers and no new tenders go out until the hold is lifted. Nothing already booked was cancelled.</p>'
      || p || '<b>What to do:</b> reply to this e-mail or {{contact_inline}} &mdash; our team will tell you exactly what is needed.</p>';
    v_text := 'What this means: nothing is posted to carriers or brokers and no new tenders go out until the hold is lifted. Nothing already booked was cancelled.'
      || E'\n\nWhat to do: reply to this e-mail or {{contact_inline}} — our team will tell you exactly what is needed.';
  else
    perform app_private.notify_partner(p_org, '✅ Posting restored',
      coalesce(v_note || '.', 'The hold on your account was lifted.'), 'success', '/app/partner/');
    v_key  := 'shipper.released';
    v_idem := 'shipper.released:' || p_org::text || ':' || extract(epoch from now())::bigint::text;
    v_subj := 'The hold on your LoadBoot account was lifted';
    v_head := 'Your account is active again';
    v_fact := coalesce(v_note || '.', 'The hold on your account was lifted.');
    v_html := p || 'Each lane (posting to carriers, tendering to brokers) opens as soon as its Verification items are complete &mdash; your portal shows what is left, if anything.</p>'
      || p || 'Questions? Reply to this e-mail or {{contact_inline}}.</p>';
    v_text := 'Each lane (posting to carriers, tendering to brokers) opens as soon as its Verification items are complete — your portal shows what is left, if anything.'
      || E'\n\nQuestions? Reply to this e-mail or {{contact_inline}}.';
  end if;

  if v_mail is null then return; end if;
  v_html := '<h2 style="margin:0 0 10px;font-size:22px">' || app_private.disp_esc(v_head) || '</h2>'
    || p || 'Hi ' || app_private.disp_esc(coalesce(v_owner, 'there')) || ', this is a notice about <b>' || app_private.disp_esc(v_name) || '</b>''s LoadBoot account.</p>'
    || '<p style="font-size:15px;color:#334155;background:' || case when v_key = 'shipper.hold' then '#fff7ed;border-left:4px solid #FC5305' else '#ecfdf5;border-left:4px solid #16a34a' end
    || ';padding:12px 14px;border-radius:6px">' || app_private.disp_esc(v_fact) || '</p>'
    || v_html
    || '<p style="margin:14px 0 20px"><a href="https://loadboot.com/app/partner/#onboarding" style="background:#0883F7;color:#fff;padding:13px 22px;border-radius:10px;text-decoration:none;font-weight:800">Open my portal →</a></p>'
    || '<p style="font-size:12px;color:#94a3b8">Account notice about your LoadBoot shipper account.</p>';
  v_text := 'Hi ' || coalesce(v_owner, 'there') || E',\n\n' || v_fact || E'\n\n' || v_text || E'\n\nhttps://loadboot.com/app/partner/#onboarding';
  begin
    perform app_private.sys_email(v_mail, v_key, v_subj, v_html, v_text, v_idem);
  exception when others then
    perform app_private.log_audit('shipper.hold_email_failed', 'org', p_org::text, p_org, v_key || ': ' || sqlerrm, null);
  end;
end $$;
revoke execute on function app_private.shipper_hold_notice(uuid, text, text) from public, anon, authenticated;

-- 3 + 4. anchor patches ---------------------------------------------------------------------------------------------
do $mig$
declare d text;
begin
  d := pg_get_functiondef('public.cc_shipper_trust_set(uuid,text,text)'::regprocedure);
  if position('bl_ship_0509' in d) = 0 then
    d := pg_temp._bl0509_sub(d,
      $a$declare v_name text;$a$,
      $a$declare v_name text; v_was_held boolean;  -- bl_ship_0509$a$);
    d := pg_temp._bl0509_sub(d,
      $a$  select name into v_name from public.organizations where id = p_org;$a$,
      $a$  select name into v_name from public.organizations where id = p_org;
  select hold_reason is not null into v_was_held from app_private.shipper_trust where org_id = p_org;$a$);
    d := pg_temp._bl0509_sub(d,
      $a$    perform app_private.notify_partner(p_org, '⛔ Posting paused', p_note || '  Contact support to resolve it.', 'urgent', '/app/partner/#onboarding');$a$,
      $a$    perform app_private.shipper_hold_notice(p_org, case when v_was_held then 'rehold' else 'hold' end, p_note);$a$);
    d := pg_temp._bl0509_sub(d,
      $a$    perform app_private.notify_partner(p_org, '✅ Posting restored', coalesce(nullif(trim(p_note),''), 'The hold on your account was lifted.'), 'success', '/app/partner/');$a$,
      $a$    if v_was_held then perform app_private.shipper_hold_notice(p_org, 'release', p_note); end if;$a$);
    execute d;
  end if;

  d := pg_get_functiondef('app_private.partner_journey(uuid)'::regprocedure);
  if position('bl_ship_0509' in d) = 0 then
    d := pg_temp._bl0509_sub(d,
      $a$'detail','On hold: ' || coalesce(v_ig->>'hold','?') || '. Release from Trust actions once fixed.','action','trust');$a$,
      $a$'detail','On hold: ' || coalesce(rtrim(v_ig->>'hold', '. '),'?') || '. Release from Trust actions once fixed.','action','trust');  -- bl_ship_0509$a$);
    d := pg_temp._bl0509_sub(d,
      $a$    v_next := 'Hold: ' || coalesce(bt.hold_reason, st.hold_reason, '?') || '. Release from Trust actions once fixed.';$a$,
      $a$    v_next := 'Hold: ' || rtrim(coalesce(bt.hold_reason, st.hold_reason, '?'), '. ') || '. Release from Trust actions once fixed.';  -- bl_ship_0509$a$);
    execute d;
  end if;
end $mig$;

-- checks ------------------------------------------------------------------------------------------------------------
do $$
declare v_added text; v_gone text;
begin
  if (select count(*) from app_private.email_catalog where key in ('shipper.hold', 'shipper.released')
        and preference_group = 'account_critical' and not unsub_allowed and status = 'live') <> 2 then
    raise exception 'bl_ship_0509: catalog rows missing'; end if;
  if has_function_privilege('anon', 'app_private.shipper_hold_notice(uuid,text,text)', 'execute')
     or has_function_privilege('authenticated', 'app_private.shipper_hold_notice(uuid,text,text)', 'execute') then
    raise exception 'bl_ship_0509: shipper_hold_notice is executable by a client role'; end if;
  select string_agg(n, ', ') into v_added from (
    select p.proname::text n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')
    except select n from pg_temp._bl0509_anon) a;
  select string_agg(n, ', ') into v_gone from (
    select n from pg_temp._bl0509_anon
    except select p.proname::text from pg_proc p join pg_namespace s on s.oid = p.pronamespace
     where s.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')) g;
  if v_added is not null or v_gone is not null then
    raise exception 'bl_ship_0509: anon surface changed (added: %, removed: %) — rolling back', v_added, v_gone; end if;
end $$;
