# Judge instructions

Platform: desktop browser; responsive mobile layout. Run locally with Node 22.23.3. Chrome/Chromium is the automated browser target. The mobile suite emulates an iPhone viewport using Chromium; physical iOS/Safari testing is not claimed.

Public hosted demo: https://agree-first.tameforum1.chatgpt.site

No installation or application login is required for the hosted demo. Use dummy details. Each browser keeps an isolated workspace in durable cloud storage, accessed through its Secure HttpOnly cookie. Keep the same browser for owner editing. After approval, choose Create customer link and open the private link in another browser to review and pay independently. The customer cannot access owner editing or private estimates. The link expires after seven days and can be closed or replaced. Hosted AI has bounded demo usage limits. The local build is an independent fallback with your own integration credentials.

Follow the root README's setup and walkthrough. No application login is required. Use dummy names and requests. In the local build, data stays in the local SQLite file.

## Two honest demonstration paths

- **Self-contained sample:** use the labeled website example, settle its booking-form question, estimate at a chosen rate, approve and review. This does not call a model. Without PayPal credentials it intentionally cannot mark a quote paid.
- **Live integrations:** configure a PayPal sandbox application and an Astropods gateway as described in the README. A fresh request exercises the real AI gateway. A separate PayPal personal sandbox buyer or a published sandbox test card completes the test-money payment. Confirm a stored capture reference and reload it.

No secrets belong in the public repository. Obtain sandbox app/buyer credentials from your own PayPal developer account, and gateway access from Astropods. A development gateway key can expire; reconnect or provide fresh settings rather than relying on an old demonstration session.

## Suggested evidence to inspect

1. Approval disabled for unresolved questions.
2. Question linked to a literal phrase in the original request.
3. AI-generated scope remains editable; final total remains a human choice.
4. Customer view matches the approved snapshot exactly.
5. Editing unpaid scope invalidates the old approval and its customer link; reapproval does not reactivate an old link. Create a new link for the new agreement.
6. PayPal order uses the stored amount and quote revision.
7. Verified completed capture creates a persistent, read-only receipt.
8. Timeout recovery reuses the same order and asks for customer confirmation again.
9. Close a customer link and reload it in the customer browser. It must show an unavailable message without owner controls.
10. Compare the [value proposition](value-proposition.md), [live-model results](model-evaluation.md) and [research plan](user-research.md). Synthetic tests are not user-impact measurements.

The browser payment integration fixture uses controlled test providers. It is test evidence, not proof of a real PayPal transaction. Fresh external-service evidence is recorded separately in the review checklist after it actually happens.
