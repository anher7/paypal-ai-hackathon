# Test coverage

Run `npm run browsers:install`, then `npm run verify` on Node 22.23.3. Local tests must pass before publication. The workflow in `.github/workflows/verify.yml` prepares the same checks for Linux; local success does not establish that the remote workflow has run.

| Area | Evidence |
| --- | --- |
| Money and input contracts | Positive exact EUR cents, bounds, malformed values, duplicate question IDs, strict request validation |
| Quote lifecycle | Create, save, persistence, approval requirements, approval invalidation, stale revisions, concurrent operations, paid immutability |
| AI | Validated and bounded responses, malformed/fenced/truncated output, timeouts, rate limits, invalid credentials, phrase linkage, no automatic approval or price changes |
| Effort comparison | Same scope, rates, optional blank rate, explicit price selection, stale-estimate detection, persistence |
| PayPal provider | OAuth, sandbox endpoint, request IDs, fixed amount, recipient checks, order/capture status, failure responses and verification |
| Payment service | Consent, revision/amount/currency/recipient mismatch, duplicate requests, uncertain capture, reload recovery, expired attempts |
| Editor browser journeys | Request creation, sample/manual drafting, phrase focus, question add/edit/remove after repeated saves, approval, dashboard persistence |
| Checkout browser integration | Real API + SQLite with test-only provider; consent, capture, receipt reload, duplicate payment, lock, mismatch, timeout recovery, cancel, SDK failure |
| Layout | Desktop and mobile Chromium, horizontal overflow checks, print controls and agreement visibility |
| Gateway connector | Helper ownership, disabled interfaces, credential expiry, safe error messages and cleanup |

## Fresh live checks (separate from automated tests)

These require local credentials and external account access. Do not treat controlled test results as a live integration check.

1. Put sandbox and gateway settings in `.env`, restart the server, then run `npm run doctor`.
2. Use a fresh dummy request such as “Create a two-sided cafe menu with seasonal specials.” Generate a live AI draft and verify the AI label and phrase-linked questions. Resolve details, estimate work, and confirm the final price stays unchanged until you select or enter it.
3. Approve a small test total and open customer view. Check the scope checkbox, sign in with a **personal sandbox buyer**, or use a [published sandbox test card](https://developer.paypal.com/sandbox-testing/card-testing) in the guest-card form. Approve only the sandbox checkout. Never use a real-money account or live credentials.
4. Confirm the server's paid record, exact amount and PayPal capture reference. Reload and verify the receipt persists; the editor must be read-only.
5. Start a separate unpaid quote, cancel PayPal checkout and verify that it remains unpaid.
6. Record the date, browser, gateway model, total and non-secret order/capture references in the local review package. Keep buyer passwords, application secrets and tokens out of screenshots and recordings.

The repository's original README described live checks on 14 October 2026 on another machine. Those are historical claims; this preparation does not count them as fresh checks on this Mac.
