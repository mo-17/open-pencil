# Lowcode Demo Fixtures

Generated `.fig` examples for manual lowcode and layout round-trip verification.

| File                               | Purpose                                                                                     | Generator                                            |
| ---------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `lowcode-v5-test.fig`              | Switch, radio, and checkbox-group interaction smoke doc.                                    | `tools/lowcode/src/make/v5-testdoc.ts`               |
| `lowcode-v6-test.fig`              | Empty interactive nodes for property-panel authoring checks.                                | `tools/lowcode/src/make/v6-testdoc.ts`               |
| `lowcode-v7-test.fig`              | Figma-compatible child FILL layout verification.                                            | `tools/lowcode/src/make/v7-testdoc.ts`               |
| `lowcode-realmachine-test.fig`     | Combined real-machine lowcode verification for responsive, components, i18n, and workflows. | `tools/lowcode/src/make/realmachine-testdoc.ts`      |
| `lowcode-onboarding-demo.fig`      | User-facing onboarding demo for Supabase, validation, workflows, Stripe checkout, analytics consent copy, i18n, and head/CSS metadata. | `tools/lowcode/src/make/onboarding-demo.ts`          |
| `layout-roundtrip-test.fig`        | Manual layout round-trip verification for known `.fig` layout fields.                       | `tools/lowcode/src/make/layout-roundtrip-testdoc.ts` |
| `fig-layout-roundtrip-findings.md` | Historical investigation notes for layout round-trip bugs.                                  | n/a                                                  |

Regenerate a fixture from the repo root with its matching generator, for example:

```sh
bun tools/lowcode/src/make/v7-testdoc.ts
bun tools/lowcode/src/make/onboarding-demo.ts
```

The onboarding demo's `Start checkout` button points at `/api/demo-checkout`. A matching
server-side Supabase Edge Function example lives at
`supabase/functions/demo-checkout/index.ts`. Configure Stripe secrets only in that function's
environment variables; do not copy them into `.fig` files or generated SPA source. When the
generated app sends a Supabase bearer token, the template verifies the user, creates or reuses a
Stripe Customer, upserts `billing_customers`, and passes `customer` to Checkout. Anonymous demo
calls still fall back to `customer_email`. Set `STRIPE_CHECKOUT_MODE=payment` for one-time prices;
the template defaults to `subscription` to match the webhook and portal examples.

The Stripe customer portal example lives at
`supabase/functions/demo-customer-portal/index.ts`. Point a `stripeCustomerPortal` action at it
when you need a server-created billing portal session. It verifies the caller through Supabase
Auth and reads `billing_customers.stripe_customer_id` with a server-side service role key instead
of trusting a browser-sent `customerId`.

The minimal Supabase billing schema example lives at `supabase/schema/billing.sql`. It creates
`billing_customers`, `billing_subscriptions`, `billing_entitlements`, `billing_invoices`,
`billing_tax_summaries`, `billing_usage_summaries`, `billing_payments`, `billing_refunds`, `billing_disputes`,
`billing_orders`, and `billing_events` with a unique Stripe event id for durable webhook
idempotency. It also includes service-role RPC helpers for subscription, entitlement, invoice, tax
summary, usage summary, payment, refund, dispute, and order read-model updates. Apply and adapt it
manually before replacing the demo hooks in the checkout,
customer-portal, or webhook functions.
Stripe can deliver related webhook events out of order, so cross-event read-model ids such as
invoice subscription ids and refund payment intent ids are stored as text rather than blocking on
foreign keys to events that may not have arrived yet.

The companion Stripe webhook example lives at
`supabase/functions/demo-stripe-webhook/index.ts`. Register it in the Stripe dashboard as a
server-side webhook endpoint for `checkout.session.completed` and
`customer.subscription.*`, `invoice.*`, `payment_intent.*`, `charge.refunded`, and
`charge.dispute.*` events. It verifies `Stripe-Signature` with `STRIPE_WEBHOOK_SECRET` from the
Edge Function environment, records events in `billing_events` with the server-side Supabase
service role key, and treats duplicate event primary-key conflicts as Stripe retry duplicates.
Subscription lifecycle events call the schema's `record_stripe_subscription_event` RPC so the
event insert and subscription upsert happen in one transaction; invoice events also upsert minimal
tax and usage summaries from Stripe `automatic_tax`, `total_taxes`, and invoice `lines.data`.
If production invoices can contain more line items than the webhook payload includes, fetch the
remaining invoice lines server-side before treating usage rows as complete. Payment, refund, and
dispute events call their matching RPCs so billing history and dispute status stay queryable.
