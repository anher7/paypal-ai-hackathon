# Live draft evaluation, 10 November 2026

Four synthetic briefs were run once each against the public hosted app using `claude-haiku-4-5`, from 17:21 to 17:24 UTC. These are baseline responses from deployed version 5, before the later prompt correction for excluding requested work. The evaluation called live AI and retained all four results, including weaknesses.

This is developer-run, AI-assisted content review. It is not independent human user research, a representative model benchmark, proof of saved time or evidence of reduced disputes. No customer or freelancer participated.

Fixtures and expected review points were declared in [scope-cases.json](../evals/scope-cases.json). The [complete raw responses](../evals/scope-results-2026-11-10.json) contain dummy requests, non-secret quote identifiers and the model's draft content. They contain no gateway keys, session cookies or payment credentials.

## What the script checks

All four responses came from live AI. In all four, each question's source phrase appeared in its request, and the quote remained unapproved with no final price and all questions unanswered. These mechanical checks establish source-phrase matching and preservation of human control. They do not establish that a question is useful or a scope clause is correct.

## Content review method

A separate AI-assisted reviewer read each complete response against only the twelve predeclared review points. No new expected topic was added after seeing outputs. Compound points are separated below so partial coverage is visible. Each component receives one of three statuses:

- **Surfaced:** a question, customer-input checklist or proposed scope boundary makes the detail visible for human review.
- **Missed:** the component is absent or too general to establish the relevant choice.
- **Contradictory proposal:** an exclusion directly conflicts with work explicitly requested, or treats an unresolved specification as excluded work. This is a content defect, not a claim that AI approved or settled an agreement.

These are reviewer judgments, not automatic semantic scores. All output is a draft that people can edit before approval. Adjacent work reasonably proposed as excluded, such as physical printing when only files were requested, is not treated as a contradiction. A boundary still needs human confirmation.

| Brief | Predeclared review point | Status | Evidence and reason |
| --- | --- | --- | --- |
| Cafe menu | Number of revision rounds | Surfaced | A question asks how many rounds and what changes count. No round count is invented. |
| Cafe menu | Print file specifications | Surfaced | A question asks format, resolution, color and bleed. |
| Cafe menu | Printing responsibility | Surfaced | Physical printing is proposed as excluded. The brief asks for files, so this is a reasonable boundary for people to confirm rather than a contradiction. |
| Cafe menu | Which Friday | Surfaced | A question asks which Friday and the deadline time. |
| Cafe menu | Deadline timezone | Surfaced | The same question explicitly asks for a timezone. |
| Booking site | Inquiry form versus live booking and availability | Missed | The question asks fields, storage and confirmation. It never explicitly distinguishes an inquiry form from live calendar availability. |
| Booking site | Duration of ongoing support | Contradictory proposal | The question asks duration, but ongoing support scope and duration also appear in exclusions. Support was explicitly requested. |
| Booking site | Boundaries of ongoing support | Contradictory proposal | The question asks support scope and response time, but ongoing support and post-launch maintenance are excluded. This is the same support contradiction as above, affecting both components. |
| Logo delivery | Number of revision rounds | Contradictory proposal | A question asks round count, but “Number of revision rounds” appears under exclusions. Revision count is an unresolved specification of the requested revisions, not a separate service to exclude. No numeric limit is invented. |
| Logo delivery | Required editable file formats | Contradictory proposal | Source-file delivery is included and preferred source formats appear in needs, but “File formats to be delivered” also appears in exclusions. The draft mixes specification details with excluded work. |
| Logo delivery | Concrete delivery deadline | Surfaced | A question replaces “ASAP” with a request for a specific deadline. |
| Social launch | Number of posts | Surfaced | A question explicitly asks how many posts. |
| Social launch | Target platforms | Surfaced | A question explicitly asks which platforms. |
| Social launch | Image dimensions | Missed | Required sizes or dimensions are absent. |
| Social launch | Who supplies images | Surfaced | A question asks whether the customer provides images or needs sourcing or creation. |
| Social launch | Image licensing responsibility | Surfaced | Photography and licensing are proposed as excluded. Combined with the sourcing question, this is an unconfirmed boundary to review. “With images” does not expressly require the freelancer to create or license them. |
| Social launch | Launch date | Missed | The question asks what is launching, not when. |
| Social launch | Delivery deadline | Missed | No delivery deadline is requested elsewhere. |

The concrete omissions are the booking behavior distinction, image dimensions, launch date and delivery deadline. The clearest contradiction is exclusion of explicitly requested ongoing support. The logo draft also misclassifies revision count and file specifications as exclusions. These observations are more useful than a single accuracy percentage from four requests.

