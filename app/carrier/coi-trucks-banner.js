// bl_comp_0504 — "Insurance approved → post the trucks on your certificate" (owner decision 30 Sep 2026).
// Server decides visibility (carrier_coi_trucks_banner): shows once the COI is valid, hides on ✕ or
// 2 days after this user first saw it; a new approval / VIN change brings it back once.
import { getClient } from '../shared/supabaseClient.js';

async function rpc(name, args) {
  const sb = await getClient();
  const { data, error } = await sb.rpc(name, args || {});
  if (error) throw error;
  return data;
}

const esc = (s) => String(s == null ? '' : s);

export async function mountCoiTrucksBanner(host, ctx = {}) {
  const h = ctx.h;
  if (!host || typeof h !== 'function') return;
  let b = null;
  try { b = await rpc('carrier_coi_trucks_banner'); } catch (_) { return; }
  if (!b || !b.show) return;

  const units = (b.fmcsa_units == null) ? null : Number(b.fmcsa_units);   // null = unknown, never guessed
  const covered = Number(b.covered || 0);
  const anyAuto = b.mode === 'any_auto';
  const scheduled = b.mode === 'scheduled';
  const gap = (scheduled && units != null && units > covered) ? units - covered : 0;
  const warn = gap > 0;

  const tile = (big, small, color) => h('div', { style: 'flex:1;min-width:110px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:10px 12px' }, [
    h('b', { style: 'display:block;font-size:22px;line-height:1.2;color:' + (color || '#fff') }, esc(big)),
    h('span', { style: 'font-size:12px;color:#b8c7dc' }, small)]);

  const title = anyAuto
    ? '✅ Insurance approved — you can post truck availability now'
    : (scheduled && units != null && covered >= units && covered > 0)
      ? '✅ Insurance approved — all ' + covered + ' of your trucks are covered'
      : '✅ Insurance approved — you can post truck availability now';
  const sub = anyAuto
    ? 'Your auto liability covers any auto, so every truck in your fleet can be posted. Just add each truck with its VIN under Fleet.'
    : 'Only trucks whose VIN is on your insurance certificate can be posted and dispatched.'
      + (scheduled && covered ? ' Your policy lists specific vehicles, so these are the trucks we can run for you:' : '');

  const tiles = [];
  if (units != null) tiles.push(tile(units, 'power units on FMCSA'));
  if (anyAuto) tiles.push(tile('All', 'covered (any auto)', '#5ee3a1'));
  else if (covered) tiles.push(tile(covered, 'covered on your certificate', '#5ee3a1'));
  if (warn) tiles.push(tile(gap, 'not on the certificate yet', '#ffb35c'));

  const vins = (!anyAuto && Array.isArray(b.vins)) ? b.vins : [];
  const vinList = vins.length ? h('div', { style: 'display:flex;flex-direction:column;gap:6px;margin:0 0 14px' }, vins.map((v) =>
    h('div', { style: 'display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;background:rgba(0,0,0,.2);border-radius:10px;padding:8px 12px;font-size:13px' }, [
      h('span', { style: 'color:#cfe0f5' }, esc(v.descr || 'Truck')),
      h('code', { style: 'font-family:ui-monospace,Menlo,Consolas,monospace;color:#fff;word-break:break-all' }, esc(v.vin)),
      h('span', { style: 'color:#5ee3a1;font-weight:800' }, '✓ covered')]))) : null;

  const note = warn ? h('div', { style: 'background:rgba(252,83,5,.14);border:1px solid rgba(252,83,5,.4);border-radius:12px;padding:10px 12px;font-size:13px;color:#ffe1d2;margin:0 0 14px;line-height:1.5' },
    'Want us to manage more of your ' + units + ' trucks? Ask your insurance agent to add them to the policy schedule, then upload the updated certificate (certificate holder: LoadBoot LLC). New VINs unlock as soon as we approve it.') : null;

  const btn = (label, primary, on) => h('button', { type: 'button', onClick: on,
    style: 'border:' + (primary ? '0' : '1px solid rgba(255,255,255,.22)') + ';border-radius:12px;padding:11px 16px;font-weight:800;font-size:14px;cursor:pointer;background:' + (primary ? '#FC5305' : 'rgba(255,255,255,.08)') + ';color:#fff' }, label);

  const card = h('div', { class: 'cp-card', role: 'status',
    style: 'position:relative;overflow:hidden;border-radius:16px;padding:18px;color:#fff;border:1px solid ' + (warn ? '#7a5a26' : '#1f6e4f') + ';background:linear-gradient(135deg,' + (warn ? '#123b5c,#3a2a14' : '#0d3a2a,#123b5c') + ')' }, [
    h('button', { type: 'button', 'aria-label': 'Dismiss', style: 'position:absolute;top:10px;right:12px;background:none;border:0;color:#b8c7dc;font-size:20px;cursor:pointer;line-height:1', onClick: async () => {
      card.remove(); try { await rpc('carrier_coi_trucks_banner_dismiss', { p_key: b.key }); } catch (_) {} } }, '✕'),
    h('h3', { style: 'margin:0 0 6px;font-size:18px;padding-right:26px;color:#fff' }, title),
    h('p', { style: 'margin:0 0 14px;color:#dbe7f5;font-size:14px;line-height:1.5' }, sub),
    tiles.length ? h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin:0 0 14px' }, tiles) : null,
    vinList, note,
    h('div', { style: 'display:flex;gap:10px;flex-wrap:wrap' }, [
      btn('Post truck availability →', true, () => { if (typeof ctx.openAvail === 'function') ctx.openAvail(); else if (ctx.go) ctx.go('fleet'); }),
      (warn || !anyAuto) ? btn('Upload updated certificate', false, () => { if (ctx.go) ctx.go('documents'); }) : null,
    ].filter(Boolean)),
  ].filter(Boolean));
  host.appendChild(card);
}
