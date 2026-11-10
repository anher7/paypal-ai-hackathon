# Judge instructions

Platform: desktop browser; responsive mobile layout. Run locally with Node 22.23.3. Chrome/Chromium is the automated browser target. The mobile suite emulates an iPhone viewport using Chromium; physical iOS/Safari testing is not claimed.

Follow the root README's setup and walkthrough. No application login is required. Use dummy names and requests. Data stays in the local SQLite file.

## Two honest demonstration paths

- **Self-contained sample:** use the labeled website example, settle its booking-form question, estimate at a chosen rate, approve and review. This does not call a model. Without PayPal credentials it intentionally cannot mark a quote paid.
- **Live integrations:** configure a PayPal sandbox application and an Astropods gateway as described in the README. A fresh request exercises the real AI gateway. A separate PayPal personal sandbox buyer or a published sandbox test card completes the test-money payment. Confirm a stored capture reference and reload it.

No secrets belong in the public repository. Obtain sandbox app/buyer credentials from your own PayPal developer account, and gateway access from Astropods. A development gateway key can expire; reconnect or provide fresh settings rather than relying on an old demonstration session.

## Suggested evidence to inspect

1. Approval disabled for unresolved questions.
2. Question linked to a literal phrase in the original request.
3. AI-generated scope remains editable; final total remains a human choice.
4. Customer view matches the approved snapshot exactly.
5. Editing unpaid scope invalidates the old approval.
6. PayPal order uses the stored amount and quote revision.
7. Verified completed capture creates a persistent, read-only receipt.
8. Timeout recovery reuses the same order and asks for customer confirmation again.

The browser payment integration fixture uses controlled test providers. It is test evidence, not proof of a real PayPal transaction. Fresh external-service evidence is recorded separately in the review checklist after it actually happens.
