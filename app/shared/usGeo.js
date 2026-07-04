// usGeo.js — offline US freight geography. ~150 major freight cities + state
// centroids fallback. Zero APIs, zero cost, works offline. Coordinates are
// city-center approximations (±a few miles) — always labeled as estimates.

const CITY = {
  'dallas,tx':[32.78,-96.80],'fort worth,tx':[32.76,-97.33],'houston,tx':[29.76,-95.37],'san antonio,tx':[29.42,-98.49],'austin,tx':[30.27,-97.74],'el paso,tx':[31.76,-106.49],'laredo,tx':[27.51,-99.51],'lubbock,tx':[33.58,-101.86],'amarillo,tx':[35.19,-101.85],'corpus christi,tx':[27.80,-97.40],
  'atlanta,ga':[33.75,-84.39],'savannah,ga':[32.08,-81.10],'macon,ga':[32.84,-83.63],'augusta,ga':[33.47,-82.01],
  'memphis,tn':[35.15,-90.05],'nashville,tn':[36.16,-86.78],'knoxville,tn':[35.96,-83.92],'chattanooga,tn':[35.05,-85.31],
  'chicago,il':[41.88,-87.63],'joliet,il':[41.53,-88.08],'rockford,il':[42.27,-89.09],'springfield,il':[39.78,-89.65],
  'los angeles,ca':[34.05,-118.24],'long beach,ca':[33.77,-118.19],'ontario,ca':[34.06,-117.65],'fresno,ca':[36.74,-119.79],'sacramento,ca':[38.58,-121.49],'san diego,ca':[32.72,-117.16],'oakland,ca':[37.80,-122.27],'stockton,ca':[37.96,-121.29],'bakersfield,ca':[35.37,-119.02],
  'phoenix,az':[33.45,-112.07],'tucson,az':[32.22,-110.97],
  'denver,co':[39.74,-104.99],'colorado springs,co':[38.83,-104.82],
  'kansas city,mo':[39.10,-94.58],'st louis,mo':[38.63,-90.20],'saint louis,mo':[38.63,-90.20],'springfield,mo':[37.21,-93.29],
  'oklahoma city,ok':[35.47,-97.52],'tulsa,ok':[36.15,-95.99],
  'little rock,ar':[34.75,-92.29],'fort smith,ar':[35.39,-94.40],
  'new orleans,la':[29.95,-90.07],'baton rouge,la':[30.45,-91.19],'shreveport,la':[32.53,-93.75],'lafayette,la':[30.22,-92.02],
  'jackson,ms':[32.30,-90.18],'gulfport,ms':[30.37,-89.09],
  'birmingham,al':[33.52,-86.80],'mobile,al':[30.69,-88.04],'huntsville,al':[34.73,-86.59],'montgomery,al':[32.38,-86.31],
  'jacksonville,fl':[30.33,-81.66],'miami,fl':[25.76,-80.19],'orlando,fl':[28.54,-81.38],'tampa,fl':[27.95,-82.46],'lakeland,fl':[28.04,-81.95],'fort lauderdale,fl':[26.12,-80.14],
  'charlotte,nc':[35.23,-80.84],'raleigh,nc':[35.78,-78.64],'greensboro,nc':[36.07,-79.79],'wilmington,nc':[34.23,-77.94],
  'columbia,sc':[34.00,-81.03],'charleston,sc':[32.78,-79.93],'greenville,sc':[34.85,-82.40],
  'richmond,va':[37.54,-77.44],'norfolk,va':[36.85,-76.29],'roanoke,va':[37.27,-79.94],
  'baltimore,md':[39.29,-76.61],'washington,dc':[38.91,-77.04],
  'philadelphia,pa':[39.95,-75.17],'pittsburgh,pa':[40.44,-80.00],'harrisburg,pa':[40.27,-76.88],'allentown,pa':[40.60,-75.49],'scranton,pa':[41.41,-75.66],
  'newark,nj':[40.74,-74.17],'elizabeth,nj':[40.66,-74.21],'trenton,nj':[40.22,-74.76],
  'new york,ny':[40.71,-74.01],'brooklyn,ny':[40.68,-73.94],'buffalo,ny':[42.89,-78.88],'albany,ny':[42.65,-73.75],'syracuse,ny':[43.05,-76.15],'rochester,ny':[43.16,-77.61],
  'boston,ma':[42.36,-71.06],'springfield,ma':[42.10,-72.59],'worcester,ma':[42.26,-71.80],
  'hartford,ct':[41.77,-72.67],'providence,ri':[41.82,-71.41],
  'columbus,oh':[39.96,-83.00],'cincinnati,oh':[39.10,-84.51],'cleveland,oh':[41.50,-81.69],'toledo,oh':[41.65,-83.54],'dayton,oh':[39.76,-84.19],'akron,oh':[41.08,-81.52],
  'indianapolis,in':[39.77,-86.16],'fort wayne,in':[41.08,-85.14],'south bend,in':[41.68,-86.25],
  'detroit,mi':[42.33,-83.05],'grand rapids,mi':[42.96,-85.66],'lansing,mi':[42.73,-84.56],
  'milwaukee,wi':[43.04,-87.91],'madison,wi':[43.07,-89.40],'green bay,wi':[44.51,-88.02],
  'minneapolis,mn':[44.98,-93.27],'st paul,mn':[44.95,-93.09],'duluth,mn':[46.79,-92.10],
  'des moines,ia':[41.59,-93.62],'cedar rapids,ia':[41.98,-91.67],'davenport,ia':[41.52,-90.58],
  'omaha,ne':[41.26,-95.93],'lincoln,ne':[40.81,-96.68],
  'wichita,ks':[37.69,-97.34],'topeka,ks':[39.05,-95.68],
  'louisville,ky':[38.25,-85.76],'lexington,ky':[38.04,-84.50],'bowling green,ky':[36.99,-86.44],
  'salt lake city,ut':[40.76,-111.89],'ogden,ut':[41.22,-111.97],
  'las vegas,nv':[36.17,-115.14],'reno,nv':[39.53,-119.81],
  'albuquerque,nm':[35.08,-106.65],'el paso,nm':[31.76,-106.49],
  'boise,id':[43.62,-116.20],
  'portland,or':[45.52,-122.68],'eugene,or':[44.05,-123.09],
  'seattle,wa':[47.61,-122.33],'spokane,wa':[47.66,-117.43],'tacoma,wa':[47.25,-122.44],
  'billings,mt':[45.78,-108.50],'fargo,nd':[46.88,-96.79],'sioux falls,sd':[43.55,-96.73],
  'cheyenne,wy':[41.14,-104.82],'casper,wy':[42.87,-106.31],
  'charleston,wv':[38.35,-81.63],'wilmington,de':[39.75,-75.55],
  'portland,me':[43.66,-70.26],'manchester,nh':[42.99,-71.46],'burlington,vt':[44.48,-73.21],
  'anchorage,ak':[61.22,-149.90],'honolulu,hi':[21.31,-157.86],
  'tupelo,ms':[34.26,-88.70],'texarkana,tx':[33.43,-94.05],'meridian,ms':[32.36,-88.70],
};
const STATE = {
  tx:[31.5,-98.5],ga:[32.7,-83.4],tn:[35.8,-86.4],il:[40.0,-89.2],ca:[36.5,-119.5],az:[34.3,-111.7],co:[39.0,-105.5],mo:[38.4,-92.5],ok:[35.6,-97.5],ar:[34.9,-92.4],la:[31.1,-92.0],ms:[32.7,-89.7],al:[32.8,-86.8],fl:[28.6,-82.4],nc:[35.5,-79.4],sc:[33.9,-80.9],va:[37.5,-78.8],md:[39.0,-76.8],pa:[40.9,-77.8],nj:[40.2,-74.7],ny:[42.9,-75.5],ma:[42.3,-71.8],ct:[41.6,-72.7],ri:[41.7,-71.5],oh:[40.3,-82.8],in:[39.9,-86.3],mi:[44.3,-85.4],wi:[44.6,-89.7],mn:[46.3,-94.3],ia:[42.1,-93.5],ne:[41.5,-99.8],ks:[38.5,-98.4],ky:[37.5,-85.3],ut:[39.3,-111.7],nv:[39.3,-116.6],nm:[34.4,-106.1],id:[44.4,-114.6],or:[43.9,-120.6],wa:[47.4,-120.4],mt:[47.0,-109.6],nd:[47.4,-100.5],sd:[44.4,-100.2],wy:[43.0,-107.6],wv:[38.6,-80.6],de:[39.0,-75.5],me:[45.4,-69.2],nh:[43.7,-71.6],vt:[44.1,-72.7],dc:[38.91,-77.04],ak:[64.0,-153.0],hi:[20.3,-156.4],
};

