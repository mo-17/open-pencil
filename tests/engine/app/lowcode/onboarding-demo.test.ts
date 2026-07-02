import { describe, expect, test } from 'bun:test'

import {
  buildLowcodeOnboardingDemo,
  compileLowcodeOnboardingDemo
} from '#tools/lowcode/src/make/onboarding-demo'

const CHECKOUT_FUNCTION_PATH = 'packages/demos/lowcode/supabase/functions/demo-checkout/index.ts'
const CUSTOMER_PORTAL_FUNCTION_PATH =
  'packages/demos/lowcode/supabase/functions/demo-customer-portal/index.ts'
const WEBHOOK_FUNCTION_PATH =
  'packages/demos/lowcode/supabase/functions/demo-stripe-webhook/index.ts'
const BILLING_SCHEMA_PATH = 'packages/demos/lowcode/supabase/schema/billing.sql'

describe('lowcode onboarding demo fixture', () => {
  test('covers the documented onboarding capabilities without external secrets', () => {
    const graph = buildLowcodeOnboardingDemo()
    const root = graph.getNode(graph.rootId)

    expect(root?.lowcodeSupabaseConfig).toEqual({
      url: 'https://example.supabase.co',
      anonKey: 'eyJ.onboarding-demo.anon'
    })
    expect(root?.lowcodeAnalyticsConfig).toMatchObject({
      provider: 'plausible',
      id: 'example.com',
      pageViews: false,
      respectDoNotTrack: true,
      consentRegionPreset: 'eea',
      consentRequired: true,
      consentAnalyticsDefault: false,
      consentCopy: {
        bannerText: 'OpenPencil demo uses privacy-friendly analytics for onboarding events.',
        analyticsDescription: 'Optional demo analytics for page views and button clicks.',
        privacyPolicyUrl: '/privacy',
        privacyPolicyLabel: 'Demo privacy notes'
      }
    })
    expect(root?.lowcodeDocumentState?.map((state) => state.name).sort()).toEqual([
      'category',
      'checkoutError',
      'email',
      'fullName',
      'plan',
      'portalError',
      'status'
    ])
    expect(root?.lowcodeTranslations?.['zh-CN']?.['Create lead']).toBe('创建线索')
    expect(root?.lowcodeHeadMetadata?.meta?.length).toBeGreaterThan(0)
    expect(root?.lowcodeCustomCss).toContain('.onboarding-demo')
    const checkoutButton = [...graph.getAllNodes()].find(
      (node) => node.name === 'Start checkout button'
    )
    expect(checkoutButton?.events?.onClick?.[0]).toMatchObject({
      kind: 'stripeCheckout',
      endpoint: '/api/demo-checkout',
      errorTarget: 'checkoutError'
    })
    const portalButton = [...graph.getAllNodes()].find(
      (node) => node.name === 'Open billing portal button'
    )
    expect(portalButton?.events?.onClick?.[0]).toMatchObject({
      kind: 'stripeCustomerPortal',
      endpoint: '/api/demo-customer-portal',
      errorTarget: 'portalError'
    })
  })

  test('compiles into validation, Supabase, Stripe checkout, analytics, i18n, and shadcn runtime files', () => {
    const out = compileLowcodeOnboardingDemo()
    expect(out.warnings).toEqual([])
    expect(out.files.has('src/_lowcode_supabase.ts')).toBe(true)
    expect(out.files.has('src/_lowcode_validation.tsx')).toBe(true)
    expect(out.files.has('src/_lowcode_analytics.ts')).toBe(true)
    expect(out.files.has('src/_lowcode_toast.tsx')).toBe(true)
    expect(out.files.has('src/_lowcode_i18n.tsx')).toBe(true)
    expect(out.files.has('src/locales/zh-CN.json')).toBe(true)
    expect(out.files.has('src/components/ui/button.tsx')).toBe(true)

    const app = out.files.get('src/App.tsx') as string
    expect(app).toContain('getSupabaseClient().from("products").select("id,name,price,category")')
    expect(app).toContain('getSupabaseClient().from("leads").insert')
    expect(app).toContain('validateValue')
    expect(app).toContain('fetch("/api/demo-checkout"')
    expect(app).toContain('window.location.assign(nextUrl.toString())')
    expect(app).toContain('fetch("/api/demo-customer-portal"')
    expect(app).toContain('const portalUrl = data?.url ?? data?.portalUrl')
    expect(app).toContain('stripeCustomerPortal response url must be http(s)')
    expect(app).toContain('__opTrackEvent("checkout_start"')
    expect(app).toContain('__opTrackEvent("billing_portal_open"')
    expect(app).toContain('__opTrackEvent("lead_submit"')
    expect(app).toContain('__opTrackEvent("product_interest"')
    expect(app).not.toContain('sk_test')
    expect(app).not.toContain('sk_live')

    const analytics = out.files.get('src/_lowcode_analytics.ts') as string
    expect(analytics).toContain('"consentRegionPreset": "eea"')
    expect(analytics).toContain('"consentRequired": true')
    expect(analytics).toContain('"consentAnalyticsDefault": false')
    expect(analytics).toContain('OpenPencil demo uses privacy-friendly analytics')
    expect(analytics).toContain('"privacyPolicyUrl": "/privacy"')
    expect(analytics).toContain('export function __opGrantAnalyticsConsent()')

    const html = out.files.get('index.html') as string
    expect(html).toContain('<title>OpenPencil Lowcode Demo</title>')
    expect(html).toContain('theme-color')
  })

  test('ships a server-side checkout template without embedded Stripe secrets', async () => {
    const source = await Bun.file(CHECKOUT_FUNCTION_PATH).text()
    expect(source).toContain("env('STRIPE_SECRET_KEY')")
    expect(source).toContain("env('SUPABASE_URL')")
    expect(source).toContain("env('SUPABASE_SERVICE_ROLE_KEY')")
    expect(source).toContain('Deno.env.get(name)')
    expect(source).toContain('function supabaseUrl()')
    expect(source).toContain("new URL(env('SUPABASE_URL'))")
    expect(source).toContain('SUPABASE_URL must be an http(s) URL')
    expect(source).toContain('STRIPE_CHECKOUT_MODE')
    expect(source).toContain("mode: checkoutMode()")
    expect(source).toContain("['payment', 'subscription']")
    expect(source).toContain('optionalAuthenticatedUser(request)')
    expect(source).toContain('/auth/v1/user')
    expect(source).toContain('/rest/v1/billing_customers?')
    expect(source).toContain('/rest/v1/billing_customers?on_conflict=user_id')
    expect(source).toContain('createStripeCustomer')
    expect(source).toContain('/customers')
    expect(source).toContain("body.set('customer', customerId)")
    expect(source).toContain("body.set('customer_email', email)")
    expect(source).toContain('Anonymous demo')
    expect(source).toContain('STRIPE_PRICE_')
    expect(source).toContain('checkout/sessions')
    expect(source).toContain('function publicSiteUrl()')
    expect(source).toContain("env('PUBLIC_SITE_URL')")
    expect(source).toContain("siteUrl.protocol !== 'http:'")
    expect(source).toContain("siteUrl.protocol !== 'https:'")
    expect(source).toContain('PUBLIC_SITE_URL must be an http(s) URL')
    expect(source).toContain("success_url: new URL('/checkout/success', siteUrl).toString()")
    expect(source).toContain("cancel_url: new URL('/checkout/cancel', siteUrl).toString()")
    expect(source).toContain('return json({ url })')
    expect(source).not.toContain('sk_test')
    expect(source).not.toContain('sk_live')
  })

  test('ships a server-side customer portal template without embedded Stripe secrets', async () => {
    const source = await Bun.file(CUSTOMER_PORTAL_FUNCTION_PATH).text()
    expect(source).toContain("env('STRIPE_SECRET_KEY')")
    expect(source).toContain("env('PUBLIC_SITE_URL')")
    expect(source).toContain("env('SUPABASE_URL')")
    expect(source).toContain("env('SUPABASE_SERVICE_ROLE_KEY')")
    expect(source).toContain('Deno.env.get(name)')
    expect(source).toContain('function supabaseRestConfig()')
    expect(source).toContain("new URL(env('SUPABASE_URL'))")
    expect(source).toContain('SUPABASE_URL must be an http(s) URL')
    expect(source).toContain('Authorization bearer token required')
    expect(source).toContain('/auth/v1/user')
    expect(source).toContain('/rest/v1/billing_customers?')
    expect(source).toContain("select: 'stripe_customer_id'")
    expect(source).toContain('lookupStripeCustomerId(user)')
    expect(source).toContain('billing_portal/sessions')
    expect(source).toContain('customer: customerId')
    expect(source).toContain('function publicSiteUrl()')
    expect(source).toContain("siteUrl.protocol !== 'http:'")
    expect(source).toContain("siteUrl.protocol !== 'https:'")
    expect(source).toContain('PUBLIC_SITE_URL must be an http(s) URL')
    expect(source).toContain('return_url: portalReturnUrl(input)')
    expect(source).toContain('return json({ url })')
    expect(source).toContain('do not trust a customerId sent from the browser')
    expect(source).toContain('STRIPE_PORTAL_CONFIGURATION')
    expect(source).toContain('supabase/schema/billing.sql')
    expect(source).not.toContain('DEMO_STRIPE_CUSTOMER_ID')
    expect(source).not.toContain('sk_test')
    expect(source).not.toContain('sk_live')
    expect(source).not.toContain('whsec_')
  })

  test('ships a server-side Stripe webhook template without embedded secrets', async () => {
    const source = await Bun.file(WEBHOOK_FUNCTION_PATH).text()
    expect(source).toContain("env('STRIPE_WEBHOOK_SECRET')")
    expect(source).toContain('Stripe-Signature')
    expect(source).toContain('crypto.subtle.importKey')
    expect(source).toContain('checkout.session.completed')
    expect(source).toContain('customer.subscription.created')
    expect(source).toContain('customer.subscription.updated')
    expect(source).toContain('customer.subscription.deleted')
    expect(source).toContain('invoice.paid')
    expect(source).toContain('invoice.payment_failed')
    expect(source).toContain('payment_intent.succeeded')
    expect(source).toContain('payment_intent.payment_failed')
    expect(source).toContain('charge.refunded')
    expect(source).toContain('charge.dispute.created')
    expect(source).toContain('charge.dispute.updated')
    expect(source).toContain('charge.dispute.closed')
    expect(source).toContain("env('SUPABASE_URL')")
    expect(source).toContain("env('SUPABASE_SERVICE_ROLE_KEY')")
    expect(source).toContain('function supabaseUrl()')
    expect(source).toContain("new URL(env('SUPABASE_URL'))")
    expect(source).toContain('SUPABASE_URL must be an http(s) URL')
    expect(source).toContain('/rest/v1/billing_events')
    expect(source).toContain('/rest/v1/rpc/record_stripe_subscription_event')
    expect(source).toContain('/rest/v1/rpc/record_stripe_invoice_event')
    expect(source).toContain('/rest/v1/rpc/record_stripe_payment_event')
    expect(source).toContain('/rest/v1/rpc/record_stripe_refund_event')
    expect(source).toContain('/rest/v1/rpc/record_stripe_dispute_event')
    expect(source).toContain('stripe_event_id: eventId')
    expect(source).toContain('p_stripe_subscription_id: subscription.id')
    expect(source).toContain('p_stripe_customer_id: subscription.customer')
    expect(source).toContain('p_current_period_end: stripeTimestampToIso')
    expect(source).toContain('p_stripe_invoice_id: invoice.id')
    expect(source).toContain('p_amount_paid: invoice.amount_paid')
    expect(source).toContain('p_automatic_tax_enabled: invoice.automatic_tax?.enabled')
    expect(source).toContain('p_tax_amount: sumInvoiceTaxAmount(invoice.total_taxes)')
    expect(source).toContain('p_total_taxes: invoice.total_taxes ?? []')
    expect(source).toContain('p_usage_lines: invoiceUsageLines(invoice)')
    expect(source).toContain('subscriptionItem: line.parent?.subscription_item_details?.subscription_item')
    expect(source).toContain('quantityDecimal: line.quantity_decimal ?? null')
    expect(source).toContain('p_hosted_invoice_url: invoice.hosted_invoice_url')
    expect(source).toContain('p_stripe_payment_intent_id: payment.id')
    expect(source).toContain('p_latest_charge_id: stripeId(payment.latest_charge)')
    expect(source).toContain('p_stripe_charge_id: charge.id')
    expect(source).toContain('p_stripe_payment_intent_id: stripeId(charge.payment_intent)')
    expect(source).toContain('p_amount_refunded: charge.amount_refunded')
    expect(source).toContain('p_stripe_dispute_id: dispute.id')
    expect(source).toContain('p_stripe_charge_id: stripeId(dispute.charge)')
    expect(source).toContain('p_evidence_due_by: stripeTimestampToIso(dispute.evidence_details?.due_by)')
    expect(source).toContain('payload: event')
    expect(source).toContain('response.status === 409')
    expect(source).toContain("return 'duplicate'")
    expect(source).toContain("case 'customer.subscription.created':")
    expect(source).toContain('if (!(await recordSubscriptionEvent(event, object as Subscription)))')
    expect(source).toContain('if (!(await recordDisputeEvent(event, object as Dispute)))')
    expect(source).not.toContain('const recorded = await recordBillingEvent(event, object)')
    expect(source).toContain('Authorization: `Bearer ')
    expect(source).toContain('serviceRoleKey}`')
    expect(source).toContain('schema before live use')
    expect(source).toContain('supabase/schema/billing.sql')
    expect(source).not.toContain('processedEventIds')
    expect(source).not.toContain('sk_test')
    expect(source).not.toContain('sk_live')
    expect(source).not.toContain('whsec_')
  })

  test('ships a durable Supabase billing schema template without embedded secrets', async () => {
    const source = await Bun.file(BILLING_SCHEMA_PATH).text()
    expect(source).toContain('create table if not exists public.billing_customers')
    expect(source).toContain('stripe_customer_id text not null unique')
    expect(source).toContain('create table if not exists public.billing_subscriptions')
    expect(source).toContain('create table if not exists public.billing_entitlements')
    expect(source).toContain('active boolean not null default false')
    expect(source).toContain('create table if not exists public.billing_invoices')
    expect(source).toContain('stripe_invoice_id text primary key')
    expect(source).toContain('hosted_invoice_url text')
    expect(source).toContain('create table if not exists public.billing_tax_summaries')
    expect(source).toContain('automatic_tax_enabled boolean')
    expect(source).toContain("total_taxes jsonb not null default '[]'::jsonb")
    expect(source).toContain('create table if not exists public.billing_usage_summaries')
    expect(source).toContain('stripe_invoice_line_id text primary key')
    expect(source).toContain('quantity_decimal text')
    expect(source).toContain("raw_line jsonb not null default '{}'::jsonb")
    expect(source).toContain('create table if not exists public.billing_payments')
    expect(source).toContain('stripe_payment_intent_id text primary key')
    expect(source).toContain('create table if not exists public.billing_refunds')
    expect(source).toContain('stripe_charge_id text primary key')
    expect(source).toContain('create table if not exists public.billing_disputes')
    expect(source).toContain('stripe_dispute_id text primary key')
    expect(source).toContain('evidence_due_by timestamptz')
    expect(source).toContain('create table if not exists public.billing_orders')
    expect(source).toContain('order_key text primary key')
    expect(source).toContain("fulfillment_status text not null default 'unfulfilled'")
    expect(source).toContain('create table if not exists public.billing_events')
    expect(source).toContain('stripe_event_id text primary key')
    expect(source).toContain('create or replace function public.record_stripe_subscription_event')
    expect(source).toContain('create or replace function public.record_stripe_invoice_event')
    expect(source).toContain('create or replace function public.record_stripe_payment_event')
    expect(source).toContain('create or replace function public.record_stripe_refund_event')
    expect(source).toContain('create or replace function public.record_stripe_dispute_event')
    expect(source).toContain('returns text')
    expect(source).toContain('security definer')
    expect(source).toContain('insert into public.billing_events')
    expect(source).toContain('insert into public.billing_subscriptions')
    expect(source).toContain('insert into public.billing_entitlements')
    expect(source).toContain('insert into public.billing_invoices')
    expect(source).toContain('insert into public.billing_tax_summaries')
    expect(source).toContain('insert into public.billing_usage_summaries')
    expect(source).toContain('insert into public.billing_payments')
    expect(source).toContain('insert into public.billing_refunds')
    expect(source).toContain('insert into public.billing_disputes')
    expect(source).toContain('insert into public.billing_orders')
    expect(source).toContain('on conflict (stripe_subscription_id) do update')
    expect(source).toContain('on conflict (stripe_invoice_id) do update')
    expect(source).toContain('on conflict (stripe_invoice_line_id) do update')
    expect(source).toContain('on conflict (stripe_payment_intent_id) do update')
    expect(source).toContain('on conflict (stripe_charge_id) do update')
    expect(source).toContain('on conflict (stripe_dispute_id) do update')
    expect(source).toContain("'invoice:' || p_stripe_invoice_id")
    expect(source).toContain("'payment:' || p_stripe_payment_intent_id")
    expect(source).toContain("'charge:' || p_stripe_charge_id")
    expect(source).toContain('on conflict (order_key) do update')
    expect(source).toContain("p_status in ('active', 'trialing')")
    expect(source).toContain('on conflict (user_id) do update')
    expect(source).toContain("return 'duplicate'")
    expect(source).toContain("return 'recorded'")
    expect(source).toContain('revoke all on function public.record_stripe_subscription_event')
    expect(source).toContain('revoke all on function public.record_stripe_dispute_event')
    expect(source).toContain('alter table public.billing_customers enable row level security')
    expect(source).toContain('billing_customers_select_own')
    expect(source).toContain('billing_subscriptions_select_own')
    expect(source).toContain('billing_entitlements_select_own')
    expect(source).toContain('billing_invoices_select_own')
    expect(source).toContain('billing_tax_summaries_select_own')
    expect(source).toContain('billing_usage_summaries_select_own')
    expect(source).toContain('billing_payments_select_own')
    expect(source).toContain('billing_refunds_select_own')
    expect(source).toContain('billing_disputes_select_own')
    expect(source).toContain('billing_orders_select_own')
    expect(source).toContain('service role key')
    expect(source).toContain('Stripe does not guarantee webhook delivery order')
    const invoicesTable = source.slice(
      source.indexOf('create table if not exists public.billing_invoices'),
      source.indexOf('create table if not exists public.billing_payments')
    )
    expect(invoicesTable).toContain('stripe_subscription_id text,')
    expect(invoicesTable).not.toContain('references public.billing_subscriptions')
    const refundsTable = source.slice(
      source.indexOf('create table if not exists public.billing_refunds'),
      source.indexOf('create table if not exists public.billing_orders')
    )
    expect(refundsTable).toContain('stripe_payment_intent_id text,')
    expect(refundsTable).not.toContain('references public.billing_payments')
    expect(source).not.toContain('sk_test')
    expect(source).not.toContain('sk_live')
    expect(source).not.toContain('whsec_')
  })
})
