# bl_dial_0607 — voicemail calls stuck on "Phones & live calls"

Symptom (owner, 15 Nov 2026): cards "incoming · Voicemail" with clocks at 150–727 hours that never left the board.
Cause: `voicemail` is the final result of a call as well as a live state; `cc_dialer_overview` listed every call with
that status as live and ignored `ended_at`. Not caused by the Retell balance itself — that only produced many more
voicemails (Riley was not answering), which made it visible. Oldest stuck card: 16 Oct.
Fix: live = `ended_at is null`; `app_private.dial_stale_sweep()` closes dialing/ringing (5 min), active (4 h) and
voicemail legs whose hangup webhook never came (15 min) — called by the overview and by cron `lb-dial-stale-sweep`
every 10 min. The calls stay in the call log with result Voicemail; only the live board changed. No frontend change.
Applied staging + prod 15 Nov: prod live board 0 cards, 18 voicemails kept in the log, 3 un-ended legs closed.
