# -*- coding: utf-8 -*-
# market_reports_module.py -- Workstream 01, LAYER 2 of the supply-side rate engine.
#
# Layer 1 = the eight evergreen equipment hubs (/{slug}-freight-rates.html).
# Layer 2 = this: a DATED report per week that links back into those hubs.
# DAT's engine is not its data, it is that two-layer shape. This copies the shape.
#
# WHAT IT BUILDS, per recorded weekly snapshot:
#   1. freight-market-report-week-WW-YYYY.html  -- all eight equipment, ~1,300 words
#   2. {slug}-rates-week-WW-YYYY.html           -- one rotating deep-dive, ~1,000 words
# plus one evergreen archive hub: freight-market-reports.html (~1,900 words).
#
# WHY NOT EIGHT POSTS A WEEK (the literal DAT pattern):
#   DAT can publish eight weekly reports because RateView sits on decades of real
#   transactions. We publish national benchmarks. Eight near-identical posts a week
#   whose only difference is a number is exactly Google's "scaled content abuse"
#   pattern and it drags whole-site quality. One deep combined report plus one
#   genuinely different deep-dive gives the same freshness and internal-link engine
#   at ~104 pages a year, none of them spun.
#
# THE HONESTY RULE THAT MATTERS MOST -- read before touching _wow():
#   app_private.rate_history contains a METHODOLOGY BREAK. On 2026-07-08 dry van was
#   recorded at $2.10 under "published averages"; on 2026-07-13 it was $3.00 under
#   "National industry benchmarks". That is a change in how the number is built, NOT
#   a 43% market move. A naive diff publishes "dry van up 43% week over week", which
#   is simply false and is the kind of claim that costs a rate page its credibility
#   permanently. _wow() therefore refuses to report a change across a source-family
#   change OR across an implausible move, and says so on the page instead of guessing.
#   When a tool cannot observe something it must say unknown, never a confident number.

import json, datetime, re

# --------------------------------------------------------------------------
# Rotation order. Index = ISO week number % 8.
# Deliberately ordered so the highest-search-volume equipment (dry van, reefer)
# land on the most recent weeks, which are the ones actually seen.
_ROTATION = ['conestoga', 'dry-van', 'reefer', 'box-truck',
             'flatbed', 'step-deck', 'power-only', 'hotshot']

_EQ_ORDER = ['Dry Van', 'Reefer', 'Flatbed', 'Step Deck',
             'Conestoga', 'Power Only', 'Hotshot', 'Box Truck']

_SLUG_OF = {'Dry Van': 'dry-van', 'Reefer': 'reefer', 'Flatbed': 'flatbed',
            'Step Deck': 'step-deck', 'Conestoga': 'conestoga',
            'Power Only': 'power-only', 'Hotshot': 'hotshot', 'Box Truck': 'box-truck'}
_NAME_OF = {v: k for k, v in _SLUG_OF.items()}

# A working all-in operating cost for a one-truck carrier. Same figure the hub
# pages use -- keep them in step or the two pages contradict each other.
_BREAKEVEN = 1.90

# Largest week-over-week move we will publish without calling it a data revision.
# Real national benchmarks do not move 15% in seven days; a print that large is
# almost always the series being rebuilt underneath us.
_MAX_PLAUSIBLE_WOW = 15.0


def _src_family(src):
    """Normalise a source string to its methodology family.

    'National industry benchmarks (Jul 2026)' and '... (Aug 2026)' are the SAME
    method sampled in different months -- comparable. 'published 2026 averages'
    and 'derived from flatbed segment' are different methods -- not comparable.
    The month parenthetical is dropped; anything else is significant.
    """
    s = (src or '').lower().strip()
    s = re.sub(r'\((?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{4}\)', '', s)
    return re.sub(r'\s+', ' ', s).strip(' -')


def _wow(cur, prev):
    """Week-over-week change, or an explicit refusal.

    Returns (kind, pct, label) where kind is one of:
      'up' / 'down' / 'flat'  -- a real, publishable move
      'none'                  -- no prior snapshot exists
      'break'                 -- prior exists but is NOT comparable
    Never returns a number it cannot stand behind.
    """
    if not prev:
        return ('none', None, 'first recorded snapshot')
    if _src_family(cur['source']) != _src_family(prev['source']):
        return ('break', None, 'benchmark method revised')
    if not prev['rpm']:
        return ('break', None, 'benchmark method revised')
    pct = (cur['rpm'] - prev['rpm']) / prev['rpm'] * 100.0
    if abs(pct) > _MAX_PLAUSIBLE_WOW:
        return ('break', None, 'benchmark method revised')
    if abs(pct) < 0.005:
        return ('flat', 0.0, 'unchanged')
    return (('up' if pct > 0 else 'down'), pct, '%s%.1f%%' % ('+' if pct > 0 else '−', abs(pct)))


def _all_identical(snap, prev):
    """True when every equipment matches the prior snapshot to the cent.

    Eight national benchmarks do not all hold to the cent across a week. When they
    do, the benchmark was recorded twice without being refreshed -- and reporting
    that as 'unchanged' asserts a measurement we did not make. This is the same rule
    that governs _wow(): when we cannot observe it, we say so instead of implying it.
    """
    if not prev:
        return False
    a, b = snap.get('rates') or {}, prev.get('rates') or {}
    if not a or set(a) != set(b):
        return False
    return all(float(a[k]['rpm']) == float(b[k]['rpm']) for k in a)


def _chg_cell(kind, label):
    if kind == 'up':
        return '<td class="mr-up">&#9650; ' + label + '</td>'
    if kind == 'down':
        return '<td class="mr-dn">&#9660; ' + label + '</td>'
    if kind == 'flat':
        return '<td class="mr-fl">&#9679; unchanged</td>'
    if kind == 'break':
        return '<td class="mr-nc" title="Not comparable: the benchmark method changed between these two snapshots">n/c *</td>'
    if kind == 'stale':
        return '<td class="mr-nc" title="The benchmark was not refreshed between these two snapshots">not refreshed *</td>'
    return '<td class="mr-nc">&mdash;</td>'


# --------------------------------------------------------------------------
# THE ANGLE LIBRARY.
#
# This is the part that stops the series being a number swap. Each week's report
# takes one analytical angle from this list (index = ISO week % len). Ten angles
# means an angle does not repeat for ten weeks, and when it does it is against a
# different rate print and a different rotating equipment.
#
# Every angle must be TRUE INDEPENDENT OF THE WEEK'S NUMBER -- it is freight
# operating knowledge, not market commentary we cannot support. That is the
# difference between a page worth reading and a spun one.
#
#   h    : section heading on the combined report
#   body : list of paragraphs for the combined report
#   eq_h : section heading on the equipment deep-dive
#   eq   : callable(eq, rpm, name, low) -> list of paragraphs, applied to that equipment
def _first_region(eq):
    """Lead sentence about where this equipment prices above/below the national number.

    Falls back to a true general statement rather than to nothing, so the paragraph
    always reads as a complete sentence even for an equipment with no regions data.
    """
    regs = eq.get('regions') or []
    if not regs:
        return ('origin markets for this equipment are concentrated rather than evenly '
                'spread across the country')
    txt = regs[0][1].rstrip('.')
    return txt[:1].lower() + txt[1:]


