#!/usr/bin/env python3
# apply-dispatcher-deeplinks.py — every button and every link in the dispatcher workspace lands on
# the EXACT card, not just the tab. Same idea as the carrier portal's #tab/target (DEEP-LINKS.md),
# implemented entirely inside app/agent/dispatcher-workspace.js — app/carrier/app.js is NOT touched
# (it is the 760 KB collision-prone file, and the agent shell already falls back to the dashboard
# for any hash it does not recognise, so the workspace can own its own sub-route).
#
# Idempotent: every edit skips if its own unique marker is present, and HARD-FAILS if its anchor is
# missing or ambiguous rather than silently doing nothing.
#
# Usage:  python apply-dispatcher-deeplinks.py <repo-root>
import sys, os, io

ROOT = sys.argv[1] if len(sys.argv) > 1 else '.'
WS = os.path.join(ROOT, 'app', 'agent', 'dispatcher-workspace.js')

BLOCK = """  // ---- DEEP TARGETS: every button and every external link lands on the exact card, not the tab.
  // Vocabulary (agent portal): #dashboard/<tab>[/<target>] — the bare #<tab>[/<target>] also works,
  // because the agent shell falls back to the dashboard for any hash it does not know, and it has no
  // hashchange listener of its own, so this module owns its sub-route without touching app.js.
  //   #bookings/<id> · #bookings/new · #trucks/<id> · #trucks/<id>/availability (or #availability/<id>)
  //   #messages/<assignmentId> · #board/<assignmentId> · #brokers/new · #today · #money · #packet · #kpis
  // An unknown tab, or an id that is not in the feed, is IGNORED: the tab still opens and nothing
  // breaks — old links keep working forever.
  const DW_TABS = ['today', 'board', 'trucks', 'bookings', 'brokers', 'money', 'messages', 'packet', 'kpis'];
  const DW_ALIAS = { queue: 'today', home: 'today', loads: 'board', search: 'board',
    fleet: 'trucks', truck: 'trucks', availability: 'trucks', booking: 'bookings', rc: 'bookings',
    thread: 'messages', chat: 'messages', message: 'messages', commission: 'money', pay: 'money',
    docs: 'packet', documents: 'packet', packet: 'packet', broker: 'brokers', kpi: 'kpis' };
  let openThreadId = null, openTruckId = null, openBoardId = null, openAction = null;
  function dwGo(tabId, target) {
    const key = String(tabId == null ? '' : tabId).toLowerCase();
    const t9 = DW_ALIAS[key] || key;
    if (DW_TABS.indexOf(t9) < 0) return false;
    const id = String(target == null ? '' : target).trim();
    openId = null; openThreadId = null; openTruckId = null; openBoardId = null; openAction = null;
    if (t9 === 'bookings') { if (/^(new|log|add)$/i.test(id)) openAction = 'new-booking'; else if (id) openBooking(id); }
    else if (t9 === 'messages') { if (id) openThreadId = id; }
    else if (t9 === 'board') { if (id) openBoardId = id; }
    else if (t9 === 'brokers') { if (/^(new|add)$/i.test(id)) openAction = 'new-broker'; }
    else if (t9 === 'trucks') {
      const p9 = id.split('/');
      if (p9[0] && !/^availability$/i.test(p9[0])) openTruckId = p9[0];
      else if (p9[1]) openTruckId = p9[1];
      if (key === 'availability' || /(^|\\/)availability$/i.test(id)) openAction = 'availability';
    }
    tab = t9;
    try { sessionStorage.setItem('dw_tab', tab); } catch (_) {}
    try { dwLive.setTab(tab); } catch (_) {}
    render();
    return true;
  }
  // the card a deep link asked for gets the same 3.5 s LoadBoot-blue outline the carrier portal uses
  function dwFlash(node) {
    if (!node) return;
    try {
      node.scrollIntoView({ behavior: 'smooth', block: 'start' });
      node.style.outline = '2px solid #0883F7'; node.style.outlineOffset = '3px';
      setTimeout(() => { node.style.outline = ''; node.style.outlineOffset = ''; }, 3500);
    } catch (_) {}
  }
  function dwReadHash() {
    let raw; try { raw = String(location.hash || '').replace(/^#/, '').split('?')[0]; } catch (_) { return; }
    if (!raw) return;
    let parts; try { parts = raw.split('/').filter(Boolean).map(decodeURIComponent); } catch (_) { parts = raw.split('/').filter(Boolean); }
    for (let i = 0; i < parts.length; i++) {
      const key = parts[i].toLowerCase();
      if (DW_TABS.indexOf(DW_ALIAS[key] || key) < 0) continue;          // agent-shell tabs pass through untouched
      if (dwGo(key, parts.slice(i + 1).join('/'))) {
        // leave the shell on its own hash so Back still works and targets never re-fire on re-render
        try { history.replaceState(null, '', location.pathname + location.search + '#dashboard'); } catch (_) {}
      }
      return;
    }
  }
  const dwHash = () => dwReadHash();
  window.addEventListener('hashchange', dwHash);
"""

