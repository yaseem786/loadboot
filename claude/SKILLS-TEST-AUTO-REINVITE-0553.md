# bl_disp_0553 — skills test re-invites itself, up to 3 times

Owner, 15 Oct 2026: "auto re-invite bana do, 3 dafa tak … us k baad phr dobara CC k paas phr bhe option ho invite karny ka".

## Timeline of one invitation (prod values)

| Step | When |
|---|---|
| Invite (CC "Send skills test" / decide → skills_test) | 75 min once started, **48 h to start** |
| 12-hour reminder (`dispatcher.skills_test.reminder`) | ~36 h after a **person-sent** invite only |
| Lapse → `expired` | `lb-skills-test-sweep`, every 10 min |
| Automatic re-invite (`dispatcher.skills_test.reinvite`) | same sweep, ≤ 10 min after an **unstarted** lapse; rounds 1, 2, 3 |
| After round 3 lapses | nothing more is sent; staff in-app notice + audit `dispatcher.test.auto_reinvite_done` |
| CC "Send another" | always available; it is a person-sent invite, so it starts a fresh chain of up to 3 |

Worst case for one person-sent invite: invite + reminder + 3 re-invites = 5 e-mails over ~8 days.

## Rules (`app_private.skills_test_sweep`, patched by anchor)

Re-invite only when ALL hold: the candidate's **latest** attempt is `expired`, `started_at is null`, `start_by` within the
last day (nothing old is resurrected — the 7 lapsed prod candidates from Sep/Oct were NOT re-invited on deploy),
`dispatcher_profiles.status in ('screening','skills_test')`, and not already handled (`integrity.auto_reinvite_checked`).

Not re-invited (audit `dispatcher.test.auto_reinvite_skipped`): hard-suppressed address (bounce/complaint) or opted out of
every optional e-mail (`unsub_prefs '*'` / `comm_preferences.unsubscribed_all`). Read-only checks — nothing is written to
those tables. A started-but-blank attempt (clock ran out) is not re-invited: the candidate accepted the test.

## Pieces

| Where | What |
|---|---|
| `skills_test_attempts.auto_reinvite` | null = person-sent; 1..3 = automatic round |
| `app_private.disp_test_reinvite(prev)` | new attempt + `email_kit` body ("Fresh invitation" / round 3 "Last invitation"); not executable by anon/authenticated |
| `email_catalog` | new row `dispatcher.skills_test.reinvite` (class O, account_critical, cap 3); reminder row cap_note filled in (was "UNKNOWN - verify") |
| `cc_dispatcher_decide` | bug: `skills_test` decision invited at the v1 45 min — now the default 75 |
| `cc_dispatcher_test_review`, `cc_dispatchers_page`, `cc_dispatchers_board` | expose `auto_reinvite` (history item `auto`) |
| `app/shared/api.js` | `ccDispatcherTestInvite` no longer forces 45 min; omitted = DB default |
| `dispatchers-roster.js`, `dispatchers.js`, `dispatcher-test.js` | confirm copy says 75 min + auto re-invites (was "45 minutes, one attempt"); 45 no longer passed; "Invited · auto 2/3"; expired copy explains what happens next |

## Applied

- Staging 15 Oct: applied; rolled-back E2E on `agent@lb.test` — lapse → rounds 1/2/3 (75 min, 48 h each) → 4th lapse
  `reinvite_done` + staff notice, 5th sweep no-op, 3 deliveries queued, audit lines present; reminder on manual invite
  only; rejected candidate and started-but-blank attempt not re-invited.
- Prod 15 Oct: applied; anon SECDEF 36, names = baseline; sweep + reinvite md5 = staging; no `invited` rows existed, so no
  e-mail fired on deploy.
- **Applied with `execute_sql`, not `apply_migration`**: `apply_migration` (and plain `execute_sql` with this file's text)
  hung at the 60 s MCP timeout; the same bytes sent base64-encoded
  (`do $x$ begin execute convert_from(decode('<base64 of the file>','base64'),'UTF8'); end $x$;`) ran in under a second.
  So this migration is NOT in `supabase_migrations.schema_migrations` on either project.
- Email preview: `node tools/email-preview/preview.mjs body.html --no-call …` (rounds 1–2 and round 3).

Rollback: see the header of `migrations/bl_disp_0553_skills_test_auto_reinvite.sql`.
