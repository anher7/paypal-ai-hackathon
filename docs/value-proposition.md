# Why Agree First

Agree First helps a freelancer and customer see what a fixed price covers before checkout. It turns vague phrases into visible decisions and keeps the approved scope revision attached to the payment record.

The focused audience is independent designers, developers and small service studios quoting small fixed-price jobs. The benefit to test is less manual copying and fewer overlooked scope decisions. Reduced disputes, faster quoting and higher earnings have not been measured.

## One job, two interpretations

The customer asks: “Design a two-sided cafe menu with revisions. Deliver print-ready files by Friday.”

Before clarification, the designer might expect two revision rounds and a PDF. The customer might expect revisions until satisfied, editable source files and printed menus. Both can agree to €300 while understanding different work. This is an illustrative scenario, not an observed customer case.

The proposed agreement makes the choices visible:

| Detail | Explicit agreement after human review |
| --- | --- |
| Included | One two-sided A4 cafe menu and two revision rounds. |
| Final file | One CMYK PDF at 300 dpi with 3 mm bleed. |
| Customer provides | Approved menu text, prices, logo and any licensed photographs. |
| Delivery | 13 November 2026 at 17:00 Baghdad, assuming final content arrives by the agreed input deadline. |
| Excluded | Printing, copywriting, photography, editable source files and further revision rounds. |
| Price | The freelancer chooses €300 for this illustration. Use €1 only in the sandbox demonstration. |

The AI should ask about “revisions,” “print-ready files” and “by Friday.” The freelancer supplies or confirms the answers. The customer sees those decisions before paying. A later request for a third revision and source files can be discussed against this record. The app does not promise to prevent disagreements or adjudicate extra work.

## Why not an AI assistant, a document and a payment link?

That combination can produce a good agreement. Existing invoicing and proposal tools can also carry terms, signatures and payments. Agree First's claim is narrower: it makes the connection between an unresolved phrase, a human decision, an approved revision and the server-verified payment part of one workflow.

| Task | Separate general-purpose tools | Agree First prototype |
| --- | --- | --- |
| Notice ambiguous wording | A good prompt and human review can surface it. | Clarification questions point back to the phrase in the original request. |
| Settle an unanswered detail | People edit the document and check that the answer was carried across. | Approval is blocked until every question has an answer or an explicit visible assumption. |
| Choose scope and price | People keep the document and payment amount consistent. | A person approves both together; AI cannot approve or pay. |
| Change an unpaid agreement | People update any copies, terms and payment request. | Scope or price changes invalidate the prior approval. |
| Let a customer review independently | People send the current document or proposal link and manage access. | A limited customer link opens the approved snapshot in another browser, without access to the freelancer workspace. Editing, expiry or revocation blocks the old link. |
| Check what a payment belongs to | People reconcile records; integrated invoice tools may already do this. | Server checks the stored quote revision, recipient, currency, amount and completed PayPal capture. |
| Recover an uncertain payment | Depends on the payment tool and integration. | Persisted attempts recover the same order and block editing while status is uncertain. |

This is workflow enforcement, not a claim that AI writing, proposals or payment links are new. A competitive next step is to test whether people find the combined workflow useful enough to replace their current process.

Remote customer sharing is implemented and was checked against the public deployment on 10 November 2026. A visitor without the owner's cookie could review the minimal customer projection and create a real PayPal sandbox order. Retrying reused that order. Scope and price changes invalidated the old link; reapproval did not revive it; a replacement showed the new price; revocation blocked access. The cloud check did not capture that order. Automated tests cover link expiry separately.

The customer view grants no freelancer editing authority or workspace access. Link possession is access to that agreement; it is not proof of the customer's legal identity or a digital signature. This prototype is sandbox-only and is not a complete contract, tax, refund or dispute-management system.

## Evidence for the problem

The [UK Small Business Commissioner's Contract Guide](https://www.smallbusinesscommissioner.gov.uk/help-and-guidance/all-advice/contract-guide/) recommends writing specific deliverables, limitations, conditions and responsibilities clearly. Its relevance here is the need for a shared record; it does not evaluate Agree First or establish that the product reduces disputes.

The [Freelancers Union Contract Creator](https://freelancersunion.org/contract/) asks users to specify included revisions and treats material service or fee changes as requiring prior written agreement. That supports making revision limits and scope changes explicit. It provides no product outcome data for this app. Sources checked 10 November 2026.

## A judge demo under three minutes

Show real cursor actions and app state. Keep live waits visible or label any cut; do not present the predefined example as live AI. Use dummy customer details and sandbox payments only.

| Time | On screen | Narration point |
| --- | --- | --- |
| 0:00–0:15 | The cafe-menu request. | “A designer and customer can agree to a price while picturing different work. What does ‘revisions’ include?” |
| 0:15–0:45 | Generate a fresh draft; open one question from its highlighted phrase. | “AI turns that uncertainty into a question. It does not silently decide the deal.” |
| 0:45–1:10 | Set two revision rounds and the PDF specification; show unresolved approval disabled, then settle remaining questions. | “People decide. Unanswered questions stop approval.” |
| 1:10–1:25 | Choose the final €1 sandbox price and approve. | “The scope and price are approved together at this revision.” |
| 1:25–1:50 | Open the customer link in a separate browser; show inclusions, exclusions and price. | “The customer can review the same agreement independently.” |
| 1:50–2:20 | Customer confirmation, actual PayPal sandbox checkout, receipt. | “PayPal's completed capture is checked against the approved revision and amount.” |
| 2:20–2:35 | Reload receipt and show paid editing locked. | “The receipt stays attached to what was agreed, even after a reload.” |
| 2:35–2:50 | End card: public app, source, one sentence on the target user. | “For small fixed-price jobs: agree on what the price covers, then get paid.” |

Target 2:50, leaving ten seconds below the three-minute requirement. If live checkout is slower, cut other narration or shorten the opening. Do not accelerate a payment failure into a success. An alternative short demonstration shows a €450 inquiry-form agreement changing to a €650 live-calendar agreement, the old customer link becoming unavailable, and a new link showing the newly approved scope and price.
