# Architecture and decisions

The browser sends validated JSON to a local Express API. The API is the authority for revisions, prices, approval and payment status. SQLite stores quote payloads, immutable approval snapshots and retry identifiers. AI and PayPal run behind separate provider interfaces, which makes error paths testable without external calls.

```mermaid
sequenceDiagram
  participant F as Freelancer
  participant U as Angular UI
  participant A as Local API + SQLite
  participant AI as AI gateway
  participant P as PayPal sandbox
  F->>U: Paste customer request
  U->>A: Request draft
  A->>AI: Bounded request with output schema
  AI-->>A: Scope and questions
  A-->>U: Editable draft with phrase links
  F->>U: Settle questions and choose price
  U->>A: Save and approve current revision
  A->>A: Store fixed scope and total
  U->>U: Customer reviews and confirms scope
  U->>A: Create checkout for approved revision
  A->>P: Create order with stored amount
  P-->>U: Buyer approves sandbox checkout
  U->>A: Capture this order
  A->>P: Capture and retrieve verified order
  A->>A: Validate recipient, currency, amount, references and capture
  A-->>U: Persisted receipt
```

## Why PayPal is central

The approved agreement determines the purchase unit, total and revision in the PayPal order. A receipt exists only after the API verifies a completed capture against those stored values. Checkout is the final step of the scope agreement, rather than an unrelated donate button.

## Human decisions

AI receives the request and scope as untrusted data and has no execution tools. Its response must satisfy a strict schema, including question phrases that exist in the original request. Draft generation does not assign a price. Effort estimation produces time ranges; integer-cent calculations apply the freelancer's hourly rate. A person must explicitly choose any suggested total. Approval and customer confirmation remain separate actions.

## Recovery

A quote-level operation lock and optimistic revisions reject concurrent/stale updates. The database stores distinct create/capture idempotency identifiers. Uncertain capture results keep the quote locked for reconciliation against the same order. Reload restores that recovery state and asks for consent again. Matching completed receipts are idempotent; retrying cannot create a second application receipt.

## Deliberate limits

Loopback-only operation avoids pretending an unauthenticated prototype is a public customer portal. SQLite keeps setup small. A remote product would need authenticated freelancer/customer identities, access-controlled sharing, durable hosting, payment webhooks and a documented reconciliation process. A hosted public URL is not part of this build. The current receipt is a sandbox payment record, not a tax invoice or an escrow guarantee.
