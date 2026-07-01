// formBuilder.js — Command Center: Form Builder (ct-waveBH, Directive §12.7).
// Staff define custom forms (fields, thank-you). Published forms render on a public
// hosted page (/forms/?f=key) and submit through the existing submit_web_form path, so
// every submission lands in the Forms Inbox with full attribution and converts to a CRM
// lead. Every submitted field is preserved. RBAC: content.manage / settings.manage.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, card, openDrawer, fmtDateTime } from '../../shared/ui/components.js';
import { listCustomForms, saveCustomForm } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';

const FIELD_TYPES = ['text', 'email', 'tel', 'textarea', 'select', 'checkbox'];

export function renderFormBuilder(host) {
  const manage = can('content.manage') || can('settings.manage');
  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('Form Builder', 'Build custom forms that go live on a public link. Submissions land in your Forms Inbox with full attribution (source, referrer, UTM) and convert to CRM leads — every field is preserved.',
      manage ? el('button', { class: 'lb-btn lb-btn-primary lb-btn-sm', onClick: () => editForm(null) }, '+ New form') : null),
    el('div', { id: 'fb-body' }, el('div', { class: 'lb-state lb-loading' }, 'Loading…')),
  ]));
  const body = host.querySelector('#fb-body');
  load();

  async function load() {
    showLoading(body, 'Loading forms…');
    let rows; try { rows = await listCustomForms(); } catch (e) { showError(body, humanizeError(e), load); return; }
    rows = rows || [];
    if (!rows.length) { mount(body, card(el('div', { class: 'cc-sub', style: 'padding:8px' }, 'No custom forms yet. Create your first with “New form”.'))); return; }
    mount(body, card(el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, ['Form', 'Key', 'Fields', 'Status', 'Public link', 'Updated', ''].map(h => el('th', null, h)))),
      el('tbody', null, rows.map(f => {
        const url = 'https://loadboot.com/forms/?f=' + f.form_key;
        return el('tr', null, [
          el('td', null, el('b', null, f.title)), el('td', null, el('code', null, f.form_key)),
          el('td', null, String((f.fields || []).length)),
          el('td', null, el('span', { class: 'cc-pill cc-pill-' + (f.status === 'published' ? 'green' : 'gray') }, f.status)),
          el('td', null, f.status === 'published' ? el('a', { href: url, target: '_blank', class: 'cc-sub' }, 'open ↗') : el('span', { class: 'cc-sub' }, '—')),
          el('td', null, fmtDateTime(f.updated_at)),
          el('td', null, manage ? el('button', { class: 'lb-btn lb-btn-sm ghost', onClick: () => editForm(f) }, 'Edit') : ''),
        ]);
      })),
    ])));
  }

  function editForm(f) {
    const key = el('input', { class: 'cc-input', placeholder: 'e.g. carrier-quote', value: f ? f.form_key : '' });
    if (f) key.disabled = true;
    const title = el('input', { class: 'cc-input', value: f ? f.title : '' });
    const desc = el('input', { class: 'cc-input', value: f ? (f.description || '') : '' });
    const thank = el('input', { class: 'cc-input', value: f ? (f.thank_you || '') : '', placeholder: 'Thanks! We’ll be in touch.' });
    let fields = f && f.fields ? JSON.parse(JSON.stringify(f.fields)) : [{ key: 'name', label: 'Your name', type: 'text', required: true }, { key: 'email', label: 'Email', type: 'email', required: true }];
    const fieldsHost = el('div');
    function renderFields() {
      mount(fieldsHost, fields.map((fld, i) => el('div', { class: 'lb-card', style: 'padding:10px;margin-bottom:8px' }, [
        el('div', { style: 'display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:end' }, [
          el('label', { class: 'cc-field' }, [el('span', null, 'Label'), textIn(fld, 'label')]),
          el('label', { class: 'cc-field' }, [el('span', null, 'Type'), typeSel(fld)]),
          el('button', { class: 'lb-btn lb-btn-sm ghost', onClick: () => { fields.splice(i, 1); renderFields(); } }, '✕'),
        ]),
        el('div', { style: 'display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;margin-top:6px' }, [
          el('label', { class: 'cc-field' }, [el('span', null, 'Field key'), textIn(fld, 'key')]),
          el('label', { style: 'display:flex;gap:6px;align-items:center;font-size:.85rem' }, [reqChk(fld), el('span', null, 'Required')]),
        ]),
        fld.type === 'select' ? el('label', { class: 'cc-field', style: 'margin-top:6px' }, [el('span', null, 'Options (comma-separated)'), optsIn(fld)]) : null,
      ])));
    }
    const textIn = (fld, k) => { const i = el('input', { class: 'cc-input', value: fld[k] || '' }); i.addEventListener('input', () => { fld[k] = i.value; }); return i; };
    const typeSel = (fld) => { const s = el('select', { class: 'cc-input' }, FIELD_TYPES.map(t => el('option', { value: t, selected: fld.type === t }, t))); s.addEventListener('change', () => { fld.type = s.value; renderFields(); }); return s; };
    const reqChk = (fld) => { const c = el('input', { type: 'checkbox' }); c.checked = !!fld.required; c.addEventListener('change', () => { fld.required = c.checked; }); return c; };
    const optsIn = (fld) => { const i = el('input', { class: 'cc-input', value: (fld.options || []).join(', ') }); i.addEventListener('input', () => { fld.options = i.value.split(',').map(x => x.trim()).filter(Boolean); }); return i; };
    renderFields();

    async function save(status) {
      if (!key.value.trim() || !title.value.trim()) { toast('Key and title are required.', 'error'); return; }
      fields.forEach(fl => { if (!fl.key) fl.key = (fl.label || 'field').toLowerCase().replace(/[^a-z0-9]+/g, '_'); });
      try {
        await saveCustomForm({ key: key.value.trim(), title: title.value.trim(), description: desc.value.trim() || null, fields, thankYou: thank.value.trim() || null, status });
        document.getElementById('cc-drawer-root')?.remove(); toast('Form ' + (status === 'published' ? 'published' : 'saved') + '.', 'success'); load();
      } catch (e) { toast(humanizeError(e), 'error'); }
    }
    const form = el('div', null, [
      el('label', { class: 'cc-field' }, [el('span', null, 'Form key (used in the URL)'), key]),
      el('label', { class: 'cc-field' }, [el('span', null, 'Title'), title]),
      el('label', { class: 'cc-field' }, [el('span', null, 'Description'), desc]),
      el('div', { style: 'font-weight:700;margin:12px 0 6px' }, 'Fields'),
      fieldsHost,
      el('button', { class: 'lb-btn lb-btn-sm', onClick: () => { fields.push({ key: '', label: 'New field', type: 'text', required: false }); renderFields(); } }, '+ Add field'),
      el('label', { class: 'cc-field', style: 'margin-top:12px' }, [el('span', null, 'Thank-you message'), thank]),
      el('div', { class: 'cc-drawer-actions', style: 'margin-top:14px;display:flex;gap:8px' }, [
        el('button', { class: 'lb-btn', onClick: () => save('draft') }, 'Save draft'),
        el('button', { class: 'lb-btn lb-btn-primary', onClick: () => save('published') }, 'Publish'),
      ]),
    ]);
    openDrawer(f ? 'Edit form' : 'New form', form, { subtitle: 'Submissions flow to your Forms Inbox → CRM' });
  }
}

export default renderFormBuilder;
