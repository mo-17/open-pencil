export * from './collaboration'
export * from './data-platforms'
export * from './microsoft'
export * from './shared'
export * from './work-content'

import { REVIEWED_COLLABORATION_SERVICES } from './collaboration'
import { REVIEWED_DATA_PLATFORM_SERVICES } from './data-platforms'
import { REVIEWED_MICROSOFT_SERVICES } from './microsoft'
import type { ReviewedServiceDescriptor } from './shared'
import { REVIEWED_WORK_CONTENT_SERVICES } from './work-content'

export interface DeferredReviewedService {
  readonly plugin: string
  readonly reason: string
  readonly nextManualGate: string
}

export const DEFERRED_REVIEWED_SERVICES: readonly DeferredReviewedService[] = Object.freeze([
  Object.freeze({
    plugin: 'Gmail',
    reason:
      'Message access uses restricted Google scopes and AI/MCP transfer requires a separate policy and security review.',
    nextManualGate: 'Complete restricted-scope verification and approve an AI data-transfer policy.'
  }),
  Object.freeze({
    plugin: 'Monday.com',
    reason:
      'The stable token flow uses a raw Authorization value, while the current connector host only injects Bearer tokens.',
    nextManualGate: 'Add and security-review an exact non-Bearer Authorization credential scheme.'
  }),
  Object.freeze({
    plugin: 'Semrush',
    reason:
      'The candidate API is early-access and its ApiKey credential scheme is not represented by the current host contract.',
    nextManualGate:
      'Confirm production API availability and review a dedicated ApiKey injection scheme.'
  }),
  Object.freeze({
    plugin: 'Replit',
    reason: 'No stable public management API was verified for the intended project operations.',
    nextManualGate: 'Select a documented public API surface before granting any network authority.'
  })
])

function checkedCatalog(
  source: readonly ReviewedServiceDescriptor[]
): readonly ReviewedServiceDescriptor[] {
  const keys = new Set<string>()
  const plugins = new Set<string>()
  const connectors = new Set<string>()
  const adapters = new Set<string>()
  for (const descriptor of source) {
    const contract = descriptor.connector.contract
    if (keys.has(descriptor.key))
      throw new Error(`Duplicate reviewed service key: ${descriptor.key}`)
    if (plugins.has(contract.pluginId)) {
      throw new Error(
        `Reviewed service plugins must own exactly one connector: ${contract.pluginId}`
      )
    }
    if (connectors.has(contract.connectorId)) {
      throw new Error(`Duplicate reviewed connector ID: ${contract.connectorId}`)
    }
    if (adapters.has(contract.adapterId)) {
      throw new Error(`Duplicate reviewed adapter ID: ${contract.adapterId}`)
    }
    if (
      contract.operations.length !== 1 ||
      descriptor.connector.metadata.mcpReadOnlyOperationIds.length !== 1
    ) {
      throw new Error(
        `Reviewed service must expose exactly one read-only operation: ${descriptor.key}`
      )
    }
    keys.add(descriptor.key)
    plugins.add(contract.pluginId)
    connectors.add(contract.connectorId)
    adapters.add(contract.adapterId)
  }
  return Object.freeze([...source])
}

export const REVIEWED_EXTERNAL_SERVICE_CATALOG = checkedCatalog([
  ...REVIEWED_DATA_PLATFORM_SERVICES,
  ...REVIEWED_WORK_CONTENT_SERVICES,
  ...REVIEWED_COLLABORATION_SERVICES,
  ...REVIEWED_MICROSOFT_SERVICES
])

export const REVIEWED_EXTERNAL_SERVICE_CONNECTORS = Object.freeze(
  REVIEWED_EXTERNAL_SERVICE_CATALOG.map((descriptor) => descriptor.connector)
)
