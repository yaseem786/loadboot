// tour-content.js — what the carrier portal tour says, screen by screen, per role.
// Plain English for a first-time owner-operator, driver or in-house dispatcher. No jargon.
// Selectors: the first VISIBLE match wins, so each step lists a data-tour hook first and a
// structural fallback after it. Add the data-tour attribute where the view builds that element.
// Copy is code-defined markup (rendered with innerHTML by tour.js) — never put user data in here.

const OWNER = [
  { id: 'welcome', hero: true, kind: 'welcome',
    title: 'Welcome to LoadBoot',
    text: '<p>This is your carrier portal: find loads, post your truck, keep your paperwork green and watch your money land. All in one place.</p><p>Let us show you around. It takes about two minutes and you can skip any time.</p>',
    meta: '2 minutes · 11 stops · skip any time' },

  { id: 'dash.kpis', screen: 'dashboard', route: '#dashboard', chapter: 'Your day', icon: 'grid',
    target: ['[data-tour="dash-kpis"]', '.cp-kpis'], anchor: '.cp-content',
    title: 'Your business at a glance',
    text: 'Loads on the road, money this week, what needs your attention. Open the portal and you know where you stand in five seconds.',
    tip: 'Tap any number to jump straight to the detail behind it.' },

  { id: 'dash.setup', optional: true, screen: 'dashboard', chapter: 'Your day', icon: 'shield', tone: 'orange',
    target: ['[data-tour="dash-setup"]'],
    title: 'Finish setup, get paid faster',
    text: 'Brokers only book carriers whose documents are in order. This card shows exactly what is missing, and each row takes you straight to the fix.',
    tip: 'Once every row is green, your <b>Compliant</b> badge switches on and you appear in broker searches.' },

  { id: 'loads.board', emptyTarget: ['[data-tour="loads-empty"]'], emptyTitle: 'No loads match yet', emptyText: 'Loads appear here as cards, each with the rate, the lane and the pay per mile up front. Widen your filters or post your truck and matching loads will come to you.', screen: 'loads', route: '#loads', chapter: 'Finding loads', icon: 'search',
    target: ['[data-tour="loads-list"]', '.cp-loadgrid'],
    title: 'Loads that fit your truck',
    text: 'Every card is a real load with the rate, the lane and the pay per mile right up front. No calling around to find out the number.',
    tip: 'A green <b>Detention</b> tag means the wait-time terms are already in writing before you accept.' },

  { id: 'loads.filters', optional: true, screen: 'loads', chapter: 'Finding loads', icon: 'filter',
    target: ['[data-tour="loads-filters"]'],
    title: 'Tell us your lane',
    text: 'Set where you are, where you want to go and what you pull. We remember it, so next time the board opens already sorted for you.',
    interact: true },

  { id: 'loads.post', screen: 'loads', chapter: 'Finding loads', icon: 'truck', tone: 'orange',
    target: ['.cp-tabbar .cp-fab', '[data-tour="loads-post"]', '.cpx-avail'],
    title: 'Or post your truck and let loads come to you',
    text: 'Tell brokers when and where your truck is free. Matching loads arrive as <b>booking requests</b>, and you accept or decline with one tap.',
    tip: 'The <b>Online / Offline</b> switch at the top pauses requests when you are busy.', interact: true },

  { id: 'trips.list', emptyTarget: ['[data-tour="trips-empty"]'], emptyTitle: 'Your booked loads live here', emptyText: 'Nothing booked yet. Once you take a load from the board it shows up here, and you mark <b>Arrived</b>, <b>Loaded</b> and <b>Delivered</b> as you go. Each tap is time-stamped with your location.', screen: 'trips', route: '#trips', chapter: 'On the road', icon: 'route',
    target: ['[data-tour="trips-list"]'],
    title: 'Every load, step by step',
    text: 'Once you book a load it lives here. Mark <b>Arrived</b>, <b>Loaded</b> and <b>Delivered</b> as you go. Each tap is time-stamped with your location, which is your proof if there is ever a dispute.',
    tip: 'Snap the signed delivery paper right here. Your invoice builds itself from it.' },

  { id: 'docs', emptyTitle: 'Upload your paperwork here', emptyText: 'Authority, insurance, W-9. Upload each one once. We check it, tell you if something is wrong, and remind you before anything expires.', screen: 'documents', route: '#documents', chapter: 'Paperwork', icon: 'doc',
    target: ['[data-tour="docs-list"]'],
    title: 'Keep your paperwork green',
    text: 'Authority, insurance, W-9. Upload each one once. We check it, tell you if something is wrong, and remind you before anything expires.',
    tip: 'Expired insurance is the number one reason a load gets pulled. We warn you 30 days ahead.', tipKind: 'warn' },

  { id: 'finance', emptyTitle: 'Your money will show here', emptyText: 'After your first delivered load: what you earned, what is on its way and when it lands. Detention and other extras pass through at 100%. LoadBoot takes 5% of the linehaul and nothing else.', screen: 'finance', route: '#finance', chapter: 'Your money', icon: 'dollar', tone: 'green',
    target: ['[data-tour="fin-summary"]'],
    title: 'Your money, in plain numbers',
    text: 'What you earned, what is on its way and when it lands. Detention and other extras pass through to you at 100%. LoadBoot takes 5% of the linehaul and nothing else.',
    tip: 'Expenses and fuel go in here too, so tax time is a download, not a shoebox.' },

  { id: 'dispatcher', emptyTitle: 'A real dispatcher, when you want one', emptyText: 'Too busy driving to chase loads? Ask for a LoadBoot dispatcher from the <b>Dispatcher</b> tab. They book, negotiate and handle brokers for you.', screen: 'dispatcher', route: '#dispatcher', chapter: 'Extra hands', icon: 'handshake',
    target: ['[data-tour="disp-hero"]', '.dd-hero'],
    title: 'A real dispatcher, when you want one',
    text: 'Too busy driving to chase loads? Ask for a LoadBoot dispatcher here. They book, negotiate and handle brokers for you. Pause or change them any time.' },

  { id: 'alerts', screen: 'notifications', chapter: 'Staying in the loop', icon: 'bell',
    target: ['.cp-top-right .cp-bell', '.cp-tabbar a[href="#notifications"]', 'a.cp-navlink[href="#notifications"]'],
    title: 'We tap you on the shoulder',
    text: 'New booking request, a document about to expire, money arriving: it shows up here. Turn on push notifications and you will not miss a load while you are at a dock.' },

  { id: 'help', screen: 'dashboard', chapter: 'Stuck?', icon: 'chat',
    target: ['.lbt-help'], padding: 6, radius: 999,
    title: 'This button is always here',
    text: 'Tap <b>?</b> on any screen for a short guide to that screen, quick tips, or to replay this tour. Support is one tap further.' },

  { id: 'done', hero: true, kind: 'done',
    title: 'You are ready to roll',
    text: 'That is the whole portal. Pick where to start:',
    actions: [
      { label: 'Find a load', icon: 'search', route: '#loads' },
      { label: 'Post my truck', icon: 'truck', route: '#loads' },
      { label: 'Upload documents', icon: 'doc', route: '#documents' },
      { label: 'See my money', icon: 'dollar', route: '#finance' },
    ] },
];

