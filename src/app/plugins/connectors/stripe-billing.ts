/* eslint-disable max-lines -- The reviewed Stripe contract and its adapter stay one audit boundary. */
import {
  parsePluginConnectorContract,
  parsePluginObjectParameterValue,
  type PluginConnectorContractV1,
  type PluginConnectorOperationV1,
  type PluginParameterValue
} from '@open-pencil/core/plugins'

import { strictPlainDataRecord, type PluginJSONDataRecord } from '@/app/plugins/json-data'

import type {
  ConnectorHostAdapter,
  PrepareConnectorRequestContext,
  PreparedConnectorRequest
} from './types'

export const STRIPE_BILLING_PLUGIN_ID = 'open-pencil.stripe'
export const STRIPE_BILLING_CONNECTOR_ID = 'stripe.billing'
export const STRIPE_BILLING_ADAPTER_ID = 'open-pencil.connector.stripe'
export const STRIPE_API_ORIGIN = 'https://api.stripe.com'
export const STRIPE_SECRET_KEY_SLOT_ID = 'secret-key'
export const STRIPE_GET_PRODUCT_OPERATION_ID = 'get-product'
export const STRIPE_GET_PRICE_OPERATION_ID = 'get-price'
export const STRIPE_CREATE_CHECKOUT_SESSION_OPERATION_ID = 'create-checkout-session'

export const STRIPE_BILLING_LIMITS = Object.freeze({
  queryParameterBytes: 512,
  checkoutParameterBytes: 8 * 1024,
  upstreamQueryBytes: 128 * 1024,
  upstreamCheckoutBytes: 256 * 1024,
  resultBytes: 64 * 1024,
  requestBodyBytes: 16 * 1024,
  responseFields: 128,
  identifierLength: 255,
  publicUrlLength: 2_048,
  checkoutUrlLength: 4_096,
  displayNameLength: 256,
  descriptionLength: 2_000,
  quantity: 100,
  unitAmount: 99_999_999,
  unixTimestamp: 10_000_000_000
})

const STRING_ID = Object.freeze({
  type: 'string' as const,
  minLength: 10,
  maxLength: STRIPE_BILLING_LIMITS.identifierLength
})
const PUBLIC_URL = Object.freeze({
  type: 'string' as const,
  minLength: 9,
  maxLength: STRIPE_BILLING_LIMITS.publicUrlLength
})
const CHECKOUT_MODE = Object.freeze({
  type: 'string' as const,
  enum: Object.freeze(['payment', 'subscription'])
})
const BOOLEAN_SCHEMA = Object.freeze({ type: 'boolean' as const })
const CREATED_SCHEMA = Object.freeze({
  type: 'integer' as const,
  minimum: 0,
  maximum: STRIPE_BILLING_LIMITS.unixTimestamp
})
const PRODUCT_PARAMETERS_SCHEMA = Object.freeze({
  type: 'object' as const,
  properties: Object.freeze({ productId: STRING_ID }),
  required: Object.freeze(['productId']),
  additionalProperties: false as const,
  minProperties: 1,
  maxProperties: 1
})
const PRICE_PARAMETERS_SCHEMA = Object.freeze({
  type: 'object' as const,
  properties: Object.freeze({ priceId: STRING_ID }),
  required: Object.freeze(['priceId']),
  additionalProperties: false as const,
  minProperties: 1,
  maxProperties: 1
})
const CHECKOUT_PARAMETERS_SCHEMA = Object.freeze({
  type: 'object' as const,
  properties: Object.freeze({
    priceId: STRING_ID,
    quantity: Object.freeze({
      type: 'integer' as const,
      minimum: 1,
      maximum: STRIPE_BILLING_LIMITS.quantity
    }),
    mode: CHECKOUT_MODE,
    successUrl: PUBLIC_URL,
    cancelUrl: PUBLIC_URL
  }),
  required: Object.freeze(['priceId', 'quantity', 'mode', 'successUrl', 'cancelUrl']),
  additionalProperties: false as const,
  minProperties: 5,
  maxProperties: 5
})

