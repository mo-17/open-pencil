// Supabase Edge Function example for Stripe webhook handling.
//
// Deploy this as a server-side endpoint and register its URL in the Stripe
// dashboard. Stripe webhook secrets must stay in Edge Function environment
// variables; never copy them into .fig files, generated SPA source,
// screenshots, or logs.
//
// Production note: apply `supabase/schema/billing.sql` or your own equivalent
// schema before live use. This template records every Stripe event in
// `billing_events`; if you also update orders/subscriptions, prefer a database
// RPC so the event insert and business updates happen in one transaction.

const SIGNATURE_TOLERANCE_SECONDS = 300

interface StripeEvent<T = Record<string, unknown>> {
  id?: string
  type?: string
  data?: {
    object?: T
  }
}

interface CheckoutSession {
  id?: string
  customer?: string
  customer_email?: string
  subscription?: string
  payment_status?: string
  metadata?: Record<string, string>
}

interface Subscription {
  id?: string
  customer?: string
  status?: string
  current_period_end?: number
  cancel_at_period_end?: boolean
  metadata?: Record<string, string>
}

interface Invoice {
  id?: string
  customer?: string
  subscription?: string
  automatic_tax?: {
    enabled?: boolean
    status?: string
    provider?: string
  }
  status?: string
  paid?: boolean
  amount_due?: number
  amount_paid?: number
  currency?: string
  hosted_invoice_url?: string
  invoice_pdf?: string
  period_start?: number
  period_end?: number
  total_taxes?: Array<{
    amount?: number
    tax_behavior?: string
    tax_rate_details?: {
      tax_rate?: string
    }
    taxability_reason?: string
    taxable_amount?: number
    type?: string
  }>
  lines?: {
    data?: InvoiceLineItem[]
  }
  metadata?: Record<string, string>
}

interface InvoiceLineItem {
  id?: string
  amount?: number
  currency?: string
  description?: string
  metadata?: Record<string, string>
  parent?: {
    type?: string
    subscription_item_details?: {
      subscription?: string
      subscription_item?: string
    }
  }
  period?: {
    start?: number
    end?: number
  }
  pricing?: {
    price_details?: {
      price?: string
      product?: string
    }
    type?: string
  }
  quantity?: number
  quantity_decimal?: string
}

interface PaymentIntent {
  id?: string
  customer?: string
  status?: string
  amount?: number
  currency?: string
  latest_charge?: string | { id?: string }
  receipt_email?: string
  metadata?: Record<string, string>
}

interface Charge {
  id?: string
  customer?: string
  payment_intent?: string | { id?: string }
  refunded?: boolean
  amount?: number
  amount_refunded?: number
  currency?: string
  receipt_url?: string
  metadata?: Record<string, string>
}

interface Dispute {
  id?: string
  charge?: string | { id?: string }
  payment_intent?: string | { id?: string }
  amount?: number
  currency?: string
  reason?: string
  status?: string
  created?: number
  evidence_details?: {
    due_by?: number
  }
  metadata?: Record<string, string>
}

type SupabaseHeaders = Record<string, string>

function corsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'stripe-signature, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(),
      'Content-Type': 'application/json'
    }
  })
}

function env(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`Missing required environment variable: ${name}`)
  return value
}

function parseStripeSignature(header: string): { timestamp: number; signatures: string[] } {
  let timestamp = 0
  const signatures: string[] = []
  for (const part of header.split(',')) {
    const [key, value] = part.split('=', 2)
    if (key === 't') timestamp = Number(value)
    if (key === 'v1' && value) signatures.push(value)
  }
  return { timestamp, signatures }
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function hmacSha256(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload))
  return hex(new Uint8Array(signature))
}

