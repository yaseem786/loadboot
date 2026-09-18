import os, re, json, sys, time, requests, urllib3
urllib3.disable_warnings()
from playwright.sync_api import sync_playwright

OUT = '/tmp/shots/raw'; os.makedirs(OUT, exist_ok=True)
STATE = '/tmp/shots/state.json'
BASE = 'http://127.0.0.1:8765'
SB = 'https://snslhvmkjusozgjelghi.supabase.co'
ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/'
S = requests.Session(); S.verify = False

def _forward(route, url, headers=None):
    req = route.request
    try:
        h = {k: v for k, v in req.headers.items() if k.lower() not in ('host', 'content-length', 'accept-encoding')}
        if headers: h.update(headers)
        r = S.request(req.method, url, headers=h, data=req.post_data_buffer, timeout=40, allow_redirects=True)
        rh = {k: v for k, v in r.headers.items() if k.lower() not in ('content-encoding', 'transfer-encoding', 'content-length', 'connection')}
        rh['access-control-allow-origin'] = '*'
        route.fulfill(status=r.status_code, headers=rh, body=r.content)
    except Exception as e:
        print('FWD FAIL', url[:90], str(e)[:60]); route.abort()

ANON = 'STAGING_ANON_KEY'
_SOC = {}
def _socrata(route, url):
    try:
        if url not in _SOC:
            hh = {'apikey': ANON, 'Authorization': 'Bearer ' + ANON, 'Content-Type': 'application/json'}
            rid = S.post(SB + '/rest/v1/rpc/lb_shots_fetch', json={'p_url': url}, headers=hh, timeout=30).json()
            body = None
            for _ in range(20):
                time.sleep(0.7)
                r = S.post(SB + '/rest/v1/rpc/lb_shots_read', json={'p_id': rid}, headers=hh, timeout=30)
                if r.status_code == 200 and r.text not in ('null', '', '""'): body = r.json(); break
            _SOC[url] = body
        body = _SOC[url]
        if body is None: return route.fulfill(status=502, body='')
        route.fulfill(status=200, headers={'content-type': 'application/json', 'access-control-allow-origin': '*'}, body=body)
    except Exception as e:
        print('SOC FAIL', url[:80], str(e)[:80]); route.abort()

def handler(route):
    url = route.request.url
    if url.startswith(BASE): return route.continue_()
    if 'supabase-js@2.45.4' in url:
        return route.fulfill(path='/tmp/site/supabase.esm.js', content_type='application/javascript')
    if 'fonts.googleapis.com' in url:
        return route.fulfill(path='/tmp/site/fonts/manrope.css', content_type='text/css')
    if 'fonts.gstatic.com/lb/' in url:
        return route.fulfill(path='/tmp/site/fonts/' + url.rsplit('/',1)[1], content_type='font/woff2', headers={'access-control-allow-origin':'*','content-type':'font/woff2'})
    if 'fonts.gstatic.com' in url: return route.abort()
    m = re.match(r'https://[a-d]\.basemaps\.cartocdn\.com/(dark_all|rastertiles/voyager)/(\d+)/(\d+)/(\d+)(@2x)?\.png', url)
    if m:
        svc = 'Canvas/World_Dark_Gray_Base' if m.group(1) == 'dark_all' else 'World_Street_Map'
        z, x, y = m.group(2), m.group(3), m.group(4)
        return _forward(route, f'{ESRI}{svc}/MapServer/tile/{z}/{y}/{x}')
    if 'data.transportation.gov' in url:
        return _socrata(route, url)
    if route.request.method == 'OPTIONS':
        return route.fulfill(status=204, headers={'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*'})
    if any(hst in url for hst in ('supabase.co', 'cdnjs.cloudflare.com', 'arcgisonline.com', 'project-osrm.org', 'photon.komoot.io', 'data.transportation.gov')):
        return _forward(route, url)
    return route.abort()

CLEAN_JS = """
(() => {
  document.querySelectorAll('[id^="lbc"]').forEach(e => e.remove());
  [...document.querySelectorAll('body>div')].forEach(d => { const z = +getComputedStyle(d).zIndex; if (z >= 3000 && !d.id.startsWith('lb-app') && !d.querySelector('.leaflet-container') && !/map/i.test(d.className+d.id)) d.remove(); });
  [...document.querySelectorAll('button')].filter(b => /ask me later|not now|maybe later|dismiss/i.test(b.textContent)).forEach(b => b.click());
  document.querySelectorAll('.lb-b2t, [class*="backtotop"], [class*="back-to-top"]').forEach(e => e.remove());
})();
"""

def browser(p, w=440, hgt=956, dsf=3):
    b = p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-proxy-server', '--disable-gpu'])
    kw = dict(viewport={'width': w, 'height': hgt}, device_scale_factor=dsf, is_mobile=True, has_touch=True,
              user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1',
              locale='en-US', timezone_id='America/Chicago', color_scheme='dark', geolocation={'latitude':32.7767,'longitude':-96.797,'accuracy':30}, permissions=['geolocation'])
    if os.path.exists(STATE): kw['storage_state'] = STATE
    ctx = b.new_context(**kw)
    ctx.route('**/*', handler)
    ctx.add_init_script("try{localStorage.setItem('lb_whatsnew_seen','999');localStorage.setItem('lb_ios_install_dismissed','1')}catch(e){}")
    page = ctx.new_page()
    page.on('console', lambda m: print('CONSOLE', m.type, m.text[:160]) if m.type in ('error',) else None)
    return b, ctx, page

def clean(page):
    page.evaluate(CLEAN_JS)

def shot(page, name, full=False):
    clean(page); page.wait_for_timeout(400); clean(page)
    path = f'{OUT}/{name}.png'; page.screenshot(path=path, full_page=full); print('SHOT', path); return path

def goto(page, tab, wait=2500):
    page.goto('about:blank'); page.goto(f'{BASE}/app/carrier/#{tab}', wait_until='domcontentloaded'); page.wait_for_timeout(wait)

RM = """(txts)=>{ for (const t of txts){ const el=[...document.querySelectorAll('*')].filter(e=>e.children.length<30 && e.textContent.includes(t)).sort((a,b)=>a.textContent.length-b.textContent.length)[0]; if(!el) continue; let c=el; while(c.parentElement){ const cls=String(c.className); if(/\\bcp-card\\b|cpx-banner/.test(cls)) break; const pp=c.parentElement.parentElement; if(pp && /cp-content/.test(String(pp.className))) break; c=c.parentElement; } if(!/cp-content|cp-main|cp-shell/.test(String(c.className))) c.remove(); } }"""
def rm(page, *txts): page.evaluate(RM, list(txts))
