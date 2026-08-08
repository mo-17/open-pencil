import { onScopeDispose, readonly, ref, shallowReadonly, shallowRef, watch, type Ref } from 'vue'

import type { SupabaseConfig } from '@open-pencil/scene-graph'

import type { CredentialStatus } from '@/app/settings/credentials/types'

import {
  readSupabaseSchemaCatalogCacheState,
  writeCachedSupabaseSchemaCatalog,
  type SupabaseSchemaCacheReadResult
} from './cache'
import {
  clearSupabaseManagementPat,
  resolveSupabaseManagementPat,
  setSupabaseManagementPat,
  supabaseManagementPatStatus
} from './credentials'
import {
  fetchSupabaseDatabaseOpenApi,
  normalizeSupabaseSchemaName,
  projectRefFromSupabaseUrl,
  SupabaseManagementError,
  type SupabaseManagementErrorCode,
  type SupabaseOpenApiRequest,
  type SupabaseOpenApiResponse
} from './management-client'
import {
  parseSupabaseSchemaCatalog,
  type SupabaseSchemaCatalog,
  type SupabaseSchemaCatalogIdentity
} from './schema-catalog'

export type SupabaseSchemaInspectorCacheState =
  | 'idle'
  | 'loading'
  | 'hit'
  | 'miss'
  | 'expired'
  | 'invalid'

export type SupabaseSchemaInspectorRequestState =
  | 'idle'
  | 'loading'
  | 'success'
  | 'missing-credential'
  | 'error'

export type SupabaseSchemaInspectorError =
  | SupabaseManagementErrorCode
  | 'cache-read'
  | 'cache-write'
  | 'credential'
  | 'invalid-config'
  | 'invalid-openapi'
  | 'missing-credential'

export interface SupabaseSchemaInspectorDependencies {
  readCache(identity: SupabaseSchemaCatalogIdentity): Promise<SupabaseSchemaCacheReadResult>
  writeCache(catalog: SupabaseSchemaCatalog): Promise<void>
  credentialStatus(): Promise<CredentialStatus>
  setCredential(value: string): Promise<void>
  clearCredential(): Promise<void>
  resolveCredential(): Promise<string | null>
  fetchOpenApi(request: SupabaseOpenApiRequest): Promise<SupabaseOpenApiResponse>
  parseCatalog(openApi: unknown, identity: SupabaseSchemaCatalogIdentity): SupabaseSchemaCatalog
}

const DEFAULT_DEPENDENCIES: SupabaseSchemaInspectorDependencies = {
  readCache: readSupabaseSchemaCatalogCacheState,
  writeCache: writeCachedSupabaseSchemaCatalog,
  credentialStatus: supabaseManagementPatStatus,
  setCredential: setSupabaseManagementPat,
  clearCredential: clearSupabaseManagementPat,
  resolveCredential: resolveSupabaseManagementPat,
  fetchOpenApi: fetchSupabaseDatabaseOpenApi,
  parseCatalog: parseSupabaseSchemaCatalog
}

function configIdentity(config: SupabaseConfig | undefined): SupabaseSchemaCatalogIdentity | null {
  if (!config?.url) return null
  try {
    return {
      projectRef: projectRefFromSupabaseUrl(config.url),
      schema: normalizeSupabaseSchemaName(config.schema)
    }
  } catch {
    return null
  }
}

function managementErrorCode(error: unknown): SupabaseSchemaInspectorError {
  return error instanceof SupabaseManagementError ? error.code : 'invalid-openapi'
}