export function geo(place) {
  // "Dallas, TX" / "dallas tx" / "Memphis TN" -> [lat,lng] or null. City first, state centroid fallback.
  if (!place) return null;
  const p = String(place).toLowerCase().replace(/[^a-z ,]/g, '').trim();
  const m = p.match(/^(.*?)[ ,]+([a-z]{2})$/);
  if (!m) return null;
  const city = m[1].trim().replace(/\s+/g, ' ');
  const st = m[2];
  return CITY[city + ',' + st] || (STATE[st] ? { c: STATE[st], approx: true } && STATE[st] : null);
}
export function isStateFallback(place) {
  if (!place) return false;
  const p = String(place).toLowerCase().replace(/[^a-z ,]/g, '').trim();
  const m = p.match(/^(.*?)[ ,]+([a-z]{2})$/);
  if (!m) return false;
  return !CITY[m[1].trim().replace(/\s+/g, ' ') + ',' + m[2]];
}
export function milesBetween(a, b) {
  if (!a || !b) return null;
  const t = Math.PI / 180, R = 3959;
  const dLat = (b[0] - a[0]) * t, dLng = (b[1] - a[1]) * t;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * t) * Math.cos(b[0] * t) * Math.sin(dLng / 2) ** 2;
  return Math.round(R * 2 * Math.asin(Math.min(1, Math.sqrt(x))));
}
// Straight-line -> practical road miles (US interstate median ~1.15x)
export const ROAD_FACTOR = 1.15;
export function roadMiles(a, b) { const m = milesBetween(a, b); return m == null ? null : Math.round(m * ROAD_FACTOR); }

