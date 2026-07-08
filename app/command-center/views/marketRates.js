// marketRates.js — CC: DAT-style market rates, staff sees ALL THREE audiences (carrier buy,
// broker sell, shipper) side by side. Data: cc_lane_rate (staff payload) via the shared widget.
import { el, mount } from '../../shared/ui/dom.js';
import { sectionHead } from '../../shared/ui/components.js';
import { renderMarketWidget } from '../../shared/market-widget.js';

export function renderMarketRatesCC(host) {
  const w = el('div', { class: 'cc-view' }, [
    sectionHead('Market Rates', 'Carrier buy · broker sell · shipper — all three sides, blended from LoadBoot bookings and weekly benchmarks. Tune baselines in rate_standards (rpm_*, broker_margin) and rate_benchmarks.'),
    el('div', { id: 'cc-mw-host' }),
  ]);
  mount(host, w);
  renderMarketWidget(w.querySelector('#cc-mw-host'), { sub: 'Staff view — every audience side by side. What each role sees in their own portal is server-enforced.' });
}
