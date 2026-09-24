#!/usr/bin/env python3
"""Phase 2 SEO — Session 0 site-wide crawl (source HTML), stdlib only.

  python3 docs/seo-audit-2026-10/harness/seo-crawl.py [--live] [--out docs/seo-audit-2026-10]

Reads the built site in ./site (run build_site.py first) and site/sitemap.xml.
For every sitemap URL: title / description / H1 / canonical / OG / Twitter / JSON-LD /
robots meta / images (alt, dimensions, weight) / internal links (broken, anchors) /
inbound-link graph (orphans) / HTML weight. Cross-page: duplicate titles, descriptions,
H1s; sitemap vs built-file diff. --live also GETs https://loadboot.com/<path> (status,
redirect chain, live title/canonical vs built) and the extensionless variant.

Writes <out>/data/crawl.json, <out>/data/crawl.csv and prints a Markdown report on
stdout (the caller redirects it into BASELINE.md and edits the prose around it).
"""
import csv, json, os, re, sys, time, urllib.request, urllib.error, urllib.parse
from collections import Counter, defaultdict
from html.parser import HTMLParser

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
SITE = os.path.join(ROOT, 'site')
DOMAIN = 'https://loadboot.com'
LIVE = '--live' in sys.argv
OUT = os.path.join(ROOT, 'docs', 'seo-audit-2026-10')
if '--out' in sys.argv: OUT = os.path.abspath(sys.argv[sys.argv.index('--out') + 1])
os.makedirs(os.path.join(OUT, 'data'), exist_ok=True)

VOID = {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}
CHROME = {'header','nav','footer'}          # regions whose links are "chrome", not content
SKIP_TEXT = {'script','style','noscript','template','svg'}

class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title = None; self.desc = None; self.robots = None; self.canonical = None
        self.lang = None; self.viewport = None; self.og = {}; self.tw = {}; self.jsonld = []
        self.h = []; self.links = []; self.imgs = []; self.ids = set(); self.hreflang = []
        self.words = 0; self.stack = []; self.chrome = 0; self.skip = 0; self.main_seen = False
        self._cap = None; self._ld = None; self._in_title = False
    def start(self, tag, attrs):
        a = dict(attrs)
        if 'id' in a: self.ids.add(a['id'])
        if tag in CHROME: self.chrome += 1
        if tag == 'main': self.main_seen = True
        if tag in SKIP_TEXT: self.skip += 1
        if tag == 'html': self.lang = a.get('lang')
        elif tag == 'title': self._in_title = True; self.title = ''
        elif tag == 'meta':
            n = (a.get('name') or '').lower(); p = (a.get('property') or '').lower(); c = a.get('content', '')
            if n == 'description': self.desc = c
            elif n == 'robots': self.robots = c
            elif n == 'viewport': self.viewport = c
            elif p.startswith('og:'): self.og.setdefault(p[3:], c)
            elif n.startswith('twitter:'): self.tw.setdefault(n[8:], c)
        elif tag == 'link':
            rel = (a.get('rel') or '').lower().split()
            if 'canonical' in rel: self.canonical = a.get('href')
            if 'alternate' in rel and a.get('hreflang'): self.hreflang.append((a['hreflang'], a.get('href')))
        elif tag == 'script' and (a.get('type') or '').lower() == 'application/ld+json':
            self._ld = ''
        elif tag in ('h1','h2','h3','h4'):
            self._cap = [tag, '', self.chrome > 0]
        elif tag == 'a' and a.get('href') is not None:
            self.links.append({'href': a['href'], 'text': '', 'chrome': self.chrome > 0, 'rel': a.get('rel') or ''})
            self._acur = self.links[-1]
        elif tag == 'img':
            self.imgs.append({'src': a.get('src') or a.get('data-src') or '', 'alt': a.get('alt'), 'w': a.get('width'), 'h': a.get('height'),
                              'loading': a.get('loading'), 'chrome': self.chrome > 0})
    def handle_starttag(self, tag, attrs):
        self.start(tag, attrs)
        if tag not in VOID: self.stack.append(tag)
    def handle_startendtag(self, tag, attrs): self.start(tag, attrs)
    def handle_endtag(self, tag):
        if tag in CHROME and self.chrome: self.chrome -= 1
        if tag in SKIP_TEXT and self.skip: self.skip -= 1
        if tag == 'title': self._in_title = False
        if tag == 'script' and self._ld is not None: self.jsonld.append(self._ld); self._ld = None
        if tag in ('h1','h2','h3','h4') and self._cap: self.h.append((self._cap[0], ' '.join(self._cap[1].split()), self._cap[2])); self._cap = None
        if tag == 'a' and getattr(self, '_acur', None) is not None: self._acur['text'] = ' '.join(self._acur['text'].split())[:80]; self._acur = None
        if self.stack and self.stack[-1] == tag: self.stack.pop()
    def handle_data(self, d):
        if self._in_title: self.title += d
        if self._ld is not None: self._ld += d; return
        if self.skip: return
        if self._cap: self._cap[1] += d
        if getattr(self, '_acur', None) is not None: self._acur['text'] += d
        if not self.chrome and d.strip(): self.words += len(d.split())