const DRIVER = [
  { id: 'welcome', hero: true, kind: 'welcome',
    title: 'Welcome aboard',
    text: '<p>This app is built for the cab: your loads for today, one-tap check-ins, and the paperwork done from your phone.</p><p>One minute, and you will know it all.</p>',
    meta: '1 minute · 6 stops · skip any time' },

  { id: 'today', screen: 'dashboard', route: '#dashboard', chapter: 'Today', icon: 'grid',
    target: ['[data-tour="today"]'], anchor: '.cp-content',
    title: 'Today, and nothing else',
    text: 'Your next pickup, the address, the appointment time and the dispatcher note. Open the app, read one screen, drive.' },

  { id: 'trips', emptyTarget: ['[data-tour="trips-empty"]'], emptyTitle: 'Your loads will show here', emptyText: 'Nothing assigned to you yet. When dispatch gives you a load it appears here with the address, the appointment time and who to call.', screen: 'trips', route: '#trips', chapter: 'On the road', icon: 'route',
    target: ['[data-tour="trips-list"]'],
    title: 'Your loads',
    text: 'Every load you are assigned, in order. Tap one to see the full details, directions and who to call.' },

  { id: 'trips.actions', optional: true, screen: 'trips', chapter: 'On the road', icon: 'check', tone: 'green',
    target: ['[data-tour="trip-actions"]', '.cp-trip-actions'],
    title: 'Three taps per load',
    text: '<b>Arrived</b> when you reach the gate. <b>Loaded</b> when the doors close. <b>Delivered</b> at the end. Each tap records the time and place, which is what gets detention paid.',
    tip: 'Waiting at a dock? The arrival tap starts the clock. You do not need to write anything down.', interact: true },

  { id: 'pod', optional: true, screen: 'trips', chapter: 'On the road', icon: 'upload',
    target: ['[data-tour="trip-pod"]', '.cp-podzone'],
    title: 'Photo of the signed paper, done',
    text: 'Take a picture of the signed delivery receipt here. The office gets it instantly and the invoice goes out the same day.' },

  { id: 'safety', screen: 'safety', chapter: 'Safety', icon: 'alert', tone: 'orange',
    target: ['.cp-tabbar a[href="#safety"]', 'a.cp-navlink[href="#safety"]'],
    title: 'Help, one tap away',
    text: 'Breakdown, accident, or you just feel unsafe: the <b>Safety</b> tab reaches the office and emergency numbers without hunting through contacts.' },

  { id: 'help', screen: 'dashboard', chapter: 'Stuck?', icon: 'chat',
    target: ['.lbt-help'], padding: 6, radius: 999,
    title: 'Lost? Tap the question mark',
    text: 'On any screen, <b>?</b> shows a short guide to that screen or replays this tour.' },

  { id: 'done', hero: true, kind: 'done',
    title: 'That is it. Safe travels.',
    text: 'Start with today’s load, or check your alerts.',
    actions: [
      { label: 'Today’s load', icon: 'grid', route: '#dashboard' },
      { label: 'My loads', icon: 'route', route: '#trips' },
    ] },
];