_ANGLES = [
 dict(key='deadhead',
  h='The empty miles are what decide whether this number works',
  body=[
   'Every rate on this page is a <b>loaded</b>-mile number, and that is the single most misread thing about a rate '
   'per mile. A truck does not get paid to drive to the pickup. If the load pays $2.95 a mile over 700 miles and the '
   'driver ran 140 empty miles to reach it, the real revenue per mile the truck actually turned is not $2.95 &mdash; '
   'it is roughly $2.46, because the same $2,065 now has to cover 840 miles of fuel, tyres and hours.',
   'That is a 17% haircut that appears nowhere on the rate confirmation, and it is why two loads at identical rates '
   'can be a good week and a bad week. It also explains something brokers see constantly and misdiagnose: a load '
   'paying less from 30 miles away books faster than a load paying more from 200 miles away. The carrier is not being '
   'irrational or holding out. He is doing this arithmetic in his head, correctly, in about four seconds.',
   'The practical consequence for anyone posting freight is that <b>your pickup location is a pricing lever you are '
   'probably not using</b>. A posting that shows a precise city rather than a vague region lets every carrier within '
   'reach work out his own deadhead and decide. A posting that hides it makes every carrier assume the worst case and '
   'price defensively &mdash; or skip it. Precision costs you nothing and it is worth more than the twenty-five cents '
   'you were about to add to the rate.'],
  eq_h='What deadhead does to this week&rsquo;s number',
  eq=lambda eq, rpm, name, low: [
   'At this week&rsquo;s benchmark of <b>$%.2f</b> per loaded mile, a 700-mile %s load grosses about <b>$%s</b>. Run '
   '140 empty miles to reach the pickup and that same money is spread across 840 miles, so the truck&rsquo;s real '
   'revenue per mile turned falls to roughly <b>$%.2f</b> &mdash; and the operating cost does not fall with it.'
   % (rpm, low, format(int(round(rpm * 700)), ','), rpm * 700 / 840.0),
   'This bites %s harder than it bites dry van, for a reason worth knowing: %s freight is less evenly distributed '
   'across the country, so the average distance between one load and the next is longer. Fewer origins means more '
   'empty miles between paid ones, and a national average that looks healthy can still leave a truck short.'
   % (low, low),
   'If you post %s freight, put the exact pickup city and the exact ready time on the posting. Every carrier who can '
   'reach it will do the deadhead maths himself and some of them are closer than you think.' % low]),

 dict(key='accessorials',
  h='Line haul is the number you negotiate. Accessorials are the number that decides the week',
  body=[
   'A rate per mile describes the drive. It does not describe the waiting, and the waiting is where small carriers '
   'lose money they never see coming. Four hours at a dock on a 400-mile run is half a working day against a load '
   'that was only ever going to pay a few hundred dollars of margin. The line haul was fine. The load was not.',
   'LoadBoot publishes fixed accessorial terms rather than renegotiating them load by load: '
   '<a href="detention-pay-policy.html">detention at $60/hr after two free hours</a>, '
   '<a href="layover-policy.html">layover at $250/day</a>, <a href="tonu-policy.html">TONU at $250</a>, and '
   '<a href="lumper-policy.html">lumpers reimbursed on receipt</a>. Those numbers are on the load before anyone '
   'accepts it, and detention is timed against GPS rather than against whose story is better.',
   'Brokers sometimes read published accessorials as a cost they have taken on. In practice it is the opposite. The '
   'expensive version is the argument three weeks later, with a carrier who now prices your freight as a problem lane '
   'and tells other carriers to do the same. A written $60 an hour is cheaper than an unwritten reputation, and it '
   'gets your loads covered by people who have dealt with you before.'],
  eq_h='Where the accessorials land on this equipment',
  eq=lambda eq, rpm, name, low: [
   'On %s freight the accessorial that most often decides profitability is time at the dock, and the benchmark above '
   'does not contain a cent of it. At <b>$%.2f</b> a mile, a 350-mile run grosses about <b>$%s</b>. Two hours of '
   'unpaid detention on top of that is a meaningful share of the margin; four hours can exceed it outright.'
   % (low, rpm, format(int(round(rpm * 350)), ',')),
   'The fix is not a higher rate. It is a written term. Detention at $60 an hour after two free hours turns a bad '
   'afternoon into a priced event, and it makes the receiver&rsquo;s dock performance somebody&rsquo;s problem other '
   'than the driver&rsquo;s. See the <a href="detention-pay-policy.html">detention policy</a> and the '
   '<a href="lumper-policy.html">lumper policy</a> for exactly how both are handled.',
   'If you are comparing a %s quote against the benchmark above, ask what happens at hour three before you compare '
   'the per-mile numbers. The quote with the worse rate and the written accessorial terms is frequently the cheaper '
   'load once it has actually run.' % low]),

 dict(key='lane-direction',
  h='A national average is really two numbers, and direction picks which one you get',
  body=[
   'The figures in this report are national. Every real load is directional, and the same lane run the other way can '
   'price completely differently &mdash; not by a few cents, but by a third. Freight flows are not symmetrical: more '
   'goods move into a consumption market than out of it, so trucks pile up where the freight ends and get scarce '
   'where it starts.',
   'That asymmetry is the whole reason a benchmark should be used as a sanity check and never as a quote. A lane out '
   'of a heavy origin market, where fifty trucks are sitting empty, will book below the national number all day. The '
   'return leg out of the same destination may not exist at any price, which is why the carrier who took your cheap '
   'outbound load will not take the next one.',
   'For a shipper, this is the most useful single question to put to a broker: <i>is this lane heading into a market '
   'trucks want to be in, or out of one?</i> A broker who can answer that is pricing your freight rather than '
   'guessing at it. For a broker, it is the reason a lane that covered easily last month suddenly does not &mdash; '
   'nothing about your load changed, the balance around it did.'],
  eq_h='Direction on this equipment',
  eq=lambda eq, rpm, name, low: [
   'The <b>$%.2f</b> benchmark is a national blend of lanes running in both directions. On %s specifically, that '
   'blend hides more than usual, because %s' % (rpm, low, _first_region(eq)),
   'Practically: take the number above, then ask which way your lane runs relative to where this equipment normally '
   'sits empty. A load leaving a market full of these trailers prices below the benchmark. A load leaving a market '
   'that has none prices above it, and will still take longer to cover.',
   'The <a href="' + '%s-freight-rates.html' % _SLUG_OF.get(name, 'dry-van') + '">%s rate hub</a> carries the '
   'regional breakdown, the seasonal pattern and the full specification list behind this number.' % low]),

 dict(key='appointment',
  h='The receiving requirement is priced into the rate whether anyone said so or not',
  body=[
   'Two loads, same lane, same weight, same week. One is first-come-first-served with a two-day delivery window. The '
   'other has a hard 08:00 appointment on a fixed date. They are not the same load and they should not be the same '
   'rate, because the second one has quietly taken control of the driver&rsquo;s fourteen-hour clock away from him.',
   'A hard appointment does three things to a rate. It shrinks the pool of trucks that can legally make the window, '
   'so fewer carriers compete for it. It raises the chance of an unpaid overnight if the truck arrives after cut-off, '
   'which is a <a href="layover-policy.html">layover</a> nobody budgeted. And it removes the driver&rsquo;s ability to '
   'recover a bad morning by rearranging his own day. Each of those is worth money and together they are worth a lot.',
   'The useful part is that this is often a choice rather than a constraint. A meaningful share of hard appointments '
   'exist because someone set one up years ago, not because the receiver actually requires one. Before accepting a '
   'quote well above the benchmark, it is worth confirming which of the two it is &mdash; converting an unnecessary '
   'appointment to FCFS is the single cheapest rate reduction available to most shippers, and it costs nothing.'],
  eq_h='Appointments and this equipment',
  eq=lambda eq, rpm, name, low: [
   'The <b>$%.2f</b> per mile above is a blend of appointment and FCFS %s freight. If your load carries a hard '
   'appointment, expect to sit above it; if it can run first-come-first-served, expect to sit below.' % (rpm, low),
   'On %s freight the appointment question is sharper than usual, because the loading itself takes time before the '
   'clock question even starts. %s' % (low, eq.get('shipper', '')[:400]),
   'Put the real window on the posting rather than the defensive one. A carrier who can see a genuine two-day '
   'delivery window prices it lower than one who assumes a fixed morning appointment he has not been told about.']),

 dict(key='breakeven',
  h='What this print leaves the truck, once its own costs are paid',
  body=[
   'Whichever side of the load you sit on, the carrier&rsquo;s floor is worth knowing. A broker who understands it '
   'covers freight faster because he stops posting numbers that were never going to move. A shipper who understands '
   'it stops wondering why the cheapest quote keeps falling through two days before pickup.',
   'A working all-in operating cost for a one-truck carrier is around <b>$%.2f per mile</b> &mdash; fuel, payments, '
   'insurance, maintenance, tyres, permits, and the driver&rsquo;s own pay. Newer equipment on a good fuel programme '
   'runs below it. An older truck with a maintenance history runs well above it. It is an average, and any carrier '
   'who has actually done the arithmetic on his own truck should trust his number over this one.' % _BREAKEVEN,
   'Hold every rate in the table above against that figure and the picture changes shape. The gap is not profit &mdash; '
   'it is what is left to absorb deadhead, an unpaid detention, a week with a bad reload, and the repair that has not '
   'happened yet. A rate that clears the floor by a few cents is a rate that only works if nothing goes wrong, and '
   'something usually does. <a href="cost-per-mile-calculator.html">Work out your own number here.</a>'],
  eq_h='This week&rsquo;s margin over operating cost',
  eq=lambda eq, rpm, name, low: [
   'Against a working all-in operating cost of <b>$%.2f</b> per mile, this week&rsquo;s %s benchmark of '
   '<b>$%.2f</b> leaves <b>%s$%.2f per loaded mile</b>. On a 700-mile run that is about <b>$%s</b> before deadhead, '
   'before detention, and before the reload is known.'
   % (_BREAKEVEN, low, rpm, ('+' if rpm >= _BREAKEVEN else '&minus;'), abs(rpm - _BREAKEVEN),
      format(int(round(abs(rpm - _BREAKEVEN) * 700)), ',')),
   'Run the same load with 140 miles of deadhead attached and that margin compresses by roughly a sixth before the '
   'truck has done anything wrong. This is the whole reason a headline rate and a profitable week are different '
   'subjects, and why the equipment with the highest per-mile number is not automatically the one that pays best.',
   '$%.2f is a working average, not your number. <a href="cost-per-mile-calculator.html">Calculate your actual cost '
   'per mile</a> and hold the benchmark against that instead.' % _BREAKEVEN]),

 dict(key='capacity',
  h='What a print at this level does to capacity, three months out',
  body=[
   'Rates and capacity chase each other with a delay, and the delay is what makes freight cycles feel like they come '
   'out of nowhere. When numbers sit low for long enough, the marginal trucks &mdash; one-truck operations running '
   'thin margins on old equipment &mdash; do not dramatically exit. They just stop replacing the truck, take a longer '
   'break after a bad month, and eventually let the authority lapse without announcing it.',
   'That withdrawal is invisible for months and then it is not. Capacity leaves the market quietly, the remaining '
   'trucks find their loads covering faster, and the rate starts to climb for reasons that had nothing to do with '
   'demand. The reverse runs the same way: a firm market pulls new authorities in, and roughly two quarters later '
   'there are more trucks than freight again.',
   'Neither side can control this, but both sides can position for it. A shipper on a firm contract rate while spot '
   'sits below it is paying for the option not to be re-quoted when it turns. A carrier who used a soft stretch to '
   'get his cost per mile down is the one still trading when it does. The cycle is the one thing in freight that has '
   'never stopped repeating.'],
  eq_h='Capacity behind this number',
  eq=lambda eq, rpm, name, low: [
   'Capacity responds differently by equipment, and %s is a case in point: the trailer itself is a barrier. You do '
   'not casually add one of these to a fleet the way an authority adds a dry van, so the supply side reacts to rate '
   'changes far more slowly &mdash; which is exactly why this number is less volatile week to week and more volatile '
   'season to season.' % low,
   'The practical read for a shipper: when %s capacity tightens it does not loosen again quickly, because nobody can '
   'buy their way out of it in a fortnight. Book further ahead on this equipment than you would on van, and treat a '
   'carrier who handles it reliably as a relationship rather than a transaction.' % low,
   'For a carrier the same fact runs the other way. The barrier that keeps supply slow is the same barrier protecting '
   'your rate. It is the argument for specialising rather than competing on the equipment everybody already owns.']),

 dict(key='fuel',
  h='How much of this number is fuel, and why &ldquo;all-in&rdquo; hides it',
  body=[
   'Roughly a fifth to a quarter of a spot rate at current diesel levels is fuel. In contract freight that share is '
   'normally quoted as its own line and moves with the DOE weekly average, which means both parties know what happens '
   'when diesel moves. In spot freight it is usually buried inside a single all-in number, which means neither party '
   'has agreed what happens.',
   'That distinction is not academic. When someone quotes an all-in rate, they have made a fuel assumption on your '
   'behalf and not told you what it was. If diesel moves several cents between booking and running &mdash; and over a '
   'multi-week contract it will &mdash; somebody absorbs the difference, and it is whoever was less specific.',
   'The question that settles it takes one sentence: <i>what fuel assumption is inside that number, and does it move?</i> '
   'A broker who can answer is quoting you. One who cannot is guessing and hoping. '
   '<a href="fuel-surcharge-trucking.html">How fuel surcharge actually works &rarr;</a>'],
  eq_h='Fuel inside this equipment&rsquo;s number',
  eq=lambda eq, rpm, name, low: [
   'Splitting this week&rsquo;s <b>$%.2f</b> %s benchmark at an industry-typical 78/22 gives roughly <b>$%.2f</b> of '
   'line haul and <b>$%.2f</b> of fuel per mile. That split is an approximation and it moves with the lane and the '
   'week &mdash; which is precisely why fuel belongs on its own line rather than inside one number.'
   % (rpm, low, rpm * 0.78, rpm * 0.22),
   '%s carries a wrinkle general freight does not, and it matters here: fuel burn on this equipment is not only the '
   'tractor. %s' % (name, eq.get('broker', '')[:360]),
   'If you are quoting %s freight over more than a single load, agree the fuel mechanism before you agree the rate. '
   '<a href="fuel-surcharge-trucking.html">The mechanics are here.</a>' % low]),

 dict(key='seasonality',
  h='Where this print sits in the freight calendar',
  body=[
   'A rate is close to meaningless without the month attached to it. Truckload freight has a shape that repeats every '
   'year with more reliability than almost anything else in the business: a January and February floor when holiday '
   'volume has gone and every truck is looking for work, a spring recovery, a summer that depends entirely on which '
   'equipment you run, and an autumn peak as retail builds toward Q4.',
   'The equipment types diverge hardest in summer. Produce season pulls refrigerated capacity out of general freight '
   'from roughly May through July, which lifts reefer sharply and quietly firms up dry van as a side effect. Flatbed '
   'runs on a completely different calendar again &mdash; construction and industrial output, not retail &mdash; '
   'which is why flatbed can be strong in a week when van is soft.',
   'The reason to hold a weekly print against the seasonal pattern rather than against last week is that most '
   'week-to-week movement is noise, and the seasonal move is signal. A number that looks weak in isolation may be '
   'exactly where that equipment always sits in that month, and a number that looks stable may be badly '
   'underperforming the season it is in.'],
  eq_h='This week against the seasonal pattern',
  eq=lambda eq, rpm, name, low: [
   'This week&rsquo;s <b>$%.2f</b> is more useful read against the calendar than against last week. The %s year runs '
   'roughly like this:' % (rpm, low),
   '<ul>' + ''.join('<li><b>%s</b> &mdash; %s</li>' % (p, w) for p, w in (eq.get('season') or [])) + '</ul>',
   'Hold the number above against that and you get a far better read than a week-over-week arrow gives you. The full '
   'seasonal detail, the specification table and the regional breakdown all live on the '
   '<a href="%s-freight-rates.html">%s rate hub</a>.' % (_SLUG_OF.get(name, 'dry-van'), low)]),

 dict(key='posting-quality',
  h='Why loads sit at a perfectly fair rate',
  body=[
   'The assumption when a load does not cover is that the rate is wrong. Frequently it is not. The load is sitting '
   'because a carrier cannot tell from the posting whether it is legal on his trailer, how long he is going to wait, '
   'or what he gets paid if it goes wrong &mdash; and an unanswerable posting gets skipped rather than called about.',
   'Five things fix most of it, and none of them cost a cent. The exact pickup city and ready time, so the carrier can '
   'do his own deadhead maths. Real weight and real dimensions, so he knows it is legal on his equipment. Whether it '
   'is FCFS or appointment, and the true window. The accessorial terms in writing. And whether hazmat is involved, '
   'which is a question that never gets inferred and never gets guessed.',
   'The measurable version of this: a load re-posted three times has already burned the margin the re-posting was '
   'protecting, and every carrier who saw it twice now prices your lane as a problem. Posting it once, complete, at a '
   'number that moves is cheaper than posting it cheap three times. '
   '<a href="free-load-board-for-brokers.html">Posting on LoadBoot is free for brokers and shippers &rarr;</a>'],
  eq_h='Posting this equipment so it actually covers',
  eq=lambda eq, rpm, name, low: [
   'Rate is rarely why a %s load sits. On this equipment the questions a carrier needs answered before he will call '
   'are specific:' % low,
   '<ul>' + ''.join('<li><b>%s</b> &mdash; %s</li>' % (t, d) for t, d in (eq.get('post') or [])) + '</ul>',
   'A posting at <b>$%.2f</b> a mile that answers all of those covers faster than one at a higher number that answers '
   'none of them. <a href="/app/partner/">Post a %s load &rarr;</a>' % (rpm, low)]),

 dict(key='weight-legality',
  h='The specification that quietly sets the rate before anyone negotiates',
  body=[
   'Most failed bookings are not arguments about money. They are a load that physically does not fit, or is not legal '
   'on, the trailer that showed up &mdash; and that is discovered at the dock, after both parties have already spent '
   'the day. The specification is not administrative detail. It is the first thing that prices the load.',
   'Weight is the clearest example. Past roughly 44,000 lb of cargo on a van you begin removing trucks from the pool '
   'that can legally take it, and the rate follows the shrinking pool rather than the extra effort. Height does the '
   'same thing on deck freight: pass about eight and a half feet and a flatbed stops being the right answer, no '
   'matter that it can physically carry the piece. The driver, not the shipper, is the one who receives the citation.',
   'The cheapest thing anyone can do to a rate is to state the real numbers up front. Real weight, real dimensions, '
   'real securement requirement. A carrier who can confirm the load is legal on his equipment from the posting alone '
   'prices it as a normal load. One who has to find out at the dock prices it as a risk, or does not call.'],
  eq_h='The specification behind this equipment&rsquo;s number',
  eq=lambda eq, rpm, name, low: [
   'The <b>$%.2f</b> benchmark assumes freight that is legal and normal on this equipment. These are the numbers that '
   'decide whether yours is:' % rpm,
   '<table class="mr-t"><tbody>' + ''.join('<tr><td style="width:34%%"><b>%s</b></td><td>%s</td></tr>' % (k, v)
     for k, v in (eq.get('specs') or [])) + '</tbody></table>',
   '<b>Commonly shipped on %s:</b> %s' % (low, eq.get('ships', '')),
   'Put the real figures on the posting. Every hour spent confirming a load is legal on the trailer is an hour nobody '
   'is paying for, and it is the most common reason a rate that looked fine ends up renegotiated at the dock.']),
]


