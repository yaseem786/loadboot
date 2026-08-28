# -*- coding: utf-8 -*-
"""
Workstream 02 -- wire the shipper-by-industry pages into build_site.py.

Run once from the repo root:   python apply_workstream02.py
Then:                          python build_site.py     (expect BUILD OK)

Eight additive edits, each anchored on an exact string that must appear exactly
once. If an anchor is missing or ambiguous the script changes NOTHING and tells
you which one -- it will never half-patch the file. Re-running is safe: edits
already present are skipped.

A timestamped backup is written to build_site.py.bak-ws02-<stamp> first.
"""
import io, os, sys, time

SRC = os.path.dirname(os.path.abspath(__file__))
TARGET = os.path.join(SRC, 'build_site.py')

EDITS = [
 ("import",
  "from market_reports_module import build_market_reports   # workstream 01 layer 2: dated weekly reports",
  "from market_reports_module import build_market_reports   # workstream 01 layer 2: dated weekly reports\n"
  "from industry_pages_module import (build_industry_pages, build_industry_index,\n"
  "                                   industry_links_for_equipment)  # workstream 02: shipper-by-industry pages"),

 ("_NO_PUBLISH",
  "'market_reports_module.py','refresh_rate_snapshot.py','rate_snapshots.json'}",
  "'market_reports_module.py','refresh_rate_snapshot.py','rate_snapshots.json',\n"
  "               'industry_pages_module.py'}"),

 ("generate before the hub loop",
  "_EQR_CSS = ('<style>'",
  "# ---- Workstream 02: shipper-by-industry pages -------------------------------\n"
  "# The largest unclaimed page type in load-board SEO (audit 25 Aug 2026): no load board\n"
  "# publishes these, only the 3PLs. Built BEFORE the hub loop so each equipment hub can\n"
  "# link forward to the industries that ride on it; emitted AFTER it, alongside the\n"
  "# market reports, so the build's own asset checker resolves both directions.\n"
  "_IND_PAGES = build_industry_pages(_EQ_RATES, _acc_faq_schema)\n"
  "_IND_FOR_EQ = industry_links_for_equipment()\n"
  "print('industry pages: %d built' % len(_IND_PAGES))\n\n"
  "_EQR_CSS = ('<style>'"),

 ("hub RELATED",
  "      ('free-load-board-for-brokers.html', 'Free Load Board for Brokers'),\n    ]",
  "      ('free-load-board-for-brokers.html', 'Free Load Board for Brokers'),\n    ] + _IND_FOR_EQ.get(_s, [])"),

 ("emit pages",
  "if _MR_PAGES:\n    print('market reports written: ' + ', '.join(p['fname'] for p in _MR_PAGES[-3:]) + ' ...')",
  "if _MR_PAGES:\n    print('market reports written: ' + ', '.join(p['fname'] for p in _MR_PAGES[-3:]) + ' ...')\n\n"
  "# ---- Workstream 02: write the shipper-by-industry pages ----------------------\n"
  "for _ipg in _IND_PAGES:\n"
  "    RELATED[_ipg['fname']] = _ipg['related']\n"
  "    page(_ipg['fname'], _ipg['title'], _ipg['desc'], 'shipper-solutions.html', _ipg['body'], _ipg['schema'])\n"
  "_IND_INDEX = build_industry_index(_EQ_RATES, _acc_faq_schema)\n"
  "RELATED[_IND_INDEX['fname']] = _IND_INDEX['related']\n"
  "page(_IND_INDEX['fname'], _IND_INDEX['title'], _IND_INDEX['desc'], 'shipper-solutions.html',\n"
  "     _IND_INDEX['body'], _IND_INDEX['schema'])\n"
  "if _IND_PAGES:\n"
  "    print('industry pages written: ' + ', '.join(p['fname'] for p in _IND_PAGES) + ' + ' + _IND_INDEX['fname'])"),

 ("footer Partners column",
  '<a href="agents.html">Referral Partner Program (Earn 1%)</a>',
  '<a href="freight-shipping-by-industry.html">Freight Shipping by Industry</a>'
  '<a href="agents.html">Referral Partner Program (Earn 1%)</a>'),

 ("HTML sitemap group",
  "('ghost-loads-load-board-problems.html', 'Ghost Loads & Fake Freight'), ('faq.html', 'FAQ')]),",
  "('ghost-loads-load-board-problems.html', 'Ghost Loads & Fake Freight'), ('faq.html', 'FAQ')]),\n"
  "  ('Freight by industry', [('freight-shipping-by-industry.html', 'Freight Shipping by Industry'), "
  "('food-and-beverage-freight-shipping.html', 'Food & Beverage'), "
  "('building-materials-freight-shipping.html', 'Building Materials'), "
  "('retail-and-ecommerce-freight-shipping.html', 'Retail & E-commerce'), "
  "('manufacturing-and-industrial-freight-shipping.html', 'Manufacturing & Industrial'), "
  "('agriculture-and-produce-freight-shipping.html', 'Agriculture & Produce'), "
  "('metals-and-steel-freight-shipping.html', 'Metals & Steel'), "
  "('shipper-solutions.html', 'Shipper Solutions')]),"),

 ("nav Solutions entry",
  "    ('shipper-solutions.html', 'For shippers'),",
  "    ('shipper-solutions.html', 'For shippers'),\n"
  "    ('freight-shipping-by-industry.html', 'Freight shipping by industry'),"),
]


