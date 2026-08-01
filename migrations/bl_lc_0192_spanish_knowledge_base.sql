-- bl_lc_0192 — Spanish knowledge base rows for the live chat.
-- Applied to production 2026-08-01 (this file is the repo record of that change).
--
-- Spanish answers for the questions carriers actually ask us — the 5% fee, finding loads,
-- verification and documents, getting paid, detention and TONU, GPS tracking, posting
-- freight, jobs, signing up, signup failures, "is this a scam", new authority, and how to
-- reach a person. Not translated marketing copy: the same answers the English rows give,
-- written for a Spanish-speaking owner-operator.
--
-- No matcher change is needed. lc_bot_answer matches on the raw visitor text, so Spanish
-- patterns sitting in the same lc_kb table are found by exactly the same lookup that finds
-- the English ones. Priorities are set above the corresponding English rows so that a
-- Spanish phrase can never lose to an accidental English trigram hit — "carga" and
-- "cargas" score against enough English patterns that without the higher priority the
-- wrong row would sometimes win.

insert into app_private.lc_kb (patterns, answer, priority) values
  (array['cuanto cuesta', 'cuánto cuesta', 'cuanto vale', 'precio', 'precios', 'tarifa', 'tarifas', 'comision', 'comisión', 'cuanto cobran', 'que cobran', 'costo', 'mensualidad', 'cuota mensual'],
   'LoadBoot es <b>gratis para empezar</b> — sin mensualidad y sin contrato. 💰

Los transportistas pagan un <b>5% fijo</b>, y solo sobre las cargas que se entregan <b>y se pagan</b>. Si el camión no rueda, usted no paga nada.

Brokers y embarcadores publican cargas <b>gratis, siempre</b>. Detención, TONU, layover y lumper son <b>100% suyos</b> — de eso no tomamos nada.

Detalles: https://loadboot.com/pricing.html',
   30),
  (array['como encuentro cargas', 'encontrar cargas', 'buscar cargas', 'donde estan las cargas', 'tablero de cargas', 'hay cargas', 'necesito cargas', 'conseguir cargas', 'cargas disponibles'],
   'El tablero está abierto y en vivo para transportistas verificados. 🚚

• Sin cargas fantasma: publicar requiere un broker con licencia, y la carga reservada desaparece del tablero al instante.
• Primero en aceptar, primero en llevar. Sin subastas escondidas.
• Además tiene un despachador dedicado que le busca y negocia cargas bajo <b>su propia autoridad</b>.

Tarifas del mercado en vivo, gratis y sin registro: https://loadboot.com/market-rates.html',
   30),
  (array['como me verifico', 'verificacion', 'verificación', 'que documentos necesito', 'documentos requeridos', 'requisitos', 'que necesito para empezar', 'mc dot', 'numero mc', 'seguro requerido'],
   'La verificación mantiene la red limpia, y es rápida. ✅

1) Cree su cuenta gratis (2 minutos)
2) Ponga su MC/DOT — jalamos su registro de FMCSA automáticamente
3) Suba su certificado de seguro (normalmente $1M de responsabilidad y $100K de carga)
4) Firme el W-9 y el acuerdo de despacho digitalmente

