#!/usr/bin/env python3
"""gsc-pull.py — the BEFORE read for a Phase 2 page session (LEDGER.md rule: pulled live, never copied).

Usage:
  python3 docs/seo-audit-2026-10/harness/gsc-pull.py hotshot-freight-rates.html            # 28 d + 90 d for one page
  python3 docs/seo-audit-2026-10/harness/gsc-pull.py hotshot-freight-rates.html --days 28  # one window only
  python3 docs/seo-audit-2026-10/harness/gsc-pull.py --site                                # site totals + all pages (re-rank the queue)

Writes docs/seo-audit-2026-10/data/gsc-<slug>-<enddate>.md and prints the ledger BEFORE cells.

Credentials — the first one found wins (BASELINE.md §5):
  A. GOOGLE_SA_KEY_B64 (base64 of the service-account JSON) or GOOGLE_SA_KEY (the JSON itself)
     + optional GSC_SITE_URL (default https://loadboot.com/). Calls the Search Console API directly,
     with server-side page filters, rowLimit up to 25,000. Needs *.googleapis.com reachable.
  B. SEO_PULL_TOKEN (the seo-pull v4 X-SEO-KEY). Goes through the seo-pull edge function's
     passthrough: no filters, rowLimit capped at 1,000 by the function, days capped at 180 —
     so the page's rows are filtered client-side from a `query,page` pull and may be truncated
     (R10 needed 5,000 rows for a complete pull). Good enough for a BEFORE row, say so in the ledger.
Stdlib + `cryptography` only (no google-auth needed).
"""
import base64, json, os, sys, time, datetime as dt, urllib.request, urllib.parse, urllib.error

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, 'data')
SITE = os.environ.get('GSC_SITE_URL') or 'https://loadboot.com/'
SUPABASE_URL = 'https://rwscphuhpjoudvljvmdk.supabase.co'
# The prod publishable (anon) key — public by design; it is in every client page.
SUPABASE_PUBLISHABLE = 'sb_publishable_lHr4JKuHCZEkkjaEh7vx3A_ya_XLG4V'


def _http(url, body=None, headers=None):
    req = urllib.request.Request(url, data=body, headers=headers or {}, method='POST' if body is not None else 'GET')
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


# ---------------------------------------------------------------- credential A: service account
def _sa_json():
    raw = os.environ.get('GOOGLE_SA_KEY') or ''
    b64 = os.environ.get('GOOGLE_SA_KEY_B64') or ''
    if not raw and b64:
        try:
            raw = base64.b64decode(b64.strip() + '=' * (-len(b64.strip()) % 4)).decode()
        except Exception:
            raw = ''
    if not raw:
        return None
    try:
        return json.loads(raw)
    except Exception:
        return None


def _b64url(b):
    return base64.urlsafe_b64encode(b).rstrip(b'=').decode()


def _sa_token(sa):
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import padding
    now = int(time.time())
    header = _b64url(json.dumps({'alg': 'RS256', 'typ': 'JWT'}).encode())
    claim = _b64url(json.dumps({'iss': sa['client_email'], 'scope': 'https://www.googleapis.com/auth/webmasters.readonly',
                                'aud': 'https://oauth2.googleapis.com/token', 'iat': now, 'exp': now + 3600}).encode())
    key = serialization.load_pem_private_key(sa['private_key'].encode(), password=None)
    sig = key.sign(f'{header}.{claim}'.encode(), padding.PKCS1v15(), hashes.SHA256())
    jwt = f'{header}.{claim}.{_b64url(sig)}'
    st, body = _http('https://oauth2.googleapis.com/token',
                     urllib.parse.urlencode({'grant_type': 'urn:ietf:params:oauth:grant-type:jwt-bearer', 'assertion': jwt}).encode(),
                     {'Content-Type': 'application/x-www-form-urlencoded'})
    d = json.loads(body)
    if 'access_token' not in d:
        sys.exit(f'token error {st}: {body[:300]}')
    return d['access_token']


class DirectGSC:
    name = 'direct (service account)'

    def __init__(self, sa):
        self.tok = _sa_token(sa)

    def query(self, start, end, dimensions, row_limit=5000, page=None):
        body = {'startDate': start, 'endDate': end, 'dimensions': dimensions, 'rowLimit': row_limit}
        if page:
            body['dimensionFilterGroups'] = [{'filters': [{'dimension': 'page', 'operator': 'equals', 'expression': page}]}]
        url = f'https://searchconsole.googleapis.com/webmasters/v3/sites/{urllib.parse.quote(SITE, safe="")}/searchAnalytics/query'
        st, txt = _http(url, json.dumps(body).encode(), {'Authorization': f'Bearer {self.tok}', 'Content-Type': 'application/json'})
        if st != 200:
            sys.exit(f'gsc {st}: {txt[:300]}')
        return json.loads(txt).get('rows', [])