# Undo the first-cut insertions (2 verticals, no hub page) if an earlier run of this
# script applied them. Run before EDITS so a machine that is already patched to v1 lands
# on exactly the same file as one that was never patched.
CLEANUPS = [
 ('<a href="food-and-beverage-freight-shipping.html">Food &amp; Beverage Freight</a>'
  '<a href="building-materials-freight-shipping.html">Building Materials Freight</a>', ''),
 ("\n  ('Freight by industry', [('food-and-beverage-freight-shipping.html', 'Food & Beverage Freight Shipping'), "
  "('building-materials-freight-shipping.html', 'Building Materials Freight Shipping'), "
  "('shipper-solutions.html', 'Shipper Solutions'), ('ship-direct-to-carrier.html', 'Ship Direct to Carriers')]),", ''),
 ("from industry_pages_module import build_industry_pages  # workstream 02: shipper-by-industry pages",
  "from industry_pages_module import (build_industry_pages, build_industry_index,\n"
  "                                   industry_links_for_equipment)  # workstream 02: shipper-by-industry pages"),
 ("_IND_FOR_EQ = {}\nfor _ip in _IND_PAGES:\n    for _es in _ip['equip']:\n"
  "        _IND_FOR_EQ.setdefault(_es, []).append((_ip['fname'], _ip['ind_label'] + ' Freight'))",
  "_IND_FOR_EQ = industry_links_for_equipment()"),
 ("from industry_pages_module import build_industry_pages, build_industry_index  # workstream 02: shipper-by-industry pages",
  "from industry_pages_module import (build_industry_pages, build_industry_index,\n"
  "                                   industry_links_for_equipment)  # workstream 02: shipper-by-industry pages"),
 ("if _IND_PAGES:\n    print('industry pages written: ' + ', '.join(p['fname'] for p in _IND_PAGES))",
  "_IND_INDEX = build_industry_index(_EQ_RATES, _acc_faq_schema)\n"
  "RELATED[_IND_INDEX['fname']] = _IND_INDEX['related']\n"
  "page(_IND_INDEX['fname'], _IND_INDEX['title'], _IND_INDEX['desc'], 'shipper-solutions.html',\n"
  "     _IND_INDEX['body'], _IND_INDEX['schema'])\n"
  "if _IND_PAGES:\n"
  "    print('industry pages written: ' + ', '.join(p['fname'] for p in _IND_PAGES) + ' + ' + _IND_INDEX['fname'])"),
]


def main():
    if not os.path.exists(TARGET):
        sys.exit('build_site.py not found next to this script. Run it from the repo root.')
    if not os.path.exists(os.path.join(SRC, 'industry_pages_module.py')):
        sys.exit('industry_pages_module.py is missing. Drop it in the repo root first, then re-run.')

    with io.open(TARGET, encoding='utf-8') as f:
        s = original = f.read()

    cleaned = []
    for old, new in CLEANUPS:
        if old in s:
            s = s.replace(old, new); cleaned.append(old[:48].replace('\n', ' ') + '...')

    plan, skipped = [], []
    for name, old, new in EDITS:
        if new in s:
            skipped.append(name); continue
        n = s.count(old)
        if n != 1:
            sys.exit("ABORTED, nothing written. Anchor for '%s' found %d times (expected 1).\n"
                     "build_site.py has moved on since this patch was written -- re-anchor it by hand." % (name, n))
        plan.append((name, old, new))

    if not plan and not cleaned:
        print('Already patched -- all %d edits present. Nothing to do.' % len(EDITS))
        return

    for name, old, new in plan:
        s = s.replace(old, new, 1)

    if s == original:
        print('Already patched -- all %d edits present. Nothing to do.' % len(EDITS))
        return

    bak = TARGET + '.bak-ws02-' + time.strftime('%Y%m%d-%H%M%S')
    with io.open(bak, 'w', encoding='utf-8') as f:
        f.write(original)
    with io.open(TARGET, 'w', encoding='utf-8') as f:
        f.write(s)

    print('Backup written: ' + os.path.basename(bak))
    for c in cleaned:
        print('  upgraded from the first cut: ' + c)
    for name, _, _ in plan:
        print('  applied : ' + name)
    for name in skipped:
        print('  skipped (already there): ' + name)
    print('\nNow run:  python build_site.py     (expect BUILD OK)')


if __name__ == '__main__':
    main()
