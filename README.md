# Agree First

Make the work clear before anyone pays.

Agree First helps a freelancer turn a customer request into a clear quote. Questions
point back to the words that caused them. The freelancer answers them, or writes
an assumption, enters a price, and approves the work. The customer reviews that
same agreement before PayPal sandbox checkout.

## What works in this version

- A local quote list, an editable scope, and a customer review page.
- Questions linked to phrases in the request.
- Answers and explicit assumptions before approval.
- Human-entered EUR prices and a fixed approved quote revision.
- SQLite storage and a genuine PayPal sandbox order/capture integration.
- Clearly labeled sample drafting for the example request.
- Astropods live drafting for new requests when connected.
- Task, hour, and price comparisons with and without an AI agent.
- An editable hourly rate and explicit selection of a suggested final price.

Live AI needs a gateway connection. Sample drafting is predefined and clearly labeled. Other requests can be drafted manually. Without sandbox credentials, checkout
shows a setup message and cannot mark a quote paid.

## Start on Windows

Open Windows PowerShell 5.1 or PowerShell 7 in:

`C:\Users\anhur\Documents\www\paypal-ai-hackathon`

```powershell
.\scripts\setup.ps1
.\scripts\run.ps1 dev
```

Setup downloads Node 22.23.3 into `.tools/`, verifies its SHA-256 against the
official Node manifest, and installs the dependencies. It does not change your
system Node installation. If your PowerShell policy blocks these local scripts,
run them in a process with an appropriate policy; the scripts do not change policy.

