-- bl_match_0568 (23 Oct 2026, Yaseen): match alerts go to NON-compliant carriers too (real loads push them to finish
-- verification). Undoes the bl_match_0567 compliant gate. For a carrier that is not compliant the alert says it
-- cannot book yet and the button goes to Documents. Same 3/day cap.

do $mig$
declare v_def text;
  a_gate constant text := E'\n              and dp.carrier_id in (select e.carrier_id from app_private.match_eligibility(l.id) e where e.compliant)';
begin
  v_def := pg_get_functiondef('app_private.tp_match_new_load(uuid)'::regprocedure);
  if position(a_gate in v_def) > 0 then execute replace(v_def, a_gate, ''); end if;
end $mig$;

create or replace function app_private.match_send_alert(p_carrier uuid, l public.loads, p_kind text, p_basis text, p_extra text)
returns boolean language plpgsql security definer set search_path to 'app_private','public','extensions','pg_temp' as $$
declare v_uid uuid; v_email text; v_key text; v_lane text; v_sub text; v_html text; v_txt text; v_gate jsonb;
  v_url text := '/app/carrier/#loads'; v_rate text; v_rpm text; v_ok boolean;
begin
  v_uid := app_private.match_carrier_user(p_carrier);
  if v_uid is null then return false; end if;
  select u.email into v_email from auth.users u where u.id = v_uid;
  begin
    select exists (select 1 from app_private.match_eligibility(l.id) e where e.carrier_id = p_carrier and e.compliant) into v_ok;
  exception when others then v_ok := true; end;   -- unknown -> plain alert, never block it
  if not v_ok then v_url := '/app/carrier/#documents'; end if;
  v_key := case when p_kind = 'posted' then 'load.match.posted_truck' else 'load.match.prefs' end;
  v_lane := coalesce(l.origin,'—') || ' → ' || coalesce(l.destination,'—');
  v_rate := '$' || to_char(l.rate, 'FM999,999,990');
  if l.rate is not null and coalesce(l.miles,0) > 0 then v_rpm := '$' || round(l.rate / l.miles, 2)::text || '/mi'; end if;
  v_sub := case when v_ok then 'Load match: ' else 'Load match (finish verification to book): ' end || v_lane || coalesce(' · ' || v_rate, '');

  begin
    v_html := app_private.email_kit(jsonb_build_object(
      'eyebrow', case when v_ok
        then jsonb_build_object('text', case when p_kind = 'posted' then 'Matches your posted truck' else 'Matches your dispatch preferences' end, 'tone', 'info')
        else jsonb_build_object('text', 'Finish verification to book', 'tone', 'warning') end,
      'title', v_lane,
      'intro_html', case when p_kind = 'posted' then 'A new load on LoadBoot fits the truck you posted.'
                         else 'A new load on LoadBoot fits the equipment, lanes and rates in your dispatch preferences.' end
                    || case when v_ok then '' else '<br><br><b style="color:#92400e">Your LoadBoot verification is not complete yet, so you cannot book this load.</b> Finish your documents and loads like this one become bookable for you.' end
                    || coalesce('<br><br><b style="color:#92400e">' || app_private.h_esc(p_extra) || '</b>', ''),
      'facts', jsonb_build_array(
        jsonb_build_object('k','Rate','v', coalesce(v_rate,'—') || coalesce(' · ' || v_rpm, '')),
        jsonb_build_object('k','Miles','v', coalesce(l.miles::text || ' mi','—')),
        jsonb_build_object('k','Equipment','v', coalesce(l.equipment,'—')),
        jsonb_build_object('k','Pickup','v', coalesce(l.pickup_date::text,'—')),
        jsonb_build_object('k','Why you','v', coalesce(nullif(p_basis,''),'—'))),
      'cta', jsonb_build_object('label', case when v_ok then 'Open in LoadBoot' else 'Finish verification' end, 'url','https://loadboot.com' || v_url),
      'note', 'We send at most 3 load alerts a day, best matches first. What we match comes from your dispatch preferences.'));
    v_txt := v_lane || E'\n' || coalesce(v_rate,'') || coalesce(' · ' || l.miles::text || ' mi','') || coalesce(' · ' || l.equipment,'')
             || case when v_ok then '' else E'\nYour verification is not complete yet, so you cannot book this load. Finish your documents to start booking.' end
             || coalesce(E'\n' || p_extra, '') || E'\n\nOpen it: https://loadboot.com' || v_url;
    if v_email is not null then
      v_gate := app_private.email_gate(v_key, v_email, v_uid);
      if coalesce((v_gate->>'allowed')::boolean, true) then
        perform app_private.sys_email(v_email, v_key, v_sub, v_html, v_txt, 'match:' || p_carrier::text || ':' || l.id::text);
      end if;
    end if;
  exception when others then raise warning 'match email failed %: %', l.id, sqlerrm; end;

  begin perform app_private.push_enqueue(v_uid, 'Load match: ' || v_lane,
      coalesce(v_rate,'') || coalesce(' · ' || v_rpm,'') || case when v_ok then '' else ' · finish verification to book' end,
      v_url, 'match-' || p_carrier::text || '-' || l.id::text);
  exception when others then null; end;

  begin
    perform app_private.match_sms(v_uid, p_carrier,
      app_private.sms_clean('Load match: ' || coalesce(l.origin,'?') || ' to ' || coalesce(l.destination,'?') || coalesce(', ' || v_rate,'')
        || coalesce(', ' || l.miles::text || ' mi','') || coalesce(', ' || l.equipment,'') || coalesce(', pickup ' || l.pickup_date::text,'')
        || case when v_ok then '. loadboot.com/app/carrier' else '. Finish your verification to book: loadboot.com/app/carrier' end, 230),
      'match-sms:' || p_carrier::text || ':' || l.id::text);
  exception when others then raise warning 'match sms failed %: %', l.id, sqlerrm; end;
  return true;
end $$;
