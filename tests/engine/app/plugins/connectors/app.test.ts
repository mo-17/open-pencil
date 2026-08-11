import { afterEach, describe, expect, test } from 'bun:test'

import { createBundledPluginCatalog } from '@/app/plugins/catalog'
import {
  AIRTABLE_RECORDS_CONNECTOR_CONTRACT,
  AIRTABLE_RECORDS_CONNECTOR_ID,
  AIRTABLE_RECORDS_PLUGIN_ID
} from '@/app/plugins/connectors/airtable-records'
import {
  appConnectorAuthorization,
  appConnectorCredentialReadiness,
  appConnectorHostAdapters,
  appConnectorOutcomeUnknownNotices,
  createAppConnectorFetch,
  isAppConnectorMcpExposed
} from '@/app/plugins/connectors/app'
import {
  RESEND_EMAIL_CONNECTOR_CONTRACT,
  RESEND_EMAIL_CONNECTOR_ID,
  RESEND_EMAIL_PLUGIN_ID
} from '@/app/plugins/connectors/resend-email'
import {
  STRIPE_BILLING_CONNECTOR_CONTRACT,
  STRIPE_BILLING_CONNECTOR_ID,
  STRIPE_BILLING_PLUGIN_ID
} from '@/app/plugins/connectors/stripe-billing'
import {
  SUPABASE_BUSINESS_CONNECTOR_CONTRACT,
  SUPABASE_BUSINESS_CONNECTOR_ID,
  SUPABASE_BUSINESS_PLUGIN_ID
} from '@/app/plugins/connectors/supabase-business'
import {
  SUPABASE_SCHEMA_INSPECTOR_CONNECTOR_ID,
  SUPABASE_SCHEMA_INSPECTOR_CONTRACT,
  SUPABASE_SCHEMA_INSPECTOR_PLUGIN_ID
} from '@/app/plugins/connectors/supabase-schema-inspector'
import { createMemoryAppPluginStateStorage } from '@/app/plugins/storage'
import { createAppPluginStore } from '@/app/plugins/store'
import { credentialRef } from '@/app/settings/credentials'

const CONNECTORS = Object.freeze([
  {
    pluginId: AIRTABLE_RECORDS_PLUGIN_ID,
    connectorId: AIRTABLE_RECORDS_CONNECTOR_ID,
    contract: AIRTABLE_RECORDS_CONNECTOR_CONTRACT
  },
  {
    pluginId: SUPABASE_SCHEMA_INSPECTOR_PLUGIN_ID,
    connectorId: SUPABASE_SCHEMA_INSPECTOR_CONNECTOR_ID,
    contract: SUPABASE_SCHEMA_INSPECTOR_CONTRACT
  },
  {
    pluginId: SUPABASE_BUSINESS_PLUGIN_ID,
    connectorId: SUPABASE_BUSINESS_CONNECTOR_ID,
    contract: SUPABASE_BUSINESS_CONNECTOR_CONTRACT
  },
  {
    pluginId: STRIPE_BILLING_PLUGIN_ID,
    connectorId: STRIPE_BILLING_CONNECTOR_ID,
    contract: STRIPE_BILLING_CONNECTOR_CONTRACT
  },
  {
    pluginId: RESEND_EMAIL_PLUGIN_ID,
    connectorId: RESEND_EMAIL_CONNECTOR_ID,
    contract: RESEND_EMAIL_CONNECTOR_CONTRACT
  }
])

afterEach(() => {
  appConnectorAuthorization.clear()
  appConnectorCredentialReadiness.clear()
  appConnectorOutcomeUnknownNotices.clear()
})