# --------------------------------------------------------------------------
MR_CSS = ('<style>'
 '.mr-hero{background:radial-gradient(1000px 400px at 12% -20%,rgba(8,131,247,.35),transparent 60%),'
   'radial-gradient(700px 320px at 95% 120%,rgba(252,83,5,.22),transparent 55%),'
   'linear-gradient(120deg,#0b1830,#10223B 60%,#132c4e);color:#fff;padding:58px 0 44px}'
 '.mr-hero h1{color:#fff;font-size:clamp(1.75rem,4vw,2.7rem);margin:0 0 12px;line-height:1.14}'
 '.mr-hero p{color:rgba(255,255,255,.84);max-width:800px;line-height:1.75;font-size:1.02rem}'
 '.mr-kicker{display:inline-flex;gap:8px;align-items:center;background:rgba(8,131,247,.18);color:#7cc0ff;'
   'border:1px solid rgba(124,192,255,.35);border-radius:999px;padding:6px 15px;font-weight:800;'
   'font-size:.73rem;letter-spacing:.07em;text-transform:uppercase;margin-bottom:14px}'
 '.mr-t{width:100%;border-collapse:collapse;background:#fff;border-radius:14px;overflow:hidden;'
   'box-shadow:0 14px 36px -28px rgba(2,12,30,.35);margin:16px 0}'
 '.mr-t th{background:#10223B;color:#fff;text-align:left;padding:12px 15px;font-size:.69rem;'
   'letter-spacing:.09em;text-transform:uppercase;white-space:nowrap}'
 '.mr-t td{padding:12px 15px;border-bottom:1px solid #eef2f7;font-size:.93rem;color:#334155;line-height:1.6}'
 '.mr-t tr:last-child td{border-bottom:0}'
 '.mr-t td a{font-weight:700}'
 '.mr-num{font-variant-numeric:tabular-nums;font-weight:800;color:#0967d2;white-space:nowrap}'
 '.mr-up{font-weight:800;color:#15803d;white-space:nowrap;font-variant-numeric:tabular-nums}'
 '.mr-dn{font-weight:800;color:#dc2626;white-space:nowrap;font-variant-numeric:tabular-nums}'
 '.mr-fl{font-weight:700;color:#64748b;white-space:nowrap}'
 '.mr-nc{font-weight:700;color:#a16207;white-space:nowrap;cursor:help}'
 '.mr-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}'
 '.mr-note{background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:15px 18px;'
   'color:#713f12;font-size:.9rem;line-height:1.72;margin:16px 0;max-width:860px}'
 '.mr-two{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;margin:22px 0}'
 '.mr-n{border-left:3px solid #0883F7;background:#f7fafd;border-radius:0 12px 12px 0;padding:17px 19px}'
 '.mr-n.s{border-left-color:#16a34a}.mr-n.c{border-left-color:#FC5305}'
 '.mr-n b{display:block;font-size:.7rem;letter-spacing:.11em;text-transform:uppercase;color:#64748b;margin-bottom:7px}'
 '.mr-n p{margin:0 0 9px;font-size:.93rem;color:#334155;line-height:1.75}.mr-n p:last-child{margin-bottom:0}'
 '.mr-faq{background:#fff;border:1px solid #e6ebf3;border-radius:16px;margin:10px 0;padding:17px 21px}'
 '.mr-faq h3{margin:0 0 6px;font-size:1rem;color:#0f172a}'
 '.mr-faq p{margin:0;font-size:.91rem;color:#475569;line-height:1.74}'
 '.mr-nav{display:flex;flex-wrap:wrap;gap:12px;justify-content:space-between;align-items:center;'
   'background:#f7fafd;border:1px solid #e6ebf3;border-radius:14px;padding:15px 19px;margin:22px 0}'
 '.mr-nav a{font-weight:700;text-decoration:none;color:#0967d2}'
 '.mr-hubs{display:flex;flex-wrap:wrap;gap:9px;margin-top:16px}'
 '.mr-hubs a{background:#f1f5f9;border:1px solid #e2e8f0;border-radius:999px;padding:7px 14px;'
   'font-size:.86rem;font-weight:700;text-decoration:none;color:#0f172a}'
 '.mr-idx{display:grid;grid-template-columns:repeat(auto-fit,minmax(272px,1fr));gap:14px;margin:20px 0}'
 '.mr-card{background:#fff;border:1px solid #e6ebf3;border-radius:16px;padding:19px;'
   'box-shadow:0 14px 36px -28px rgba(2,12,30,.35)}'
 '.mr-card .wk{font-size:.68rem;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:#64748b}'
 '.mr-card h3{margin:6px 0 7px;font-size:1.02rem}'
 '.mr-card h3 a{text-decoration:none;color:#0f172a}'
 '.mr-card p{margin:0 0 10px;font-size:.88rem;color:#475569;line-height:1.65}'
 '.mr-card .dd{font-size:.85rem}'
 '</style>')


_MONTH = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July',
          'August', 'September', 'October', 'November', 'December']


def _week_dates(iso_year, iso_week):
    """Monday and Sunday of an ISO week."""
    mon = datetime.date.fromisocalendar(iso_year, iso_week, 1)
    return mon, mon + datetime.timedelta(days=6)


