-- bl_lc_0191 — Live chat answers in Spanish.
-- Applied to production 2026-08-01 (this file is the repo record of that change).
--
-- Live conversation d07c2294 on 1 Aug at 17:29. A visitor opened with "Hola". He then
-- explained, in Spanish, that he is 34, native in both English and Spanish, has experience
-- in construction and in factory work, and is looking for part-time work. He wrote three
-- messages. The bot answered all three in English — twice with the exact same
-- name-and-email card — and never understood a single word of what he said. He left.
--
-- This is not an edge case to file under "nice to have". A large share of US
-- owner-operators speak Spanish first, and a chat widget that answers them in English is
-- the same as no chat widget at all.
--
-- Design: English behaviour is untouched. lc_bot_step gains exactly one branch, at the very
-- top, which hands off to lc_bot_step_es and returns; everything below it runs unchanged for
-- English visitors. Only 'es' is ever written to lc_conversations.lang — the column is never
-- set back to 'en' — so a visitor who opens in English and switches to Spanish halfway
-- through is still picked up, and one Spanish message keeps the rest of the conversation in
-- Spanish even if a later message is short or ambiguous.

alter table app_private.lc_conversations add column if not exists lang text;

-- Language detector: accented characters or ¿¡ decide immediately, otherwise one strong
-- Spanish word or two weak function words is enough to call it Spanish.
CREATE OR REPLACE FUNCTION app_private.lc_detect_lang(p_text text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
declare t text := lower(coalesce(p_text,'')); strong int := 0; weak int := 0;
begin
  if t = '' then return 'en'; end if;
  if t ~ '[ñáéíóúü¿¡]' then return 'es'; end if;
  strong := (select count(*) from unnest(array[
      'hola','buenos dias','buenas tardes','buenas noches','gracias','por favor','quiero','necesito',
      'busco','estoy buscando','me llamo','cuanto cuesta','cuanto vale','como estas','como funciona',
      'ayuda por favor','trabajo','empleo','camion','camiones','carga','cargas','transportista',
      'espanol','disculpe','buenas','tengo experiencia','me interesa','quisiera','podria','puede ayudarme'
    ]) w where position(w in t) > 0);
  weak := (select count(*) from unnest(array[
      ' soy ',' tengo ',' para ',' pero ',' tambien ',' muy ',' bien ',' donde ',' cuando ',' porque ',
      ' esta ',' este ',' eso ',' con ',' una ',' unos ',' mis ',' sus ',' hacer ',' puedo ',' quiere ',
      ' cuenta ',' precio ',' tarifa ',' dinero ',' ahora ',' hoy ',' manana '
    ]) w where position(w in ' ' || t || ' ') > 0);
  if strong >= 1 or weak >= 2 then return 'es'; end if;
  return 'en';
end $function$;

-- The whole Spanish conversation flow: call requests, human handoff, greetings, email and
-- name capture, role routing, knowledge base and fallback — all mirroring the English flow.
CREATE OR REPLACE FUNCTION app_private.lc_bot_step_es(p_conv uuid, p_text text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
declare
  v_conv app_private.lc_conversations; v_ans text; v_role text; v_email text; v_first text; v_num text;
  v_waiting boolean; v_staff_joined boolean;
  v_roles constant text := e'\n\n[[chips:🚚 Soy transportista=Soy transportista|🏢 Soy broker=Soy broker|📦 Soy embarcador=Soy embarcador|🧑‍✈️ Soy despachador=Soy despachador|💼 Busco trabajo=Busco trabajo]]';
  v_help constant text := e'\n\n[[chips:💰 Precios=Cuanto cuesta LoadBoot|🚚 Buscar cargas=Como encuentro cargas|✅ Verificacion=Como me verifico|🙋 Hablar con una persona=Quiero hablar con una persona real]]';
  v_form constant text := e'\n\n[[form:name,email]]';
begin
  select * into v_conv from app_private.lc_conversations where id = p_conv;
  v_waiting := (v_conv.mode = 'human');
  v_staff_joined := exists (select 1 from app_private.lc_messages where conversation_id = p_conv and sender = 'staff');
  v_num := coalesce(nullif(app_private.lc_phone_display(),''), '');

  update app_private.lc_conversations
    set last_msg_at = now(), staff_unread = staff_unread + (case when v_waiting then 1 else 0 end)
    where id = p_conv;
  if v_waiting and v_staff_joined then return; end if;

  -- Wants a call
  if p_text ~* '(llam[ae]|llamar|llamada|telefono|teléfono|hablar por telefono)' then
    insert into app_private.lc_messages (conversation_id, sender, body) values (p_conv, 'bot',
      'Claro que si — con mucho gusto. 📞' || E'\n\n' ||
      case when v_num <> '' then 'Puede llamarnos las 24 horas al ' || v_num || '.' || E'\n\n' else '' end ||
      'O deje su numero abajo y <b>nosotros lo llamamos</b> — ahora mismo, o a la hora que usted elija: 👇' || E'\n\n[[callform]]');
    return;
  end if;

  -- Wants a human
  if app_private.lc_is_human_request(p_text) or p_text ~* '(persona real|hablar con alguien|un humano|agente humano|una persona)' then
    if v_conv.name is null or v_conv.email is null then
      update app_private.lc_conversations set pending_human = true where id = p_conv;
      insert into app_private.lc_messages (conversation_id, sender, body) values (p_conv, 'bot',
        'Por supuesto. 🤝 Solo necesito su nombre y su correo para que el equipo lo atienda bien: 👇' || v_form);
      return;
    end if;
    perform app_private.lc_do_handoff(p_conv, 'human requested (es)');
    return;
  end if;

  -- Greeting
  if p_text ~* '^\s*(hola|holaa+|buenas|buenos dias|buenos días|buenas tardes|buenas noches|que tal|qué tal|saludos|hey)\W*$' then
    insert into app_private.lc_messages (conversation_id, sender, body) values (p_conv, 'bot',
      '¡Hola! 👋 Bienvenido a LoadBoot — el sistema operativo del transporte de carga.' || E'\n\n' ||
      'Le atiendo en español sin problema. Para orientarlo mejor, ¿cuál es su caso?' || v_roles);
    update app_private.lc_conversations set bot_misses = 0 where id = p_conv;
    return;
  end if;

  -- Thanks / closing
  if p_text ~* '^\s*(gracias|muchas gracias|ok|okay|vale|perfecto|listo|adios|adiós|hasta luego)\W*$' then
    insert into app_private.lc_messages (conversation_id, sender, body) values (p_conv, 'bot',
      '¡Con gusto! 🚚 Aquí estoy cuando me necesite.' || v_help);
    update app_private.lc_conversations set bot_misses = 0 where id = p_conv;
    return;
  end if;

  -- Email given
  v_email := (select (regexp_match(coalesce(p_text,''), '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'))[1]);
  if v_email is not null and v_conv.email is null then
    update app_private.lc_conversations set email = v_email, lead_stage = 'done' where id = p_conv;
    perform app_private.lc_capture_lead(p_conv);
    if v_conv.pending_human then perform app_private.lc_do_handoff(p_conv, 'human requested (es)'); return; end if;
    insert into app_private.lc_messages (conversation_id, sender, body) values (p_conv, 'bot',
      '¡Perfecto, guardado! ✅ Nuestro equipo le escribirá a ' || v_email || ' dentro de un día hábil.' || E'\n\n' ||
      'Mientras tanto, pregúnteme lo que quiera.' || v_help);
    return;
  end if;

  -- Role
  if v_conv.visitor_role is null then
    v_role := case
      when p_text ~* '(transportista|camionero|dueño operador|dueno operador|owner operator|tengo un camion|tengo camiones|mi camion)' then 'carrier'
      when p_text ~* '\mbroker' then 'broker'
      when p_text ~* '(embarcador|shipper|envio carga|necesito enviar)' then 'shipper'
      when p_text ~* '(despachador|dispatcher|despacho)' then 'dispatcher'
      else null end;
    if v_role is not null then
      update app_private.lc_conversations set visitor_role = v_role, lead_stage = 'name', bot_misses = 0 where id = p_conv;
      insert into app_private.lc_messages (conversation_id, sender, body) values (p_conv, 'bot',
        (case v_role
          when 'carrier' then '¡Excelente, bienvenido! 🚚' || E'\n' ||
            '• Cuenta gratis → verificación (MC/DOT + seguro + W-9, ~1 día) → cargas' || E'\n' ||
            '• 5% fijo, solo sobre las cargas que realmente le pagan' || E'\n' ||
            '• Tablero en vivo, prueba por GPS, apoyo con factoring' || E'\n' ||
            'Empiece aquí: https://loadboot.com/create-carrier-account.html'
          when 'broker' then 'Para los brokers todo es <b>gratis, siempre</b>. 🏢' || E'\n' ||
            '• Solo transportistas verificados por FMCSA' || E'\n' ||
            '• Cero cargas fantasma, GPS en cada viaje' || E'\n' ||
            'Publique su primera carga: https://loadboot.com/create-broker-account.html'
          when 'shipper' then '¡Bienvenido! 📦 Los embarcadores publican carga directamente a transportistas verificados, sin broker.' || E'\n' ||
            '• Visibilidad GPS de puerta a puerta' || E'\n' ||
            'Empiece: https://loadboot.com/create-shipper-account.html'
          else 'Para los despachadores hay dos caminos: 🧑‍✈️' || E'\n' ||
            '• Un puesto pagado con LoadBoot: https://loadboot.com/careers.html' || E'\n' ||
            '• O como Agente independiente: gana el 1% de cada carga entregada de sus transportistas — https://loadboot.com/create-agent-account.html'
        end) || E'\n\n¿Quiere que nuestro equipo le dé seguimiento personal? Deje sus datos: 👇' ||
        case when v_conv.email is null then v_form else '' end);
      return;
    end if;
  end if;

  -- Knowledge base (Spanish rows live in the same table)
  v_ans := app_private.lc_bot_answer(p_text);
  if v_ans is not null then
    insert into app_private.lc_messages (conversation_id, sender, body) values (p_conv, 'bot', v_ans);
    update app_private.lc_conversations set bot_misses = 0 where id = p_conv;
    return;
  end if;

  -- Name capture
  if v_conv.lead_stage = 'name' and length(trim(coalesce(p_text,''))) between 2 and 40 and coalesce(p_text,'') !~ '\?' then
    v_first := initcap(regexp_replace(trim(p_text), '^(me llamo|mi nombre es|soy)\s+', '', 'i'));
    update app_private.lc_conversations set name = v_first, lead_stage = 'email' where id = p_conv;
    insert into app_private.lc_messages (conversation_id, sender, body) values (p_conv, 'bot',
      '¡Mucho gusto, ' || v_first || '! 🤝 Déjeme su correo y le enviamos la guía y las tarifas actuales. 👇' || e'\n\n[[form:email]]');
    return;
  end if;

  -- Fallback
  perform app_private.lc_log_miss(p_text);
  if v_conv.bot_misses >= 1 then
    if v_conv.name is null or v_conv.email is null then
      update app_private.lc_conversations set pending_human = true where id = p_conv;
      insert into app_private.lc_messages (conversation_id, sender, body) values (p_conv, 'bot',
        'Quiero que reciba una respuesta exacta de nuestro equipo. Déjeme su nombre y correo: 👇' || v_form);
      return;
    end if;
    perform app_private.lc_do_handoff(p_conv, 'bot could not answer (es)');
  else
    insert into app_private.lc_messages (conversation_id, sender, body) values (p_conv, 'bot',
      'Disculpe, no estoy seguro de haberle entendido. Puedo ayudarle con: precios y la comisión del 5% · encontrar o publicar cargas · verificación y documentos · pagos, factoring y detención · rastreo GPS · empleo y despacho · impuestos (IFTA, 2290).' || E'\n\n' ||
      'Elija una opción o escríbame su pregunta de otra forma:' || v_help);
    update app_private.lc_conversations set bot_misses = bot_misses + 1 where id = p_conv;
  end if;
end $function$;

-- The English entry point, patched: one branch at the top routes Spanish visitors into
-- lc_bot_step_es and returns. Everything below it is the English flow, unchanged.
CREATE OR REPLACE FUNCTION app_private.lc_bot_step(p_conv uuid, p_text text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'app_private, public'
AS $function$
declare
  v_conv app_private.lc_conversations; v_ans text;
  v_text text := lower(coalesce(trim(p_text),''));
  v_role text; v_email text; v_first text; v_num text;
  v_waiting boolean; v_staff_joined boolean;
  v_role_chips constant text := e'\n\n[[chips:🚚 I''m a carrier=I''m a carrier|🏢 I''m a broker=I''m a broker|📦 I''m a shipper=I''m a shipper|🧑‍✈️ Dispatcher=I''m a dispatcher|📣 Referral=I''m interested in the referral program]]';
  v_help_chips constant text := e'\n\n[[chips:✅ Get verified=How do I get verified?|💰 Pricing=What does LoadBoot cost?|🚚 Find loads=How do I find loads for my truck?|🙋 Talk to a person=I want to talk to a real person]]';
  v_contact_form constant text := e'\n\n[[form:name,email]]';
  v_ack constant text := '✓ Our team has been notified and a real person will reply right here. Meanwhile I''m still around — ask me anything (pricing, loads, verification, payments…).';
begin
  select * into v_conv from app_private.lc_conversations where id = p_conv;
  v_waiting := (v_conv.mode = 'human');
  v_staff_joined := exists (select 1 from app_private.lc_messages where conversation_id = p_conv and sender = 'staff');
  v_num := coalesce(nullif(app_private.lc_phone_display(),''), 'our 24/7 line');

  -- Spanish visitors get the entire flow in Spanish. Only 'es' is ever stored, so a
  -- visitor who opens in English and switches later is still picked up.
  if coalesce(v_conv.lang,'') = 'es' or app_private.lc_detect_lang(p_text) = 'es' then
    update app_private.lc_conversations set lang = 'es' where id = p_conv and coalesce(lang,'') <> 'es';
    perform app_private.lc_bot_step_es(p_conv, p_text);
    return;
  end if;

  update app_private.lc_conversations
    set last_msg_at = now(), staff_unread = staff_unread + (case when v_waiting then 1 else 0 end)
    where id = p_conv;

  if v_waiting and v_staff_joined then return; end if;

  if v_text ~ '(call me|call back|callback|give me a call|phone call|can you call|call kar|talk on (the )?phone|speak on (the )?phone|by phone|over the phone)' then
    insert into app_private.lc_messages (conversation_id, sender, body)
      values (p_conv, 'bot',
        case when coalesce(v_conv.visitor_role,'') in ('carrier','broker','shipper')
          then e'Absolutely — happy to get you on the phone! 📞\n\nYou can call us anytime, 24/7: ' || v_num || e' — answered on the first ring.\n\nOr drop your number below and WE call YOU — right now, or at a time you pick: 👇\n\n[[callform]]'
          else e'Absolutely — happy to get you on the phone! 📞\n\nCall us anytime, 24/7: ' || v_num || e'\n\nOr drop your number below and WE call YOU — right now, or at a time you pick: 👇\n\n[[callform]]'
        end);
    update app_private.lc_conversations set bot_misses = 0 where id = p_conv;
    return;
  end if;

  if (not v_waiting) and app_private.lc_is_human_request(p_text) then
    if v_conv.visitor_role is null then
      update app_private.lc_conversations set pending_human = true where id = p_conv;
      insert into app_private.lc_messages (conversation_id, sender, body)
        values (p_conv, 'bot', e'Of course! 🤝 One quick thing so this reaches the right person — which one are you?' || v_role_chips);
      return;
    end if;
    if v_conv.name is null or v_conv.email is null then
      update app_private.lc_conversations set pending_human = true where id = p_conv;
      insert into app_private.lc_messages (conversation_id, sender, body)
        values (p_conv, 'bot', e'Of course! Real quick so our team picks this up properly — your name and best email: 👇' || v_contact_form);
      return;
    end if;
    perform app_private.lc_do_handoff(p_conv, 'human requested');
    return;
  end if;

  if v_text ~ '^(hi|hii+|hello|helo|hey|hey there|hi there|hello there|salam|salaam|assalam.*|as-salam.*|good (morning|afternoon|evening)|howdy|yo|sup|whats up|what''s up)[[:punct:] ]*$' then
    insert into app_private.lc_messages (conversation_id, sender, body)
      values (p_conv, 'bot', 'Hey! 👋 Welcome to LoadBoot — the operating system for trucking.' ||
        case when v_waiting then e'\nOur team is on the way — meanwhile I can answer anything.' else '' end ||
        case when v_conv.visitor_role is null then e'\n\nTo point you to the right things — which one are you?' || v_role_chips
             else e'\n\nWhat can I help you with today?' || v_help_chips end);
    update app_private.lc_conversations set bot_misses = 0 where id = p_conv;
    return;
  end if;

  if v_text ~ '^(thanks|thank you|thankyou|thx|ty|great|perfect|awesome|ok|okay|bye|goodbye|see you|good night|email works.*)[[:punct:] ]*$' then
    insert into app_private.lc_messages (conversation_id, sender, body)
      values (p_conv, 'bot', 'Anytime! 🚚 I''m here whenever you need' || case when v_waiting then ' — and our team will still follow up here.' else '.' || e'\n\n[[chips:🙋 Talk to a person=I want to talk to a real person|💰 Pricing=What does LoadBoot cost?]]' end);
    update app_private.lc_conversations set bot_misses = 0 where id = p_conv;
    return;
  end if;

  v_email := (select (regexp_match(coalesce(p_text,''), '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'))[1]);
  if v_email is not null and v_conv.email is null then
    update app_private.lc_conversations set email = v_email, lead_stage = 'done' where id = p_conv;
    perform app_private.lc_capture_lead(p_conv);
    if v_conv.pending_human then
      perform app_private.lc_do_handoff(p_conv, 'human requested');
      return;
    end if;
    insert into app_private.lc_messages (conversation_id, sender, body)
      values (p_conv, 'bot', 'Perfect — saved! ✅ Our team will follow up at ' || v_email || ' with next steps' ||
        case when v_conv.visitor_role = 'carrier' then ' (and current lane rates)' when v_conv.visitor_role = 'broker' then ' (and how free posting works)' else '' end ||
        '. Meanwhile, keep asking me anything!' || v_help_chips);
    return;
  end if;

  if v_conv.visitor_role is null
     and v_text !~ '(what|how|why|when|where|which|require|onboard|cost|price|fee|need|\?)' then
    v_role := case
      when v_text ~ 'owner[- ]?operator|\mcarrier\M|my truck|my authority|i drive' then 'carrier'
      when v_text ~ '\mbroker' then 'broker'
      when v_text ~ '\mshipper\M|i ship ' then 'shipper'
      when v_text ~ 'dispatcher|dispatching' then 'dispatcher'
      when v_text ~ 'referral|influencer' then 'referral'
      else null end;
    if v_role is not null and (length(v_text) <= 40 or v_text ~ '^(i''?m|i am|im|we are|we''?re)') then
      update app_private.lc_conversations set visitor_role = v_role, lead_stage = 'name', bot_misses = 0 where id = p_conv;
      if v_conv.pending_human then
        if v_conv.name is null or v_conv.email is null then
          insert into app_private.lc_messages (conversation_id, sender, body)
            values (p_conv, 'bot', e'Got it 👍 Now your name and best email, so our team can pick this up properly: 👇' || v_contact_form);
        else
          perform app_private.lc_do_handoff(p_conv, 'human requested');
        end if;
        return;
      end if;
      insert into app_private.lc_messages (conversation_id, sender, body) values (p_conv, 'bot',
        (case v_role
          when 'carrier' then e'Awesome — welcome, carrier! 🚚 Here''s your fast lane:\n• Free account → verify (MC/DOT + insurance + W-9, ~1 day) → loads\n• Flat 5%, only on loads you actually get paid for\n• Live board, GPS proof, detention playbook, factoring support\nStart here: https://loadboot.com/create-carrier-account.html'
          when 'broker' then e'Great — brokers post 100% free here. 🏢\n• Verified carriers only (authority + insurance checked at booking)\n• Zero ghost trucks, GPS on every load, geofenced timestamps\nPost your first test load: https://loadboot.com/create-broker-account.html'
          when 'shipper' then e'Welcome! 📦 Shippers post freight directly to verified carriers — no broker needed.\n• Live GPS visibility door to door\n• Clean documents on every shipment (BOL → POD)\nStart: https://loadboot.com/create-shipper-account.html'
          when 'dispatcher' then e'Nice — dispatchers have two great doors here: 🧑‍✈️\n• Work as a LoadBoot dispatcher (salaried roles): https://loadboot.com/careers.html\n• Independent? Join as an Agent and earn 1% of every delivered load your clients move: https://loadboot.com/create-agent-account.html'
          else e'Love it — the referral program pays you from OUR fee, your people never pay extra. 📣\n• 1% of gross on every delivered load you refer\n• One link for carriers, brokers and shippers + live earnings tracking\nJoin: https://loadboot.com/create-agent-account.html'
        end) || e'\n\nWant our team to personally follow up? Drop your details: 👇' ||
        case when v_conv.email is null then v_contact_form else '' end);
      return;
    end if;
  end if;

  v_ans := app_private.lc_bot_answer(p_text);
  if v_ans is not null then
    insert into app_private.lc_messages (conversation_id, sender, body) values (p_conv, 'bot', v_ans);
    update app_private.lc_conversations set bot_misses = 0 where id = p_conv;
    return;
  end if;

  if v_conv.lead_stage = 'name' and length(trim(coalesce(p_text,''))) between 2 and 40 and coalesce(p_text,'') !~ '\?' then
    v_first := initcap(regexp_replace(trim(p_text), '^(my name is|i am|i''?m|im|this is)\s+', '', 'i'));
    update app_private.lc_conversations set name = v_first, lead_stage = 'email' where id = p_conv;
    insert into app_private.lc_messages (conversation_id, sender, body)
      values (p_conv, 'bot', 'Great to meet you, ' || v_first || '! 🤝 Drop your best email below — our team will send your setup guide and current rates there. 👇' || e'\n\n[[form:email]]');
    return;
  end if;

  perform app_private.lc_log_miss(p_text);
  if v_waiting then
    if not exists (select 1 from app_private.lc_messages
                   where conversation_id = p_conv and sender = 'bot' and body like '✓ Our team has been notified%') then
      insert into app_private.lc_messages (conversation_id, sender, body) values (p_conv, 'bot', v_ack);
    end if;
    return;
  end if;
  if v_conv.bot_misses >= 1 then
    if v_conv.name is null or v_conv.email is null then
      update app_private.lc_conversations set pending_human = true where id = p_conv;
      insert into app_private.lc_messages (conversation_id, sender, body)
        values (p_conv, 'bot', e'I want you to get an exact answer from our team — real quick, your name and best email so they can pick this up: 👇' || v_contact_form);
      return;
    end if;
    perform app_private.lc_do_handoff(p_conv, 'bot could not answer');
  else
    insert into app_private.lc_messages (conversation_id, sender, body)
      values (p_conv, 'bot', e'Hmm, let me make sure I get you the right thing — I''m great with: pricing & the 5% fee · finding/posting loads · verification & documents · payments, factoring & detention · GPS tracking · dispatch & careers · taxes (IFTA, 2290) · fleet tools.\n\nTry one of these, or rephrase your question:' ||
        e'\n\n[[chips:🙋 Talk to a person=I want to talk to a real person|✅ Get verified=How do I get verified?|💰 Pricing=What does LoadBoot cost?|🚚 Find loads=How do I find loads for my truck?|📦 Post a load=How do I post a load?]]');
    update app_private.lc_conversations set bot_misses = bot_misses + 1 where id = p_conv;
  end if;
end $function$;