## Other content risks in the same responses

- Cafe: unlimited revisions, copywriting, photography and finishing are proposed as excluded. These are plausible boundaries, but need human review rather than being treated as facts established by the brief.
- Booking site: design choices, mobile responsiveness, hosting and several other services are proposed as excluded. Excluding requested support is the clear contradiction; people should also review whether the broader proposed boundaries fit the intended website.
- Logo: “Number of revision rounds,” file formats and design direction appear as exclusions even though they are unresolved specification details. This mixes missing information with work boundaries and can confuse a reviewer.
- Social launch: image creation and licensing exclusions are proposed boundaries alongside an open sourcing question. People must reconcile the answer with those boundaries before approving. Posting, advertising, management and reporting are also proposed exclusions.

No payment was attempted in this evaluation. The observed drafts remained editable and unapproved, so these issues did not produce automatic charges or agreement approval.

## Correction and follow-up

The baseline prompted a change to the AI instructions: preserve explicitly requested work in included scope while its details are clarified; do not turn an unanswered question into an exclusion. The revised instructions also ask for checks of quantity, formats, iterations, delivery and feature behavior. The baseline above does not evaluate that change.

The same four fixtures were then run once each against deployed version 6, from 17:29 to 17:32 UTC on 10 November. The [complete follow-up responses](../evals/scope-results-after-2026-11-10.json) are saved separately. The model identifier remained `claude-haiku-4-5`. All four again passed the source-phrase and human-control checks. No model call was made by the content reviewer.

### Follow-up content review

The reviewer used the same declared points and separated components. A detail in the customer-input checklist counts as surfaced; it is not necessarily a blocking clarification question. Proposed adjacent boundaries are not treated as contradictions merely because they were absent from the brief.

| Brief | Follow-up against the declared review points | Change and remaining issue |
| --- | --- | --- |
| Cafe menu | Revision count, print specifications, Friday and timezone are explicitly questioned. Physical printing is proposed as excluded. | Requested revisions remain included with their extent pending clarification. The reviewed points are surfaced. People must confirm the proposed printing boundary. |
| Booking site | Support duration and boundaries are explicitly questioned and support stays included pending clarification. Questions distinguish calendar/payment/email integration from collecting and storing data. | The explicit support exclusion is absent. The simple-form versus integrated-booking choice is clearer, but live availability and prevention of double booking are still not explicitly asked. The original availability component remains only partly covered. |
| Logo delivery | Revision count, editable source formats and concrete deadline are explicitly questioned. Requested revisions and source files stay included pending clarification; exclusions are empty. | The observed revision-count/file-format exclusion defects are absent in this response. All declared points are surfaced. |
| Social launch | Post count, platforms, image sourcing, launch date and delivery date are explicitly questioned. Dimensions appear in the needs checklist. | Previously missed dimensions and dates are now surfaced, although dimensions are not a blocking question. Licensing responsibility is no longer stated: stock versus custom creation does not establish who obtains usage rights. “Create or source images” is included while custom graphics appear excluded with “pending clarification,” leaving an internal boundary ambiguity to resolve. |

The observed support and logo exclusion defects did not recur in these four follow-up outputs. Missing social dimensions and dates were surfaced. Remaining weaknesses include explicit booking availability, image licensing responsibility and the social graphic-creation boundary. These concrete findings are preferable to a blanket claim that the prompt is fixed.

There is one response per case per prompt, with no repeated sampling or blinded human annotation. Natural output variation, timing and the prompt change cannot be separated by this run. The comparison is useful regression evidence, not a statistically established improvement, semantic accuracy score or prediction of all future drafts. Both complete result sets remain published, including the baseline failures.

## Reproduce

From a built checkout, with live AI configured on the target and sufficient approved demo allowance:

```sh
node scripts/evaluate-hosted.mjs https://agree-first.tameforum1.chatgpt.site /absolute/path/scope-evaluation.json
```

The script uses a new isolated browser-style workspace, dummy data and one model response per case. It does not use saved local credentials, approve an agreement or call PayPal. It waits between calls to respect the public demo limits. Repeating it consumes the owner's gateway allowance; do not run it as a free load test. The current script can optionally receive a fourth argument with comma-separated case IDs for a targeted rerun.

The fixture set is intentionally small and ambiguous. It lacks precise briefs, adversarial inputs, repeated sampling, blinded human annotation and multiple model comparisons. The next useful evidence is a regression rerun plus the [freelancer comprehension test](user-research.md), not a larger unqualified claim.
