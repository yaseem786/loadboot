// pluginMarketplace.js — Command Center: Plugin Marketplace (ct-waveBH).
// A safe extension platform. Each plugin is a reviewed manifest (scopes, data
// accessed, outbound domains, required secrets). Install goes through an explicit
// permission-review drawer; installed plugins have a kill switch + uninstall; every
// action is audited. Plugins map to reviewed server-side integrations — no arbitrary
// code runs here. RBAC: staff view; settings.manage to install/enable/uninstall.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, statCard, card, openDrawer, fmtDateTime } from '../../shared/ui/components.js';
import { listPlugins, listInstalledPlugins, installPlugin, setPluginEnabled, uninstallPlugin } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';

export function renderPluginMarketplace(host) {
  const manage = can('settings.manage');
  let catalog = [], installed = [];
  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('Plugin Marketplace', 'Safely extend LoadBoot with reviewed integrations. Every plugin declares its scopes, data access and outbound domains up front; installs require permission review; installed plugins have a kill switch. No arbitrary code runs — plugins map to reviewed server-side integrations.'),
    el('div', { id: 'pm-kpis' }),
    el('div', { id: 'pm-installed', style: 'margin-bottom:18px' }),
    el('div', { id: 'pm-catalog' }, el('div', { class: 'lb-state lb-loading' }, 'Loading…')),
  ]));
  const kpiHost = host.querySelector('#pm-kpis');
  const instHost = host.querySelector('#pm-installed');
  const catHost = host.querySelector('#pm-catalog');
  load();

  async function load() {
    showLoading(catHost, 'Loading plugins…');
    try { [catalog, installed] = await Promise.all([listPlugins(), listInstalledPlugins().catch(() => [])]); }
    catch (e) { showError(catHost, humanizeError(e), load); return; }
    catalog = catalog || []; installed = installed || [];
    const byId = {}; installed.forEach(i => { byId[i.plugin_id] = i; });
    const active = installed.filter(i => i.enabled).length;
    mount(kpiHost, el('div', { class: 'cc-kpi-grid' }, [
      statCard({ icon: 'doc', label: 'Available', value: String(catalog.length), sub: 'in marketplace', accent: 'blue' }),
      statCard({ icon: 'check', label: 'Installed', value: String(installed.length), sub: active + ' enabled', accent: 'green' }),
      statCard({ icon: 'shield', label: 'Kill-switched', value: String(installed.length - active), sub: 'disabled', accent: (installed.length - active) ? 'amber' : 'gray' }),
    ]));

    // installed list
    if (installed.length) {
      mount(instHost, card(el('div', null, [
        el('div', { class: 'cc-sub', style: 'font-weight:700;margin-bottom:8px' }, 'Installed'),
        el('table', { class: 'cc-table' }, [
          el('thead', null, el('tr', null, ['Plugin', 'Category', 'Accepted permissions', 'Installed', 'Enabled', ''].map(h => el('th', null, h)))),
          el('tbody', null, installed.map(i => el('tr', null, [
            el('td', null, el('b', null, i.name)), el('td', null, i.category || '—'),
            el('td', null, el('span', { class: 'cc-sub' }, (i.accepted_permissions || []).join(', ') || '—')),
            el('td', null, fmtDateTime(i.installed_at)),
            el('td', null, manage ? el('button', { class: 'cc-toggle' + (i.enabled ? ' on' : ''), onClick: async (ev) => {
              ev.currentTarget.disabled = true;
              try { await setPluginEnabled(i.id, !i.enabled); load(); } catch (e) { ev.currentTarget.disabled = false; toast(humanizeError(e), 'error'); }
            } }, i.enabled ? 'On' : 'Off') : (i.enabled ? 'On' : 'Off')),
            el('td', null, manage ? el('button', { class: 'lb-btn lb-btn-sm ghost', onClick: async () => {
              if (!confirm('Uninstall ' + i.name + '? It stops immediately; config is retained for audit.')) return;
              try { await uninstallPlugin(i.id); toast('Plugin uninstalled.', 'success'); load(); } catch (e) { toast(humanizeError(e), 'error'); }
            } }, 'Uninstall') : ''),
          ]))),
        ]),
      ])));
    } else mount(instHost, el('div'));

    // catalog cards
    mount(catHost, el('div', null, [
      el('div', { class: 'cc-sub', style: 'font-weight:700;margin:4px 2px 10px' }, 'Marketplace'),
      el('div', { class: 'pm-grid', style: 'display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px' },
        catalog.map(p => {
          const inst = byId[p.id];
          return el('div', { class: 'lb-card' }, [
            el('div', { style: 'display:flex;justify-content:space-between;align-items:start;gap:8px' }, [
              el('div', null, [el('b', null, p.name), el('div', { class: 'cc-sub' }, (p.category || '') + ' · ' + p.publisher)]),
              inst ? el('span', { class: 'cc-pill cc-pill-green' }, 'installed') : el('span', { class: 'cc-pill cc-pill-gray' }, 'available'),
            ]),
            el('p', { class: 'cc-sub', style: 'margin:8px 0' }, p.description || ''),
            el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px' },
              (p.outbound_domains || []).length ? (p.outbound_domains || []).map(d => el('span', { class: 'cc-pill cc-pill-blue', style: 'font-size:.7rem' }, d)) : [el('span', { class: 'cc-sub', style: 'font-size:.72rem' }, 'no outbound calls')]),
            manage && !inst ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: () => reviewInstall(p) }, 'Review & install')
              : (inst ? el('span', { class: 'cc-sub' }, 'Installed' + (inst.enabled ? '' : ' (disabled)')) : el('span', { class: 'cc-sub' }, 'settings.manage required')),
          ]);
        })),
    ]));
  }

  function reviewInstall(p) {
    const list = (title, arr, empty) => el('div', { style: 'margin-bottom:10px' }, [
      el('div', { style: 'font-weight:700;font-size:.82rem;margin-bottom:3px' }, title),
      (arr && arr.length) ? el('ul', { style: 'margin:0;padding-left:18px;font-size:.84rem;color:#334155' }, arr.map(x => el('li', null, x)))
        : el('div', { class: 'cc-sub', style: 'font-size:.82rem' }, empty),
    ]);
    const form = el('div', null, [
      el('p', { class: 'cc-sub' }, 'Review exactly what this plugin can do before installing. Installing records your acceptance of these permissions in the audit log.'),
      list('Permissions granted', p.permissions, 'none'),
      list('Data accessed', p.data_accessed, 'none'),
      list('Scopes', p.scopes, 'none'),
      list('Outbound domains', p.outbound_domains, 'no outbound network calls'),
      list('Secrets required (you set these in Supabase)', p.secrets_required, 'none'),
      (p.secrets_required && p.secrets_required.length) ? el('p', { class: 'cc-sub', style: 'color:#b45309' }, '⚠ This plugin needs the secret(s) above set in Supabase → Edge Functions → Secrets to actually run.') : null,
      el('div', { class: 'cc-drawer-actions', style: 'margin-top:12px' }, [el('button', { class: 'lb-btn lb-btn-primary', onClick: async () => {
        try { await installPlugin(p.id); } catch (e) { toast(humanizeError(e), 'error'); return; }
        document.getElementById('cc-drawer-root')?.remove(); toast(p.name + ' installed.', 'success'); load();
      } }, 'Accept & install')]),
    ]);
    openDrawer('Install ' + p.name, form, { subtitle: p.publisher + ' · v' + (p.version || '1.0.0') });
  }
}

export default renderPluginMarketplace;