# ---------------------------------------------------------------- credential B: seo-pull passthrough
class SeoPull:
    name = 'seo-pull passthrough (rowLimit ≤ 1000, client-side page filter)'

    def __init__(self, token):
        self.token = token

    def _raw(self, days, dimensions, row_limit):
        st, txt = _http(f'{SUPABASE_URL}/functions/v1/seo-pull',
                        json.dumps({'days': days, 'rowLimit': min(row_limit, 1000), 'dimensions': dimensions}).encode(),
                        {'Content-Type': 'application/json', 'apikey': SUPABASE_PUBLISHABLE,
                         'Authorization': f'Bearer {SUPABASE_PUBLISHABLE}', 'x-seo-key': self.token})
        d = json.loads(txt) if txt else {}
        if st != 200 or not d.get('connected'):
            sys.exit(f'seo-pull {st}: {txt[:300]}')
        return d

    def query(self, start, end, dimensions, row_limit=5000, page=None):
        days = (dt.date.fromisoformat(end) - dt.date.fromisoformat(start)).days
        if page:
            dims = ['page'] if not dimensions else ['page'] + [d for d in dimensions if d != 'page']
            rows = self._raw(days, dims, row_limit)['rows']
            out = []
            for r in rows:
                if r['keys'][0] == page:
                    out.append({**r, 'keys': r['keys'][1:]})
            return out
        return self._raw(days, dimensions or [], row_limit)['rows']


def client():
    sa = _sa_json()
    if sa:
        return DirectGSC(sa)
    tok = (os.environ.get('SEO_PULL_TOKEN') or '').strip()
    if tok:
        return SeoPull(tok)
    sys.exit('No GSC credential in the environment. Set GOOGLE_SA_KEY_B64 (service-account JSON, base64 — it is '
             'currently defined but EMPTY) or SEO_PULL_TOKEN (the seo-pull v4 X-SEO-KEY from project memory '
             'seo_measurement.md). BASELINE.md §5 has the three options.')


# ---------------------------------------------------------------- report
def window(days):
    end = dt.date.today() - dt.timedelta(days=2)  # GSC lags ~2 days, same as seo-pull
    return (end - dt.timedelta(days=days)).isoformat(), end.isoformat()


def fmt(r):
    return f"{int(r.get('clicks', 0))} / {int(r.get('impressions', 0))} / {100 * r.get('ctr', 0):.2f} % / {r.get('position', 0):.1f}"


def page_session(c, slug, days_list):
    url = SITE.rstrip('/') + '/' + slug
    today = dt.date.today().isoformat()
    md = [f'# GSC BEFORE read — `{slug}` — pulled {today} via {c.name}', '', f'Site: `{SITE}` · URL: `{url}`', '']
    ledger = {}
    for days in days_list:
        s, e = window(days)
        tot = c.query(s, e, [], page=url)
        totals = tot[0] if tot else {'clicks': 0, 'impressions': 0, 'ctr': 0, 'position': 0}
        qs = c.query(s, e, ['query'], page=url)
        qs.sort(key=lambda r: -r.get('impressions', 0))
        md += [f'## {days} d window {s} → {e}', '', f'**Page totals (clicks / impr / CTR / pos): {fmt(totals)}**', '',
               '| # | query | clicks | impr | CTR | pos |', '|---|---|---|---|---|---|']
        for i, r in enumerate(qs, 1):
            md.append(f"| {i} | {r['keys'][0]} | {int(r['clicks'])} | {int(r['impressions'])} | {100 * r['ctr']:.1f} % | {r['position']:.1f} |")
        md += ['', f'{len(qs)} queries with impressions.', '']
        top3 = ' · '.join(f"{r['keys'][0]} {int(r['impressions'])} @ {r['position']:.1f}" for r in qs[:3])
        ledger[days] = (fmt(totals), top3, f'{s}→{e}')
    os.makedirs(DATA, exist_ok=True)
    out = os.path.join(DATA, f"gsc-{slug.replace('.html', '')}-{window(28)[1]}.md")
    open(out, 'w').write('\n'.join(md))
    print('wrote', os.path.relpath(out, os.getcwd()))
    for days, (t, top3, w) in ledger.items():
        print(f'LEDGER BEFORE {days} d ({w}): page {t} | top-3 {top3}')


def site_read(c, days):
    s, e = window(days)
    tot = c.query(s, e, [])
    pages = c.query(s, e, ['page'], row_limit=5000)
    pages.sort(key=lambda r: -r.get('impressions', 0))
    print(f'site {days} d {s}→{e}: {fmt(tot[0]) if tot else "no rows"}  ({len(pages)} pages)')
    for r in pages[:80]:
        print(f"{r['keys'][0].replace(SITE, '/'):60} {fmt(r)}")


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    days = [28, 90]
    if '--days' in sys.argv:
        days = [int(sys.argv[sys.argv.index('--days') + 1])]
        args = [a for a in args if a != str(days[0])]
    c = client()
    if '--site' in sys.argv:
        site_read(c, days[0])
    elif args:
        page_session(c, args[0], days)
    else:
        sys.exit(__doc__)
