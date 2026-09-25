// tour-content.js — what the investor portal tour says, tab by tab. Five stops, plain English.
// The portal's one job is a provable record: what came in, where it went, why, with proof. The tour
// says exactly that and no more. Same engine as the carrier portal (../shared/ui/tour.js).
// Tabs are the portal's own (home / ledger / payments / agreement); `route` is '#tab', the shell strips it.
// Copy is code-defined markup (rendered with innerHTML by tour.js) — never put user data or figures in here.

const INVESTOR = [
  { id: 'welcome', hero: true, kind: 'welcome',
    title: 'Your record, in one place',
    text: '<p>What you put in, what it was spent on, what came back to you. Every line has a date, an amount and a receipt.</p><p>One minute, and you will know where everything is. Skip any time.</p>',
    meta: '1 minute · 6 stops · skip any time' },

  { id: 'record', screen: 'home', route: '#home', chapter: 'The record', icon: 'shield', tone: 'green',
    target: ['[data-tour="rec-hero"]', '.iv-rec-hero'], anchor: '.iv-shell',
    title: 'Your position today',
    text: 'What you committed, what you have given so far, what is still with LoadBoot unspent and what has been spent. Tap any figure with a <b>?</b> for what it means in your case.' },

  { id: 'record.list', screen: 'home', chapter: 'The record', icon: 'list',
    target: ['[data-tour="rec-list"]', '.iv-list'],
    emptyTitle: 'Every movement will be listed here',
    emptyText: 'Money in, money spent, money returned: each one a line with its date, amount and proof, newest first. It fills in from your first transfer.',
    title: 'Every movement, newest first',
    text: 'Money in, money spent, money returned. Tap a line for the receipt, the reference and who confirmed it.',
    tip: 'The export button at the bottom gives you the same list as a file.' },

  { id: 'ledger', screen: 'ledger', route: '#ledger', chapter: 'Where it went', icon: 'receipt',
    target: ['[data-tour="ledger-hero"]', '.iv-card.hero'], anchor: '.iv-shell',
    title: 'Where the money went',
    text: 'What is still unspent, and every expense paid from your money by category and by vendor. Each expense has a receipt; tap it to see it.',
    tip: 'If something looks wrong, flag the line from this screen and the team answers here.' },

  { id: 'payments', screen: 'payments', route: '#payments', chapter: 'Money in, money back', icon: 'dollar', tone: 'green',
    target: ['[data-tour="pay-list"]', '[data-tour="pay-declare"]', '.iv-list'],
    emptyTitle: 'Your transfers will be confirmed here',
    emptyText: 'When you send money, declare it here with the date, method and reference. LoadBoot confirms it and the line turns green. Money returned to you is listed below it.',
    title: 'Transfers, confirmed both ways',
    text: 'When you send money, declare it here with the date, method and reference. LoadBoot confirms it and the line turns green. Money returned to you is listed underneath.' },

  { id: 'agreement', screen: 'agreement', route: '#agreement', chapter: 'The paper', icon: 'doc',
    target: ['[data-tour="agr-card"]', '.iv-card'], anchor: '.iv-shell',
    title: 'Your agreement, and your security',
    text: 'The signed document, your monthly share and how recovery works, what you can change, and the security settings for this account. The audit log at the bottom shows every action taken on it.' },

  { id: 'help', screen: 'home', chapter: 'Stuck?', icon: 'chat',
    target: ['.lbt-help'], padding: 6, radius: 999,
    title: 'This button is always here',
    text: 'Tap <b>?</b> on any screen for a short guide to that screen, quick tips, or to replay this tour.' },

  { id: 'done', hero: true, kind: 'done',
    title: 'That is the whole portal',
    text: 'Pick where to start:',
    actions: [
      { label: 'My record', icon: 'shield', route: '#home' },
      { label: 'Where it went', icon: 'receipt', route: '#ledger' },
      { label: 'Agreement', icon: 'doc', route: '#agreement' },
    ] },
];

// One entry per tab: the title the help panel shows and three quick tips in plain words.
const SCREENS = {
  home: { title: 'Record', tips: ['Tap any figure with a ? for what it means in your case.', 'Tap a line for its receipt and reference.', 'Export the list as a file from the bottom.'] },
  ledger: { title: 'Where it went', tips: ['Every expense has a receipt; tap to see it.', 'Flag a line you do not recognise and the team answers here.', 'Spend is grouped by category and vendor.'] },
  payments: { title: 'Payments', tips: ['Declare a transfer with its date, method and reference.', 'A confirmed line turns green.', 'Money returned to you is listed underneath.'] },
  agreement: { title: 'Agreement', tips: ['The signed document is one tap away.', 'Security settings for this account live here.', 'The audit log shows every action taken on the agreement.'] },
};

export const INVESTOR_TOUR = { flows: { investor: INVESTOR }, screens: SCREENS };
export default INVESTOR_TOUR;