const PRODUCT_RESULT_SCHEMA = Object.freeze({
  type: 'object' as const,
  properties: Object.freeze({
    id: STRING_ID,
    active: BOOLEAN_SCHEMA,
    name: Object.freeze({
      type: 'string' as const,
      minLength: 1,
      maxLength: STRIPE_BILLING_LIMITS.displayNameLength
    }),
    description: Object.freeze({
      type: 'string' as const,
      maxLength: STRIPE_BILLING_LIMITS.descriptionLength
    }),
    defaultPriceId: STRING_ID,
    livemode: BOOLEAN_SCHEMA,
    created: CREATED_SCHEMA
  }),
  required: Object.freeze(['id', 'active', 'name', 'livemode', 'created']),
  additionalProperties: false as const,
  minProperties: 5,
  maxProperties: 7
})

const PRICE_RESULT_SCHEMA = Object.freeze({
  type: 'object' as const,
  properties: Object.freeze({
    id: STRING_ID,
    active: BOOLEAN_SCHEMA,
    currency: Object.freeze({ type: 'string' as const, minLength: 3, maxLength: 3 }),
    unitAmount: Object.freeze({
      type: 'integer' as const,
      minimum: 0,
      maximum: STRIPE_BILLING_LIMITS.unitAmount
    }),
    type: Object.freeze({
      type: 'string' as const,
      enum: Object.freeze(['one_time', 'recurring'])
    }),
    recurringInterval: Object.freeze({
      type: 'string' as const,
      enum: Object.freeze(['day', 'week', 'month', 'year'])
    }),
    recurringIntervalCount: Object.freeze({
      type: 'integer' as const,
      minimum: 1,
      maximum: 36
    }),
    productId: STRING_ID,
    livemode: BOOLEAN_SCHEMA,
    created: CREATED_SCHEMA
  }),
  required: Object.freeze(['id', 'active', 'currency', 'type', 'productId', 'livemode', 'created']),
  additionalProperties: false as const,
  minProperties: 7,
  maxProperties: 10
})

const CHECKOUT_RESULT_SCHEMA = Object.freeze({
  type: 'object' as const,
  properties: Object.freeze({
    id: STRING_ID,
    url: Object.freeze({
      type: 'string' as const,
      minLength: 9,
      maxLength: STRIPE_BILLING_LIMITS.checkoutUrlLength
    }),
    status: Object.freeze({
      type: 'string' as const,
      enum: Object.freeze(['open', 'complete', 'expired'])
    }),
    paymentStatus: Object.freeze({
      type: 'string' as const,
      enum: Object.freeze(['paid', 'unpaid', 'no_payment_required'])
    }),
    mode: CHECKOUT_MODE,
    livemode: BOOLEAN_SCHEMA,
    expiresAt: Object.freeze({
      type: 'integer' as const,
      minimum: 0,
      maximum: STRIPE_BILLING_LIMITS.unixTimestamp
    })
  }),
  required: Object.freeze([
    'id',
    'url',
    'status',
    'paymentStatus',
    'mode',
    'livemode',
    'expiresAt'
  ]),
  additionalProperties: false as const,
  minProperties: 7,
  maxProperties: 7
})