async function verifyStripeSignature(body: string, signatureHeader: string): Promise<void> {
  const secret = env('STRIPE_WEBHOOK_SECRET')
  const { timestamp, signatures } = parseStripeSignature(signatureHeader)
  if (!Number.isFinite(timestamp) || timestamp <= 0 || signatures.length === 0) {
    throw new Error('Invalid Stripe-Signature header')
  }
  const age = Math.abs(Date.now() / 1000 - timestamp)
  if (age > SIGNATURE_TOLERANCE_SECONDS) {
    throw new Error('Stripe-Signature timestamp is outside tolerance')
  }
  const expected = await hmacSha256(secret, `${timestamp}.${body}`)
  if (!signatures.some((candidate) => constantTimeEqual(candidate, expected))) {
    throw new Error('Stripe webhook signature verification failed')
  }
}

function stripeObjectId(object: unknown): string | null {
  return typeof object === 'object' && object !== null ? ((object as { id?: string }).id ?? null) : null
}

function supabaseRestConfig(): { url: string; headers: SupabaseHeaders } {
  const supabaseUrl = env('SUPABASE_URL').replace(/\/+$/, '')
  const serviceRoleKey = env('SUPABASE_SERVICE_ROLE_KEY')
  return {
    url: supabaseUrl,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json'
    }
  }
}

function stripeTimestampToIso(seconds: number | undefined): string | null {
  if (!seconds || !Number.isFinite(seconds)) return null
  return new Date(seconds * 1000).toISOString()
}

function stripeId(value: string | { id?: string } | undefined): string | null {
  if (typeof value === 'string') return value
  return value?.id ?? null
}

function sumInvoiceTaxAmount(totalTaxes: Invoice['total_taxes']): number | null {
  if (!Array.isArray(totalTaxes)) return null
  return totalTaxes.reduce((sum, tax) => {
    const amount = typeof tax.amount === 'number' && Number.isFinite(tax.amount) ? tax.amount : 0
    return sum + amount
  }, 0)
}

function invoiceUsageLines(invoice: Invoice): Record<string, unknown>[] {
  const lines = invoice.lines?.data ?? []
  return lines
    .filter((line) => line.id)
    .map((line) => ({
      id: line.id,
      amount: line.amount ?? null,
      currency: line.currency ?? invoice.currency ?? null,
      description: line.description ?? null,
      metadata: line.metadata ?? {},
      parentType: line.parent?.type ?? null,
      subscription: line.parent?.subscription_item_details?.subscription ?? invoice.subscription ?? null,
      subscriptionItem: line.parent?.subscription_item_details?.subscription_item ?? null,
      periodStart: stripeTimestampToIso(line.period?.start),
      periodEnd: stripeTimestampToIso(line.period?.end),
      price: line.pricing?.price_details?.price ?? null,
      product: line.pricing?.price_details?.product ?? null,
      pricingType: line.pricing?.type ?? null,
      quantity: line.quantity ?? null,
      quantityDecimal: line.quantity_decimal ?? null
    }))
}

async function recordBillingEvent(event: StripeEvent, object: unknown): Promise<boolean> {
  const eventId = event.id ?? ''
  if (!eventId) throw new Error('Stripe event is missing id')

  const supabase = supabaseRestConfig()
  const response = await fetch(`${supabase.url}/rest/v1/billing_events`, {
    method: 'POST',
    headers: {
      ...supabase.headers,
      Prefer: 'return=minimal'
    },
    body: JSON.stringify({
      stripe_event_id: eventId,
      event_type: event.type ?? 'unknown',
      object_id: stripeObjectId(object),
      payload: event
    })
  })

  if (response.status === 409) return false
  if (!response.ok) {
    const details = await response.text()
    throw new Error(`Failed to record Stripe event: ${response.status} ${details}`)
  }
  return true
}

