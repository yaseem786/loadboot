// marketRates.js — CC: Market data (bl_mkt_0442–0445, 25 Sep 2026). ONE place for every weekly number and word on
// loadboot.com. The owner reads DAT Trendlines, types the three anchors (van / reefer / flatbed) and presses Publish:
// the server derives the other five, writes rate_history, keeps rate_standards in step and fires the Netlify build
// hook. Diesel pulls itself from EIA. Slow facts and weekly words live in the registry with stale badges.
// Every popup is openDrawer() (CLAUDE.md §8). Every write is staff-only server-side and audited.
import { el, mount } from '../../shared/ui/dom.js';
import { sectionHead, segmented, openDrawer, askConfirm, statCard } from '../../shared/ui/components.js';
import { renderMarketWidget } from '../../shared/market-widget.js';
import { siteFacts, siteFactSet, siteRebuild, sitePublishConfigSet, marketRatesPreview, marketRatesPublish,
         dieselPullNow, dieselSet, dieselConfigSet, dieselWorkerToken, setRateStandard } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';

const D = (n) => (n == null || isNaN(+n)) ? '—' : '$' + (+n).toFixed(2);
const dt = (s) => s ? String(s).slice(0, 10) : '—';
const ago = (ts) => { if (!ts) return 'never'; const m = Math.round((Date.now() - new Date(ts)) / 60000); return m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };
const lastMonday = () => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const btn = (label, onClick, cls) => el('button', { class: 'lb-btn ' + (cls || ''), onClick }, label);
function field(label, input, hint) {
  return el('div', { class: 'cc-field' }, [el('span', null, label), input, hint ? el('div', { class: 'cc-sub' }, hint) : '']);
}
function inp(attrs) { return el('input', Object.assign({ class: 'cc-input' }, attrs)); }
function table(head, rows) {
  return el('div', { style: 'overflow-x:auto' }, el('table', { class: 'cc-table' }, [
    el('thead', null, el('tr', null, head.map(h => el('th', null, h)))),
    el('tbody', null, rows.length ? rows.map(r => el('tr', null, r.map(c => el('td', null, c)))) : [el('tr', null, el('td', { colspan: String(head.length), class: 'cc-sub' }, 'Nothing here yet.'))]),
  ]));
}
const badge = (txt, tone) => el('span', { class: 'cc-pill', style: 'font-size:.72rem;padding:2px 8px;border-radius:999px;font-weight:700;' +
  (tone === 'red' ? 'background:#fee2e2;color:#991b1b' : tone === 'amber' ? 'background:#fef3c7;color:#92400e' : 'background:#dcfce7;color:#166534') }, txt);
const rebuildNote = (rb) => !rb ? '' : rb.outcome === 'fired' ? ' · site rebuild started' : rb.outcome === 'not_configured' ? ' · NO rebuild: Netlify hook not set (Overview → Set hook)' : ' · rebuild ' + rb.outcome + (rb.error ? ': ' + rb.error : '');

