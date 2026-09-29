// tour-content.js — what the developer portal tour says. Plain English.
// Same engine as the carrier portal (../shared/ui/tour.js). bl_dev_0502: the portal now has tabs
// (overview, keys, usage, docs, webhooks, account); each stop names its tab in `route` and app.js switches to it.
// Copy is code-defined markup (rendered with innerHTML by tour.js) — never put user data or keys in here.

const DEVELOPER = [
  { id: 'welcome', hero: true, kind: 'welcome',
    title: 'Welcome to the LoadBoot API',
    text: '<p>Start in the sandbox, make your first call, then ask for production access. Webhooks push events to your own endpoint.</p><p>One minute, and you are set. Skip any time.</p>',
    meta: '1 minute · 7 stops · skip any time' },

  { id: 'status', screen: 'overview', route: '#overview', chapter: 'Start', icon: 'check',
    target: ['[data-tour="dev-checklist"]'], anchor: '.cp-content',
    title: 'Your checklist',
    text: 'Your account status and the five steps from sandbox to production. Each open step links to where you do it.' },

  { id: 'create', screen: 'keys', route: '#keys', chapter: 'Keys', icon: 'zap', tone: 'orange',
    target: ['[data-tour="dev-create"]'], anchor: '.cp-content',
    title: 'Create an API key',
    text: 'Start with a <b>sandbox</b> key: it returns fixed test loads. Production read keys unlock once we approve your account. The full key is shown <b>once</b>; copy it into your secrets store straight away.',
    tip: 'One key per integration makes revoking painless later.', tipKind: 'warn' },

  { id: 'keys', screen: 'keys', route: '#keys', chapter: 'Keys', icon: 'list',
    target: ['[data-tour="dev-keys"]'], anchor: '.cp-content',
    title: 'Your keys',
    text: 'Every key with its prefix, scopes, last use and status. Revoke one and it stops working immediately.' },

  { id: 'quickstart', screen: 'docs', route: '#docs', chapter: 'First call', icon: 'play',
    target: ['[data-tour="dev-quickstart"]'], anchor: '.cp-content',
    title: 'Your first call, ready to paste',
    text: 'The base URL, the header to send your key in, and working examples. Swap in your key and run them. The attribution rule is on this tab too.' },

  { id: 'webhooks', screen: 'webhooks', route: '#webhooks', chapter: 'Events', icon: 'send',
    target: ['[data-tour="dev-webhooks"]'], anchor: '.cp-content',
    title: 'Let LoadBoot call you',
    text: 'Register an https endpoint and every matching event is POSTed to it, with retries. Leave the events field blank to receive everything. Up to five endpoints per account.',
    tip: 'Deliveries start within a couple of minutes of registering.' },

  { id: 'events', screen: 'docs', route: '#docs', chapter: 'Events', icon: 'activity',
    target: ['[data-tour="dev-events"]'], anchor: '.cp-content',
    title: 'What you can listen for',
    text: 'Load assigned, trip status, exceptions, proof of delivery, invoices and more. Each row says exactly when the event fires.' },

  { id: 'help', screen: 'overview', chapter: 'Stuck?', icon: 'chat',
    target: ['.lbt-help'], padding: 6, radius: 999,
    title: 'This button is always here',
    text: 'Tap <b>?</b> for a short guide to this page or to replay this tour.' },

  { id: 'done', hero: true, kind: 'done',
    title: 'Go build something',
    text: 'Create a key and make your first call.',
    actions: [
      { label: 'Create a key', icon: 'zap', route: '#keys' },
    ] },
];

const SCREENS = {
  overview: { title: 'Overview', tips: ['The sandbox is open from day one.', 'Request production access once your integration works against the sandbox.'] },
  keys: { title: 'API keys', tips: ['The full key is shown once, at creation. Copy it then.', 'One key per integration; revoke any time.'] },
  usage: { title: 'Usage', tips: ['Every call is logged: time, endpoint, status and latency.', '429 means you hit the per-minute limit; wait for Retry-After.'] },
  docs: { title: 'Docs', tips: ['Every load carries its own link-back url. Show "via LoadBoot" on those loads only.'] },
  webhooks: { title: 'Webhooks', tips: ['Register a webhook to receive events instead of polling.'] },
  account: { title: 'Account', tips: ['Questions: hello@loadboot.com.'] },
};

export const DEVELOPER_TOUR = { flows: { developer: DEVELOPER }, screens: SCREENS };
export default DEVELOPER_TOUR;