export const STRIPE_BILLING_CONNECTOR_CONTRACT = parsePluginConnectorContract({
  format: 'openpencil-plugin-connector-contract',
  schemaVersion: 1,
  pluginId: STRIPE_BILLING_PLUGIN_ID,
  connectorId: STRIPE_BILLING_CONNECTOR_ID,
  adapterId: STRIPE_BILLING_ADAPTER_ID,
  name: 'Stripe Checkout & Billing',
  description:
    'Read bounded Stripe product and price summaries or create one reviewed hosted Checkout Session.',
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
      label: 'Stripe secret key',
      kind: 'bearer-token',
      required: true
    }
  ],
  operations: [
    {
      operationId: STRIPE_GET_PRODUCT_OPERATION_ID,
      name: 'Get product',
      description: 'Read one bounded Stripe product summary by its canonical product ID.',
      kind: 'query',
      credentialSlots: [STRIPE_SECRET_KEY_SLOT_ID],
      request: {
        origin: STRIPE_API_ORIGIN,
        method: 'GET',
        pathTemplate: '/v1/products/{productId}',
        maxResponseBytes: STRIPE_BILLING_LIMITS.upstreamQueryBytes
      },
      parameters: {
        schema: PRODUCT_PARAMETERS_SCHEMA,
        maxBytes: STRIPE_BILLING_LIMITS.queryParameterBytes
      },
      result: {
        schema: PRODUCT_RESULT_SCHEMA,
        maxBytes: STRIPE_BILLING_LIMITS.resultBytes
      }
    },
    {
      operationId: STRIPE_GET_PRICE_OPERATION_ID,
      name: 'Get price',
      description: 'Read one bounded Stripe price summary by its canonical price ID.',
      kind: 'query',
      credentialSlots: [STRIPE_SECRET_KEY_SLOT_ID],
      request: {
        origin: STRIPE_API_ORIGIN,
        method: 'GET',
        pathTemplate: '/v1/prices/{priceId}',
        maxResponseBytes: STRIPE_BILLING_LIMITS.upstreamQueryBytes
      },
      parameters: {
        schema: PRICE_PARAMETERS_SCHEMA,
        maxBytes: STRIPE_BILLING_LIMITS.queryParameterBytes
      },
      result: {
        schema: PRICE_RESULT_SCHEMA,
        maxBytes: STRIPE_BILLING_LIMITS.resultBytes
      }
    },
    {
      operationId: STRIPE_CREATE_CHECKOUT_SESSION_OPERATION_ID,
      name: 'Create Checkout Session',
      description:
        'Create one hosted Stripe Checkout Session after explicit confirmation for this invocation.',
      kind: 'mutation',
      credentialSlots: [STRIPE_SECRET_KEY_SLOT_ID],
      request: {
        origin: STRIPE_API_ORIGIN,
        method: 'POST',
        pathTemplate: '/v1/checkout/sessions',
        maxResponseBytes: STRIPE_BILLING_LIMITS.upstreamCheckoutBytes
      },
      parameters: {
        schema: CHECKOUT_PARAMETERS_SCHEMA,
        maxBytes: STRIPE_BILLING_LIMITS.checkoutParameterBytes
      },
      result: {
        schema: CHECKOUT_RESULT_SCHEMA,
        maxBytes: STRIPE_BILLING_LIMITS.resultBytes
      }
    }
  ]
})

function requiredOperation(operationId: string): PluginConnectorOperationV1 {
  const operation = STRIPE_BILLING_CONNECTOR_CONTRACT.operations.find(
    (candidate) => candidate.operationId === operationId
  )
  if (!operation)
    throw new Error(`Stripe Billing reviewed operation is unavailable: ${operationId}`)
  return operation
}

export const STRIPE_GET_PRODUCT_OPERATION = requiredOperation(STRIPE_GET_PRODUCT_OPERATION_ID)
export const STRIPE_GET_PRICE_OPERATION = requiredOperation(STRIPE_GET_PRICE_OPERATION_ID)
export const STRIPE_CREATE_CHECKOUT_SESSION_OPERATION = requiredOperation(
  STRIPE_CREATE_CHECKOUT_SESSION_OPERATION_ID
)

const REVIEWED_CONTRACT_JSON = JSON.stringify(STRIPE_BILLING_CONNECTOR_CONTRACT)
const REVIEWED_OPERATION_JSON: Readonly<Record<string, string>> = Object.freeze({
  [STRIPE_GET_PRODUCT_OPERATION_ID]: JSON.stringify(STRIPE_GET_PRODUCT_OPERATION),
  [STRIPE_GET_PRICE_OPERATION_ID]: JSON.stringify(STRIPE_GET_PRICE_OPERATION),
  [STRIPE_CREATE_CHECKOUT_SESSION_OPERATION_ID]: JSON.stringify(
    STRIPE_CREATE_CHECKOUT_SESSION_OPERATION
  )
})
const PRODUCT_ID = /^prod_[A-Za-z0-9]{8,250}$/
const PRICE_ID = /^price_[A-Za-z0-9]{8,249}$/
const CHECKOUT_SESSION_ID = /^cs_(?:test|live)_[A-Za-z0-9]{8,240}$/
const CURRENCY = /^[a-z]{3}$/
const CHECKOUT_MODES = new Set(['payment', 'subscription'] as const)
const PUBLIC_HOST_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const PUBLIC_ASCII_TLD = /^(?:[a-z]{2,63}|xn--[a-z0-9-]{1,59})$/
const NON_PUBLIC_TLDS = new Set([
  'arpa',
  'example',
  'home',
  'internal',
  'invalid',
  'lan',
  'local',
  'localhost',
  'onion',
  'test'
])
const TEXT_ENCODER = new TextEncoder()

