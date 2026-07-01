#!/usr/bin/env python3
"""site_inventory.py — Increment 57: machine-readable website inventory.

Crawls the built site/ directory (static HTML) and produces:
  - docs/site-inventory.json : one record per page — URL, title, meta description,
    canonical, word count, section count (+ per-section heading/word breakdown),
    CTAs, forms (+ fields), internal/external links, images (+ alt coverage),
    schema.org JSON-LD types, and a shingle-based duplication-risk score against
    every other page.
  - docs/site-inventory-gaps.md : honest gap report — thin pages, missing meta,
    missing canonical, images without alt, pages with no CTA, orphan pages
    (nothing links to them), duplicate-risk pairs.

Deterministic, stdlib-only (html.parser). No fabricated numbers: every figure is
counted from the actual built HTML. Run AFTER build_site.py.
"""
import json, os, re, sys, html
from html.parser import HTMLParser
from collections import defaultdict

SITE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'site')
DOCS_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'docs')
BASE = 'https://loadboot.com'

CTA_WORDS = re.compile(r'\b(get started|apply|sign up|signup|book|request|start|join|contact|call|talk to|schedule|submit|subscribe|become a partner|get a quote|free)\b', re.I)
SKIP_FILES = {'404.html'}

class Page(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title = ''
        self.meta_description = ''
        self.canonical = ''
        self.robots = ''
        self.sections = []          # {heading, level, words}
        self._cur = None
        self._in_title = False
        self._in_heading = None
        self._heading_buf = []
        self._skip_depth = 0        # inside script/style/noscript
        self._in_jsonld = False
        self._jsonld_buf = []
        self.jsonld_raw = []
        self.words = 0
        self.links_internal = set()
        self.links_external = set()
        self.anchors = []           # (href, text) for CTA detection
        self._anchor_buf = None
        self.images = []            # {src, alt}
        self.forms = []             # {action, method, fields:[{tag,type,name,required}]}
        self._cur_form = None
        self.ctas = []
        self.h1_count = 0

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag in ('script', 'style', 'noscript'):
            if tag == 'script' and a.get('type') == 'application/ld+json':
                self._in_jsonld = True
                self._jsonld_buf = []
            self._skip_depth += 1
            return
        if tag == 'title':
            self._in_title = True
        elif tag == 'meta':
            name = (a.get('name') or a.get('property') or '').lower()
            if name == 'description':
                self.meta_description = a.get('content', '')
            elif name == 'robots':
                self.robots = a.get('content', '')
        elif tag == 'link' and (a.get('rel') or '').lower() == 'canonical':
            self.canonical = a.get('href', '')
        elif tag in ('h1', 'h2', 'h3'):
            if tag == 'h1':
                self.h1_count += 1
            self._in_heading = tag
            self._heading_buf = []
        elif tag == 'a':
            href = a.get('href', '')
            self._anchor_buf = [href, []]
            if href:
                if href.startswith('http') and 'loadboot' not in href.split('/')[2] if href.count('/') >= 2 else False:
                    pass
        elif tag == 'img':
            self.images.append({'src': a.get('src', ''), 'alt': a.get('alt', None)})
        elif tag == 'form':
            self._cur_form = {'action': a.get('action', ''), 'method': (a.get('method') or 'get').lower(), 'fields': []}
            self.forms.append(self._cur_form)
        elif tag in ('input', 'select', 'textarea') and self._cur_form is not None:
            if (a.get('type') or '').lower() in ('hidden', 'submit'):
                if (a.get('type') or '').lower() == 'submit':
                    return
            self._cur_form['fields'].append({'tag': tag, 'type': a.get('type', ''), 'name': a.get('name', ''), 'required': 'required' in a})
        elif tag == 'button':
            self._anchor_buf = ['#button', []]

    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'noscript'):
            if self._in_jsonld:
                raw = ''.join(self._jsonld_buf).strip()
                if raw:
                    self.jsonld_raw.append(raw)
                self._in_jsonld = False
            self._skip_depth = max(0, self._skip_depth - 1)
            return
        if tag == 'title':
            self._in_title = False
        elif tag in ('h1', 'h2', 'h3') and self._in_heading == tag:
            heading = ' '.join(''.join(self._heading_buf).split())
            self.sections.append({'heading': heading, 'level': tag, 'words': 0})
            self._cur = self.sections[-1]
            self._in_heading = None
        elif tag in ('a', 'button') and self._anchor_buf is not None:
            href, buf = self._anchor_buf
            text = ' '.join(''.join(buf).split())
            self.anchors.append((href, text))
            if text and CTA_WORDS.search(text):
                self.ctas.append({'text': text, 'href': href})
            if href and not href.startswith(('#', 'mailto:', 'tel:', 'javascript:')) and href != '#button':
                if href.startswith('http'):
                    if 'loadboot.com' in href:
                        self.links_internal.add(href.replace(BASE, '').lstrip('/') or 'index.html')
                    else:
                        self.links_external.add(href)
                else:
                    self.links_internal.add(href.split('#')[0].split('?')[0].lstrip('./') or 'index.html')
            self._anchor_buf = None
        elif tag == 'form':
            self._cur_form = None

    def handle_data(self, data):
        if self._in_jsonld:
            self._jsonld_buf.append(data)
            return
        if self._skip_depth:
            return
        if self._in_title:
            self.title += data
        if self._in_heading:
            self._heading_buf.append(data)
        if self._anchor_buf is not None:
            self._anchor_buf[1].append(data)
        w = len(data.split())
        if w:
            self.words += w
            if self._cur is not None:
                self._cur['words'] += w