EDITS = [
    # ── the router + resolver, right after the realtime block ─────────────────────────────────
    ('deep-target block', 'function dwGo(',
     "  const dwLive = dispatchLiveJoin(dwLiveOpts);",
     "  const dwLive = dispatchLiveJoin(dwLiveOpts);\n" + BLOCK.rstrip('\n')),

    ('teardown', "removeEventListener('hashchange', dwHash)",
     "stopThreadPoll(); try { dwLive.leave(); } catch (_) {} mo.disconnect();",
     "stopThreadPoll(); try { dwLive.leave(); } catch (_) {} try { window.removeEventListener('hashchange', dwHash); } catch (_) {} mo.disconnect();"),

    # ── Today's work queue: each row opens its own subject ─────────────────────────────────────
    ('queue click', 'dwGo(x.go, x.id',
     "    function go(x) { if (!x.go) return; tab = x.go; if (x.id) openBooking(x.id); render(); }",
     "    function go(x) { if (!x.go) return; dwGo(x.go, x.id || ''); }"),

    ('q: unconfirmed → thread', "so they tap it today.', go: 'messages', id: a.id",
     "so they tap it today.', go: 'messages' });",
     "so they tap it today.', go: 'messages', id: a.id });"),

    ('q: unread → thread', "a.last_message.body || '', go: 'messages', id: a.id",
     "s: a.last_message.body || '', go: 'messages' });",
     "s: a.last_message.body || '', go: 'messages', id: a.id });"),

    ('q: find a load → board', "go: 'board', id: t._a.id",
     "whenDay(av.must_be_home_by) : ''), go: 'board' });",
     "whenDay(av.must_be_home_by) : ''), go: 'board', id: t._a.id });"),

    ('q: no availability → form', "set it before you call anyone.', go: 'trucks', id: t.id + '/availability'",
     "set it before you call anyone.', go: 'trucks' });",
     "set it before you call anyone.', go: 'trucks', id: t.id + '/availability' });"),

    ('q: daily line → form', "put the answer in Trucks.', go: 'trucks', id: t.id + '/availability'",
     "put the answer in Trucks.', go: 'trucks' });",
     "put the answer in Trucks.', go: 'trucks', id: t.id + '/availability' });"),

    ('q: home-time → truck', "must_be_home_by) + '.', go: 'trucks', id: t.id",
     "by ' + whenDay(av.must_be_home_by) + '.', go: 'trucks' });",
     "by ' + whenDay(av.must_be_home_by) + '.', go: 'trucks', id: t.id });"),

    ('q: HOS → truck', "av.hos_note + ')' : ''), go: 'trucks', id: t.id",
     "av.hos_note + ')' : ''), go: 'trucks' });",
     "av.hos_note + ')' : ''), go: 'trucks', id: t.id });"),

    ('q: truck off → truck', "when it is back.', go: 'trucks', id: t.id",
     "Check with the owner when it is back.', go: 'trucks' });",
     "Check with the owner when it is back.', go: 'trucks', id: t.id });"),

    # ── the views consume the target ───────────────────────────────────────────────────────────
    ('bookings: new-booking', "openAction === 'new-booking'",
     "    if (openId) { const b = bs.find((x) => x.id === openId); if (b) setTimeout(() => showBooking(b), 0); openId = null; }",
     "    if (openId) { const b = bs.find((x) => x.id === openId); if (b) setTimeout(() => showBooking(b), 0); openId = null; }\n"
     "    if (openAction === 'new-booking') { openAction = null; setTimeout(() => openLogForm(null), 0); }"),

    ('messages: open thread', 'openThreadId && as.find(',
     "let cur = as.find((a) => Number(a.unread || 0) > 0) || as[0]; let lastId = null;",
     "let cur = (openThreadId && as.find((a) => a.id === openThreadId)) || as.find((a) => Number(a.unread || 0) > 0) || as[0]; openThreadId = null; let lastId = null;"),

    ('board: open carrier', 'openBoardId && as.find(',
     "    let cur = as[0];",
     "    let cur = (openBoardId && as.find((a) => a.id === openBoardId)) || as[0]; openBoardId = null;"),

    ('brokers: new-broker', "openAction === 'new-broker'",
     "    paintRows();\n    return h('div', { class: 'dw-card' }, [h('h3', null, ['Broker book (' + rows.length + ')',",
     "    paintRows();\n"
     "    if (openAction === 'new-broker') { openAction = null; setTimeout(() => brokerForm(null), 0); }\n"
     "    return h('div', { class: 'dw-card' }, [h('h3', null, ['Broker book (' + rows.length + ')',"),

    ('truck card anchor', "'data-truck': t.id",
     "    const card = h('div', { class: 'dw-card' });",
     "    const card = h('div', { class: 'dw-card', 'data-truck': t.id });"),

    ('truck: flash + availability', 'openTruckId === t.id',
     "    renderAvail(false);\n    const min = minFor(t);",
     "    renderAvail(false);\n"
     "    if (openTruckId && openTruckId === t.id) {                    // deep link / queue row asked for THIS truck\n"
     "      const wantAvail = openAction === 'availability'; openTruckId = null; if (wantAvail) openAction = null;\n"
     "      setTimeout(() => { if (wantAvail) renderAvail(true); dwFlash(card); }, 60);\n"
     "    }\n"
     "    const min = minFor(t);"),

    # ── read the hash once the feed is in, and expose the resolver on the handle ───────────────
    ('mount: read hash', 'open: dwGo',
     "  await load();\n  return { reload: load, setTab: (t) => { tab = t; try { dwLive.setTab(t); } catch (_) {} render(); }, live: dwLive };",
     "  await load();\n"
     "  dwReadHash();                                    // an e-mail / notification link lands on the exact card\n"
     "  return { reload: load, setTab: (t) => { tab = t; try { dwLive.setTab(t); } catch (_) {} render(); }, open: dwGo, live: dwLive };"),
]


def main():
    with io.open(WS, encoding='utf-8') as f:
        src = f.read()
    orig = src
    for name, marker, anchor, new in EDITS:
        if marker in src:
            print('  = %-28s already present' % name)
            continue
        n = src.count(anchor)
        if n != 1:
            raise SystemExit('ANCHOR for "%s" found %d times — refusing to guess.\n  %r' % (name, n, anchor[:90]))
        src = src.replace(anchor, new, 1)
        if marker not in src:
            raise SystemExit('edit "%s" applied but its marker is absent — aborting.' % name)
        print('  + %-28s applied' % name)
    if src != orig:
        with io.open(WS, 'w', encoding='utf-8', newline='') as f:
            f.write(src)
        print('written:', WS)
    else:
        print('no change')


main()