describe('app connector integration', () => {
  test('reports dispatch at the browser and Tauri host transport boundaries', async () => {
    const browserOrder: string[] = []
    const browserFetch = createAppConnectorFetch({
      isDesktop: () => false,
      desktopFetch: async () => {
        throw new Error('unexpected desktop transport')
      },
      browserFetch: async () => {
        browserOrder.push('fetch')
        return new Response('{}')
      }
    })
    await browserFetch(
      'https://api.example.com',
      undefined,
      {
        maxResponseBytes: 100,
        timeoutMs: 1_000
      },
      () => browserOrder.push('dispatch')
    )
    expect(browserOrder).toEqual(['dispatch', 'fetch'])

    const desktopOrder: string[] = []
    const desktopFetch = createAppConnectorFetch({
      isDesktop: () => true,
      desktopFetch: async (_input, _init, maximum, timeout, onDispatch) => {
        expect(maximum).toBe(100)
        expect(timeout).toBe(1_000)
        onDispatch?.()
        desktopOrder.push('invoke')
        return new Response('{}')
      },
      browserFetch: async () => {
        throw new Error('unexpected browser transport')
      }
    })
    await desktopFetch(
      'https://api.example.com',
      undefined,
      {
        maxResponseBytes: 100,
        timeoutMs: 1_000
      },
      () => desktopOrder.push('dispatch')
    )
    expect(desktopOrder).toEqual(['dispatch', 'invoke'])
  })

  test('registers exact reviewed adapters and exposes only authorized queries to MCP', async () => {
    const store = createAppPluginStore({
      storage: createMemoryAppPluginStateStorage(),
      catalog: createBundledPluginCatalog(),
      activationCompatibilityPolicy: () => ({ ok: true }),
      engineVersion: '0.0.0'
    })
    await store.load()

    for (const candidate of CONNECTORS) {
      expect(appConnectorHostAdapters.resolve(candidate.contract)).not.toBeNull()
      await store.install(candidate.pluginId)
      await store.setEnabled(candidate.pluginId, true)
      const connector = store.connector(candidate.pluginId, candidate.connectorId)
      if (!connector) throw new Error(`Missing installed connector: ${candidate.connectorId}`)

      expect(
        candidate.contract.operations.every(
          (operation) => !isAppConnectorMcpExposed(connector, operation)
        )
      ).toBe(true)
      appConnectorCredentialReadiness.update(
        candidate.contract.credentialSlots
          .filter((slot) => slot.required)
          .map((slot) => ({
            reference: credentialRef(candidate.pluginId, slot.slotId),
            status: 'configured' as const
          }))
      )
      appConnectorAuthorization.authorize(candidate.contract, connector.plugin.package.digest)

      for (const operation of candidate.contract.operations) {
        expect(isAppConnectorMcpExposed(connector, operation)).toBe(
          operation.kind === 'query' && operation.request?.method === 'GET'
        )
      }

      appConnectorAuthorization.revoke(candidate.pluginId, candidate.connectorId)
      expect(
        candidate.contract.operations.every(
          (operation) => !isAppConnectorMcpExposed(connector, operation)
        )
      ).toBe(true)
    }
  })

  test('retains a session outcome notice after the matching plugin is disabled and uninstalled', async () => {
    const store = createAppPluginStore({
      storage: createMemoryAppPluginStateStorage(),
      catalog: createBundledPluginCatalog(),
      activationCompatibilityPolicy: () => ({ ok: true }),
      engineVersion: '0.0.0'
    })
    await store.load()
    await store.install(RESEND_EMAIL_PLUGIN_ID)
    await store.setEnabled(RESEND_EMAIL_PLUGIN_ID, true)
    appConnectorOutcomeUnknownNotices.record({
      timestamp: 100,
      pluginId: RESEND_EMAIL_PLUGIN_ID,
      connectorId: RESEND_EMAIL_CONNECTOR_ID,
      adapterId: RESEND_EMAIL_CONNECTOR_CONTRACT.adapterId,
      operationId: 'send-email',
      operationKind: 'mutation',
      outcome: 'outcome-unknown',
      durationMs: 1,
      requestDispatched: true,
      requestBytes: 10,
      responseBytes: 0,
      errorCode: 'outcome-unknown'
    })

    await store.setEnabled(RESEND_EMAIL_PLUGIN_ID, false)
    await store.uninstall(RESEND_EMAIL_PLUGIN_ID)
    expect(appConnectorOutcomeUnknownNotices.snapshot()).toEqual([
      expect.objectContaining({
        pluginId: RESEND_EMAIL_PLUGIN_ID,
        connectorId: RESEND_EMAIL_CONNECTOR_ID,
        operationId: 'send-email'
      })
    ])
  })
})