def sitemap_paths():
    sm = open(os.path.join(SITE, 'sitemap.xml'), encoding='utf-8').read()
    return [m or 'index.html' for m in re.findall(r'<loc>https://loadboot\.com/([^<]*)</loc>', sm)]

def redirects():
    r = {}
    for ln in open(os.path.join(SITE, '_redirects'), encoding='utf-8'):
        ln = ln.strip()
        if not ln or ln.startswith('#'): continue
        parts = ln.split()
        if len(parts) >= 2: r[parts[0]] = (parts[1], parts[2] if len(parts) > 2 else '301')
    return r

def norm(href, frm):
    """Return (kind, path, fragment). kind: internal | external | mailto | tel | js | other."""
    h = href.strip()
    low = h.lower()
    if low.startswith('mailto:'): return ('mailto', h, '')
    if low.startswith('tel:') or low.startswith('sms:'): return ('tel', h, '')
    if low.startswith('javascript:'): return ('js', h, '')
    if h.startswith('#'): return ('internal', frm, h[1:])
    u = urllib.parse.urlsplit(h)
    if u.scheme and u.netloc and u.netloc not in ('loadboot.com', 'www.loadboot.com'): return ('external', h, '')
    if u.scheme and u.netloc in ('loadboot.com', 'www.loadboot.com'): p = u.path
    elif u.scheme: return ('other', h, '')
    else: p = u.path
    if p in ('', '/'): p = '/index.html' if p == '/' or h.startswith('/') or h == '' else frm
    if not p.startswith('/'):
        p = '/' + os.path.normpath(os.path.join(os.path.dirname('/' + frm), p)).lstrip('/')
    return ('internal', p, u.fragment)

def exists(p):
    fs = os.path.join(SITE, p.lstrip('/'))
    if os.path.isdir(fs): return os.path.exists(os.path.join(fs, 'index.html'))
    return os.path.isfile(fs)

def fetch(url, follow=False, timeout=25):
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k): return None
    op = urllib.request.build_opener(NoRedirect)
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (compatible; LoadBoot-SEO-baseline/1.0)'})
    try:
        with op.open(req, timeout=timeout) as r: return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e: return e.code, dict(e.headers), b''
    except Exception as e: return 0, {'X-Error': str(e)[:120]}, b''

def chain(url):
    hops = []; body = b''; hdrs = {}
    for _ in range(6):
        st, hdrs, body = fetch(url)
        hops.append((st, url))
        if st in (301, 302, 307, 308) and hdrs.get('Location'): url = urllib.parse.urljoin(url, hdrs['Location']); continue
        break
    return hops, hdrs, body

