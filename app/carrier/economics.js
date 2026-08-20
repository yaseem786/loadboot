// economics.js — "Know your number".
//
// Carriers think in dollars per week; matching thinks in dollars per mile. This card
// is the translator, and it exists because a carrier told us $3,900 a week over
// WhatsApp and nobody could do anything with it. Now he types it once and sees the
// miles that clear it, on his own dashboard, before a dispatcher has to explain it.
//
// The weekly figure is volunteered, never required. It is his business, not ours —
// so the copy says so, and the number never leaves his account.
// Backend: cc_breakeven() / cc_set_cost_and_lanes() — bl_pref_0229/0230/0231.
import { breakeven, setCostAndLanes } from '../shared/api.js';

const money = (n) => '$' + Math.round(Math.abs(Number(n) || 0)).toLocaleString();
const signed = (n) => (Number(n) >= 0 ? '+' : '−') + money(n);

const CARD = 'background:#111c31;border:1px solid rgba(255,255,255,.09);border-radius:16px;padding:16px 18px;margin-bottom:14px';
const H = 'font-weight:800;color:#eaf1fb;font-size:1.02rem';
const SUB = 'color:#8ea2c3;font-size:.86rem;line-height:1.6';

const RT = [
  ['only', 'Round trip only', 'Never send me out without a load back'],
  ['prefer', 'Prefer round trips', 'Pair it where you can, one-way is OK sometimes'],
  ['any', 'One-way is fine', 'Send me the best rate, I will find my own reload'],
];

let _data = null;

function invite(host) {
  host.innerHTML = '<div style="' + CARD + '">'
    + '<div style="' + H + '">Know your number</div>'
    + '<div style="' + SUB + ';margin:4px 0 12px">Tell us what one week costs you to run — truck, fuel, insurance, wages, all of it — and we will show you the miles that clear it at your floor rate. '
    + 'It stays on your account and is only ever shown to you.</div>'
    + '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">'
    + '<div style="position:relative;flex:1;min-width:170px">'
    + '<span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:#8ea2c3;font-weight:700">$</span>'
    + '<input class="lbe-cost" type="number" min="1" step="50" inputmode="numeric" placeholder="3,900" '
    + 'style="width:100%;background:#0b1424;border:1px solid rgba(255,255,255,.14);border-radius:11px;padding:11px 12px 11px 26px;color:#eaf1fb;font-size:1rem;font-weight:700">'
    + '</div>'
    + '<button class="lbe-go" style="background:#FC5305;border:0;border-radius:11px;padding:11px 20px;color:#fff;font-weight:800;font-size:.92rem;cursor:pointer">Show me</button>'
    + '</div>'
    + '<label style="display:flex;gap:8px;align-items:center;margin-top:10px;color:#8ea2c3;font-size:.82rem;cursor:pointer">'
    + '<input class="lbe-pay" type="checkbox" checked> That figure includes what I pay myself and my drivers</label>'
    + '<div class="lbe-err" style="color:#f87171;font-size:.82rem;margin-top:8px;display:none"></div>'
    + '</div>';

  const go = host.querySelector('.lbe-go');
  const inp = host.querySelector('.lbe-cost');
  const err = host.querySelector('.lbe-err');
  const save = async () => {
    const v = Number(inp.value);
    if (!v || v <= 0) { err.textContent = 'Enter what one week costs you to run.'; err.style.display = ''; inp.focus(); return; }
    go.disabled = true; go.textContent = 'Working…'; err.style.display = 'none';
    try {
      _data = await setCostAndLanes(v, host.querySelector('.lbe-pay').checked, null);
      render(host);
    } catch (e) {
      go.disabled = false; go.textContent = 'Show me';
      err.textContent = (e && e.message) || 'Could not save that.'; err.style.display = '';
    }
  };
  go.addEventListener('click', save);
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') save(); });
}

