import { describe, expect, test } from 'bun:test'

import {
  PluginConnectorContractRegistry,
  parsePluginConnectorContract
} from '@open-pencil/core/plugins'

import { RedactedConnectorAuditLog } from '@/app/plugins/connectors/audit'
import { ConnectorAuthorizationRegistry } from '@/app/plugins/connectors/authorization'
import { createConnectorExecutionBroker } from '@/app/plugins/connectors/broker'
import { ConnectorHostAdapterRegistry } from '@/app/plugins/connectors/registry'
import {
  STRIPE_API_ORIGIN,
  STRIPE_BILLING_ADAPTER_ID,
  STRIPE_BILLING_CONNECTOR_ADAPTER,
  STRIPE_BILLING_CONNECTOR_CONTRACT,
  STRIPE_BILLING_CONNECTOR_ID,
  STRIPE_BILLING_LIMITS,
  STRIPE_BILLING_PLUGIN_ID,
  STRIPE_CREATE_CHECKOUT_SESSION_OPERATION,
  STRIPE_CREATE_CHECKOUT_SESSION_OPERATION_ID,
  STRIPE_GET_PRICE_OPERATION,
  STRIPE_GET_PRICE_OPERATION_ID,
  STRIPE_GET_PRODUCT_OPERATION,
  STRIPE_GET_PRODUCT_OPERATION_ID,
  STRIPE_SECRET_KEY_SLOT_ID,
  normalizeStripeCheckoutSessionResponse,
  normalizeStripePriceResponse,
  normalizeStripeProductResponse
} from '@/app/plugins/connectors/stripe-billing'
import { ConnectorExecutionError } from '@/app/plugins/connectors/types'
import type { InstalledAppPlugin } from '@/app/plugins/types'
import { credentialRef } from '@/app/settings/credentials'

const PRODUCT_ID = 'prod_Product123'
const PRICE_ID = 'price_Price123'
const SESSION_ID = 'cs_test_Session123'
const SUCCESS_URL = 'https://shop.acme.com/checkout/success?session_id={CHECKOUT_SESSION_ID}'
const CANCEL_URL = 'https://shop.acme.com/checkout/cancel'
const MUTATION_ATTEMPT_ID = '0198b0e2-77ee-4f89-9d67-0e53b74ec243'

function signal(): AbortSignal {
  return new AbortController().signal
}

function clonedContract() {
  return structuredClone(STRIPE_BILLING_CONNECTOR_CONTRACT)
}

function checkoutParameters() {
  return {
    priceId: PRICE_ID,
    quantity: 2,
    mode: 'subscription',
    successUrl: SUCCESS_URL,
    cancelUrl: CANCEL_URL
  }
}

function productResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: PRODUCT_ID,
    object: 'product',
    active: true,
    name: 'OpenPencil Pro',
    description: 'Monthly design workspace',
    default_price: PRICE_ID,
    livemode: false,
    created: 1_754_694_400,
    metadata: { ignored: 'bounded upstream detail' },
    ...overrides
  }
}

function priceResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: PRICE_ID,
    object: 'price',
    active: true,
    currency: 'usd',
    unit_amount: 2_500,
    type: 'recurring',
    recurring: { interval: 'month', interval_count: 1, usage_type: 'licensed' },
    product: PRODUCT_ID,
    livemode: false,
    created: 1_754_694_400,
    ...overrides
  }
}

function checkoutResponse(overrides: Record<string, unknown> = {}) {
  return {
    id: SESSION_ID,
    object: 'checkout.session',
    url: `https://checkout.stripe.com/c/pay/${SESSION_ID}#hosted-token`,
    status: 'open',
    payment_status: 'unpaid',
    mode: 'subscription',
    livemode: false,
    expires_at: 1_754_698_000,
    customer_details: null,
    ...overrides
  }
}

function installedPlugin(): InstalledAppPlugin {
  return {
    package: {
      trustSource: 'app-bundle',
      digest: 'sha256:stripe-reference-v1',
      manifest: {
        format: 'openpencil-plugin',
        schemaVersion: 2,
        plugin: { id: STRIPE_BILLING_PLUGIN_ID, name: 'Stripe', version: '1.0.0' },
        publisher: { id: 'open-pencil', name: 'OpenPencil', keyId: 'builtin' },
        engineRange: '>=0.0.0',
        capabilities: [],
        contributions: { modules: [], connectors: [STRIPE_BILLING_CONNECTOR_CONTRACT] }
      }
    },
    enabled: true,
    pinnedDigest: null
  } as InstalledAppPlugin
}

function errorCode(value: unknown): string | undefined {
  return value instanceof ConnectorExecutionError ? value.code : undefined
}