const DISPATCHER = [
  { id: 'welcome', hero: true, kind: 'welcome',
    title: 'Welcome to the dispatch seat',
    text: '<p>You book the loads, the trucks stay moving. This portal gives you the board, the trucks and the drivers on one screen.</p><p>Two minutes and you are set.</p>',
    meta: '2 minutes · 8 stops · skip any time' },

  { id: 'today', screen: 'dashboard', route: '#dashboard', chapter: 'Your day', icon: 'grid',
    target: ['[data-tour="dash-kpis"]', '[data-tour="today"]', '.cp-kpis'], anchor: '.cp-content',
    title: 'The fleet at a glance',
    text: 'Which trucks are loaded, which are empty, what delivers today. This is the screen you keep open.' },

  { id: 'loads.board', emptyTarget: ['[data-tour="loads-empty"]'], emptyTitle: 'No loads match yet', emptyText: 'Loads appear here as cards, each with the rate, the lane and the pay per mile up front. Widen your filters or post your truck and matching loads will come to you.', screen: 'loads', route: '#loads', chapter: 'Booking', icon: 'search',
    target: ['[data-tour="loads-list"]', '.cp-loadgrid'],
    title: 'The load board',
    text: 'Rate, lane, miles and pay per mile on every card. Detention terms are written on the load before you book it, so there is nothing to negotiate later.' },

  { id: 'loads.filters', optional: true, screen: 'loads', chapter: 'Booking', icon: 'filter',
    target: ['[data-tour="loads-filters"]'],
    title: 'Filter by truck, not by luck',
    text: 'Set the equipment, the origin and the minimum rate. The board remembers it per device, so the morning check takes ten seconds.', interact: true },

  { id: 'loads.post', screen: 'loads', chapter: 'Booking', icon: 'truck', tone: 'orange',
    target: ['.cp-tabbar .cp-fab', '[data-tour="loads-post"]', '.cpx-avail'],
    title: 'Post an empty truck',
    text: 'Empty in Dallas on Thursday? Post it. Brokers send booking requests straight to you, and you accept with one tap. Beats refreshing a board.', interact: true },

  { id: 'trips', emptyTarget: ['[data-tour="trips-empty"]'], emptyTitle: 'Your booked loads live here', emptyText: 'Nothing booked yet. Once you take a load from the board it shows up here, and you mark <b>Arrived</b>, <b>Loaded</b> and <b>Delivered</b> as you go. Each tap is time-stamped with your location.', screen: 'trips', route: '#trips', chapter: 'On the road', icon: 'route',
    target: ['[data-tour="trips-list"]'],
    title: 'Assign, then watch it move',
    text: 'Booked loads land here. Assign a driver and a truck. The driver’s taps (arrived, loaded, delivered) show up live, with time and location.' },

  { id: 'fleet', emptyTitle: 'Add your trucks and drivers', emptyText: 'Add a truck, invite a driver by phone number, decide what each driver can see. Drivers get their own simple app; you keep the controls.', screen: 'fleet', route: '#fleet', chapter: 'Trucks and drivers', icon: 'truck',
    target: ['[data-tour="fleet-list"]'],
    title: 'Trucks and drivers',
    text: 'Add a truck, invite a driver by phone number, decide what each driver can see. Drivers get their own simple app; you keep the controls.' },

  { id: 'alerts', screen: 'notifications', chapter: 'Staying in the loop', icon: 'bell',
    target: ['.cp-top-right .cp-bell', '.cp-tabbar a[href="#notifications"]', 'a.cp-navlink[href="#notifications"]'],
    title: 'Booking requests land here',
    text: 'A broker wants your truck, a driver has delivered, a document is expiring: it all shows up here. Turn on push so you catch requests before someone else does.' },

  { id: 'help', screen: 'dashboard', chapter: 'Stuck?', icon: 'chat',
    target: ['.lbt-help'], padding: 6, radius: 999,
    title: 'Guides on every screen',
    text: 'Tap <b>?</b> anywhere for a short guide to that screen, quick tips, or to replay this tour.' },

  { id: 'done', hero: true, kind: 'done',
    title: 'Go book something',
    text: 'The board is live. Where to first?',
    actions: [
      { label: 'Open the board', icon: 'search', route: '#loads' },
      { label: 'Post a truck', icon: 'truck', route: '#loads' },
      { label: 'Add a driver', icon: 'users', route: '#fleet' },
      { label: 'My loads', icon: 'route', route: '#trips' },
    ] },
];

