import { encodeBase64URL } from '@open-pencil/scene-graph'

import {
  supabaseManagementNativeBridge,
  SupabaseManagementNativeError,
  type SupabaseManagementNativeBridge,
  type SupabaseManagementPgCatalogInspectRequestV1,
  type SupabaseManagementPgCatalogInspectResultV1
} from '@/app/tauri/supabase-management'

import {
  parseSupabasePgCatalogAggregateResponse,
  SUPABASE_PG_CATALOG_AGGREGATE_SQL,
  SUPABASE_PG_CATALOG_AGGREGATE_PARAMETERS,
  SupabaseManagementPgCatalogTransportError
} from './management/pg-catalog-transport'
import {
  SUPABASE_PG_CATALOG_QUERY_VERSION,
  type SupabasePgCatalogHostTransport,
  type SupabasePgCatalogProjectAuthority,
  type SupabasePgCatalogProjectAuthorityRequest,
  type SupabasePgCatalogReadRequest,
  type SupabasePgCatalogReadResult
} from './pg-catalog-inspector'

const PROJECT_REF = /^[a-z]{20}$/u
const AUTHORITY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u
const DIGEST = /^[A-Za-z0-9_-]{43}$/u

export interface CreateNativeSupabaseManagementPgCatalogTransportOptions {
  /** `null` permits initial review discovery; verification/release must pass a known ID. */
  readonly expectedOrganizationId: string | null
  readonly signal?: AbortSignal
}

export interface CreateNativeSupabaseManagementPgCatalogTransportForTestingOptionsV1 extends CreateNativeSupabaseManagementPgCatalogTransportOptions {
  readonly bridge: SupabaseManagementNativeBridge
}

interface NativeInspectionSnapshot {
  readonly authority: SupabasePgCatalogProjectAuthority
  readonly queryResponse: unknown
}

type UnknownRecord = Record<string, unknown>

type FactorySnapshot = CreateNativeSupabaseManagementPgCatalogTransportOptions

const PRODUCTION_FACTORY_KEYS = ['expectedOrganizationId', 'signal'] as const
const TESTING_FACTORY_KEYS = ['expectedOrganizationId', 'bridge', 'signal'] as const
const productionTransports = new WeakSet<object>()

function fail(code: 'invalid-authority' | 'invalid-request' | 'invalid-response'): never {
  throw new SupabaseManagementPgCatalogTransportError(code)
}

function exactRecord(value: unknown, keys: readonly string[]): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail('invalid-response')
  }
  let prototype: object | null
  let ownKeys: readonly PropertyKey[]
  try {
    prototype = Object.getPrototypeOf(value)
    ownKeys = Reflect.ownKeys(value)
  } catch {
    return fail('invalid-response')
  }
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    ownKeys.length !== keys.length ||
    ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))
  ) {
    return fail('invalid-response')
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      return fail('invalid-response')
    }
  }
  return value as UnknownRecord
}

function data(source: UnknownRecord, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(source, key)
  return descriptor && Object.hasOwn(descriptor, 'value')
    ? descriptor.value
    : fail('invalid-response')
}

function exactFactoryRecord(
  value: unknown,
  allowedKeys: readonly string[],
  requiredKeys: readonly string[]
): UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail('invalid-authority')
  }
  let prototype: object | null
  let ownKeys: readonly PropertyKey[]
  try {
    prototype = Object.getPrototypeOf(value)
    ownKeys = Reflect.ownKeys(value)
  } catch {
    return fail('invalid-authority')
  }
  if (
    (prototype !== Object.prototype && prototype !== null) ||
    ownKeys.some((key) => typeof key !== 'string' || !allowedKeys.includes(key)) ||
    requiredKeys.some((key) => !ownKeys.includes(key))
  ) {
    return fail('invalid-authority')
  }
  const source = value as UnknownRecord
  for (const key of ownKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(source, key)
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      return fail('invalid-authority')
    }
  }
  return source
}

function factoryData(source: UnknownRecord, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(source, key)
  return descriptor && Object.hasOwn(descriptor, 'value')
    ? descriptor.value
    : fail('invalid-authority')
}

function factorySnapshot(source: UnknownRecord): FactorySnapshot {
  const expectedOrganizationId = factoryData(source, 'expectedOrganizationId')
  const signal = Object.hasOwn(source, 'signal') ? factoryData(source, 'signal') : undefined
  if (
    (expectedOrganizationId !== null &&
      (typeof expectedOrganizationId !== 'string' || !AUTHORITY_ID.test(expectedOrganizationId))) ||
    (signal !== undefined && !(signal instanceof AbortSignal))
  ) {
    return fail('invalid-authority')
  }
  return Object.freeze({ expectedOrganizationId, ...(signal ? { signal } : {}) })
}

function testingBridge(value: unknown): SupabaseManagementNativeBridge {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return fail('invalid-authority')
  }
  let prototype: object | null
  let descriptor: PropertyDescriptor | undefined
  try {
    prototype = Object.getPrototypeOf(value)
    descriptor = Object.getOwnPropertyDescriptor(value, 'inspectPgCatalogV1')
  } catch {
    return fail('invalid-authority')
  }
  if (prototype !== Object.prototype && prototype !== null) return fail('invalid-authority')
  if (!descriptor?.enumerable || typeof descriptor.value !== 'function') {
    return fail('invalid-authority')
  }
  const inspectPgCatalogV1 =
    descriptor.value as SupabaseManagementNativeBridge['inspectPgCatalogV1']
  const snapshot: SupabaseManagementNativeBridge = Object.freeze({
    inspectPgCatalogV1(request: SupabaseManagementPgCatalogInspectRequestV1, signal?: AbortSignal) {
      return Reflect.apply(inspectPgCatalogV1, value, [request, signal])
    }
  })
  return snapshot
}

