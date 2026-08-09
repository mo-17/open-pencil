/* eslint-disable max-lines -- Contract parsing and authority comparison form one security boundary. */
import {
  parseBoundedManifestArray as array,
  parseExactManifestRecord as record
} from '@open-pencil/scene-graph'

import {
  PLUGIN_PARAMETER_VALUE_LIMITS,
  parsePluginObjectParameterSchema,
  type PluginContributionDataContractV2,
  type PluginObjectParameterSchemaV2,
  type PluginParameterValue
} from './parameter-schema'

export const PLUGIN_CONNECTOR_CONTRACT_FORMAT = 'openpencil-plugin-connector-contract' as const
export const PLUGIN_CONNECTOR_CONTRACT_SCHEMA_VERSION = 1 as const

export const PLUGIN_CONNECTOR_CONTRACT_LIMITS = Object.freeze({
  maxBytes: 64 * 1024,
  maxOrigins: 16,
  maxOriginTemplates: 16,
  maxOperations: 32,
  maxCredentialSlots: 16,
  maxOAuthScopes: 64,
  maxUpstreamResponseBytes: 4 * 1024 * 1024,
  maxIdLength: 64,
  maxNameLength: 128,
  maxDescriptionLength: 1_000,
  maxScopeLength: 128
})

export type PluginConnectorKindV1 = 'data-source' | 'action' | 'asset-provider'
export type PluginConnectorOperationKindV1 = 'query' | 'mutation' | 'asset-search' | 'asset-read'
export type PluginConnectorCredentialKindV1 = 'api-key' | 'bearer-token' | 'oauth2'
export type PluginConnectorHttpMethodV1 = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type PluginConnectorDataContractV1 = PluginContributionDataContractV2

export interface PluginConnectorOAuth2PolicyV1 {
  readonly authorizationOrigin: string
  readonly tokenOrigin: string
  readonly scopes: readonly string[]
  readonly pkceRequired: true
}

export interface PluginConnectorCredentialSlotV1 {
  readonly slotId: string
  readonly label: string
  readonly kind: PluginConnectorCredentialKindV1
  readonly required: boolean
  readonly oauth2?: PluginConnectorOAuth2PolicyV1
  /** Reviewed host injection. Only API-key slots may declare this metadata. */
  readonly injection?: PluginConnectorCredentialHeaderInjectionV1
}

export interface PluginConnectorCredentialHeaderInjectionV1 {
  readonly location: 'header'
  /** Canonical lowercase HTTP header name. Host-reserved headers are rejected. */
  readonly name: string
}

export interface PluginConnectorNetworkPolicyV1 {
  readonly origins: readonly string[]
  /** Reviewed dynamic HTTPS origins with whole-hostname-label placeholders. */
  readonly originTemplates?: readonly string[]
  readonly methods: readonly PluginConnectorHttpMethodV1[]
  readonly credentials: 'omit'
  readonly redirects: 'error'
}

export interface PluginConnectorOperationRequestV1 {
  /** Exact reviewed origin. Exactly one of origin/originTemplate is present. */
  readonly origin?: string
  /** Reviewed dynamic origin. The broker substitutes validated hostname-label parameters. */
  readonly originTemplate?: string
  /** Exact reviewed method. It must also be present in the connector network policy. */
  readonly method: PluginConnectorHttpMethodV1
  /**
   * Root-relative path made from safe literal segments and whole-segment parameter placeholders,
   * for example `/v0/{baseId}/{tableId}`. Query parameters remain adapter-owned but the broker
   * revalidates the final origin and path before every request.
   */
  readonly pathTemplate: string
  /** Raw upstream response budget. The transformed result still uses `operation.result.maxBytes`. */
  readonly maxResponseBytes?: number
}

export interface PluginConnectorOperationV1 {
  readonly operationId: string
  readonly name: string
  readonly description: string
  readonly kind: PluginConnectorOperationKindV1
  readonly credentialSlots: readonly string[]
  /** Optional only for backwards-compatible parsing; the execution broker requires it. */
  readonly request?: PluginConnectorOperationRequestV1
  readonly parameters: PluginConnectorDataContractV1
  readonly result: PluginConnectorDataContractV1
}

