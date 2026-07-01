---
title: Lowcode Apps
description: Turn OpenPencil pages into React apps with preview, Supabase, workflows, i18n, shadcn/ui, build, and deploy.
---

# Lowcode Apps

OpenPencil can turn design pages into runnable React + TypeScript + Tailwind apps. Use it when a design needs to become a working static SPA with state, forms, API calls, Supabase data, i18n, and deployable output.

Lowcode apps build on normal OpenPencil documents. You still draw frames, text, buttons, inputs, images, components, and auto-layout as usual; the lowcode panels add behavior on top of those nodes.

## What You Can Build

- Marketing pages, product pages, dashboards, forms, and data views.
- Multi-page SPAs with `react-router-dom` routes.
- Controlled forms with validation, remote validators, and submission workflows.
- Supabase-backed apps with auth, table queries, mutations, and storage uploads.
- Local document state and page state for filters, toggles, counters, and UI state.
- i18n-ready apps with locale catalogs, RTL direction handling, and a locale switcher.
- Analytics-ready apps with GA4, Plausible, or PostHog runtime setup and event tracking actions.
- Controlled custom head/CSS output for static meta/link/style tags and final CSS overrides.
- shadcn/ui-based output for supported interactive controls.
- Static bundles deployable to Netlify, Vercel, Cloudflare Pages, or any SPA host.

## Desktop vs Browser

| Capability | Desktop app | Browser app |
|------------|-------------|-------------|
| Edit design and lowcode properties | Yes | Yes |
| Live lowcode preview pane | Yes | No, preview sidecar is desktop-only |
| Deploy controls in the preview pane | Yes | No |
| CLI compile/build/deploy | Yes, from your terminal | Yes, from your terminal |
| MCP/agent control of a running document | Yes | Limited by the connected tool |

For browser-only use, keep editing in the web app and run `openpencil compile`, `openpencil build`, or `openpencil deploy` against the saved `.fig` / `.pen` file from your terminal.

## Authoring Flow

1. Design the page with regular OpenPencil nodes.
2. Use the Design panel to add lowcode behavior:
   - **State** for document or node-local values.
   - **Bindings** for text, form values, visibility, list data, and render conditions.
   - **Events** for clicks, form submit, navigation, API calls, Supabase actions, and workflows.
   - **Validation** for required fields, numeric/text rules, and remote validators.
   - **Responsive** overrides for breakpoint-specific layout and visibility.
3. Open the lowcode preview pane in the desktop app.
4. Choose preview options such as UI kit or i18n target locales.
5. Build or deploy when the preview behaves correctly.

## First Successful Path

For a first test, keep the app tiny:

1. Create one page with a frame, a text node, one input, and one button.
2. Bind the input to document state, for example `email`.
3. Add a required validation rule to the input.
4. Add a button click event that shows a toast or updates another state value.
5. Open the desktop preview pane and confirm the form state changes.
6. Run `openpencil build app.fig -o dist`.
7. Deploy the `dist` folder or run `openpencil deploy` with a provider token.

This path proves the core loop before you add Supabase, workflows, multiple pages, or i18n.

## Preview

The desktop preview pane compiles the current page into a local React app and reloads when the design changes. It also includes a canvas-to-preview bridge, so selecting compatible nodes can keep the design and preview surfaces aligned.

Preview options:

- **UI kit** — choose plain Tailwind output or shadcn/ui output for supported controls.
- **i18n** — enable the i18n runtime and enter target locales such as `fr,ar`.
- **Deploy** — use the deploy controls when you are ready to publish.

The preview pane is Tauri-only because it starts a local compiler dev server sidecar.

## Compile Source

Use `compile` when you want a full editable project:

```sh
openpencil compile app.fig -o generated-app
cd generated-app
npm install
npm run dev
```

Useful flags:

```sh
openpencil compile app.fig -o generated-app --page "Landing"
openpencil compile app.fig -o generated-app --ui-kit shadcn
openpencil compile app.fig -o generated-app --i18n --locale fr --locale ar
openpencil compile app.fig -o generated-app --source-locale ar
```

`--page` restricts output to one page. Without it, OpenPencil emits a multi-page app using `react-router-dom`.