async function aggregateQueryDigest(): Promise<string> {
  try {
    const encoded = new TextEncoder().encode(
      JSON.stringify({
        query: SUPABASE_PG_CATALOG_AGGREGATE_SQL,
        parameters: SUPABASE_PG_CATALOG_AGGREGATE_PARAMETERS
      })
    )
    const source = new Uint8Array(encoded.byteLength)
    source.set(encoded)
    return encodeBase64URL(new Uint8Array(await crypto.subtle.digest('SHA-256', source)))
  } catch {
    return fail('invalid-response')
  }
}

async function nativeSnapshot(
  value: SupabaseManagementPgCatalogInspectResultV1,
  expected: Readonly<{
    projectRef: string
    organizationId: string | null
    grantGeneration: string
  }>
): Promise<NativeInspectionSnapshot> {
  const source = exactRecord(value, [
    'projectRef',
    'organizationId',
    'grantGeneration',
    'queryVersion',
    'queryDigest',
    'queryResponse'
  ])
  const projectRef = data(source, 'projectRef')
  const organizationId = data(source, 'organizationId')
  const grantGeneration = data(source, 'grantGeneration')
  const queryVersion = data(source, 'queryVersion')
  const queryDigest = data(source, 'queryDigest')
  if (
    projectRef !== expected.projectRef ||
    typeof organizationId !== 'string' ||
    !AUTHORITY_ID.test(organizationId) ||
    (expected.organizationId !== null && organizationId !== expected.organizationId) ||
    grantGeneration !== expected.grantGeneration ||
    queryVersion !== SUPABASE_PG_CATALOG_QUERY_VERSION ||
    typeof queryDigest !== 'string' ||
    !DIGEST.test(queryDigest) ||
    queryDigest !== (await aggregateQueryDigest())
  ) {
    return fail('invalid-authority')
  }
  return Object.freeze({
    authority: Object.freeze({
      projectRef: expected.projectRef,
      organizationId,
      grantGeneration: expected.grantGeneration
    }),
    queryResponse: data(source, 'queryResponse')
  })
}

/**
 * Adapts one native composite inspection to the two-step inspector interface.
 * SQL, credentials, URL, HTTP method, response bounds and redirect policy never cross IPC.
 */
function createTransport(
  options: FactorySnapshot,
  bridge: SupabaseManagementNativeBridge
): SupabasePgCatalogHostTransport {
  let state: 'ready' | 'loading' | 'loaded' | 'consumed' = 'ready'
  let snapshot: NativeInspectionSnapshot | null = null

  return Object.freeze({
    async getProjectAuthority(
      request: SupabasePgCatalogProjectAuthorityRequest
    ): Promise<SupabasePgCatalogProjectAuthority> {
      if (
        state !== 'ready' ||
        !PROJECT_REF.test(request.projectRef) ||
        !UUID_V4.test(request.grantGeneration)
      ) {
        return fail('invalid-request')
      }
      state = 'loading'
      try {
        const result = await bridge.inspectPgCatalogV1(
          {
            projectRef: request.projectRef,
            expectedOrganizationId: options.expectedOrganizationId,
            expectedGrantGeneration: request.grantGeneration
          },
          options.signal
        )
        snapshot = await nativeSnapshot(result, {
          projectRef: request.projectRef,
          organizationId: options.expectedOrganizationId,
          grantGeneration: request.grantGeneration
        })
        state = 'loaded'
        return snapshot.authority
      } catch (cause) {
        state = 'consumed'
        snapshot = null
        if (
          cause instanceof SupabaseManagementNativeError ||
          cause instanceof SupabaseManagementPgCatalogTransportError ||
          cause instanceof DOMException
        ) {
          throw cause
        }
        throw new SupabaseManagementPgCatalogTransportError('network-failed')
      }
    },

    async runReadOnlyCatalogQueries(
      request: SupabasePgCatalogReadRequest
    ): Promise<SupabasePgCatalogReadResult> {
      if (state !== 'loaded' || snapshot === null) return fail('invalid-request')
      const current = snapshot
      state = 'consumed'
      snapshot = null
      return parseSupabasePgCatalogAggregateResponse(
        current.queryResponse,
        request,
        current.authority
      )
    }
  })
}

/** Production factory: the module-owned native singleton is the only transport authority. */
export function createNativeSupabaseManagementPgCatalogTransport(
  options: CreateNativeSupabaseManagementPgCatalogTransportOptions
): SupabasePgCatalogHostTransport {
  const source = exactFactoryRecord(options, PRODUCTION_FACTORY_KEYS, ['expectedOrganizationId'])
  const transport = createTransport(factorySnapshot(source), supabaseManagementNativeBridge)
  productionTransports.add(transport)
  return transport
}

/** Explicit fake-native seam; transports created here never receive the production identity brand. */
export function createNativeSupabaseManagementPgCatalogTransportForTestingV1(
  options: CreateNativeSupabaseManagementPgCatalogTransportForTestingOptionsV1
): SupabasePgCatalogHostTransport {
  const source = exactFactoryRecord(options, TESTING_FACTORY_KEYS, [
    'expectedOrganizationId',
    'bridge'
  ])
  const bridge = testingBridge(factoryData(source, 'bridge'))
  return createTransport(factorySnapshot(source), bridge)
}

/** Identity-only production provenance check; structural clones and testing transports fail. */
export function isProductionNativeSupabaseManagementPgCatalogTransportV1(
  value: unknown
): value is SupabasePgCatalogHostTransport {
  return value !== null && typeof value === 'object' && productionTransports.has(value)
}
