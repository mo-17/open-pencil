// Supabase Edge Function example for the lowcode onboarding demo.
//
// Deploy this as a server-side endpoint and point the demo's Stripe checkout
// action at it. Stripe secrets must stay in Edge Function environment variables;
// never copy them into .fig files, generated SPA source, screenshots, or logs.
//
// Production note: when the generated app sends a Supabase Authorization bearer
// token, this template verifies the user, creates or reuses a Stripe Customer,
// and upserts `billing_customers` using the service role key. Anonymous demo
// calls still fall back to `customer_email` only.

const STRIPE_API_BASE = 'https://api.stripe.com/v1'
const ALLOWED_PLANS = new Set(['starter', 'pro', 'enterprise'])
const CHECKOUT_MODES = new Set(['payment', 'subscription'])

interface CheckoutRequest {
  plan?: string
  email?: string
}

interface SupabaseUser {
  id?: string
  email?: string
}

interface BillingCustomerRow {
  stripe_customer_id?: string
}

function corsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

function priceIdForPlan(plan: string): string {
  const normalized = ALLOWED_PLANS.has(plan) ? plan : 'starter'
  return env(`STRIPE_PRICE_${normalized.toUpperCase()}`)
}

function checkoutMode(): string {
  const mode = Deno.env.get('STRIPE_CHECKOUT_MODE')?.trim() || 'subscription'
  return CHECKOUT_MODES.has(mode) ? mode : 'subscription'
}

function publicSiteUrl(): string {
  const siteUrl = new URL(env('PUBLIC_SITE_URL'))
  if (siteUrl.protocol !== 'http:' && siteUrl.protocol !== 'https:') {
    throw new Error('PUBLIC_SITE_URL must be an http(s) URL')
  }
  return siteUrl.origin
}

function supabaseUrl(): string {
  const url = new URL(env('SUPABASE_URL'))
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('SUPABASE_URL must be an http(s) URL')
  }
  return url.origin
}

function supabaseRestConfig(): { url: string; headers: Record<string, string> } {
  const serviceRoleKey = env('SUPABASE_SERVICE_ROLE_KEY')
  return {
    url: supabaseUrl(),
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json'
    }
  }
}

async function optionalAuthenticatedUser(request: Request): Promise<SupabaseUser | null> {
  const auth = request.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return null

  const supabase = supabaseRestConfig()
  const response = await fetch(`${supabase.url}/auth/v1/user`, {
    headers: {
      apikey: supabase.headers.apikey,
      Authorization: auth
    }
  })
  const user = (await response.json()) as SupabaseUser
  if (!response.ok || typeof user.id !== 'string' || user.id === '') {
    throw new Error('Authenticated Supabase user required')
  }
  return user
}

async function lookupStripeCustomerId(userId: string): Promise<string | null> {
  const supabase = supabaseRestConfig()
  const query = new URLSearchParams({
    select: 'stripe_customer_id',
    user_id: `eq.${userId}`,
    limit: '1'
  })
  const response = await fetch(`${supabase.url}/rest/v1/billing_customers?${query}`, {
    headers: {
      apikey: supabase.headers.apikey,
      Authorization: supabase.headers.Authorization,
      Accept: 'application/json'
    }
  })
  const rows = (await response.json()) as BillingCustomerRow[]
  if (!response.ok) {
    throw new Error('Failed to look up billing customer mapping')
  }
  const customerId = Array.isArray(rows) ? rows[0]?.stripe_customer_id?.trim() ?? '' : ''
  return customerId.startsWith('cus_') ? customerId : null
}

async function createStripeCustomer(email: string): Promise<string> {
  const secretKey = env('STRIPE_SECRET_KEY')
  const body = new URLSearchParams()
  if (email) body.set('email', email)

  const response = await fetch(`${STRIPE_API_BASE}/customers`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  })
  const data = await response.json()
  if (!response.ok) {
    const message = data?.error?.message ?? 'Stripe customer creation failed'
    throw new Error(message)
  }
  if (typeof data?.id !== 'string' || !data.id.startsWith('cus_')) {
    throw new Error('Stripe response did not include a customer id')
  }
  return data.id
}

async function upsertBillingCustomer(user: SupabaseUser, customerId: string, email: string): Promise<void> {
  if (typeof user.id !== 'string' || user.id === '') {
    throw new Error('Authenticated Supabase user required')
  }
  const supabase = supabaseRestConfig()
  const response = await fetch(`${supabase.url}/rest/v1/billing_customers?on_conflict=user_id`, {
    method: 'POST',
    headers: {
      ...supabase.headers,
      Prefer: 'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify({
      user_id: user.id,
      stripe_customer_id: customerId,
      email: email || user.email || null
    })
  })
  if (!response.ok) {
    const details = await response.text()
    throw new Error(`Failed to store billing customer mapping: ${response.status} ${details}`)
  }
}

async function customerIdForAuthenticatedUser(
  user: SupabaseUser | null,
  email: string
): Promise<string | null> {
  if (!user?.id) return null
  const existing = await lookupStripeCustomerId(user.id)
  if (existing) return existing

  const customerId = await createStripeCustomer(email || user.email || '')
  await upsertBillingCustomer(user, customerId, email)
  return customerId
}

async function createCheckoutSession(input: CheckoutRequest, customerId: string | null): Promise<string> {
  const secretKey = env('STRIPE_SECRET_KEY')
  const siteUrl = publicSiteUrl()
  const plan = typeof input.plan === 'string' ? input.plan : 'starter'
  const email = typeof input.email === 'string' ? input.email.trim() : ''
  const body = new URLSearchParams({
    mode: checkoutMode(),
    success_url: new URL('/checkout/success', siteUrl).toString(),
    cancel_url: new URL('/checkout/cancel', siteUrl).toString(),
    'line_items[0][price]': priceIdForPlan(plan),
    'line_items[0][quantity]': '1',
    'metadata[plan]': plan
  })
  if (customerId) body.set('customer', customerId)
  else if (email) body.set('customer_email', email)

  const response = await fetch(`${STRIPE_API_BASE}/checkout/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  })
  const data = await response.json()
  if (!response.ok) {
    const message = data?.error?.message ?? 'Stripe checkout session failed'
    throw new Error(message)
  }
  if (typeof data?.url !== 'string' || data.url === '') {
    throw new Error('Stripe response did not include a checkout URL')
  }
  return data.url
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const input = (await request.json()) as CheckoutRequest
    const email = typeof input.email === 'string' ? input.email.trim() : ''
    const user = await optionalAuthenticatedUser(request)
    const customerId = await customerIdForAuthenticatedUser(user, email)
    const url = await createCheckoutSession(input, customerId)
    return json({ url })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Checkout failed'
    return json({ error: message }, 400)
  }
})
