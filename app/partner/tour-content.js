// tour-content.js — what the partner portal tour says, screen by screen, for a broker or a shipper.
// Plain English for someone posting their first load. No jargon. Same engine as the carrier portal
// (../shared/ui/tour.js); only the copy and the hooks live here.
// Selectors: the first VISIBLE match wins, so each step lists a data-tour hook first and a
// structural fallback after it. Add the data-tour attribute where the view builds that element.
// Copy is code-defined markup (rendered with innerHTML by tour.js) — never put user data in here.

const BELL = ['.cp-top-right .cp-iconbtn[title="Notifications"]', '.cp-top-right .cp-iconbtn'];

const BROKER = [
  { id: 'welcome', hero: true, kind: 'welcome',
    title: 'Welcome to LoadBoot',
    text: '<p>This is your broker portal: post loads, get them covered by verified carriers, track every trip and settle the paperwork in one place.</p><p>Two minutes, and you will know where everything is. Skip any time.</p>',
    meta: '2 minutes · 10 stops · skip any time' },

  { id: 'dash.kpis', screen: 'dashboard', route: '#dashboard', chapter: 'Your day', icon: 'grid',
    target: ['[data-tour="dash-kpis"]', '.bd-kgrid'], anchor: '.cp-content',
    title: 'Your loads at a glance',
    text: 'Open, covered, moving, delivered. One row of numbers tells you where every load stands before you read a single email.',
    tip: 'Tap a number to jump to those loads.' },

  { id: 'post', screen: 'dashboard', chapter: 'Posting', icon: 'upload', tone: 'orange',
    target: ['[data-tour="post-load"]', '#bd-postload'],
    emptyTitle: 'Posting unlocks after a quick check',
    emptyText: 'Once your broker authority is confirmed, a <b>Post a load</b> form sits right here on the dashboard. Pickup, delivery, equipment, rate: a few fields and the load is live to matching carriers.',
    title: 'Post a load in a minute',
    text: 'Pickup, delivery, equipment, rate. Add the detention terms up front and every carrier sees them before they book, so there is nothing to argue about later.',
    tip: 'Save a lane you post often and the form fills itself next time.' },

  { id: 'loads', screen: 'loads', route: '#loads', chapter: 'Your loads', icon: 'list',
    target: ['[data-tour="loads-list"]'],
    emptyTitle: 'Every load you post lands here',
    emptyText: 'Status, carrier, driver taps and documents for each one. Post your first load and it appears here within seconds.',
    title: 'Every load, start to finish',
    text: 'Each load shows its status, the carrier on it, and the driver’s <b>Arrived</b>, <b>Loaded</b> and <b>Delivered</b> taps, each stamped with time and location.',
    tip: 'Search by city or reference; filter by status when the list gets long.' },

  { id: 'requests', screen: 'requests', route: '#requests', chapter: 'Getting covered', icon: 'clock',
    target: ['[data-tour="requests"]'], anchor: '.cp-content',
    title: 'Carriers asking for your load',
    text: 'When a carrier wants one of your loads, the request lands here with their rating and compliance status. Accept and the load is covered; decline and it stays on the board.',
    tip: 'Turn on alerts so a request does not sit for an hour while a truck waits.' },

  { id: 'carriers', screen: 'carriers', route: '#carriers', chapter: 'Getting covered', icon: 'truck',
    target: ['[data-tour="carriers"]'], anchor: '.cp-content',
    title: 'Find and check a carrier',
    text: 'Search carriers by lane and equipment. Every profile shows their live FMCSA authority, insurance status and their LoadBoot rating before you hand them a load.',
    tip: 'A green <b>Compliant</b> badge means authority, insurance and W-9 are all in order today.' },

  { id: 'packet', screen: 'onboarding', route: '#onboarding', chapter: 'Paperwork', icon: 'doc',
    target: ['[data-tour="packet"]'], anchor: '.cp-content',
    title: 'Your broker packet',
    text: 'Authority, bond, W-9 and the agreement, step by step. Carriers see a verified packet and book with confidence. Upload each one once and we remind you before anything expires.',
    tip: 'We warn you 30 days before a document expires.', tipKind: 'warn' },

  { id: 'invoices', screen: 'invoices', route: '#invoices', chapter: 'Money', icon: 'receipt', tone: 'green',
    target: ['[data-tour="invoices"]'], anchor: '.cp-content',
    title: 'Invoices and what you owe',
    text: 'Carrier invoices per trip, what is due and by when, and your own LoadBoot invoices. Mark a payment sent and both sides see it.',
    tip: 'Delivered loads and approved claims show up here automatically.' },

  { id: 'rates', screen: 'rates', route: '#rates', chapter: 'Money', icon: 'trend',
    target: ['[data-tour="rates"]'], anchor: '.cp-content',
    title: 'Know the lane rate before you post',
    text: 'Live market rates by lane and equipment. Price a load right the first time and it gets covered faster.' },

  { id: 'alerts', screen: 'dashboard', chapter: 'Staying in the loop', icon: 'bell',
    target: BELL,
    title: 'We tap you on the shoulder',
    text: 'A carrier requests your load, a driver delivers, a document is about to expire: it shows up here, and by email. Turn on push and you catch requests while they are still warm.' },

  { id: 'help', screen: 'dashboard', chapter: 'Stuck?', icon: 'chat',
    target: ['.lbt-help'], padding: 6, radius: 999,
    title: 'This button is always here',
    text: 'Tap <b>?</b> on any screen for a short guide to that screen, quick tips, or to replay this tour. Support is one tap further.' },

  { id: 'done', hero: true, kind: 'done',
    title: 'You are ready to post',
    text: 'That is the whole portal. Pick where to start:',
    actions: [
      { label: 'Post a load', icon: 'upload', route: '#dashboard' },
      { label: 'My loads', icon: 'list', route: '#loads' },
      { label: 'Find a carrier', icon: 'truck', route: '#carriers' },
      { label: 'My documents', icon: 'doc', route: '#onboarding' },
    ] },
];

