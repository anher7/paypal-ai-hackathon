# Devpost submission draft: owner review required

Project: Agree First

Tagline: Agree on the scope before you get paid.

[Try Agree First](https://agree-first.tameforum1.chatgpt.site) · [Watch the working demo](https://www.youtube.com/watch?v=JaBNFLG-2V0)

## The problem

A customer asks for “a cafe menu with revisions, print-ready by Friday.” The designer hears two revision rounds and a PDF. The customer might expect changes until satisfied, editable files and printed menus. They can agree to the same price while picturing different jobs.

Agree First is for independent freelancers and small service studios doing fixed-price work. It makes those differences visible before payment: agree on what the price covers, then get paid.

## What it does

AI proposes included work, exclusions, customer inputs and questions tied to the exact words that need clarification. Clicking “revisions” takes the freelancer to the question about what counts as a revision. Every question needs an answer or an explicit assumption before approval.

People choose the terms and final price. An optional effort comparison estimates the same promised work with and without an AI delivery agent, including human review, corrections and testing. Suggestions never silently become the price.

Approval fixes one scope revision and EUR total. The freelancer creates a private customer link that opens on another browser or device. The customer sees only that approved agreement, confirms it and pays through PayPal sandbox checkout. Private effort estimates and editing controls stay with the freelancer.

Changing unpaid scope or price invalidates the old approval and its customer link. Links also expire after seven days and can be closed or replaced. The server checks the stored revision, amount, currency, recipient and completed capture before saving a receipt. Uncertain payments recover the same order. Paid agreements are read-only and printable.

## Why combine AI and PayPal?

An AI assistant, proposal document and payment link can produce a good agreement. Agree First adds an enforced connection between the clarification, human decision, approved revision and verified payment. People do not have to rely only on copying the right text and remembering which version a payment link belongs to.

The model cannot approve a quote or authorize payment. PayPal checkout uses the approved server record, not a total supplied by the browser. That connection is the product, rather than AI-generated wording alone.

## How it is built

Angular 22 and Material provide the interface. A Cloudflare Worker and D1 run the public demo; the independent local build uses Express and SQLite through Drizzle. Both share the quote and payment rules. Zod validates inputs and model output, and integer cents preserve exact totals. Astropods connects Claude Haiku 4.5; PayPal Orders v2 creates and captures sandbox orders. Durable checkpoints and persisted retry identifiers protect payment recovery. Customer links use random tokens stored only as hashes, scoped to one approved revision.

## What is demonstrated

250 automated tests pass across the API, interface, hosted persistence and desktop/mobile browser journeys, with production builds, type checking and GitHub Actions verification. Actual EUR1 sandbox captures completed locally and on the hosted app. The hosted receipt survived reload and deployment, and its editor remained locked.

A small, developer-run live-model evaluation uses four predefined briefs and publishes the outputs and review rubric. It exposed a draft that incorrectly excluded requested support, which led to clearer instructions about preserving requested work pending clarification. This is engineering evidence, not user research or proof of fewer disputes.

The 2:16 video shows actual application use, live drafting and estimation, human decisions, PayPal checkout and a verified receipt. A separate labeled website example shows customer sharing, scope and price changes, the old link being blocked and the replacement agreement. That predefined example is separate from the live AI and does not include a new payment.

## What we learned and what comes next

Reliable payment retries and clear uncertainty are part of the customer experience. A useful draft must surface a decision without pretending it has already been agreed.

We have not measured time savings, adoption or dispute reduction. A five-minute freelancer test and predefined comprehension measures are included in the repository so those claims can be tested. Next steps include that research, authenticated customer identities, payment webhooks and agreement version comparison. Link possession grants access to an agreement; it is not identity verification or a digital signature.

## Try it

Open the [public app](https://agree-first.tameforum1.chatgpt.site), use dummy details and create a quote. After approval, use Create customer link to review from a different browser. The hosted gateway has network, workspace and shared usage limits to bound misuse. The static sample and manual editing remain available after AI limits are reached. PayPal uses test money only.

[Public MIT source and local setup](https://github.com/anher7/paypal-ai-hackathon) · [Judge walkthrough](https://github.com/anher7/paypal-ai-hackathon/blob/master/docs/judging.md) · [Verification](https://github.com/anher7/paypal-ai-hackathon/blob/master/docs/verification.md)