def check_ld(obj, path='$'):
    """Return list of problems for one JSON-LD node (recursing @graph)."""
    probs = []
    if isinstance(obj, list):
        for i, o in enumerate(obj): probs += check_ld(o, f'{path}[{i}]')
        return probs
    if not isinstance(obj, dict): return [f'{path}: not an object']
    if '@graph' in obj: probs += check_ld(obj['@graph'], path + '.@graph')
    t = obj.get('@type')
    if not t and '@graph' not in obj: probs.append(f'{path}: no @type')
    if path == '$' and '@context' not in obj: probs.append('$: no @context')
    ts = t if isinstance(t, list) else [t]
    need = {'Article': ['headline','datePublished','author','image'], 'BlogPosting': ['headline','datePublished','author','image'], 'NewsArticle': ['headline','datePublished','author','image'],
            'FAQPage': ['mainEntity'], 'BreadcrumbList': ['itemListElement'], 'Product': ['name'], 'Offer': ['price','priceCurrency'], 'Service': ['name','provider'],
            'Organization': ['name','url'], 'WebSite': ['name','url'], 'HowTo': ['name','step'], 'LocalBusiness': ['name','address'], 'Dataset': ['name','description'], 'WebPage': ['name']}
    for tt in ts:
        for k in need.get(tt or '', []):
            if k not in obj: probs.append(f'{path} {tt}: missing {k}')
        if tt == 'FAQPage':
            for i, q in enumerate(obj.get('mainEntity') or []):
                if not isinstance(q, dict) or q.get('@type') != 'Question' or not q.get('name') or not isinstance(q.get('acceptedAnswer'), dict) or not q['acceptedAnswer'].get('text'):
                    probs.append(f'{path} FAQPage.mainEntity[{i}] malformed')
        if tt == 'BreadcrumbList':
            for i, it in enumerate(obj.get('itemListElement') or []):
                if not isinstance(it, dict) or it.get('position') is None or not (it.get('item') or it.get('name')): probs.append(f'{path} Breadcrumb[{i}] malformed')
        if tt in ('Article','BlogPosting','NewsArticle') and len(str(obj.get('headline',''))) > 110: probs.append(f'{path} headline > 110 chars')
    return probs

def ld_types(obj):
    out = []
    if isinstance(obj, list):
        for o in obj: out += ld_types(o)
    elif isinstance(obj, dict):
        if obj.get('@type'): out.append(obj['@type'] if isinstance(obj['@type'], str) else '/'.join(obj['@type']))
        if '@graph' in obj: out += ld_types(obj['@graph'])
    return out

# ---------------------------------------------------------------- crawl
paths = sitemap_paths()
built = sorted(f for f in os.listdir(SITE) if f.endswith('.html'))
rmap = redirects()
pages = {}
ids_by_page = {}
for p in built:                       # parse every built page (need ids + links from the 6 unlisted ones too)
    raw = open(os.path.join(SITE, p), encoding='utf-8', errors='replace').read()
    pg = Page(); pg.feed(raw)
    pages[p] = pg; pg.bytes = len(raw.encode('utf-8')); pg.raw_h1_count = len(re.findall(r'<h1[\s>]', raw, re.I))
    ids_by_page[p] = pg.ids

inbound_content = defaultdict(set); inbound_any = defaultdict(set); anchors_in = defaultdict(Counter)
rows = []; broken = []; frag_broken = []; redirected_links = []; ext_domains = Counter(); ld_problems = []
img_weight_cache = {}
def img_weight(src):
    p = urllib.parse.urlsplit(src).path.lstrip('/')
    if src.startswith('http') and 'loadboot.com' not in src: return None
    fs = os.path.join(SITE, p)
    if fs not in img_weight_cache: img_weight_cache[fs] = os.path.getsize(fs) if os.path.isfile(fs) else -1
    return img_weight_cache[fs]

for p in built:
    pg = pages[p]
    for l in pg.links:
        kind, tgt, frag = norm(l['href'], p)
        if kind == 'external': ext_domains[urllib.parse.urlsplit(tgt).netloc] += 1; continue
        if kind != 'internal': continue
        tp = tgt.lstrip('/') or 'index.html'
        if tgt in rmap:
            redirected_links.append((p, l['href'], rmap[tgt][0])); tp = rmap[tgt][0].lstrip('/')
        if not exists('/' + tp):
            if not tp.startswith('app/'): broken.append((p, l['href'], l['text'], 'chrome' if l['chrome'] else 'content'))
            continue
        if frag and tp in ids_by_page and frag not in ids_by_page[tp] and not frag.startswith(':~:'):
            frag_broken.append((p, l['href'], 'chrome' if l['chrome'] else 'content'))
        if tp != p:
            inbound_any[tp].add(p)
            if not l['chrome'] and p != 'sitemap.html': inbound_content[tp].add(p); anchors_in[tp][l['text'][:60]] += 1

