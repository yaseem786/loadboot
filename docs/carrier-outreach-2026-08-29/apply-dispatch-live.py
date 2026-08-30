#!/usr/bin/env python3
# apply-dispatch-live.py — wire app/shared/dispatch-live.js into BOTH consumers, idempotently.
#
# Why a script and not hand edits: app/agent/dispatcher-workspace.js and
# app/command-center/views/dispatchers.js are both large files that parallel sessions rework the
# same day (see docs: the 29 Aug app.js collisions). This re-applies every edit to ANY base:
# each edit skips if its own unique marker is already present, and HARD-FAILS if its anchor is
# missing rather than silently doing nothing.
#
# Design rules kept from the module's own contract:
#   - every send is a fire-and-forget HINT to refetch, never data;
#   - the existing polling / reload paths stay exactly as they were (the CC had none, so a 90 s
#     visible-tab fallback was added there — it is the fallback, not the mechanism);
#   - every call is wrapped so a dead socket can never break a click.
#
# Usage:  python apply-dispatch-live.py <repo-root>
import sys, os, io

ROOT = sys.argv[1] if len(sys.argv) > 1 else '.'
WS = os.path.join(ROOT, 'app', 'agent', 'dispatcher-workspace.js')
CC = os.path.join(ROOT, 'app', 'command-center', 'views', 'dispatchers.js')

report = []


def patch(path, edits):
    with io.open(path, encoding='utf-8') as f:
        src = f.read()
    orig = src
    for name, marker, anchor, new in edits:
        if marker in src:
            report.append('  = %-26s already present' % name)
            continue
        n = src.count(anchor)
        if n != 1:
            raise SystemExit('ANCHOR %s for edit "%s" found %d times in %s — refusing to guess.'
                             % (repr(anchor[:70]), name, n, os.path.basename(path)))
        src = src.replace(anchor, new, 1)
        if marker not in src:
            raise SystemExit('edit "%s" reported applied but its marker is absent — aborting.' % name)
        report.append('  + %-26s applied' % name)
    if src != orig:
        with io.open(path, 'w', encoding='utf-8', newline='') as f:
            f.write(src)
        return True
    return False


# ───────────────────────────── dispatcher workspace (the sending side) ─────────────────────────
WS_EDITS = [
    ('import', "from '../shared/dispatch-live.js'",
     "import { icon as sharedIcon } from '../shared/ui/icons.js';",
     "import { icon as sharedIcon } from '../shared/ui/icons.js';\n"
     "import { dispatchLiveJoin } from '../shared/dispatch-live.js';"),

    ('join+cleanup', 'const dwLive = dispatchLiveJoin(',
     "  const mo = new MutationObserver(() => { if (!document.body.contains(root)) { clearInterval(clockTimer); stopThreadPoll(); mo.disconnect(); } });\n"
     "  mo.observe(document.body, { childList: true, subtree: true });",
     "  const mo = new MutationObserver(() => { if (!document.body.contains(root)) { clearInterval(clockTimer); stopThreadPoll(); try { dwLive.leave(); } catch (_) {} mo.disconnect(); } });\n"
     "  mo.observe(document.body, { childList: true, subtree: true });\n"
     "  // ---- realtime wire to the Command Center (shared/dispatch-live.js).\n"
     "  // Fire-and-forget: every send is a \"refetch now\" HINT, never data, and every method no-ops\n"
     "  // when the websocket is down. The polling and reload paths below stay the source of truth.\n"
     "  const dwLiveOpts = { role: 'dispatcher', name: '', tab: tab,\n"
     "    onEvent: (e) => { if (['approved', 'rejected', 'message', 'status_change'].includes(e.type)) load(); } };\n"
     "  const dwLive = dispatchLiveJoin(dwLiveOpts);"),

    ('presence name', 'dwLiveOpts.name =',
     "    try { feed = await dispatcherWorkspaceFeed(); } catch (e) { feed = { error: e.message || 'Could not load your workspace.' }; }",
     "    try { feed = await dispatcherWorkspaceFeed(); } catch (e) { feed = { error: e.message || 'Could not load your workspace.' }; }\n"
     "    try { const p0 = (feed && feed.profile) || {}; dwLiveOpts.name = p0.name || p0.full_name || ''; } catch (_) {}"),

    ('tab presence', 'dwLive.setTab(id)',
     "try { sessionStorage.setItem('dw_tab', id); } catch (_) {}",
     "try { sessionStorage.setItem('dw_tab', id); } catch (_) {} try { dwLive.setTab(id); } catch (_) {}"),

    ('send rc_uploaded', "dwLive.send('rc_uploaded'",
     "const up = await uploadDocument(f0, 'rate_confirmation'); return dispatcherBookingUpdate(b.id, { rc_doc_path: up.path, rc_doc_name: up.fileName, rc_number: rcNo.value || null }); }",
     "const up = await uploadDocument(f0, 'rate_confirmation'); const rr = await dispatcherBookingUpdate(b.id, { rc_doc_path: up.path, rc_doc_name: up.fileName, rc_number: rcNo.value || null }); if (!(rr && rr.error)) { try { dwLive.send('rc_uploaded', { booking: b.id, lane: b.origin + ' → ' + b.destination }); } catch (_) {} } return rr; }"),

    ('send availability', "dwLive.send('availability_posted'",
     "if (r && r.error) throw new Error(r.error); toast('Availability saved'); await load();",
     "if (r && r.error) throw new Error(r.error); try { dwLive.send('availability_posted', { truck: t.id }); } catch (_) {} toast('Availability saved'); await load();"),

    ('send check_call', "dwLive.send('check_call'",
     "act(() => dispatcherBookingEvent(b.id, 'check_call', noteIn.value || 'Check call', locIn.value || null, fromET(etaIn.value)), 'Check call logged')",
     "act(async () => { const rr = await dispatcherBookingEvent(b.id, 'check_call', noteIn.value || 'Check call', locIn.value || null, fromET(etaIn.value)); if (!(rr && rr.error)) { try { dwLive.send('check_call', { booking: b.id }); } catch (_) {} } return rr; }, 'Check call logged')"),

    ('send message', "dwLive.send('message'",
     "const r = await dispatcherThreadSend(cur.id, inp.value); if (r.error) throw new Error(r.error); inp.value = '';",
     "const r = await dispatcherThreadSend(cur.id, inp.value); if (r.error) throw new Error(r.error); try { dwLive.send('message', { assignment: cur.id }); } catch (_) {} inp.value = '';"),

    ('send booking_created', "dwLive.send('booking_created'",
     "if (r && r.error) throw new Error(r.error); m.close(); toast(r.status === 'rc_received' ?",
     "if (r && r.error) throw new Error(r.error); try { dwLive.send('booking_created', { booking: r.id }); } catch (_) {} m.close(); toast(r.status === 'rc_received' ?"),

    ('handle setTab', 'live: dwLive',
     "  return { reload: load, setTab: (t) => { tab = t; render(); } };",
     "  return { reload: load, setTab: (t) => { tab = t; try { dwLive.setTab(t); } catch (_) {} render(); }, live: dwLive };"),
]