## Build a Static Bundle

Use `build` when you want production-ready static files:

```sh
openpencil build app.fig -o dist
```

For sub-path hosting:

```sh
openpencil build app.fig -o dist --base /my-app/
```

For Supabase-backed apps, production credentials should come from the environment or command flags:

```sh
VITE_SUPABASE_URL=https://example.supabase.co \
VITE_SUPABASE_ANON_KEY=... \
openpencil build app.fig -o dist
```

or:

```sh
openpencil build app.fig -o dist \
  --supabase-url https://example.supabase.co \
  --supabase-anon-key ...
```

The emitted app uses design-time Supabase values only as a fallback. Prefer environment-specific values for staging and production.

## Analytics

Lowcode analytics is document-level configuration plus event/workflow actions. Configure the root document with a provider and public tracking id, then add `trackEvent` actions to click, submit, or workflow chains.

Supported providers:

- **GA4** — use your measurement id, for example `G-...`.
- **Plausible** — use the tracked domain as the id; optionally set a self-hosted script endpoint.
- **PostHog** — use the project API key; optionally set a self-hosted API host.

When analytics is enabled, generated apps emit `src/_lowcode_analytics.ts`, load the provider script, and send an initial `page_view`. Multi-page apps can also send `page_view` on route changes. Turn off **Track page views** when you only want explicit `trackEvent` actions.

Privacy gates are available on the document Analytics panel:

- **Respect Do Not Track** keeps provider scripts unloaded and events no-op when the browser reports DNT.
- **Require consent before tracking** keeps analytics no-op until consent is granted. Generated apps include a small preference center for this mode: **Necessary** is always active, while **Analytics** controls page views and explicit `trackEvent` calls. **Accept all** calls `__opGrantAnalyticsConsent()` and persists a provider-scoped grant in `localStorage`; **Decline all** calls `__opRevokeAnalyticsConsent()` and persists a denial; **Save preferences** stores the current Analytics category choice. The banner leaves an **Analytics preferences** button so users can reopen and change the choice later. The Analytics panel can also override the banner body copy, Analytics category description, privacy-policy link, whether the Analytics category starts checked before the user saves a preference, and an EEA-style opt-in starter preset. The preset only changes generated default behavior; confirm final compliance requirements with your own legal/product review. You can call those helpers from your own generated app flow if you replace the default banner with a custom preference experience.

Analytics ids are public client-side identifiers, not secrets. Do not put server-side API keys, write keys, or provider admin tokens in the document.

## Paid Actions

Use a **Stripe checkout** action when a button should start a paid checkout flow. The generated
app does not talk to Stripe directly. It sends a `POST` request to your own server endpoint,
passes any authored payload fields as JSON, and redirects to the returned `url` or `checkoutUrl`.

Use a **Stripe customer portal** action when a signed-in customer should manage billing. It uses
the same author-owned endpoint pattern, but redirects to the returned `url` or `portalUrl`.

Author the action with:

- **Endpoint** — a root-relative or `http(s)` endpoint, with optional lowcode template values such
  as `/api/${priceId}/checkout`.
- **Payload entries** — JSON fields such as `priceId` or `quantity`; each value is a lowcode
  expression.
- **Error target** — optional document state that receives request/response failures.

Keep all Stripe secret keys, webhook signing secrets, idempotency, subscription lifecycle, portal
session creation, and customer lookup on your backend, such as a Supabase Edge Function or your
own API route. The document and generated SPA should contain only public business parameters like
price ids, quantities, plan names, or the current user's public/customer mapping token.

The onboarding demo includes a server-side template at
`packages/demos/lowcode/supabase/functions/demo-checkout/index.ts`. It expects these environment
variables on the Edge Function, not in the lowcode document:

- `STRIPE_SECRET_KEY`
- `PUBLIC_SITE_URL`
- `STRIPE_PRICE_STARTER`
- `STRIPE_PRICE_PRO`
- `STRIPE_PRICE_ENTERPRISE`
- `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` when you want authenticated checkout to create or
  reuse a server-side `billing_customers` mapping.
- `STRIPE_CHECKOUT_MODE`, optional; defaults to `subscription`, set it to `payment` for one-time
  Checkout prices.

