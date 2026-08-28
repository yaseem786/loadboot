# -*- coding: utf-8 -*-
"""refresh_rate_snapshot.py -- append this week's benchmark snapshot to rate_snapshots.json.

    python refresh_rate_snapshot.py

That is the entire weekly ritual for the market-report engine. It calls the public
get_public_market_rates() RPC on production (anon key, no secrets), and appends the
result as a new dated snapshot. Then `python build_site.py` writes the new report.

RULES THIS SCRIPT ENFORCES, and why each one exists:

  * It APPENDS. It never rewrites an existing snapshot. The dated reports are built
    from these rows, and a report that quietly changes its own historical numbers is
    worthless as a record. If a snapshot for today's ISO week already exists the
    script refuses and tells you so, rather than overwriting it.

  * It records the SOURCE string verbatim alongside every rate. The report generator
    uses that string to decide whether a week-over-week comparison is honest at all
    (see _wow / _src_family in market_reports_module.py). Losing it would silently
    re-enable the false "+43%" that the source-family check exists to prevent.

  * It warns when the incoming numbers are identical to the previous snapshot. That
    means app_private.rate_benchmarks has not actually been refreshed, so there is
    nothing new to publish this week. The generator handles it honestly either way,
    but you should know before you build.
"""
import json, os, sys, datetime, urllib.request, urllib.error

PROD_REF = 'rwscphuhpjoudvljvmdk'
ANON = (os.environ.get('LOADBOOT_PROD_ANON_KEY')
        or 'sb_publishable_lHr4JKuHCZEkkjaEh7vx3A_ya_XLG4V')
URL = 'https://%s.supabase.co/rest/v1/rpc/get_public_market_rates' % PROD_REF
HERE = os.path.dirname(os.path.abspath(__file__))
STORE = os.path.join(HERE, 'rate_snapshots.json')


def fetch():
    req = urllib.request.Request(URL, data=b'{}', headers={
        'apikey': ANON, 'Authorization': 'Bearer ' + ANON,
        'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode('utf-8'))


def main():
    try:
        rows = fetch()
    except Exception as ex:
        print('FAILED to reach get_public_market_rates: %s' % ex)
        print('Nothing written. The snapshot store is unchanged.')
        return 1
    if not rows:
        print('RPC returned no rows. Nothing written.')
        return 1

    # as_of comes from the benchmark table itself, not from today's date -- the report
    # must be dated by when the number was measured, not by when we happened to fetch it.
    as_of = rows[0].get('as_of') or datetime.date.today().isoformat()
    dt = datetime.date.fromisoformat(as_of)
    iso = dt.isocalendar()

    store = json.load(open(STORE, encoding='utf-8'))
    snaps = store['snapshots']

    for s in snaps:
        if s['as_of'] == as_of:
            print('A snapshot for %s already exists. Nothing written.' % as_of)
            print('Snapshots are append-only on purpose -- published reports are built')
            print('from them and must never change after the fact.')
            return 0
        if (s['iso_year'], s['iso_week']) == (iso[0], iso[1]):
            print('ISO week %d-W%02d already has a snapshot (%s), and the incoming one is'
                  % (iso[0], iso[1], s['as_of']))
            print('dated %s. Two snapshots in one week would produce two reports at the' % as_of)
            print('same URL. Nothing written -- resolve which one you want first.')
            return 1

    rates = {}
    for r in rows:
        rates[r['equipment']] = {'rpm': float(r['carrier_rpm']), 'source': r.get('source') or ''}

    prev = max(snaps, key=lambda s: s['as_of']) if snaps else None
    if prev and set(prev['rates']) == set(rates) and all(
            float(prev['rates'][k]['rpm']) == rates[k]['rpm'] for k in rates):
        print('WARNING: every rate is identical to the previous snapshot (%s).' % prev['as_of'])
        print('That means app_private.rate_benchmarks has not been rebuilt since then.')
        print('The report will say so honestly rather than claim the market was flat,')
        print('but consider refreshing the benchmarks before you publish another week.')

    snaps.append({'as_of': as_of, 'iso_year': iso[0], 'iso_week': iso[1], 'rates': rates})
    snaps.sort(key=lambda s: s['as_of'])
    json.dump(store, open(STORE, 'w', encoding='utf-8'), indent=1)
    print('Added snapshot %s (ISO %d-W%02d), %d equipment types.' % (as_of, iso[0], iso[1], len(rates)))
    print('Now run:  python build_site.py')
    return 0


if __name__ == '__main__':
    sys.exit(main())