function answer(host, d) {
  const rows = d.scenarios || [];
  const best = rows.reduce((m, r) => Math.max(m, Math.abs(Number(r.over_cost) || 0)), 1);

  const bars = rows.map((r) => {
    const over = Number(r.over_cost) || 0;
    const pct = Math.max(4, Math.round((Math.abs(over) / best) * 100));
    const col = over >= 0 ? '#34d399' : '#f87171';
    const soft = over >= 0 ? 'rgba(52,211,153,.16)' : 'rgba(248,113,113,.16)';
    return '<div style="display:flex;align-items:center;gap:10px;margin:5px 0">'
      + '<div style="width:52px;color:#8ea2c3;font-size:.8rem;font-weight:700;text-align:right">' + Number(r.miles).toLocaleString() + '</div>'
      + '<div style="flex:1;height:8px;background:' + soft + ';border-radius:99px;overflow:hidden">'
      + '<div style="width:' + pct + '%;height:100%;background:' + col + ';border-radius:99px"></div></div>'
      + '<div style="width:74px;text-align:right;color:' + col + ';font-size:.82rem;font-weight:800">' + signed(over) + '</div>'
      + '<div style="width:52px;text-align:right;color:#5f7599;font-size:.76rem">' + money(r.cost_per_mile) + '/mi</div>'
      + '</div>';
  }).join('');

  const chips = RT.map(([v, label, sub]) => {
    const on = d.round_trip_pref === v;
    return '<button type="button" class="lbe-rt" data-v="' + v + '" title="' + sub + '" '
      + 'style="background:' + (on ? 'rgba(8,131,247,.18)' : 'transparent') + ';border:1px solid ' + (on ? 'rgba(8,131,247,.55)' : 'rgba(255,255,255,.16)')
      + ';color:' + (on ? '#7cc0ff' : '#8ea2c3') + ';border-radius:999px;padding:6px 13px;font-size:.8rem;font-weight:700;cursor:pointer">'
      + (on ? '✓ ' : '') + label + '</button>';
  }).join('');

  host.innerHTML = '<div style="' + CARD + '">'
    + '<div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px">'
    + '<div style="' + H + '">Your break-even</div>'
    + '<button class="lbe-edit" style="background:none;border:0;color:#7cc0ff;font-size:.82rem;font-weight:700;cursor:pointer;padding:0">edit ›</button></div>'

    + '<div style="display:flex;align-items:baseline;gap:10px;margin:12px 0 2px;flex-wrap:wrap">'
    + '<div style="font-size:2.3rem;font-weight:800;color:#eaf1fb;line-height:1">' + Number(d.breakeven_miles).toLocaleString() + '</div>'
    + '<div style="color:#8ea2c3;font-size:.92rem;font-weight:700">loaded miles a week</div></div>'
    + '<div style="' + SUB + ';margin-bottom:14px">to cover ' + money(d.weekly_cost) + ' at your ' + money(d.rpm) + '.00 floor, after our ' + d.fee_pct + '% — '
    + 'about <b style="color:#c9d8ee">' + Number(d.miles_per_day).toLocaleString() + ' a day</b> over ' + d.driving_days + ' driving days.</div>'

    + bars

    + '<div style="' + SUB + ';margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.07)">'
    + 'Your cost per mile falls as the miles rise — which is why miles move your margin more than rate does.</div>'

    + '<div style="margin-top:14px">'
    + '<div style="color:#8ea2c3;font-size:.8rem;font-weight:700;margin-bottom:7px">How should we pair your lanes?</div>'
    + '<div style="display:flex;gap:7px;flex-wrap:wrap">' + chips + '</div></div>'
    + '</div>';

  host.querySelector('.lbe-edit').addEventListener('click', () => invite(host));
  host.querySelectorAll('.lbe-rt').forEach((b) => b.addEventListener('click', async () => {
    const prev = d.round_trip_pref;
    d.round_trip_pref = b.dataset.v;
    answer(host, d);
    try { _data = await setCostAndLanes(null, null, b.dataset.v); }
    catch (_) { d.round_trip_pref = prev; answer(host, d); }
  }));
}

function render(host) {
  if (_data && _data.ready) answer(host, _data); else invite(host);
}

export async function mountBreakevenCard(host) {
  if (!host) return;
  try { _data = await breakeven(); } catch (_) { host.innerHTML = ''; return; }
  render(host);
}

// Small inline chip for a truck's derived loading capability. Same three fields the
// carrier already gave us — liftgate, dock height, pallet jack — turned into the one
// sentence a broker actually needs.
export function loadingChip(profile) {
  if (!profile) return '';
  const tone = profile.code === 'ground_capable' ? ['#34d399', 'rgba(52,211,153,.14)']
    : profile.code === 'dock_or_forklift' ? ['#7cc0ff', 'rgba(8,131,247,.14)']
    : profile.code === 'forklift_or_leveler' ? ['#fbbf24', 'rgba(251,191,36,.14)']
    : ['#8ea2c3', 'rgba(255,255,255,.07)'];
  return '<span title="' + String(profile.detail || '').replace(/"/g, '&quot;') + '" '
    + 'style="background:' + tone[1] + ';border:1px solid ' + tone[0] + '55;color:' + tone[0]
    + ';border-radius:999px;padding:3px 10px;font-size:.74rem;font-weight:800;white-space:nowrap">'
    + (profile.code === 'unknown' ? '? ' : '') + profile.label + '</span>';
}