function stripeResponseRecord(value: unknown, path: string): PluginJSONDataRecord {
  return strictPlainDataRecord(
    value,
    path,
    STRIPE_BILLING_LIMITS.responseFields,
    `${path} exceeds the Stripe response field limit`
  )
}

function assertObjectType(source: PluginJSONDataRecord, expected: string, path: string): void {
  if (source.object !== expected) throw new TypeError(`${path}.object must be ${expected}`)
}

function boundedString(value: unknown, path: string, maximum: number, minimum = 1): string {
  if (typeof value !== 'string') throw new TypeError(`${path} must be a string`)
  const normalized = value.normalize('NFC')
  let containsNul = false
  for (let index = 0; index < normalized.length; index += 1) {
    if (normalized.charCodeAt(index) === 0) containsNul = true
  }
  if (normalized.length < minimum || normalized.length > maximum || containsNul) {
    throw new TypeError(`${path} is invalid`)
  }
  return normalized
}

function patternedString(value: unknown, pattern: RegExp, path: string): string {
  const parsed = boundedString(value, path, STRIPE_BILLING_LIMITS.identifierLength)
  if (!pattern.test(parsed)) throw new TypeError(`${path} is not a canonical Stripe ID`)
  return parsed
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') throw new TypeError(`${path} must be a boolean`)
  return value
}

function boundedInteger(value: unknown, path: string, minimum: number, maximum: number): number {
  if (
    !Number.isSafeInteger(value) ||
    typeof value !== 'number' ||
    value < minimum ||
    value > maximum
  ) {
    throw new TypeError(`${path} must be an integer between ${minimum} and ${maximum}`)
  }
  return value
}

function enumString<const T extends string>(
  value: unknown,
  allowed: ReadonlySet<T>,
  path: string
): T {
  if (typeof value !== 'string' || !allowed.has(value as T)) {
    throw new TypeError(`${path} is not supported`)
  }
  return value as T
}

function publicDnsHostname(hostname: string, path: string): void {
  if (hostname.length > 253 || hostname.endsWith('.')) {
    throw new TypeError(`${path} must use a public DNS hostname`)
  }
  const labels = hostname.split('.')
  const topLevelDomain = labels.at(-1)
  if (
    labels.length < 2 ||
    !topLevelDomain ||
    NON_PUBLIC_TLDS.has(topLevelDomain) ||
    !PUBLIC_ASCII_TLD.test(topLevelDomain) ||
    labels.some((label) => !PUBLIC_HOST_LABEL.test(label))
  ) {
    throw new TypeError(`${path} must use a public DNS hostname`)
  }
}

function canonicalPublicHttpsURL(value: unknown, path: string, maximum: number): string {
  const source = boundedString(value, path, maximum)
  let parsed: URL
  try {
    parsed = new URL(source)
  } catch (cause) {
    throw new TypeError(`${path} must be a canonical public HTTPS URL`, { cause })
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.port !== '' ||
    parsed.href !== source
  ) {
    throw new TypeError(`${path} must be a canonical public HTTPS URL`)
  }
  publicDnsHostname(parsed.hostname, path)
  return parsed.href
}

function stripeCheckoutURL(value: unknown, path: string): string {
  const url = canonicalPublicHttpsURL(value, path, STRIPE_BILLING_LIMITS.checkoutUrlLength)
  if (new URL(url).hostname !== 'checkout.stripe.com') {
    throw new TypeError(`${path} must use the Stripe Checkout host`)
  }
  return url
}