async function recordSubscriptionEvent(event: StripeEvent, subscription: Subscription): Promise<boolean> {
  const eventId = event.id ?? ''
  if (!eventId) throw new Error('Stripe event is missing id')
  if (!subscription.id || !subscription.customer || !subscription.status) {
    throw new Error('Stripe subscription event is missing id, customer, or status')
  }

  const supabase = supabaseRestConfig()
  const response = await fetch(`${supabase.url}/rest/v1/rpc/record_stripe_subscription_event`, {
    method: 'POST',
    headers: supabase.headers,
    body: JSON.stringify({
      p_stripe_event_id: eventId,
      p_event_type: event.type ?? 'unknown',
      p_object_id: subscription.id,
      p_payload: event,
      p_stripe_subscription_id: subscription.id,
      p_stripe_customer_id: subscription.customer,
      p_status: subscription.status,
      p_current_period_end: stripeTimestampToIso(subscription.current_period_end),
      p_cancel_at_period_end: subscription.cancel_at_period_end ?? false,
      p_plan: subscription.metadata?.plan ?? null,
      p_metadata: subscription.metadata ?? {}
    })
  })

  if (!response.ok) {
    const details = await response.text()
    throw new Error(`Failed to record Stripe subscription event: ${response.status} ${details}`)
  }
  const result = (await response.json()) as string
  return result !== 'duplicate'
}

async function recordInvoiceEvent(event: StripeEvent, invoice: Invoice): Promise<boolean> {
  const eventId = event.id ?? ''
  if (!eventId) throw new Error('Stripe event is missing id')
  if (!invoice.id || !invoice.customer) {
    throw new Error('Stripe invoice event is missing id or customer')
  }

  const supabase = supabaseRestConfig()
  const response = await fetch(`${supabase.url}/rest/v1/rpc/record_stripe_invoice_event`, {
    method: 'POST',
    headers: supabase.headers,
    body: JSON.stringify({
      p_stripe_event_id: eventId,
      p_event_type: event.type ?? 'unknown',
      p_object_id: invoice.id,
      p_payload: event,
      p_stripe_invoice_id: invoice.id,
      p_stripe_customer_id: invoice.customer,
      p_stripe_subscription_id: invoice.subscription ?? null,
      p_status: invoice.status ?? null,
      p_paid: invoice.paid ?? false,
      p_amount_due: invoice.amount_due ?? null,
      p_amount_paid: invoice.amount_paid ?? null,
      p_currency: invoice.currency ?? null,
      p_automatic_tax_enabled: invoice.automatic_tax?.enabled ?? null,
      p_automatic_tax_status: invoice.automatic_tax?.status ?? null,
      p_automatic_tax_provider: invoice.automatic_tax?.provider ?? null,
      p_tax_amount: sumInvoiceTaxAmount(invoice.total_taxes),
      p_total_taxes: invoice.total_taxes ?? [],
      p_usage_lines: invoiceUsageLines(invoice),
      p_hosted_invoice_url: invoice.hosted_invoice_url ?? null,
      p_invoice_pdf: invoice.invoice_pdf ?? null,
      p_period_start: stripeTimestampToIso(invoice.period_start),
      p_period_end: stripeTimestampToIso(invoice.period_end),
      p_metadata: invoice.metadata ?? {}
    })
  })

  if (!response.ok) {
    const details = await response.text()
    throw new Error(`Failed to record Stripe invoice event: ${response.status} ${details}`)
  }
  const result = (await response.json()) as string
  return result !== 'duplicate'
}

async function recordPaymentEvent(event: StripeEvent, payment: PaymentIntent): Promise<boolean> {
  const eventId = event.id ?? ''
  if (!eventId) throw new Error('Stripe event is missing id')
  if (!payment.id || !payment.customer) {
    throw new Error('Stripe payment event is missing id or customer')
  }

  const supabase = supabaseRestConfig()
  const response = await fetch(`${supabase.url}/rest/v1/rpc/record_stripe_payment_event`, {
    method: 'POST',
    headers: supabase.headers,
    body: JSON.stringify({
      p_stripe_event_id: eventId,
      p_event_type: event.type ?? 'unknown',
      p_object_id: payment.id,
      p_payload: event,
      p_stripe_payment_intent_id: payment.id,
      p_stripe_customer_id: payment.customer,
      p_status: payment.status ?? null,
      p_amount: payment.amount ?? null,
      p_currency: payment.currency ?? null,
      p_latest_charge_id: stripeId(payment.latest_charge),
      p_receipt_email: payment.receipt_email ?? null,
      p_metadata: payment.metadata ?? {}
    })
  })

  if (!response.ok) {
    const details = await response.text()
    throw new Error(`Failed to record Stripe payment event: ${response.status} ${details}`)
  }
  const result = (await response.json()) as string
  return result !== 'duplicate'
}