describe('Stripe Checkout and Billing reference connector', () => {
  test('declares exact bounded query and mutation authority with a runtime bearer slot', () => {
    expect(parsePluginConnectorContract(STRIPE_BILLING_CONNECTOR_CONTRACT)).toEqual(
      STRIPE_BILLING_CONNECTOR_CONTRACT
    )
    expect(STRIPE_BILLING_CONNECTOR_CONTRACT).toMatchObject({
      pluginId: STRIPE_BILLING_PLUGIN_ID,
      connectorId: STRIPE_BILLING_CONNECTOR_ID,
      adapterId: STRIPE_BILLING_ADAPTER_ID,
      kind: 'data-source',
      network: {
        origins: [STRIPE_API_ORIGIN],
        methods: ['GET', 'POST'],
        credentials: 'omit',
        redirects: 'error'
      },
      credentialSlots: [
        {
          slotId: STRIPE_SECRET_KEY_SLOT_ID,
          kind: 'bearer-token',
          required: true
        }
      ]
    })
    expect(STRIPE_BILLING_CONNECTOR_CONTRACT.operations).toHaveLength(3)
    expect(STRIPE_GET_PRODUCT_OPERATION).toMatchObject({
      operationId: STRIPE_GET_PRODUCT_OPERATION_ID,
      kind: 'query',
      request: {
        origin: STRIPE_API_ORIGIN,
        method: 'GET',
        pathTemplate: '/v1/products/{productId}',
        maxResponseBytes: STRIPE_BILLING_LIMITS.upstreamQueryBytes
      }
    })
    expect(STRIPE_GET_PRICE_OPERATION).toMatchObject({
      operationId: STRIPE_GET_PRICE_OPERATION_ID,
      kind: 'query',
      request: {
        origin: STRIPE_API_ORIGIN,
        method: 'GET',
        pathTemplate: '/v1/prices/{priceId}',
        maxResponseBytes: STRIPE_BILLING_LIMITS.upstreamQueryBytes
      }
    })
    expect(STRIPE_CREATE_CHECKOUT_SESSION_OPERATION).toMatchObject({
      operationId: STRIPE_CREATE_CHECKOUT_SESSION_OPERATION_ID,
      kind: 'mutation',
      request: {
        origin: STRIPE_API_ORIGIN,
        method: 'POST',
        pathTemplate: '/v1/checkout/sessions',
        maxResponseBytes: STRIPE_BILLING_LIMITS.upstreamCheckoutBytes
      }
    })
  })

  test('prepares only fixed product and price GET paths without headers, body, or secret', async () => {
    await expect(
      STRIPE_BILLING_CONNECTOR_ADAPTER.prepare({
        contract: STRIPE_BILLING_CONNECTOR_CONTRACT,
        operation: STRIPE_GET_PRODUCT_OPERATION,
        parameters: { productId: PRODUCT_ID },
        signal: signal()
      })
    ).resolves.toEqual({ url: `${STRIPE_API_ORIGIN}/v1/products/${PRODUCT_ID}` })
    await expect(
      STRIPE_BILLING_CONNECTOR_ADAPTER.prepare({
        contract: STRIPE_BILLING_CONNECTOR_CONTRACT,
        operation: STRIPE_GET_PRICE_OPERATION,
        parameters: { priceId: PRICE_ID },
        signal: signal()
      })
    ).resolves.toEqual({ url: `${STRIPE_API_ORIGIN}/v1/prices/${PRICE_ID}` })

    for (const parameters of [
      { productId: '../customers' },
      { productId: PRODUCT_ID, endpoint: '/v1/customers' },
      { productId: PRICE_ID }
    ]) {
      await expect(
        STRIPE_BILLING_CONNECTOR_ADAPTER.prepare({
          contract: STRIPE_BILLING_CONNECTOR_CONTRACT,
          operation: STRIPE_GET_PRODUCT_OPERATION,
          parameters,
          signal: signal()
        })
      ).rejects.toThrow()
    }

    const widened = clonedContract()
    widened.network.origins = ['https://evil.example']
    await expect(
      STRIPE_BILLING_CONNECTOR_ADAPTER.prepare({
        contract: widened,
        operation: widened.operations[0],
        parameters: { productId: PRODUCT_ID },
        signal: signal()
      })
    ).rejects.toThrow()
  })

  test('constructs one fixed Checkout form body from strict parameters', async () => {
    const prepared = await STRIPE_BILLING_CONNECTOR_ADAPTER.prepare({
      contract: STRIPE_BILLING_CONNECTOR_CONTRACT,
      operation: STRIPE_CREATE_CHECKOUT_SESSION_OPERATION,
      parameters: checkoutParameters(),
      mutationAttemptId: MUTATION_ATTEMPT_ID,
      signal: signal()
    })
    expect(prepared.url).toBe(`${STRIPE_API_ORIGIN}/v1/checkout/sessions`)
    expect(prepared.headers).toEqual({
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': MUTATION_ATTEMPT_ID
    })
    expect(typeof prepared.body).toBe('string')
    const body = new URLSearchParams(String(prepared.body))
    expect([...body.keys()]).toEqual([
      'mode',
      'line_items[0][price]',
      'line_items[0][quantity]',
      'success_url',
      'cancel_url'
    ])
    expect(Object.fromEntries(body)).toEqual({
      mode: 'subscription',
      'line_items[0][price]': PRICE_ID,
      'line_items[0][quantity]': '2',
      success_url: SUCCESS_URL,
      cancel_url: CANCEL_URL
    })
    expect(JSON.stringify(prepared)).not.toContain('sk_')
    expect(new URL(prepared.url).search).toBe('')
  })

  test('rejects non-public, non-HTTPS, non-canonical, and widened Checkout inputs', async () => {
    const invalidUrls = [
      'http://shop.acme.com/success',
      'https://localhost/success',
      'https://127.0.0.1/success',
      'https://shop.local/success',
      'https://SHOP.acme.com/success',
      'https://shop.acme.com:8443/success',
      'https://user@shop.acme.com/success'
    ]
    for (const successURL of invalidUrls) {
      await expect(
        STRIPE_BILLING_CONNECTOR_ADAPTER.prepare({
          contract: STRIPE_BILLING_CONNECTOR_CONTRACT,
          operation: STRIPE_CREATE_CHECKOUT_SESSION_OPERATION,
          parameters: { ...checkoutParameters(), successUrl: successURL },
          signal: signal()
        })
      ).rejects.toThrow()
    }
    for (const parameters of [
      { ...checkoutParameters(), quantity: 0 },
      { ...checkoutParameters(), mode: 'setup' },
      { ...checkoutParameters(), metadata: { role: 'admin' } },
      { ...checkoutParameters(), priceId: 'price_../../customers' }
    ]) {
      await expect(
        STRIPE_BILLING_CONNECTOR_ADAPTER.prepare({
          contract: STRIPE_BILLING_CONNECTOR_CONTRACT,
          operation: STRIPE_CREATE_CHECKOUT_SESSION_OPERATION,
          parameters,
          signal: signal()
        })
      ).rejects.toThrow()
    }
  })

  test('normalizes bounded product, price, and Checkout results', async () => {
    expect(normalizeStripeProductResponse(productResponse())).toEqual({
      id: PRODUCT_ID,
      active: true,
      name: 'OpenPencil Pro',
      description: 'Monthly design workspace',
      defaultPriceId: PRICE_ID,
      livemode: false,
      created: 1_754_694_400
    })
    expect(normalizeStripePriceResponse(priceResponse())).toEqual({
      id: PRICE_ID,
      active: true,
      currency: 'usd',
      unitAmount: 2_500,
      type: 'recurring',
      recurringInterval: 'month',
      recurringIntervalCount: 1,
      productId: PRODUCT_ID,
      livemode: false,
      created: 1_754_694_400
    })
    const checkout = {
      id: SESSION_ID,
      url: `https://checkout.stripe.com/c/pay/${SESSION_ID}#hosted-token`,
      status: 'open',
      paymentStatus: 'unpaid',
      mode: 'subscription',
      livemode: false,
      expiresAt: 1_754_698_000
    }
    expect(normalizeStripeCheckoutSessionResponse(checkoutResponse(), 'subscription')).toEqual(
      checkout
    )
    expect(
      await STRIPE_BILLING_CONNECTOR_ADAPTER.transformResponse?.(checkoutResponse(), {
        contract: STRIPE_BILLING_CONNECTOR_CONTRACT,
        operation: STRIPE_CREATE_CHECKOUT_SESSION_OPERATION,
        parameters: checkoutParameters(),
        signal: signal()
      })
    ).toEqual(checkout)
  })

  test('fails closed on response expansion, accessors, invalid hosts, and mode mismatch', () => {
    expect(() =>
      normalizeStripeProductResponse(
        productResponse({
          description: 'x'.repeat(STRIPE_BILLING_LIMITS.descriptionLength + 1)
        })
      )
    ).toThrow()
    expect(() =>
      normalizeStripePriceResponse(priceResponse({ recurring: { interval: 'minute' } }))
    ).toThrow()
    expect(() =>
      normalizeStripeCheckoutSessionResponse(
        checkoutResponse({ url: 'https://merchant.acme.com/fake-session' })
      )
    ).toThrow('Stripe Checkout host')
    expect(() => normalizeStripeCheckoutSessionResponse(checkoutResponse(), 'payment')).toThrow(
      'does not match'
    )

    let getterCalls = 0
    const product = Object.defineProperty(productResponse(), 'name', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'Unsafe'
      }
    })
    expect(() => normalizeStripeProductResponse(product)).toThrow('enumerable data field')
    expect(getterCalls).toBe(0)

    const expanded = productResponse()
    for (let index = 0; index <= STRIPE_BILLING_LIMITS.responseFields; index += 1) {
      Reflect.set(expanded, `extra${index}`, index)
    }
    expect(() => normalizeStripeProductResponse(expanded)).toThrow('response field limit')
  })

  test('marks Checkout creation as a Broker-confirmed mutation before credential or network use', async () => {
    const contracts = new PluginConnectorContractRegistry()
    contracts.register(STRIPE_BILLING_CONNECTOR_CONTRACT)
    const adapters = new ConnectorHostAdapterRegistry(contracts)
    adapters.register(STRIPE_BILLING_CONNECTOR_ADAPTER)
    const authorization = new ConnectorAuthorizationRegistry()
    const plugin = installedPlugin()
    authorization.authorize(STRIPE_BILLING_CONNECTOR_CONTRACT, plugin.package.digest, 1_754_694_400)
    const audit = new RedactedConnectorAuditLog()
    let credentialCalls = 0
    let fetchCalls = 0
    let capturedAuthorization: string | null = null
    let capturedIdempotencyKey: string | null = null
    const broker = createConnectorExecutionBroker({
      adapters,
      authorization,
      credentialResolver: {
        resolve: async () => {
          credentialCalls += 1
          return 'sk_test_runtime_only'
        }
      },
      audit,
      fetch: async (_input, init) => {
        fetchCalls += 1
        const headers = new Headers(init?.headers)
        capturedAuthorization = headers.get('authorization')
        capturedIdempotencyKey = headers.get('idempotency-key')
        return new Response(JSON.stringify(checkoutResponse()), { status: 200 })
      }
    })
    const request = {
      plugin,
      contract: STRIPE_BILLING_CONNECTOR_CONTRACT,
      operationId: STRIPE_CREATE_CHECKOUT_SESSION_OPERATION_ID,
      parameters: checkoutParameters(),
      mutationAttemptId: MUTATION_ATTEMPT_ID,
      credentialRefs: {
        [STRIPE_SECRET_KEY_SLOT_ID]: credentialRef(
          STRIPE_BILLING_PLUGIN_ID,
          STRIPE_SECRET_KEY_SLOT_ID
        )
      }
    }

    expect(errorCode(await broker.execute(request).catch((error) => error))).toBe(
      'mutation-confirmation-required'
    )
    expect(credentialCalls).toBe(0)
    expect(fetchCalls).toBe(0)
    expect(
      errorCode(
        await broker
          .execute({ ...request, confirmMutation: async () => false })
          .catch((error) => error)
      )
    ).toBe('mutation-denied')
    expect(credentialCalls).toBe(0)
    expect(fetchCalls).toBe(0)

    await expect(
      broker.execute({ ...request, confirmMutation: async () => true })
    ).resolves.toMatchObject({ data: { id: SESSION_ID, mode: 'subscription' } })
    expect(credentialCalls).toBe(1)
    expect(fetchCalls).toBe(1)
    expect(capturedAuthorization).toBe('Bearer sk_test_runtime_only')
    expect(capturedIdempotencyKey).toBe(MUTATION_ATTEMPT_ID)
    expect(JSON.stringify(audit.snapshot())).not.toContain('sk_test_runtime_only')

    expect(errorCode(await broker.execute(request).catch((error) => error))).toBe(
      'mutation-confirmation-required'
    )
    expect(credentialCalls).toBe(1)
    expect(fetchCalls).toBe(1)
  })

  test('honors cancellation and rejects forged operation accessors without invoking them', async () => {
    const controller = new AbortController()
    controller.abort(new Error('cancelled'))
    await expect(
      STRIPE_BILLING_CONNECTOR_ADAPTER.prepare({
        contract: STRIPE_BILLING_CONNECTOR_CONTRACT,
        operation: STRIPE_GET_PRODUCT_OPERATION,
        parameters: { productId: PRODUCT_ID },
        signal: controller.signal
      })
    ).rejects.toThrow('cancelled')

    let getterCalls = 0
    let toJSONCalls = 0
    const forged = Object.defineProperty(
      {
        ...STRIPE_GET_PRODUCT_OPERATION,
        toJSON() {
          toJSONCalls += 1
          return STRIPE_GET_PRODUCT_OPERATION
        }
      },
      'name',
      {
        enumerable: true,
        get() {
          getterCalls += 1
          return 'Unsafe'
        }
      }
    )
    await expect(
      STRIPE_BILLING_CONNECTOR_ADAPTER.prepare({
        contract: STRIPE_BILLING_CONNECTOR_CONTRACT,
        operation: forged as never,
        parameters: { productId: PRODUCT_ID },
        signal: signal()
      })
    ).rejects.toThrow()
    expect(getterCalls).toBe(0)
    expect(toJSONCalls).toBe(0)
  })
})