def _pretty(d):
    return '%d %s %d' % (d.day, _MONTH[d.month], d.year)


def _fmt_money(n):
    return '$' + format(int(round(n)), ',')


def _movement_narrative(rows, has_break, stale=False):
    """Plain-English summary of what the table shows -- built from the data, never asserted.

    rows: list of (name, cur, prev, kind, pct, label)
    """
    ups = [r for r in rows if r[3] == 'up']
    dns = [r for r in rows if r[3] == 'down']
    fls = [r for r in rows if r[3] == 'flat']
    ncs = [r for r in rows if r[3] in ('break', 'none')]
    out = []

    if stale:
        out.append(
          'Every figure in this snapshot is identical to the previous one, to the cent, across all eight equipment '
          'types. That is not a market that held perfectly still &mdash; eight independent national benchmarks do '
          'not do that. It means the benchmark was recorded again without having been refreshed in between.')
        out.append(
          'So this report shows the week&rsquo;s levels and says nothing about movement, because there is no '
          'movement to report and pretending otherwise would be inventing a measurement we did not make. The '
          'levels themselves stand: they are the most recent benchmark on record for the week shown.')
        return out

    if not (ups or dns or fls):
        if all(r[3] == 'none' for r in rows):
            out.append(
              'This is the earliest benchmark snapshot on record, so there is nothing behind it to compare against '
              'and the movement column is empty by definition rather than by omission. It is the baseline the later '
              'reports in this archive are measured from.')
        else:
            out.append(
              'There is no publishable week-over-week comparison in this snapshot. The previous benchmark was built '
              'on a different basis, so a change figure would be measuring our own methodology rather than the '
              'freight market &mdash; and a rate page that prints that once has spent credibility it cannot buy '
              'back. We would rather print nothing than print a number we cannot stand behind, so the movement '
              'column reads <b>n/c</b> throughout.')
        return out

    def _lst(rs):
        n = [r[0].lower() for r in rs]
        if len(n) == 1:
            return n[0]
        return ', '.join(n[:-1]) + ' and ' + n[-1]

    parts = []
    if ups:
        big = max(ups, key=lambda r: r[4])
        parts.append('<b>%s</b> moved up, with %s the largest at %s' % (_lst(ups), big[0].lower(), big[5]))
    if dns:
        big = min(dns, key=lambda r: r[4])
        parts.append('<b>%s</b> moved down, %s furthest at %s' % (_lst(dns), big[0].lower(), big[5]))
    if fls:
        parts.append('<b>%s</b> came in unchanged' % _lst(fls))
    out.append('Against the previous recorded snapshot: ' + '; '.join(parts) + '.')

    if ncs:
        out.append(
          'No comparison is shown for %s. In each case the prior snapshot was recorded on a different basis, and a '
          'percentage across that break would describe a change in how we build the number rather than a change in '
          'the freight market. Those cells read <b>n/c</b> deliberately.' % _lst(ncs))

    out.append(
      'A word on how much weight to put on any of this. Week-to-week movement in a national benchmark is mostly '
      'noise; the signal is in the seasonal shape and in where a lane sits relative to the national blend. A single '
      'week&rsquo;s arrow is a data point, not a trend, and it is a much worse guide to what to pay than the month '
      'you are in and the direction your lane runs.')
    return out


def _season_note(month):
    if month in (1, 2):
        return ('the annual floor for most equipment. Holiday volume has cleared, northern construction is stopped, '
                'and there are more trucks than freight in nearly every market. Rates recorded now are not a fair '
                'guide to what the same lane costs in October.')
    if month in (3, 4, 5):
        return ('the spring recovery. Retail resets, building season opening across the Midwest and South, and the '
                'first pull of produce capacity out of general freight. This is normally the steepest improving '
                'stretch of the year on deck equipment.')
    if month in (6, 7):
        return ('peak produce and peak construction at the same time. Refrigerated capacity is being pulled out of '
                'general freight, which lifts reefer sharply and quietly firms up dry van as a side effect, while '
                'flatbed runs on its own construction calendar entirely.')
    if month == 8:
        return ('the late-summer transition. The produce harvest is tapering so refrigerated capacity begins '
                'returning to general freight, construction is still running, and retail has not yet started building '
                'for Q4. It is one of the flatter stretches of the freight year.')
    if month in (9, 10, 11):
        return ('the strongest stretch of the year for van and reefer, as retail builds toward Q4 and capacity '
                'tightens. Flatbed begins tapering in the North while the South and Southwest stay active.')
    return ('the December pattern: firm through roughly the second week while holiday freight is still being '
            'positioned, then a sharp drop once it is in place and a slide into the January floor.')