async function recordRefundEvent(event: StripeEvent, charge: Charge): Promise<boolean> {
  const eventId = event.id ?? ''
  if (!eventId) throw new Error('Stripe event is missing id')
  if (!charge.id || !charge.customer) {
    throw new Error('Stripe refund event is missing charge id or customer')
  }

  const supabase = supabaseRestConfig()
  const response = await fetch(`${supabase.url}/rest/v1/rpc/record_stripe_refund_event`, {
    method: 'POST',
    headers: supabase.headers,
    body: JSON.stringify({
      p_stripe_event_id: eventId,
      p_event_type: event.type ?? 'unknown',
      p_object_id: charge.id,
      p_payload: event,
      p_stripe_charge_id: charge.id,
      p_stripe_customer_id: charge.customer,
      p_stripe_payment_intent_id: stripeId(charge.payment_intent),
      p_refunded: charge.refunded ?? false,
      p_amount: charge.amount ?? null,
      p_amount_refunded: charge.amount_refunded ?? null,
      p_currency: charge.currency ?? null,
      p_receipt_url: charge.receipt_url ?? null,
      p_metadata: charge.metadata ?? {}
    })
  })

  if (!response.ok) {
    const details = await response.text()
    throw new Error(`Failed to record Stripe refund event: ${response.status} ${details}`)
  }
  const result = (await response.json()) as string
  return result !== 'duplicate'
}

async function recordDisputeEvent(event: StripeEvent, dispute: Dispute): Promise<boolean> {
  const eventId = event.id ?? ''
  if (!eventId) throw new Error('Stripe event is missing id')
  if (!dispute.id || !dispute.charge) {
    throw new Error('Stripe dispute event is missing dispute id or charge')
  }

  const supabase = supabaseRestConfig()
  const response = await fetch(`${supabase.url}/rest/v1/rpc/record_stripe_dispute_event`, {
    method: 'POST',
    headers: supabase.headers,
    body: JSON.stringify({
      p_stripe_event_id: eventId,
      p_event_type: event.type ?? 'unknown',
      p_object_id: dispute.id,
      p_payload: event,
      p_stripe_dispute_id: dispute.id,
      p_stripe_charge_id: stripeId(dispute.charge),
      p_stripe_payment_intent_id: stripeId(dispute.payment_intent),
      p_status: dispute.status ?? null,
      p_reason: dispute.reason ?? null,
      p_amount: dispute.amount ?? null,
      p_currency: dispute.currency ?? null,
      p_created_at: stripeTimestampToIso(dispute.created),
      p_evidence_due_by: stripeTimestampToIso(dispute.evidence_details?.due_by),
      p_metadata: dispute.metadata ?? {}
    })
  })

  if (!response.ok) {
    const details = await response.text()
    throw new Error(`Failed to record Stripe dispute event: ${response.status} ${details}`)
  }
  const result = (await response.json()) as string
  return result !== 'duplicate'
}

async function logBillingEventProjection(eventId: string, type: string, object: unknown): Promise<void> {
  console.log('stripe webhook handled', {
    eventId,
    type,
    objectId: stripeObjectId(object)
  })
}

async function handleCheckoutCompleted(session: CheckoutSession): Promise<void> {
  await logBillingEventProjection(session.id ?? 'unknown_checkout_session', 'checkout.session.completed', {
    id: session.id,
    customer: session.customer,
    customer_email: session.customer_email,
    subscription: session.subscription,
    payment_status: session.payment_status,
    plan: session.metadata?.plan
  })
}

async function handleSubscriptionEvent(type: string, subscription: Subscription): Promise<void> {
  await logBillingEventProjection(subscription.id ?? 'unknown_subscription', type, {
    id: subscription.id,
    customer: subscription.customer,
    status: subscription.status,
    current_period_end: subscription.current_period_end,
    cancel_at_period_end: subscription.cancel_at_period_end,
    plan: subscription.metadata?.plan
  })
}

