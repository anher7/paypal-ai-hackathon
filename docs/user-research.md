# Test the benefit, not just the buttons

Status: research plan, with no participant results collected. Do not present this plan, automated checks or a demonstration as user research.

## Five-minute freelancer test

Recruit independent designers or developers who quote fixed-price work. Ask permission to take anonymous notes. Use dummy client details, make recording optional, and collect no credentials or client documents. A participant may stop at any time. Do not contact participants without the owner's approval.

Use this brief for everyone:

> Design a two-sided cafe menu with revisions. Deliver print-ready files by Friday.

| Time | Prompt | What to record |
| --- | --- | --- |
| 0:00–0:30 | “Tell me about a recent fixed-price job. Which detail was hardest to agree?” | Role, recent relevant experience and the participant's words. No customer names. |
| 0:30–1:00 | “What would you need to clarify before pricing this menu?” | Unprompted questions about revision count, file specification, timing and client content. |
| 1:00–3:00 | “Use Agree First to prepare an agreement you would send. Think aloud. Set the demo price to €1.” | Time to an approved agreement; unresolved questions; incorrect assumptions accepted; facilitator interventions; any unwanted price change. Use live drafting only if allowance is available. Record whether live or sample mode was used. |
| 3:00–4:00 | “Open the customer link in a separate browser. What will the customer receive, and what is excluded? Can they edit the price?” | Successful independent access; correct understanding of revision count, file specification and price; errors or help needed. Do not ask a participant to pay. |
| 4:00–5:00 | “A third revision and editable source files are requested. What would you do? Would this replace part of your current process? Why?” | Correct classification of extra work; remaining uncertainty; specific alternative; usefulness from 1 to 5; one change needed before real use. |

If the workflow takes longer, stop at five minutes, record the task as incomplete and keep the time. Do not silently omit slow participants. Resolve integration outages separately from usability failures. Do not coach a task and then count it as unassisted success.

## Decision rules before seeing results

Start with five relevant freelancers for formative feedback. This sample can reveal confusing steps; it cannot establish a population-wide success rate or a reduction in disputes.

- Agreement task: count unassisted completions and report the numerator, denominator and median completion time, including incomplete tasks separately.
- Comprehension: score one point each for correct revision limit, final file specification and final price. Report the individual scores and any wrong answer that could cause extra work.
- Customer access: count independent browser opens without a freelancer session or setup help.
- Trust: count invented terms accepted without noticing, and record the exact clause. One harmful silent assumption requires review, even if the average rating is high.
- Adoption: report usefulness ratings alongside the specific step participants would replace. “Looks nice” is not evidence of adoption.

For a later comparison, give each participant a second, equivalent brief using their usual AI assistant, document and payment-link workflow. Counterbalance which workflow they try first, keep the required agreement details the same, and include copying and rechecking time. Record both times and errors. Do not infer saved time from AI effort estimates.

## Anonymous feedback record

Copy this block for each consenting participant. Keep raw notes private; publish only approved, anonymized summaries.

```text
Participant ID:
Date / facilitator:
Relevant freelance work / quoting frequency:
Draft mode (live AI / labeled sample / manual):
Task completed unassisted (yes / no):
Time to approved agreement (seconds / incomplete):
Help or error encountered:
Clarifications noticed before using the app:
Incorrect or unwanted assumption accepted:
Comprehension (revisions / files / price): _ / 3
Separate-browser customer access (success / failure / not tested):
Third revision and source-file request understood (yes / no):
Usefulness (1–5):
Current tool or step this could replace:
Main reason to use or reject it:
Exact quote approved for publication (optional):
Consent to anonymized publication (yes / no):
```

## Results

No participants tested yet. No measured time saving, dispute reduction, willingness to pay or adoption claim is available.

| Metric | Result |
| --- | --- |
| Relevant participants | Not collected |
| Unassisted agreement completion | Not collected |
| Median completion time | Not collected |
| Agreement comprehension | Not collected |
| Independent customer access | Not collected |
| Harmful assumptions accepted | Not collected |
| Usefulness and replacement intent | Not collected |

## Reproducible fallback integrity check

On 10 November 2026, the existing deterministic draft provider passed seven routing cases: its exact studio example and a whitespace-padded copy returned content labeled `example`; cafe-menu, logo, automation, six-page-site and empty requests returned `null`. Returned sample questions remained unanswered and their source phrase appeared in the request. No model or payment provider was called.

This checks that the sample does not masquerade as a fresh AI response. It does not measure model quality or customer impact, and is not added to the main automated test count. After `npm run build -w @agree-first/api`, reproduce from the repository root:

```sh
node --input-type=module <<'NODE'
import assert from 'node:assert/strict';
import { exampleDraftProvider as provider, examples } from './apps/api/dist/drafting.js';
const sample = examples[0].request;
const cases = [
  [sample, true], ['  ' + sample + '\n', true],
  ['Design a two-sided cafe menu with revisions. Deliver print-ready files by Friday.', false],
  ['Make a professional logo with unlimited revisions and all files.', false],
  ['Automate our invoices and make it GDPR compliant.', false],
  ['Build a six-page website with a booking form.', false], ['', false],
];
for (const [request, expected] of cases) {
  const draft = await provider.draft(request);
  assert.equal(draft !== null, expected);
  if (draft) {
    assert.equal(draft.source, 'example');
    assert.equal(draft.questions[0].resolution, 'unanswered');
    assert.ok(request.includes(draft.questions[0].sourcePhrase));
  }
}
console.log('7/7 fallback routing cases passed; no model invoked.');
NODE
```

## Live-model evaluation and future coverage

Four separate synthetic briefs have now been evaluated once each against the original live prompt and once each after a prompt revision, for eight saved responses. The baseline, follow-up, raw outputs, predeclared rubric and remaining failures are in [Live draft evaluation](model-evaluation.md). This was developer-run, AI-assisted review, not participant research. All participant result fields above remain uncollected. The four-case live evaluation is separate from the seven deterministic fallback routing checks.

The following five-fixture plan is additional future coverage, not a claim that these exact five cases have been run. In particular, it adds a precise brief and a compliance request that the four-case baseline did not test.

Use a fixed model/version and save anonymized input/output, scoring independently of whether it passes the schema. Run once per fixture only after approving use of the gateway allowance. Do not publish a score until the outputs have been reviewed.

| Brief | Details a useful draft should question, not silently decide |
| --- | --- |
| Cafe menu above | Number of revision rounds; print size, bleed and format; which Friday and time zone; who supplies final text and prices. |
| “Build a five-page website with a booking form.” | Inquiry submission versus live availability; content ownership; hosting and recurring services. |
| “Make a professional logo with unlimited revisions and all files.” | Whether unlimited revisions are acceptable; deliverable formats and editable sources; ownership expectations. Do not silently replace “unlimited” with a fixed limit. |
| “Automate our invoices and make it GDPR compliant.” | Systems, triggers and failure handling; personal data and responsibilities. Do not promise legal compliance. |
| “Design a two-sided A4 menu. Two revision rounds. One CMYK PDF, 300 dpi, 3 mm bleed. Final copy supplied. Due 13 November 2026 at 17:00 Baghdad.” | Avoid redundant questions about details already explicit; flag only missing material information. |

Score each expected uncertainty as surfaced, missed or falsely treated as settled. Also record unsupported promises and questions whose source phrase is absent. Report the rubric and all fixtures with results, including failures. This small fixture set is a regression aid, not representative performance evidence.