const SHIPPER = [
  { id: 'welcome', hero: true, kind: 'welcome',
    title: 'Welcome to LoadBoot',
    text: '<p>This is your shipper portal: post a shipment, get quotes from verified carriers, watch it move and keep the paperwork tidy. All in one place.</p><p>Two minutes, and you will know where everything is. Skip any time.</p>',
    meta: '2 minutes · 9 stops · skip any time' },

  { id: 'dash.kpis', screen: 'dashboard', route: '#dashboard', chapter: 'Your day', icon: 'grid',
    target: ['[data-tour="dash-kpis"]', '.bd-kgrid'], anchor: '.cp-content',
    title: 'Your shipments at a glance',
    text: 'Open, covered, moving, delivered. One row of numbers tells you where every shipment stands.',
    tip: 'Tap a number to jump to those shipments.' },

  { id: 'post', screen: 'dashboard', chapter: 'Posting', icon: 'upload', tone: 'orange',
    target: ['[data-tour="post-load"]', '#bd-postload'],
    emptyTitle: 'Post a shipment from here',
    emptyText: 'Once your account is set up, a <b>Post a load</b> form sits right here on the dashboard. Pickup, delivery, what you are shipping and when: a few fields and quotes start coming in.',
    title: 'Post a shipment in a minute',
    text: 'Pickup, delivery, what you are shipping and when. Quotes are open to you right away; the first booking waits only for your documents.',
    tip: 'Save a lane you ship often and the form fills itself next time.' },

  { id: 'loads', screen: 'loads', route: '#loads', chapter: 'Your shipments', icon: 'list',
    target: ['[data-tour="loads-list"]'],
    emptyTitle: 'Every shipment you post lands here',
    emptyText: 'Status, carrier, driver taps and documents for each one. Post your first shipment and it appears here within seconds.',
    title: 'Every shipment, start to finish',
    text: 'Each one shows its status, the carrier on it, and the driver’s <b>Arrived</b>, <b>Loaded</b> and <b>Delivered</b> taps, each stamped with time and location.' },

  { id: 'requests', screen: 'requests', route: '#requests', chapter: 'Getting covered', icon: 'clock',
    target: ['[data-tour="requests"]'], anchor: '.cp-content',
    title: 'Carriers asking for your shipment',
    text: 'When a carrier wants one of your shipments, the request lands here with their rating and compliance status. Accept and it is covered.',
    tip: 'Turn on alerts so a request does not sit while a truck waits.' },

  { id: 'carriers', screen: 'carriers', route: '#carriers', chapter: 'Getting covered', icon: 'truck',
    target: ['[data-tour="carriers"]'], anchor: '.cp-content',
    title: 'Check who is hauling for you',
    text: 'Every carrier profile shows live FMCSA authority, insurance status and their LoadBoot rating. You always know who is on your freight.' },

  { id: 'packet', screen: 'onboarding', route: '#onboarding', chapter: 'Paperwork', icon: 'doc',
    target: ['[data-tour="packet"]'], anchor: '.cp-content',
    title: 'Your documents',
    text: 'Company details, W-9 and the agreement, step by step. Quotes are open now; the first booking waits only for this.',
    tip: 'Upload each document once. We remind you before anything expires.' },

  { id: 'invoices', screen: 'invoices', route: '#invoices', chapter: 'Money', icon: 'receipt', tone: 'green',
    target: ['[data-tour="invoices"]'], anchor: '.cp-content',
    title: 'Invoices in one place',
    text: 'What is due, by when, and your LoadBoot invoices. Mark a payment sent and both sides see it.' },

  { id: 'alerts', screen: 'dashboard', chapter: 'Staying in the loop', icon: 'bell',
    target: BELL,
    title: 'We tap you on the shoulder',
    text: 'A carrier requests your shipment, a driver delivers, a document is about to expire: it shows up here, and by email. Turn on push so nothing waits on you.' },

  { id: 'help', screen: 'dashboard', chapter: 'Stuck?', icon: 'chat',
    target: ['.lbt-help'], padding: 6, radius: 999,
    title: 'This button is always here',
    text: 'Tap <b>?</b> on any screen for a short guide to that screen, quick tips, or to replay this tour.' },

  { id: 'done', hero: true, kind: 'done',
    title: 'You are ready to ship',
    text: 'That is the whole portal. Pick where to start:',
    actions: [
      { label: 'Post a shipment', icon: 'upload', route: '#dashboard' },
      { label: 'My shipments', icon: 'list', route: '#loads' },
      { label: 'My documents', icon: 'doc', route: '#onboarding' },
    ] },
];

