-- bl_dev_0502c — HTML-escape developer-typed text (name, company, use case, staff reason, key name) in the developer
-- emails (app_private.dev_send_email) and the staff production-request email (public.dev_request_production).
-- Found while testing bl_dev_0502b on staging, before any real send. Uses the existing app_private.h_esc().
-- Applied: staging 2026-09-29. Prod: together with 0502 / 0502b.

create or replace function app_private.dev_send_email(p_user uuid, p_key text, p_extra jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path to 'app_private', 'public' as $$
declare
  v_to text; v_who text; v_who_raw text; v_subj text; v_body text; v_text text; v_idem text; d app_private.developer_accounts;
  v_note text := nullif(btrim(coalesce(p_extra->>'note', '')), '');
  h2 constant text := '<h2 style="margin:0 0 12px;font-size:24px;font-weight:800;color:#10223B">';
  p  constant text := '<p style="color:#475569;margin:0 0 14px;line-height:1.55">';
  box constant text := '<div style="background:#f6f9fd;border:1px solid #e3edfa;border-radius:12px;padding:14px 18px;margin:0 0 18px;color:#334155">';
  v_portal constant text := 'https://loadboot.com/app/developer/';
begin
  select * into d from app_private.developer_accounts where user_id = p_user;
  select coalesce(d.email, u.email) into v_to from auth.users u where u.id = p_user;
  if v_to is null then return; end if;
  v_who_raw := coalesce(nullif(btrim(d.name), ''), nullif(btrim(d.company), ''), split_part(v_to, '@', 1));
  v_who := app_private.h_esc(coalesce(nullif(btrim(d.name), ''), nullif(btrim(d.company), ''), split_part(v_to, '@', 1)));
  v_note := app_private.h_esc(v_note);

  if p_key = 'developer.welcome' then
    v_subj := 'Welcome to LoadBoot Developers, ' || v_who_raw;
    v_body := h2 || 'Welcome, ' || v_who || '</h2>'
      || p || 'Your LoadBoot developer account is ready. Start in the <b>sandbox</b>: a sandbox key returns fixed test loads, so you can build and test without touching the real board.</p>'
      || box || '<b style="color:#10223B">Three steps</b><br>1. Create a sandbox key in the portal (it is shown once — copy it)<br>'
      || '2. Call <code>?resource=me</code>, then <code>?resource=loads</code><br>3. When your integration works, press <b>Request production access</b></div>';
    v_idem := 'developer.welcome:' || p_user;
  elsif p_key = 'developer.production_approved' then
    v_subj := 'Production API access approved';
    v_body := h2 || 'You are approved for production</h2>'
      || p || 'LoadBoot approved production API access for <b>' || coalesce(app_private.h_esc(d.company), v_who) || '</b>. Open the portal and create a <b>production read key</b>.</p>'
      || box || 'Loads you show from our API carry "via LoadBoot" and link back with the load''s ref: <br><code>https://loadboot.com/app/carrier/?src=' || app_private.h_esc(coalesce(d.partner_slug, 'api')) || '&amp;ref={ref}</code></div>'
      || coalesce(p || 'Note from our team: ' || v_note || '</p>', '');
    v_idem := 'developer.production_approved:' || p_user || ':' || coalesce(p_extra->>'request_id', to_char(now(), 'YYYYMMDDHH24MI'));
  elsif p_key = 'developer.production_denied' then
    v_subj := 'About your production API request';
    v_body := h2 || 'Production access not approved yet</h2>'
      || p || 'We reviewed your request for production API access and could not approve it right now.</p>'
      || coalesce(box || '<b style="color:#10223B">Reason</b><br>' || v_note || '</div>', '')
      || p || 'Your sandbox keeps working. Reply to this email or write to hello@loadboot.com if you have more to share.</p>';
    v_idem := 'developer.production_denied:' || p_user || ':' || coalesce(p_extra->>'request_id', to_char(now(), 'YYYYMMDDHH24MI'));
  elsif p_key = 'developer.suspended' then
    v_subj := 'Your LoadBoot API access is suspended';
    v_body := h2 || 'API access suspended</h2>'
      || p || 'LoadBoot suspended API access for your developer account. All of your API keys stop working until this is lifted.</p>'
      || coalesce(box || '<b style="color:#10223B">Reason</b><br>' || v_note || '</div>', '')
      || p || 'Write to hello@loadboot.com to talk to us about it.</p>';
    v_idem := 'developer.suspended:' || p_user || ':' || to_char(now(), 'YYYYMMDDHH24MI');
  elsif p_key = 'developer.key_revoked' then
    v_subj := 'An API key on your LoadBoot account was revoked';
    v_body := h2 || 'API key revoked</h2>'
      || p || 'LoadBoot revoked the key <code>' || app_private.h_esc(coalesce(p_extra->>'key_prefix', '')) || '</code>'
      || coalesce(' (' || app_private.h_esc(nullif(p_extra->>'key_name', '')) || ')', '') || '. Calls made with it now return 401.</p>'
      || coalesce(box || '<b style="color:#10223B">Reason</b><br>' || v_note || '</div>', '')
      || p || 'You can create a new key in the portal. Questions: hello@loadboot.com.</p>';
    v_idem := 'developer.key_revoked:' || coalesce(p_extra->>'key_id', p_user::text);
  else
    return;
  end if;

  v_body := v_body
    || '<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:12px;background:#FC5305">'
    || '<a href="' || v_portal || '" style="display:inline-block;padding:13px 24px;color:#ffffff;font-weight:700;text-decoration:none;font-size:15px">Open the Developer Portal →</a></td></tr></table>';
  v_text := regexp_replace(regexp_replace(v_body, '<br>|</p>|</div>|</h2>', E'\n', 'g'), '<[^>]+>', '', 'g') || E'\n' || v_portal;
  begin
    perform app_private.sys_email(v_to, p_key, v_subj, v_body, v_text, v_idem);
  exception when others then null;
  end;
end $$;
revoke execute on function app_private.dev_send_email(uuid, text, jsonb) from public;

create or replace function public.dev_request_production(p jsonb)
returns jsonb language plpgsql security definer set search_path to 'app_private', 'public' as $$
declare v_uid uuid := auth.uid(); d app_private.developer_accounts; v_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '42501'; end if;
  select * into d from app_private.developer_accounts where user_id = v_uid;
  if not found then raise exception 'Complete your developer profile first.' using errcode = '22023'; end if;
  if d.status = 'approved' then raise exception 'You already have production access.' using errcode = '22023'; end if;
  if d.status = 'suspended' then raise exception 'Your developer account is suspended. Contact hello@loadboot.com.' using errcode = '42501'; end if;
  if exists (select 1 from app_private.developer_access_requests where user_id = v_uid and status = 'pending') then
    raise exception 'Your request is already with our team.' using errcode = '22023';
  end if;
  if coalesce(btrim(coalesce(p->>'use_case', d.use_case)), '') = '' then
    raise exception 'Tell us what you are building.' using errcode = '22023';
  end if;
  if coalesce(btrim(coalesce(d.company, p->>'company')), '') = '' then
    raise exception 'Add your company name to your profile first.' using errcode = '22023';
  end if;
  insert into app_private.developer_access_requests (user_id, use_case, expected_volume, integration_url, message)
  values (v_uid, left(coalesce(nullif(btrim(p->>'use_case'), ''), d.use_case), 2000),
          left(coalesce(nullif(btrim(p->>'expected_volume'), ''), d.expected_volume), 100),
          left(nullif(btrim(p->>'integration_url'), ''), 300), left(nullif(btrim(p->>'message'), ''), 2000))
  returning id into v_id;
  perform app_private.log_audit('developer.request', 'developer_account', v_uid::text, null, 'Developer requested production access',
                                jsonb_build_object('request_id', v_id), null);
  begin
    insert into app_private.notifications (recipient_role, channel, template_key, payload, status, sent_at)
    values ('staff', 'in_app', 'developer.production_requested',
      jsonb_build_object('title', 'Developer wants production API access', 'body', coalesce(d.company, d.email) || ' requested production access.',
                         'tone', 'info', 'url', '/app/command-center/#/api360?id=' || v_uid), 'sent', now());
  exception when others then null; end;
  begin
    perform app_private.sys_email(app_private.lc_alert_email(), 'developer.production_requested',
      '[LoadBoot] Production API request: ' || coalesce(d.company, d.email),
      '<p><b>' || app_private.h_esc(coalesce(d.company, '(no company)')) || '</b> (' || app_private.h_esc(coalesce(d.email, '')) || ') asked for production API access.</p>'
      || '<p>What they are building: ' || app_private.h_esc(coalesce(left(coalesce(nullif(btrim(p->>'use_case'), ''), d.use_case), 400), '—')) || '</p>'
      || '<p>Review it in <a href="https://loadboot.com/app/command-center/#/api360?id=' || v_uid || '">Command Center → API 360</a>.</p>',
      null, 'developer.production_requested:' || v_id);
  exception when others then null; end;
  return public.dev_portal_state();
end $$;
revoke execute on function public.dev_request_production(jsonb) from public, anon;
grant execute on function public.dev_request_production(jsonb) to authenticated, service_role;