def _combined_report(snap, prev, eqs_by_name, acc_faq_schema, all_weeks, idx):
    yr, wk = snap['iso_year'], snap['iso_week']
    mon, sun = _week_dates(yr, wk)
    as_of = datetime.date.fromisoformat(snap['as_of'])
    fname = 'freight-market-report-week-%02d-%d.html' % (wk, yr)
    dd_slug = _ROTATION[wk % len(_ROTATION)]
    dd_name = _NAME_OF[dd_slug]
    dd_file = '%s-rates-week-%02d-%d.html' % (dd_slug, wk, yr)
    angle = _ANGLES[wk % len(_ANGLES)]

    stale = _all_identical(snap, prev)
    rows = []
    for nm in _EQ_ORDER:
        cur = snap['rates'].get(nm)
        if not cur:
            continue
        pv = (prev or {}).get('rates', {}).get(nm)
        if stale:
            kind, pct, label = ('stale', None, 'not refreshed')
        else:
            kind, pct, label = _wow(cur, pv)
        rows.append((nm, cur, pv, kind, pct, label))
    has_break = any(r[3] == 'break' for r in rows)

    b = MR_CSS
    b += ('<section class="mr-hero"><div class="wrap">'
      '<span class="mr-kicker">Week %02d &middot; %d</span>'
      '<h1>Freight Market Report &mdash; Week %02d, %d</h1>'
      '<p>National benchmark rates per mile for all eight truckload equipment types, for the week of '
      '%s to %s. Benchmark snapshot recorded <b>%s</b>. What moved, what did not, what it means if you are '
      'buying capacity and what it leaves the truck that hauls it.</p></div></section>'
      % (wk, yr, wk, yr, _pretty(mon), _pretty(sun), _pretty(as_of)))

    # 1. the table
    trs = ''
    for nm, cur, pv, kind, pct, label in rows:
        slug = _SLUG_OF[nm]
        trs += ('<tr><td><b><a href="%s-freight-rates.html">%s</a></b></td>'
                '<td class="mr-num">$%.2f</td>%s'
                '<td class="mr-num" style="color:#15803d">$%.2f</td>'
                '<td>%s</td></tr>'
                % (slug, nm, cur['rpm'], _chg_cell(kind, label),
                   round(cur['rpm'] * 1.15, 2),
                   ('$%.2f' % pv['rpm']) if pv else '&mdash;'))
    b += ('<section><div class="wrap prose">'
      '<h2>Week %02d benchmark rates, all equipment</h2>'
      '<p>Carrier rate per mile is what lands on the rate confirmation. Shipper rate per mile is the all-in number '
      'before any accessorial actually incurred on the load. Every equipment name links to its full rate hub.</p>'
      '<div class="mr-scroll"><table class="mr-t"><thead><tr><th>Equipment</th><th>Carrier $/mi</th>'
      '<th>vs prior snapshot</th><th>Shipper $/mi</th><th>Prior</th></tr></thead>'
      '<tbody>%s</tbody></table></div>' % (wk, trs))
    if stale:
        b += ('<p style="color:#64748b;font-size:.9rem">* <b>Not refreshed.</b> Every figure here is identical to the '
              'previous snapshot across all eight equipment types, which means the benchmark was recorded again '
              'without being rebuilt in between &mdash; not that the market held perfectly still. We show the levels '
              'and report no movement, rather than describe a measurement we did not make.</p>')
    elif has_break:
        b += ('<p style="color:#64748b;font-size:.9rem">* <b>n/c &mdash; not comparable.</b> The prior snapshot for '
              'this equipment was recorded on a different basis. Printing a percentage across that break would '
              'describe a change in our own method, not a change in the market, so we do not print one.</p>')
    b += '</div></section>'

    # 2. what moved
    b += ('<section class="bg-soft"><div class="wrap prose"><h2>What moved this week</h2>'
      + ''.join('<p>%s</p>' % p for p in _movement_narrative(rows, has_break, stale)) + '</div></section>')

    # 3. the rotating angle -- the analysis
    b += ('<section><div class="wrap prose"><h2>%s</h2>%s</div></section>'
      % (angle['h'], ''.join('<p>%s</p>' % p for p in angle['body'])))

    # 4. seasonal placement
    b += ('<section class="bg-soft"><div class="wrap prose">'
      '<h2>Where week %02d sits in the freight year</h2>'
      '<p>%s is %s</p>'
      '<p>This matters more than the week-over-week column above. A benchmark without a month attached to it is close '
      'to meaningless, because the same lane genuinely costs different money in February and October and neither '
      'number is wrong. Read the table against the season first and against last week second.</p>'
      '</div></section>' % (wk, _MONTH[mon.month], _season_note(mon.month)))

    # 5. three audiences
    top = max(rows, key=lambda r: r[1]['rpm'])
    bot = min(rows, key=lambda r: r[1]['rpm'])
    b += ('<section><div class="wrap prose"><h2>Reading week %02d from all three sides of the load</h2>'
      '<div class="mr-two">'
      '<div class="mr-n"><b>If you are a broker</b>'
      '<p>The spread in this table is the useful part, not any single row. %s sits highest this week at $%.2f and '
      '%s lowest at $%.2f, and the gap between them is roughly what specialised equipment is worth over general '
      'freight right now.</p>'
      '<p>Buy against the benchmark, but cover against the posting. A load re-posted three times has already burned '
      'the margin the re-posting was meant to protect. '
      '<a href="free-load-board-for-brokers.html">Why posting here is free &rarr;</a></p></div>'
      '<div class="mr-n s"><b>If you are a shipper</b>'
      '<p>Use this as a sanity check on a quote, never as a quote. If your number sits well above the row for your '
      'equipment, the usual causes are a hard appointment, a slow dock, or a destination trucks do not want to run '
      'to &mdash; and two of those three you can change.</p>'
      '<p>Ask the broker which one is driving it before accepting. A good one will tell you, and the answer is '
      'frequently worth more than the negotiation. <a href="shipper-solutions.html">Shipper solutions &rarr;</a></p></div>'
      '<div class="mr-n c"><b>If you run the truck</b>'
      '<p>Hold every row against your own cost per mile rather than against the row above it. The gap is not profit; '
      'it is what absorbs deadhead, an unpaid wait, and the repair that has not happened yet.</p>'
      '<p><a href="cost-per-mile-calculator.html">Work out your real number &rarr;</a> then come back to this '
      'table &mdash; it reads completely differently once you have it.</p></div>'
      '</div></div></section>'
      % (wk, top[0], top[1]['rpm'], bot[0], bot[1]['rpm']))

    # 6. break-even table
    be = ''
    for nm, cur, pv, kind, pct, label in rows:
        m = cur['rpm'] - _BREAKEVEN
        if abs(m) < 0.005:
            cell = '<td class="mr-fl">at break-even</td><td class="mr-fl">&mdash;</td>'
        else:
            cell = ('<td class="%s">%s$%.2f</td><td class="mr-num">%s</td>'
                    % (('mr-up' if m > 0 else 'mr-dn'), ('+' if m > 0 else '&minus;'),
                       abs(m), _fmt_money(abs(m) * 700)))
        be += ('<tr><td><b><a href="%s-freight-rates.html">%s</a></b></td>'
               '<td class="mr-num">$%.2f</td>%s</tr>'
               % (_SLUG_OF[nm], nm, cur['rpm'], cell))
    b += ('<section class="bg-soft"><div class="wrap prose">'
      '<h2>What week %02d leaves the truck</h2>'
      '<p>Against a working all-in operating cost of <b>$%.2f per mile</b> for a one-truck carrier &mdash; fuel, '
      'payments, insurance, maintenance, tyres, permits and the driver&rsquo;s own pay. The right-hand column is the '
      'same margin on a 700-mile run, <b>before</b> deadhead and before any unpaid time at a dock.</p>'
      '<div class="mr-scroll"><table class="mr-t"><thead><tr><th>Equipment</th><th>Carrier $/mi</th>'
      '<th>Over operating cost</th><th>On 700 mi</th></tr></thead><tbody>%s</tbody></table></div>'
      '<div class="mr-note"><b>Deadhead is the part that decides it.</b> None of the figures above contain a single '
      'empty mile. A 700-mile load with 140 miles of deadhead attached spreads the same money over 840 miles, which '
      'takes roughly a sixth off every number in that column before anything has gone wrong. It is also why a load '
      'paying less from nearby covers faster than a load paying more from far away.</div>'
      '</div></section>' % (wk, _BREAKEVEN, be))

    # 7. accessorials
    b += ('<section><div class="wrap prose"><h2>The terms underneath every rate in this report</h2>'
      '<p>None of the numbers above contain accessorials, and accessorials are frequently what decides whether the '
      'load was profitable. LoadBoot publishes fixed terms rather than renegotiating them load by load, so both '
      'sides know before the truck moves.</p>'
      '<div class="mr-scroll"><table class="mr-t"><thead><tr><th>Accessorial</th><th>Standard</th>'
      '<th>When it bites</th></tr></thead><tbody>'
      '<tr><td><b><a href="detention-pay-policy.html">Detention</a></b></td><td>$60/hr after 2 free hours</td>'
        '<td>Four hours at a dock can exceed the whole margin on a short lane.</td></tr>'
      '<tr><td><b><a href="layover-policy.html">Layover</a></b></td><td>$250/day</td>'
        '<td>A missed appointment that pushes delivery to the next day.</td></tr>'
      '<tr><td><b><a href="tonu-policy.html">TONU</a></b></td><td>$250</td>'
        '<td>Truck ordered, then the load is not there or does not fit.</td></tr>'
      '<tr><td><b><a href="lumper-policy.html">Lumper</a></b></td><td>Reimbursed with receipt</td>'
        '<td>Grocery and food distribution, almost every time.</td></tr>'
      '</tbody></table></div></div></section>')

    # 8. deep dive callout
    b += ('<section class="bg-soft"><div class="wrap prose">'
      '<h2>This week&rsquo;s equipment deep-dive: %s</h2>'
      '<p>Each week one equipment type gets its own dated breakdown &mdash; the week&rsquo;s number applied to real '
      'lane distances, what it leaves the truck, and the specification and posting detail that decides whether a load '
      'covers at all. This week it is %s.</p>'
      '<p><a href="%s"><b>Read the %s deep-dive for week %02d &rarr;</b></a> &middot; '
      '<a href="%s-freight-rates.html">%s rate hub (evergreen) &rarr;</a></p>'
      '</div></section>' % (dd_name, dd_name.lower(), dd_file, dd_name.lower(), wk, dd_slug, dd_name))

    # 9. methodology
    b += ('<section><div class="wrap prose"><h2>How this report is built, and what it is not</h2>'
      '<p>These are <b>national benchmark</b> figures. They are not a proprietary rate index built from our own '
      'transaction history, and we say so plainly on every page that carries them, because a rate is only useful when '
      'you know what stands behind it. A benchmark is a sanity check on a quote. It is not a quote.</p>'
      '<p>Each report is built from a benchmark snapshot recorded in the week it covers, and the snapshot is never '
      'edited afterwards &mdash; which is why a report from eight weeks ago still shows the number that was actually '
      'recorded then rather than today&rsquo;s. Week-over-week change is only printed when the two snapshots were '
      'built on the same basis. When the basis changed, the cell reads <b>n/c</b> and this page says so, because a '
      'percentage across a methodology change measures us, not the market.</p>'
      '<p>What a national benchmark cannot tell you: which direction your lane runs, what the receiving requirement '
      'is, how long the dock takes, and how far the nearest truck actually is. Those four things move a real quote '
      'more than the national number does. <a href="market-rates.html">All equipment on one page &rarr;</a></p>'
      '</div></section>')

    # 10. nav + hubs
    prev_w = all_weeks[idx - 1] if idx > 0 else None
    next_w = all_weeks[idx + 1] if idx + 1 < len(all_weeks) else None
    nav = '<div class="mr-nav">'
    nav += ('<a href="freight-market-report-week-%02d-%d.html">&larr; Week %02d, %d</a>'
            % (prev_w['iso_week'], prev_w['iso_year'], prev_w['iso_week'], prev_w['iso_year'])) if prev_w else '<span></span>'
    nav += '<a href="freight-market-reports.html"><b>All market reports</b></a>'
    nav += ('<a href="freight-market-report-week-%02d-%d.html">Week %02d, %d &rarr;</a>'
            % (next_w['iso_week'], next_w['iso_year'], next_w['iso_week'], next_w['iso_year'])) if next_w else '<span></span>'
    nav += '</div>'
    b += ('<section class="bg-soft"><div class="wrap prose">%s'
      '<h2>Rate hubs for every equipment type</h2>'
      '<p>The reports are dated. The hubs are evergreen &mdash; specifications, seasonality, regional variation, '
      'lane examples and the posting detail for each equipment type, refreshed as the benchmark refreshes.</p>'
      '<div class="mr-hubs">%s</div></div></section>'
      % (nav, ''.join('<a href="%s-freight-rates.html">%s rates</a>' % (_SLUG_OF[n], n) for n in _EQ_ORDER)))

    # 11. FAQ
    faq = [
     ('What were freight rates in week %02d of %d?' % (wk, yr),
      'The national benchmark for the week of %s to %s was $%.2f per mile on dry van, $%.2f on reefer and $%.2f on '
      'flatbed, with all eight equipment types listed in the table above. Those are carrier rates per mile; the '
      'shipper all-in figure runs roughly 15%% higher before accessorials.'
      % (_pretty(mon), _pretty(sun),
         snap['rates'].get('Dry Van', {}).get('rpm', 0), snap['rates'].get('Reefer', {}).get('rpm', 0),
         snap['rates'].get('Flatbed', {}).get('rpm', 0))),
     ('Why do some rows say &ldquo;n/c&rdquo; instead of a percentage?',
      'Because the previous benchmark for that equipment was built on a different basis, so a percentage would be '
      'measuring a change in our own method rather than a change in the freight market. We would rather print '
      'nothing than print a number we cannot stand behind.'),
     ('Are these your own transaction rates?',
      'No. They are national benchmark figures, not a proprietary rate index built from our own booked loads, and we '
      'label them that way everywhere they appear. Treat them as a sanity check on a quote you have been given.'),
     ('How much does a week-over-week change actually tell me?',
      'Less than most people assume. Week-to-week movement in a national benchmark is largely noise. The seasonal '
      'position and the direction your specific lane runs both move a real quote considerably more than the weekly '
      'arrow does.'),
     ('What is not included in these rates?',
      'Accessorials. Detention, layover, TONU and lumper fees all sit outside the per-mile number, and on a short '
      'lane they can be worth more than the margin. The standard terms are in the table above.'),
     ('Why is my quote higher than the benchmark?',
      'Usually one of three things: a hard delivery appointment, a slow-loading dock, or a destination market trucks '
      'do not want to run into. Two of the three are changeable, which is why it is worth asking which one it is '
      'before accepting the number.'),
     ('How often is this updated?',
      'A new report is published for each week a benchmark snapshot is recorded, and past reports are never edited '
      'afterwards &mdash; a week-%02d report keeps showing the week-%02d number. The evergreen '
      '<a href="market-rates.html">market rates page</a> always shows the current figure instead.' % (wk, wk)),
    ]
    b += ('<section><div class="wrap prose"><h2>Week %02d rate questions</h2>%s</div></section>'
      % (wk, ''.join('<div class="mr-faq"><h3>%s</h3><p>%s</p></div>' % (q, a) for q, a in faq)))

    art = ('<script type="application/ld+json">' + json.dumps({
      "@context": "https://schema.org", "@type": "Article",
      "headline": "Freight Market Report — Week %02d, %d" % (wk, yr),
      "datePublished": snap['as_of'], "dateModified": snap['as_of'],
      "author": {"@type": "Organization", "name": "LoadBoot"},
      "publisher": {"@type": "Organization", "name": "LoadBoot"},
      "about": "National truckload freight rates per mile by equipment type"}) + '</script>')

    return dict(
      fname=fname,
      title='Freight Market Report Week %02d, %d &mdash; Truckload Rates Per Mile | LoadBoot' % (wk, yr),
      desc='Truckload rates per mile, week %02d of %d: dry van $%.2f, reefer $%.2f, flatbed $%.2f and five more '
           'equipment types, what moved, and what each leaves the truck.'
           % (wk, yr, snap['rates'].get('Dry Van', {}).get('rpm', 0),
              snap['rates'].get('Reefer', {}).get('rpm', 0), snap['rates'].get('Flatbed', {}).get('rpm', 0)),
      body=b, schema=acc_faq_schema(faq) + art,
      related=[('freight-market-reports.html', 'All Market Reports'),
               (dd_file, '%s Deep-Dive' % dd_name),
               ('market-rates.html', 'Current Market Rates'),
               ('load-board.html', 'Live Load Board'),
               ('free-load-board-for-brokers.html', 'Free Load Board for Brokers'),
               ('cost-per-mile-calculator.html', 'Cost Per Mile Calculator')],
      week=wk, year=yr, as_of=snap['as_of'], dd_file=dd_file, dd_name=dd_name, dd_slug=dd_slug, rows=rows)