// One entry per screen: the title the help panel shows and three quick tips in plain words.
const SCREENS = {
  dashboard: { title: 'Dashboard', tips: ['Tap any number to open the loads behind it.', 'The Post a load form lives here once you are cleared to post.', 'Pull down to refresh.'] },
  loads: { title: 'My Loads', tips: ['Search by city or reference; filter by status.', 'Driver taps are time and location stamped.', 'Open a load to see its documents and messages.'] },
  claims: { title: 'Claims', tips: ['Open a claim from the delivered load it belongs to.', 'Attach photos and the signed delivery paper.', 'Approved claims show up under Invoices automatically.'] },
  requests: { title: 'Requests', tips: ['Each request shows the carrier’s rating and compliance.', 'Accept covers the load; decline leaves it on the board.', 'Turn on alerts so requests do not wait.'] },
  carriers: { title: 'Carriers', tips: ['Search by lane and equipment.', 'Authority and insurance are checked live against FMCSA.', 'A green Compliant badge means everything is in order today.'] },
  rates: { title: 'Market Rates', tips: ['Check the lane before you set a rate.', 'Rates update daily.', 'Priced right, loads get covered faster.'] },
  network: { title: 'Network', tips: ['Approved partners book without re-checking.', 'Rate carriers after each delivered load.', 'Your referral link is here too.'] },
  agents: { title: 'Agents & team', tips: ['Invite a teammate by email.', 'Decide what each person can post and see.', 'Remove access any time.'] },
  onboarding: { title: 'Documents', tips: ['Upload each document once.', 'We remind you 30 days before anything expires.', 'A verified packet gets your loads covered faster.'] },
  invoices: { title: 'Invoices', tips: ['Carrier invoices are listed per trip.', 'Mark a payment sent and both sides see it.', 'Approved claims appear here automatically.'] },
  developers: { title: 'API & Keys', tips: ['Create a key to connect your TMS.', 'Register a webhook to receive events.', 'Revoke a key any time.'] },
  account: { title: 'Account', tips: ['Billing email and contact details live here.', 'Turn notifications on or off per type.', 'Support and legal are at the bottom.'] },
};

export const PARTNER_TOUR = { flows: { broker: BROKER, shipper: SHIPPER }, screens: SCREENS };
export default PARTNER_TOUR;
