// tour-content.js — what the agent portal tour says, screen by screen, per track.
// Tracks: 'dispatcher' (applying for / working the dispatcher seat), 'referral' (the 1% Referral
// Partner program), 'both' (one account on both tracks). Plain English, no jargon. Same engine as the
// carrier portal (../shared/ui/tour.js); only the copy and the hooks live here.
// Selectors: the first VISIBLE match wins, so each step lists a data-tour hook first and a structural
// fallback after it. Most dispatcher stops are optional: the dashboard shows the application form,
// the status card or the live workspace depending on where the person is, and the tour follows.
// Copy is code-defined markup (rendered with innerHTML by tour.js) — never put user data in here.

const BELL = ['.cp-top-right .cp-bell', '.cp-top-right .cp-iconbtn'];

const HELP = { id: 'help', screen: 'dashboard', chapter: 'Stuck?', icon: 'chat',
  target: ['.lbt-help'], padding: 6, radius: 999,
  title: 'This button is always here',
  text: 'Tap <b>?</b> on any screen for a short guide to that screen, quick tips, or to replay this tour. Support is one tap further.' };

const ALERTS = { id: 'alerts', screen: 'dashboard', chapter: 'Staying in the loop', icon: 'bell',
  target: BELL,
  title: 'We tap you on the shoulder',
  text: 'A status change, a message from the team, a commission or a payout update: it shows up here, and by email.' };

// ---- Dispatcher track: from application to the live workspace ----
const DISP_BODY = [
  { id: 'disp.apply', optional: true, screen: 'dashboard', route: '#dashboard', chapter: 'Your application', icon: 'clipboard', tone: 'orange',
    target: ['[data-tour="disp-apply"]'],
    title: 'Start here: your application',
    text: 'Tell us how you find loads today, which boards you have your own access to, and the loads you have booked yourself. Honest answers move fastest; the team reads every one.',
    tip: 'You can save and come back. Nothing is sent until you press <b>Submit</b>.' },

  { id: 'disp.status', optional: true, screen: 'dashboard', route: '#dashboard', chapter: 'Where you stand', icon: 'shield',
    target: ['[data-tour="disp-status"]'],
    title: 'Your status, always current',
    text: 'Screening, skills test, working trial, verified, active. This card says exactly where you are and what happens next. When the team leaves a note, it appears here first.' },

  { id: 'disp.steps', optional: true, screen: 'dashboard', chapter: 'Where you stand', icon: 'route',
    target: ['[data-tour="disp-steps"]'],
    title: 'The path, step by step',
    text: 'Each stage lights up as you pass it. Most people go from screening to a working trial in days, not weeks.' },

  { id: 'dw.tabs', optional: true, screen: 'dashboard', chapter: 'Your workspace', icon: 'grid', tone: 'orange',
    target: ['[data-tour="dw-tabs"]', '.dw-tabs'],
    title: 'Your dispatch workspace',
    text: '<b>Today</b> for the work queue, <b>Board</b> for loads that fit your carrier, <b>Trucks</b>, <b>Bookings</b>, <b>Messages</b> and your carrier <b>Packet</b>. Everything you need to keep a truck moving, on one screen.',
    tip: 'On a phone the bottom bar becomes these tabs.' },

  { id: 'dw.kpis', optional: true, screen: 'dashboard', chapter: 'Your workspace', icon: 'trend',
    target: ['[data-tour="dw-kpis"]', '.dw-kpis'],
    title: 'Your numbers at a glance',
    text: 'Loads moving, rate confirmations you are waiting on, gross for the week, average rate per mile and your commission so far. Open the portal and you know your day in five seconds.' },

  { id: 'dw.queue', optional: true, screen: 'dashboard', chapter: 'Your workspace', icon: 'check', tone: 'green',
    target: ['[data-tour="dw-queue"]', '.dw-q'],
    title: 'The work queue tells you what is next',
    text: 'Empty truck tomorrow, a rate con still missing, a check call due. Hot items float to the top. Tap one and you land where the work is.',
    tip: 'Clear the queue and the trucks are covered, the paperwork is in and nothing is late.' },

  { id: 'disp.rules', optional: true, screen: 'dashboard', chapter: 'The rules', icon: 'alert', tone: 'orange',
    target: ['[data-tour="disp-rules"]'],
    title: 'Six rules that keep you legal',
    text: 'Book under the carrier’s own authority, stay inside your assigned scope, go through brokers, never touch freight money, never re-broker, never book before you have a truck. Read them once; they protect you and the carrier.' },

  { id: 'disp.academy', optional: true, screen: 'dashboard', chapter: 'Learn the craft', icon: 'book',
    target: ['[data-tour="disp-academy"]'],
    title: 'Dispatcher Academy',
    text: 'Short lessons on rates, brokers, rate confirmations and check calls. Built from what our best dispatchers do every day. Free, and worth an hour before your first trial load.' },
];