# ───────────────────────────── command center (the listening side) ─────────────────────────────
CC_HEAD_ANCHOR = (
    "  const body = el('div');\n"
    "  const queueBox = el('div');\n"
    "  mount(host, el('div', { class: 'cc-view' }, [\n"
    "    sectionHead('Dispatchers', 'The verified dispatch workforce — hiring pipeline, carrier assignment + SOP, rate-confirmation approvals, per-load commission and payout. One dedicated dispatcher per carrier; nothing moves until LoadBoot approves the RC.'),\n"
    "    queueBox,\n"
    "    body,\n"
    "  ]));\n"
    "  load();"
)

CC_HEAD_NEW = (
    "  const body = el('div');\n"
    "  const queueBox = el('div');\n"
    "  const presenceBox = el('div', { class: 'cc-sub', style: 'margin:2px 0 8px;min-height:18px' });\n"
    "  mount(host, el('div', { class: 'cc-view' }, [\n"
    "    sectionHead('Dispatchers', 'The verified dispatch workforce — hiring pipeline, carrier assignment + SOP, rate-confirmation approvals, per-load commission and payout. One dedicated dispatcher per carrier; nothing moves until LoadBoot approves the RC.'),\n"
    "    presenceBox,\n"
    "    queueBox,\n"
    "    body,\n"
    "  ]));\n"
    "  load();\n"
    "\n"
    "  // ---------------------------------------------------------------- realtime (shared/dispatch-live.js)\n"
    "  // Broadcast + presence on `dispatch:live` (app_private is not in the realtime publication, so\n"
    "  // postgres_changes is not available). An event is only a hint: the queue is ALWAYS repainted\n"
    "  // from ccDispatcherQueue(), never from the payload, and the 90 s visible-tab poll below is the\n"
    "  // fallback for a dead socket — do not remove it when extending this view.\n"
    "  function paintPresence(list) {\n"
    "    const on = (list || []).filter((p) => p.role === 'dispatcher');\n"
    "    if (!on.length) { mount(presenceBox, ''); return; }\n"
    "    mount(presenceBox, el('span', null, '🟢 ' + on.length + ' dispatcher' + (on.length > 1 ? 's' : '') + ' online — '\n"
    "      + on.map((p) => (p.name || 'dispatcher') + (p.tab ? ' (' + p.tab + ')' : '')).join(' · ')));\n"
    "  }\n"
    "  const ccLive = dispatchLiveJoin({ role: 'cc', name: 'Command Center',\n"
    "    onEvent: () => { paintQueue(); },\n"
    "    onPresence: (list) => paintPresence(list) });\n"
    "  const ccPoll = setInterval(() => { if (document.visibilityState === 'visible') paintQueue(); }, 90000);\n"
    "  const ccMo = new MutationObserver(() => { if (!document.body.contains(presenceBox)) { clearInterval(ccPoll); try { ccLive.leave(); } catch (_) {} ccMo.disconnect(); } });\n"
    "  ccMo.observe(document.body, { childList: true, subtree: true });"
)

CC_EDITS = [
    ('import', "from '../../shared/dispatch-live.js'",
     "import { signedDocumentUrl } from '../../shared/storage.js';",
     "import { signedDocumentUrl } from '../../shared/storage.js';\n"
     "import { dispatchLiveJoin } from '../../shared/dispatch-live.js';"),

    ('join+presence+poll', 'const ccLive = dispatchLiveJoin(', CC_HEAD_ANCHOR, CC_HEAD_NEW),

    ('send approved', "ccLive.send('approved'",
     "    toast('✓ approved' + (r.trip ? ' · trip created' : '')); return true;",
     "    try { ccLive.send('approved', { booking: b.id }); } catch (_) {}\n"
     "    toast('✓ approved' + (r.trip ? ' · trip created' : '')); return true;"),

    ('send rejected', "ccLive.send('rejected'",
     "toast('✓ rejected'); paint(); paintQueue(); };",
     "try { ccLive.send('rejected', { booking: b.id }); } catch (_) {} toast('✓ rejected'); paint(); paintQueue(); };"),
]

print('dispatcher-workspace.js')
a = patch(WS, WS_EDITS)
print('\n'.join(report)); report = []
print('command-center/views/dispatchers.js')
b = patch(CC, CC_EDITS)
print('\n'.join(report))
print('\nchanged: workspace=%s cc=%s' % (a, b))
