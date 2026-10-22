-- bl_bp_0527 — broker screening: no nightly notice spam, never-passed signups surface to staff and stop re-screening
-- (17 Oct 2026, found while reviewing the October broker/shipper signups).
--
-- Bug 1: broker_screen_request sets outcome='pending' for a broker that has never passed, so in broker_screen_collect
--        v_prev was always 'pending' and "only on change" fired "FMCSA screening did not pass" / "needs a human" every
--        night (Kembo 5x in 4 days, "testing" 6x). Fix: when outcome is 'pending', the previous verdict is last_outcome.
-- Bug 1b: domain_match was true for gmail-vs-gmail. For free-mail domains only an exact email match counts.
-- Bug 2: broker_rescreen_sweep re-queued never-passed brokers every night forever (khannawab: 25 attempts, MC "2026")
--        and nobody in CC was told. Fix: a never-passed broker gets 3 attempts in total, then ONE staff alert
--        ('new_unverified', reuses fail_alerted_at) and no more automatic re-screens — staff Verify/hold from CC.
-- All three are anchor patches: the rest of each function is byte-for-byte unchanged. Idempotent.

do $do$
declare d text;
begin
  -- ---- bug 1 + 1b: broker_screen_collect -------------------------------------------------------
  d := pg_get_functiondef('app_private.broker_screen_collect'::regproc);
  if position('bl_bp_0527' in d) = 0 then
    if position($a$select outcome, last_outcome into v_prev, v_prev_raw from app_private.broker_screenings where org_id = r.org_id;$a$ in d) = 0
       or position($b$v_dm := split_part(v_fmcsa_email,'@',2) = split_part(v_owner_email,'@',2);$b$ in d) = 0 then
      raise exception 'bl_bp_0527: anchor not found in broker_screen_collect';
    end if;
    d := replace(d,
      $a$select outcome, last_outcome into v_prev, v_prev_raw from app_private.broker_screenings where org_id = r.org_id;$a$,
      $a$select case when outcome = 'pending' then last_outcome else outcome end, last_outcome  -- bl_bp_0527: a re-request parks outcome at 'pending'; the real previous verdict is last_outcome
      into v_prev, v_prev_raw from app_private.broker_screenings where org_id = r.org_id;$a$);
    d := replace(d,
      $b$v_dm := split_part(v_fmcsa_email,'@',2) = split_part(v_owner_email,'@',2);$b$,
      $b$v_dm := case when lower(split_part(v_fmcsa_email,'@',2)) in ('gmail.com','yahoo.com','outlook.com','hotmail.com','aol.com','icloud.com','live.com','msn.com','protonmail.com','proton.me','ymail.com','me.com','comcast.net','att.net','sbcglobal.net','verizon.net','mail.com','gmx.com','yandex.com')
                     then lower(v_fmcsa_email) = lower(v_owner_email)   -- bl_bp_0527: free mail only matches on the exact address
                     else lower(split_part(v_fmcsa_email,'@',2)) = lower(split_part(v_owner_email,'@',2)) end;$b$);
    execute d;
  end if;

  -- ---- bug 2: broker_rescreen_sweep ------------------------------------------------------------
  d := pg_get_functiondef('app_private.broker_rescreen_sweep'::regproc);
  if position('bl_bp_0527' in d) = 0 then
    if position($c$       and coalesce(s.last_pass_at,      to_timestamp(0)) < now() - make_interval(hours => cfg.stale_hours)
     order by coalesce(s.last_pass_at, to_timestamp(0)) asc$c$ in d) = 0
       or position($e$  -- 2. day-N alert: still passing, but we have not been able to re-confirm it$e$ in d) = 0 then
      raise exception 'bl_bp_0527: anchor not found in broker_rescreen_sweep';
    end if;
    d := replace(d,
      $c$       and coalesce(s.last_pass_at,      to_timestamp(0)) < now() - make_interval(hours => cfg.stale_hours)
     order by coalesce(s.last_pass_at, to_timestamp(0)) asc$c$,
      $c$       and coalesce(s.last_pass_at,      to_timestamp(0)) < now() - make_interval(hours => cfg.stale_hours)
       and (s.last_pass_at is not null or coalesce(s.attempts,0) < 3)   -- bl_bp_0527: a signup that never passed gets 3 tries, then it is staff's
     order by coalesce(s.last_pass_at, to_timestamp(0)) asc$c$);
    d := replace(d,
      $e$  -- 2. day-N alert: still passing, but we have not been able to re-confirm it$e$,
      $e$  -- 1b. bl_bp_0527: never-passed signups that used up their tries — tell CC once, stop re-screening
  for r in
    select s.org_id, s.outcome, s.reason, s.attempts from app_private.broker_screenings s
      join public.organizations o on o.id = s.org_id
     where o.kind = 'broker' and not coalesce(o.is_demo,false) and coalesce(o.status,'') <> 'archived'
       and s.last_pass_at is null and s.request_id is null
       and coalesce(s.outcome,'') in ('fail','unknown','not_found','error')
       and coalesce(s.attempts,0) >= 3 and s.fail_alerted_at is null
  loop
    update app_private.broker_screenings set fail_alerted_at = now() where org_id = r.org_id;
    perform app_private.broker_authority_alert(r.org_id, 'new_unverified',
      'New broker signup has not passed FMCSA after ' || r.attempts || ' checks (' || coalesce(r.outcome,'?') || ': '
      || coalesce(r.reason,'no reason') || '). Automatic re-screening has stopped. Verify by hand or put the account on hold from the broker-trust queue.');
    v_alert := v_alert + 1;
  end loop;

  -- 2. day-N alert: still passing, but we have not been able to re-confirm it$e$);
    execute d;
  end if;
end $do$;

-- staff alert title for the new kind (anchor patch on broker_authority_alert; falls back to the generic title if missing)
do $do$
declare d text;
begin
  d := pg_get_functiondef('app_private.broker_authority_alert'::regproc);
  if position('new_unverified' in d) = 0 then
    if position($a$                 when 'restored'      then '🟢 Authority confirmed again — '$a$ in d) = 0 then
      raise exception 'bl_bp_0527: anchor not found in broker_authority_alert'; end if;
    d := replace(d, $a$                 when 'restored'      then '🟢 Authority confirmed again — '$a$,
                    $a$                 when 'restored'      then '🟢 Authority confirmed again — '
                 when 'new_unverified' then '🟠 New broker not verified after 3 checks — '$a$);
    execute d;
  end if;
end $do$;