// ---- Referral Partner track: the link, the money, the people ----
const REF_BODY = [
  { id: 'ref.link', screen: 'dashboard', route: '#dashboard', chapter: 'Your link', icon: 'link', tone: 'orange',
    target: ['[data-tour="ref-link"]', '.rh-hero'], anchor: '.cp-content',
    title: 'Your link is your business',
    text: 'Anyone who signs up through it, a carrier, a broker or a shipper, is tied to you the moment they join. No pairing, no forms. Share it by WhatsApp, text or copy it anywhere.',
    tip: 'The ready-made message next to the link is a good first text to send.' },

  { id: 'ref.kpis', screen: 'dashboard', chapter: 'Your money', icon: 'dollar', tone: 'green',
    target: ['[data-tour="ref-kpis"]', '.rh-kpis'], anchor: '.cp-content',
    title: 'Where your money is, right now',
    text: 'You earn 1% of the gross load value on every delivered load your people are on. It clears for 15 days, then it is payable. These tiles show referred, moving, delivered, earned and what is available today.',
    tip: 'Payouts run monthly once your payable balance reaches $100.' },

  { id: 'ref.list', optional: true, screen: 'dashboard', chapter: 'Your people', icon: 'users',
    target: ['[data-tour="ref-list"]', '.rh-ref'],
    title: 'Your referrals, live',
    text: 'Each company you brought in, whether they are verified, and whether they are moving freight. A quiet one is a phone call worth making.' },

  { id: 'chain', screen: 'chain', route: '#chain', chapter: 'Your people', icon: 'users',
    target: ['.cp-content .cp-card'],
    emptyTitle: 'Your full referral list lives here',
    emptyText: 'Every company you referred, searchable and sortable, with how active each one is. It fills in as your first referrals sign up.',
    title: 'The full list',
    text: 'Search, sort by newest or most active, and see at a glance who is new, who is moving and who has gone quiet.' },

  { id: 'earnings', screen: 'earnings', route: '#earnings', chapter: 'Your money', icon: 'dollar', tone: 'green',
    target: ['[data-tour="earnings"]'], anchor: '.cp-content',
    title: 'Every dollar, line by line',
    text: 'Each delivered load that paid you, the amount, and whether it is still clearing, payable or already paid. Nothing is hidden and nothing is rounded.' },

  { id: 'payouts', screen: 'payouts', route: '#payouts', chapter: 'Your money', icon: 'wallet',
    target: ['[data-tour="payouts"]'], anchor: '.cp-content',
    title: 'Getting paid',
    text: 'Your payout account on file, and every payout from requested to paid. Add or change bank details from the Verification Center; changes go through a quick review so your money stays safe.' },

  { id: 'verify', screen: 'verify', route: '#verify', chapter: 'Get verified', icon: 'shield', tone: 'orange',
    target: ['.cp-content .cp-card'], anchor: '.cp-content',
    title: 'Three steps, five minutes',
    text: 'Identity, payout account, tax form. Do it once and every payout after that is automatic. Nothing is paid out until this is done.',
    tip: 'Talk to the review team any time from the thread on this screen.' },
];