def _deep_dive(snap, prev, eq, acc_faq_schema, combined_file):
    """The rotating per-equipment dated post. Its whole job is to link back into the hub."""
    yr, wk = snap['iso_year'], snap['iso_week']
    mon, sun = _week_dates(yr, wk)
    as_of = datetime.date.fromisoformat(snap['as_of'])
    name, slug = eq['name'], eq['slug']
    low = name.lower()
    hub = '%s-freight-rates.html' % slug
    fname = '%s-rates-week-%02d-%d.html' % (slug, wk, yr)
    angle = _ANGLES[wk % len(_ANGLES)]

    cur = snap['rates'][name]
    rpm = float(cur['rpm'])
    pv = (prev or {}).get('rates', {}).get(name)
    stale = _all_identical(snap, prev)
    kind, pct, label = ('stale', None, 'not refreshed') if stale else _wow(cur, pv)
    shipper_rpm = round(rpm * 1.15, 2)

    b = MR_CSS
    b += ('<section class="mr-hero"><div class="wrap">'
      '<span class="mr-kicker">%s Report &middot; Week %02d, %d</span>'
      '<h1>%s Rates &mdash; Week %02d, %d</h1>'
      '<p>The national %s benchmark for the week of %s to %s, snapshot recorded %s: what the carrier is paid, what '
      'the shipper pays, what it works out to on a real lane, and what it leaves the truck once its own costs are '
      'covered.</p></div></section>'
      % (name, wk, yr, name, wk, yr, low, _pretty(mon), _pretty(sun), _pretty(as_of)))

    # 1. the number
    if kind in ('up', 'down'):
        chg = 'That is <b>%s</b> against the previous recorded snapshot of $%.2f.' % (label, pv['rpm'])
    elif kind == 'flat':
        chg = 'That is unchanged from the previous recorded snapshot.'
    elif kind == 'break':
        chg = ('No week-over-week change is shown. The previous snapshot was recorded on a different basis, and a '
               'percentage across that break would describe a change in how we build the number rather than a change '
               'in the %s market.' % low)
    elif kind == 'stale':
        chg = ('No movement is reported. Every equipment type in this snapshot is identical to the previous one to '
               'the cent, which means the benchmark was recorded again without being rebuilt rather than that eight '
               'independent national numbers all held perfectly still. The level below stands; the movement is '
               'simply not something we measured.')
    else:
        chg = 'This is the first recorded snapshot for %s, so there is nothing to compare it against yet.' % low

    b += ('<section><div class="wrap prose">'
      '<h2>The week %02d %s number</h2>'
      '<div class="mr-scroll"><table class="mr-t"><thead><tr><th>Measure</th><th>Week %02d, %d</th>'
      '<th>What it means</th></tr></thead><tbody>'
      '<tr><td><b>Carrier rate per mile</b></td><td class="mr-num">$%.2f</td>'
        '<td>What lands on the rate confirmation.</td></tr>'
      '<tr><td><b>Shipper all-in per mile</b></td><td class="mr-num" style="color:#15803d">$%.2f</td>'
        '<td>Before any accessorial actually incurred on the load.</td></tr>'
      '<tr><td><b>vs prior snapshot</b></td>%s<td>%s</td></tr>'
      '<tr><td><b>Snapshot recorded</b></td><td>%s</td><td>Never edited afterwards &mdash; this page keeps showing '
        'the week %02d number.</td></tr>'
      '</tbody></table></div>'
      '<p>%s</p>'
      '<div class="mr-note"><b>National benchmark, not a proprietary index.</b> This figure is not built from our own '
      'booked loads and we do not present it as though it were. Use it to sanity-check a quote, not to replace the '
      'lane in front of you. The evergreen <a href="%s">%s rate hub</a> carries the full specification table, the '
      'regional breakdown and the seasonal pattern behind it.</div>'
      '</div></section>'
      % (wk, low, wk, yr, rpm, shipper_rpm, _chg_cell(kind, label),
         ('Compared like for like.' if kind in ('up', 'down', 'flat')
          else ('Benchmark not rebuilt between snapshots &mdash; see below.' if kind == 'stale'
                else 'Not comparable &mdash; see below.')),
         _pretty(as_of), wk, chg, hub, name))

    # 2. the rotating angle applied to this equipment
    b += ('<section class="bg-soft"><div class="wrap prose"><h2>%s</h2>%s</div></section>'
      % (angle['eq_h'], ''.join(('%s' if p.lstrip().startswith(('<ul', '<table')) else '<p>%s</p>') % p
                                for p in angle['eq'](eq, rpm, name, low))))

    # 3. lane math
    lane_rows = ''.join(
      '<tr><td><b>%s &rarr; %s</b></td><td class="mr-num">%s mi</td>'
      '<td class="mr-num">%s</td><td class="mr-num" style="color:#15803d">%s</td></tr>'
      % (o, d, format(mi, ','), _fmt_money(mi * rpm), _fmt_money(mi * shipper_rpm))
      for o, d, mi in eq['lanes'])
    b += ('<section><div class="wrap prose"><h2>Week %02d on a real %s lane</h2>'
      '<p>This week&rsquo;s benchmark multiplied by real lane distance. A starting point for a conversation rather '
      'than a quote &mdash; direction, season and the receiving requirement all move the true number, and none of '
      'them are in a national average.</p>'
      '<div class="mr-scroll"><table class="mr-t"><thead><tr><th>Lane</th><th>Distance</th><th>Carrier gets</th>'
      '<th>Shipper pays</th></tr></thead><tbody>%s</tbody></table></div>'
      '<p style="color:#64748b;font-size:.9rem">Distances are practical truck miles and will differ slightly from a '
      'car routing.</p></div></section>' % (wk, low, lane_rows))

    # 4. break-even
    marg = rpm - _BREAKEVEN
    b += ('<section class="bg-soft"><div class="wrap prose">'
      '<h2>What week %02d leaves a %s truck</h2>'
      '<p>Against a working all-in operating cost of <b>$%.2f per mile</b> for a one-truck carrier, this '
      'week&rsquo;s %s benchmark of <b>$%.2f</b> leaves <b>%s$%.2f per loaded mile</b> &mdash; about <b>%s</b> on a '
      '700-mile run, before deadhead and before any unpaid time at a dock.</p>'
      '<p>That gap is not profit. It is what has to absorb the empty miles to the next pickup, a wait nobody paid '
      'for, a week with a bad reload, and the repair that has not happened yet. A rate that clears the floor by a few '
      'cents only works if nothing goes wrong. <a href="cost-per-mile-calculator.html">Work out your own cost per '
      'mile &rarr;</a></p></div></section>'
      % (wk, low, _BREAKEVEN, low, rpm, ('+' if marg >= 0 else '&minus;'), abs(marg), _fmt_money(abs(marg) * 700)))

    # 5. what drives this equipment -- pulled from the hub's own data, two of them
    drv = (eq.get('drivers') or [])[:3]
    if drv:
        b += ('<section><div class="wrap prose"><h2>What moves the %s number at all</h2>'
          '<p>Week to week, mostly noise. Over a season, these are the things that actually decide where this '
          'benchmark sits.</p>'
          '<div class="mr-scroll"><table class="mr-t"><tbody>%s</tbody></table></div>'
          '<p><a href="%s">The full %s rate hub &rarr;</a> carries the rest, plus the specification table, the '
          'regional breakdown and the accessorial impact.</p></div></section>'
          % (low, ''.join('<tr><td style="width:30%%"><b>%s</b></td><td>%s</td></tr>' % (t, d) for t, d in drv),
             hub, low))

    # 6. link back -- the whole point of layer 2
    b += ('<section class="bg-soft"><div class="wrap prose" style="max-width:820px">'
      '<h2>Keep reading</h2>'
      '<div class="mr-nav">'
      '<a href="%s"><b>%s rate hub &mdash; evergreen &rarr;</b></a>'
      '<a href="%s">Week %02d full market report &rarr;</a>'
      '<a href="freight-market-reports.html">All reports</a></div>'
      '<div class="mr-hubs">%s</div>'
      '<p style="margin-top:18px"><a href="/app/partner/" class="btn btn-primary">Post a %s load &rarr;</a></p>'
      '</div></section>'
      % (hub, name, combined_file, wk,
         ''.join('<a href="%s-freight-rates.html">%s rates</a>' % (_SLUG_OF[n], n) for n in _EQ_ORDER if n != name),
         low))

    faq = [
     ('What was the %s rate per mile in week %02d of %d?' % (low, wk, yr),
      'The national benchmark was $%.2f per mile to the carrier for the week of %s to %s, which works out to about '
      '$%.2f all-in for the shipper before accessorials.' % (rpm, _pretty(mon), _pretty(sun), shipper_rpm)),
     ('Is $%.2f a good %s rate?' % (rpm, low),
      'It depends entirely on your own cost per mile. Against a working all-in operating cost of $%.2f for a '
      'one-truck carrier it leaves %s$%.2f per loaded mile &mdash; before deadhead, which typically takes a further '
      'sixth off it.' % (_BREAKEVEN, ('+' if marg >= 0 else 'minus '), abs(marg))),
     ('Why is my %s quote different from this number?' % low,
      'A national benchmark blends lanes running in both directions, appointment and FCFS freight, and every region '
      'at once. Your lane is one direction, one receiving requirement and one market. Direction alone can move a '
      'real quote by a third.'),
     ('Do these figures include detention and other accessorials?',
      'No. Detention, layover, TONU and lumper fees all sit outside the per-mile number. On a short lane they can be '
      'worth more than the whole margin &mdash; see the <a href="detention-pay-policy.html">detention policy</a>.'),
     ('Will this page be updated with newer rates?',
      'No, and deliberately so. This is a dated report and it keeps showing the week %02d number. The evergreen '
      '<a href="%s">%s rate hub</a> always carries the current figure.' % (wk, hub, name)),
    ]
    b += ('<section><div class="wrap prose"><h2>Week %02d %s questions</h2>%s</div></section>'
      % (wk, low, ''.join('<div class="mr-faq"><h3>%s</h3><p>%s</p></div>' % (q, a) for q, a in faq)))

    art = ('<script type="application/ld+json">' + json.dumps({
      "@context": "https://schema.org", "@type": "Article",
      "headline": "%s Rates — Week %02d, %d" % (name, wk, yr),
      "datePublished": snap['as_of'], "dateModified": snap['as_of'],
      "author": {"@type": "Organization", "name": "LoadBoot"},
      "publisher": {"@type": "Organization", "name": "LoadBoot"}}) + '</script>')

    return dict(
      fname=fname,
      title='%s Rates Per Mile &mdash; Week %02d, %d Report | LoadBoot' % (name, wk, yr),
      desc='%s rates per mile for week %02d of %d: the national benchmark at $%.2f, what that works out to on real '
           'lanes, and what it leaves the truck.' % (name, wk, yr, rpm),
      body=b, schema=acc_faq_schema(faq) + art,
      related=[(hub, '%s Rate Hub' % name),
               (combined_file, 'Week %02d Market Report' % wk),
               ('freight-market-reports.html', 'All Market Reports'),
               ('market-rates.html', 'Current Market Rates'),
               ('cost-per-mile-calculator.html', 'Cost Per Mile Calculator'),
               ('free-load-board-for-brokers.html', 'Free Load Board for Brokers')],
      week=wk, year=yr, name=name, slug=slug, rpm=rpm)


