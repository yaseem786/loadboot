// seo.js — Control Tower Wave A: SEO & Website control center.
// Two surfaces: Keyword tracking (rank, best/previous position, intent, priority) and a
// Redirect manager (301/302 with loop + chain validation server-side). Keyword positions
// are entered manually until Search Console is connected (honest — no fabricated ranks).
// Reads/writes via cc_seo_* RPCs (seo.view / seo.manage), RBAC-gated + audited.
import { el, mount } from '../../shared/ui/dom.js';
import { showError } from '../../shared/loading.js';
import { sectionHead, statCard, statusPill, searchBox, segmented, card, openDrawer } from '../../shared/ui/components.js';
import { downloadCSV, downloadExcel, printTable } from '../../shared/ui/exporters.js';
import { seoOverview, listKeywords, upsertKeyword, listRedirects, createRedirect, toggleRedirect } from '../../shared/api.js';
import { humanizeError } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';

const KW_COLS = [
  { key: 'keyword', label: 'Keyword' }, { key: 'target_page', label: 'Target page' },
  { key: 'pos', label: 'Position' }, { key: 'prev_pos', label: 'Previous' }, { key: 'best_pos', label: 'Best' },
  { key: 'clicks', label: 'Clicks' }, { key: 'impressions', label: 'Impressions' },
  { key: 'priority', label: 'Priority' }, { key: 'status', label: 'Status' },
];
const RD_COLS = [
  { key: 'source_path', label: 'Source' }, { key: 'destination', label: 'Destination' },
  { key: 'type', label: 'Type' }, { key: 'active', label: 'Active', fmt: v => v ? 'yes' : 'no' },
  { key: 'hit_count', label: 'Hits' }, { key: 'reason', label: 'Reason' },
];

