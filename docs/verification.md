# Verification: 10 November 2026

Verified locally on macOS ARM64 with Node 22.23.3.

| Check | Result |
| --- | --- |
| API type checking | Pass |
| Backend unit tests | 114 passed |
| Angular frontend tests | 25 passed |
| Gateway connection tests | 25 passed |
| Portable CLI setup tests | 7 passed |
| Desktop browser journeys | 16 passed |
| Mobile Chromium browser journeys | 16 passed |
| Hosted persistence/API tests | 26 passed |
| Production build | Pass |
| npm dependency audit | 0 reported advisories |
| Whitespace/diff check | Pass |

Total: **229 passing tests in the final complete `npm run verify` run** (10 November 2026). Type checking, all unit/connection/installer tests, production build and all 32 browser journeys passed together using Playwright’s standard browser cache. The revised desktop design was visually inspected. Mobile layout, consent, approval and payment workflows passed the Chromium browser suite. Earlier mobile and print screenshots are historical evidence from before the typography revision.

The browser payment integration runs the real API and SQLite with a test-only provider and SDK fixture. It covers consent, exact stored totals, receipt persistence, paid immutability, duplicate payments, amount mismatches, timeout recovery, cancellation and SDK failure. No real-money payment was attempted. The fixture is excluded from the production application.

A browser-test timing issue was corrected by waiting for the saved revision rather than an identical prior status message. Browser installation and configuration now use the same standard cache; an explicit PLAYWRIGHT_BROWSERS_PATH remains supported for Windows/local installations.

Fresh live checks on this Mac:

- Astropods CLI 0.32.0 was verified against the official SHA-256 and authorized with the owner’s account. Its isolated helper connected and then stopped successfully.
- Live Claude Haiku 4.5 drafting and effort estimation both passed on a fresh cafe-menu request. Four phrase-linked questions, eight tasks and four explicit assumptions persisted. The final price stayed unchanged until an explicit suggestion selection; the approved test total is EUR 1.00.
- Real PayPal sandbox OAuth and order creation passed. Checkout cancellation left its quote unpaid. The guest-card form used PayPal’s published sandbox test card and dummy details.
- With owner confirmation, a real sandbox capture completed for **EUR 1.00**, approved revision **6**. Order `22U34232BB2884647`; capture `2P796968PY535350M`; recorded at `2026-11-10T10:36:38.300Z`. Reload and server restart preserved the receipt. A repeat capture request returned the identical stored receipt, and the editor is read-only.
- A completed 1:48 video uses actual app footage, locally generated neural narration (Kokoro v1.0, preset af_heart) and captions. The complete file decoded successfully and its footage was visually reviewed. The approved video is now publicly available on YouTube. Historical checks from another machine are not counted here. Physical mobile devices, Safari and Windows execution have not been verified. Remote GitHub Actions verification passed after publication.

The owner approved publication on 10 November 2026. The [MIT source repository](https://github.com/anher7/paypal-ai-hackathon) is public; anonymous access and license detection were verified. The [approved demo](https://www.youtube.com/watch?v=zGF5sLGDTYs) is public, and watch-page playback was checked. YouTube reported no copyright issues. [Remote verification](https://github.com/anher7/paypal-ai-hackathon/actions/runs/42811021062) passed on application commit `afe4b46`. A public hosted deployment is now available; the Devpost entry remains an unsubmitted draft.

Style revision: Source Sans 3 is self-hosted with its license, serif headings and decorative rotations were removed, scope lists use bullets, and interface/presentation copy uses direct language with fewer long dashes. The full 195-test verification passed again after these changes.

The earlier narrated tour was replaced with a fresh **1:48 workflow recording**. Actual UI entry, live AI generation, question resolution, live estimation, price selection, approval, consent and PayPal checkout are recorded chronologically. The fresh quote has three resolved questions and 13 estimated tasks. With owner confirmation, PayPal completed order `16H82723CL764350L`, capture `5RL79013CT810124W`, for EUR 1.00 at approved revision 5. The payment transition, receipt reload and paid editor lock are all recorded. The earlier paid agreement remains unchanged. No app code changed during the video replacement.

The final video decoded completely without error; action and receipt frames were visually inspected, and narration was checked by local speech recognition. The final export stays below three minutes.

The owner renamed the existing Zpower channel to **Anher Builds** (`@AnherBuilds`). The approved 1:48 demo was uploaded there and made **Public** at the owner's request. YouTube confirmed publication with no copyright issues, and watch-page playback was checked. The submission now uses `https://www.youtube.com/watch?v=zGF5sLGDTYs`.

## Hosted verification

The public app at https://agree-first.tameforum1.chatgpt.site opens without signing in. Cloud D1 checks passed for workspace isolation, saved approval snapshots, same-origin protection, and persistent reload. Fresh live AI drafting and effort estimation passed through the hosted API. PayPal created a real EUR 1.00 sandbox order from the approved revision; retrying reused the same stored order. A separate public-browser journey also drafted and estimated a fresh request, settled three questions and opened PayPal's real sandbox card form. With owner approval, that hosted quote completed a real EUR 1.00 sandbox capture at revision 4: order `7UR94225LL052554U`, capture `5P109687BL8079107`. The receipt survived reload, and opening the editor showed the paid agreement as read-only.

Worker compatibility regressions cover missing global Buffer and unsupported redirect:error; provider code imports Buffer explicitly and uses manual redirects so credentials are not forwarded to a new host. Transport diagnostics redact gateway keys and URLs. All 218 tests, builds and typechecks passed together after these fixes. The final runtime-fix commit also passed [GitHub Actions verification](https://github.com/anher7/paypal-ai-hackathon/actions/runs/42851146661).


## Public demo abuse controls

The final full verification run passed 229 tests, builds and typechecks together. Eleven new hosted checks exercise atomic concurrent quotas, cookie resets, IP limits across minutes, the persistent total across UTC days and cleanup, invalid/stale/foreign quote requests, and availability of sample drafting and payment recovery after AI exhaustion. The runtime reserves at most two live AI calls per IP per minute, 12 per IP per UTC day, eight per browser workspace per day, 40 globally per day and 200 across the demo lifetime. Limits are configurable within server-enforced bounds. A dedicated owner-approved Astropods account key replaces the expiring development key and is kept only in private Sites server secrets. No billing settings were changed.
