// telemetry.js — real-user error and performance monitoring for the LoadBoot apps.
//
// WHY: until this existed, a broken deploy was invisible. A carrier whose app fails to
// load simply leaves, and we never hear about it. This is the smallest honest version
// of what Sentry/Datadog RUM do: catch the error, group it, and say which build and
// which screen it came from.
//
// WHAT IT SENDS
//   errors  — window.onerror, unhandled promise rejections, failed script/style loads
//   vitals  — LCP, CLS, INP, TTFB, FCP (PerformanceObserver, no third-party library)
// Both ride public.track_web_event, the ingestion door that already exists and is
// already anon-callable, so no new anon-executable function is introduced.
//
// WHAT IT NEVER SENDS
//   No user id, no account data, no request bodies, no cookies, no full URLs with
//   query strings. Messages and stacks are scrubbed for emails, tokens and long digit
//   runs before they leave the device, and scrubbed AGAIN server-side. An error
//   monitor that quietly accumulates user data is a liability, not an asset.
//
// COST CONTROL
//   Errors are fingerprinted client-side and each fingerprint is sent at most once per
//   session; a session sends at most MAX_PER_SESSION errors in total. A render loop
//   throwing 5,000 times costs one row and one request, not 5,000.

const MAX_PER_SESSION = 8;      // hard ceiling per page session
const CRUMB_LIMIT = 8;          // breadcrumbs kept for context
const STACK_FRAMES = 4;         // frames retained — enough to locate, small enough to store

let sent = 0;
const seen = new Set();
const crumbs = [];
let started = false;

// ---------------------------------------------------------------- helpers

function scrub(s) {
  return String(s == null ? '' : s)
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>')
    .replace(/eyJ[A-Za-z0-9_-]{10,}/g, '<token>')
    .replace(/sb_[a-z]+_[A-Za-z0-9_-]{10,}/g, '<token>')
    .replace(/\d{9,}/g, '<num>')
    .slice(0, 2000);
}

// Route without the query string: query strings carry ids and tokens, and two users
// hitting the same screen must land on the same fingerprint.
function route() {
  try { return scrub(location.pathname + (location.hash || '')).slice(0, 256); }
  catch (_) { return ''; }
}

function portal() {
  try {
    const m = location.pathname.match(/^\/app\/([^/]+)/);
    return m ? m[1] : 'site';
  } catch (_) { return 'site'; }
}

function buildId() {
  try { return (window.__LB_ENV && window.__LB_ENV.buildId) || 'dev'; } catch (_) { return 'dev'; }
}

function device() {
  try { return matchMedia('(max-width: 767px)').matches ? 'mobile' : 'desktop'; } catch (_) { return 'unknown'; }
}

function conn() {
  try {
    const c = navigator.connection;
    return c && c.effectiveType ? String(c.effectiveType) : '';
  } catch (_) { return ''; }
}

// Small stable hash. Not cryptographic — it only has to group identical errors.
function fingerprint(parts) {
  const s = parts.filter(Boolean).join('|');
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    h1 = (h1 ^ s.charCodeAt(i)) >>> 0; h1 = Math.imul(h1, 16777619) >>> 0;
    h2 = (h2 + s.charCodeAt(i) * (i + 1)) >>> 0;
  }
  return (h1.toString(36) + h2.toString(36)).slice(0, 32);
}

