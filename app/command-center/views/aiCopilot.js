// aiCopilot.js — Phase 7: AI Dispatch Copilot (advisory only).
// Wires the Gemini ai-assist engine into a dispatch workflow: lane pricing, expected rate
// range, loaded/all-in RPM, deadhead impact, negotiation guidance and risk flags — each
// result clearly labelled with its inputs, freshness and a "human decision required" notice.
// GUARDRAIL: the copilot NEVER books a load, approves a carrier, or releases money. It only
// advises; a human always decides and acts.
import { el, mount } from '../../shared/ui/dom.js';
import { sectionHead, card, money, fmtDateTime } from '../../shared/ui/components.js';
import { aiAssist } from '../../shared/api.js';
import { humanizeError } from '../../shared/errors.js';

export function renderAiCopilot(host) {
  const f = {};
  const inp = (key, label, ph, type) => {
    const i = el('input', { class: 'cc-input', type: type || 'text', placeholder: ph || '' });
    f[key] = i; return el('label', { class: 'cc-field' }, [el('span', null, label), i]);
  };
  const eqSel = el('select', { class: 'cc-input' }, ['Dry Van', 'Reefer', 'Flatbed', 'Step Deck', 'Power Only', 'Hotshot', 'Tanker'].map(x => el('option', { value: x }, x)));
  f.equipment = eqSel;

  const out = el('div', { id: 'cop-out' });
  const rpmBox = el('div', { class: 'cc-sub', id: 'cop-rpm', style: 'margin-top:6px' });

  const analyzeBtn = el('button', { class: 'lb-btn lb-btn-primary', onClick: analyze }, '✨ Analyze lane with AI');

  function deterministicRPM() {
    const rate = Number(f.rate.value), miles = Number(f.miles.value);
    if (rate > 0 && miles > 0) rpmBox.textContent = 'Quick math: loaded RPM ≈ $' + (rate / miles).toFixed(2) + '/mi (' + money(rate) + ' ÷ ' + miles + ' mi). AI estimate below.';
    else rpmBox.textContent = '';
  }

  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('AI Dispatch Copilot', 'Advisory lane pricing, RPM, deadhead, negotiation and risk — powered by AI. You always make the final call.'),
    el('div', { class: 'cc-ai-guard' }, '🔒 Advisory only — the copilot never books loads, approves carriers, or releases money. A human decides every action.'),
    card([
      el('h4', { class: 'cc-card-title' }, 'Lane'),
      el('div', { class: 'cc-grid-2' }, [
        inp('origin', 'Origin', 'Chicago, IL'),
        inp('destination', 'Destination', 'Atlanta, GA'),
      ]),
      el('div', { class: 'cc-grid-2' }, [
        el('label', { class: 'cc-field' }, [el('span', null, 'Equipment'), eqSel]),
        inp('miles', 'Miles (optional)', '720', 'number'),
      ]),
      el('div', { class: 'cc-grid-2' }, [
        inp('rate', 'Offered rate (optional)', '1850', 'number'),
        inp('weight', 'Weight / commodity (optional)', '42,000 lbs steel'),
      ]),
      rpmBox,
      el('div', { style: 'margin-top:12px' }, analyzeBtn),
    ]),
    out,
  ]));
  ['miles', 'rate'].forEach(k => f[k].addEventListener('input', deterministicRPM));

  async function analyze() {
    if (!f.origin.value.trim() || !f.destination.value.trim()) { alert('Enter an origin and destination.'); return; }
    analyzeBtn.disabled = true; analyzeBtn.textContent = '✨ Analyzing…';
    mount(out, el('div', { class: 'lb-state lb-loading', style: 'margin-top:16px' }, 'Asking the AI copilot…'));
    const inputs = {
      origin: f.origin.value.trim(), destination: f.destination.value.trim(), equipment: eqSel.value,
      miles: f.miles.value.trim() || 'unknown', rate: f.rate.value.trim() || 'not provided', weight: f.weight.value.trim() || 'unspecified',
    };
    const prompt = [
      'You are a freight dispatch pricing copilot for LoadBoot (flat-5% dispatching). Analyse this lane and give ADVISORY guidance only (a human dispatcher decides). Be concise and use plain headings.',
      `Origin: ${inputs.origin}`, `Destination: ${inputs.destination}`, `Equipment: ${inputs.equipment}`,
      `Miles: ${inputs.miles}`, `Offered rate (USD): ${inputs.rate}`, `Weight/commodity: ${inputs.weight}`,
      'Provide, each on its own short line:',
      '1) Fair rate RANGE (low–high USD) and a single recommended target.',
      '2) Expected loaded RPM ($/mi) and an all-in RPM assuming ~10-15% deadhead.',
      '3) Deadhead/repositioning impact in one line.',
      '4) Negotiation recommendation (one line).',
      '5) Risk flags (seasonality, lane imbalance, detention risk) — short bullets.',
      'End with: "Estimate only — verify against live market; human decision required."',
      'Do not claim certainty. If miles are unknown, estimate them and say so.',
    ].join('\n');
    let res;
    try { res = await aiAssist('draft', { prompt }); }
    catch (e) {
      mount(out, card([el('div', { class: 'lb-state lb-error' }, humanizeError(e) + ' — AI assistance requires GEMINI_API_KEY in this project’s secrets.')]));
      analyzeBtn.disabled = false; analyzeBtn.textContent = '✨ Analyze lane with AI'; return;
    }
    const text = (res && res.text) || 'No response.';
    mount(out, el('div', { style: 'margin-top:16px' }, card([
      el('div', { class: 'cc-card-head' }, [
        el('h4', { class: 'cc-card-title' }, [el('span', { class: 'cc-src' }, 'AI Copilot'), ' ', inputs.origin + ' → ' + inputs.destination]),
        el('span', { class: 'cc-pill cc-pill-amber' }, [el('i', { class: 'cc-pill-dot' }), 'advisory']),
      ]),
      el('div', { class: 'cc-ai-answer' }, text),
      el('div', { class: 'cc-ai-meta' }, [
        el('div', null, 'Inputs: ' + inputs.equipment + ' · ' + inputs.miles + ' mi · offered ' + inputs.rate),
        el('div', null, 'Generated ' + fmtDateTime(new Date().toISOString()) + ' · model: Gemini · confidence: estimate'),
        el('div', { class: 'cc-ai-decide' }, '👤 Human decision required — this is guidance, not an action.'),
      ]),
    ])));
    analyzeBtn.disabled = false; analyzeBtn.textContent = '✨ Analyze lane with AI';
  }
}

export default renderAiCopilot;
