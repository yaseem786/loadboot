# bl_disp_0553 — the carrier is told when a dispatcher post expires

Owner, 15 Oct 2026: an expired dispatcher post stays in the database as `status = 'expired'` (never deleted) and stays
off the carrier's Load Board. The gap was that only the dispatcher was told; for the carrier the load just vanished.

| Where | What |
|---|---|
| `migrations/bl_disp_0553_dispatcher_post_expiry_carrier_notice.sql` | Two exact-once `fn_patch` anchors on `app_private.disp_posts_expire()` (cron `lb-disp-posts-expire`, every 10 min). Per expired post with a `target_carrier_org`: up to 3 active non-driver members (owner first) get an in-app notification `dispatcher.load.expired`, tone info, url `/app/carrier/#loads`, `load_id`. Body says whether it timed out or passed its pickup date. Guarded: one per post per member. |

- In-app only. No e-mail, so no `email_catalog` row (same as the in-app-only keys `dispatcher.load.accepted` / `.updated`).
  If an e-mail is ever wanted, it needs a catalog row (CLAUDE.md §6) and `email_gate` like `dispatcher.load.withdrawn`.
- What the carrier sees after expiry: board — gone (since 0549, at `expires_at`); notice — new; opening the load —
  "⏰ This post expired.", no accept/decline; a stale accept is refused server-side and flips the row to `expired`.
- Staging 15 Oct: applied; E2E in a rolled-back DO block on the newest staging dispatcher post (forced `available` +
  past expiry): swept 1, status `expired`, 1 notice to the carrier owner, re-run added none.
- Prod 15 Oct: applied; md5 `4aea369b2cc3838e9b6771ee740a4a12` = staging; ACL `{postgres=X/postgres}` unchanged; anon
  SECURITY DEFINER surface 36 (prod) / 35 (staging), names = baseline.
- Test load f17b21f6… (live until 18 Oct) will be the first real one: its carrier gets this notice when it expires.