// Normalise a message so the same bug groups even when the details vary: strip
// numbers, quoted values and urls that differ run to run.
function normalise(msg) {
  return scrub(msg)
    .replace(/https?:\/\/[^\s)'"]+/g, '<url>')
    .replace(/["'`][^"'`]{0,80}["'`]/g, '<v>')
    .replace(/\b\d+\b/g, '<n>')
    .slice(0, 300);
}

function topFrames(stack) {
  if (!stack) return '';
  return scrub(String(stack).split('\n').slice(0, STACK_FRAMES).map((l) => l.trim()).join(' <- '));
}

function post(payload) {
  let env = null;
  try { env = window.__LB_ENV; } catch (_) {}
  if (!env || !env.supabaseUrl || !env.supabaseAnonKey) return;
  const url = env.supabaseUrl + '/rest/v1/rpc/track_web_event';
  const body = JSON.stringify({ p: payload });
  try {
    // keepalive so the report still leaves while the page is unloading — the moment
    // a fatal error fires is exactly when the user closes the tab.
    fetch(url, {
      method: 'POST', keepalive: true, mode: 'cors',
      headers: { 'Content-Type': 'application/json', apikey: env.supabaseAnonKey,
                 Authorization: 'Bearer ' + env.supabaseAnonKey },
      body,
    }).catch(() => {});
  } catch (_) {}
}

// ---------------------------------------------------------------- public API

/** Record a breadcrumb — the trail of what happened before an error. */
export function crumb(label) {
  try {
    crumbs.push(String(label).slice(0, 60));
    while (crumbs.length > CRUMB_LIMIT) crumbs.shift();
  } catch (_) {}
}

/** Report an error. Safe to call directly from a catch block. */
export function reportError(err, kind) {
  try {
    if (sent >= MAX_PER_SESSION) return;
    const msg = (err && (err.message || err.reason || err)) || 'Unknown error';
    const stack = topFrames(err && err.stack);
    const norm = normalise(msg);
    const fp = fingerprint([norm, stack.slice(0, 120), portal()]);
    if (seen.has(fp)) return;          // one report per distinct error per session
    seen.add(fp); sent += 1;
    post({
      tkind: 'error', fp,
      message: scrub(msg), stack, ekind: kind || 'error',
      route: route(), portal: portal(), build: buildId(),
      device: device(), conn: conn(),
      ua: (navigator.userAgent || '').slice(0, 180),
      crumbs: crumbs.slice(),
    });
  } catch (_) { /* telemetry must never throw into the app */ }
}

function sendVital(metric, value, rating) {
  try {
    post({ tkind: 'vital', metric, value: Math.round(value * 1000) / 1000, rating,
           route: route(), portal: portal(), build: buildId(),
           device: device(), conn: conn() });
  } catch (_) {}
}

// Google's published thresholds. Kept here so the rating is meaningful without a
// library: LCP good <=2.5s, INP good <=200ms, CLS good <=0.1, FCP <=1.8s, TTFB <=0.8s.
const RATE = {
  LCP: [2500, 4000], INP: [200, 500], CLS: [0.1, 0.25], FCP: [1800, 3000], TTFB: [800, 1800],
};
function rate(metric, v) {
  const t = RATE[metric]; if (!t) return null;
  return v <= t[0] ? 'good' : v <= t[1] ? 'needs-improvement' : 'poor';
}

function observeVitals() {
  const PO = window.PerformanceObserver;
  if (!PO) return;
  const once = {};

  const flush = (metric, value) => {
    if (once[metric]) return; once[metric] = true;
    sendVital(metric, value, rate(metric, value));
  };

  try { // TTFB + FCP from the navigation/paint timeline
    const nav = performance.getEntriesByType('navigation')[0];
    if (nav && nav.responseStart > 0) flush('TTFB', nav.responseStart);
  } catch (_) {}

  try {
    new PO((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') flush('FCP', e.startTime); })
      .observe({ type: 'paint', buffered: true });
  } catch (_) {}

  let lcp = 0;
  try {
    new PO((l) => { const es = l.getEntries(); lcp = es[es.length - 1].startTime; })
      .observe({ type: 'largest-contentful-paint', buffered: true });
  } catch (_) {}

  let cls = 0;
  try {
    new PO((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) cls += e.value; })
      .observe({ type: 'layout-shift', buffered: true });
  } catch (_) {}

  let inp = 0;
  try {
    new PO((l) => { for (const e of l.getEntries()) if (e.duration > inp) inp = e.duration; })
      .observe({ type: 'event', buffered: true, durationThreshold: 40 });
  } catch (_) {}

  // LCP, CLS and INP are only final when the user leaves the page.
  const finalise = () => {
    if (lcp > 0) flush('LCP', lcp);
    if (cls > 0) flush('CLS', cls);
    if (inp > 0) flush('INP', inp);
  };
  addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') finalise(); });
  addEventListener('pagehide', finalise);
}

/** Wire up global handlers. Call once, as early as possible. */
export function initTelemetry() {
  if (started) return; started = true;
  try {
    addEventListener('error', (ev) => {
      // A failed <script>/<link>/<img> fires an error event with no `error` object.
      if (ev && ev.target && ev.target !== window && (ev.target.src || ev.target.href)) {
        const src = String(ev.target.src || ev.target.href || '');
        reportError({ message: 'Failed to load ' + (ev.target.tagName || '').toLowerCase() + ': ' + src.split('?')[0], stack: '' }, 'resource');
        return;
      }
      reportError((ev && ev.error) || (ev && ev.message), 'error');
    }, true);

    addEventListener('unhandledrejection', (ev) => {
      reportError((ev && ev.reason) || 'Unhandled promise rejection', 'unhandledrejection');
    });

    // Route changes make useful breadcrumbs in a hash-routed app.
    addEventListener('hashchange', () => crumb('nav:' + (location.hash || '#').slice(0, 40)));
    crumb('load:' + route().slice(0, 40));

    observeVitals();
  } catch (_) {}
}

export default { initTelemetry, reportError, crumb };