live = {}
if LIVE:
    print('live-checking %d URLs …' % len(paths), file=sys.stderr)
    for i, p in enumerate(paths):
        url = DOMAIN + '/' + ('' if p == 'index.html' else p)
        hops, hdrs, body = chain(url)
        lp = Page()
        try: lp.feed(body.decode('utf-8', 'replace'))
        except Exception: pass
        bare = None
        if p != 'index.html':
            bh, _, _ = chain(DOMAIN + '/' + p[:-5])
            bare = ' → '.join(str(h[0]) for h in bh) + (' ok' if bh and bh[-1][1] == url and bh[-1][0] == 200 else ' ' + (bh[-1][1] if bh else '?'))
        live[p] = {'status': hops[-1][0], 'hops': len(hops) - 1, 'chain': hops, 'ct': hdrs.get('Content-Type', ''), 'cache': hdrs.get('Cache-Control', ''),
                   'xrobots': hdrs.get('X-Robots-Tag', ''), 'title': (lp.title or '').strip(), 'canonical': lp.canonical, 'desc': lp.desc, 'bytes': len(body), 'bare': bare,
                   'err': hdrs.get('X-Error')}
        if i % 20 == 19: print('  %d/%d' % (i + 1, len(paths)), file=sys.stderr)

# ---------------------------------------------------------------- per-page rows
def flag(cond, s, lst):
    if cond: lst.append(s)
