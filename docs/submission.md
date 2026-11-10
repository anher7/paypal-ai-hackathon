# Devpost submission draft: owner review required

Project: Agree First

Tagline: Agree on the scope before you get paid.

[Try the hosted app](https://agree-first.tameforum1.chatgpt.site) · [Watch the 1:48 demo](https://www.youtube.com/watch?v=zGF5sLGDTYs)

## Inspiration

“Build a website with a booking form” sounds simple until the freelancer and customer mean different things. An inquiry form and a live scheduling system are different jobs. A checkout total alone does not explain which one the customer is buying.

Agree First puts that conversation before payment. It is for independent freelancers and small service studios who need to agree on what a price covers before starting work. The selling point is straightforward: catch scope creep before checkout.

## What it does

A freelancer pastes a customer request. AI drafts included work, exclusions, customer inputs and clarification questions. Each question points back to the phrase that prompted it. The freelancer answers the question or records an explicit assumption that the customer can see. Unresolved questions block approval.

The same scope can be estimated with and without an AI delivery agent. The comparison includes human planning, review, corrections and testing. An optional hourly rate turns time ranges into suggested prices. The freelancer must deliberately choose a suggestion or enter a final total.

Approval fixes the agreement at one revision. The customer reviews that exact snapshot, confirms the scope and pays through PayPal sandbox checkout. The server checks the recipient, amount, currency, quote revision and completed capture before storing a receipt. Uncertain payments recover the same order after a reload. Paid agreements are read-only and can be printed or saved as PDF.

## Why PayPal + AI

AI helps resolve uncertainty before a purchase. PayPal completes the purchase against what people approved. The model cannot approve an agreement or authorize payment, and the payment API does not trust an amount sent by the browser. The scope, approved revision and verified payment stay connected.

## How it is built

Angular 22 and Angular Material provide the responsive interface. The local Express API stores quotes, approval snapshots and payment attempts in SQLite through Drizzle. The public demo uses a Cloudflare Worker and D1 with the same quote and payment rules. Each browser has an isolated workspace, and durable checkpoints preserve payment attempts across requests. Shared Zod schemas validate input and model output. Money is stored as integer EUR cents.

The AI integration uses the Astropods gateway with Claude Haiku 4.5. PayPal Orders v2 handles server-side sandbox order creation and capture with persisted retry identifiers. A clearly labeled predefined example is available for sample drafting. Fresh requests and connected effort estimates use live AI.

## Challenges

A payment timeout does not prove that payment failed. Agree First preserves the attempt, blocks edits while capture is uncertain and checks the same order again. Keeping model suggestions separate from human decisions also mattered: drafting and estimating never silently choose the freelancer’s final price or bypass approval.

## Accomplishments

The complete workflow runs from a fresh request to an approved agreement and verified sandbox receipt. The 1:48 video shows actual input, live AI drafting and estimation, question resolution, price choice, customer consent, PayPal checkout and the same quote’s receipt after reload.

Verification includes 229 passing local tests, production builds, type checking and passing GitHub Actions verification. Coverage includes approval invalidation, exact amounts, duplicate payment protection, provider errors, cancellation and timeout recovery. Real EUR 1.00 sandbox captures were completed locally and on the public hosted app with dummy customer details; the hosted receipt survived reload and its paid editor was locked. No real money was charged.

## What we learned

The agreement and payment need to refer to the same version of the work. Reliable retry behavior is part of the customer experience. AI is more useful here when its proposals are visible and editable than when it hides uncertainty behind a single confident quote.

## What’s next

Authenticated customer sharing, payment webhooks, agreement version comparison and user research with freelancers. The prototype supports one freelancer per browser workspace, either hosted or running locally. Customer review currently stays in that same workspace; cross-device sharing is future work. Effort estimates are suggestions; measured dispute reduction and productivity gains have not been established.

## Run and test it

Open the [public hosted app](https://agree-first.tameforum1.chatgpt.site), with no installation or application login. Use dummy data and keep the same browser for the editor, customer review and receipt. Hosted AI uses a dedicated private gateway key. To protect the demo allowance, live requests are capped per browser, per network and globally, including a persistent total cap. If a limit is reached, the labeled sample draft and manual quote workflow remain available.

For an independent local build, use Node 22.23.3. Complete setup and a judge walkthrough are in the [README](https://github.com/anher7/paypal-ai-hackathon#run-it-on-macos-or-linux) and [judge instructions](https://github.com/anher7/paypal-ai-hackathon/blob/master/docs/judging.md). Local live requests and payments use your own documented Astropods gateway and PayPal sandbox settings; keep those credentials private.

[Public MIT source](https://github.com/anher7/paypal-ai-hackathon) · [Working demo](https://www.youtube.com/watch?v=zGF5sLGDTYs) · [Verification report](https://github.com/anher7/paypal-ai-hackathon/blob/master/docs/verification.md)