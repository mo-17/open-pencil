import {
  PluginConnectorContractRegistry,
  type PluginConnectorOperationV1
} from '@open-pencil/core/plugins'

import type { InstalledAppPlugin, InstalledPluginConnector } from '@/app/plugins/types'
import { appCredentialServices } from '@/app/settings/credentials/app'
import { credentialRef } from '@/app/settings/credentials/reference'
import type { CredentialRef } from '@/app/settings/credentials/types'
import { isTauri } from '@/app/tauri/env'
import { tauriFetch } from '@/app/tauri/http'

import {
  AIRTABLE_RECORDS_CONNECTOR_ADAPTER,
  AIRTABLE_RECORDS_CONNECTOR_CONTRACT,
  AIRTABLE_RECORDS_CREDENTIAL_SLOT_ID,
  AIRTABLE_RECORDS_PLUGIN_ID
} from './airtable-records'
import { ConnectorAuditFanout, RedactedConnectorAuditLog } from './audit'
import { ConnectorAuthorizationRegistry } from './authorization'
import { createConnectorExecutionBroker } from './broker'
import { ConnectorOutcomeUnknownNoticeStore } from './outcome-notices'
import { ConnectorHostAdapterRegistry } from './registry'
import {
  RESEND_EMAIL_CONNECTOR_ADAPTER,
  RESEND_EMAIL_CONNECTOR_CONTRACT,
  RESEND_EMAIL_CREDENTIAL_REFS,
  RESEND_EMAIL_PLUGIN_ID
} from './resend-email'
import {
  STRIPE_BILLING_CONNECTOR_ADAPTER,
  STRIPE_BILLING_CONNECTOR_CONTRACT,
  STRIPE_BILLING_PLUGIN_ID,
  STRIPE_SECRET_KEY_SLOT_ID
} from './stripe-billing'
import {
  SUPABASE_BUSINESS_CONNECTOR_ADAPTER,
  SUPABASE_BUSINESS_CONNECTOR_CONTRACT,
  SUPABASE_BUSINESS_CREDENTIAL_REFS,
  SUPABASE_BUSINESS_PLUGIN_ID
} from './supabase-business'
import {
  SUPABASE_SCHEMA_INSPECTOR_ADAPTER,
  SUPABASE_SCHEMA_INSPECTOR_CONTRACT,
  SUPABASE_SCHEMA_INSPECTOR_CREDENTIAL_REFS,
  SUPABASE_SCHEMA_INSPECTOR_PLUGIN_ID
} from './supabase-schema-inspector'
import type { ConnectorFetch, ConnectorParameterObject, ExecuteConnectorRequest } from './types'

const reviewedContracts = new PluginConnectorContractRegistry()
reviewedContracts.register(AIRTABLE_RECORDS_CONNECTOR_CONTRACT)
reviewedContracts.register(SUPABASE_SCHEMA_INSPECTOR_CONTRACT)
reviewedContracts.register(SUPABASE_BUSINESS_CONNECTOR_CONTRACT)
reviewedContracts.register(STRIPE_BILLING_CONNECTOR_CONTRACT)
reviewedContracts.register(RESEND_EMAIL_CONNECTOR_CONTRACT)
reviewedContracts.freeze()

export const appConnectorHostAdapters = new ConnectorHostAdapterRegistry(reviewedContracts)
appConnectorHostAdapters.register(AIRTABLE_RECORDS_CONNECTOR_ADAPTER)
appConnectorHostAdapters.register(SUPABASE_SCHEMA_INSPECTOR_ADAPTER)
appConnectorHostAdapters.register(SUPABASE_BUSINESS_CONNECTOR_ADAPTER)
appConnectorHostAdapters.register(STRIPE_BILLING_CONNECTOR_ADAPTER)
appConnectorHostAdapters.register(RESEND_EMAIL_CONNECTOR_ADAPTER)
appConnectorHostAdapters.freeze()

export const appConnectorAuthorization = new ConnectorAuthorizationRegistry()
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

const AIRTABLE_RECORDS_CREDENTIAL_REFS = Object.freeze({
  [AIRTABLE_RECORDS_CREDENTIAL_SLOT_ID]: credentialRef(
    AIRTABLE_RECORDS_PLUGIN_ID,
    AIRTABLE_RECORDS_CREDENTIAL_SLOT_ID
  )
})

const STRIPE_BILLING_CREDENTIAL_REFS = Object.freeze({
  [STRIPE_SECRET_KEY_SLOT_ID]: credentialRef(STRIPE_BILLING_PLUGIN_ID, STRIPE_SECRET_KEY_SLOT_ID)
})

function connectorCredentialRefs(
  connector: InstalledPluginConnector
): Readonly<Record<string, CredentialRef>> | undefined {
  const pluginId = connector.plugin.package.manifest.plugin.id
  if (pluginId === AIRTABLE_RECORDS_PLUGIN_ID) return AIRTABLE_RECORDS_CREDENTIAL_REFS
  if (pluginId === SUPABASE_SCHEMA_INSPECTOR_PLUGIN_ID) {
    return SUPABASE_SCHEMA_INSPECTOR_CREDENTIAL_REFS
  }
  if (pluginId === SUPABASE_BUSINESS_PLUGIN_ID) return SUPABASE_BUSINESS_CREDENTIAL_REFS
  if (pluginId === STRIPE_BILLING_PLUGIN_ID) return STRIPE_BILLING_CREDENTIAL_REFS
  if (pluginId === RESEND_EMAIL_PLUGIN_ID) return RESEND_EMAIL_CREDENTIAL_REFS
  return undefined
}

export function isAppConnectorMcpExposed(
  connector: InstalledPluginConnector,
  operation: PluginConnectorOperationV1
): boolean {
  return Boolean(
    operation.kind === 'query' &&
    operation.request?.method === 'GET' &&
    appConnectorHostAdapters.resolve(connector.contribution) &&
    appConnectorAuthorization.isAuthorized(
      connector.contribution,
      connector.plugin.package.digest
    ) &&
    connectorCredentialRefs(connector)
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
