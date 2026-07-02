#!/usr/bin/env python3
"""GRAND SWEEP auditor — machine-checks every built page for SEO / accessibility /
mobile / links / content-CTA. Run after build_site.py. Exit 1 on any FAIL."""
import os, re, sys, json, glob
from html import unescape

SITE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'site')
UTILITY = {'404.html', 'dashboard.html', 'login.html', 'sitemap.html'}  # relaxed checks
CTA_PAT = re.compile(r'href="[^"]*(carrier-application|contact|/app/|signup|referral\.html|pricing)', re.I)

def attr(tag, name):
    m = re.search(name + r'\s*=\s*"([^"]*)"', tag, re.I)
    return m.group(1) if m else None

def audit(path):
    fails, warns = [], []
    page = os.path.basename(path)
    html = open(path, encoding='utf-8', errors='replace').read()
    head = html.split('</head>', 1)[0]
    is_util = page in UTILITY or 'name="robots" content="noindex"' in head

    # ---------- SEO ----------
    t = re.search(r'<title[^>]*>(.*?)</title>', head, re.S)
    title = unescape(t.group(1).strip() if t else '')
    if not title: fails.append('SEO: missing <title>')
    elif not is_util and not (20 <= len(title) <= 70): warns.append(f'SEO: title length {len(title)} (aim 20-70)')
    d = re.search(r'<meta\s+name="description"\s+content="([^"]*)"', head, re.I) or \
        re.search(r'<meta\s+content="([^"]*)"\s+name="description"', head, re.I)
    if not d: fails.append('SEO: missing meta description') if not is_util else warns.append('SEO: no meta description (utility)')
    elif not is_util and not (60 <= len(unescape(d.group(1))) <= 170): warns.append(f'SEO: meta desc length {len(unescape(d.group(1)))} (aim 60-170)')
    if not is_util:
        if 'rel="canonical"' not in head: fails.append('SEO: missing canonical')
        for og in ('og:title', 'og:description', 'og:image'):
            if og not in head: fails.append(f'SEO: missing {og}')
        if 'twitter:card' not in head: warns.append('SEO: missing twitter:card')
        if 'application/ld+json' not in html: warns.append('SEO: no JSON-LD structured data')
    h1s = re.findall(r'<h1[\s>]', html)
    if not is_util:
        if len(h1s) == 0: fails.append('SEO: no <h1>')
        elif len(h1s) > 1: fails.append(f'SEO: {len(h1s)} <h1> tags (must be exactly 1)')

    # ---------- ACCESSIBILITY ----------
    if not re.search(r'<html[^>]*\slang=', html, re.I): fails.append('A11Y: <html> missing lang')
    imgs = re.findall(r'<img\b[^>]*>', html)
    noalt = [i for i in imgs if ' alt=' not in i and ' alt =' not in i]
    if noalt: fails.append(f'A11Y: {len(noalt)} <img> without alt (e.g. {attr(noalt[0], "src") or "?"})')
    # links whose visible content is only a tag/whitespace and no aria-label
    bare = 0
    for m in re.finditer(r'<a\b([^>]*)>(.*?)</a>', html, re.S):
        inner = re.sub(r'<[^>]+>', '', m.group(2)).strip()
        if not inner and 'aria-label' not in m.group(1) and 'title=' not in m.group(1):
            bare += 1
    if bare: fails.append(f'A11Y: {bare} link(s) with no text and no aria-label')
    for m in re.finditer(r'<button\b([^>]*)>(.*?)</button>', html, re.S):
        inner = re.sub(r'<[^>]+>', '', m.group(2)).strip()
        if not inner and 'aria-label' not in m.group(1):
            fails.append('A11Y: button with no text and no aria-label'); break
    for m in re.finditer(r'<(input|select|textarea)\b[^>]*>', html):
        tag = m.group(0)
        if attr(tag, 'type') in ('hidden', 'submit', 'button', 'checkbox', 'radio'): continue
        ident = attr(tag, 'id')
        pre = html[max(0, m.start() - 200):m.start()]
        wrapped = re.search(r'<label[^>]*>(?:(?!</label>).)*$', pre, re.S)  # inside an open <label>
        labelled = (ident and f'for="{ident}"' in html) or 'aria-label' in tag or 'placeholder' in tag \
                   or 'aria-labelledby' in tag or wrapped
        if not labelled:
            fails.append(f'A11Y: unlabelled form control ({attr(tag, "name") or attr(tag, "type") or m.group(1)})'); break

    # ---------- MOBILE ----------
    if 'name="viewport"' not in head: fails.append('MOBILE: missing viewport meta')

    # ---------- LINKS ----------
    dead = set()
    for href in re.findall(r'href="([^"#?]+)(?:[#?][^"]*)?"', html):
        if href.startswith(('http', 'mailto:', 'tel:', 'javascript:', '//', 'data:')): continue
        target = href.lstrip('/')
        if not target: continue
        p = os.path.join(SITE, target)
        if not (os.path.exists(p) or os.path.exists(p.rstrip('/') if target.endswith('/') else p) or
                os.path.exists(os.path.join(p.rstrip('/'), 'index.html'))):
            dead.add(href)
    if dead: fails.append('LINKS: dead internal hrefs: ' + ', '.join(sorted(dead)[:6]))

    # ---------- CONTENT / CONVERSION ----------
    if not is_util and page not in ('accessibility.html', 'privacy.html', 'terms.html', 'cookies.html', 'security.html', 'status.html') \
       and not CTA_PAT.search(html):
        warns.append('CONTENT: no conversion CTA found on page')

    return fails, warns

def main():
    pages = sorted(glob.glob(os.path.join(SITE, '*.html'))) + sorted(glob.glob(os.path.join(SITE, 'forms', '*.html')))
    total_f = total_w = 0; report = []
    for p in pages:
        f, w = audit(p)
        total_f += len(f); total_w += len(w)
        if f or w:
            report.append((os.path.relpath(p, SITE), f, w))
    for page, f, w in report:
        for x in f: print(f'FAIL {page} :: {x}')
        for x in w: print(f'warn {page} :: {x}')
    print(f'\nGRAND AUDIT: {len(pages)} pages, {total_f} FAIL, {total_w} warn')
    sys.exit(1 if total_f else 0)

main()
