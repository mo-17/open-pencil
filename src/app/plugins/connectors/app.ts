import {
  PluginConnectorContractRegistry,
  type PluginConnectorOperationV1
} from '@open-pencil/plugin-contracts'

import type { InstalledAppPlugin, InstalledPluginConnector } from '@/app/plugins/types'
import { appCredentialServices } from '@/app/settings/credentials/app'
import { credentialRef } from '@/app/settings/credentials/reference'
import type { CredentialManager, CredentialRef } from '@/app/settings/credentials/types'
import { isTauri } from '@/app/tauri/env'
import { tauriFetch } from '@/app/tauri/http'

import {
  AIRTABLE_RECORDS_CONNECTOR_ADAPTER,
  AIRTABLE_RECORDS_CONNECTOR_CONTRACT
} from './airtable-records'
import { ConnectorAuditFanout, RedactedConnectorAuditLog } from './audit'
import { ConnectorAuthorizationRegistry } from './authorization'
import { createConnectorExecutionBroker } from './broker'
import { ConnectorCredentialReadinessRegistry } from './credential-readiness'
import { ConnectorOutcomeUnknownNoticeStore } from './outcome-notices'
import { ConnectorHostAdapterRegistry } from './registry'
import { RESEND_EMAIL_CONNECTOR_ADAPTER, RESEND_EMAIL_CONNECTOR_CONTRACT } from './resend-email'
import { REVIEWED_EXTERNAL_SERVICE_CONNECTORS } from './services'
import {
  STRIPE_BILLING_CONNECTOR_ADAPTER,
  STRIPE_BILLING_CONNECTOR_CONTRACT
} from './stripe-billing'
import {
  SUPABASE_BUSINESS_CONNECTOR_ADAPTER,
  SUPABASE_BUSINESS_CONNECTOR_CONTRACT
} from './supabase-business'
import {
  SUPABASE_SCHEMA_INSPECTOR_ADAPTER,
  SUPABASE_SCHEMA_INSPECTOR_CONTRACT
} from './supabase-schema-inspector'
import type { ConnectorFetch, ConnectorParameterObject, ExecuteConnectorRequest } from './types'

const reviewedContracts = new PluginConnectorContractRegistry()
reviewedContracts.register(AIRTABLE_RECORDS_CONNECTOR_CONTRACT)
reviewedContracts.register(SUPABASE_SCHEMA_INSPECTOR_CONTRACT)
reviewedContracts.register(SUPABASE_BUSINESS_CONNECTOR_CONTRACT)
reviewedContracts.register(STRIPE_BILLING_CONNECTOR_CONTRACT)
reviewedContracts.register(RESEND_EMAIL_CONNECTOR_CONTRACT)
for (const connector of REVIEWED_EXTERNAL_SERVICE_CONNECTORS) {
  reviewedContracts.register(connector.contract)
}
reviewedContracts.freeze()

export const appConnectorHostAdapters = new ConnectorHostAdapterRegistry(reviewedContracts)
appConnectorHostAdapters.register(AIRTABLE_RECORDS_CONNECTOR_ADAPTER)
appConnectorHostAdapters.register(SUPABASE_SCHEMA_INSPECTOR_ADAPTER)
appConnectorHostAdapters.register(SUPABASE_BUSINESS_CONNECTOR_ADAPTER)
appConnectorHostAdapters.register(STRIPE_BILLING_CONNECTOR_ADAPTER)
appConnectorHostAdapters.register(RESEND_EMAIL_CONNECTOR_ADAPTER)
for (const connector of REVIEWED_EXTERNAL_SERVICE_CONNECTORS) {
  appConnectorHostAdapters.register(connector.adapter)
}
appConnectorHostAdapters.freeze()

export const appConnectorAuthorization = new ConnectorAuthorizationRegistry()
export const appConnectorCredentialReadiness = new ConnectorCredentialReadinessRegistry()
export const appConnectorAudit = new RedactedConnectorAuditLog()
export const appConnectorOutcomeUnknownNotices = new ConnectorOutcomeUnknownNoticeStore()
const appConnectorAuditSink = new ConnectorAuditFanout([
  appConnectorAudit,
  appConnectorOutcomeUnknownNotices
])
export interface AppConnectorFetchEnvironment {
  readonly isDesktop: () => boolean
  readonly desktopFetch: typeof tauriFetch
  readonly browserFetch: typeof globalThis.fetch
}

export function createAppConnectorFetch(environment: AppConnectorFetchEnvironment): ConnectorFetch {
  return (input, init, limits, onDispatch) => {
    if (environment.isDesktop()) {
      return environment.desktopFetch(
        input,
        init,
        limits.maxResponseBytes,
        limits.timeoutMs,
        onDispatch
      )
    }
    onDispatch()
    return environment.browserFetch(input, init)
  }
}