export interface PluginConnectorContractV1 {
  readonly format: typeof PLUGIN_CONNECTOR_CONTRACT_FORMAT
  readonly schemaVersion: typeof PLUGIN_CONNECTOR_CONTRACT_SCHEMA_VERSION
  readonly pluginId: string
  readonly connectorId: string
  readonly adapterId: string
  readonly name: string
  readonly description: string
  readonly kind: PluginConnectorKindV1
  readonly network: PluginConnectorNetworkPolicyV1
  readonly credentialSlots: readonly PluginConnectorCredentialSlotV1[]
  readonly operations: readonly PluginConnectorOperationV1[]
}

const ROOT_KEYS = new Set([
  'format',
  'schemaVersion',
  'pluginId',
  'connectorId',
  'adapterId',
  'name',
  'description',
  'kind',
  'network',
  'credentialSlots',
  'operations'
])
const NETWORK_KEYS = new Set(['origins', 'originTemplates', 'methods', 'credentials', 'redirects'])
const NETWORK_REQUIRED_KEYS = new Set(['origins', 'methods', 'credentials', 'redirects'])
const CREDENTIAL_KEYS = new Set(['slotId', 'label', 'kind', 'required', 'oauth2', 'injection'])
const CREDENTIAL_REQUIRED_KEYS = new Set(['slotId', 'label', 'kind', 'required'])
const CREDENTIAL_INJECTION_KEYS = new Set(['location', 'name'])
const OAUTH_KEYS = new Set(['authorizationOrigin', 'tokenOrigin', 'scopes', 'pkceRequired'])
const OPERATION_KEYS = new Set([
  'operationId',
  'name',
  'description',
  'kind',
  'credentialSlots',
  'request',
  'parameters',
  'result'
])
const OPERATION_REQUIRED_KEYS = new Set([
  'operationId',
  'name',
  'description',
  'kind',
  'credentialSlots',
  'parameters',
  'result'
])
const REQUEST_KEYS = new Set([
  'origin',
  'originTemplate',
  'method',
  'pathTemplate',
  'maxResponseBytes'
])
const REQUEST_REQUIRED_KEYS = new Set(['method', 'pathTemplate'])
const DATA_CONTRACT_KEYS = new Set(['schema', 'maxBytes'])
const CONNECTOR_KINDS = new Set<PluginConnectorKindV1>(['data-source', 'action', 'asset-provider'])
const OPERATION_KINDS = new Set<PluginConnectorOperationKindV1>([
  'query',
  'mutation',
  'asset-search',
  'asset-read'
])
const CREDENTIAL_KINDS = new Set<PluginConnectorCredentialKindV1>([
  'api-key',
  'bearer-token',
  'oauth2'
])
const HTTP_METHODS = new Set<PluginConnectorHttpMethodV1>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
const IDENTIFIER = /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/
const OAUTH_SCOPE = /^[A-Za-z0-9](?:[A-Za-z0-9._:/-]{0,126}[A-Za-z0-9])?$/
const IPV4_LITERAL = /^(?:\d{1,3}\.){3}\d{1,3}$/
const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const ORIGIN_TEMPLATE_PARAMETER_LABEL = /^\{([A-Za-z][A-Za-z0-9_]{0,63})\}$/
const PATH_LITERAL_SEGMENT = /^[A-Za-z0-9](?:[A-Za-z0-9._~-]{0,126}[A-Za-z0-9_~-])?$/
const PATH_PARAMETER_SEGMENT = /^\{([A-Za-z][A-Za-z0-9_]{0,63})\}$/
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9a-z-]+$/
const FORBIDDEN_CREDENTIAL_HEADERS = new Set([
  'authorization',
  'connection',
  'content-length',
  'cookie',
  'host',
  'origin',
  'proxy-authorization',
  'referer',
  'set-cookie',
  'trailer',
  'transfer-encoding',
  'upgrade'
])
const TEXT_ENCODER = new TextEncoder()
const SPECIAL_USE_DNS_SUFFIXES = Object.freeze([
  'arpa',
  'example',
  'internal',
  'invalid',
  'lan',
  'local',
  'localhost',
  'onion',
  'test'
])

