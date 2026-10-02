"""rss_module.py — builds site/feed.xml (RSS 2.0) from the pages build_site.py already generated.

Used by the LinkedIn Page "RSS source" (and any feed reader). Picks every page whose JSON-LD has
@type Article and a datePublished, newest first. Title = <title> minus the " | LoadBoot" suffix,
description = the page's meta description, date = its own datePublished (never the build date).
Read-only over OUT apart from writing feed.xml; a page it cannot parse is skipped, never fatal.
"""
import os, re, html
from datetime import datetime, timezone

_TITLE = re.compile(r'<title>(.*?)</title>', re.S | re.I)
_DESC = re.compile(r'<meta\s+name="description"\s+content="([^"]*)"', re.I)
_IMG = re.compile(r'<meta\s+property="og:image"\s+content="([^"]*)"', re.I)
_PUB = re.compile(r'"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})')
_ART = re.compile(r'"@type"\s*:\s*"(Article|BlogPosting|NewsArticle)"')
EXCLUDE = {'404.html', 'dashboard.html', 'sitemap.html'}


def _x(s):
    return html.escape(html.unescape(s or '').strip(), quote=True)


def _rfc822(d):
    return datetime.strptime(d, '%Y-%m-%d').replace(hour=12, tzinfo=timezone.utc).strftime('%a, %d %b %Y %H:%M:%S +0000')


def build_rss(out_dir, domain, limit=40):
    items = []
    for f in sorted(os.listdir(out_dir)):
        if not f.endswith('.html') or f in EXCLUDE:
            continue
        try:
            with open(os.path.join(out_dir, f), encoding='utf-8') as fh:
                s = fh.read()
        except Exception:
            continue
        pub = _PUB.findall(s)
        if not pub or not _ART.search(s):
            continue
        t = _TITLE.search(s)
        if not t:
            continue
        title = re.sub(r'\s*\|\s*LoadBoot\s*$', '', html.unescape(t.group(1)).strip())
        d = _DESC.search(s)
        img = _IMG.search(s)
        items.append((min(pub), f, title, d.group(1) if d else title, img.group(1) if img else None))
    items.sort(key=lambda r: (r[0], r[1]), reverse=True)
    items = items[:limit]
    body = []
    for pub, f, title, desc, img in items:
        url = '%s/%s' % (domain, f)
        enc = ('<enclosure url="%s" type="image/png" length="0"/>' % _x(img)) if img and img.lower().endswith('.png') else ''
        body.append('<item><title>%s</title><link>%s</link><guid isPermaLink="true">%s</guid>'
                    '<pubDate>%s</pubDate><description>%s</description>%s</item>'
                    % (_x(title), url, url, _rfc822(pub), _x(desc), enc))
    last = _rfc822(items[0][0]) if items else _rfc822(datetime.now(timezone.utc).strftime('%Y-%m-%d'))
    xml = ('<?xml version="1.0" encoding="UTF-8"?>\n'
           '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>'
           '<title>LoadBoot — Freight Market Reports &amp; Trucking Guides</title>'
           '<link>%s/</link>'
           '<atom:link href="%s/feed.xml" rel="self" type="application/rss+xml"/>'
           '<description>Weekly truckload rate reports and practical guides for carriers, owner-operators, brokers and shippers from LoadBoot.</description>'
           '<language>en-us</language><lastBuildDate>%s</lastBuildDate>%s</channel></rss>\n') % (domain, domain, last, ''.join(body))
    with open(os.path.join(out_dir, 'feed.xml'), 'w', encoding='utf-8') as fh:
        fh.write(xml)
    return len(items)