function assertReviewedAuthority(
  contract: PluginConnectorContractV1,
  operation: PluginConnectorOperationV1
): PluginConnectorOperationV1 {
  const parsedContract = parsePluginConnectorContract(contract)
  if (JSON.stringify(parsedContract) !== REVIEWED_CONTRACT_JSON) {
    throw new Error('Stripe Billing connector authority does not match the reviewed contract')
  }
  const operationEnvelope = parsePluginConnectorContract({
    ...STRIPE_BILLING_CONNECTOR_CONTRACT,
    operations: [operation]
  })
  const parsedOperation = operationEnvelope.operations[0]
  const reviewed = requiredOperation(parsedOperation.operationId)
  if (JSON.stringify(parsedOperation) !== REVIEWED_OPERATION_JSON[reviewed.operationId]) {
    throw new Error('Stripe Billing operation does not match its reviewed authority')
  }
  return reviewed
}

function parsedParameters(
  context: PrepareConnectorRequestContext,
  operation: PluginConnectorOperationV1
): Readonly<{ [key: string]: PluginParameterValue }> {
  return parsePluginObjectParameterValue(
    context.parameters,
    operation.parameters.schema,
    operation.parameters.maxBytes,
    `Stripe ${operation.operationId} parameters`
  )
}

function prepareProductOrPrice(
  context: PrepareConnectorRequestContext,
  operation: PluginConnectorOperationV1
): PreparedConnectorRequest {
  const parameters = parsedParameters(context, operation)
  const product = operation.operationId === STRIPE_GET_PRODUCT_OPERATION_ID
  const parameterName = product ? 'productId' : 'priceId'
  const pattern = product ? PRODUCT_ID : PRICE_ID
  const identifier = patternedString(parameters[parameterName], pattern, `Stripe ${parameterName}`)
  const collection = product ? 'products' : 'prices'
  return Object.freeze({
    url: `${STRIPE_API_ORIGIN}/v1/${collection}/${encodeURIComponent(identifier)}`
  })
}

function checkoutMode(value: unknown, path: string): 'payment' | 'subscription' {
  return enumString(value, CHECKOUT_MODES, path)
}

function prepareCheckoutSession(
  context: PrepareConnectorRequestContext,
  operation: PluginConnectorOperationV1
): PreparedConnectorRequest {
  const parameters = parsedParameters(context, operation)
  const priceId = patternedString(parameters.priceId, PRICE_ID, 'Stripe checkout priceId')
  const quantity = boundedInteger(
    parameters.quantity,
    'Stripe checkout quantity',
    1,
    STRIPE_BILLING_LIMITS.quantity
  )
  const mode = checkoutMode(parameters.mode, 'Stripe checkout mode')
  const successURL = canonicalPublicHttpsURL(
    parameters.successUrl,
    'Stripe checkout successUrl',
    STRIPE_BILLING_LIMITS.publicUrlLength
  )
  const cancelURL = canonicalPublicHttpsURL(
    parameters.cancelUrl,
    'Stripe checkout cancelUrl',
    STRIPE_BILLING_LIMITS.publicUrlLength
  )
  const body = new URLSearchParams()
  body.set('mode', mode)
  body.set('line_items[0][price]', priceId)
  body.set('line_items[0][quantity]', String(quantity))
  body.set('success_url', successURL)
  body.set('cancel_url', cancelURL)
  const encoded = body.toString()
  if (TEXT_ENCODER.encode(encoded).byteLength > STRIPE_BILLING_LIMITS.requestBodyBytes) {
    throw new TypeError('Stripe Checkout Session request exceeds the body limit')
  }
  return Object.freeze({
    url: `${STRIPE_API_ORIGIN}/v1/checkout/sessions`,
    headers: Object.freeze({
      'Content-Type': 'application/x-www-form-urlencoded',
      ...(context.mutationAttemptId ? { 'Idempotency-Key': context.mutationAttemptId } : {})
    }),
    body: encoded
  })
}

function output(
  value: unknown,
  operation: PluginConnectorOperationV1,
  path: string
): Readonly<{ [key: string]: PluginParameterValue }> {
  return parsePluginObjectParameterValue(
    value,
    operation.result.schema,
    operation.result.maxBytes,
    path
  )
}

function optionalText(value: unknown, path: string, maximum: number): string | undefined {
  return value === undefined || value === null ? undefined : boundedString(value, path, maximum, 0)
}

