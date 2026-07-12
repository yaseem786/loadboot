// addr-suggest.js — street-address autocomplete for any <input>.
// Free OSM geocoder (Photon, no API key). US-biased, debounced, keyboard-free simple list.
// Usage: attachAddressSuggest(input) — picks fill the input with "123 Main St, Dallas, TX 75201".
//        attachAddressSuggest(input, { onPick: (r) => {...} }) — r = { street, tail, full }.

const API = 'https://photon.komoot.io/api/';
const US_BBOX = '-125,24,-66.5,49.6'; // continental US bias

const ST_ABBR = { 'alabama':'AL','alaska':'AK','arizona':'AZ','arkansas':'AR','california':'CA','colorado':'CO','connecticut':'CT','delaware':'DE','florida':'FL','georgia':'GA','hawaii':'HI','idaho':'ID','illinois':'IL','indiana':'IN','iowa':'IA','kansas':'KS','kentucky':'KY','louisiana':'LA','maine':'ME','maryland':'MD','massachusetts':'MA','michigan':'MI','minnesota':'MN','mississippi':'MS','missouri':'MO','montana':'MT','nebraska':'NE','nevada':'NV','new hampshire':'NH','new jersey':'NJ','new mexico':'NM','new york':'NY','north carolina':'NC','north dakota':'ND','ohio':'OH','oklahoma':'OK','oregon':'OR','pennsylvania':'PA','rhode island':'RI','south carolina':'SC','south dakota':'SD','tennessee':'TN','texas':'TX','utah':'UT','vermont':'VT','virginia':'VA','washington':'WA','west virginia':'WV','wisconsin':'WI','wyoming':'WY','district of columbia':'DC' };
const abbr = (s) => ST_ABBR[String(s || '').toLowerCase()] || s || '';

function fmt(p) {
  const street = [p.housenumber, p.street || p.name].filter(Boolean).join(' ');
  const tail = [p.city || p.district, [abbr(p.state), p.postcode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  return { street, tail, full: [street, tail].filter(Boolean).join(', '), city: p.city || p.district || '', state: abbr(p.state) || '', zip: p.postcode || '' };
}

export function attachAddressSuggest(input, opts = {}) {
  if (!input || input.__lbAddr) return; input.__lbAddr = true;
  let box = null, timer = 0, ctrl = null;
  const close = () => { if (box) { box.remove(); box = null; } };
  const open = (items) => {
    close(); if (!items.length) return;
    // parent resolved LAZILY — the input may not have been in the DOM at attach time
    const parent = input.parentNode; if (!parent) return;
    if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
    box = document.createElement('div');
    box.style.cssText = 'position:absolute;left:' + input.offsetLeft + 'px;width:' + Math.max(input.offsetWidth, 260) + 'px;max-width:92vw;max-height:260px;overflow-y:auto;top:' + (input.offsetTop + input.offsetHeight + 4) + 'px;z-index:1200;background:#fff;color:#10223B;border:1px solid #d7dfea;border-radius:12px;box-shadow:0 18px 44px -14px rgba(2,12,30,.45);overflow:hidden;font-size:.88rem';
    items.forEach((r) => {
      const it = document.createElement('div');
      it.style.cssText = 'padding:10px 13px;cursor:pointer;border-top:1px solid #f1f5f9;line-height:1.35';
      it.innerHTML = '<b style="font-weight:700">' + r.street + '</b>' + (r.tail ? '<span style="color:#64748b"> — ' + r.tail + '</span>' : '');
      it.addEventListener('mousedown', (e) => { e.preventDefault(); if (opts.onPick) opts.onPick(r); else input.value = r.full; input.dispatchEvent(new Event('input', { bubbles: true })); close(); });
      it.addEventListener('mouseenter', () => { it.style.background = '#eff6ff'; });
      it.addEventListener('mouseleave', () => { it.style.background = ''; });
      box.appendChild(it);
    });
    parent.insertBefore(box, input.nextSibling);
  };
  input.addEventListener('input', (ev) => {
    clearTimeout(timer);
    if (ev && ev.isTrusted === false) { close(); return; } // programmatic (post-pick) — never re-open
    const q = input.value.trim();
    if (q.length < 4 || !/[a-zA-Z]/.test(q)) { close(); return; }
    timer = setTimeout(async () => {
      try {
        if (ctrl) ctrl.abort(); ctrl = new AbortController();
        const r = await fetch(API + '?q=' + encodeURIComponent(q) + '&limit=6&lang=en&bbox=' + US_BBOX, { signal: ctrl.signal });
        if (!r.ok) return;
        const d = await r.json();
        const items = ((d && d.features) || [])
          .filter((f) => f.properties && String(f.properties.countrycode || '').toUpperCase() === 'US')
          .map((f) => { const o = fmt(f.properties); if (f.geometry && f.geometry.coordinates) { o.lng = f.geometry.coordinates[0]; o.lat = f.geometry.coordinates[1]; } return o; })
          .filter((x) => x.street && /[a-zA-Z]/.test(x.street));
        const seen = {}; const uniq = items.filter((x) => (seen[x.full] ? false : (seen[x.full] = 1)));
        open(uniq.slice(0, 5));
      } catch (_) { /* offline / aborted — silent */ }
    }, 300);
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
}

export default attachAddressSuggest;