// One entry per screen: the title the help panel shows and three quick tips in plain words.
const SCREENS = {
  dashboard: { title: 'Dashboard', tips: ['Tap any number to open the detail behind it.', 'Red rows in “Complete your setup” block bookings; fix those first.', 'Pull down to refresh.'] },
  loads: { title: 'Load Board', tips: ['Rate per mile is shown on every card, so you can compare in a glance.', 'Save your lane once; the board opens pre-filtered next time.', 'Posting your truck brings booking requests to you.'] },
  trips: { title: 'My Loads', tips: ['Tap Arrived the moment you reach the gate; it starts the detention clock.', 'Photograph the signed delivery paper here; the invoice builds itself.', 'Each status tap is time and location stamped.'] },
  documents: { title: 'Documents', tips: ['Upload each document once; we remind you before it expires.', 'A rejected document shows the reason and what to re-upload.', 'Green everywhere means brokers can book you.'] },
  finance: { title: 'Finance', tips: ['Extras like detention pass through at 100%.', 'Add fuel and expenses as you go; tax time becomes a download.', 'Settlement dates are shown per load.'] },
  fleet: { title: 'Fleet', tips: ['Invite a driver with a phone number; they get their own simple app.', 'You decide what each driver can see.', 'Keep truck details current so posted availability is accurate.'] },
  dispatcher: { title: 'Dispatcher', tips: ['Request a dispatcher when you would rather drive than negotiate.', 'Pause or change them any time from this screen.', 'The number shown is a LoadBoot line, never a personal one.'] },
  notifications: { title: 'Alerts', tips: ['Turn on push so booking requests reach you at the dock.', 'Unread alerts are marked; tap to clear.', 'Alerts also arrive by email.'] },
  health: { title: 'Ratings', tips: ['Brokers see this score before they book you.', 'On-time taps and clean paperwork raise it.', 'Rate brokers back after each load.'] },
  rates: { title: 'Market Rates', tips: ['Check the lane rate before you accept a load.', 'Rates update daily.', 'Use it to negotiate, not to guess.'] },
  safety: { title: 'Safety', tips: ['Emergency numbers are one tap away.', 'Report an incident with photos from your phone.', 'The office is notified instantly.'] },
  account: { title: 'Account', tips: ['Choose which four tabs sit in your bottom bar.', 'Dark mode is under Appearance.', 'Bank details for payouts live here.'] },
};

export const CARRIER_TOUR = { flows: { owner: OWNER, driver: DRIVER, dispatcher: DISPATCHER }, screens: SCREENS };
export default CARRIER_TOUR;