export function normalizeStripeProductResponse(
  value: unknown
): Readonly<{ [key: string]: PluginParameterValue }> {
  const source = stripeResponseRecord(value, 'Stripe product response')
  assertObjectType(source, 'product', 'Stripe product response')
  const description = optionalText(
    source.description,
    'Stripe product response.description',
    STRIPE_BILLING_LIMITS.descriptionLength
  )
  const defaultPriceId =
    source.default_price === undefined || source.default_price === null
      ? undefined
      : patternedString(source.default_price, PRICE_ID, 'Stripe product response.default_price')
  return output(
    {
      id: patternedString(source.id, PRODUCT_ID, 'Stripe product response.id'),
      active: booleanValue(source.active, 'Stripe product response.active'),
      name: boundedString(
        source.name,
        'Stripe product response.name',
        STRIPE_BILLING_LIMITS.displayNameLength
      ),
      ...(description === undefined ? {} : { description }),
      ...(defaultPriceId === undefined ? {} : { defaultPriceId }),
      livemode: booleanValue(source.livemode, 'Stripe product response.livemode'),
      created: boundedInteger(
        source.created,
        'Stripe product response.created',
        0,
        STRIPE_BILLING_LIMITS.unixTimestamp
      )
    },
    STRIPE_GET_PRODUCT_OPERATION,
    'Stripe normalized product result'
  )
}

const PRICE_TYPES = new Set(['one_time', 'recurring'] as const)
const RECURRING_INTERVALS = new Set(['day', 'week', 'month', 'year'] as const)

function normalizedRecurring(
  value: unknown,
  priceType: 'one_time' | 'recurring'
): Readonly<{ recurringInterval?: string; recurringIntervalCount?: number }> {
  if (priceType === 'one_time') {
    if (value !== undefined && value !== null) {
      throw new TypeError('Stripe price response.recurring must be null for a one-time price')
    }
    return Object.freeze({})
  }
  const source = stripeResponseRecord(value, 'Stripe price response.recurring')
  return Object.freeze({
    recurringInterval: enumString(
      source.interval,
      RECURRING_INTERVALS,
      'Stripe price response.recurring.interval'
    ),
    recurringIntervalCount: boundedInteger(
      source.interval_count,
      'Stripe price response.recurring.interval_count',
      1,
      36
    )
  })
}

export function normalizeStripePriceResponse(
  value: unknown
): Readonly<{ [key: string]: PluginParameterValue }> {
  const source = stripeResponseRecord(value, 'Stripe price response')
  assertObjectType(source, 'price', 'Stripe price response')
  const priceType = enumString(source.type, PRICE_TYPES, 'Stripe price response.type')
  const recurring = normalizedRecurring(source.recurring, priceType)
  const unitAmount =
    source.unit_amount === undefined || source.unit_amount === null
      ? undefined
      : boundedInteger(
          source.unit_amount,
          'Stripe price response.unit_amount',
          0,
          STRIPE_BILLING_LIMITS.unitAmount
        )
  const currency = boundedString(source.currency, 'Stripe price response.currency', 3, 3)
  if (!CURRENCY.test(currency)) {
    throw new TypeError('Stripe price response.currency must be a lowercase currency code')
  }
  return output(
    {
      id: patternedString(source.id, PRICE_ID, 'Stripe price response.id'),
      active: booleanValue(source.active, 'Stripe price response.active'),
      currency,
      ...(unitAmount === undefined ? {} : { unitAmount }),
      type: priceType,
      ...recurring,
      productId: patternedString(source.product, PRODUCT_ID, 'Stripe price response.product'),
      livemode: booleanValue(source.livemode, 'Stripe price response.livemode'),
      created: boundedInteger(
        source.created,
        'Stripe price response.created',
        0,
        STRIPE_BILLING_LIMITS.unixTimestamp
      )
    },
    STRIPE_GET_PRICE_OPERATION,
    'Stripe normalized price result'
  )
}

const CHECKOUT_STATUSES = new Set(['open', 'complete', 'expired'] as const)
const PAYMENT_STATUSES = new Set(['paid', 'unpaid', 'no_payment_required'] as const)