Normalmente queda verificado en <b>un día hábil</b>.',
   30),
  (array['cuando me pagan', 'como me pagan', 'quien me paga', 'pago', 'pagos', 'factoring', 'factoraje', 'me retienen el dinero', 'retienen dinero'],
   'Nunca tocamos su dinero. 💵

El broker le paga <b>directamente a usted</b> (o a su factoring). LoadBoot factura su 5% aparte, y solo después de que a usted ya le pagaron.

Si trabaja con factoring: suba su NOA una sola vez y los pagos se dirigen solos a su compañía de factoraje.',
   30),
  (array['detencion', 'detención', 'me tuvieron esperando', 'tiempo de espera', 'tonu', 'carga cancelada', 'layover', 'lumper'],
   'La detención se cobra cuando hay <b>prueba</b> — y ahí es donde la mayoría pierde el dinero. ⏱️

Marcamos su llegada y salida con GPS y geocerca, con hora exacta. Con ese registro el reclamo se gana solo. Lo mismo con TONU, layover y lumper: política publicada, sin sorpresas.

Y ese dinero es <b>completamente suyo</b> — LoadBoot no toma su 5% de la detención.',
   30),
  (array['rastreo', 'gps', 'seguimiento', 'donde esta mi carga', 'ubicacion del camion'],
   'Cada carga lleva rastreo GPS en vivo, con sellos de llegada y salida por geocerca. 📍 Un solo registro compartido entre transportista, broker y embarcador — nadie discute la hora después.',
   25),
  (array['publicar carga', 'publicar cargas', 'como publico una carga', 'soy broker que hago', 'red de transportistas'],
   'Los brokers publican <b>gratis, para siempre</b> — sin cuota por publicación ni suscripción. 🏢

Cada transportista está verificado (autoridad, seguro y seguridad) <b>antes</b> de poder reservar. Cero doble-brokeraje, GPS en cada viaje y documentos recogidos automáticamente.

Empiece aquí: https://loadboot.com/create-broker-account.html — o mande sus cargas por correo a <b>loads@loadboot.com</b> y salen en vivo solas.',
   30),
  (array['necesito enviar carga', 'enviar mercancia', 'soy embarcador', 'sin broker', 'directo al transportista', 'mover mi carga'],
   'Los embarcadores publican directo a transportistas verificados — <b>sin broker de por medio</b>. 📦

Visibilidad GPS de puerta a puerta, prueba de entrega con foto, y un expediente limpio de BOL a POD.

Empiece: https://loadboot.com/create-shipper-account.html',
   30),
  (array['busco trabajo', 'necesito trabajo', 'hay empleo', 'quiero trabajar', 'oportunidad de trabajo', 'puesto de trabajo', 'vacante', 'estoy buscando empleo', 'trabajo de despachador', 'aplicar para un trabajo', 'como aplico', 'enviar mi curriculum', 'mi curriculum', 'tiempo parcial', 'medio tiempo'],
   'Sí — estamos contratando, y trabajar en remoto es lo normal aquí. 💼

<b>Para aplicar:</b> vea las vacantes en <b>https://loadboot.com/careers.html</b> y mande su currículum a <b>hello@loadboot.com</b> con "Dispatcher application" en el asunto. Díganos sus años de experiencia, el equipo que mejor maneja y qué horario puede cubrir.

Le aviso de una vez para no hacerle perder el tiempo: contratamos <b>despachadores</b> — gente que consigue y negocia cargas para camiones. No tenemos puestos de construcción, fábrica ni de conductor. Si su experiencia es de otro rubro, esto probablemente no le sirve.

Y hay un segundo camino: entrar como <b>Agente</b> y ganar el 1% de cada carga entregada de los transportistas que usted traiga. Sin sueldo, pero sin techo.
[[chips:💼 Vacante de despachador=Quiero un puesto de despachador|🤝 Programa de agentes=Cuenteme del programa de agentes|🙋 Hablar con una persona=Quiero hablar con una persona real]]',
   90),
  (array['quiero un puesto de despachador', 'puesto de despachador', 'sueldo de despachador', 'cuanto pagan a un despachador'],
   'Ese es el camino con sueldo. 💼

Las vacantes y los detalles de pago están en <b>https://loadboot.com/careers.html</b>. Mande su currículum a <b>hello@loadboot.com</b> e incluya: años despachando, equipo que mejor conoce, horario que puede cubrir (trabajamos en hora Centro de EE. UU.) y si ya ha despachado bajo la autoridad propia de un transportista.

Deje también su nombre y correo aquí abajo y me aseguro de que lo vean. 👇

[[form:name,email]]',
   88),
  (array['cuenteme del programa de agentes', 'programa de agentes', 'ser agente', 'como funciona el programa de agentes', '1% de comision', 'referidos'],
   'El programa de Agentes es para despachadores que ya tienen transportistas, o que pueden traerlos. 🤝

• Gana el <b>1% del bruto de cada carga entregada</b> de sus transportistas, mientras sigan rodando.
• Sale del 5% de LoadBoot. Sus transportistas no pagan ni un centavo extra.
• Recibe su enlace de referido y un panel de ganancias en vivo.

Empiece: https://loadboot.com/create-agent-account.html',
   86),
  (array['crear cuenta', 'como me registro', 'registrarme', 'abrir cuenta', 'quiero registrarme', 'hacer mi cuenta', 'darme de alta'],
   'Podemos hacerlo aquí mismo en el chat. 🚀 Para transportistas son unos 5 minutos; para los demás, unos 3.

Usted elige su propia contraseña, le mandamos un correo de verificación, y entra a su portal con esos mismos datos.

[[chips:🚚 Soy transportista=Soy transportista|🏢 Soy broker=Soy broker|📦 Soy embarcador=Soy embarcador|🧑‍✈️ Soy despachador=Soy despachador]]',
   30),
  (array['no me llego el correo', 'no recibi el correo', 'error al crear cuenta', 'no puedo crear mi cuenta', 'error de confirmacion', 'no llega la verificacion', 'no puedo entrar', 'no puedo iniciar sesion'],
   'Disculpe — eso es culpa nuestra, no suya. 🙏

A veces nuestro correo de confirmación choca con un límite de envío y el registro marca error aunque la cuenta sí se creó. Primero revise su carpeta de <b>spam o promociones</b> y espere unos minutos.

Si aun así no llega, deje su nombre y correo aquí abajo. Nuestro equipo activa la cuenta a mano y le manda un enlace que sí funciona — normalmente dentro de un día hábil, y no tendrá que registrarse otra vez. 👇

[[form:name,email]]',
   92),
  (array['esto es real', 'es una estafa', 'es confiable', 'se puede confiar', 'quien esta detras', 'son legitimos'],
   'Pregunta justa — esta industria se ganó esa desconfianza. 🛡️

LoadBoot LLC es una empresa registrada en Wyoming, con número D-U-N-S 149880967 y dirección pública en el sitio. <b>Nunca tocamos su dinero</b>: el broker le paga directo a usted. Y cobramos solo cuando a usted ya le pagaron.

Júzguenos después de mirar, no antes: https://loadboot.com/about.html',
   25),
  (array['autoridad nueva', 'soy nuevo', 'acabo de sacar mi mc', 'nueva autoridad', 'recien empiezo', 'primer camion'],
   '¿Autoridad nueva? Los primeros 90 días deciden todo. 🚚

Trabajamos con MC nuevos — muchos boards y brokers no lo hacen. Escribimos la guía completa de qué hacer y qué evitar: https://loadboot.com/do-new-authority-carriers-need-a-dispatcher.html',
   25),
  (array['numero de telefono', 'cual es su telefono', 'como los contacto', 'contacto', 'quiero llamar', 'tienen telefono'],
   'Con gusto. 📞 Llámenos las 24 horas al <b>{PHONE}</b> — contestamos al primer timbre.

Correo: hello@loadboot.com (general) · dispatch@loadboot.com (cargas activas)

O dígame <b>"llámenme"</b> y nosotros lo llamamos a usted — ahora o a la hora que elija.',
   30);
