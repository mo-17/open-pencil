import {
  parsePluginObjectParameterValue,
  type PluginConnectorOperationV1,
  type PluginParameterSchemaV2,
  type PluginParameterValue
} from '@open-pencil/core/plugins'

import type { InstalledPluginConnector } from '@/app/plugins/types'

import {
  createConnectorMutationAttemptId,
  parseConnectorMutationAttemptId
} from '../mutation-attempt'
import {
  ConnectorExecutionError,
  type ConnectorExecutionErrorCode,
  type ConnectorExecutionResult,
  type ConnectorMutationConfirmation,
  type ConnectorParameterObject
} from '../types'

const TEXT_ENCODER = new TextEncoder()

export type ParsedConnectorOperationParameters = Readonly<{
  parameters: ConnectorParameterObject
  byteLength: number
}>

export type ConnectorMutationReview = Readonly<{
  pluginId: string
  connectorId: string
  adapterId: string
  packageDigest: string
  operationId: string
  operationName: string
  method: string
  authorityKind: 'origin' | 'origin-template'
  authority: string
  pathTemplate: string
  parameterBytes: number
  parameterFingerprint: string
  mutationAttemptId: string
}>

export type ConnectorMutationConfirmationGate = Readonly<{
  tryEnter(): boolean
  leave(): void
}>

export function createConnectorMutationConfirmationGate(): ConnectorMutationConfirmationGate {
  let active = false
  return Object.freeze({
    tryEnter(): boolean {
      if (active) return false
      active = true
      return true
    },
    leave(): void {
      active = false
    }
  })
}

function skeletonValue(schema: PluginParameterSchemaV2): PluginParameterValue {
  if (schema.type === 'string') return ''
  if (schema.type === 'number' || schema.type === 'integer') return schema.minimum ?? 0
  if (schema.type === 'boolean') return false
  if (schema.type === 'array') return Object.freeze([])
  return Object.freeze({})
}

export function requiredConnectorOperationParameterNames(
  operation: PluginConnectorOperationV1
): readonly string[] {
  return Object.freeze([...(operation.parameters.schema.required ?? [])])
}

export function connectorOperationParameterSkeleton(operation: PluginConnectorOperationV1): string {
  const entries = requiredConnectorOperationParameterNames(operation).map((name) => [
    name,
    skeletonValue(operation.parameters.schema.properties[name])
  ])
  const serialized = JSON.stringify(Object.fromEntries(entries), null, 2)
  return TEXT_ENCODER.encode(serialized).byteLength <= operation.parameters.maxBytes
    ? serialized
    : '{}'
}

export function parseConnectorOperationParameters(
  source: string,
  operation: PluginConnectorOperationV1
): ParsedConnectorOperationParameters {
  const maximum = operation.parameters.maxBytes
  if (source.length > maximum) {
    throw new TypeError(`Connector parameters exceed the ${maximum}-character safety limit`)
  }
  const byteLength = TEXT_ENCODER.encode(source).byteLength
  if (byteLength > maximum) {
    throw new TypeError(`Connector parameters exceed the ${maximum}-byte contract limit`)
  }
  let candidate: unknown
  try {
    candidate = JSON.parse(source)
  } catch {
    throw new TypeError('Connector parameters must be valid JSON')
  }
  return Object.freeze({
    parameters: parsePluginObjectParameterValue(
      candidate,
      operation.parameters.schema,
      maximum,
      'connector operation parameters'
    ),
    byteLength
  })
}

export async function connectorParameterFingerprint(
  parameters: ConnectorParameterObject
): Promise<string> {
  const serialized = JSON.stringify(parameters)
  const digest = new Uint8Array(
    await globalThis.crypto.subtle.digest('SHA-256', TEXT_ENCODER.encode(serialized))
  )
  return `sha256-${[...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`
}

function reviewedAuthority(operation: PluginConnectorOperationV1): {
  kind: 'origin' | 'origin-template'
  value: string
} {
  if (!operation.request) throw new TypeError('Connector operation has no reviewed request')
  if (operation.request.origin) return { kind: 'origin', value: operation.request.origin }
  if (operation.request.originTemplate) {
    return { kind: 'origin-template', value: operation.request.originTemplate }
  }
  throw new TypeError('Connector operation has no reviewed authority')
}

export function createConnectorMutationReview(
  connector: InstalledPluginConnector,
  operation: PluginConnectorOperationV1,
  parameterBytes: number,
  parameterFingerprint: string,
  mutationAttemptId = createConnectorMutationAttemptId()
): ConnectorMutationReview {
  if (operation.kind !== 'mutation' || !operation.request) {
    throw new TypeError('Only executable mutation operations can be reviewed')
  }
  const authority = reviewedAuthority(operation)
  const reviewedAttemptId = parseConnectorMutationAttemptId(mutationAttemptId)
  return Object.freeze({
    pluginId: connector.contribution.pluginId,
    connectorId: connector.contribution.connectorId,
    adapterId: connector.contribution.adapterId,
    packageDigest: connector.plugin.package.digest,
    operationId: operation.operationId,
    operationName: operation.name,
    method: operation.request.method,
    authorityKind: authority.kind,
    authority: authority.value,
    pathTemplate: operation.request.pathTemplate,
    parameterBytes,
    parameterFingerprint,
    mutationAttemptId: reviewedAttemptId
  })
}

export function connectorMutationReviewMatches(
  review: ConnectorMutationReview,
  connector: InstalledPluginConnector,
  operation: PluginConnectorOperationV1,
  parameterBytes: number,
  parameterFingerprint: string
): boolean {
  if (operation.kind !== 'mutation' || !operation.request) return false
  const authority = reviewedAuthority(operation)
  return (
    review.pluginId === connector.contribution.pluginId &&
    review.connectorId === connector.contribution.connectorId &&
    review.adapterId === connector.contribution.adapterId &&
    review.packageDigest === connector.plugin.package.digest &&
    review.operationId === operation.operationId &&
    review.operationName === operation.name &&
    review.method === operation.request.method &&
    review.authorityKind === authority.kind &&
    review.authority === authority.value &&
    review.pathTemplate === operation.request.pathTemplate &&
    review.parameterBytes === parameterBytes &&
    review.parameterFingerprint === parameterFingerprint
  )
}

export function connectorMutationConfirmationMatches(
  review: ConnectorMutationReview,
  confirmation: ConnectorMutationConfirmation
): boolean {
  return (
    review.pluginId === confirmation.pluginId &&
    review.connectorId === confirmation.connectorId &&
    review.operationId === confirmation.operationId &&
    review.operationName === confirmation.operationName
  )
}

export function connectorExecutionDataText(result: ConnectorExecutionResult): string {
  return JSON.stringify(result.data, null, 2)
}

export function connectorExecutionErrorCode(cause: unknown): ConnectorExecutionErrorCode | null {
  return cause instanceof ConnectorExecutionError ? cause.code : null
}