export function normalizeStripeCheckoutSessionResponse(
  value: unknown,
  expectedMode?: 'payment' | 'subscription'
): Readonly<{ [key: string]: PluginParameterValue }> {
  const source = stripeResponseRecord(value, 'Stripe Checkout Session response')
  assertObjectType(source, 'checkout.session', 'Stripe Checkout Session response')
  const mode = checkoutMode(source.mode, 'Stripe Checkout Session response.mode')
  if (expectedMode !== undefined && mode !== expectedMode) {
    throw new TypeError('Stripe Checkout Session response.mode does not match the request')
  }
  return output(
    {
      id: patternedString(source.id, CHECKOUT_SESSION_ID, 'Stripe Checkout Session response.id'),
      url: stripeCheckoutURL(source.url, 'Stripe Checkout Session response.url'),
      status: enumString(
        source.status,
        CHECKOUT_STATUSES,
        'Stripe Checkout Session response.status'
      ),
      paymentStatus: enumString(
        source.payment_status,
        PAYMENT_STATUSES,
        'Stripe Checkout Session response.payment_status'
      ),
      mode,
      livemode: booleanValue(source.livemode, 'Stripe Checkout Session response.livemode'),
      expiresAt: boundedInteger(
        source.expires_at,
        'Stripe Checkout Session response.expires_at',
        0,
        STRIPE_BILLING_LIMITS.unixTimestamp
      )
    },
    STRIPE_CREATE_CHECKOUT_SESSION_OPERATION,
    'Stripe normalized Checkout Session result'
  )
}

function transformStripeResponse(
  value: unknown,
  context: PrepareConnectorRequestContext
): PluginParameterValue {
  const operation = assertReviewedAuthority(context.contract, context.operation)
  if (operation.operationId === STRIPE_GET_PRODUCT_OPERATION_ID) {
    return normalizeStripeProductResponse(value)
  }
  if (operation.operationId === STRIPE_GET_PRICE_OPERATION_ID) {
    return normalizeStripePriceResponse(value)
  }
  const parameters = parsedParameters(context, operation)
  const mode = checkoutMode(parameters.mode, 'Stripe checkout mode')
  return normalizeStripeCheckoutSessionResponse(value, mode)
}

export interface StripeBillingConnectorAdapter extends ConnectorHostAdapter {
  normalizeProductResponse(value: unknown): Readonly<{ [key: string]: PluginParameterValue }>
  normalizePriceResponse(value: unknown): Readonly<{ [key: string]: PluginParameterValue }>
  normalizeCheckoutSessionResponse(
    value: unknown,
    expectedMode?: 'payment' | 'subscription'
  ): Readonly<{ [key: string]: PluginParameterValue }>
}

/**
 * Host-reviewed Stripe adapter. It shapes fixed requests and responses but never receives or stores
 * the Stripe secret; the execution broker injects the declared bearer credential at call time.
 */
export const STRIPE_BILLING_CONNECTOR_ADAPTER: StripeBillingConnectorAdapter = Object.freeze({
  pluginId: STRIPE_BILLING_PLUGIN_ID,
  connectorId: STRIPE_BILLING_CONNECTOR_ID,
  adapterId: STRIPE_BILLING_ADAPTER_ID,
  contract: STRIPE_BILLING_CONNECTOR_CONTRACT,
  async prepare(context: PrepareConnectorRequestContext): Promise<PreparedConnectorRequest> {
    context.signal.throwIfAborted()
    const operation = assertReviewedAuthority(context.contract, context.operation)
    const prepared =
      operation.operationId === STRIPE_CREATE_CHECKOUT_SESSION_OPERATION_ID
        ? prepareCheckoutSession(context, operation)
        : prepareProductOrPrice(context, operation)
    context.signal.throwIfAborted()
    return prepared
  },
  transformResponse(value: unknown, context: PrepareConnectorRequestContext): PluginParameterValue {
    context.signal.throwIfAborted()
    const normalized = transformStripeResponse(value, context)
    context.signal.throwIfAborted()
    return normalized
  },
  normalizeProductResponse: normalizeStripeProductResponse,
  normalizePriceResponse: normalizeStripePriceResponse,
  normalizeCheckoutSessionResponse: normalizeStripeCheckoutSessionResponse
})
