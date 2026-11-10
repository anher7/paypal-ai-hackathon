# Hosted demo

Public URL: https://agree-first.tameforum1.chatgpt.site

The cloud build preserves the Angular interface and quote/payment service. A Cloudflare Worker serves the interface and API. Cloudflare D1 stores each quote and its payment attempts together, with a server-side lease preventing concurrent writes across Worker instances.

## Visitor workspaces

Each browser receives a random Secure, HttpOnly, SameSite=Lax cookie. The database stores a SHA-256 workspace identifier; every quote read and write checks this identifier. Visitors cannot list, read or change another workspace's quotes. Reopening the app in the same browser restores its workspace. Clearing cookies loses access to that demo workspace. The demo is intended for dummy information and supports 20 quotes per workspace.

Customer review currently runs in the same browser workspace. Sending a review URL to another browser does not grant access; authenticated customer sharing remains future work.

## Payment and AI

Only the PayPal sandbox endpoint is used. The original approval revision, amount verification, customer consent and receipt checks remain in the shared service. The Worker checkpoints payment intent and capture state to D1 before calling PayPal, and saves state even when a provider call reports an error. A lease token fences out stale requests.

Configure these private runtime environment variables in Sites before enabling live integrations:

- `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`; optional `PAYPAL_MERCHANT_ID`
- `ASTRO_GATEWAY_URL`, `ASTRO_GATEWAY_API_KEY`; optional `ASTRO_GATEWAY_EXPIRES_AT`, `MODEL_DEFAULT`
- Optional `HOSTED_AI_DAILY_LIMIT`, default 40, bounded to 1–100 calls for the entire demo per UTC day.

No server credentials are included in the source, build or frontend. Without configured keys the labeled sample and manual quote workflow remain available; the app accurately reports that live AI and checkout need setup. Do not describe the sample as a live model call or a successful payment.

Live AI is additionally limited to eight calls per workspace per UTC day. All mutations are limited by client IP; new quotes also have a daily limit. Expired rate-limit rows are removed in bounded batches when a new quote is created. These are demo limits, not a paid production service.

## Build and deploy

Use Node 22.23.3 and `npm ci`, then `npm run build`. The build emits the local Express application and `dist/server/index.js`, a Cloudflare Worker ES module containing the production Angular assets. `.openai/hosting.json` declares the Sites project and D1 binding. The `drizzle/` migration is applied during deployment, never inside a request.

`npm run typecheck:hosted` and `npm run test:hosted` check the hosted adapter. `npm run verify` also runs the existing API, frontend and browser suites. Keep generated assets, local database files, `.env`, temporary folders and AGENTS files out of Git.

The CLI development gateway key is temporary. For unattended judging, configure a dedicated gateway key that remains valid through the judging period; copying a development key does not extend its expiry. Credential values stay in private Sites runtime secrets.
