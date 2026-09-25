// tour-content.js — what the developer portal tour says. One screen, five stops, plain English.
// Same engine as the carrier portal (../shared/ui/tour.js). The portal has no tabs, so every stop
// sits on the one screen ('home') and `navigate` is a no-op.
// Copy is code-defined markup (rendered with innerHTML by tour.js) — never put user data or keys in here.

const DEVELOPER = [
  { id: 'welcome', hero: true, kind: 'welcome',
    title: 'Welcome to the LoadBoot API',
    text: '<p>Create a key, call the API, and have LoadBoot push events to your own endpoint. Everything on this one page.</p><p>One minute, and you are set. Skip any time.</p>',
    meta: '1 minute · 6 stops · skip any time' },

  { id: 'create', screen: 'home', chapter: 'Keys', icon: 'zap', tone: 'orange',
    target: ['[data-tour="dev-create"]'], anchor: '.cp-content',
    title: 'Create an API key',
    text: 'Name it after the system that will use it. The full key is shown <b>once</b>, right here, when it is created. Copy it into your secrets store straight away; we only keep the prefix.',
    tip: 'One key per integration makes revoking painless later.', tipKind: 'warn' },

  { id: 'keys', screen: 'home', chapter: 'Keys', icon: 'list',
    target: ['[data-tour="dev-keys"]'], anchor: '.cp-content',
    title: 'Your keys',
    text: 'Every key with its prefix, scopes, last use and status. Revoke one and it stops working immediately.' },

  { id: 'quickstart', screen: 'home', chapter: 'First call', icon: 'play',
    target: ['[data-tour="dev-quickstart"]'], anchor: '.cp-content',
    title: 'Your first call, ready to paste',
    text: 'The base URL, the header to send your key in, and a working example that lists public load opportunities. Swap in your key and run it.' },

  { id: 'webhooks', screen: 'home', chapter: 'Events', icon: 'send',
    target: ['[data-tour="dev-webhooks"]'], anchor: '.cp-content',
    title: 'Let LoadBoot call you',
    text: 'Register an https endpoint and every matching event is POSTed to it, with retries. Leave the events field blank to receive everything. Up to five endpoints per account.',
    tip: 'Deliveries start within a couple of minutes of registering.' },

  { id: 'events', screen: 'home', chapter: 'Events', icon: 'activity',
    target: ['[data-tour="dev-events"]'], anchor: '.cp-content',
    title: 'What you can listen for',
    text: 'Load assigned, trip status, exceptions, proof of delivery, invoices and more. Each row says exactly when the event fires.' },

  { id: 'help', screen: 'home', chapter: 'Stuck?', icon: 'chat',
    target: ['.lbt-help'], padding: 6, radius: 999,
    title: 'This button is always here',
    text: 'Tap <b>?</b> for a short guide to this page or to replay this tour.' },

  { id: 'done', hero: true, kind: 'done',
    title: 'Go build something',
    text: 'Create a key and make your first call.',
    actions: [
      { label: 'Create a key', icon: 'zap', route: '#home' },
    ] },
];

const SCREENS = {
  home: { title: 'Developers', tips: ['The full key is shown once, at creation. Copy it then.', 'One key per integration; revoke any time.', 'Register a webhook to receive events instead of polling.'] },
};

export const DEVELOPER_TOUR = { flows: { developer: DEVELOPER }, screens: SCREENS };
export default DEVELOPER_TOUR;