export function renderSeo(host) {
  let tab = 'keywords';
  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('SEO & Website', 'Track keyword rankings and manage site redirects. Search Console can layer in Google’s click & impression data when connected.',
      el('div', { class: 'cc-head-actions', id: 'seo-actions' })),
    el('div', { id: 'seo-kpis' }),
    el('div', { class: 'cc-toolbar' }, el('div', { id: 'seo-tabs' })),
    el('div', { id: 'seo-body' }, el('div', { class: 'lb-state lb-loading' }, 'Loading…')),
  ]));
  const kpiHost = host.querySelector('#seo-kpis');
  const tabHost = host.querySelector('#seo-tabs');
  const actionHost = host.querySelector('#seo-actions');
  const body = host.querySelector('#seo-body');

  mount(tabHost, segmented([{ value: 'keywords', label: 'Keywords' }, { value: 'redirects', label: 'Redirects' }], tab, (v) => { tab = v; renderTab(); }));

  loadKpis();
  renderTab();

  async function loadKpis() {
    let ov;
    try { ov = await seoOverview(); } catch (_) { return; }
    const n = (k) => Number((ov && ov[k]) || 0);
    mount(kpiHost, el('div', { class: 'cc-kpi-grid' }, [
      statCard({ icon: 'trend', label: 'Keywords tracked', value: String(n('keywords')), sub: 'across the site', accent: 'blue' }),
      statCard({ icon: 'grid', label: 'In top 10', value: String(n('top10')), sub: 'page-one rankings', accent: 'green' }),
      statCard({ icon: 'arrowUp', label: 'Improving', value: String(n('improving')), sub: 'moved up vs previous', accent: 'violet' }),
      statCard({ icon: 'refresh', label: 'Active redirects', value: String(n('redirects')), sub: '301 / 302 rules', accent: 'amber' }),
    ]));
  }

  function renderTab() {
    if (tab === 'keywords') renderKeywords(); else renderRedirects();
  }

  // ---------- KEYWORDS ----------
  async function renderKeywords() {
    let rows = [];
    const manage = can('seo.manage');
    mount(actionHost, el('div', { class: 'cc-seg' }, [
      el('button', { class: 'cc-seg-btn', onClick: () => downloadCSV('loadboot-keywords', KW_COLS, rows) }, 'CSV'),
      el('button', { class: 'cc-seg-btn', onClick: () => downloadExcel('loadboot-keywords', KW_COLS, rows, 'Keywords') }, 'Excel'),
      el('button', { class: 'cc-seg-btn', onClick: () => printTable('Keyword rankings', 'LoadBoot · SEO', KW_COLS, rows) }, 'PDF'),
      manage ? el('button', { class: 'lb-btn lb-btn-primary lb-btn-sm', onClick: () => keywordForm(null) }, '+ Keyword') : '',
    ]));
    mount(body, el('div', null, [
      el('div', { class: 'cc-toolbar' }, searchBox('Search keywords…', (q) => loadKw(q))),
      el('div', { id: 'kw-table' }, el('div', { class: 'lb-state lb-loading' }, 'Loading keywords…')),
    ]));
    const tbl = body.querySelector('#kw-table');
    loadKw(null);

    async function loadKw(q) {
      mount(tbl, el('div', { class: 'lb-state lb-loading' }, 'Loading keywords…'));
      try { rows = await listKeywords({ search: q || null }); }
      catch (e) { showError(tbl, humanizeError(e), () => loadKw(q)); return; }
      if (!rows.length) { mount(tbl, card(el('div', { class: 'cc-sub', style: 'padding:8px' }, 'No keywords tracked yet. Add one to start monitoring its rank.'))); return; }
      mount(tbl, card(el('table', { class: 'cc-table' }, [
        el('thead', null, el('tr', null, [el('th', null, 'Keyword'), el('th', null, 'Target'), el('th', null, 'Pos'), el('th', null, 'Δ'), el('th', null, 'Best'), el('th', null, 'Priority'), el('th', null, 'Status')])),
        el('tbody', null, rows.map(k => el('tr', { class: 'cc-row-click', onClick: () => keywordForm(k) }, [
          el('td', null, el('b', null, k.keyword)),
          el('td', null, k.target_page || '—'),
          el('td', null, k.pos != null ? String(k.pos) : '—'),
          el('td', null, deltaCell(k.pos, k.prev_pos)),
          el('td', null, k.best_pos != null ? String(k.best_pos) : '—'),
          el('td', null, statusPill(k.priority || 'normal')),
          el('td', null, statusPill(k.status || 'tracking')),
        ]))),
      ])));
    }

    function keywordForm(k) {
      const isEdit = !!k;
      const fields = {};
      const input = (key, label, val, type) => {
        const i = el('input', { class: 'cc-input', type: type || 'text', value: val ?? '' });
        fields[key] = i;
        return el('label', { class: 'cc-field' }, [el('span', null, label), i]);
      };
      const select = (key, label, opts, val) => {
        const s = el('select', { class: 'cc-input' }, opts.map(o => el('option', { value: o, selected: o === val ? true : null }, o)));
        fields[key] = s;
        return el('label', { class: 'cc-field' }, [el('span', null, label), s]);
      };
      const readonly = !can('seo.manage');
      const form = el('div', null, [
        input('keyword', 'Keyword', k && k.keyword),
        input('target_page', 'Target page (e.g. /carriers)', k && k.target_page),
        input('position', 'Current position (rank)', k && k.pos, 'number'),
        select('priority', 'Priority', ['low', 'normal', 'high'], (k && k.priority) || 'normal'),
        input('intent', 'Search intent (optional)', k && k.intent),
        readonly ? el('p', { class: 'cc-sub' }, 'You have read-only access to SEO.') :
          el('div', { class: 'cc-drawer-actions', style: 'margin-top:12px' }, [
            el('button', { class: 'lb-btn lb-btn-primary', onClick: save }, isEdit ? 'Save changes' : 'Add keyword'),
          ]),
        el('p', { class: 'cc-sub', style: 'margin-top:10px' }, 'Tip: connect Search Console under Integrations to auto-populate clicks, impressions and average position.'),
      ]);
      openDrawer(isEdit ? k.keyword : 'New keyword', form, { subtitle: isEdit ? 'Edit keyword' : 'Track a keyword' });

      async function save() {
        const kw = fields.keyword.value.trim();
        if (!kw) { alert('Keyword is required.'); return; }
        const pos = fields.position.value === '' ? null : Number(fields.position.value);
        try {
          await upsertKeyword({ id: k && k.id, keyword: kw, targetPage: fields.target_page.value.trim() || null, position: pos, priority: fields.priority.value, intent: fields.intent.value.trim() || null });
        } catch (e) { alert(humanizeError(e)); return; }
        document.getElementById('cc-drawer-root')?.remove(); loadKpis(); loadKw(null);
      }
    }
  }

  // ---------- REDIRECTS ----------
  async function renderRedirects() {
    let rows = [];
    const manage = can('seo.manage');
    mount(actionHost, el('div', { class: 'cc-seg' }, [
      el('button', { class: 'cc-seg-btn', onClick: () => downloadCSV('loadboot-redirects', RD_COLS, rows) }, 'CSV'),
      el('button', { class: 'cc-seg-btn', onClick: () => downloadExcel('loadboot-redirects', RD_COLS, rows, 'Redirects') }, 'Excel'),
      el('button', { class: 'cc-seg-btn', onClick: () => printTable('Redirects', 'LoadBoot · SEO', RD_COLS, rows) }, 'PDF'),
      manage ? el('button', { class: 'lb-btn lb-btn-primary lb-btn-sm', onClick: () => redirectForm() }, '+ Redirect') : '',
    ]));
    mount(body, el('div', { id: 'rd-table' }, el('div', { class: 'lb-state lb-loading' }, 'Loading redirects…')));
    const tbl = body.querySelector('#rd-table');
    loadRd();

    async function loadRd() {
      mount(tbl, el('div', { class: 'lb-state lb-loading' }, 'Loading redirects…'));
      try { rows = await listRedirects(); }
      catch (e) { showError(tbl, humanizeError(e), loadRd); return; }
      if (!rows.length) { mount(tbl, card(el('div', { class: 'cc-sub', style: 'padding:8px' }, 'No redirects yet. Add one to send an old URL to a new page.'))); return; }
      mount(tbl, card(el('table', { class: 'cc-table' }, [
        el('thead', null, el('tr', null, [el('th', null, 'Source'), el('th', null, 'Destination'), el('th', null, 'Type'), el('th', null, 'Hits'), el('th', null, 'Active')])),
        el('tbody', null, rows.map(r => el('tr', null, [
          el('td', null, el('b', null, r.source_path)),
          el('td', null, r.destination),
          el('td', null, String(r.type)),
          el('td', null, String(r.hit_count || 0)),
          el('td', null, manage
            ? el('button', { class: 'cc-toggle' + (r.active ? ' on' : ''), onClick: async () => { try { await toggleRedirect(r.id, !r.active); } catch (e) { alert(humanizeError(e)); return; } loadKpis(); loadRd(); } }, r.active ? 'On' : 'Off')
            : statusPill(r.active ? 'active' : 'paused')),
        ]))),
      ])));
    }

    function redirectForm() {
      const fields = {};
      const input = (key, label, ph) => {
        const i = el('input', { class: 'cc-input', type: 'text', placeholder: ph || '' });
        fields[key] = i; return el('label', { class: 'cc-field' }, [el('span', null, label), i]);
      };
      const typeSel = el('select', { class: 'cc-input' }, [el('option', { value: '301' }, '301 — permanent'), el('option', { value: '302' }, '302 — temporary')]);
      const form = el('div', null, [
        input('source', 'Source path', '/old-page'),
        input('destination', 'Destination', '/new-page'),
        el('label', { class: 'cc-field' }, [el('span', null, 'Type'), typeSel]),
        input('reason', 'Reason (optional)', 'Page moved'),
        el('div', { class: 'cc-drawer-actions', style: 'margin-top:12px' }, [el('button', { class: 'lb-btn lb-btn-primary', onClick: save }, 'Create redirect')]),
        el('p', { class: 'cc-sub', style: 'margin-top:10px' }, 'Loops (source = destination) and chains (destination is itself a redirect source) are rejected automatically.'),
      ]);
      openDrawer('New redirect', form, { subtitle: 'Redirect manager' });

      async function save() {
        const source = fields.source.value.trim(), destination = fields.destination.value.trim();
        if (!source || !destination) { alert('Source and destination are required.'); return; }
        try { await createRedirect({ source, destination, type: Number(typeSel.value), reason: fields.reason.value.trim() || null }); }
        catch (e) { alert(humanizeError(e)); return; }
        document.getElementById('cc-drawer-root')?.remove(); loadKpis(); loadRd();
      }
    }
  }
}

function deltaCell(pos, prev) {
  if (pos == null || prev == null) return el('span', { class: 'cc-sub' }, '—');
  const d = Number(prev) - Number(pos); // positive = improved (lower rank number)
  if (d === 0) return el('span', { class: 'cc-sub' }, '0');
  const up = d > 0;
  return el('span', { class: 'cc-delta ' + (up ? 'up' : 'down') }, (up ? '▲ ' : '▼ ') + Math.abs(d));
}

export default renderSeo;