export function useSupabaseSchemaInspector(
  config: Readonly<Ref<SupabaseConfig | undefined>>,
  dependencyOverrides: Partial<SupabaseSchemaInspectorDependencies> = {}
) {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...dependencyOverrides }
  const catalog = shallowRef<SupabaseSchemaCatalog | null>(null)
  const source = ref<'cached' | 'live' | null>(null)
  const cacheState = ref<SupabaseSchemaInspectorCacheState>('idle')
  const requestState = ref<SupabaseSchemaInspectorRequestState>('idle')
  const error = ref<SupabaseSchemaInspectorError | null>(null)
  const credentialStatus = ref<CredentialStatus | 'loading'>('loading')
  const credentialBusy = ref(false)
  const credentialError = ref(false)
  let runVersion = 0
  let activeController: AbortController | null = null
  let credentialVersion = 0

  function cancelActiveRun(): number {
    runVersion += 1
    activeController?.abort()
    activeController = null
    return runVersion
  }

  function resetCatalogState(): void {
    catalog.value = null
    source.value = null
    cacheState.value = 'idle'
    requestState.value = 'idle'
    error.value = null
  }

  function applyCacheResult(result: SupabaseSchemaCacheReadResult): void {
    cacheState.value = result.status
    if (result.status === 'hit') {
      catalog.value = result.catalog
      source.value = 'cached'
    }
  }

  async function readCacheForRun(
    identity: SupabaseSchemaCatalogIdentity,
    version: number
  ): Promise<boolean> {
    cacheState.value = 'loading'
    try {
      const result = await dependencies.readCache(identity)
      if (version !== runVersion) return false
      applyCacheResult(result)
      return true
    } catch {
      if (version !== runVersion) return false
      cacheState.value = 'invalid'
      error.value = 'cache-read'
      return true
    }
  }

  async function loadCachedCatalog(): Promise<void> {
    const version = cancelActiveRun()
    resetCatalogState()
    const identity = configIdentity(config.value)
    if (!identity) {
      error.value = 'invalid-config'
      return
    }
    await readCacheForRun(identity, version)
  }

  async function refreshCredentialStatus(): Promise<void> {
    const version = ++credentialVersion
    credentialStatus.value = 'loading'
    credentialError.value = false
    try {
      const status = await dependencies.credentialStatus()
      if (version === credentialVersion) credentialStatus.value = status
    } catch {
      if (version !== credentialVersion) return
      credentialStatus.value = 'unavailable'
      credentialError.value = true
    }
  }

  async function saveCredential(value: string): Promise<boolean> {
    let personalAccessToken = value
    value = ''
    if (!personalAccessToken.trim()) {
      personalAccessToken = ''
      credentialError.value = true
      return false
    }
    credentialBusy.value = true
    credentialError.value = false
    try {
      await dependencies.setCredential(personalAccessToken)
      await refreshCredentialStatus()
      return true
    } catch {
      credentialError.value = true
      return false
    } finally {
      personalAccessToken = ''
      credentialBusy.value = false
    }
  }

  async function clearCredential(): Promise<boolean> {
    credentialBusy.value = true
    credentialError.value = false
    try {
      await dependencies.clearCredential()
      await refreshCredentialStatus()
      return true
    } catch {
      credentialError.value = true
      return false
    } finally {
      credentialBusy.value = false
    }
  }

  function isRunActive(version: number, controller: AbortController): boolean {
    return version === runVersion && !controller.signal.aborted
  }

  async function resolveCredentialForRun(
    version: number,
    controller: AbortController
  ): Promise<string | null> {
    try {
      const personalAccessToken = await dependencies.resolveCredential()
      if (!isRunActive(version, controller)) return null
      if (!personalAccessToken) {
        credentialStatus.value = 'missing'
        requestState.value = 'missing-credential'
        error.value = 'missing-credential'
        return null
      }
      return personalAccessToken
    } catch {
      if (!isRunActive(version, controller)) return null
      requestState.value = 'error'
      error.value = 'credential'
      return null
    }
  }

  async function cacheCatalogForRun(
    nextCatalog: SupabaseSchemaCatalog,
    version: number,
    controller: AbortController
  ): Promise<void> {
    try {
      await dependencies.writeCache(nextCatalog)
      if (isRunActive(version, controller)) cacheState.value = 'hit'
    } catch {
      if (isRunActive(version, controller)) error.value = 'cache-write'
    }
  }

  async function inspect(): Promise<void> {
    const version = cancelActiveRun()
    const controller = new AbortController()
    activeController = controller
    resetCatalogState()
    const currentConfig = config.value
    const identity = configIdentity(currentConfig)
    if (!identity || !currentConfig?.url) {
      error.value = 'invalid-config'
      activeController = null
      return
    }

    let personalAccessToken: string | null = null
    let response: SupabaseOpenApiResponse | null = null
    try {
      const cacheLoaded = await readCacheForRun(identity, version)
      if (!cacheLoaded || !isRunActive(version, controller)) return

      requestState.value = 'loading'
      personalAccessToken = await resolveCredentialForRun(version, controller)
      if (!personalAccessToken || !isRunActive(version, controller)) return

      response = await dependencies.fetchOpenApi({
        projectUrl: currentConfig.url,
        schema: identity.schema,
        personalAccessToken,
        signal: controller.signal
      })
      if (!isRunActive(version, controller)) return
      const parsed = dependencies.parseCatalog(response.openApi, identity)
      response = null
      catalog.value = parsed
      source.value = 'live'
      requestState.value = 'success'
      error.value = null
      await cacheCatalogForRun(parsed, version, controller)
    } catch (caught) {
      if (!isRunActive(version, controller)) return
      requestState.value = 'error'
      error.value = managementErrorCode(caught)
    } finally {
      personalAccessToken = null
      response = null
      if (version === runVersion) activeController = null
    }
  }

  watch(
    () => [config.value?.url, config.value?.schema],
    () => void loadCachedCatalog(),
    { immediate: true }
  )
  void refreshCredentialStatus()

  onScopeDispose(() => {
    cancelActiveRun()
    credentialVersion += 1
  })

  return {
    catalog: shallowReadonly(catalog),
    source: readonly(source),
    cacheState: readonly(cacheState),
    requestState: readonly(requestState),
    error: readonly(error),
    credentialStatus: readonly(credentialStatus),
    credentialBusy: readonly(credentialBusy),
    credentialError: readonly(credentialError),
    loadCachedCatalog,
    refreshCredentialStatus,
    saveCredential,
    clearCredential,
    inspect
  }
}