export function renderMarketRatesCC(host) {
  let data = null, tab = 'overview';
  const body = el('div', null, el('div', { class: 'cc-sub' }, 'Loading market data…'));
  const view = el('div', { class: 'cc-view' }, [
    sectionHead('Market data', 'The one place every weekly number and word on loadboot.com comes from. Publish rebuilds the site; nothing weekly lives in the build any more.'),
    el('div', { id: 'md-tabs' }),
    body,
  ]);
  mount(host, view);
  const tabs = [
    { value: 'overview', label: 'Overview' }, { value: 'rates', label: 'Rates · Publish' }, { value: 'registry', label: 'Registry · Words & facts' },
    { value: 'diesel', label: 'Diesel' }, { value: 'pages', label: 'Pages' }, { value: 'live', label: 'Live view' },
  ];
  mount(view.querySelector('#md-tabs'), segmented(tabs, tab, (v) => { tab = v; draw(); }));

  async function load() {
    try { data = await siteFacts(); draw(); }
    catch (e) { mount(body, el('div', { class: 'cc-sub' }, humanizeError(e))); }
  }
  function draw() {
    if (!data) return;
    if (tab === 'overview') return mount(body, drawOverview());
    if (tab === 'rates') return mount(body, drawRates());
    if (tab === 'registry') return mount(body, drawRegistry());
    if (tab === 'diesel') return mount(body, drawDiesel());
    if (tab === 'pages') return mount(body, drawPages());
    const w = el('div', null); mount(body, w);
    renderMarketWidget(w, { sub: 'Staff view — every audience side by side. What each role sees in their own portal is server-enforced.' });
  }

  // ---------------------------------------------------------------- overview
  function drawOverview() {
    const stale = data.stale || [], pub = data.publish || {}, us = (data.diesel || []).find(r => r.region === 'US average') || {};
    const ratesAsOf = (data.rates || []).reduce((m, r) => r.as_of > m ? r.as_of : m, '');
    const kpis = el('div', { class: 'cc-kpi-grid' }, [
      statCard({ icon: 'dollar', label: 'Rates as of', value: dt(ratesAsOf), sub: (data.rates[0] || {}).source || '', accent: stale.some(s => s.what === 'rates') ? 'red' : 'green', onClick: () => { tab = 'rates'; draw(); } }),
      statCard({ icon: 'trend', label: 'Diesel (US avg)', value: D(us.usd_gal) + '/gal', sub: 'as of ' + dt(us.as_of), accent: stale.some(s => s.what.indexOf('diesel') === 0) ? 'red' : 'green', onClick: () => { tab = 'diesel'; draw(); } }),
      statCard({ icon: 'grid', label: 'Registry', value: String((data.facts || []).length) + ' keys', sub: stale.filter(s => s.what.indexOf('fact:') === 0).length + ' past due', accent: stale.some(s => s.what.indexOf('fact:') === 0) ? 'amber' : 'green', onClick: () => { tab = 'registry'; draw(); } }),
      statCard({ icon: 'bell', label: 'Site rebuild', value: pub.configured ? (pub.last_fired_at ? ago(pub.last_fired_at) : 'never') : 'hook not set', sub: pub.last_reason ? 'last: ' + pub.last_reason : 'Netlify build hook', accent: pub.configured ? 'blue' : 'red' }),
    ]);
    const staleBox = el('div', { class: 'lb-card', style: 'margin:14px 0' }, [
      el('div', { class: 'cc-card-head' }, el('div', { class: 'cc-card-title' }, stale.length ? '⚠ Stale on the public site' : '✓ Nothing stale')),
      stale.length ? el('ul', { style: 'margin:6px 0 0 18px;line-height:1.7' }, stale.map(s => el('li', null, [el('b', null, s.what), ' — ' + s.msg + (s.as_of ? ' (as of ' + dt(s.as_of) + ')' : '')]))) : el('div', { class: 'cc-sub' }, 'Rates ≤ 7 days, diesel ≤ 8 days, every fact inside its cadence and before its due date.'),
    ]);
    const actions = el('div', { class: 'cc-row', style: 'display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px' }, [
      btn('Rebuild site now', async () => {
        if (!await askConfirm('Rebuild the public site?', { body: 'Netlify rebuilds loadboot.com from the current registry (2–3 minutes). Use it after edits made outside this screen.', confirmLabel: 'Rebuild' })) return;
        try { const r = await siteRebuild('manual'); toast('Rebuild ' + r.outcome + (r.error ? ': ' + r.error : ''), r.outcome === 'fired' ? 'success' : 'error'); load(); } catch (e) { toast(humanizeError(e), 'error'); }
      }, 'lb-btn-primary'),
      btn(pub.configured ? 'Netlify hook: ' + pub.hook_hint + ' · change' : 'Set Netlify build hook…', openHookDrawer, 'lb-btn-ghost'),
      btn(pub.enabled === false ? 'Auto-rebuild is OFF · turn on' : 'Auto-rebuild ON · pause', async () => {
        try { await sitePublishConfigSet(null, pub.enabled === false); toast('Saved', 'success'); load(); } catch (e) { toast(humanizeError(e), 'error'); }
      }, 'lb-btn-ghost'),
    ]);
    const log = table(['When', 'Reason', 'Outcome', 'Error'], (pub.log || []).map(l => [ago(l.at), l.reason, l.outcome, l.error || '']));
    return el('div', null, [kpis, staleBox, actions, el('div', { class: 'cc-card-title', style: 'margin:6px 0' }, 'Rebuild log'), log]);
  }
  function openHookDrawer() {
    const url = inp({ type: 'url', placeholder: 'https://api.netlify.com/build_hooks/…', autocomplete: 'off' });
    const bodyN = el('div', null, [
      el('p', { class: 'cc-sub', style: 'line-height:1.6' }, 'Netlify → Site configuration → Build & deploy → Build hooks → Add build hook (name it "LoadBoot CC publish", branch main). Paste the URL here. It is stored server-side and never shown in full again.'),
      field('Build hook URL', url),
      el('div', { style: 'display:flex;gap:8px;margin-top:10px' }, [btn('Save', async () => {
        try { await sitePublishConfigSet(url.value.trim(), true); toast('Hook saved', 'success'); d.close(); load(); } catch (e) { toast(humanizeError(e), 'error'); }
      }, 'lb-btn-primary')]),
    ]);
    const d = openDrawer('Netlify build hook', bodyN, { size: 'sm', subtitle: 'Publish → rebuild, with no deploy' });
  }

  // ---------------------------------------------------------------- rates
  function drawRates() {
    const cur = {}; (data.rates || []).forEach(r => { cur[r.equipment] = r; });
    const van = inp({ type: 'number', step: '0.01', min: '1', max: '8', value: (cur['Dry Van'] || {}).rpm_avg || '' });
    const reefer = inp({ type: 'number', step: '0.01', min: '1', max: '8', value: (cur['Reefer'] || {}).rpm_avg || '' });
    const flatbed = inp({ type: 'number', step: '0.01', min: '1', max: '8', value: (cur['Flatbed'] || {}).rpm_avg || '' });
    const week = inp({ type: 'date', value: lastMonday() });
    const source = inp({ type: 'text', placeholder: 'DAT Trendlines national averages, week of … (default)', maxlength: '160' });
    const preview = el('div', null);
    const nums = () => [van, reefer, flatbed].map(i => parseFloat(i.value));
    async function doPreview() {
      const [v, r, f] = nums(); if ([v, r, f].some(isNaN)) return toast('All three anchors are needed', 'error');
      try {
        const rows = await marketRatesPreview(v, r, f);
        mount(preview, table(['Equipment', 'Carrier $/mi', 'Low – high', 'Now', 'Move', 'How'], rows.map(x => {
          const c = cur[x.equipment] || {}; const pct = c.rpm_avg ? ((x.rpm_avg - c.rpm_avg) / c.rpm_avg * 100) : null;
          return [x.equipment, D(x.rpm_avg), D(x.rpm_low) + ' – ' + D(x.rpm_high), D(c.rpm_avg), pct == null ? '—' : el('span', { style: Math.abs(pct) > 15 ? 'color:#b91c1c;font-weight:700' : '' }, (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%'), x.basis];
        })));
      } catch (e) { toast(humanizeError(e), 'error'); }
    }
    async function doPublish(confirmed) {
      const [v, r, f] = nums(); if ([v, r, f].some(isNaN)) return toast('All three anchors are needed', 'error');
      if (!week.value) return toast('Trendlines week date is needed', 'error');
      try {
        const res = await marketRatesPublish(v, r, f, week.value, source.value.trim() || null, confirmed);
        if (res && res.needs_confirm) {
          const ok = await askConfirm('Big move — are these right?', { danger: true, confirmLabel: 'Yes, publish anyway',
            body: 'More than ' + res.max_pct + '% week on week: ' + res.moves.map(m => m.equipment + ' ' + D(m.from) + ' → ' + D(m.to) + ' (' + (m.pct > 0 ? '+' : '') + m.pct + '%)').join('; ') + '. A typo here goes on every market page.' });
          if (ok) return doPublish(true);
          return;
        }
        toast('Published as of ' + res.as_of + rebuildNote(res.rebuild), 'success'); load();
      } catch (e) { toast(humanizeError(e), 'error'); }
    }
    const form = el('div', { class: 'lb-card' }, [
      el('div', { class: 'cc-card-head' }, el('div', { class: 'cc-card-title' }, 'Publish this week\'s rates')),
      el('p', { class: 'cc-sub', style: 'line-height:1.6;margin:0 0 10px' }, 'Read the three national averages on DAT Trendlines and type them here. Step deck, conestoga, power only, box truck and hotshot are derived (ratios below); low/high bands too. as_of becomes today; the week goes in the source line. Moves over the threshold ask once.'),
      el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px' }, [
        field('Dry van $/mi', van), field('Reefer $/mi', reefer), field('Flatbed $/mi', flatbed), field('Trendlines week (Mon)', week),
      ]),
      field('Source line (optional)', source, 'Shown on the site as the source credit. Leave empty for "DAT Trendlines national averages, week of <date>".'),
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px' }, [btn('Preview all 8', doPreview, 'lb-btn-ghost'), btn('Publish → rebuild site', () => doPublish(false), 'lb-btn-primary')]),
      preview,
    ]);
    const current = table(['Equipment', 'Carrier', 'Low – high', 'As of', 'Source'], (data.rates || []).map(r => [r.equipment, D(r.rpm_avg), D(r.rpm_low) + ' – ' + D(r.rpm_high), dt(r.as_of), r.source || '']));
    const stds = el('div', { class: 'lb-card', style: 'margin-top:14px' }, [
      el('div', { class: 'cc-card-head' }, el('div', { class: 'cc-card-title' }, 'Derivation settings (rate_standards)')),
      el('p', { class: 'cc-sub' }, 'Ratios and bands the derived rows use. Changing one applies at the next Publish.'),
      ...(data.standards || []).map(s => {
        const i = inp({ type: 'text', value: s.value, style: 'max-width:120px' });
        return el('div', { style: 'display:flex;gap:8px;align-items:center;padding:4px 0;flex-wrap:wrap' }, [
          el('span', { style: 'min-width:280px;font-size:.9rem' }, [el('b', null, s.label || s.key), el('span', { class: 'cc-sub' }, ' · ' + s.key + (s.unit ? ' · ' + s.unit : ''))]), i,
          btn('Save', async () => { try { await setRateStandard(s.key, i.value.trim()); toast('Saved ' + s.key, 'success'); load(); } catch (e) { toast(humanizeError(e), 'error'); } }, 'lb-btn-sm'),
        ]);
      }),
    ]);
    const hist = table(['As of', 'Equipment', '$/mi', 'Source'], (data.rate_history || []).slice(0, 24).map(h => [dt(h.as_of), h.equipment, D(h.rpm), h.source || '']));
    return el('div', null, [form, el('div', { class: 'cc-card-title', style: 'margin:14px 0 6px' }, 'On the site now'), current, stds, el('div', { class: 'cc-card-title', style: 'margin:14px 0 6px' }, 'History (rate_history, newest first)'), hist]);
  }

  // ---------------------------------------------------------------- registry
  function drawRegistry() {
    const staleKeys = new Set((data.stale || []).filter(s => s.what.indexOf('fact:') === 0).map(s => s.what.slice(5)));
    const rows = (data.facts || []).map(f => [
      el('span', null, [el('b', null, f.key), staleKeys.has(f.key) ? el('span', { style: 'margin-left:6px' }, badge('stale', 'red')) : '']),
      f.kind === 'number' ? (f.value + (f.unit ? ' ' + f.unit : '')) : el('span', { style: 'white-space:pre-wrap' }, f.value),
      dt(f.as_of), f.due_on ? 'due ' + dt(f.due_on) : (f.cadence_days ? 'every ' + f.cadence_days + ' d' : '—'),
      (f.pages || []).join(', ') || '—',
      btn('Edit', () => openFactDrawer(f), 'lb-btn-sm'),
    ]);
    return el('div', null, [
      el('p', { class: 'cc-sub', style: 'line-height:1.6' }, 'Numbers and short weekly words the site reads at build time (fact(key) in build_site.py). Saving sets as_of to today and rebuilds the site. Computed numbers (worked examples, derived rates) are not here on purpose: they follow their inputs.'),
      el('div', { style: 'margin:8px 0' }, btn('+ Add a fact', () => openFactDrawer(null), 'lb-btn-primary lb-btn-sm')),
      table(['Key', 'Value', 'As of', 'Cadence / due', 'Pages', ''], rows),
    ]);
  }
  function openFactDrawer(f) {
    const isNew = !f; f = f || {};
    const key = inp({ type: 'text', value: f.key || '', placeholder: 'area.thing (lower case, dots)', disabled: isNew ? null : 'disabled' });
    const kind = el('select', { class: 'cc-input' }, [el('option', { value: 'text' }, 'text — a word or a short line'), el('option', { value: 'number' }, 'number')]);
    kind.value = f.kind || 'text';
    const value = f.kind === 'number' ? inp({ type: 'text', value: f.value || '' }) : el('textarea', { class: 'cc-input', rows: '3' }, f.value || '');
    const unit = inp({ type: 'text', value: f.unit || '', placeholder: '$/day, %, $/mi…' });
    const source = inp({ type: 'text', value: f.source || '', placeholder: 'Where the value comes from' });
    const asof = inp({ type: 'date', value: f.as_of ? dt(f.as_of) : new Date().toISOString().slice(0, 10) });
    const cadence = inp({ type: 'number', min: '1', value: f.cadence_days || '', placeholder: 'days before it counts as stale' });
    const due = inp({ type: 'date', value: f.due_on ? dt(f.due_on) : '' });
    const note = inp({ type: 'text', value: f.note || '', placeholder: 'What to check when it is due' });
    const rebuild = el('input', { type: 'checkbox' }); rebuild.checked = true;
    const bodyN = el('div', null, [
      field('Key', key), isNew ? field('Kind', kind) : '', field('Value', value, 'as_of resets to the date below when you save'),
      el('div', { style: 'display:grid;grid-template-columns:1fr 1fr;gap:10px' }, [field('Unit', unit), field('As of', asof), field('Cadence (days)', cadence), field('Due on', due)]),
      field('Source', source), field('Note', note),
      el('label', { style: 'display:flex;gap:8px;align-items:center;margin:8px 0' }, [rebuild, 'Rebuild the site after saving']),
      el('div', { style: 'display:flex;gap:8px' }, [btn('Save', async () => {
        const opts = { kind: isNew ? kind.value : f.kind, unit: unit.value.trim() || null, source: source.value.trim() || null, as_of: asof.value || null,
          cadence_days: cadence.value ? parseInt(cadence.value, 10) : null, due_on: due.value || null, note: note.value.trim() || null, rebuild: rebuild.checked };
        Object.keys(opts).forEach(k => { if (opts[k] == null) delete opts[k]; });
        try { const r = await siteFactSet(key.value.trim(), value.value, opts); toast('Saved ' + r.key + rebuildNote(r.rebuild), 'success'); d.close(); load(); }
        catch (e) { toast(humanizeError(e), 'error'); }
      }, 'lb-btn-primary')]),
    ]);
    const d = openDrawer(isNew ? 'New fact' : f.key, bodyN, { subtitle: isNew ? 'Register a number or a weekly line the site should read' : (f.pages || []).join(', ') });
  }

  // ---------------------------------------------------------------- diesel
  function drawDiesel() {
    const dp = data.diesel_pull || {}, last = dp.last || null;
    const status = el('div', { class: 'lb-card' }, [
      el('div', { class: 'cc-card-head' }, el('div', { class: 'cc-card-title' }, 'EIA weekly pull')),
      el('p', { class: 'cc-sub', style: 'line-height:1.6' }, 'Tuesday and Wednesday 14:00 UTC the eia-diesel-pull function reads the US average and nine regions from the EIA API and rebuilds the site when the week moved. The site uses this diesel only after a successful pull or an override; until then it keeps its fallback figure.'),
      el('div', { style: 'margin:8px 0' }, last ? [badge(last.outcome, last.outcome === 'ok' || last.outcome === 'manual' ? 'green' : 'red'), ' ', el('span', { class: 'cc-sub' }, ago(last.at) + (last.period ? ' · period ' + dt(last.period) : '') + (last.error ? ' · ' + last.error : ''))] : el('span', { class: 'cc-sub' }, 'No pull yet.')),
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [
        btn('Pull now', async () => { try { const r = await dieselPullNow(); toast(r.outcome === 'kicked' ? 'Pull requested — refresh in a few seconds' : 'Pull ' + r.outcome, r.outcome === 'kicked' ? 'success' : 'error'); setTimeout(load, 6000); } catch (e) { toast(humanizeError(e), 'error'); } }, 'lb-btn-primary'),
        btn('Override a region…', openDieselDrawer, 'lb-btn-ghost'),
        btn(dp.configured ? 'Setup · secrets' : 'Setup (not configured)', openDieselSetup, 'lb-btn-ghost'),
      ]),
    ]);
    const rows = table(['Region', '$/gal', 'As of', 'Updated'], (data.diesel || []).map(r => [r.region, D(r.usd_gal), dt(r.as_of), ago(r.updated_at)]));
    const log = table(['When', 'Outcome', 'Period', 'Changed', 'Error'], (dp.log || []).map(l => [ago(l.at), l.outcome, dt(l.period), l.changed ? 'yes' : 'no', l.error || '']));
    return el('div', null, [status, el('div', { class: 'cc-card-title', style: 'margin:14px 0 6px' }, 'On the site'), rows, el('div', { class: 'cc-card-title', style: 'margin:14px 0 6px' }, 'Pull log'), log]);
  }
  function openDieselDrawer() {
    const region = el('select', { class: 'cc-input' }, (data.diesel || []).map(r => el('option', { value: r.region }, r.region)));
    const val = inp({ type: 'number', step: '0.001', min: '1', max: '12' });
    const asof = inp({ type: 'date', value: new Date().toISOString().slice(0, 10) });
    const bodyN = el('div', null, [
      el('p', { class: 'cc-sub' }, 'Only when the EIA pull is down. Logged as a manual override, audited, and the site rebuilds.'),
      field('Region', region), field('$/gal', val), field('As of', asof),
      el('div', { style: 'display:flex;gap:8px;margin-top:8px' }, [btn('Save override', async () => {
        try { const r = await dieselSet(region.value, parseFloat(val.value), asof.value); toast(region.value + ' = ' + D(r.usd_gal) + rebuildNote(r.rebuild), 'success'); d.close(); load(); } catch (e) { toast(humanizeError(e), 'error'); }
      }, 'lb-btn-primary')]),
    ]);
    const d = openDrawer('Diesel override', bodyN, { size: 'sm' });
  }
  async function openDieselSetup() {
    let t = {}; try { t = await dieselWorkerToken(); } catch (e) { toast(humanizeError(e), 'error'); return; }
    const url = inp({ type: 'url', value: t.function_url || '' }), anon = inp({ type: 'text', placeholder: t.anon_key_set ? '(set)' : 'project anon key' }), tok = inp({ type: 'text', value: t.worker_token || '' });
    const bodyN = el('div', null, [
      el('ol', { class: 'cc-sub', style: 'line-height:1.7;margin:0 0 10px 18px' }, [
        el('li', null, 'Create a free API key at eia.gov/opendata/register.php (arrives by email).'),
        el('li', null, 'Supabase → Edge Functions → Secrets: add EIA_API_KEY = that key, and EIA_WORKER_TOKEN = the worker token below.'),
        el('li', null, 'Press "Pull now" on the Diesel tab; the log should read ok with this week\'s period.'),
      ]),
      field('Function URL', url), field('Anon key', anon, 'Only if it shows as not set'), field('Worker token (x-lb-worker)', tok, 'Copy this into the EIA_WORKER_TOKEN secret'),
      el('div', { style: 'display:flex;gap:8px;margin-top:8px' }, [btn('Save config', async () => {
        try { const r = await dieselConfigSet(url.value.trim(), anon.value.trim(), tok.value.trim()); toast(r.configured ? 'Configured' : 'Saved (still incomplete)', r.configured ? 'success' : 'error'); d.close(); load(); } catch (e) { toast(humanizeError(e), 'error'); }
      }, 'lb-btn-primary')]),
    ]);
    const d = openDrawer('Diesel pull setup', bodyN, { subtitle: 'Two secrets the owner sets himself; nothing here is typed for him' });
  }

  // ---------------------------------------------------------------- pages
  function drawPages() {
    const byPage = {};
    (data.facts || []).forEach(f => (f.pages || []).forEach(p => { (byPage[p] = byPage[p] || []).push(f.key); }));
    const ratePages = ['market-rates', 'spot-market-freight-rates', 'truckload-freight-rates', 'fuel-surcharge-trucking', 'oversize-load-rates-per-mile', 'cost-per-mile-calculator', 'tools', 'load-score',
      'dry-van-freight-rates', 'reefer-freight-rates', 'flatbed-freight-rates', 'step-deck-freight-rates', 'conestoga-freight-rates', 'power-only-freight-rates', 'box-truck-freight-rates', 'hotshot-freight-rates', 'freight-market-reports'];
    ratePages.forEach(p => { byPage[p] = (byPage[p] || []).concat(['rates (live)', p === 'freight-market-reports' ? 'rate_history' : 'diesel']); });
    const rows = Object.keys(byPage).sort().map(p => [el('a', { href: 'https://loadboot.com/' + p + '.html', target: '_blank', rel: 'noopener' }, p + '.html'), byPage[p].join(', ')]);
    return el('div', null, [
      el('p', { class: 'cc-sub', style: 'line-height:1.6' }, 'Which page reads which key. Rates and diesel reach every market page through the build; the drift lint in build_site.py refuses a build with a hand-typed $/mi or $/gal figure on these pages.'),
      table(['Page', 'Reads'], rows),
    ]);
  }

  load();
}