for p in paths:
    pg = pages.get(p)
    if not pg: rows.append({'page': p, 'issues': ['NOT BUILT']}); continue
    url = DOMAIN + '/' + ('' if p == 'index.html' else p)
    url_html = DOMAIN + '/' + p
    title = (pg.title or '').strip(); desc = (pg.desc or '').strip()
    h1 = [t for tag, t, ch in pg.h if tag == 'h1']
    h1_content = [t for tag, t, ch in pg.h if tag == 'h1' and not ch]
    h2 = [t for tag, t, ch in pg.h if tag == 'h2' and not ch]
    lds = []; ldp = []
    for s in pg.jsonld:
        try: o = json.loads(s); lds += ld_types(o); ldp += check_ld(o)
        except Exception as e: ldp.append('JSON parse error: %s' % str(e)[:60])
    imgs = [i for i in pg.imgs if not i['chrome']]
    noalt = [i['src'] for i in imgs if i['alt'] is None]
    emptyalt = [i['src'] for i in imgs if i['alt'] == '']
    nodim = [i['src'] for i in imgs if not (i['w'] and i['h'])]
    heavy = [(i['src'], img_weight(i['src'])) for i in imgs if (img_weight(i['src']) or 0) > 200_000]
    missing_img = [i['src'] for i in imgs if img_weight(i['src']) == -1]
    iss = []
    flag(not title, 'no title', iss); flag(len(title) > 60, 'title %d chars' % len(title), iss); flag(0 < len(title) < 30, 'title short %d' % len(title), iss)
    flag(not desc, 'no description', iss); flag(len(desc) > 160, 'desc %d chars' % len(desc), iss); flag(0 < len(desc) < 70, 'desc short %d' % len(desc), iss)
    flag(len(h1) == 0, 'no H1', iss); flag(len(h1) > 1, '%d H1s' % len(h1), iss)
    flag(not pg.canonical, 'no canonical', iss)
    flag(pg.canonical and pg.canonical not in (url, url_html), 'canonical ≠ self (%s)' % pg.canonical, iss)
    flag(pg.canonical == url_html and p == 'index.html', 'canonical is /index.html', iss)
    for k in ('title', 'description', 'image', 'url'): flag(k not in pg.og, 'no og:%s' % k, iss)
    flag(pg.og.get('image', 'http').startswith('/') or (pg.og.get('image') and not pg.og['image'].startswith('http')), 'og:image relative', iss)
    flag(pg.og.get('url') and pg.og['url'] not in (url, url_html), 'og:url ≠ canonical', iss)
    flag('card' not in pg.tw, 'no twitter:card', iss)
    flag(not pg.jsonld, 'no JSON-LD', iss)
    for x in ldp: iss.append('LD: ' + x)
    flag(pg.robots and 'noindex' in pg.robots.lower(), 'NOINDEX', iss)
    flag(bool(noalt), '%d img no alt' % len(noalt), iss); flag(bool(nodim), '%d img no w/h' % len(nodim), iss)
    flag(bool(heavy), 'heavy img: ' + ', '.join('%s %dKB' % (os.path.basename(s), w // 1024) for s, w in heavy), iss)
    flag(bool(missing_img), 'img 404: ' + ', '.join(missing_img), iss)
    flag(pg.words < 300, 'thin: %d words' % pg.words, iss)
    flag(len(inbound_content.get(p, ())) == 0, 'ORPHAN (no content inbound)', iss)
    flag(pg.lang != 'en', 'lang=%s' % pg.lang, iss)
    flag(not pg.main_seen, 'no <main>', iss)
    lv = live.get(p)
    if lv:
        flag(lv['status'] != 200, 'LIVE %s' % lv['status'], iss); flag(lv['hops'] > 0, 'LIVE %d redirect(s)' % lv['hops'], iss)
        flag(lv['title'] and lv['title'] != title, 'LIVE title differs', iss)
        flag(lv['canonical'] and lv['canonical'] != pg.canonical, 'LIVE canonical differs', iss)
        flag(lv['xrobots'] and 'noindex' in lv['xrobots'].lower(), 'LIVE X-Robots noindex', iss)
        flag(bool(lv['bare']) and not lv['bare'].endswith(' ok'), 'bare URL: %s' % lv['bare'], iss)
    rows.append({'page': p, 'url': url, 'title': title, 'title_len': len(title), 'desc': desc, 'desc_len': len(desc), 'h1': h1, 'h1_content': h1_content, 'h2_count': len(h2),
                 'canonical': pg.canonical, 'og': pg.og, 'tw': pg.tw, 'ld_types': lds, 'ld_problems': ldp, 'robots': pg.robots, 'words': pg.words, 'bytes': pg.bytes,
                 'imgs': len(imgs), 'img_noalt': noalt, 'img_emptyalt': emptyalt, 'img_nodim': nodim, 'img_heavy': heavy,
                 'links_out_content': len([l for l in pg.links if not l['chrome']]), 'inbound_content': sorted(inbound_content.get(p, ())), 'inbound_any': len(inbound_any.get(p, ())),
                 'top_anchors': anchors_in[p].most_common(3), 'live': lv, 'issues': iss})

# ---------------------------------------------------------------- cross-page
def dupes(key):
    c = defaultdict(list)
    for r in rows:
        v = (r.get(key) or '')
        if isinstance(v, list): v = ' | '.join(v)
        if v: c[v.strip().lower()].append(r['page'])
    return {k: v for k, v in c.items() if len(v) > 1}
dup_title = dupes('title'); dup_desc = dupes('desc'); dup_h1 = dupes('h1')
unlisted = [b for b in built if b not in paths]
notbuilt = [p for p in paths if p not in pages]

json.dump({'generated': time.strftime('%Y-%m-%d %H:%M UTC', time.gmtime()), 'live': LIVE, 'pages': rows, 'broken': broken, 'frag_broken': frag_broken,
           'redirected_links': redirected_links, 'dup_title': dup_title, 'dup_desc': dup_desc, 'dup_h1': dup_h1, 'unlisted': unlisted, 'notbuilt': notbuilt,
           'ext_domains': ext_domains.most_common()}, open(os.path.join(OUT, 'data', 'crawl.json'), 'w'), indent=1, ensure_ascii=False)
with open(os.path.join(OUT, 'data', 'crawl.csv'), 'w', newline='') as f:
    w = csv.writer(f); w.writerow(['page','live_status','title_len','desc_len','h1_count','words','html_kb','imgs','img_noalt','inbound_content','inbound_any','ld_types','issues'])
    for r in rows:
        w.writerow([r['page'], (r.get('live') or {}).get('status', ''), r.get('title_len'), r.get('desc_len'), len(r.get('h1') or []), r.get('words'), round((r.get('bytes') or 0) / 1024),
                    r.get('imgs'), len(r.get('img_noalt') or []), len(r.get('inbound_content') or []), r.get('inbound_any'), '/'.join(r.get('ld_types') or []), '; '.join(r['issues'])])

# ---------------------------------------------------------------- report
o = []
P = o.append
def cnt(pred): return sum(1 for r in rows if pred(r))
def li(items, n=40):
    for x in items[:n]: P('- ' + x)
    if len(items) > n: P('- … %d more (see data/crawl.csv)' % (len(items) - n))
P('## Crawl summary (source HTML of the build at HEAD%s)' % (', live-checked' if LIVE else ''))
P('')
P('| Metric | Value |'); P('|---|---|')
P('| Sitemap URLs | %d |' % len(paths))
P('| Built .html files | %d (%d not in sitemap: %s) |' % (len(built), len(unlisted), ', '.join(unlisted)))
P('| Sitemap URLs not built | %d %s |' % (len(notbuilt), ', '.join(notbuilt)))
if LIVE:
    P('| Live 200 / other | %d / %d |' % (cnt(lambda r: (r.get('live') or {}).get('status') == 200), cnt(lambda r: (r.get('live') or {}).get('status') != 200)))
    P('| Live URLs that redirect | %d |' % cnt(lambda r: (r.get('live') or {}).get('hops', 0) > 0))
    P('| Live title ≠ built title | %d |' % cnt(lambda r: 'LIVE title differs' in r['issues']))
    P('| Extensionless URL not 301→.html | %d |' % cnt(lambda r: any(i.startswith('bare URL') for i in r['issues'])))
P('| Pages with no issues flagged | %d |' % cnt(lambda r: not r['issues']))
P('| Title > 60 chars | %d |' % cnt(lambda r: r.get('title_len', 0) > 60))
P('| Description > 160 / < 70 / missing | %d / %d / %d |' % (cnt(lambda r: r.get('desc_len', 0) > 160), cnt(lambda r: 0 < r.get('desc_len', 0) < 70), cnt(lambda r: not r.get('desc'))))
P('| Duplicate titles (groups) | %d |' % len(dup_title))
P('| Duplicate descriptions (groups) | %d |' % len(dup_desc))
P('| Duplicate H1s (groups) | %d |' % len(dup_h1))
P('| H1 count ≠ 1 | %d |' % cnt(lambda r: len(r.get('h1') or []) != 1))
P('| Canonical missing / ≠ self | %d / %d |' % (cnt(lambda r: 'no canonical' in r['issues']), cnt(lambda r: any(i.startswith('canonical ≠') for i in r['issues']))))
P('| OG incomplete | %d |' % cnt(lambda r: any(i.startswith('no og:') for i in r['issues'])))
P('| No twitter:card | %d |' % cnt(lambda r: 'no twitter:card' in r['issues']))
P('| No JSON-LD / JSON-LD problems | %d / %d |' % (cnt(lambda r: 'no JSON-LD' in r['issues']), cnt(lambda r: bool(r.get('ld_problems')))))
P('| Images without alt (pages / images) | %d / %d |' % (cnt(lambda r: bool(r.get('img_noalt'))), sum(len(r.get('img_noalt') or []) for r in rows)))
P('| Images without width/height (pages) | %d |' % cnt(lambda r: bool(r.get('img_nodim'))))
P('| Pages with an image > 200 KB | %d |' % cnt(lambda r: bool(r.get('img_heavy'))))
P('| Thin pages (< 300 content words) | %d |' % cnt(lambda r: r.get('words', 0) < 300))
P('| Orphans (no in-content inbound link, chrome + sitemap.html excluded) | %d |' % cnt(lambda r: 'ORPHAN (no content inbound)' in r['issues']))
P('| Broken internal links (instances) | %d |' % len(broken))
P('| Broken #fragment links (instances) | %d |' % len(frag_broken))
P('| Internal links that hit a redirect (instances) | %d |' % len(redirected_links))
P('| Noindex pages | %d |' % cnt(lambda r: 'NOINDEX' in r['issues']))
P('| HTML weight median / max | %d KB / %d KB |' % (sorted(r.get('bytes', 0) for r in rows)[len(rows) // 2] // 1024, max(r.get('bytes', 0) for r in rows) // 1024))
P('')
if LIVE:
    P('### Live status (anything not a clean 200)'); P('')
    bad = [r for r in rows if r.get('live') and (r['live']['status'] != 200 or r['live']['hops'] or r['live']['err'])]
    li(['`%s` — %s' % (r['page'], ' → '.join('%s %s' % (s, u.replace(DOMAIN, '')) for s, u in r['live']['chain']) + (' ' + r['live']['err'] if r['live']['err'] else '')) for r in bad] or ['none'])
    P('')
    P('### Live ≠ built (prod is behind or ahead of this commit)'); P('')
    li(['`%s` — live title: "%s" · built: "%s"' % (r['page'], r['live']['title'][:90], r['title'][:90]) for r in rows if 'LIVE title differs' in r['issues']] or ['none — live titles match the build'])
    li(['`%s` — live canonical %s · built %s' % (r['page'], r['live']['canonical'], r['canonical']) for r in rows if 'LIVE canonical differs' in r['issues']])
    bare = [r for r in rows if any(i.startswith('bare URL') for i in r['issues'])]
    if bare: P(''); P('### Extensionless variant not consolidating'); P(''); li(['`/%s` — %s' % (r['page'][:-5], r['live']['bare']) for r in bare])
    P('')
P('### Duplicate titles'); P('')
li(['"%s" — %s' % (k[:100], ', '.join(v)) for k, v in sorted(dup_title.items(), key=lambda kv: -len(kv[1]))] or ['none'])
P(''); P('### Duplicate meta descriptions'); P('')
li(['"%s…" — %s' % (k[:90], ', '.join(v)) for k, v in sorted(dup_desc.items(), key=lambda kv: -len(kv[1]))] or ['none'])
P(''); P('### Duplicate H1s'); P('')
li(['"%s" — %s' % (k[:100], ', '.join(v)) for k, v in sorted(dup_h1.items(), key=lambda kv: -len(kv[1]))] or ['none'])
P(''); P('### H1 count ≠ 1'); P('')
li(['`%s` — %d: %s' % (r['page'], len(r.get('h1') or []), ' | '.join(x[:50] for x in (r.get('h1') or []))) for r in rows if len(r.get('h1') or []) != 1] or ['none'])
P(''); P('### Titles over 60 characters (Google truncates ~600 px ≈ 60 chars)'); P('')
li(['`%s` — %d: "%s"' % (r['page'], r['title_len'], r['title']) for r in sorted(rows, key=lambda r: -r.get('title_len', 0)) if r.get('title_len', 0) > 60] or ['none'])
P(''); P('### Descriptions over 160 or under 70 characters'); P('')
li(['`%s` — %d' % (r['page'], r['desc_len']) for r in sorted(rows, key=lambda r: -r.get('desc_len', 0)) if r.get('desc_len', 0) > 160 or 0 < r.get('desc_len', 0) < 70] or ['none'])
P(''); P('### Canonical / OG / Twitter problems'); P('')
li(['`%s` — %s' % (r['page'], '; '.join(i for i in r['issues'] if i.startswith(('no canonical','canonical','no og:','og:','no twitter')))) for r in rows if any(i.startswith(('no canonical','canonical','no og:','og:','no twitter')) for i in r['issues'])] or ['none'])
P(''); P('### JSON-LD'); P('')
tc = Counter(t for r in rows for t in set(r.get('ld_types') or []))
P('Types present (pages): ' + ', '.join('%s %d' % kv for kv in tc.most_common()))
P('')
li(['`%s` — %s' % (r['page'], '; '.join(r['ld_problems']))  for r in rows if r.get('ld_problems')] or ['no structural problems found by the light validator'])
li(['`%s` — no JSON-LD at all' % r['page'] for r in rows if 'no JSON-LD' in r['issues']])
P(''); P('### Broken internal links'); P('')
li(['`%s` → `%s` ("%s", %s)' % b for b in broken] or ['none'])
P(''); P('### Broken #fragment links (target id not on the page)'); P('')
li(['`%s` → `%s` (%s)' % b for b in frag_broken] or ['none'])
P(''); P('### Internal links that go through a redirect'); P('')
li(['`%s` → `%s` (301 → `%s`)' % b for b in redirected_links] or ['none'])
P(''); P('### Orphans — sitemap pages no other page links to from its content'); P('')
P('Chrome (header/nav/footer) links and sitemap.html are ignored; "any" = inbound counting chrome too.'); P('')
li(['`%s` — inbound any: %d' % (r['page'], r['inbound_any']) for r in rows if 'ORPHAN (no content inbound)' in r['issues']] or ['none'])
P(''); P('### Weakly linked (1–2 in-content inbound links)'); P('')
li(['`%s` — %d: %s' % (r['page'], len(r['inbound_content']), ', '.join(r['inbound_content'])) for r in rows if 0 < len(r.get('inbound_content') or []) <= 2] or ['none'])
P(''); P('### Images'); P('')
li(['`%s` — %d without alt: %s' % (r['page'], len(r['img_noalt']), ', '.join(os.path.basename(s) for s in r['img_noalt'][:5])) for r in rows if r.get('img_noalt')] or ['every content image has an alt attribute'])
li(['`%s` — > 200 KB: %s' % (r['page'], ', '.join('%s %d KB' % (os.path.basename(s), w // 1024) for s, w in r['img_heavy'])) for r in rows if r.get('img_heavy')])
li(['`%s` — %d img without width/height' % (r['page'], len(r['img_nodim'])) for r in rows if r.get('img_nodim')])
P(''); P('### Thin pages (< 300 words outside header/nav/footer)'); P('')
li(['`%s` — %d words' % (r['page'], r['words']) for r in sorted(rows, key=lambda r: r.get('words', 0)) if r.get('words', 0) < 300] or ['none'])
P(''); P('### Sitemap vs build'); P('')
P('Built but not in sitemap: ' + (', '.join('`%s`' % u for u in unlisted) or 'none'))
P('In sitemap but not built: ' + (', '.join('`%s`' % u for u in notbuilt) or 'none'))
P('robots.txt: ' + open(os.path.join(SITE, 'robots.txt')).read().strip().replace('\n', ' · '))
P('sitemap.xml: %d `<url>` entries, `<changefreq>` only — no `<lastmod>` (Google ignores changefreq/priority; lastmod is the one field it reads).' % len(paths))
P(''); P('### External link targets (domains, link instances across all built pages)'); P('')
P(', '.join('%s %d' % kv for kv in ext_domains.most_common(25)))
P(''); P('## Per-page table'); P('')
P('| Page | Live | Title | Desc | H1 | Words | KB | Imgs | In-links | JSON-LD | Issues |'); P('|---|---|---|---|---|---|---|---|---|---|---|')
for r in rows:
    lv = r.get('live') or {}
    P('| `%s` | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |' % (r['page'], lv.get('status', '—'), r.get('title_len'), r.get('desc_len'), len(r.get('h1') or []), r.get('words'), round((r.get('bytes') or 0) / 1024),
        r.get('imgs'), '%d/%d' % (len(r.get('inbound_content') or []), r.get('inbound_any') or 0), '/'.join(sorted(set(r.get('ld_types') or []))) or '—', '; '.join(r['issues']).replace('|', '¦') or '—'))
print('\n'.join(o))
print('data: %s/data/crawl.json, crawl.csv' % OUT, file=sys.stderr)
