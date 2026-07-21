// emailBuilder.js — Command Center: Visual Email Builder (ct-waveBH, Directive §12.3).
// Block-based composer (heading, text, button, image, divider, spacer) → generates
// responsive, brand-kit-styled email HTML and saves it into the existing Template Studio
// (studioSaveTemplate), so campaigns can send it. Live preview, add/remove/reorder,
// dynamic variables ({{first_name}} etc.). RBAC: content.manage / settings.manage.
import { el, mount } from '../../shared/ui/dom.js';
import { sectionHead, card } from '../../shared/ui/components.js';
import { getBrandKit, studioSaveTemplate } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';

const BLOCKS = ['heading', 'text', 'button', 'image', 'divider', 'spacer'];
const esc = (s) => (s == null ? '' : String(s)).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function renderEmailBuilder(host) {
  const manage = can('content.manage') || can('settings.manage');
  let brand = { primary_color: '#0883F7', accent_color: '#FC5305', ink_color: '#10223B', font_body: 'Inter', company_name: 'LoadBoot', email_footer: '', legal_footer: '' };
  let blocks = [
    { type: 'heading', text: 'Hello {{first_name}},' },
    { type: 'text', text: 'Here’s an update from LoadBoot.' },
    { type: 'button', label: 'View in portal', url: 'https://loadboot.com/app/carrier/' },
  ];
  const key = el('input', { class: 'cc-input', placeholder: 'template-key (e.g. weekly-update)' });
  const name = el('input', { class: 'cc-input', placeholder: 'Template name' });
  const subject = el('input', { class: 'cc-input', placeholder: 'Email subject' });
  const listHost = el('div');
  const preview = el('div');

  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('Visual Email Builder', 'Compose brand-styled emails from blocks — no HTML needed. Saves into your Template Studio so campaigns can send it. Use {{first_name}}, {{company_name}}, {{carrier_name}} and other allowed variables.'),
    el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;align-items:start' }, [
      card(el('div', null, [
        el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-bottom:12px' }, [
          el('label', { class: 'cc-field' }, [el('span', null, 'Template key'), key]),
          el('label', { class: 'cc-field' }, [el('span', null, 'Name'), name]),
        ]),
        el('label', { class: 'cc-field' }, [el('span', null, 'Subject'), subject]),
        el('div', { style: 'font-weight:700;margin:12px 0 6px' }, 'Blocks'),
        listHost,
        el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:8px' },
          BLOCKS.map(b => el('button', { class: 'lb-btn lb-btn-sm', onClick: () => { blocks.push(defaultBlock(b)); render(); } }, '+ ' + b))),
        el('div', { style: 'margin-top:14px;display:flex;gap:8px' }, manage ? [
          el('button', { class: 'lb-btn', onClick: () => save('draft') }, 'Save draft'),
          el('button', { class: 'lb-btn lb-btn-primary', onClick: () => save('published') }, 'Publish to Template Studio'),
        ] : [el('div', { class: 'cc-sub' }, 'content.manage required to save.')]),
      ])),
      card(el('div', null, [el('div', { class: 'cc-sub', style: 'font-weight:700;margin-bottom:8px' }, 'Live preview'), preview])),
    ]),
  ]));

  (async () => { try { const b = await getBrandKit(); brand = Object.assign(brand, b || {}); } catch (_) {} render(); })();

  function defaultBlock(t) {
    if (t === 'heading') return { type: t, text: 'New heading' };
    if (t === 'text') return { type: t, text: 'New paragraph of text.' };
    if (t === 'button') return { type: t, label: 'Click here', url: 'https://loadboot.com' };
    if (t === 'image') return { type: t, url: '' };
    return { type: t };
  }

  function render() {
    mount(listHost, blocks.map((b, i) => el('div', { class: 'lb-card', style: 'padding:10px;margin-bottom:8px' }, [
      el('div', { style: 'display:flex;justify-content:space-between;align-items:center;margin-bottom:6px' }, [
        el('b', { style: 'text-transform:capitalize;font-size:.82rem' }, b.type),
        el('div', { style: 'display:flex;gap:4px' }, [
          el('button', { class: 'lb-btn lb-btn-sm ghost', disabled: i === 0, onClick: () => { const t = blocks[i - 1]; blocks[i - 1] = blocks[i]; blocks[i] = t; render(); } }, '↑'),
          el('button', { class: 'lb-btn lb-btn-sm ghost', disabled: i === blocks.length - 1, onClick: () => { const t = blocks[i + 1]; blocks[i + 1] = blocks[i]; blocks[i] = t; render(); } }, '↓'),
          el('button', { class: 'lb-btn lb-btn-sm ghost', onClick: () => { blocks.splice(i, 1); render(); } }, '✕'),
        ]),
      ]),
      blockEditor(b),
    ])));
    renderPreview();
  }

  function blockEditor(b) {
    const inp = (k, ph) => { const i = el('input', { class: 'cc-input', value: b[k] || '', placeholder: ph || '' }); i.addEventListener('input', () => { b[k] = i.value; renderPreview(); }); return i; };
    if (b.type === 'heading' || b.type === 'text') { const ta = el('textarea', { class: 'cc-input', rows: b.type === 'text' ? '3' : '1' }); ta.value = b.text || ''; ta.addEventListener('input', () => { b.text = ta.value; renderPreview(); }); return ta; }
    if (b.type === 'button') return el('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px' }, [inp('label', 'Button text'), inp('url', 'https://…')]);
    if (b.type === 'image') return inp('url', 'Image URL');
    return el('div', { class: 'cc-sub', style: 'font-size:.8rem' }, b.type === 'divider' ? 'A horizontal divider.' : 'Vertical spacing.');
  }

  function buildHtml() {
    const body = blocks.map(b => {
      if (b.type === 'heading') return '<h1 style="font-family:' + brand.font_body + ',sans-serif;color:' + brand.ink_color + ';font-size:22px;margin:0 0 12px">' + esc(b.text) + '</h1>';
      if (b.type === 'text') return '<p style="font-family:' + brand.font_body + ',sans-serif;color:' + brand.ink_color + ';font-size:15px;line-height:1.6;margin:0 0 14px">' + esc(b.text).replace(/\n/g, '<br>') + '</p>';
      if (b.type === 'button') return '<div style="margin:0 0 16px"><a href="' + esc(b.url) + '" style="display:inline-block;background:' + brand.accent_color + ';color:#fff;text-decoration:none;font-weight:700;padding:11px 20px;border-radius:8px;font-family:' + brand.font_body + ',sans-serif">' + esc(b.label) + '</a></div>';
      if (b.type === 'image') return b.url ? '<img src="' + esc(b.url) + '" style="max-width:100%;border-radius:8px;margin:0 0 14px" alt="">' : '';
      if (b.type === 'divider') return '<hr style="border:0;border-top:1px solid #e2e8f0;margin:18px 0">';
      if (b.type === 'spacer') return '<div style="height:24px"></div>';
      return '';
    }).join('');
    const footer = '<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;font-family:' + brand.font_body + ',sans-serif;font-size:12px;color:#94a3b8">' + esc(brand.email_footer || '') + '<br>' + esc(brand.legal_footer || '') + '<br><a href="{{action_url}}" style="color:#94a3b8">Unsubscribe</a></div>';
    return '<div style="max-width:600px;margin:0 auto;padding:24px;background:#fff">' +
      '<div style="font-family:Manrope,' + brand.font_body + ',sans-serif;font-weight:800;color:' + brand.primary_color + ';font-size:20px;margin-bottom:18px">' + esc(brand.company_name) + '</div>' +
      body + footer + '</div>';
  }

  function renderPreview() {
    mount(preview, el('div', { style: 'border:1px solid #e2e8f0;border-radius:12px;background:#f8fafc;padding:8px' },
      el('div', { html: buildHtml() })));
  }

  async function save(status) {
    if (!key.value.trim() || !name.value.trim() || !subject.value.trim()) { toast('Key, name and subject are required.', 'error'); return; }
    if (!/^[a-z0-9_-]+$/.test(key.value.trim())) { toast('Key must be lowercase letters, numbers, - or _.', 'error'); return; }
    try {
      await studioSaveTemplate({ key: key.value.trim(), name: name.value.trim(), category: 'marketing', channels: ['email'], subject: subject.value.trim(), preview: subject.value.trim(), bodyHtml: buildHtml(), bodyText: blocks.filter(b => b.text).map(b => b.text).join('\n\n'), status });
      toast('Template ' + (status === 'published' ? 'published' : 'saved') + ' to Template Studio.', 'success');
    } catch (e) { toast(humanizeError(e), 'error'); }
  }
}

export default renderEmailBuilder;
