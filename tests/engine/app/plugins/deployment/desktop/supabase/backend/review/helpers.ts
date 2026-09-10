import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import { createBundledPluginCatalog, type AppBundlePluginCatalogEntry } from '@/app/plugins'
import {
  APP_BACKEND_PROVIDER_DOCUMENT_KEY,
  APP_BACKEND_PROVIDER_DOCUMENT_PLUGIN_ID,
  SUPABASE_BACKEND_PROVIDER_PLUGIN_ID,
  type AppBackendProviderDocumentGraph
} from '@/app/plugins/host/backend-provider'
import { SUPABASE_PG_CATALOG_QUERY_IDS } from '@/app/plugins/host/deployment/supabase/pg-catalog-inspector'

export const PROJECT_REF = 'enekobitnhobuiuamvqj'
export const PROJECT_URL = `https://${PROJECT_REF}.supabase.co`
export const ORGANIZATION_ID = 'org-123'
export const GRANT_GENERATION = '123e4567-e89b-42d3-a456-426614174000'
export const PAT = 'sbp_runtime_secret_canary_1234567890'
export const NOW = '2026-08-30T10:00:00.000Z'
export const SNAPSHOT_MARKER = '123:123:'

export function bundledBackendProvider(): AppBundlePluginCatalogEntry {
  const entry = createBundledPluginCatalog().find(
    ({ manifest }) => manifest.plugin.id === SUPABASE_BACKEND_PROVIDER_PLUGIN_ID
  )
  if (entry?.trustSource !== 'app-bundle') throw new Error('Missing bundled Supabase provider')
  return entry
}

export function application(): BackendApplicationSpecV1 {
  return {
    format: 'openpencil.backend-application',
    version: 1,
    applicationId: 'desktop-review-runtime-test',
    dataModel: { version: 1, entities: [], enums: [], relations: [] },
    auth: {
      version: 1,
      identities: [],
      roles: [],
      ownership: [],
      tenants: [],
      rowAccess: []
    },
    workflows: { version: 1, workflows: [] },
    capabilities: [],
    secrets: []
  }
}

export function graph(value: string): AppBackendProviderDocumentGraph {
  return {
    rootId: 'root-1',
    getNode(id) {
      if (id !== 'root-1') return undefined
      return {
        pluginData: [
          {
            pluginId: APP_BACKEND_PROVIDER_DOCUMENT_PLUGIN_ID,
            key: APP_BACKEND_PROVIDER_DOCUMENT_KEY,
            value
          }
        ]
      }
    }
  }
}

export function catalogResponse(columnPrivilegesPresent = false): unknown {
  const queryResults = Object.fromEntries<unknown[]>(
    SUPABASE_PG_CATALOG_QUERY_IDS.map((id) => [id, []])
  )
  queryResults.provenance = [
    {
      databaseOid: '5',
      databaseName: 'postgres',
      schemaOid: '2200',
      schemaName: 'public',
      currentRoleOid: '10',
      currentRoleName: 'postgres',
      serverVersionNum: '170000',
      snapshotMarker: SNAPSHOT_MARKER,
      observedAt: NOW,
      columnPrivilegesPresent
    }
  ]
  queryResults.roles = [
    {
      roleOid: '10',
      roleName: 'postgres',
      superuser: true,
      bypassRls: true,
      inherit: true
    },
    {
      roleOid: '11',
      roleName: 'anon',
      superuser: false,
      bypassRls: false,
      inherit: true
    },
    {
      roleOid: '12',
      roleName: 'authenticated',
      superuser: false,
      bypassRls: false,
      inherit: true
    }
  ]
  return [{ snapshotMarker: SNAPSHOT_MARKER, observedAt: NOW, queryResults }]
}

export function jsonResponse(value: unknown, status: number, url: string): Response {
  const response = new Response(JSON.stringify(value), { status })
  Object.defineProperty(response, 'url', { value: url })
  return response
}
