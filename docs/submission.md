# Devpost submission draft: owner review required

## Project name

Agree First

## Tagline

Agree on the scope before you get paid.

## Inspiration

“Build a website with a booking form” sounds simple until the freelancer and customer mean different things. An inquiry form and a live scheduling system are different jobs. A checkout total alone does not explain which one the customer is buying.

Agree First puts that conversation before payment. It helps freelancers spot work that needs a separate quote, agree on what the price covers and give the customer a record to check before paying. It is designed for independent freelancers and small service studios.

The selling point is straightforward: catch scope creep before checkout. Every unanswered question must become an answer or a visible assumption before the quote can be approved. The approved scope and PayPal amount then stay tied to the same revision.

## What it does

A freelancer pastes a request. AI drafts included work, exclusions, customer inputs and clarification questions. Each question points back to the phrase that prompted it. The freelancer answers the question or records an explicit assumption that the customer can see.

The same scope can be estimated with and without an AI delivery agent. The comparison includes human planning, review, corrections and testing. Time ranges use an optional hourly rate to suggest prices. The freelancer must deliberately choose a suggestion or enter a final total.

Approval fixes the agreement at one revision. The customer reviews that exact snapshot, confirms the scope and pays through PayPal sandbox checkout. The server verifies the recipient, amount, currency, quote revision and completed capture before storing a receipt. Uncertain payments recover the same order after a reload. Paid agreements are read-only and can be printed or saved as PDF.

## Why PayPal + AI

AI addresses the uncertainty before a purchase; PayPal completes the purchase against what people approved. The model cannot approve an agreement or authorize payment. The payment API does not trust an amount sent by the browser. Together they connect a clearer purchasing decision to a verifiable checkout.

## How it is built

Angular 22 and Angular Material provide the responsive browser interface. An Express API stores quotes, approval snapshots and payment attempts in SQLite through Drizzle. Shared Zod schemas validate input and model output. Money is stored as integer EUR cents.

The AI integration uses the Astropods gateway with Claude Haiku 4.5. PayPal Orders v2 handles server-side sandbox order creation and capture with persisted retry identifiers. A clearly labeled predefined example supports a reproducible walkthrough without consuming model credits; it is distinct from live AI.

## Challenges

A payment timeout is not evidence that payment failed. Agree First preserves the attempt, blocks edits while capture is uncertain and checks the same order again. Another challenge was keeping AI suggestions separate from decisions: drafting and estimating never silently select the freelancer's price or bypass human approval.

## Accomplishments

The workflow runs from request to approved agreement and verified sandbox receipt, with tests covering revisions, exact amounts, provider errors and recovery. The interface makes questions, assumptions and exclusions part of the purchasing decision. A printable agreement gives both people a readable record.

## What we learned

The agreement and the payment need to refer to the same version of the work. Reliable retry behavior is part of the customer experience. AI is more useful here when its proposals are visible and editable than when it hides uncertainty behind a single confident quote.

## What's next

Authenticated customer sharing, payment webhooks, agreement version comparison and user research with freelancers. The current build intentionally remains a local prototype for one freelancer. It does not claim measured dispute reduction, legal enforceability or guaranteed AI productivity gains.

## Built with

TypeScript, Angular, Angular Material, Node.js, Express, SQLite, Drizzle ORM, Zod, PayPal Orders v2, Astropods AI Gateway, Claude Haiku 4.5, Playwright, Vitest.

## Published links and final entrant details

- Public source and local run instructions: https://github.com/anher7/paypal-ai-hackathon
- Public YouTube demonstration: https://www.youtube.com/watch?v=q8FIuu2s7Wc (1:48, actual workflow and sandbox receipt).
- License: MIT, detected by GitHub.
- Remote verification: https://github.com/anher7/paypal-ai-hackathon/actions/runs/42811021062 (passed). Local verification: 195 tests passed.
- Functional demo: local setup and judge walkthrough in README; no hosted demo is claimed.
- Entrant must confirm the correct team, eligibility, residency, ownership and hackathon-period work in the final Devpost form.
- Keep the repository and video public through 15 December 2026. Confirm that the judge setup provides any necessary free external-service access through that date. Do not publish private API credentials.
- Positioning: clear purchasing decisions for freelancers and strong PayPal + AI integration. No autonomous-payment or unverified sponsor-prize claims.

Source and demo publication were approved by the owner on 10 November 2026. The owner will enter or review the Devpost fields and perform the final submission.