The template posts to Stripe's Checkout Sessions API and returns `{ url }`, which is the response
shape the lowcode `stripeCheckout` action redirects to. If the request includes a Supabase bearer
token, the template verifies the user, creates or reuses a Stripe Customer, upserts
`billing_customers`, and passes `customer` to Stripe Checkout. Anonymous demo calls still use
`customer_email` only.

For customer billing management, the demo folder includes a server-side portal template at
`packages/demos/lowcode/supabase/functions/demo-customer-portal/index.ts`. A generated
`stripeCustomerPortal` action can call that endpoint and redirect to the returned `{ url }` or
`{ portalUrl }`. The template verifies the caller through Supabase Auth and reads
`billing_customers.stripe_customer_id` with `SUPABASE_SERVICE_ROLE_KEY`; production endpoints must
keep that service role key server-side and must not trust a browser-sent customer id.

For durable billing state, start from
`packages/demos/lowcode/supabase/schema/billing.sql`. It defines `billing_customers`,
`billing_subscriptions`, `billing_entitlements`, `billing_invoices`, `billing_payments`,
`billing_refunds`, `billing_disputes`, `billing_tax_summaries`, `billing_usage_summaries`,
`billing_orders`, and `billing_events`; the `billing_events.stripe_event_id` primary key is the
webhook template's durable idempotency guard. The schema also includes service-role RPC helpers for
subscription, entitlement, invoice, tax summary, usage summary, payment, refund, dispute, and order
read-model updates. Stripe can deliver related webhooks out of order, so cross-event read-model ids
are stored as text instead of requiring foreign keys to subscription or payment rows that may not
exist yet. Adapt the schema to your product's order/subscription model before live use.

The demo folder also includes a server-side webhook template at
`packages/demos/lowcode/supabase/functions/demo-stripe-webhook/index.ts`. Register that endpoint in
the Stripe dashboard for `checkout.session.completed`, `customer.subscription.*`, `invoice.paid`,
`invoice.payment_failed`, `payment_intent.succeeded`, `payment_intent.payment_failed`, and
`charge.refunded`, `charge.dispute.created`, `charge.dispute.updated`, and `charge.dispute.closed`
events. The template verifies `Stripe-Signature` with `STRIPE_WEBHOOK_SECRET`, routes checkout,
subscription, invoice, payment, refund, and dispute lifecycle events, writes the event into
`billing_events` with `SUPABASE_SERVICE_ROLE_KEY`, and treats duplicate event primary-key conflicts
as Stripe retry duplicates. Subscription lifecycle events call `record_stripe_subscription_event`,
so the event insert, subscription upsert, and `billing_entitlements` refresh share one database
transaction. Invoice, payment, refund, and dispute events call matching RPCs so users can query
their own billing history, invoice tax summaries from `automatic_tax` / `total_taxes`, dispute
status, invoice line usage snapshots from `lines.data`, and a minimal `billing_orders` read model.
Production apps with invoices that can contain more line items than the webhook payload includes
should fetch the remaining invoice lines server-side before treating usage rows as complete.
Production apps with a richer order, tax, usage, or risk workflow should extend the same RPC-style
transaction boundary.

## Custom Head and CSS

Generated apps can carry document-level custom head metadata for static tags and CSS-only overrides:

- `<meta>` entries with `name`, `property`, or `http-equiv`.
- `<link>` entries such as `preconnect`, `preload`, `stylesheet`, or icon links.
- Inline `<style>` CSS snippets in `index.html`.
- Custom CSS appended at the end of `src/index.css`, after generated theme and Tailwind source rules.

This is a controlled escape hatch. Do not use it for JavaScript: raw `<script>` tags, inline event handlers, and external JS modules are intentionally not emitted. The editor shows pre-deploy CSP hints for inline head styles, external stylesheet/preload links, and external resources referenced from custom CSS. For production, still confirm your host's CSP allows any custom stylesheet or inline style you add.

For a live deploy check, inspect the HTML response headers and browser console on the deployed
URL. Confirm custom `<link>` resources load, inline head styles are not blocked by CSP, and custom
app CSS appears after generated Tailwind/theme rules. If you use Netlify, Vercel, or Cloudflare
Pages header configuration, keep that configuration with the deployment so later CSP changes are
auditable.

