import type { BackendReleaseProviderAuthorityV1 } from '@open-pencil/lowcode/backend'
import { digestCanonicalManifest, type SupabaseConfig } from '@open-pencil/scene-graph'

import {
  normalizeSupabaseSchemaName,
  projectRefFromSupabaseURL
} from '@/app/lowcode/supabase/management-client'
import type {
  AppBackendProviderDocumentGraph,
  PreparedAppBackendProviderBuild
} from '@/app/plugins/host/backend-provider'

export function sameAuthority(
  left: BackendReleaseProviderAuthorityV1,
  right: BackendReleaseProviderAuthorityV1
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

export function sameBuild(
  left: PreparedAppBackendProviderBuild,
  right: PreparedAppBackendProviderBuild
): boolean {
  return (
    JSON.stringify(left.request) === JSON.stringify(right.request) &&
    left.plan.applicationDigest === right.plan.applicationDigest &&
    left.plan.planDigest === right.plan.planDigest &&
    left.emission.manifestDigest === right.emission.manifestDigest
  )
}

export function normalizedConfig(
  value: SupabaseConfig | undefined
): Readonly<{ projectRef: string; schema: 'public' }> | null {
  try {
    const projectRef = projectRefFromSupabaseURL(value?.url ?? '')
    const schema = normalizeSupabaseSchemaName(value?.schema)
    return schema === 'public' ? Object.freeze({ projectRef, schema }) : null
  } catch {
    return null
  }
}

export async function backendDocumentDigest(
  graph: AppBackendProviderDocumentGraph,
  build: PreparedAppBackendProviderBuild,
  projectRef: string,
  schema: 'public'
): Promise<string> {
  return digestCanonicalManifest({
    format: 'openpencil.desktop-supabase-backend-review-document.v1',
    rootId: graph.rootId,
    projectRef,
    schema,
    backendProviderRequest: build.request
  })
}
