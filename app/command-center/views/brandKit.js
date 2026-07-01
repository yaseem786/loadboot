// brandKit.js — Command Center: Marketing Brand Kit (ct-waveBH).
// One reusable brand identity (logo, colors, fonts, footers, social links) that the
// Template Studio, campaigns, portal banners and landing pages draw from. Live preview.
// RBAC: any staff may view; content.manage / settings.manage may edit (server-enforced).
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, card } from '../../shared/ui/components.js';
import { getBrandKit, setBrandKit } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';

export function renderBrandKit(host) {
  const manage = can('content.manage') || can('settings.manage');
  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('Brand Kit', 'Your single source of brand identity — logo, colors, fonts, footers and social links. The Template Studio, campaigns, portal banners and landing pages all draw from this.'),
    el('div', { id: 'bk-body' }, el('div', { class: 'lb-state lb-loading' }, 'Loading…')),
  ]));
  const body = host.querySelector('#bk-body');
  load();

  async function load() {
    showLoading(body, 'Loading brand kit…');
    let d; try { d = await getBrandKit(); } catch (e) { showError(body, humanizeError(e), load); return; }
    d = d || {};
    const f = {};
    const field = (key, label, type) => {
      const i = el('input', { class: 'cc-input', type: type || 'text', value: d[key] || '' });
      if (type === 'color') i.value = d[key] || '#000000';
      i.addEventListener('input', () => sync());
      f[key] = i; return el('label', { class: 'cc-field' }, [el('span', null, label), i]);
    };
    const preview = el('div');
    function vals() { const o = {}; Object.keys(f).forEach(k => o[k] = f[k].value); return o; }
    function sync() {
      const v = vals();
      mount(preview, el('div', { style: 'border:1px solid var(--cc-border,#e2e8f0);border-radius:14px;overflow:hidden' }, [
        el('div', { style: 'background:' + (v.primary_color || '#2563EB') + ';padding:18px 20px;color:#fff;font-family:' + (v.font_heading || 'Manrope') + ',sans-serif' }, [
          el('div', { style: 'font-size:1.3rem;font-weight:800' }, v.company_name || 'LoadBoot'),
          el('div', { style: 'opacity:.9;font-size:.9rem' }, v.tagline || ''),
        ]),
        el('div', { style: 'padding:16px 20px;font-family:' + (v.font_body || 'Inter') + ',sans-serif;color:' + (v.ink_color || '#0F172A') }, [
          el('p', { style: 'margin:0 0 12px' }, 'This is how your brand looks in emails and portal banners.'),
          el('a', { style: 'display:inline-block;background:' + (v.accent_color || '#F97316') + ';color:#fff;padding:9px 16px;border-radius:9px;text-decoration:none;font-weight:700' }, 'Primary action'),
          el('div', { style: 'margin-top:16px;font-size:.78rem;color:#64748b' }, v.email_footer || ''),
          el('div', { style: 'font-size:.72rem;color:#94a3b8' }, v.legal_footer || ''),
          el('div', { style: 'margin-top:8px;font-size:.72rem;color:#94a3b8' }, [v.facebook_url, v.instagram_url, v.linkedin_url, v.x_url].filter(Boolean).length ? 'Social: ' + [v.facebook_url && 'Facebook', v.instagram_url && 'Instagram', v.linkedin_url && 'LinkedIn', v.x_url && 'X'].filter(Boolean).join(' · ') : ''),
        ]),
      ]));
    }
    const grid = el('div', { class: 'cc-form-2col', style: 'display:grid;grid-template-columns:1fr 1fr;gap:12px' }, [
      field('company_name', 'Company name'), field('tagline', 'Tagline'),
      field('primary_color', 'Primary color', 'color'), field('accent_color', 'Accent color', 'color'),
      field('ink_color', 'Text color', 'color'), field('font_heading', 'Heading font'),
      field('font_body', 'Body font'), field('website_url', 'Website URL'),
      field('support_email', 'Support email', 'email'), field('logo_url', 'Logo URL'),
      field('facebook_url', 'Facebook URL'), field('instagram_url', 'Instagram URL'),
      field('linkedin_url', 'LinkedIn URL'), field('x_url', 'X / Twitter URL'),
    ]);
    const footers = el('div', null, [field('email_footer', 'Email footer'), field('legal_footer', 'Legal footer')]);
    const saveBtn = el('button', { class: 'lb-btn lb-btn-primary', disabled: !manage, onClick: async () => {
      saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
      try { await setBrandKit(vals()); toast('Brand kit saved. Templates & campaigns now use it.', 'success'); }
      catch (e) { toast(humanizeError(e), 'error'); }
      saveBtn.disabled = false; saveBtn.textContent = 'Save brand kit';
    } }, 'Save brand kit');
    if (!manage) Object.values(f).forEach(i => i.disabled = true);
    sync();
    mount(body, el('div', { style: 'display:grid;grid-template-columns:minmax(0,1fr) minmax(0,420px);gap:16px;align-items:start' }, [
      card(el('div', null, [grid, footers, el('div', { style: 'margin-top:14px' }, manage ? saveBtn : el('div', { class: 'cc-sub' }, 'Read-only — content.manage required to edit.'))])),
      card(el('div', null, [el('div', { class: 'cc-sub', style: 'font-weight:700;margin-bottom:10px' }, 'Live preview'), preview])),
    ]));
  }
}

export default renderBrandKit;