## Deploy

Use `deploy` to build and upload in one command.

Netlify:

```sh
NETLIFY_AUTH_TOKEN=... \
openpencil deploy app.fig --provider netlify --site my-site
```

Vercel:

```sh
VERCEL_TOKEN=... \
openpencil deploy app.fig --provider vercel --site my-project
```

Cloudflare Pages:

```sh
CLOUDFLARE_API_TOKEN=... \
openpencil deploy app.fig \
  --provider cloudflare \
  --account-id <account-id> \
  --site my-pages-project
```

Cloudflare can also read the account id from `CLOUDFLARE_ACCOUNT_ID`, or from `--site <account>/<project>`.

Add `--json` in automation to receive the provider, deployment id, URL, and file count.

## Demo Checklist

The repository includes a user-facing onboarding fixture at
`packages/demos/lowcode/lowcode-onboarding-demo.fig`. Rebuild it from the repo root with:

```sh
bun tools/lowcode/src/make/onboarding-demo.ts
```

The fixture is intentionally safe to share: it uses an example Supabase URL/anon key, a Plausible
example domain, and a demo `/api/demo-checkout` endpoint so the compiler can verify Supabase
queries/mutations, validation, workflows, Stripe checkout and customer portal redirects, analytics
hooks, i18n, shadcn/ui output, and custom head/CSS without embedding real external credentials.
Replace those values before any live provider test.

Use this checklist when validating a lowcode document before sharing it:

- A preview opens in the desktop app and renders the selected page.
- A button click updates document state or triggers a workflow.
- A form shows validation errors and clears them after valid input.
- A Supabase list or query renders data with loading and error states.
- A Supabase mutation writes data and reports errors to a visible state target.
- A Stripe checkout action calls a mock or real server endpoint and redirects only when the
  response includes `url` or `checkoutUrl`.
- A Stripe customer portal action calls a mock or real authenticated server endpoint and redirects
  only when the response includes `url` or `portalUrl`.
- A workflow with optional parameters runs from at least one event.
- An analytics `trackEvent` action fires in preview/build output when a test provider id is configured.
- i18n mode emits the expected locale catalog and switches direction for RTL locales.
- shadcn/ui mode renders supported controls without losing design classes.
- `openpencil build app.fig -o dist` completes.
- A provider deploy returns a live URL, or the static `dist` folder works on your host with an SPA fallback to `index.html`.

## Current Boundaries

- Lowcode app output is a static React SPA, not SSR or SSG.
- Secrets must not be embedded in designs. Use Supabase anon keys and provider tokens through CLI flags or environment variables.
- Stripe checkout and customer portal actions are frontend triggers only. Put Stripe secret keys,
  webhooks, subscriptions, portal sessions, and customer lookup on your server endpoint.
- Analytics config is client-side only. Use public GA4 / Plausible / PostHog project ids, enable consent/DNT gates when required, and verify CSP requirements for your deployment.
- Custom head/CSS is static and CSS-only. JavaScript snippets are not emitted; review CSP for custom stylesheet or inline style usage.
- Browser editing works, but the live preview sidecar and deploy controls are desktop-only.
- Cloudflare deploys require an existing account id and Pages project name.
- For multi-page apps, your host must route unknown paths back to `index.html`.

## Common Fixes

- Preview says it is unavailable: use the desktop app; the sidecar is not available in the browser app.
- Supabase works in preview but not production: pass `--supabase-url` and `--supabase-anon-key`, or set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` before `build` / `deploy`.
- Analytics events do not appear: confirm the provider id, check that the host allows the provider script in CSP, and wait for the provider dashboard's normal ingestion delay.
- A deployed route returns 404 after refresh: configure the host as an SPA and route unknown paths to `index.html`.
- Cloudflare deploy fails before upload: pass `--account-id`, set `CLOUDFLARE_ACCOUNT_ID`, or use `--site <account>/<project>`.
- i18n output has missing translations: inspect the emitted `src/locales/_coverage.json` and fill the target locale catalog.