const DISPATCHER = [
  { id: 'welcome', hero: true, kind: 'welcome',
    title: 'Welcome to the dispatcher portal',
    text: '<p>This is where you apply, track your status and, once you are on a carrier, run the whole day: loads, trucks, bookings and messages.</p><p>Two minutes and you will know your way around. Skip any time.</p>',
    meta: '2 minutes · skip any time' },
  ...DISP_BODY,
  ALERTS, HELP,
  { id: 'done', hero: true, kind: 'done',
    title: 'You are set',
    text: 'Pick where to start:',
    actions: [
      { label: 'My dashboard', icon: 'grid', route: '#dashboard' },
      { label: 'Settings', icon: 'cog', route: '#settings' },
    ] },
];

const REFERRAL = [
  { id: 'welcome', hero: true, kind: 'welcome',
    title: 'Welcome, partner',
    text: '<p>You bring the people; the software does the rest. Your link, your referrals and your 1% on every delivered load, all here.</p><p>Two minutes and you will know your way around. Skip any time.</p>',
    meta: '2 minutes · 9 stops · skip any time' },
  ...REF_BODY,
  ALERTS, HELP,
  { id: 'done', hero: true, kind: 'done',
    title: 'Go share your link',
    text: 'Pick where to start:',
    actions: [
      { label: 'Copy my link', icon: 'link', route: '#dashboard' },
      { label: 'My referrals', icon: 'users', route: '#chain' },
      { label: 'Get verified', icon: 'shield', route: '#verify' },
    ] },
];

// One account, both tracks: the dispatcher home first, then the referral program tab.
const BOTH = [
  { id: 'welcome', hero: true, kind: 'welcome',
    title: 'Welcome: dispatcher and partner',
    text: '<p>One login, two ways to earn. The dashboard is your dispatcher home; the <b>Referral</b> tab is your 1% program with its own money and people.</p><p>Three minutes and you will know both. Skip any time.</p>',
    meta: '3 minutes · skip any time' },
  ...DISP_BODY,
  ...REF_BODY.map((s) => (s.id === 'ref.link' || s.id === 'ref.kpis' || s.id === 'ref.list') ? Object.assign({}, s, { screen: 'referral', route: '#referral' }) : s),
  ALERTS, HELP,
  { id: 'done', hero: true, kind: 'done',
    title: 'You are set',
    text: 'Pick where to start:',
    actions: [
      { label: 'My dashboard', icon: 'grid', route: '#dashboard' },
      { label: 'My referral link', icon: 'link', route: '#referral' },
      { label: 'Get verified', icon: 'shield', route: '#verify' },
    ] },
];

// One entry per screen: the title the help panel shows and three quick tips in plain words.
const SCREENS = {
  dashboard: { title: 'Dashboard', tips: ['Your status card says exactly what happens next.', 'Once you are on a carrier, the workspace tabs live here.', 'Pull down to refresh.'] },
  referral: { title: 'Referral (1%)', tips: ['Share the link by WhatsApp or text; the ready-made message works.', 'Every delivered load your people are on pays you 1% of gross.', 'Commissions clear for 15 days, then they are payable.'] },
  chain: { title: 'My Referrals', tips: ['Sort by most active to see who is moving freight.', 'A quiet referral is worth a phone call.', 'Tap a company to see its activity.'] },
  earnings: { title: 'Earnings', tips: ['Clearing, payable and paid are shown separately.', 'Each line is one delivered load.', 'Nothing is rounded.'] },
  payouts: { title: 'Payouts', tips: ['Payouts run monthly once your payable balance reaches $100.', 'Bank changes go through a quick review.', 'Every payout is tracked from requested to paid.'] },
  verify: { title: 'Verification', tips: ['Identity, payout account, tax form: three steps.', 'Nothing is paid out until verification is complete.', 'Message the review team from the thread here.'] },
  settings: { title: 'Settings', tips: ['Your signed agreement and tax form are downloadable here.', 'Reset your password from Security.', 'We never ask for your password by email or phone.'] },
};

export const AGENT_TOUR = { flows: { dispatcher: DISPATCHER, referral: REFERRAL, both: BOTH }, screens: SCREENS };
export default AGENT_TOUR;