async function handleInvoiceEvent(type: string, invoice: Invoice): Promise<void> {
  await logBillingEventProjection(invoice.id ?? 'unknown_invoice', type, {
    id: invoice.id,
    customer: invoice.customer,
    subscription: invoice.subscription,
    status: invoice.status,
    paid: invoice.paid,
    amount_due: invoice.amount_due,
    amount_paid: invoice.amount_paid,
    currency: invoice.currency,
    tax_amount: sumInvoiceTaxAmount(invoice.total_taxes)
  })
}

async function handlePaymentEvent(type: string, payment: PaymentIntent): Promise<void> {
  await logBillingEventProjection(payment.id ?? 'unknown_payment_intent', type, {
    id: payment.id,
    customer: payment.customer,
    status: payment.status,
    amount: payment.amount,
    currency: payment.currency,
    latest_charge: stripeId(payment.latest_charge)
  })
}

async function handleRefundEvent(type: string, charge: Charge): Promise<void> {
  await logBillingEventProjection(charge.id ?? 'unknown_charge', type, {
    id: charge.id,
    customer: charge.customer,
    payment_intent: stripeId(charge.payment_intent),
    refunded: charge.refunded,
    amount: charge.amount,
    amount_refunded: charge.amount_refunded,
    currency: charge.currency
  })
}

async function handleDisputeEvent(type: string, dispute: Dispute): Promise<void> {
  await logBillingEventProjection(dispute.id ?? 'unknown_dispute', type, {
    id: dispute.id,
    charge: stripeId(dispute.charge),
    payment_intent: stripeId(dispute.payment_intent),
    status: dispute.status,
    reason: dispute.reason,
    amount: dispute.amount,
    currency: dispute.currency
  })
}

async function dispatchStripeEvent(event: StripeEvent): Promise<string> {
  const eventId = event.id ?? ''
  if (!eventId) throw new Error('Stripe event is missing id')

  const object = event.data?.object ?? {}
  let result: string
  switch (event.type) {
    case 'checkout.session.completed':
      if (!(await recordBillingEvent(event, object))) return 'duplicate'
      await handleCheckoutCompleted(object as CheckoutSession)
      result = 'checkout_completed'
      break
    case 'customer.subscription.created':
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted':
      if (!(await recordSubscriptionEvent(event, object as Subscription))) return 'duplicate'
      await handleSubscriptionEvent(event.type, object as Subscription)
      result = 'subscription_event'
      break
    case 'invoice.paid':
    case 'invoice.payment_failed':
      if (!(await recordInvoiceEvent(event, object as Invoice))) return 'duplicate'
      await handleInvoiceEvent(event.type, object as Invoice)
      result = 'invoice_event'
      break
    case 'payment_intent.succeeded':
    case 'payment_intent.payment_failed':
      if (!(await recordPaymentEvent(event, object as PaymentIntent))) return 'duplicate'
      await handlePaymentEvent(event.type, object as PaymentIntent)
      result = 'payment_event'
      break
    case 'charge.refunded':
      if (!(await recordRefundEvent(event, object as Charge))) return 'duplicate'
      await handleRefundEvent(event.type, object as Charge)
      result = 'refund_event'
      break
    case 'charge.dispute.created':
    case 'charge.dispute.updated':
    case 'charge.dispute.closed':
      if (!(await recordDisputeEvent(event, object as Dispute))) return 'duplicate'
      await handleDisputeEvent(event.type, object as Dispute)
      result = 'dispute_event'
      break
    default:
      if (!(await recordBillingEvent(event, object))) return 'duplicate'
      result = 'ignored'
      break
  }
  return result
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const signature = request.headers.get('Stripe-Signature') ?? ''
  const body = await request.text()
  try {
    await verifyStripeSignature(body, signature)
    const event = JSON.parse(body) as StripeEvent
    const result = await dispatchStripeEvent(event)
    return json({ received: true, result })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Webhook failed'
    return json({ error: message }, 400)
  }
})