def _archive(reports, dives, snapshots):
    """The evergreen hub the whole dated series hangs off. Built to the full page standard."""
    latest = reports[-1]
    b = MR_CSS
    b += ('<section class="mr-hero"><div class="wrap">'
      '<span class="mr-kicker">Weekly &middot; National benchmarks</span>'
      '<h1>Freight Market Reports &mdash; Weekly Truckload Rates Per Mile</h1>'
      '<p>A dated benchmark report for every week we record one, covering all eight truckload equipment types: dry '
      'van, reefer, flatbed, step deck, conestoga, power only, hotshot and box truck. What the carrier is paid, what '
      'the shipper pays, what it leaves the truck, and &mdash; when the two snapshots are actually comparable &mdash; '
      'what moved.</p></div></section>')

    b += ('<section><div class="wrap prose">'
      '<h2>Latest report</h2>'
      '<p>Week %02d, %d &mdash; snapshot recorded %s, covering all eight equipment types, with this week&rsquo;s '
      'equipment deep-dive on %s.</p>'
      '<p><a href="%s"><b>Read the week %02d market report &rarr;</b></a> &middot; '
      '<a href="%s">%s deep-dive &rarr;</a></p></div></section>'
      % (latest['week'], latest['year'], _pretty(datetime.date.fromisoformat(latest['as_of'])),
         latest['dd_name'].lower(), latest['fname'], latest['week'], latest['dd_file'], latest['dd_name']))

    cards = ''
    for r in reversed(reports):
        mon, sun = _week_dates(r['year'], r['week'])
        dv = dict(r['rows'] and [(x[0], x[1]['rpm']) for x in r['rows']]).get('Dry Van')
        cards += ('<div class="mr-card"><div class="wk">Week %02d &middot; %d</div>'
          '<h3><a href="%s">Freight Market Report &mdash; Week %02d</a></h3>'
          '<p>%s &ndash; %s. All eight equipment types%s.</p>'
          '<p class="dd"><a href="%s">%s deep-dive &rarr;</a></p></div>'
          % (r['week'], r['year'], r['fname'], r['week'], _pretty(mon), _pretty(sun),
             (', dry van at $%.2f/mi' % dv) if dv else '', r['dd_file'], r['dd_name']))
    b += ('<section class="bg-soft"><div class="wrap prose">'
      '<h2>Every report</h2>'
      '<p>Reports are never edited after publication. A week-30 report keeps showing the week-30 number, which is '
      'what makes the archive worth anything as a record. For the current figure, use the '
      '<a href="market-rates.html">market rates page</a> instead.</p>'
      '<div class="mr-idx">%s</div></div></section>' % cards)

    b += ('<section><div class="wrap prose"><h2>What a rate per mile actually hides</h2>'
      '<p>A single number described as &ldquo;the rate&rdquo; is doing at least four jobs, and most disagreements '
      'about freight pricing are really disagreements about which of the four is being discussed.</p>'
      '<div class="mr-scroll"><table class="mr-t"><thead><tr><th>What it hides</th><th>Why it moves the real '
      'number</th></tr></thead><tbody>'
      '<tr><td><b>Empty miles</b></td><td>Every rate quoted per mile is a <i>loaded</i>-mile rate. A 700-mile load '
      'with 140 miles of deadhead attached spreads the same money across 840 miles &mdash; roughly a sixth off the '
      'real revenue per mile, appearing nowhere on the rate confirmation.</td></tr>'
      '<tr><td><b>Lane direction</b></td><td>Freight flows are not symmetrical. More goods move into a consumption '
      'market than out of it, so the same lane run the other way can price a third differently.</td></tr>'
      '<tr><td><b>The receiving requirement</b></td><td>A hard appointment shrinks the pool of trucks that can '
      'legally make the window and takes control of the driver&rsquo;s clock away from him. FCFS freight books '
      'faster and cheaper for exactly that reason.</td></tr>'
      '<tr><td><b>Accessorials</b></td><td>Detention, layover, TONU and lumper fees all sit outside the per-mile '
      'number. On a short lane four hours at a dock can exceed the entire margin.</td></tr>'
      '</tbody></table></div></div></section>')

    b += ('<section class="bg-soft"><div class="wrap prose">'
      '<h2>What a national benchmark can and cannot tell you</h2>'
      '<p>It can tell you whether a quote is roughly in the right postcode. If someone offers you $1.40 a mile on '
      'reefer, the benchmark tells you that is not a market rate and you can stop the conversation there. That is a '
      'genuinely useful thing and it is most of what a benchmark is for.</p>'
      '<p>It cannot tell you what your specific lane costs. It is a blend of every direction, every region, every '
      'receiving requirement and every season, averaged into one figure. Your load is one direction, one market, one '
      'dock and one week. The gap between those two things is not an error in the benchmark &mdash; it is the '
      'benchmark doing exactly what an average does.</p>'
      '<p>The practical use, then, is as a floor and a ceiling rather than as a target. A quote far below the '
      'benchmark usually means somebody has not read the specification and will renegotiate at the dock. A quote far '
      'above it usually has a specific cause &mdash; appointment, dock speed, or a destination trucks avoid &mdash; '
      'and asking which one is frequently worth more than negotiating the number.</p></div></section>')

    b += ('<section><div class="wrap prose"><h2>How these reports are built</h2>'
      '<p>Each report is built from a benchmark snapshot recorded in the week it covers. The snapshot is written '
      'once and never edited, which is why a report from two months ago still shows the number recorded then rather '
      'than today&rsquo;s figure. That is the whole point of a dated archive; a record that quietly updates itself '
      'is not a record.</p>'
      '<p>These are <b>national benchmark</b> figures. They are not a proprietary rate index built from our own '
      'transaction history, and we label them that way on every page they appear on, because a rate is only useful '
      'when you know what stands behind it. Anyone presenting a rate without telling you what it is built from is '
      'asking you to trust the number rather than to understand it.</p>'
      '<h2>The rule about week-over-week change</h2>'
      '<p>A week-over-week percentage is only printed when both snapshots were built on the same basis. When the '
      'basis changed, the cell reads <b>n/c</b> and the report says why on the page.</p>'
      '<p>This is not a technicality. Our own recorded history contains exactly such a break: dry van was recorded at '
      '$2.10 under one method and $3.00 under the next. A naive comparison publishes &ldquo;dry van up 43% week over '
      'week&rdquo;, which is not a fact about freight at all &mdash; it is a fact about us changing how we count. A '
      'rate page that prints that once has spent credibility it cannot buy back, so when the comparison is not '
      'available these reports say so rather than guessing.</p></div></section>')

    b += ('<section class="bg-soft"><div class="wrap prose"><h2>Equipment covered in every report</h2>'
      '<p>Each equipment type also has an evergreen rate hub carrying its specification table, seasonality, regional '
      'variation, posting guidance and full FAQ.</p>'
      '<div class="mr-scroll"><table class="mr-t"><thead><tr><th>Equipment</th><th>What it is for</th>'
      '<th>Rate hub</th></tr></thead><tbody>'
      '<tr><td><b>Dry Van</b></td><td>Roughly two-thirds of truckload. The most rate-sensitive equipment on any '
      'board.</td><td><a href="dry-van-freight-rates.html">Dry van rates &rarr;</a></td></tr>'
      '<tr><td><b>Reefer</b></td><td>Temperature-controlled. Swings hardest with produce season.</td>'
      '<td><a href="reefer-freight-rates.html">Reefer rates &rarr;</a></td></tr>'
      '<tr><td><b>Flatbed</b></td><td>Tracks construction and industrial output, not retail.</td>'
      '<td><a href="flatbed-freight-rates.html">Flatbed rates &rarr;</a></td></tr>'
      '<tr><td><b>Step Deck</b></td><td>Freight too tall to be legal on a flatbed.</td>'
      '<td><a href="step-deck-freight-rates.html">Step deck rates &rarr;</a></td></tr>'
      '<tr><td><b>Conestoga</b></td><td>Flatbed access with a rolling tarp system.</td>'
      '<td><a href="conestoga-freight-rates.html">Conestoga rates &rarr;</a></td></tr>'
      '<tr><td><b>Power Only</b></td><td>Tractor to a trailer somebody else owns.</td>'
      '<td><a href="power-only-freight-rates.html">Power only rates &rarr;</a></td></tr>'
      '<tr><td><b>Hotshot</b></td><td>Class 3&ndash;5 pickup and gooseneck, expedited and partial freight.</td>'
      '<td><a href="hotshot-freight-rates.html">Hotshot rates &rarr;</a></td></tr>'
      '<tr><td><b>Box Truck</b></td><td>Straight truck freight, often final-mile and non-dock.</td>'
      '<td><a href="box-truck-freight-rates.html">Box truck rates &rarr;</a></td></tr>'
      '</tbody></table></div></div></section>')

    b += ('<section><div class="wrap prose"><h2>The freight calendar these reports sit inside</h2>'
      '<p>The most common mistake made with a weekly rate print is comparing it to last week instead of to the same '
      'week last year. Truckload freight has a shape that repeats with more reliability than almost anything else in '
      'the business.</p>'
      '<div class="mr-scroll"><table class="mr-t"><thead><tr><th style="width:20%">Period</th><th>What normally '
      'happens</th></tr></thead><tbody>'
      '<tr><td><b>January&ndash;February</b></td><td>The annual floor. Holiday volume has cleared, northern '
      'construction is stopped, and there are more trucks than freight almost everywhere.</td></tr>'
      '<tr><td><b>March&ndash;May</b></td><td>Recovery. Retail resets, building season opens across the Midwest and '
      'South, and produce begins pulling refrigerated capacity out of general freight.</td></tr>'
      '<tr><td><b>June&ndash;July</b></td><td>Peak produce and peak construction together. Reefer runs well above its '
      'annual average out of the growing regions; van firms up as a side effect.</td></tr>'
      '<tr><td><b>August</b></td><td>Transition. Harvest tapering, reefers returning to general freight, retail not '
      'yet building for Q4. One of the flatter stretches of the year.</td></tr>'
      '<tr><td><b>September&ndash;November</b></td><td>The strongest stretch for van and reefer as retail builds '
      'toward Q4 and capacity tightens. Flatbed tapers in the North, stays active in the South.</td></tr>'
      '<tr><td><b>December</b></td><td>Firm through roughly the second week, then a sharp drop once holiday freight '
      'is positioned, sliding into the January floor.</td></tr>'
      '</tbody></table></div></div></section>')

    b += ('<section class="bg-soft"><div class="wrap prose">'
      '<h2>Rate against cost &mdash; the comparison that matters</h2>'
      '<p>Every report holds the week&rsquo;s benchmarks against a working all-in operating cost of <b>$%.2f per '
      'mile</b> for a one-truck carrier: fuel, payments, insurance, maintenance, tyres, permits and the '
      'driver&rsquo;s own pay. Newer equipment on a good fuel programme runs below it; an older truck with a real '
      'maintenance history runs well above.</p>'
      '<p>That comparison is worth as much to a broker as to a carrier. A broker who knows the floor stops posting '
      'numbers that were never going to move and covers freight faster. A shipper who knows it stops being surprised '
      'when the cheapest quote falls through two days before pickup. And the gap itself is not profit &mdash; it is '
      'what absorbs deadhead, an unpaid wait, a bad reload and a repair that has not happened yet.</p>'
      '<p><a href="cost-per-mile-calculator.html">Calculate your own cost per mile &rarr;</a> Every report reads '
      'differently once you have your real number rather than an industry average.</p></div></section>' % _BREAKEVEN)

    b += ('<section><div class="wrap prose"><h2>The terms that sit outside every rate</h2>'
      '<p>No benchmark in these reports contains a cent of accessorial. LoadBoot publishes fixed terms rather than '
      'renegotiating them load by load, so both sides know before the truck moves and detention is timed against GPS '
      'rather than against whose account of the afternoon is better.</p>'
      '<div class="mr-scroll"><table class="mr-t"><thead><tr><th>Accessorial</th><th>Standard</th><th>Where it '
      'usually shows up</th></tr></thead><tbody>'
      '<tr><td><b><a href="detention-pay-policy.html">Detention</a></b></td><td>$60/hr after 2 free hours</td>'
      '<td>Grocery, retail DCs, anywhere with a live unload.</td></tr>'
      '<tr><td><b><a href="layover-policy.html">Layover</a></b></td><td>$250/day</td>'
      '<td>A missed appointment window that pushes delivery to the next day.</td></tr>'
      '<tr><td><b><a href="tonu-policy.html">TONU</a></b></td><td>$250</td>'
      '<td>Truck ordered, then the freight is not there or does not fit.</td></tr>'
      '<tr><td><b><a href="lumper-policy.html">Lumper</a></b></td><td>Reimbursed with receipt</td>'
      '<td>Food and grocery distribution, almost every time.</td></tr>'
      '</tbody></table></div></div></section>')

    b += ('<section class="bg-soft"><div class="wrap prose"><h2>Who these reports are for</h2>'
      '<div class="mr-two">'
      '<div class="mr-n"><b>Brokers</b><p>Use the spread across equipment rather than any single row &mdash; it is '
      'the cleanest read on what specialised capacity is worth over general freight right now. Then cover against '
      'the posting, not the rate: a load re-posted three times has already burned the margin the re-posting was '
      'protecting.</p><p><a href="free-load-board-for-brokers.html">Free posting for brokers &rarr;</a></p></div>'
      '<div class="mr-n s"><b>Shippers</b><p>Use it as a sanity check on a quote you have been given. If your number '
      'sits well above the benchmark, ask which of the three usual causes is driving it &mdash; appointment, dock '
      'speed, or destination market. Two of the three you can change.</p>'
      '<p><a href="shipper-solutions.html">Shipper solutions &rarr;</a></p></div>'
      '<div class="mr-n c"><b>Carriers and owner-operators</b><p>Hold every figure against your own cost per mile '
      'rather than against last week&rsquo;s benchmark, and remember every number here is a loaded-mile number. '
      'Deadhead is the part that decides whether the week worked.</p>'
      '<p><a href="cost-per-mile-calculator.html">Cost per mile calculator &rarr;</a></p></div>'
      '</div></div></section>')

    b += ('<section><div class="wrap prose"><h2>Publishing cadence</h2>'
      '<p>A combined report covering all eight equipment types is published for each week a benchmark snapshot is '
      'recorded, and one equipment type per week gets its own dated deep-dive on a rotating basis, so each equipment '
      'comes round roughly every two months.</p>'
      '<p>Where a week has no recorded snapshot there is no report for that week, and no back-filled one either. '
      'Inventing a figure for a week we did not measure would defeat the only thing a dated archive is good for. '
      'There are currently <b>%d</b> reports covering %d equipment deep-dives.</p>'
      '<div class="mr-hubs">%s</div></div></section>'
      % (len(reports), len(dives),
         ''.join('<a href="%s-freight-rates.html">%s rates</a>' % (_SLUG_OF[n], n) for n in _EQ_ORDER)))

    faq = [
     ('How often are freight market reports published?',
      'One combined report covering all eight equipment types for each week a benchmark snapshot is recorded, plus '
      'one rotating equipment deep-dive per week. Weeks with no recorded snapshot get no report rather than an '
      'invented one.'),
     ('Are these LoadBoot&rsquo;s own transaction rates?',
      'No. They are national benchmark figures, not a proprietary index built from our own booked loads, and every '
      'page that carries them says so. A rate is only useful when you know what stands behind it.'),
     ('Why do some reports show &ldquo;n/c&rdquo; instead of a week-over-week percentage?',
      'Because the previous snapshot for that equipment was built on a different basis. A percentage across that '
      'break measures a change in our own method rather than a change in the freight market, so it is not printed.'),
     ('Do old reports get updated with current rates?',
      'Never. A dated report keeps showing the number recorded in the week it covers, which is the only thing that '
      'makes an archive worth having. Use the <a href="market-rates.html">market rates page</a> for the current '
      'figure.'),
     ('Which equipment types are covered?',
      'All eight: dry van, reefer, flatbed, step deck, conestoga, power only, hotshot and box truck. Each also has '
      'an evergreen rate hub with full specifications, seasonality and regional detail.'),
     ('Do the rates include fuel?',
      'Yes &mdash; these are all-in per-mile figures, so fuel sits inside them at roughly a fifth to a quarter at '
      'current diesel levels. In contract freight fuel is normally quoted as its own line instead. '
      '<a href="fuel-surcharge-trucking.html">How fuel surcharge works &rarr;</a>'),
     ('Do the rates include detention and other accessorials?',
      'No. Detention, layover, TONU and lumper fees all sit outside the per-mile number. On a short lane they can be '
      'worth more than the entire margin on the load.'),
     ('Why is a benchmark different from my actual quote?',
      'A national benchmark blends both lane directions, every region, appointment and FCFS freight and every '
      'season into one figure. Your load is one direction, one market and one dock. Direction alone can move a real '
      'quote by a third, and that is the benchmark working correctly, not failing.'),
    ]
    b += ('<section class="bg-soft"><div class="wrap prose"><h2>Questions about these reports</h2>%s</div></section>'
      % ''.join('<div class="mr-faq"><h3>%s</h3><p>%s</p></div>' % (q, a) for q, a in faq))

    b += ('<section><div class="wrap prose center" style="text-align:center;max-width:760px">'
      '<h2>Moving freight, not just reading about it?</h2>'
      '<p>Posting is free for brokers and shippers &mdash; no subscription and no per-post fee. Every carrier who can '
      'accept your load has had authority, insurance and safety checked first, every load carries live GPS, and the '
      'accessorial terms above are written down before the truck moves rather than argued about after.</p>'
      '<div class="ctarow" style="margin-top:18px;justify-content:center">'
      '<a href="/app/partner/" class="btn btn-primary">Post a load &rarr;</a>'
      '<a href="market-rates.html" class="btn btn-secondary">Current market rates &rarr;</a></div>'
      '</div></section>')

    return dict(fname='freight-market-reports.html',
      title='Freight Market Reports &mdash; Weekly Truckload Rates Per Mile | LoadBoot',
      desc='Weekly truckload freight rate benchmarks for all eight equipment types — dry van to box truck. '
           'Dated reports, never edited after publication.',
      body=b, faq=faq,
      related=[('market-rates.html', 'Current Market Rates'),
               ('dry-van-freight-rates.html', 'Dry Van Rates'),
               ('reefer-freight-rates.html', 'Reefer Rates'),
               ('flatbed-freight-rates.html', 'Flatbed Rates'),
               ('load-board.html', 'Live Load Board'),
               ('cost-per-mile-calculator.html', 'Cost Per Mile Calculator')])


