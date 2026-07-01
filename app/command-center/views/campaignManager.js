// campaignManager.js — Campaign Manager (Phase 3C). Compose a campaign from a saved
// audience + template + channels, schedule it, and send. Push channel sends for real
// via the existing staff-gated push-send (reusing the broadcast pipeline); email/SMS
// route through the delivery engine (Phase 3D). A broad send always confirms the
// recipient count first.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, statCard, openDrawer, fmtDateTime } from '../../shared/ui/components.js';
import { cmpList, cmpSave, cmpSetStatus, cmpMarkSent, listAudiences, studioListTemplates, audienceEstimate, sendPush, campaignAudiencePreview, campaignEnqueue, campaignAnalytics, campaignApprove, campaignAttribution, campaignVariants, campaignSetVariant, campaignDeleteVariant, campaignVariantAnalytics } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';

const ST_TONE = { draft: 'gray', scheduled: 'blue', sending: 'amber', sent: 'green', paused: 'amber' };
const CHANNELS = ['push', 'email', 'sms', 'portal'];
const CARRIER_AUD = ['all_carriers', 'active_carriers', 'pending_carriers', 'onboarding_pending', 'carrier_owners', 'drivers'];

export function renderCampaignManager(host) {
  const manage = can('campaigns.view') || can('content.manage') || can('settings.manage');
  let audiences = [], templates = [];
  const kpis = el('div', { class: 'cc-kpi-grid' });
  const body = el('div', { class: 'cc-table-wrap' });
  mount(host, el('div', null, [
    sectionHead('Campaigns', 'Compose, schedule and send to a saved audience. Push sends for real; email/SMS route through the delivery engine.',
      manage ? el('div', { class: 'cc-head-actions' }, el('button', { class: 'lb-btn lb-btn-primary lb-btn-sm', onClick: () => composer(null) }, '+ New campaign')) : null),
    kpis, body,
  ]));
  load();

  async function load() {
    showLoading(body, 'Loading campaigns…');
    let rows;
    try { [rows, audiences, templates] = await Promise.all([cmpList(), listAudiences().catch(() => []), studioListTemplates().catch(() => [])]); }
    catch (e) { showError(body, humanizeError(e), load); return; }
    rows = rows || [];
    mount(kpis, [
      statCard({ icon: 'trend', label: 'Campaigns', value: String(rows.length), sub: 'all time', accent: 'blue' }),
      statCard({ icon: 'bell', label: 'Scheduled', value: String(rows.filter(r => r.status === 'scheduled').length), sub: 'queued', accent: 'amber' }),
      statCard({ icon: 'check', label: 'Sent', value: String(rows.filter(r => r.status === 'sent').length), sub: rows.reduce((a, r) => a + (r.sent_count || 0), 0) + ' delivered', accent: 'green' }),
    ]);
    if (!rows.length) { mount(body, el('div', { class: 'lb-state' }, 'No campaigns yet. Create your first one.')); return; }
    mount(body, el('table', { class: 'cc-table' }, [
      el('thead', null, el('tr', null, ['Campaign', 'Audience', 'Channels', 'Status', 'Schedule / sent', ''].map(h => el('th', null, h)))),
      el('tbody', null, rows.map(c => el('tr', { class: 'cc-row' }, [
        el('td', null, [el('b', null, c.name), c.objective ? el('div', { class: 'cc-sub' }, c.objective) : '']),
        el('td', null, c.audience_name || '—'),
        el('td', null, (c.channels || []).join(', ')),
        el('td', null, [
          el('span', { class: 'cc-pill cc-pill-' + (ST_TONE[c.status] || 'gray') }, c.status),
          c.approved_by ? el('span', { class: 'cc-pill cc-pill-green', style: 'margin-left:6px', title: 'Approved ' + (c.approved_at ? fmtDateTime(c.approved_at) : '') }, '✓ approved')
                        : el('span', { class: 'cc-pill cc-pill-amber', style: 'margin-left:6px' }, 'needs approval'),
        ]),
        el('td', null, el('span', { class: 'cc-sub' }, c.sent_at ? 'sent ' + fmtDateTime(c.sent_at) + ' · ' + (c.sent_count || 0) : (c.scheduled_at ? 'for ' + fmtDateTime(c.scheduled_at) : '—'))),
        el('td', null, manage ? rowActions(c) : ''),
      ]))),
    ]));
  }

  function rowActions(c) {
    const wrap = el('div', { style: 'display:flex;gap:6px;justify-content:flex-end' });
    wrap.append(el('button', { class: 'lb-btn lb-btn-sm', onClick: (e) => { e.stopPropagation(); composer(c); } }, 'Edit'));
    wrap.append(el('button', { class: 'lb-btn lb-btn-sm', onClick: (e) => { e.stopPropagation(); duplicate(c); } }, 'Duplicate'));
    if (c.status !== 'sent' && (c.channels || []).includes('push')) wrap.append(el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: (e) => { e.stopPropagation(); sendPushCampaign(c); } }, 'Send push'));
    if ((c.channels || []).includes('email')) wrap.append(el('button', { class: 'lb-btn lb-btn-sm lb-btn-primary', onClick: (e) => { e.stopPropagation(); sendEmailCampaign(c); } }, 'Send email'));
    if (!c.approved_by) wrap.append(el('button', { class: 'lb-btn lb-btn-sm', onClick: (e) => { e.stopPropagation(); approve(c, true); } }, 'Approve'));
    else wrap.append(el('button', { class: 'lb-btn lb-btn-sm ghost', onClick: (e) => { e.stopPropagation(); approve(c, false); } }, 'Revoke approval'));
    wrap.append(el('button', { class: 'lb-btn lb-btn-sm', onClick: (e) => { e.stopPropagation(); manageVariants(c); } }, 'A/B'));
    wrap.append(el('button', { class: 'lb-btn lb-btn-sm', onClick: (e) => { e.stopPropagation(); showStats(c); } }, 'Stats'));
    return wrap;
  }

  // A/B variants manager. Adding/editing variants clears approval server-side (re-approval required).
  async function manageVariants(c) {
    const list = el('div', { class: 'cc-sub' }, 'Loading…');
    const form = () => {
      const label = el('input', { class: 'cc-input', placeholder: 'Label (e.g. A)' });
      const subject = el('input', { class: 'cc-input', placeholder: 'Variant subject (blank = campaign default)' });
      const bodyH = el('textarea', { class: 'cc-input', rows: '3', placeholder: 'Variant HTML body (blank = default)' });
      const weight = el('input', { class: 'cc-input', type: 'number', value: '1', min: '1', max: '100', style: 'max-width:90px' });
      const add = el('button', { class: 'lb-btn lb-btn-primary lb-btn-sm', onClick: async () => {
        if (!label.value.trim()) { toast('Label required', 'error'); return; }
        try { await campaignSetVariant(c.id, { label: label.value.trim(), subject: subject.value || null, bodyHtml: bodyH.value || null, weight: Number(weight.value) || 1 }); toast('Variant saved (approval reset)', 'success'); refresh(); }
        catch (e) { toast(humanizeError(e), 'error'); }
      } }, 'Save variant');
      return el('div', { class: 'lb-card', style: 'margin-top:10px' }, [
        el('div', { class: 'cc-sub' }, 'Add / update a variant'),
        el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:6px' }, [label, weight]),
        subject, bodyH, add,
      ]);
    };
    async function refresh() {
      let rows; try { rows = await campaignVariants(c.id); } catch (e) { mount(list, el('div', { class: 'cc-sub', style: 'color:#dc2626' }, humanizeError(e))); return; }
      rows = rows || [];
      mount(list, rows.length ? el('table', { class: 'cc-table' }, [
        el('thead', null, el('tr', null, ['Label', 'Weight', 'Subject', ''].map(h => el('th', null, h)))),
        el('tbody', null, rows.map(v => el('tr', null, [
          el('td', null, el('b', null, v.label)), el('td', null, String(v.weight)),
          el('td', null, el('span', { class: 'cc-sub' }, v.subject || '(default)')),
          el('td', null, el('button', { class: 'lb-btn lb-btn-sm ghost', onClick: async () => { try { await campaignDeleteVariant(v.id); toast('Variant removed', 'success'); refresh(); } catch (e) { toast(humanizeError(e), 'error'); } } }, 'Remove')),
        ]))),
      ]) : el('div', { class: 'lb-state' }, 'No variants — this campaign sends a single version. Add two to A/B test.'));
    }
    openDrawer('A/B variants', el('div', null, [
      el('div', { style: 'font-weight:700' }, c.name),
      el('p', { class: 'cc-sub' }, 'Recipients are split deterministically by a stable hash, weighted. Each variant may override the subject/body; blank fields fall back to the campaign default.'),
      list, form(),
    ]), { subtitle: 'Content variants + weighted split' });
    refresh();
  }

  // Maker-checker approval. The server refuses if the approver created the campaign (separation of duties).
  async function approve(c, on) {
    try { await campaignApprove(c.id, on); toast(on ? 'Campaign approved for send' : 'Approval revoked', 'success'); load(); }
    catch (e) { toast(humanizeError(e), 'error'); }
  }

  // Delivery analytics for a campaign, read straight off the unified ledger.
  async function showStats(c) {
    const box = el('div', { class: 'cc-sub' }, 'Loading analytics…');
    openDrawer('Campaign analytics', el('div', null, [el('div', { style: 'font-weight:700;margin-bottom:8px' }, c.name), box]), { subtitle: 'Delivery outcomes' });
    let a; try { a = await campaignAnalytics(c.id); } catch (e) { mount(box, el('div', { class: 'cc-sub', style: 'color:#dc2626' }, humanizeError(e))); return; }
    if (!a || !a.total) { mount(box, el('div', { class: 'lb-state' }, 'No deliveries for this campaign yet — queue an email send first.')); return; }
    const stat = (label, val, sub) => el('div', { class: 'lb-card', style: 'flex:1;min-width:120px' }, [
      el('div', { class: 'cc-sub' }, label), el('div', { style: 'font-size:22px;font-weight:800' }, String(val)), sub ? el('div', { class: 'cc-sub' }, sub) : null,
    ].filter(Boolean));
    mount(box, el('div', null, [
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, [
        stat('Recipients', a.total, a.pending + ' pending'),
        stat('Delivered', a.delivered, a.delivery_rate + '% of sent'),
        stat('Opened', a.opened, a.open_rate + '% open'),
        stat('Clicked', a.clicked, a.click_rate + '% CTR'),
      ]),
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px' }, [
        stat('Bounced / complained', a.bounced, a.bounce_rate + '% bounce'),
        stat('Failed', a.failed, 'retrying'),
        stat('Dead letter', a.dead_letter, 'gave up'),
        stat('Sent', a.sent, 'reached provider'),
      ]),
    ]));
    // Attribution — web conversions tied to this campaign's UTM tag.
    const attrBox = el('div', { style: 'margin-top:12px' }, el('div', { class: 'cc-sub' }, 'Loading attribution…'));
    box.append(attrBox);
    try {
      const at = await campaignAttribution(c.id);
      const forms = Object.entries(at.by_form || {}).map(([k, v]) => k + ' (' + v + ')').join(', ') || 'none';
      mount(attrBox, el('div', { class: 'lb-card', style: 'background:#f8fafc' }, [
        el('div', { class: 'cc-sub' }, 'Attribution (UTM: ' + (at.utm_campaign || '—') + ')'),
        el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:6px' }, [
          stat('Web submissions', at.attributed_submissions, at.conversion_rate + '% of delivered'),
          stat('Leads created', at.attributed_leads, 'from this campaign'),
        ]),
        el('div', { class: 'cc-sub', style: 'margin-top:6px' }, 'By form: ' + forms),
      ]));
    } catch (e) { mount(attrBox, el('div', { class: 'cc-sub', style: 'color:#dc2626' }, humanizeError(e))); }
    // A/B variant breakdown (only shown when the campaign has variants).
    try {
      const va = await campaignVariantAnalytics(c.id);
      const rows = (va.variants || []).filter(v => v.variant && v.variant !== '(none)');
      if (rows.length) {
        const vbox = el('div', { style: 'margin-top:12px' });
        box.append(vbox);
        mount(vbox, el('div', { class: 'lb-card', style: 'background:#f8fafc' }, [
          el('div', { class: 'cc-sub' }, 'A/B variants' + (va.winner ? ' · winner: ' + va.winner : '')),
          el('table', { class: 'cc-table', style: 'margin-top:6px' }, [
            el('thead', null, el('tr', null, ['Variant', 'Recipients', 'Delivered', 'Opened', 'Bounced'].map(h => el('th', null, h)))),
            el('tbody', null, rows.map(v => el('tr', null, [
              el('td', null, el('b', null, v.variant + (v.variant === va.winner ? ' ★' : ''))),
              el('td', null, String(v.recipients)), el('td', null, String(v.delivered)),
              el('td', null, String(v.opened)), el('td', null, String(v.bounced)),
            ]))),
          ]),
        ]));
      }
    } catch (_) { /* no variants or not permitted — skip */ }
  }

  // Email send: preview → CONFIRM the exact recipient count → enqueue into the delivery engine.
  // The server refuses the enqueue unless the confirmed count still matches, so no broad send can
  // fire on a stale number. Enqueue only queues the messages; a provider worker transmits them.
  async function sendEmailCampaign(c) {
    if (!c.audience_type) { toast('Attach an audience with email addresses first.', 'error'); return; }
    const status = el('div', { class: 'cc-sub' }, 'Loading recipient preview…');
    const detail = el('div', { style: 'margin-top:10px' });
    const confirmBtn = el('button', { class: 'lb-btn lb-btn-primary', disabled: 'disabled', onClick: doEnqueue }, 'Confirm & queue send');
    const body = el('div', null, [
      el('div', { style: 'font-weight:700' }, c.name),
      c.subject ? el('div', { class: 'cc-sub' }, 'Subject: ' + c.subject) : null,
      detail, status,
      el('div', { class: 'cc-drawer-actions', style: 'margin-top:14px;display:flex;gap:8px' }, [confirmBtn]),
      el('p', { class: 'cc-sub', style: 'margin-top:8px' }, 'Only opted-in, non-suppressed unique email addresses are queued. Re-preview if the count changes. Nothing is transmitted until a provider worker claims the queue.'),
    ].filter(Boolean));
    openDrawer('Send email campaign', body, { subtitle: 'Consent-checked · confirm-before-send' });
    let finalCount = null;
    if (!c.approved_by) {
      mount(status, el('div', { class: 'cc-sub', style: 'color:#b45309' }, 'This campaign must be approved before it can be sent. Use “Approve” on the campaign row (a different person than the creator).'));
      mount(detail, '');
      return;
    }
    try {
      const p = await campaignAudiencePreview(c.id);
      finalCount = p.final_recipients;
      mount(detail, el('div', { class: 'lb-card', style: 'background:#f8fafc' }, [
        row('Audience total', p.audience_total),
        row('After consent', p.after_consent, p.excluded_no_consent ? ('−' + p.excluded_no_consent + ' no consent') : ''),
        row('Suppressed (bounced/opt-out)', p.suppressed),
        row('Final recipients', p.final_recipients, '', true),
        (p.sample && p.sample.length) ? el('div', { class: 'cc-sub', style: 'margin-top:6px' }, 'Sample: ' + p.sample.join(', ')) : null,
      ].filter(Boolean)));
      if (finalCount > 0) { confirmBtn.removeAttribute('disabled'); confirmBtn.textContent = 'Confirm & queue ' + finalCount + ' email' + (finalCount === 1 ? '' : 's'); mount(status, ''); }
      else mount(status, el('div', { class: 'cc-sub', style: 'color:#b45309' }, 'No eligible recipients — nothing to send.'));
    } catch (e) { mount(status, el('div', { class: 'cc-sub', style: 'color:#dc2626' }, humanizeError(e))); }
    function row(label, val, extra, strong) {
      return el('div', { style: 'display:flex;justify-content:space-between;padding:3px 0' }, [
        el('span', { class: 'cc-sub' }, label),
        el('span', { style: strong ? 'font-weight:800' : 'font-weight:600' }, String(val) + (extra ? '  (' + extra + ')' : '')),
      ]);
    }
    async function doEnqueue() {
      if (finalCount == null || finalCount <= 0) return;
      confirmBtn.setAttribute('disabled', 'disabled'); confirmBtn.textContent = 'Queuing…';
      try {
        const r = await campaignEnqueue(c.id, finalCount);
        toast('Queued ' + r.newly_queued + ' of ' + r.final_recipients + ' — status: ' + r.status, 'success');
        document.getElementById('cc-drawer-root')?.remove(); load();
      } catch (e) { confirmBtn.removeAttribute('disabled'); confirmBtn.textContent = 'Confirm & queue send'; toast(humanizeError(e), 'error'); }
    }
  }

  // Open the composer pre-filled from an existing campaign as a NEW draft (no id, name + " (copy)").
  function duplicate(c) {
    composer({ id: null, name: (c.name || 'Campaign') + ' (copy)', objective: c.objective, audience_id: c.audience_id,
      audience_name: c.audience_name, audience_type: c.audience_type, template_key: c.template_key,
      channels: (c.channels || ['push']).slice(), subject: c.subject, body: c.body, scheduled_at: null, status: 'draft' });
  }

  async function sendPushCampaign(c) {
    if (!c.audience_type) { toast('Attach an audience first.', 'error'); return; }
    const pushAud = CARRIER_AUD.includes(c.audience_type) ? 'all_carriers' : (c.audience_type === 'all_staff' ? 'all_staff' : null);
    if (!pushAud) { toast('Push is only available for carrier or staff audiences.', 'error'); return; }
    let est = '?'; try { est = (await audienceEstimate(c.audience_type)).count; } catch (_) {}
    if (!confirm('Send push to “' + (c.audience_name || c.audience_type) + '” (~' + est + ' recipients with notifications on)?\n\nTitle: ' + (c.subject || c.name))) return;
    try {
      const r = await sendPush({ audience: pushAud, title: c.subject || c.name, body: c.body || '', url: '/app/carrier/' });
      await cmpMarkSent(c.id, (r && r.sent) || 0);
      toast('Push delivered to ' + ((r && r.sent) || 0) + ' device(s).', 'success'); load();
    } catch (e) { toast(humanizeError(e), 'error'); }
  }

  function composer(c) {
    const f = { id: c ? c.id : null, name: c ? c.name : '', objective: c ? (c.objective || '') : '', audienceId: c ? c.audience_id : '', templateKey: c ? (c.template_key || '') : '', channels: c ? (c.channels || ['push']) : ['push'], subject: c ? (c.subject || '') : '', body: c ? (c.body || '') : '', scheduledAt: c && c.scheduled_at ? c.scheduled_at.slice(0, 16) : '', status: c ? (c.status || 'draft') : 'draft' };
    const inp = (label, key, ph) => { const i = el('input', { class: 'cc-input', placeholder: ph || '', value: f[key] }); i.oninput = () => { f[key] = i.value; }; return el('label', { class: 'cc-field' }, [el('span', null, label), i]); };
    const audSel = el('select', { class: 'cc-input' }, [el('option', { value: '' }, 'Select audience…')].concat(audiences.map(a => el('option', { value: a.id, selected: f.audienceId === a.id ? 'selected' : null }, a.name)))); audSel.onchange = () => { f.audienceId = audSel.value; };
    const tplSel = el('select', { class: 'cc-input' }, [el('option', { value: '' }, 'No template')].concat(templates.map(t => el('option', { value: t.key, selected: f.templateKey === t.key ? 'selected' : null }, t.name || t.key)))); tplSel.onchange = () => { f.templateKey = tplSel.value; const t = templates.find(x => x.key === tplSel.value); if (t) { if (!f.subject) { f.subject = t.subject || ''; subj.value = f.subject; } if (!f.body) { f.body = t.body_text || t.body || ''; bodyT.value = f.body; } } };
    const chWrap = el('div', { style: 'display:flex;flex-wrap:wrap;gap:7px' }, CHANNELS.map(ch => { const on = f.channels.includes(ch); const b = el('button', { class: 'cc-chip-btn' + (on ? ' on' : ''), onClick: () => { const s = new Set(f.channels); if (s.has(ch)) s.delete(ch); else s.add(ch); f.channels = [...s]; b.classList.toggle('on'); } }, ch); return b; }));
    const subj = el('input', { class: 'cc-input', placeholder: 'Subject / push title', value: f.subject }); subj.oninput = () => { f.subject = subj.value; };
    const bodyT = el('textarea', { class: 'cc-input', rows: '4', placeholder: 'Message body' }, f.body); bodyT.oninput = () => { f.body = bodyT.value; };
    const sched = el('input', { class: 'cc-input', type: 'datetime-local', value: f.scheduledAt }); sched.oninput = () => { f.scheduledAt = sched.value; };
    const statSel = el('select', { class: 'cc-input' }, [['draft', 'Draft'], ['scheduled', 'Scheduled'], ['paused', 'Paused']].map(([v, l]) => el('option', { value: v, selected: f.status === v ? 'selected' : null }, l))); statSel.onchange = () => { f.status = statSel.value; };
    const previewBox = el('div');
    // UTM builder (client-only): compose a tagged link for this campaign.
    function utmBuilder() {
      const base = el('input', { class: 'cc-input', placeholder: 'https://loadboot.com/pricing.html' });
      const src = el('input', { class: 'cc-input', placeholder: 'utm_source (e.g. email)', value: (f.channels[0] || 'email') });
      const med = el('input', { class: 'cc-input', placeholder: 'utm_medium (e.g. campaign)', value: 'campaign' });
      const camp = el('input', { class: 'cc-input', placeholder: 'utm_campaign', value: (f.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') });
      const out = el('input', { class: 'cc-input', readonly: 'readonly', style: 'background:#f8fafc' });
      const build = () => {
        if (!base.value.trim()) { out.value = ''; return; }
        try {
          const u = new URL(base.value.trim());
          if (src.value.trim()) u.searchParams.set('utm_source', src.value.trim());
          if (med.value.trim()) u.searchParams.set('utm_medium', med.value.trim());
          if (camp.value.trim()) u.searchParams.set('utm_campaign', camp.value.trim());
          out.value = u.toString();
        } catch (_) { out.value = 'Enter a valid URL (including https://)'; }
      };
      [base, src, med, camp].forEach(i => i.oninput = build); build();
      const copy = el('button', { class: 'lb-btn lb-btn-sm', onClick: () => { if (out.value) { try { navigator.clipboard.writeText(out.value); toast('Tagged link copied', 'success'); } catch (_) {} } } }, 'Copy link');
      return el('details', { style: 'margin-top:6px' }, [
        el('summary', { style: 'cursor:pointer;font-weight:600' }, 'UTM link builder'),
        el('div', { style: 'display:flex;flex-direction:column;gap:8px;margin-top:8px' }, [base, src, med, camp, out, copy]),
      ]);
    }
    const form = el('div', null, [
      inp('Campaign name', 'name', 'June carrier newsletter'), inp('Objective', 'objective', 'Re-engage idle carriers'),
      el('label', { class: 'cc-field' }, [el('span', null, 'Audience'), audSel]),
      el('label', { class: 'cc-field' }, [el('span', null, 'Template (optional)'), tplSel]),
      el('label', { class: 'cc-field' }, [el('span', null, 'Channels'), chWrap]),
      el('label', { class: 'cc-field' }, [el('span', null, 'Subject / title'), subj]),
      el('label', { class: 'cc-field' }, [el('span', null, 'Body'), bodyT]),
      el('label', { class: 'cc-field' }, [el('span', null, 'Schedule (optional)'), sched]),
      el('label', { class: 'cc-field' }, [el('span', null, 'Status'), statSel]),
      utmBuilder(),
      previewBox,
      el('div', { class: 'cc-drawer-actions', style: 'margin-top:12px;display:flex;gap:8px' }, [
        el('button', { class: 'lb-btn', onClick: preview }, 'Preview'),
        el('button', { class: 'lb-btn lb-btn-primary', onClick: save }, 'Save campaign'),
      ]),
      el('p', { class: 'cc-sub', style: 'margin-top:8px' }, 'Push sends immediately from the list (with a recipient-count confirmation). Email/SMS delivery arrives with the delivery engine.'),
    ]);
    async function preview() {
      const aud = audiences.find(a => a.id === f.audienceId);
      let est = '—'; if (aud && aud.type) { try { est = (await audienceEstimate(aud.type)).count; } catch (_) {} }
      mount(previewBox, el('div', { class: 'lb-card', style: 'margin-top:6px;background:#f8fafc' }, [
        el('div', { class: 'cc-sub' }, 'Preview'),
        el('div', { style: 'font-weight:700;margin:6px 0' }, f.subject || '(no subject)'),
        el('div', { style: 'white-space:pre-wrap' }, f.body || '(no body)'),
        el('div', { class: 'cc-sub', style: 'margin-top:8px' }, 'Channels: ' + (f.channels.join(', ') || 'none') + ' · Audience: ' + (aud ? aud.name : 'none') + ' · ~' + est + ' recipients'),
        f.channels.length > 1 ? el('div', { class: 'cc-sub', style: 'color:#b45309' }, 'Frequency safeguard: recipients in more than one channel receive at most one message per channel; a broad send always confirms the count first.') : null,
      ].filter(Boolean)));
    }
    openDrawer(c ? 'Edit campaign' : 'New campaign', form, { subtitle: 'Audience + template + channels' });
    async function save() {
      if (!f.name.trim()) { alert('Campaign name is required.'); return; }
      if (f.scheduledAt) f.scheduledAt = new Date(f.scheduledAt).toISOString();
      try { await cmpSave(f); toast('Campaign saved', 'success'); document.getElementById('cc-drawer-root')?.remove(); load(); }
      catch (e) { alert(humanizeError(e)); }
    }
  }
}

export default renderCampaignManager;
