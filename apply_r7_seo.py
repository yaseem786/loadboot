# -*- coding: utf-8 -*-
"""R7 title/meta surgery — 2026-09-03. Idempotent, all-or-nothing.
Each anchor must appear exactly once or nothing is written."""
import io, sys

PATH = 'build_site.py'
s = io.open(PATH, encoding='utf-8').read()
orig = s

EDITS = [
 # (label, old, new)
 ("R7-1 cost-per-mile-calculator title (REVERT: drop rate figure)",
  "'Cost Per Mile Calculator for Trucking (2026) &mdash; Free, Itemized &amp; Average CPM $2.20–$2.30/Mile | LoadBoot'",
  "'Trucking Cost Per Mile Calculator (2026) &mdash; Free CPM &amp; Rates Per Mile | LoadBoot'"),

 ("R7-1 cost-per-mile-calculator meta description",
  "'Free trucking cost per mile calculator: itemize your fixed and variable costs, get your true cost per mile, break-even rate and profit per mile instantly. Industry research (ATRI) puts the average marginal cost of trucking at roughly $2.20–$2.30 per mile; solo owner-operators typically land $1.40–$1.90. No signup, no login.'",
  "'Free trucking cost per mile calculator: itemize your fixed and variable costs and get your true cost per mile, break-even rate and profit per mile instantly. See how your CPM compares against published industry benchmarks. No signup, no login.'"),

 ("R7-2 lumper-policy title",
  "title='Lumper Fees 2026: Reimbursement Rules \\u2014 Never Pay Out of Pocket | LoadBoot',",
  "title='What Is a Lumper Fee in Trucking? Fees, Receipts \\u0026 Reimbursement 2026 | LoadBoot',"),

 ("R7-2 lumper-policy meta description",
  "desc='Lumper fees explained: $75\\u2013$600 typical (avg ~$300), why it is a PASS-THROUGH cost you must get back, the receipt rules that guarantee reimbursement, and how LoadBoot makes lumper repayment automatic.',",
  "desc='What is a lumper fee? The charge for third-party dock labor that unloads your trailer \\u2014 $75\\u2013$600 typical, and a PASS-THROUGH cost you are meant to get back. The lumper receipt rules that guarantee reimbursement, and how LoadBoot makes lumper repayment automatic.',"),

 ("R7-3 owner-operator-dispatch title",
  "'Owner-Operator Dispatch Service — Keep Your Authority, Keep More of Every Mile | LoadBoot',",
  "'Owner-Operator Dispatch Services 2026 — Keep Your Authority, Flat 5% | LoadBoot',"),

 ("R7-3 owner-operator-dispatch meta description",
  "'Dedicated truck dispatch for owner-operators. Keep your authority, book higher-paying loads, and offload the back office. Flat 5%, no contracts, cancel anytime.',",
  "'Owner-operator dispatch services: keep your authority, book higher-paying loads, and offload the back office to a dedicated dispatcher. You approve every load and every rate. Flat 5%, no contracts, cancel anytime.',"),
]

# --- verify every anchor exactly once (or already applied) ---
pending, done, bad = [], [], []
for label, old, new in EDITS:
    n_old, n_new = s.count(old), s.count(new)
    if n_old == 1:
        pending.append((label, old, new))
    elif n_old == 0 and n_new >= 1:
        done.append(label)
    else:
        bad.append('%s -> old x%d / new x%d' % (label, n_old, n_new))

if bad:
    print('ABORT - nothing written. Bad anchors:')
    for b in bad: print('  ' + b)
    sys.exit(1)

if not pending:
    print('Already patched (all %d edits present). No change.' % len(done))
    sys.exit(0)

for label, old, new in pending:
    s = s.replace(old, new, 1)
    print('  applied: ' + label)

import ast
ast.parse(s)          # must stay valid Python before we write
io.open(PATH, 'w', encoding='utf-8', newline='').write(s)
print('OK - %d edit(s) applied, %d already present. ast.parse clean.' % (len(pending), len(done)))