def shingles(text, k=8):
    toks = re.findall(r'[a-z0-9]+', text.lower())
    return set(' '.join(toks[i:i + k]) for i in range(max(0, len(toks) - k + 1)))


def main():
    pages = {}
    texts = {}
    for fn in sorted(os.listdir(SITE_DIR)):
        if not fn.endswith('.html') or fn in SKIP_FILES:
            continue
        path = os.path.join(SITE_DIR, fn)
        raw = open(path, encoding='utf-8', errors='replace').read()
        p = Page()
        try:
            p.feed(raw)
        except Exception as e:
            print(f'PARSE WARNING {fn}: {e}', file=sys.stderr)
        # body text for duplication shingling (strip tags crudely after removing script/style)
        body = re.sub(r'<(script|style)[^>]*>.*?</\1>', ' ', raw, flags=re.S | re.I)
        body = html.unescape(re.sub(r'<[^>]+>', ' ', body))
        texts[fn] = shingles(body)
        schema_types = []
        for blob in p.jsonld_raw:
            try:
                d = json.loads(blob)
                items = d if isinstance(d, list) else [d]
                for it in items:
                    if isinstance(it, dict):
                        t = it.get('@type')
                        if isinstance(t, list):
                            schema_types.extend(t)
                        elif t:
                            schema_types.append(t)
                        for g in it.get('@graph', []) if isinstance(it.get('@graph'), list) else []:
                            gt = g.get('@type')
                            if gt:
                                schema_types.append(gt if isinstance(gt, str) else ','.join(gt))
            except Exception:
                schema_types.append('INVALID_JSONLD')
        imgs_missing_alt = [i['src'] for i in p.images if not (i['alt'] or '').strip()]
        pages[fn] = {
            'url': f'{BASE}/{fn}' if fn != 'index.html' else f'{BASE}/',
            'file': fn,
            'title': p.title.strip(),
            'title_length': len(p.title.strip()),
            'meta_description': p.meta_description.strip(),
            'meta_description_length': len(p.meta_description.strip()),
            'canonical': p.canonical,
            'robots': p.robots,
            'h1_count': p.h1_count,
            'section_count': len(p.sections),
            'sections': p.sections,
            'word_count': p.words,
            'cta_count': len(p.ctas),
            'ctas': p.ctas[:20],
            'forms': p.forms,
            'links_internal': sorted(p.links_internal),
            'links_external': sorted(p.links_external),
            'internal_link_count': len(p.links_internal),
            'image_count': len(p.images),
            'images_missing_alt': imgs_missing_alt,
            'schema_types': sorted(set(schema_types)),
        }

    # duplication risk: max Jaccard similarity vs any other page
    names = list(pages)
    for i, a in enumerate(names):
        best, best_with = 0.0, None
        for b in names:
            if a == b or not texts[a] or not texts[b]:
                continue
            inter = len(texts[a] & texts[b])
            union = len(texts[a] | texts[b])
            j = inter / union if union else 0.0
            if j > best:
                best, best_with = j, b
        pages[a]['duplication_risk'] = {'max_similarity': round(best, 3), 'most_similar_page': best_with,
                                        'level': 'high' if best > 0.5 else 'medium' if best > 0.25 else 'low'}

    # inbound links (orphan detection)
    inbound = defaultdict(set)
    for fn, rec in pages.items():
        for l in rec['links_internal']:
            tgt = l if l.endswith('.html') else (l.rstrip('/') + '.html' if l and '.' not in l else l)
            if tgt in pages and tgt != fn:
                inbound[tgt].add(fn)
    for fn in pages:
        pages[fn]['inbound_link_count'] = len(inbound[fn])
        pages[fn]['inbound_links'] = sorted(inbound[fn])

    summary = {
        'generated_note': 'Counted from built site/ HTML by scripts/site_inventory.py. No estimates.',
        'page_count': len(pages),
        'total_words': sum(p['word_count'] for p in pages.values()),
        'pages_missing_meta_description': sorted(f for f, p in pages.items() if not p['meta_description']),
        'pages_missing_canonical': sorted(f for f, p in pages.items() if not p['canonical']),
        'pages_missing_title': sorted(f for f, p in pages.items() if not p['title']),
        'pages_multiple_h1': sorted(f for f, p in pages.items() if p['h1_count'] > 1),
        'pages_no_h1': sorted(f for f, p in pages.items() if p['h1_count'] == 0),
        'thin_pages_under_300_words': sorted(f for f, p in pages.items() if p['word_count'] < 300),
        'pages_without_cta': sorted(f for f, p in pages.items() if p['cta_count'] == 0),
        'orphan_pages': sorted(f for f, p in pages.items() if p['inbound_link_count'] == 0),
        'pages_with_images_missing_alt': {f: p['images_missing_alt'] for f, p in pages.items() if p['images_missing_alt']},
        'high_duplication_pairs': sorted({tuple(sorted((f, p['duplication_risk']['most_similar_page'])))
                                          for f, p in pages.items()
                                          if p['duplication_risk']['level'] == 'high'}),
        'pages_without_schema': sorted(f for f, p in pages.items() if not p['schema_types']),
    }

    os.makedirs(DOCS_DIR, exist_ok=True)
    out_json = os.path.join(DOCS_DIR, 'site-inventory.json')
    with open(out_json, 'w', encoding='utf-8') as f:
        json.dump({'summary': summary, 'pages': pages}, f, indent=1)

    # gap report (markdown, honest)
    lines = ['# Website Inventory — Gap Report (Increment 57)', '',
             '> Machine-generated from the built `site/` output by `scripts/site_inventory.py`.',
             '> Every number below is counted from the actual HTML — nothing is estimated.', '',
             f'**Pages:** {summary["page_count"]} · **Total words:** {summary["total_words"]:,}', '']
    def sec(title, items, fmt=lambda x: f'- `{x}`'):
        lines.append(f'## {title} ({len(items)})')
        lines.append('')
        if items:
            lines.extend(fmt(i) for i in items)
        else:
            lines.append('- None ✔')
        lines.append('')
    sec('Pages missing meta description', summary['pages_missing_meta_description'])
    sec('Pages missing canonical', summary['pages_missing_canonical'])
    sec('Pages with no H1', summary['pages_no_h1'])
    sec('Pages with multiple H1', summary['pages_multiple_h1'])
    sec('Thin pages (<300 words)', sorted(summary['thin_pages_under_300_words'],
        key=lambda f: pages[f]['word_count']),
        fmt=lambda f: f'- `{f}` — {pages[f]["word_count"]} words')
    sec('Pages without any CTA', summary['pages_without_cta'])
    sec('Orphan pages (no internal inbound links)', summary['orphan_pages'])
    sec('High duplication-risk pairs (>50% shingle overlap)', summary['high_duplication_pairs'],
        fmt=lambda pair: f'- `{pair[0]}` ↔ `{pair[1]}`')
    sec('Pages without schema.org markup', summary['pages_without_schema'])
    if summary['pages_with_images_missing_alt']:
        lines.append(f'## Images missing alt text ({sum(len(v) for v in summary["pages_with_images_missing_alt"].values())})')
        lines.append('')
        for f, imgs in sorted(summary['pages_with_images_missing_alt'].items()):
            lines.append(f'- `{f}`: ' + ', '.join(f'`{i or "(inline)"}`' for i in imgs))
        lines.append('')
    lines.append('## Per-page snapshot')
    lines.append('')
    lines.append('| Page | Words | Sections | CTAs | Internal links | Inbound | Dup risk |')
    lines.append('|---|---|---|---|---|---|---|')
    for f in sorted(pages, key=lambda x: -pages[x]['word_count']):
        p = pages[f]
        lines.append(f'| `{f}` | {p["word_count"]} | {p["section_count"]} | {p["cta_count"]} | {p["internal_link_count"]} | {p["inbound_link_count"]} | {p["duplication_risk"]["level"]} |')
    out_md = os.path.join(DOCS_DIR, 'site-inventory-gaps.md')
    with open(out_md, 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')

    print(f'INVENTORY OK — {summary["page_count"]} pages → {out_json}')
    print(f'GAP REPORT  — {out_md}')
    for k in ('pages_missing_meta_description', 'pages_missing_canonical', 'thin_pages_under_300_words',
              'pages_without_cta', 'orphan_pages', 'pages_without_schema'):
        print(f'  {k}: {len(summary[k])}')
    print(f'  high_duplication_pairs: {len(summary["high_duplication_pairs"])}')


if __name__ == '__main__':
    main()