function boundedText(value: unknown, path: string, maximum: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maximum) {
    throw new TypeError(`${path} must be a non-empty string with at most ${maximum} characters`)
  }
  if (/\p{Cc}/u.test(value)) throw new TypeError(`${path} must not contain control characters`)
  return value.normalize('NFC')
}

function identity(value: unknown, path: string): string {
  const parsed = boundedText(value, path, PLUGIN_CONNECTOR_CONTRACT_LIMITS.maxIdLength)
  if (!IDENTIFIER.test(parsed)) throw new TypeError(`${path} must be a stable lowercase identifier`)
  return parsed
}

function uniqueStrings<T extends string>(values: readonly T[], path: string): readonly T[] {
  if (new Set(values).size !== values.length)
    throw new TypeError(`${path} must not contain duplicates`)
  return Object.freeze([...values])
}

function httpsOrigin(value: unknown, path: string): string {
  const source = boundedText(value, path, 2_048)
  let parsed: URL
  try {
    parsed = new URL(source)
  } catch {
    throw new TypeError(`${path} must be a canonical HTTPS origin`)
  }
  const hostname = parsed.hostname.toLowerCase()
  const hostnameLabels = hostname.split('.')
  const specialUseHostname = SPECIAL_USE_DNS_SUFFIXES.some(
    (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`)
  )
  if (
    parsed.protocol !== 'https:' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.port !== '' ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    parsed.origin !== source ||
    hostnameLabels.length < 2 ||
    hostnameLabels.some((label) => !DNS_LABEL.test(label) || label.startsWith('xn--')) ||
    specialUseHostname ||
    IPV4_LITERAL.test(hostname) ||
    hostname.includes(':')
  ) {
    throw new TypeError(`${path} must be a canonical public HTTPS origin`)
  }
  return source
}

interface ReviewedOriginTemplate {
  readonly template: string
  readonly placeholders: readonly string[]
}

function reviewedOriginTemplate(value: unknown, path: string): ReviewedOriginTemplate {
  const template = boundedText(value, path, 2_048)
  if (!template.startsWith('https://')) {
    throw new TypeError(`${path} must be a canonical HTTPS origin template`)
  }
  const hostname = template.slice('https://'.length)
  if (
    hostname.length === 0 ||
    hostname.length > 253 ||
    /[/@:%?#\\]/.test(hostname) ||
    hostname.startsWith('.') ||
    hostname.endsWith('.')
  ) {
    throw new TypeError(`${path} must contain only canonical hostname labels`)
  }
  const labels = hostname.split('.')
  if (labels.length < 3) {
    throw new TypeError(`${path} must retain at least two fixed trailing hostname labels`)
  }
  const placeholders: string[] = []
  for (const [index, label] of labels.entries()) {
    const parameter = ORIGIN_TEMPLATE_PARAMETER_LABEL.exec(label)?.[1]
    if (parameter) {
      if (index >= labels.length - 2) {
        throw new TypeError(`${path} must retain at least two fixed trailing hostname labels`)
      }
      if (placeholders.includes(parameter)) {
        throw new TypeError(`${path} must not repeat placeholder ${parameter}`)
      }
      placeholders.push(parameter)
      continue
    }
    if (!DNS_LABEL.test(label) || label.startsWith('xn--')) {
      throw new TypeError(`${path} contains an invalid literal hostname label`)
    }
  }
  if (placeholders.length === 0) {
    throw new TypeError(`${path} must contain at least one whole-label placeholder`)
  }
  const probe = template.replace(/\{([A-Za-z][A-Za-z0-9_]{0,63})\}/g, 'openpencil-placeholder')
  httpsOrigin(probe, path)
  return Object.freeze({ template, placeholders: Object.freeze(placeholders) })
}

/** Resolve a previously reviewed template without granting the caller any URL authority. */
export function resolvePluginConnectorOriginTemplate(
  template: string,
  parameters: Readonly<Record<string, PluginParameterValue | undefined>>
): string {
  const reviewed = reviewedOriginTemplate(template, 'pluginConnectorOriginTemplate')
  const resolved = reviewed.template.replace(
    /\{([A-Za-z][A-Za-z0-9_]{0,63})\}/g,
    (_, parameter: string) => {
      const value = parameters[parameter]
      if (typeof value !== 'string' || !DNS_LABEL.test(value) || value.startsWith('xn--')) {
        throw new TypeError(
          `pluginConnectorOriginTemplate parameter ${parameter} must be a canonical DNS label`
        )
      }
      return value
    }
  )
  return httpsOrigin(resolved, 'pluginConnectorOriginTemplate resolved origin')
}

function credentialHeaderInjection(
  value: unknown,
  path: string
): PluginConnectorCredentialHeaderInjectionV1 {
  const source = record(value, path, CREDENTIAL_INJECTION_KEYS, CREDENTIAL_INJECTION_KEYS)
  if (source.location !== 'header') throw new TypeError(`${path}.location must be header`)
  const name = boundedText(source.name, `${path}.name`, 128)
  if (
    name !== name.toLowerCase() ||
    !HEADER_NAME.test(name) ||
    FORBIDDEN_CREDENTIAL_HEADERS.has(name) ||
    name.startsWith('proxy-') ||
    name.startsWith('sec-')
  ) {
    throw new TypeError(`${path}.name is not an allowed credential header`)
  }
  return Object.freeze({ location: 'header', name })
}

function stringArray(
  value: unknown,
  path: string,
  maximum: number,
  parse: (entry: unknown, entryPath: string) => string,
  minimum = 0
): readonly string[] {
  const source = array(value, path, maximum)
  if (source.length < minimum) throw new TypeError(`${path} must contain at least ${minimum} entry`)
  return uniqueStrings(
    source.map((entry, index) => parse(entry, `${path}[${index}]`)),
    path
  )
}

function dataContract(value: unknown, path: string): PluginConnectorDataContractV1 {
  const source = record(value, path, DATA_CONTRACT_KEYS)
  if (
    !Number.isSafeInteger(source.maxBytes) ||
    (source.maxBytes as number) < 2 ||
    (source.maxBytes as number) > PLUGIN_PARAMETER_VALUE_LIMITS.maxBytes
  ) {
    throw new TypeError(
      `${path}.maxBytes must be between 2 and ${PLUGIN_PARAMETER_VALUE_LIMITS.maxBytes}`
    )
  }
  return Object.freeze({
    schema: parsePluginObjectParameterSchema(source.schema, `${path}.schema`, {
      reserveAutomationTargets: true
    }),
    maxBytes: source.maxBytes as number
  })
}

function oauth2Policy(value: unknown, path: string): PluginConnectorOAuth2PolicyV1 {
  const source = record(value, path, OAUTH_KEYS)
  if (source.pkceRequired !== true) throw new TypeError(`${path}.pkceRequired must be true`)
  const scopes = stringArray(
    source.scopes,
    `${path}.scopes`,
    PLUGIN_CONNECTOR_CONTRACT_LIMITS.maxOAuthScopes,
    (entry, entryPath) => {
      const parsed = boundedText(entry, entryPath, PLUGIN_CONNECTOR_CONTRACT_LIMITS.maxScopeLength)
      if (!OAUTH_SCOPE.test(parsed)) throw new TypeError(`${entryPath} is not a valid OAuth scope`)
      return parsed
    }
  )
  return Object.freeze({
    authorizationOrigin: httpsOrigin(source.authorizationOrigin, `${path}.authorizationOrigin`),
    tokenOrigin: httpsOrigin(source.tokenOrigin, `${path}.tokenOrigin`),
    scopes,
    pkceRequired: true
  })
}

function credentialSlot(value: unknown, path: string): PluginConnectorCredentialSlotV1 {
  const source = record(value, path, CREDENTIAL_KEYS, CREDENTIAL_REQUIRED_KEYS)
  if (typeof source.kind !== 'string' || !CREDENTIAL_KINDS.has(source.kind as never)) {
    throw new TypeError(`${path}.kind is not supported`)
  }
  if (typeof source.required !== 'boolean')
    throw new TypeError(`${path}.required must be a boolean`)
  const kind = source.kind as PluginConnectorCredentialKindV1
  if (kind === 'oauth2' && source.oauth2 === undefined) {
    throw new TypeError(`${path}.oauth2 is required for an OAuth credential slot`)
  }
  if (kind !== 'oauth2' && source.oauth2 !== undefined) {
    throw new TypeError(`${path}.oauth2 is only valid for an OAuth credential slot`)
  }
  if (kind !== 'api-key' && source.injection !== undefined) {
    throw new TypeError(`${path}.injection is only valid for an API-key credential slot`)
  }
  const injection =
    source.injection === undefined
      ? undefined
      : credentialHeaderInjection(source.injection, `${path}.injection`)
  return Object.freeze({
    slotId: identity(source.slotId, `${path}.slotId`),
    label: boundedText(
      source.label,
      `${path}.label`,
      PLUGIN_CONNECTOR_CONTRACT_LIMITS.maxNameLength
    ),
    kind,
    required: source.required,
    ...(kind === 'oauth2' ? { oauth2: oauth2Policy(source.oauth2, `${path}.oauth2`) } : {}),
    ...(injection === undefined ? {} : { injection })
  })
}

function networkPolicy(value: unknown, path: string): PluginConnectorNetworkPolicyV1 {
  const source = record(value, path, NETWORK_KEYS, NETWORK_REQUIRED_KEYS)
  if (source.credentials !== 'omit') throw new TypeError(`${path}.credentials must be omit`)
  if (source.redirects !== 'error') throw new TypeError(`${path}.redirects must be error`)
  const origins = stringArray(
    source.origins,
    `${path}.origins`,
    PLUGIN_CONNECTOR_CONTRACT_LIMITS.maxOrigins,
    httpsOrigin
  )
  const originTemplates =
    source.originTemplates === undefined
      ? Object.freeze([])
      : stringArray(
          source.originTemplates,
          `${path}.originTemplates`,
          PLUGIN_CONNECTOR_CONTRACT_LIMITS.maxOriginTemplates,
          (entry, entryPath) => reviewedOriginTemplate(entry, entryPath).template
        )
  if (origins.length + originTemplates.length === 0) {
    throw new TypeError(`${path} must declare at least one origin or origin template`)
  }
  const methods = stringArray(
    source.methods,
    `${path}.methods`,
    HTTP_METHODS.size,
    (entry, entryPath) => {
      if (typeof entry !== 'string' || !HTTP_METHODS.has(entry as never)) {
        throw new TypeError(`${entryPath} is not an allowed HTTP method`)
      }
      return entry
    },
    1
  ) as readonly PluginConnectorHttpMethodV1[]
  return Object.freeze({
    origins,
    ...(originTemplates.length === 0 ? {} : { originTemplates }),
    methods,
    credentials: 'omit',
    redirects: 'error'
  })
}

function reviewedRequestOrigin(
  value: unknown,
  path: string,
  network: PluginConnectorNetworkPolicyV1
): string {
  const origin = httpsOrigin(value, path)
  if (!network.origins.includes(origin)) {
    throw new TypeError(`${path} must be declared by the connector network policy`)
  }
  return origin
}

function reviewedRequestOriginTemplate(
  value: unknown,
  path: string,
  network: PluginConnectorNetworkPolicyV1,
  parameterSchema: PluginObjectParameterSchemaV2
): string {
  const reviewed = reviewedOriginTemplate(value, path)
  if (!network.originTemplates?.includes(reviewed.template)) {
    throw new TypeError(`${path} must be declared by the connector network policy`)
  }
  for (const parameter of reviewed.placeholders) {
    if (
      !Object.hasOwn(parameterSchema.properties, parameter) ||
      parameterSchema.properties[parameter].type !== 'string'
    ) {
      throw new TypeError(`${path} placeholder ${parameter} must reference a string parameter`)
    }
  }
  return reviewed.template
}

function reviewedRequestMethod(
  value: unknown,
  path: string,
  network: PluginConnectorNetworkPolicyV1
): PluginConnectorHttpMethodV1 {
  if (typeof value !== 'string' || !HTTP_METHODS.has(value as never)) {
    throw new TypeError(`${path} is not an allowed HTTP method`)
  }
  const method = value as PluginConnectorHttpMethodV1
  if (!network.methods.includes(method)) {
    throw new TypeError(`${path} must be declared by the connector network policy`)
  }
  return method
}

function reviewedPathTemplate(
  value: unknown,
  path: string,
  parameterSchema: PluginObjectParameterSchemaV2
): string {
  const pathTemplate = boundedText(value, path, 2_048)
  if (
    !pathTemplate.startsWith('/') ||
    pathTemplate.includes('\\') ||
    pathTemplate.includes('?') ||
    pathTemplate.includes('#') ||
    (pathTemplate.length > 1 && pathTemplate.endsWith('/'))
  ) {
    throw new TypeError(`${path} must be a canonical root-relative path template`)
  }
  const placeholders = new Set<string>()
  const segments = pathTemplate === '/' ? [] : pathTemplate.slice(1).split('/')
  for (const segment of segments) {
    const parameter = PATH_PARAMETER_SEGMENT.exec(segment)?.[1]
    if (parameter) {
      if (placeholders.has(parameter)) {
        throw new TypeError(`${path} must not repeat placeholder ${parameter}`)
      }
      if (!Object.hasOwn(parameterSchema.properties, parameter)) {
        throw new TypeError(`${path} placeholder ${parameter} must reference a scalar parameter`)
      }
      const schema = parameterSchema.properties[parameter]
      if (schema.type !== 'string' && schema.type !== 'number' && schema.type !== 'integer') {
        throw new TypeError(`${path} placeholder ${parameter} must reference a scalar parameter`)
      }
      placeholders.add(parameter)
      continue
    }
    if (
      segment === '' ||
      segment === '.' ||
      segment === '..' ||
      !PATH_LITERAL_SEGMENT.test(segment)
    ) {
      throw new TypeError(`${path} contains an unsafe path segment`)
    }
  }
  return pathTemplate
}

function reviewedResponseBudget(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined
  if (
    !Number.isSafeInteger(value) ||
    (value as number) < 2 ||
    (value as number) > PLUGIN_CONNECTOR_CONTRACT_LIMITS.maxUpstreamResponseBytes
  ) {
    throw new TypeError(
      `${path} must be between 2 and ${PLUGIN_CONNECTOR_CONTRACT_LIMITS.maxUpstreamResponseBytes}`
    )
  }
  return value as number
}

function operationRequest(
  value: unknown,
  path: string,
  network: PluginConnectorNetworkPolicyV1,
  parameterSchema: PluginObjectParameterSchemaV2
): PluginConnectorOperationRequestV1 {
  const source = record(value, path, REQUEST_KEYS, REQUEST_REQUIRED_KEYS)
  const hasOrigin = source.origin !== undefined
  const hasOriginTemplate = source.originTemplate !== undefined
  if (hasOrigin === hasOriginTemplate) {
    throw new TypeError(`${path} must declare exactly one of origin or originTemplate`)
  }
  const origin = hasOrigin
    ? reviewedRequestOrigin(source.origin, `${path}.origin`, network)
    : undefined
  const originTemplate = hasOriginTemplate
    ? reviewedRequestOriginTemplate(
        source.originTemplate,
        `${path}.originTemplate`,
        network,
        parameterSchema
      )
    : undefined
  const method = reviewedRequestMethod(source.method, `${path}.method`, network)
  const pathTemplate = reviewedPathTemplate(
    source.pathTemplate,
    `${path}.pathTemplate`,
    parameterSchema
  )
  const maxResponseBytes = reviewedResponseBudget(
    source.maxResponseBytes,
    `${path}.maxResponseBytes`
  )
  return Object.freeze({
    ...(origin === undefined ? {} : { origin }),
    ...(originTemplate === undefined ? {} : { originTemplate }),
    method,
    pathTemplate,
    ...(maxResponseBytes === undefined ? {} : { maxResponseBytes })
  })
}

function operation(
  value: unknown,
  path: string,
  credentialSlotIds: ReadonlySet<string>,
  network: PluginConnectorNetworkPolicyV1
): PluginConnectorOperationV1 {
  const source = record(value, path, OPERATION_KEYS, OPERATION_REQUIRED_KEYS)
  if (typeof source.kind !== 'string' || !OPERATION_KINDS.has(source.kind as never)) {
    throw new TypeError(`${path}.kind is not supported`)
  }
  const credentialSlots = stringArray(
    source.credentialSlots,
    `${path}.credentialSlots`,
    PLUGIN_CONNECTOR_CONTRACT_LIMITS.maxCredentialSlots,
    identity
  )
  for (const slotId of credentialSlots) {
    if (!credentialSlotIds.has(slotId)) {
      throw new TypeError(`${path}.credentialSlots references unknown slot ${slotId}`)
    }
  }
  const parameters = dataContract(source.parameters, `${path}.parameters`)
  return Object.freeze({
    operationId: identity(source.operationId, `${path}.operationId`),
    name: boundedText(source.name, `${path}.name`, PLUGIN_CONNECTOR_CONTRACT_LIMITS.maxNameLength),
    description: boundedText(
      source.description,
      `${path}.description`,
      PLUGIN_CONNECTOR_CONTRACT_LIMITS.maxDescriptionLength
    ),
    kind: source.kind as PluginConnectorOperationKindV1,
    credentialSlots,
    ...(source.request === undefined
      ? {}
      : {
          request: operationRequest(source.request, `${path}.request`, network, parameters.schema)
        }),
    parameters,
    result: dataContract(source.result, `${path}.result`)
  })
}

function operationAllowed(
  connectorKind: PluginConnectorKindV1,
  operationKind: PluginConnectorOperationKindV1
): boolean {
  if (connectorKind === 'data-source')
    return operationKind === 'query' || operationKind === 'mutation'
  if (connectorKind === 'action') return operationKind === 'mutation'
  return operationKind === 'asset-search' || operationKind === 'asset-read'
}

export function parsePluginConnectorContract(value: unknown): PluginConnectorContractV1 {
  const source = record(value, 'pluginConnectorContract', ROOT_KEYS)
  if (source.format !== PLUGIN_CONNECTOR_CONTRACT_FORMAT) {
    throw new TypeError(
      `pluginConnectorContract.format must be ${PLUGIN_CONNECTOR_CONTRACT_FORMAT}`
    )
  }
  if (source.schemaVersion !== PLUGIN_CONNECTOR_CONTRACT_SCHEMA_VERSION) {
    throw new TypeError(
      `pluginConnectorContract.schemaVersion must be ${PLUGIN_CONNECTOR_CONTRACT_SCHEMA_VERSION}`
    )
  }
  if (typeof source.kind !== 'string' || !CONNECTOR_KINDS.has(source.kind as never)) {
    throw new TypeError('pluginConnectorContract.kind is not supported')
  }
  const credentialSlots = array(
    source.credentialSlots,
    'pluginConnectorContract.credentialSlots',
    PLUGIN_CONNECTOR_CONTRACT_LIMITS.maxCredentialSlots
  ).map((entry, index) =>
    credentialSlot(entry, `pluginConnectorContract.credentialSlots[${index}]`)
  )
  const credentialSlotIds = new Set(credentialSlots.map((slot) => slot.slotId))
  if (credentialSlotIds.size !== credentialSlots.length) {
    throw new TypeError('pluginConnectorContract.credentialSlots must use unique slotId values')
  }
  const credentialHeaderNames = credentialSlots.flatMap((slot) =>
    slot.injection ? [slot.injection.name] : []
  )
  if (new Set(credentialHeaderNames).size !== credentialHeaderNames.length) {
    throw new TypeError(
      'pluginConnectorContract.credentialSlots must use unique credential header names'
    )
  }
  const network = networkPolicy(source.network, 'pluginConnectorContract.network')
  const operations = array(
    source.operations,
    'pluginConnectorContract.operations',
    PLUGIN_CONNECTOR_CONTRACT_LIMITS.maxOperations
  ).map((entry, index) =>
    operation(entry, `pluginConnectorContract.operations[${index}]`, credentialSlotIds, network)
  )
  if (operations.length === 0) {
    throw new TypeError('pluginConnectorContract.operations must contain at least one operation')
  }
  const operationIds = new Set(operations.map((entry) => entry.operationId))
  if (operationIds.size !== operations.length) {
    throw new TypeError('pluginConnectorContract.operations must use unique operationId values')
  }
  const kind = source.kind as PluginConnectorKindV1
  for (const entry of operations) {
    if (!operationAllowed(kind, entry.kind)) {
      throw new TypeError(
        `pluginConnectorContract operation ${entry.operationId} is incompatible with ${kind}`
      )
    }
  }
  for (const slot of credentialSlots) {
    if (slot.required && !operations.some((entry) => entry.credentialSlots.includes(slot.slotId))) {
      throw new TypeError(
        `pluginConnectorContract required credential slot ${slot.slotId} is not referenced by an operation`
      )
    }
  }
  const parsed = Object.freeze({
    format: PLUGIN_CONNECTOR_CONTRACT_FORMAT,
    schemaVersion: PLUGIN_CONNECTOR_CONTRACT_SCHEMA_VERSION,
    pluginId: identity(source.pluginId, 'pluginConnectorContract.pluginId'),
    connectorId: identity(source.connectorId, 'pluginConnectorContract.connectorId'),
    adapterId: identity(source.adapterId, 'pluginConnectorContract.adapterId'),
    name: boundedText(
      source.name,
      'pluginConnectorContract.name',
      PLUGIN_CONNECTOR_CONTRACT_LIMITS.maxNameLength
    ),
    description: boundedText(
      source.description,
      'pluginConnectorContract.description',
      PLUGIN_CONNECTOR_CONTRACT_LIMITS.maxDescriptionLength
    ),
    kind,
    network,
    credentialSlots: Object.freeze(credentialSlots),
    operations: Object.freeze(operations)
  }) satisfies PluginConnectorContractV1
  if (
    TEXT_ENCODER.encode(JSON.stringify(parsed)).byteLength >
    PLUGIN_CONNECTOR_CONTRACT_LIMITS.maxBytes
  ) {
    throw new TypeError('pluginConnectorContract exceeds the contract byte limit')
  }
  return parsed
}

export type PluginConnectorCompatibility =
  | Readonly<{ ok: true; contract: PluginConnectorContractV1 }>
  | Readonly<{
      ok: false
      status: 'invalid-contract' | 'host-adapter-unavailable' | 'authority-mismatch'
      reason: string
    }>

function connectorKey(pluginId: string, connectorId: string): string {
  return `${pluginId}\0${connectorId}`
}

/**
 * Registry for contracts reviewed and shipped by the host application.
 *
 * It intentionally stores no executor. Registering a contract cannot enable networking; a later
 * phase must separately provide a host adapter that rechecks this exact authority at execution.
 */
export class PluginConnectorContractRegistry {
  readonly #contracts = new Map<string, PluginConnectorContractV1>()
  #frozen = false

  register(value: unknown): PluginConnectorContractV1 {
    if (this.#frozen) throw new Error('Plugin connector contract registry is frozen')
    const contract = parsePluginConnectorContract(value)
    const key = connectorKey(contract.pluginId, contract.connectorId)
    if (this.#contracts.has(key)) {
      throw new Error(
        `Duplicate plugin connector contract: ${contract.pluginId}/${contract.connectorId}`
      )
    }
    this.#contracts.set(key, contract)
    return contract
  }

  freeze(): this {
    this.#frozen = true
    return this
  }

  get(pluginId: string, connectorId: string): PluginConnectorContractV1 | undefined {
    return this.#contracts.get(connectorKey(pluginId, connectorId))
  }

  inspect(value: unknown): PluginConnectorCompatibility {
    let declared: PluginConnectorContractV1
    try {
      declared = parsePluginConnectorContract(value)
    } catch (cause) {
      return Object.freeze({
        ok: false,
        status: 'invalid-contract',
        reason: cause instanceof Error ? cause.message : String(cause)
      })
    }
    const expected = this.get(declared.pluginId, declared.connectorId)
    if (!expected) {
      return Object.freeze({
        ok: false,
        status: 'host-adapter-unavailable',
        reason: `No reviewed host contract is registered for ${declared.pluginId}/${declared.connectorId}`
      })
    }
    if (JSON.stringify(declared) !== JSON.stringify(expected)) {
      return Object.freeze({
        ok: false,
        status: 'authority-mismatch',
        reason: `Connector authority does not match the reviewed host contract for ${declared.pluginId}/${declared.connectorId}`
      })
    }
    return Object.freeze({ ok: true, contract: expected })
  }
}