def build_market_reports(snapshots, eq_rates, acc_faq_schema):
    """Public entry point. Returns (pages, latest_by_slug).

    pages          -- list of dicts ready to hand to page(): fname/title/desc/body/schema/related
    latest_by_slug -- {equipment slug: (report fname, week, year)} so each evergreen hub can
                      link forward to its most recent dated post. That forward link plus the
                      deep-dive's link back is the whole two-layer engine.
    """
    eqs_by_slug = {e['slug']: e for e in eq_rates}
    eqs_by_name = {e['name']: e for e in eq_rates}
    snaps = sorted(snapshots, key=lambda s: s['as_of'])

    pages, reports, dives = [], [], []
    for i, snap in enumerate(snaps):
        prev = snaps[i - 1] if i > 0 else None
        rep = _combined_report(snap, prev, eqs_by_name, acc_faq_schema, snaps, i)
        reports.append(rep)
        eq = eqs_by_slug.get(rep['dd_slug'])
        if eq and eq['name'] in snap['rates']:
            dives.append(_deep_dive(snap, prev, eq, acc_faq_schema, rep['fname']))

    arc = _archive(reports, dives, snaps)
    arc['schema'] = acc_faq_schema(arc.pop('faq'))

    pages.extend(reports)
    pages.extend(dives)
    pages.append(arc)

    latest_by_slug = {}
    for d in dives:
        cur = latest_by_slug.get(d['slug'])
        if not cur or (d['year'], d['week']) > (cur[2], cur[1]):
            latest_by_slug[d['slug']] = (d['fname'], d['week'], d['year'])
    return pages, latest_by_slug
