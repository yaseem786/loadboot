# -*- coding: utf-8 -*-
"""
R6 SEO surgery -- three title/meta edits in build_site.py.

Run from the repo root:  python apply_r6_seo.py   then  python build_site.py

WHY THESE THREE (measured, not guessed). GSC 28 days to 2026-08-26, pulled live from
the seo-pull edge function:

  detention-pay-policy.html   0 clicks / 136 impressions / avg pos 55.7
  dry-van-dispatch.html       0 clicks /  91 impressions / avg pos 77.7
  power-only-dispatch.html    0 clicks / 105 impressions / avg pos 74.5

All three: >=15 impressions, 0 clicks, no week-over-week click growth (so not "locked"
under the weekly-loop rule), not on the do-not-redo list, and not edited in R4. They were
pre-selected in R5 on 2026-08-20 and RE-VERIFIED against fresh data before editing --
power-only has grown 64 -> 105 impressions since, dry van 70 -> 91.

THE RULE THESE EDITS FOLLOW: preserve every keyword the current title already covers,
then add the query language that is earning impressions but no clicks. URLs never change.

ONE DELIBERATE DEVIATION FROM R5'S PLAN: R5 wanted the $2.55/mi power-only figure in the
title. Not done. `rate_benchmarks` has been stale at as_of 2026-08-17 since 17 August, and
this project spent 25 August removing exactly this kind of un-refreshable claim from the
site. A rate in a <title> is the least maintainable place to put one. The title sells the
service; the live number stays on the rate pages where JS keeps it honest.

Idempotent and all-or-nothing: every anchor must match exactly once or nothing is written.
A timestamped backup is made first.
"""
import io, os, sys, time

SRC = os.path.dirname(os.path.abspath(__file__))
TARGET = os.path.join(SRC, 'build_site.py')

EDITS = [
 # ---- (a) detention-pay-policy -- _ACC_SEO entry -------------------------------
 # queries with impressions and zero clicks: detention pay 11, detention charges
 # trucking 11, how much is detention pay for truckers 10, detention pay trucking 7,
 # how much is detention pay 7, detention fee trucking 5, detention pay meaning 3.
 # preserved: "Detention Pay", "for Truckers", "2026", "How to Claim".
 # added: "How Much Is It", "$50-$100/Hour", "Detention Charges", "in Trucking".
 ("detention-pay-policy title",
  "   title='Detention Pay for Truckers 2026: Rates, How to Claim &amp; Get Paid | LoadBoot',",
  "   title='Detention Pay for Truckers 2026: How Much Is It \\u2014 $50\\u2013$100/Hour, "
  "Detention Charges in Trucking &amp; How to Claim | LoadBoot',"),

 ("detention-pay-policy description",
  "   desc='Detention pay explained for carriers: $50\\u2013$100/hr 2026 rates, the 2-hour free time rule, "
  "exactly how to claim detention, what evidence to collect, and what to do when a broker refuses "
  "\\u2014 plus how LoadBoot pays it automatically.',",
  "   desc='How much is detention pay? Detention charges in trucking run $50\\u2013$100/hr in 2026, after "
  "2 hours of free time. Exactly how to claim detention pay, what evidence to collect, what to do when a "
  "broker refuses \\u2014 plus how LoadBoot pays it automatically.',"),

 # ---- (b) dry-van-dispatch -- svc_page title + desc ----------------------------
 # dry van dispatch services 27, dry van dispatcher 15, dry van dispatch service 14,
 # dry van dispatch 12, load dispatching for dry van 4.
 # preserved: "Dry Van Dispatch", "Service", "2026", "Flat 5%", "No Contracts".
 # added: "Services" (the biggest query is the plural), "Dry Van Dispatcher".
 ("dry-van-dispatch title",
  "svc_page('dry-van-dispatch.html','Dry Van','Dry Van Dispatch Service 2026 \u2014 Flat 5%, No Contracts | LoadBoot',",
  "svc_page('dry-van-dispatch.html','Dry Van','Dry Van Dispatch Services 2026 \u2014 Dry Van Dispatcher, "
  "Flat 5%, No Contracts | LoadBoot',"),

 ("dry-van-dispatch description",
  " 'Dry van truck dispatch for owner-operators and fleets. Consistent, well-paying van freight, rate "
  "negotiation, and back-office support. Flat 5%, no contracts.',",
  " 'Dry van dispatch services for owner-operators and fleets: a dedicated dry van dispatcher booking "
  "consistent van freight, negotiating every rate and handling the back office. Flat 5% of gross, no contracts.',"),

 # ---- (c) power-only-dispatch -- svc_page title + desc -------------------------
 # power only dispatch services 26, power only dispatch service 20, power only
 # dispatcher 10, power only units dispatch services 7, power only dispatch 6,
 # power only dispatch in usa 5. The old title carried no year, no dispatcher token,
 # and spelled the brand "Loadboot" -- fixed to LoadBoot to match every other page.
 ("power-only-dispatch title",
  "svc_page('power-only-dispatch.html','Power Only','Power Only Dispatch Services | Loadboot',",
  "svc_page('power-only-dispatch.html','Power Only','Power Only Dispatch Services 2026 \u2014 Power Only "
  "Dispatcher, Drop-and-Hook Freight, Flat 5% | LoadBoot',"),

 ("power-only-dispatch description",
  " 'Power only truck dispatch. We book drop-and-hook power only freight for your tractor, negotiate rates, "
  "and handle brokers. Flat 5%, no contracts.',",
  " 'Power only dispatch services for tractor-only carriers in the USA: a power only dispatcher booking "
  "drop-and-hook and trailer-supplied freight, negotiating every rate and handling broker setup. Flat 5% of "
  "gross, no contracts.',"),
]


def main():
    if not os.path.exists(TARGET):
        sys.exit('build_site.py not found next to this script. Run it from the repo root.')
    with io.open(TARGET, encoding='utf-8') as f:
        s = original = f.read()

    plan, skipped = [], []
    for name, old, new in EDITS:
        if new in s:
            skipped.append(name); continue
        n = s.count(old)
        if n != 1:
            sys.exit("ABORTED, nothing written. Anchor for '%s' found %d times (expected 1).\n"
                     "build_site.py has moved on since this patch was written -- re-anchor by hand." % (name, n))
        plan.append((name, old, new))

    if not plan:
        print('Already applied -- all %d edits present. Nothing to do.' % len(EDITS))
        return

    for name, old, new in plan:
        s = s.replace(old, new, 1)

    bak = TARGET + '.bak-r6-' + time.strftime('%Y%m%d-%H%M%S')
    with io.open(bak, 'w', encoding='utf-8') as f:
        f.write(original)
    with io.open(TARGET, 'w', encoding='utf-8') as f:
        f.write(s)

    print('Backup written: ' + os.path.basename(bak))
    for name, _, _ in plan:
        print('  applied : ' + name)
    for name in skipped:
        print('  skipped (already there): ' + name)
    print('\nNow run:  python build_site.py     (expect BUILD OK)')


if __name__ == '__main__':
    main()