const appConnectorFetch = createAppConnectorFetch({
  isDesktop: isTauri,
  desktopFetch: tauriFetch,
  browserFetch: (input, init) => globalThis.fetch(input, init)
})
export const appConnectorExecutionBroker = createConnectorExecutionBroker({
  adapters: appConnectorHostAdapters,
  authorization: appConnectorAuthorization,
  credentialResolver: appCredentialServices.resolver,
  audit: appConnectorAuditSink,
  fetch: appConnectorFetch
})

export function reconcileConnectorAuthorizations(
  installed: readonly InstalledAppPlugin[],
  authorization = appConnectorAuthorization
): void {
  for (const grant of authorization.snapshot()) {
    const plugin = installed.find(
      (candidate) => candidate.package.manifest.plugin.id === grant.pluginId
    )
    const declared =
      plugin?.package.manifest.schemaVersion === 2
        ? plugin.package.manifest.contributions.connectors?.find(
            (connector) => connector.connectorId === grant.connectorId
          )
        : undefined
    if (
      !plugin?.enabled ||
      plugin.blockedReason ||
      plugin.package.digest !== grant.packageDigest ||
      declared?.adapterId !== grant.adapterId
    ) {
      authorization.revoke(grant.pluginId, grant.connectorId)
    }
  }
}

function connectorCredentialRefs(
  connector: InstalledPluginConnector
): Readonly<Record<string, CredentialRef>> | undefined {
  const pluginId = connector.plugin.package.manifest.plugin.id
  if (
    connector.contribution.pluginId !== pluginId ||
    !appConnectorHostAdapters.resolve(connector.contribution)
  ) {
    return undefined
  }
  return Object.freeze(
    Object.fromEntries(
      connector.contribution.credentialSlots.map((slot) => [
        slot.slotId,
        credentialRef(pluginId, slot.slotId)
      ])
    )
  )
}

function requiredConnectorCredentialRefs(
  connector: InstalledPluginConnector
): readonly CredentialRef[] | undefined {
  const references = connectorCredentialRefs(connector)
  if (!references) return undefined
  const required = connector.contribution.credentialSlots
    .filter((slot) => slot.required)
    .map((slot) => references[slot.slotId])
  return Object.freeze(required)
}

/** Refresh status-only MCP readiness without resolving or retaining credential values. */
export function refreshAppConnectorCredentialReadiness(
  connectors: readonly InstalledPluginConnector[],
  manager: CredentialManager = appCredentialServices.manager,
  readiness: ConnectorCredentialReadinessRegistry = appConnectorCredentialReadiness
): Promise<boolean> {
  const references = connectors.flatMap((connector) =>
    appConnectorAuthorization.isAuthorized(connector.contribution, connector.plugin.package.digest)
      ? (requiredConnectorCredentialRefs(connector) ?? [])
      : []
  )
  return readiness.observe(manager, references)
}

export function isAppConnectorMCPExposed(
  connector: InstalledPluginConnector,
  operation: PluginConnectorOperationV1
): boolean {
  const adapter = appConnectorHostAdapters.resolve(connector.contribution)
  const requiredCredentials = requiredConnectorCredentialRefs(connector)
  const requestIsReadOnly =
    operation.request?.method === 'GET' ||
    adapter?.mcpReadOnlyOperationIds?.includes(operation.operationId) === true
  return Boolean(
    operation.kind === 'query' &&
    operation.request &&
    requestIsReadOnly &&
    adapter &&
    appConnectorAuthorization.isAuthorized(
      connector.contribution,
      connector.plugin.package.digest
    ) &&
    requiredCredentials &&
    appConnectorCredentialReadiness.areConfigured(requiredCredentials)
  )
}

export function executeInstalledAppConnector(
  connector: InstalledPluginConnector,
  operationId: string,
  parameters: ConnectorParameterObject,
  options: ExecuteInstalledAppConnectorOptions = {}
) {
  return appConnectorExecutionBroker.execute({
    plugin: connector.plugin,
    contract: connector.contribution,
    operationId,
    // The Broker immediately revalidates the object against the closed operation schema. Optional
    // indexed properties are typed as undefined, but parsed JSON never serializes such a value.
    parameters: parameters as ExecuteConnectorRequest['parameters'],
    credentialRefs: connectorCredentialRefs(connector),
    signal: options.signal,
    mutationAttemptId: options.mutationAttemptId,
    confirmMutation: options.confirmMutation
  })
}

export interface ExecuteInstalledAppConnectorOptions {
  readonly signal?: AbortSignal
  readonly mutationAttemptId?: string
  readonly confirmMutation?: ExecuteConnectorRequest['confirmMutation']
}