Open [Agree First](http://127.0.0.1:4200). The API runs on
[port 3001](http://127.0.0.1:3001/api/config). Stop the development command with Ctrl+C.

Use the labeled example, “Build a five-page website with a booking form.”
Resolve “booking form,” write the agreed scope, and enter your own price. Approve
the quote and open the customer view.

## Sandbox checkout

Use credentials from your own PayPal developer **sandbox** application. Put only
the two required values in a root `.env` file, beside `package.json`:

```dotenv
PAYPAL_CLIENT_ID=your-sandbox-client-id
PAYPAL_CLIENT_SECRET=your-sandbox-client-secret
```

The backend loads this optional file at startup. Keep it out of Git and chat.
The assistant does not open it. The frontend receives only the public client ID;
secrets and OAuth tokens stay on the server. Variables already set in your
PowerShell session take precedence over the file.

Both `PAYPAL_MERCHANT_ID` and `AGREE_FIRST_DATABASE_PATH` are optional. Leave them
out or blank to use the normal recipient check and `work/agree-first.sqlite`.
A blank `PORT` also uses the default, 3001.

After changing configuration, press Ctrl+C in the running app terminal, then run:

```powershell
.\scripts\run.ps1 dev
```

Refresh the customer page and confirm the scope checkbox. Use a personal sandbox
buyer account for checkout. The app calls only `https://api-m.sandbox.paypal.com`;
there is no live-payment mode or simulated payment-success button.


Checkout uses Pay Now for the fixed agreed total and asks for no shipping address.
If an older popup shows Continue to review your order, close it and refresh the
app. Save the unpaid quote and approve it again before reopening PayPal; this
creates a fresh revision and order with the current settings. If the app asks to
check a pending payment, use Check payment again before trying to edit the quote.

Approval fixes scope, assumptions, amount, and quote revision. Edits remove unpaid
approval. The server creates and captures the stored amount, checks the order and
recipient, and records payment only after PayPal confirms a matching completed
capture. It stores retry identifiers so repeating checkout cannot create a second
capture. An uncertain capture blocks edits until its result is checked. The customer view restores that saved order after reload and requires agreement confirmation again before retrying.

If an unresolved attempt is more than five hours old, the app asks for a manual
sandbox check rather than making a new payment attempt. This is a conservative
retry boundary, not a claim that every provider operation has the same lifetime.

## Connect AI with Astropods

Create an account through the [hackathon sponsor page](https://paypalaihackathon.devpost.com/details/astropods) and check its available credits. Keep Docker Desktop running for the local connection step. In the project PowerShell terminal, run:

```powershell
.\scripts\connect-ai.ps1 -Login
```

Follow the Astropods browser link and code, then wait for the command to finish.
The script installs a checksum-verified project-local CLI if needed. It starts a
local helper without published ports, copies the gateway credentials internally,
and closes the helper. It does not publish or deploy your project.

Refresh the app after connecting. The backend detects the new gateway settings automatically.
Create a new unpaid quote with your own request and click Generate scope.
The predefined example still uses labeled sample scope; it is not a live draft.

After reviewing the scope and settling questions, enter your hourly rate in EUR
and click Estimate work. The comparison lists tasks, time ranges, agent help,
human work, and assumptions for the same scope. Price suggestions use that rate.
Choose Use low suggestion or Use high suggestion only if the amount fits your
work, or enter your own final price. Approval and checkout use that one final
amount; AI cannot approve or pay. Work edits mark estimates stale until recalculated.
Rates can be left blank to estimate time only. Paid quotes stay read-only.

The connection is temporary. If it expires, rerun `.\scripts\connect-ai.ps1` and
restart the app; add `-Login` only when a fresh Astropods sign-in is needed.
Private gateway settings stay in `.tools/astropods/gateway-runtime.json`, which
Git ignores. Do not open, share, or commit that file. The assistant never inspects
its contents. The documented gateway model is Claude Haiku 4.5.

Requests have a timeout, bounded output, strict validation, and no automatic
retry. AI time estimates are suggestions, not guaranteed savings or market rates.
Local automated tests force example mode and never consume your account credits.
Live drafting and effort estimation were verified with a dummy request on 14 October 2026.
See the [Astropods gateway documentation](https://docs.astropods.com/ai-gateway).

## Build and verify

```powershell
.\scripts\run.ps1 typecheck
.\scripts\run.ps1 test
.\scripts\run.ps1 build
.\scripts\run.ps1 test:e2e
.\scripts\run.ps1 start
```

After building, `start` serves the application and API together at
[http://127.0.0.1:3001](http://127.0.0.1:3001). Do not run the production and
development API commands at the same time on the same port.

The browser suite uses Playwright Chromium. Install its browser with the local
runtime if it is missing:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location).Path '.tools\playwright'
& .\.tools\node-v22.23.3-win-x64\node.exe .\node_modules\@playwright\test\cli.js install chromium
```

For Windows ARM64, use the `win-arm64` runtime folder. On other systems, use a
compatible Node 22 release (22.22.3 or newer), then `npm ci`, `npm run dev`,
`npm test`, and `npm run build`.

Tests use temporary databases and controlled payment-provider responses. They
do not charge anyone or contact PayPal. A real sandbox transaction is a separate
check that requires credentials.

## Structure and configuration

- `apps/web`: Angular 22, Angular Material, shared components, and plain English UI.
- `apps/api`: Express, approval rules, example drafting, and sandbox payments.
- `packages/shared`: Zod validation, quote types, and exact money parsing.
- `scripts`: portable Windows runtime and startup commands.

Runtime data is stored in `work/agree-first.sqlite`. Override it with
`AGREE_FIRST_DATABASE_PATH`. The server binds to loopback; `PORT` defaults to
3001. The development frontend uses 4200 and proxies API calls to 3001.

This is a single-freelancer local prototype. Customer view is a local review page,
not an externally accessible customer portal. Accounts, teams, emails, taxes,
deposits, refunds, and extra-work payments are outside this version.

## Hackathon status

Target effort: 25–35 hours at 5–10 hours per week. Maximum experiment budget:
EUR 30; no spending is authorized. Competitive prizes are not predictable income.

The checked deadline is 12 November 2026 at 12:00 PST / 21:00 Europe/Amsterdam.
Recheck the [official rules](https://paypalaihackathon.devpost.com/rules) and
[overview](https://paypalaihackathon.devpost.com/) before submission.

See `temp/todo.md` for progress and the submission checklist, and `AGENTS.md` for
workspace instructions. Sandbox checkout and live AI have been demonstrated locally. The submission checklist still needs completion. No publishing,
deployment, account creation, registration, or contest submission was performed.



## Verification recorded

The production build and typecheck pass. All 106 backend, 25 frontend, and 25 local connection tests pass, and the
desktop/mobile browser scenarios have been verified, including question editing after saves and payment
recovery after reload. Live preview desktop/mobile layouts were inspected.
On 14 October 2026, the user completed sandbox checkout; the API stores a matching EUR 450.00 payment receipt with order/capture references. Live Astropods drafting and effort comparison have also been verified on a separate dummy draft; its final price remained unchanged.