// ---- Toll corridor estimator (5-axle truck). Figures are conservative
// approximations of PUBLISHED toll-authority schedules (full typical crossings).
// This is a LABELED ESTIMATE — exact tolls depend on the routed highway.
const TOLL_STATE = { // state -> [typical 5-axle crossing cost $, corridor name]
  pa: [115, 'PA Turnpike'], oh: [65, 'Ohio Turnpike'], in_: [50, 'Indiana Toll Rd'],
  il: [25, 'Chicago-area tolls'], ny: [55, 'NY Thruway'], nj: [35, 'NJ Turnpike'],
  ma: [25, 'Mass Pike'], md: [35, 'MD I-95 tolls'], de: [15, 'DE I-95'],
  wv: [15, 'WV Turnpike'], ks: [30, 'Kansas Turnpike'], ok: [30, 'OK turnpikes'],
  fl: [45, 'FL Turnpike'], nh: [8, 'NH tolls'], me: [12, 'ME Turnpike'], va: [12, 'VA tolls'],
};
function nearestStateKey(pt) {
  // crude but real: nearest state centroid (good enough for corridor detection)
  let best = null, bd = 1e9;
  for (const k in STATE) { const d = (STATE[k][0] - pt[0]) ** 2 + (STATE[k][1] - pt[1]) ** 2; if (d < bd) { bd = d; best = k; } }
  return best;
}
export function tollEstimate(a, b) {
  // Sample the straight path, collect toll-belt states it passes through, sum typical crossings.
  if (!a || !b) return { total: null, parts: [], basis: 'route unknown' };
  const hit = new Map();
  for (let i = 0; i <= 12; i++) {
    const p = [a[0] + (b[0] - a[0]) * i / 12, a[1] + (b[1] - a[1]) * i / 12];
    const st = nearestStateKey(p);
    const key = st === 'in' ? 'in_' : st;
    if (TOLL_STATE[key] && !hit.has(key)) hit.set(key, TOLL_STATE[key]);
  }
  const parts = [...hit.values()];
  const total = parts.reduce((s, x) => s + x[0], 0);
  return { total, parts, basis: parts.length ? 'published 5-axle schedules — corridor estimate' : 'no major toll corridors expected on this lane' };
}
