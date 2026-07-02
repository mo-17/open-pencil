// Supabase Edge Function example for creating a Stripe Customer Portal session.
//
// Point a lowcode `stripeCustomerPortal` action at this server-side endpoint.
// Stripe secrets must stay in Edge Function environment variables; never copy
// them into .fig files, generated SPA source, screenshots, or logs.
//
// Production note: do not trust a customerId sent from the browser. Authenticate
// the current user, look up their Stripe customer id in your own database, and
// use that server-side value when creating the portal session. This template
// verifies the caller with Supabase Auth and reads `billing_customers` using a
// service role key. See `supabase/schema/billing.sql` for the matching schema.

const STRIPE_API_BASE = 'https://api.stripe.com/v1'

interface CustomerPortalRequest {
  returnPath?: string
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

function publicSiteUrl(): string {
  const siteUrl = new URL(env('PUBLIC_SITE_URL'))
  if (siteUrl.protocol !== 'http:' && siteUrl.protocol !== 'https:') {
    throw new Error('PUBLIC_SITE_URL must be an http(s) URL')
  }
  return siteUrl.origin
}

function supabaseRestConfig(): { url: string; headers: Record<string, string> } {
  const url = new URL(env('SUPABASE_URL'))
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('SUPABASE_URL must be an http(s) URL')
  }
  const serviceRoleKey = env('SUPABASE_SERVICE_ROLE_KEY')
  return {
    url: url.origin,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json'
    }
  }
}

async function requireAuthenticatedUser(request: Request): Promise<SupabaseUser> {
  const auth = request.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) {
    throw new Error('Authorization bearer token required')
  }
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

async function lookupStripeCustomerId(user: SupabaseUser): Promise<string> {
  const supabase = supabaseRestConfig()
  const query = new URLSearchParams({
    select: 'stripe_customer_id',
    user_id: `eq.${user.id}`,
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
  const customerId = Array.isArray(rows) ? rows[0]?.stripe_customer_id?.trim() ?? '' : ''
  if (!response.ok || !customerId.startsWith('cus_')) {
    throw new Error('A server-side Stripe customer id mapping is required')
  }
  return customerId
}

function portalReturnUrl(input: CustomerPortalRequest): string {
  const siteUrl = publicSiteUrl()
  const returnPath = typeof input.returnPath === 'string' ? input.returnPath.trim() : ''
  if (!returnPath) return new URL('/account', siteUrl).toString()
  if (!returnPath.startsWith('/')) {
    throw new Error('returnPath must be root-relative')
  }
  return new URL(returnPath, siteUrl).toString()
}

async function createCustomerPortalSession(
  input: CustomerPortalRequest,
  customerId: string
): Promise<string> {
  const secretKey = env('STRIPE_SECRET_KEY')
  const body = new URLSearchParams({
    customer: customerId,
    return_url: portalReturnUrl(input)
  })
  const configuration = Deno.env.get('STRIPE_PORTAL_CONFIGURATION')?.trim()
  if (configuration) body.set('configuration', configuration)

  const response = await fetch(`${STRIPE_API_BASE}/billing_portal/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body
  })
  const data = await response.json()
  if (!response.ok) {
    const message = data?.error?.message ?? 'Stripe customer portal session failed'
    throw new Error(message)
  }
  if (typeof data?.url !== 'string' || data.url === '') {
    throw new Error('Stripe response did not include a customer portal URL')
  }
  return data.url
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() })
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  try {
    const input = (await request.json()) as CustomerPortalRequest
    const user = await requireAuthenticatedUser(request)
    const customerId = await lookupStripeCustomerId(user)
    const url = await createCustomerPortalSession(input, customerId)
    return json({ url })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Customer portal failed'
    return json({ error: message }, 400)
  }
})
