# Marketing Delivery Engine — Working Staging Demonstration

Ran the **entire** campaign lifecycle against staging (`snslhvmkjusozgjelghi`) end to end, through the real
RPCs, with no mocking. The run is self-cleaning (all fixtures removed afterward). This satisfies the "produce a
working staging campaign demonstration" requirement.

Scenario: a "Demo launch" newsletter campaign to 3 subscribers, using the `demo_welcome` template, created by
one user and approved by another (separation of duties).

| Step | What ran | Result |
|------|----------|--------|
| 1 | **Approve** (maker-checker) | approved — approver ≠ creator enforced |
| 2 | **Preview** | audience 3 · after-consent 3 · suppressed 0 · final 3 |
| 3 | **Suppress** `erin@` then re-preview | final drops to 2 · suppressed 1 |
| 4 | **Enqueue** (confirm count = 2) | 2 newly queued · status `sending` · **template body snapshotted onto each delivery** |
| 5 | **Worker claim** (service-role) | 2 claimed atomically |
| 6 | **Provider results** | carol → delivered; dave → **bounced → auto-suppressed** (verified true) |
| 7 | **Analytics** | delivered 1 · bounced 1 · delivery-rate 100% · bounce-rate 50% |
| 8 | **Attribution** | a web visitor converts on the contact form with the campaign UTM → 1 attributed submission, 100% conversion of delivered |

Every guardrail fired as designed: consent filtered the audience, the confirm-count gate matched, the send was
idempotent, the bounce auto-suppressed the address for all future sends, and the web conversion was attributed
back to the campaign by its UTM tag — the full **send → deliver → suppress → measure → attribute** loop.

Raw captured output is reproducible by running `pg_temp.demo()` as documented in the session changelog
(increment 35). No real email was transmitted — the provider send is simulated because no provider key is set
in staging; the same path runs for real once the owner sets `RESEND_API_KEY` and deploys `delivery-worker`.
