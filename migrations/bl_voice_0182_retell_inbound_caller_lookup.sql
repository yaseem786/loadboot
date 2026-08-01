-- bl_voice_0182 — inbound caller lookup for Riley (applied to production 2026-08-01).
--
-- Retell calls this the moment a call arrives on our line, with the caller's number.
-- We look the number up and hand back the SAME dynamic variables the outbound path already
-- uses (name / role / topic / context / source), so the existing agent prompt works unchanged
-- and Riley can greet a known carrier by name and already know where they stand.
--
-- Retell inbound webhook contract:
--   request : { "event":"call_inbound", "call_inbound": { "from_number":..., "to_number":... } }
--   response: { "call_inbound": { "dynamic_variables": { ... } } }
-- Configured in Retell as the phone number's inbound webhook:
--   https://<ref>.supabase.co/rest/v1/rpc/retell_inbound?apikey=<anon key>
--
-- Lookup order: registered profile -> broker who emailed loads@ -> website form submission -> new caller.
--
-- SECURITY: SECURITY DEFINER, executable by anon because Retell posts with the anon key
-- (same pattern as retell_webhook — this takes the anon-executable definer count from 26 to 27).
-- Guards: the payload must be a call_inbound event AND to_number must equal our configured
-- line, so it cannot be used as a general phone-number lookup. It returns only first name,
-- company, role and onboarding status — no documents, no email, no financial data — and it
-- writes nothing.

create or replace function public.retell_inbound(jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'app_private, public'
as $function$
declare
  payload jsonb := $1;
  cfg app_private.retell_config;
  v_from text; v_to text; v_last10 text;
  p record; b record; f record;
  v_name text; v_role text; v_context text;
begin
  if coalesce(payload->>'event','') <> 'call_inbound' then
    return jsonb_build_object('call_inbound', jsonb_build_object());
  end if;

  select * into cfg from app_private.retell_config where id = 1;
  v_from := regexp_replace(coalesce(payload->'call_inbound'->>'from_number',''), '[^0-9]', '', 'g');
  v_to   := coalesce(payload->'call_inbound'->>'to_number','');

  if cfg.from_number is null or v_to is distinct from cfg.from_number then
    return jsonb_build_object('call_inbound', jsonb_build_object());
  end if;

  v_last10 := right(v_from, 10);
  if length(v_last10) < 10 then
    return jsonb_build_object('call_inbound', jsonb_build_object('dynamic_variables',
      jsonb_build_object('name','there','role','carrier','topic','your call',
        'context','Unknown caller - number withheld. Greet warmly, ask who you are speaking with and what they need.',
        'source','inbound')));
  end if;

  select * into p from public.profiles
   where right(regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g'), 10) = v_last10
   order by created_at desc limit 1;

  if p.id is not null then
    v_name := coalesce(nullif(split_part(trim(coalesce(p.contact_name,'')), ' ', 1),''), 'there');
    v_role := coalesce(nullif(p.role,''), 'carrier');
    v_context :=
      'KNOWN CALLER - they are already registered with us, so greet them by name and sound like you know them.' ||
      E'\nName: ' || coalesce(nullif(p.contact_name,''),'unknown') ||
      coalesce(E'\nCompany: ' || nullif(p.company,''), '') ||
      E'\nRole: ' || v_role ||
      coalesce(E'\nMC: ' || nullif(p.mc,''), '') ||
      coalesce(E'\nDOT: ' || nullif(p.dot,''), '') ||
      coalesce(E'\nEquipment: ' || nullif(p.equipment,''), '') ||
      coalesce(E'\nTrucks: ' || nullif(p.truck_count::text,''), '') ||
      coalesce(E'\nLanes: ' || nullif(p.lanes,''), '') ||
      coalesce(E'\nHome base: ' || nullif(p.home_base,''), '') ||
      E'\nAccount status: ' || coalesce(nullif(p.status,''),'unknown') ||
      case coalesce(p.status,'')
        when 'pending' then E'\nWHERE THEY STAND: their account is still pending - documents or the final activation step are outstanding. If it fits the conversation, offer to help them finish. Do not guess which document is missing; ask.'
        when 'active'  then E'\nWHERE THEY STAND: their account is active. Treat them as an existing customer.'
        else '' end ||
      E'\nNever read their MC or DOT number back to them unless they ask - it is just context for you.';
    return jsonb_build_object('call_inbound', jsonb_build_object('dynamic_variables',
      jsonb_build_object('name', v_name, 'role', v_role, 'topic','your LoadBoot account',
                         'context', v_context, 'source','inbound')));
  end if;

  select * into b from app_private.email_brokers
   where right(regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g'), 10) = v_last10
   order by created_at desc limit 1;

  if b.id is not null then
    v_context :=
      'KNOWN BROKER - they have sent us freight by email before, so they are not a stranger.' ||
      coalesce(E'\nCompany: ' || nullif(b.company,''), '') ||
      coalesce(E'\nContact: ' || nullif(b.contact_name,''), '') ||
      coalesce(E'\nMC: ' || nullif(b.mc_number,''), '') ||
      E'\nWHERE THEY STAND: posting is free for brokers - no subscription, no per-post fee, and their contact details stay on every load. If they have freight now, the fastest route is emailing it to loads at loadboot dot com; it goes live in front of FMCSA-verified carriers.';
    return jsonb_build_object('call_inbound', jsonb_build_object('dynamic_variables',
      jsonb_build_object('name', coalesce(nullif(split_part(trim(coalesce(b.contact_name,'')),' ',1),''),'there'),
                         'role','broker','topic','your freight','context', v_context,'source','inbound')));
  end if;

  select * into f from app_private.form_submissions
   where right(regexp_replace(coalesce(phone,''), '[^0-9]', '', 'g'), 10) = v_last10
   order by created_at desc limit 1;

  if f.id is not null then
    v_context :=
      'CALLER FROM OUR WEBSITE - they filled in a form on loadboot.com, so they already know who we are.' ||
      coalesce(E'\nName given: ' || nullif(f.name,''), '') ||
      coalesce(E'\nCompany: ' || nullif(f.company,''), '') ||
      coalesce(E'\nForm: ' || nullif(f.form_key,''), '') ||
      coalesce(E'\nWhat they wrote: ' || left(nullif(f.message,''), 400), '') ||
      E'\nWHERE THEY STAND: pick up the thread from what they wrote. Confirm their email before the call ends.';
    return jsonb_build_object('call_inbound', jsonb_build_object('dynamic_variables',
      jsonb_build_object('name', coalesce(nullif(split_part(trim(coalesce(f.name,'')),' ',1),''),'there'),
                         'role','carrier','topic','your enquiry','context', v_context,'source','inbound')));
  end if;

  return jsonb_build_object('call_inbound', jsonb_build_object('dynamic_variables',
    jsonb_build_object('name','there','role','carrier','topic','your call',
      'context','NEW CALLER - this number is not in our system. Greet warmly, introduce LoadBoot briefly, and find out whether they run trucks, have freight to move, or dispatch for carriers. Then guide them to the right next step. Take their name and email before the call ends.',
      'source','inbound')));
end;
$function$;

revoke all on function public.retell_inbound(jsonb) from public;
grant execute on function public.retell_inbound(jsonb) to anon, authenticated, service_role;
