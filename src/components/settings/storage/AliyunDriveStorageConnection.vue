<script setup lang="ts">
/* eslint-disable max-lines -- OAuth, durable grant repair, and connection UI share one lifecycle boundary. */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from '@open-pencil/vue'

import type { StorageDocumentAuthority } from '@/app/integrations/storage/types'
import { activeStorageProfileID } from '@/app/integrations/storage/preferences'
import {
  ALIYUN_DRIVE_STORAGE_PROVIDER_ID,
  resolveAliyunDrivePublisherOAuthConfig
} from '@/app/integrations/storage/aliyun-drive/config'
import {
  MAX_ALIYUN_DRIVE_OAUTH_CREDENTIALS_BYTES,
  parseAliyunDriveOAuthCredentialsJSON,
  type AliyunDriveImportedOAuthClient
} from '@/app/integrations/storage/aliyun-drive/oauth/credentials'
import { LocalAliyunDriveOAuthMetadataStore } from '@/app/integrations/storage/aliyun-drive/oauth/metadata'
import { AliyunDriveOAuthError } from '@/app/integrations/storage/aliyun-drive/oauth/errors'
import { aliyunDriveAuthorizationCredentialRef } from '@/app/integrations/storage/aliyun-drive/oauth/runtime'
import {
  type AliyunDriveOAuthConnection,
  type AliyunDriveOAuthStatus
} from '@/app/integrations/storage/aliyun-drive/oauth/session'
import {
  disposeAliyunDriveRuntimeProfile,
  getAliyunDriveRuntimeServices
} from '@/app/integrations/storage/aliyun-drive/runtime'
import { appCredentialServices } from '@/app/settings/credentials/app'
import { credentialRef } from '@/app/settings/credentials/reference'
import {
  StorageDurabilityUnavailableError,
  withDurableStorageProfileMutationDrain
} from '@/app/storage/durability'
import {
  StorageProfileOpenDocumentsError,
  storageProfileHasOpenTabs
} from '@/app/storage/mutation-drain'
import {
  adoptStorageAuthorizationWork,
  listStaleStorageAuthorizationWork,
  listStorageProfileAuthorizationWork,
  resumeStorageSync,
  type StorageAuthorizationWorkInspection
} from '@/app/storage/sync'
import { getTabsSnapshot } from '@/app/tabs'

type Operation = 'idle' | 'connecting' | 'committing' | 'checking' | 'disconnecting' | 'repairing'
type Feedback = Readonly<{ tone: 'success' | 'error' | 'neutral'; message: string }>
type DialogEntry = string | ((parameters: Record<string, unknown>) => string)
type ConnectionState = AliyunDriveOAuthStatus | Readonly<{ state: 'setup'; profileId: string }>

class AliyunDriveUnfinishedAuthorizationWorkError extends Error {
  constructor() {
    super('Aliyun Drive profile still has unfinished durable work')
    this.name = 'AliyunDriveUnfinishedAuthorizationWorkError'
  }
}

const emit = defineEmits<{
  ready: [providerId: typeof ALIYUN_DRIVE_STORAGE_PROVIDER_ID, ready: boolean]
}>()

const { dialogs } = useI18n()
const publisherConfig = resolveAliyunDrivePublisherOAuthConfig()
const metadataStore = new LocalAliyunDriveOAuthMetadataStore()
const connectionState = ref<ConnectionState>({
  state: 'setup',
  profileId: activeStorageProfileID.value
})
const operation = ref<Operation>('idle')
const feedback = ref<Feedback | null>(null)
const staleAuthorizationWork = ref<StorageAuthorizationWorkInspection[]>([])
const credentialsInput = ref<HTMLInputElement | null>(null)
let controller: AbortController | null = null
let generation = 0
let mounted = false

function message(key: string, fallback: string, parameters: Record<string, unknown> = {}): string {
  const entry = Reflect.get(dialogs.value, key) as DialogEntry | undefined
  if (typeof entry === 'function') return entry(parameters)
  return typeof entry === 'string' ? entry : fallback
}

const connected = computed(() => connectionState.value.state === 'connected')
const authorized = computed(
  () => connectionState.value.state === 'connected' || connectionState.value.state === 'expired'
)
const busy = computed(() => operation.value !== 'idle')
const connectedMode = computed(() => {
  const state = connectionState.value
  if (state.state !== 'connected' && state.state !== 'expired') return null
  return state.oauthClient.mode
})
const staleWorkCount = computed(() =>
  staleAuthorizationWork.value.reduce(
    (count, inspection) => count + Math.max(inspection.documentCount, inspection.jobCount),
    0
  )
)
const statusTitle = computed(() => {
  const state = connectionState.value
  if (state.state === 'connected' || state.state === 'expired') {
    const account = state.email ?? state.subject
    if (state.state === 'expired') {
      return message('storageAliyunDriveAuthorizationExpired', 'Aliyun Drive access expired')
    }
    return message('storageAliyunDriveConnectedAs', `Connected as ${account}`, {
      account
    })
  }
  if (state.state === 'unsupported') {
    return message('storageAliyunDriveDesktopOnly', 'Aliyun Drive is available in the desktop app')
  }
  if (state.state === 'setup') {
    return message('storageAliyunDriveSetupRequired', 'Aliyun Drive setup is required')
  }
  if (state.state === 'locked') {
    return message('storageAliyunDriveCredentialLocked', 'Credential storage is locked')
  }
  if (state.state === 'unavailable') {
    return message('storageAliyunDriveCredentialUnavailable', 'Credential storage is unavailable')
  }
  if (state.state === 'invalid') {
    return message('storageAliyunDriveConnectionNeedsRepair', 'Reconnect Aliyun Drive')
  }
  return message('storageAliyunDriveNotConnected', 'Aliyun Drive is not connected')
})

const statusDetail = computed(() => {
  const state = connectionState.value
  if (state.state === 'expired') {
    return message(
      'storageAliyunDrivePublicAccessExpiredDetail',
      'This public-client access grant cannot be refreshed. Import the same client JSON and authorize again.'
    )
  }
  if (state.state === 'connected') {
    return message(
      'storageAliyunDriveConnectedDetail',
      'OpenPencil stores documents inside the application folder selected by Aliyun Drive.'
    )
  }
  if (state.state === 'unsupported') {
    return message(
      'storageAliyunDriveDesktopOnlyDetail',
      'Use the OpenPencil desktop app to authorize Aliyun Drive in the system browser.'
    )
  }
  if (state.state === 'setup') {
    return message(
      'storageAliyunDriveBuildConfigurationMissing',
      'This build could not initialize Aliyun Drive authorization.'
    )
  }
  if (state.state === 'locked') {
    return message(
      'storageAliyunDriveCredentialLockedDetail',
      'Unlock encrypted credential storage, then try again.'
    )
  }
  if (state.state === 'unavailable') {
    return message(
      'storageAliyunDriveCredentialUnavailableDetail',
      'Encrypted credential storage could not be opened on this device.'
    )
  }
  if (state.state === 'invalid') {
    return message(
      'storageAliyunDriveConnectionNeedsRepairDetail',
      'The saved account metadata and encrypted grant no longer match. Reconnect this profile.'
    )
  }
  return message(
    'storageAliyunDriveConnectDescription',
    'Authorize Aliyun Drive in your system browser with PKCE.'
  )
})

const permissionDisclosure = computed(() =>
  message(
    'storageAliyunDrivePermissionDisclosure',
    'OpenPencil requests user:base,file:all:read,file:all:write and remains inside Aliyun Drive’s service-enforced application folder.'
  )
)

const modeDescription = computed(() => {
  const state = connectionState.value
  if (state.state !== 'connected' && state.state !== 'expired') return null
  if (state.oauthClient.mode === 'publisher-broker-confidential') {
    return message('storageAliyunDriveManagedConnection', 'OpenPencil managed connection')
  }
  if (state.grantType === 'access-grant') {
    const expiresAt = state.accessExpiresAt
    if (typeof expiresAt !== 'number') return null
    const expires = new Date(expiresAt).toLocaleString()
    return message(
      'storageAliyunDrivePublicConnection',
      `Self-hosted public client · access-only grant expires ${expires}; reconnect at expiry.`,
      { expires }
    )
  }
  return message('storageAliyunDriveSelfHostedConnection', 'Self-hosted confidential client')
})

function services(profileId = activeStorageProfileID.value) {
  return getAliyunDriveRuntimeServices({
    preferences: {},
    profileId,
    credentialManager: appCredentialServices.manager,
    credentialResolver: appCredentialServices.resolver,
    resolveCredential(field) {
      return appCredentialServices.resolver.resolve(
        credentialRef(ALIYUN_DRIVE_STORAGE_PROVIDER_ID, field, profileId)
      )
    }
  })
}

function current(requestGeneration: number, profileId: string): boolean {
  return mounted && requestGeneration === generation && profileId === activeStorageProfileID.value
}

function setReady(ready: boolean): void {
  if (mounted) emit('ready', ALIYUN_DRIVE_STORAGE_PROVIDER_ID, ready)
}

function profileHasOpenTabs(profileId: string): boolean {
  return storageProfileHasOpenTabs(
    { providerId: ALIYUN_DRIVE_STORAGE_PROVIDER_ID, profileId },
    getTabsSnapshot().map((tab) => tab.store)
  )
}

function authorizationAccount(
  inspections: readonly StorageAuthorizationWorkInspection[]
): string | undefined {
  const accountIds = new Set(inspections.map((inspection) => inspection.scope.authority.accountId))
  if (accountIds.size > 1) {
    throw new AliyunDriveOAuthError(
      'authority-mismatch',
      'Aliyun Drive profile contains durable work for multiple accounts'
    )
  }
  return accountIds.values().next().value
}

function authority(connection: AliyunDriveOAuthConnection): StorageDocumentAuthority {
  return {
    accountId: connection.subject,
    authorizationVersion: connection.authorizationVersion
  }
}

function authorizationScope(profileId: string, authority: StorageDocumentAuthority) {
  return { providerId: ALIYUN_DRIVE_STORAGE_PROVIDER_ID, profileId, authority }
}

async function refreshStaleAuthorizationWork(
  profileId: string,
  authority: StorageDocumentAuthority,
  requestGeneration: number
): Promise<StorageAuthorizationWorkInspection[]> {
  const stale = await listStaleStorageAuthorizationWork(authorizationScope(profileId, authority))
  if (!current(requestGeneration, profileId)) return []
  staleAuthorizationWork.value = stale
  return stale
}

function operationError(error: unknown, signal: AbortSignal): string {
  if (signal.aborted) {
    return message('storageAliyunDriveCancelled', 'Aliyun Drive operation cancelled')
  }
  if (error instanceof StorageProfileOpenDocumentsError) {
    return message(
      'storageAliyunDriveAuthorizationBlockedByOpenDocuments',
      'Close documents from this Aliyun Drive profile before changing its authorization.'
    )
  }
  if (error instanceof AliyunDriveUnfinishedAuthorizationWorkError) {
    return message(
      'storageAliyunDriveUnfinishedWork',
      'Finish or repair pending Aliyun Drive sync work before removing this account from the device.'
    )
  }
  if (error instanceof StorageDurabilityUnavailableError) {
    return message(
      'storageDurabilityUnavailable',
      'Durable local storage is unavailable, so the Aliyun Drive authorization was left unchanged.'
    )
  }
  if (error instanceof AliyunDriveOAuthError) {
    const byCode: Partial<Record<AliyunDriveOAuthError['code'], string>> = {
      unsupported: message(
        'storageAliyunDriveDesktopOnly',
        'Aliyun Drive is available in the desktop app'
      ),
      'setup-required': message(
        'storageAliyunDriveBuildConfigurationMissing',
        'This build does not include the publisher Aliyun client ID and Broker configuration.'
      ),
      cancelled: message('storageAliyunDriveCancelled', 'Aliyun Drive operation cancelled'),
      'credential-locked': message(
        'storageAliyunDriveCredentialLocked',
        'Credential storage is locked'
      ),
      'credential-unavailable': message(
        'storageAliyunDriveCredentialUnavailable',
        'Credential storage is unavailable'
      ),
      'authority-mismatch': message(
        'storageAliyunDriveMultipleAccounts',
        'This profile contains inconsistent durable account work and must be repaired before reconnecting.'
      ),
      'profile-account-mismatch': message(
        'storageAliyunDriveDifferentAccount',
        'Use a new storage profile for a different Aliyun account.'
      ),
      'authorization-denied': message(
        'storageAliyunDriveAuthorizationDenied',
        'Aliyun authorization was denied.'
      ),
      'authorization-timeout': message(
        'storageAliyunDriveAuthorizationTimedOut',
        'Aliyun device authorization timed out.'
      ),
      'oauth-client-invalid': message(
        'storageAliyunDriveCredentialsInvalid',
        'The selected Aliyun OAuth application credentials are invalid.'
      ),
      'authorization-grant-invalid': message(
        'storageProviderNotConnected',
        'Aliyun Drive must be reconnected.',
        { provider: 'Aliyun Drive' }
      ),
      'token-request-invalid': message(
        'storageAliyunDriveTokenRequestInvalid',
        'Aliyun rejected the token request. Start the connection again.'
      ),
      'browser-open-failed': message(
        'storageAliyunDriveBrowserOpenFailed',
        'The system browser could not be opened.'
      ),
      'scope-mismatch': message(
        'storageAliyunDriveScopeMismatch',
        'Aliyun did not grant the required Drive scopes.'
      ),
      'network-failed': message(
        'storageAliyunDriveNetworkFailed',
        'Aliyun Drive could not be reached.'
      ),
      'oauth-broker-unavailable': message(
        'storageTemporaryNetworkError',
        'The OpenPencil Aliyun connection service is temporarily unavailable.'
      ),
      'token-exchange-failed': message(
        'storageAliyunDriveTokenRequestInvalid',
        'Aliyun could not complete the device-token exchange.'
      ),
      'token-response-invalid': message(
        'storageAliyunDriveConnectionNeedsRepair',
        'Aliyun returned an invalid token response. Reconnect this profile.'
      ),
      'userinfo-failed': message(
        'storageAliyunDriveVerificationFailed',
        'OpenPencil could not verify the authorized Aliyun account.'
      ),
      'subject-mismatch': message(
        'storageAliyunDriveDifferentAccount',
        'The authorization belongs to a different Aliyun account.'
      ),
      'rate-limited': message(
        'storageTemporaryNetworkError',
        'Aliyun temporarily rate limited requests.'
      )
    }
    const translated = byCode[error.code]
    if (translated) return translated
  }
  return message('storageAliyunDriveOperationFailed', 'Aliyun Drive operation failed')
}

async function refreshStatus(): Promise<void> {
  const requestGeneration = ++generation
  const profileId = activeStorageProfileID.value
  try {
    const status = await services(profileId).oauth.status()
    if (!current(requestGeneration, profileId)) return
    connectionState.value = status
    if (status.state !== 'connected' && status.state !== 'expired') {
      staleAuthorizationWork.value = []
      setReady(false)
      return
    }
    try {
      const stale = await refreshStaleAuthorizationWork(
        profileId,
        authority(status),
        requestGeneration
      )
      if (!current(requestGeneration, profileId)) return
      setReady(status.state === 'connected' && stale.length === 0)
    } catch {
      if (!current(requestGeneration, profileId)) return
      staleAuthorizationWork.value = []
      setReady(false)
      feedback.value = {
        tone: 'error',
        message: message(
          'storageAliyunDriveAuthorizationWorkRepairFailed',
          'OpenPencil could not inspect pending Aliyun Drive work. Try again.'
        )
      }
    }
  } catch {
    if (!current(requestGeneration, profileId)) return
    connectionState.value = { state: 'setup', profileId }
    staleAuthorizationWork.value = []
    setReady(false)
  }
}

function beginOperation(next: Exclude<Operation, 'idle'>) {
  controller?.abort()
  controller = new AbortController()
  operation.value = next
  feedback.value = null
  return {
    controller,
    requestGeneration: ++generation,
    profileId: activeStorageProfileID.value
  }
}

function finishOperation(operationController: AbortController): void {
  if (!mounted || controller !== operationController) return
  controller = null
  operation.value = 'idle'
}

function chooseSelfHostedCredentials(): void {
  if (busy.value || connectionState.value.state === 'unsupported') return
  if (!credentialsInput.value) return
  credentialsInput.value.value = ''
  credentialsInput.value.click()
}

async function onCredentialsInputChange(event: Event): Promise<void> {
  const input = event.currentTarget as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || busy.value) return
  if (file.size > MAX_ALIYUN_DRIVE_OAUTH_CREDENTIALS_BYTES) {
    feedback.value = {
      tone: 'error',
      message: message(
        'storageAliyunDriveCredentialsInvalid',
        'The selected Aliyun credentials file is invalid or too large.'
      )
    }
    return
  }
  try {
    const credentialsJSON = await file.text()
    const oauthClient = parseAliyunDriveOAuthCredentialsJSON(credentialsJSON)
    await connect(oauthClient)
  } catch {
    feedback.value = {
      tone: 'error',
      message: message(
        'storageAliyunDriveCredentialsInvalid',
        'Use the strict Aliyun public or confidential OAuth client JSON format.'
      )
    }
  }
}

async function connect(oauthClient?: AliyunDriveImportedOAuthClient): Promise<void> {
  if (busy.value || (!oauthClient && !publisherConfig)) return
  const active = beginOperation('connecting')
  try {
    const result = await withDurableStorageProfileMutationDrain(
      { providerId: ALIYUN_DRIVE_STORAGE_PROVIDER_ID, profileId: active.profileId },
      async () => {
        if (profileHasOpenTabs(active.profileId)) {
          throw new StorageProfileOpenDocumentsError()
        }
        const before = await listStorageProfileAuthorizationWork({
          providerId: ALIYUN_DRIVE_STORAGE_PROVIDER_ID,
          profileId: active.profileId
        })
        const expectedSubject = authorizationAccount(before)
        const common = {
          signal: active.controller.signal,
          ...(expectedSubject ? { expectedSubject } : {}),
          onCommitStart() {
            if (current(active.requestGeneration, active.profileId)) {
              operation.value = 'committing'
            }
          }
        }
        const connectedAccount = await services(active.profileId).oauth.connect({
          ...common,
          oauthClient: oauthClient ?? { mode: 'publisher-broker-confidential' }
        })
        const nextAuthority = authority(connectedAccount)

        // Re-enumerate after the durable grant commit so crash-gap rows that were not represented
        // by the old public metadata are adopted too. The profile drain prevents new writers from
        // racing this authority migration.
        const after = await listStorageProfileAuthorizationWork({
          providerId: ALIYUN_DRIVE_STORAGE_PROVIDER_ID,
          profileId: active.profileId
        })
        const durableAccount = authorizationAccount(after)
        if (durableAccount && durableAccount !== nextAuthority.accountId) {
          throw new AliyunDriveOAuthError(
            'authority-mismatch',
            'Aliyun Drive durable work belongs to a different Aliyun account'
          )
        }
        for (const inspection of after) {
          const previousAuthority = inspection.scope.authority
          if (
            previousAuthority.accountId !== nextAuthority.accountId ||
            previousAuthority.authorizationVersion === nextAuthority.authorizationVersion
          ) {
            continue
          }
          await adoptStorageAuthorizationWork({
            providerId: ALIYUN_DRIVE_STORAGE_PROVIDER_ID,
            profileId: active.profileId,
            previousAuthority,
            nextAuthority
          })
        }
        return connectedAccount
      },
      active.controller.signal
    )
    if (!current(active.requestGeneration, active.profileId)) return
    connectionState.value = { state: 'connected', ...result }
    const runtime = services(active.profileId)
    const verification = await runtime.adapter.testConnection({
      signal: active.controller.signal
    })
    if (!current(active.requestGeneration, active.profileId)) return
    const stale = await refreshStaleAuthorizationWork(
      active.profileId,
      authority(result),
      active.requestGeneration
    )
    if (!current(active.requestGeneration, active.profileId)) return
    await resumeStorageSync()
    if (!current(active.requestGeneration, active.profileId)) return
    setReady(verification.ok && stale.length === 0)
    feedback.value = {
      tone: verification.ok ? 'success' : 'error',
      message: verification.ok
        ? message('storageAliyunDriveConnectionHealthy', 'Aliyun Drive connection is healthy')
        : message(
            'storageAliyunDriveVerificationFailed',
            'The account connected, but OpenPencil could not verify Aliyun Drive access.'
          )
    }
  } catch (error) {
    if (!current(active.requestGeneration, active.profileId)) return
    feedback.value = {
      tone: 'error',
      message: operationError(error, active.controller.signal)
    }
    await refreshStatus()
  } finally {
    finishOperation(active.controller)
  }
}

async function checkConnection(): Promise<void> {
  if (busy.value || !connected.value) return
  const active = beginOperation('checking')
  try {
    const result = await services(active.profileId).adapter.testConnection({
      signal: active.controller.signal
    })
    if (!current(active.requestGeneration, active.profileId)) return
    setReady(result.ok && staleAuthorizationWork.value.length === 0)
    feedback.value = {
      tone: result.ok ? 'success' : 'error',
      message: result.ok
        ? message('storageAliyunDriveConnectionHealthy', 'Aliyun Drive connection is healthy')
        : message(
            'storageAliyunDriveVerificationFailed',
            'OpenPencil could not verify Aliyun Drive access. Check the account permission and network.'
          )
    }
  } catch (error) {
    if (!current(active.requestGeneration, active.profileId)) return
    feedback.value = {
      tone: 'error',
      message: operationError(error, active.controller.signal)
    }
  } finally {
    finishOperation(active.controller)
  }
}

async function disconnect(): Promise<void> {
  if (busy.value) return
  const active = beginOperation('disconnecting')
  try {
    await withDurableStorageProfileMutationDrain(
      { providerId: ALIYUN_DRIVE_STORAGE_PROVIDER_ID, profileId: active.profileId },
      async () => {
        if (profileHasOpenTabs(active.profileId)) {
          throw new StorageProfileOpenDocumentsError()
        }
        const inspections = await listStorageProfileAuthorizationWork({
          providerId: ALIYUN_DRIVE_STORAGE_PROVIDER_ID,
          profileId: active.profileId
        })
        authorizationAccount(inspections)
        if (inspections.some((inspection) => inspection.requiresConfirmation)) {
          throw new AliyunDriveUnfinishedAuthorizationWorkError()
        }
        await services(active.profileId).oauth.disconnect(active.controller.signal)
      },
      active.controller.signal
    )
    if (!current(active.requestGeneration, active.profileId)) return
    connectionState.value = { state: 'missing', profileId: active.profileId }
    staleAuthorizationWork.value = []
    setReady(false)
    feedback.value = {
      tone: 'neutral',
      message: message(
        'storageAliyunDriveRemovedLocally',
        'Aliyun Drive was removed from this device'
      )
    }
  } catch (error) {
    if (!current(active.requestGeneration, active.profileId)) return
    feedback.value = {
      tone: 'error',
      message: operationError(error, active.controller.signal)
    }
  } finally {
    finishOperation(active.controller)
  }
}

async function repairStaleWork(): Promise<void> {
  if (busy.value || staleAuthorizationWork.value.length === 0) return
  const active = beginOperation('repairing')
  try {
    const verification = await withDurableStorageProfileMutationDrain(
      { providerId: ALIYUN_DRIVE_STORAGE_PROVIDER_ID, profileId: active.profileId },
      async () => {
        const runtime = services(active.profileId)
        const status = await runtime.oauth.status()
        if (!current(active.requestGeneration, active.profileId)) return null
        if (status.state !== 'connected') {
          throw new AliyunDriveOAuthError(
            'authorization-grant-invalid',
            'Aliyun Drive authorization is missing'
          )
        }
        if (profileHasOpenTabs(active.profileId)) {
          throw new StorageProfileOpenDocumentsError()
        }
        const nextAuthority = authority(status)
        const stale = await listStaleStorageAuthorizationWork(
          authorizationScope(active.profileId, nextAuthority)
        )
        if (!current(active.requestGeneration, active.profileId)) return null
        if (
          stale.some(
            (inspection) => inspection.scope.authority.accountId !== nextAuthority.accountId
          )
        ) {
          throw new AliyunDriveOAuthError(
            'authority-mismatch',
            'Aliyun Drive durable work belongs to a different Aliyun account'
          )
        }
        for (const inspection of stale) {
          await adoptStorageAuthorizationWork({
            providerId: ALIYUN_DRIVE_STORAGE_PROVIDER_ID,
            profileId: active.profileId,
            previousAuthority: inspection.scope.authority,
            nextAuthority
          })
          if (!current(active.requestGeneration, active.profileId)) return null
        }
        const remaining = await refreshStaleAuthorizationWork(
          active.profileId,
          nextAuthority,
          active.requestGeneration
        )
        if (!current(active.requestGeneration, active.profileId)) return null
        if (remaining.length > 0) {
          throw new Error('Aliyun Drive authorization work changed during repair')
        }
        await resumeStorageSync()
        if (!current(active.requestGeneration, active.profileId)) return null
        return runtime.adapter.testConnection({ signal: active.controller.signal })
      },
      active.controller.signal
    )
    if (!current(active.requestGeneration, active.profileId) || !verification) return
    setReady(verification.ok)
    feedback.value = {
      tone: verification.ok ? 'success' : 'error',
      message: verification.ok
        ? message(
            'storageAliyunDriveAuthorizationWorkRecovered',
            'Pending Aliyun Drive work was safely reconnected.'
          )
        : message(
            'storageAliyunDriveVerificationFailed',
            'Pending work was repaired, but OpenPencil could not verify Aliyun Drive access.'
          )
    }
  } catch (error) {
    if (!current(active.requestGeneration, active.profileId)) return
    setReady(false)
    feedback.value = {
      tone: 'error',
      message: operationError(error, active.controller.signal)
    }
  } finally {
    finishOperation(active.controller)
  }
}

function cancelOperation(): void {
  if (operation.value === 'committing' || operation.value === 'repairing') return
  const activeController = controller
  controller = null
  generation++
  operation.value = 'idle'
  activeController?.abort(new DOMException('Cancelled by the user', 'AbortError'))
  feedback.value = {
    tone: 'neutral',
    message: message('storageAliyunDriveCancelled', 'Aliyun Drive operation cancelled')
  }
}

async function removeProfile(profileId: string): Promise<void> {
  controller?.abort(new DOMException('Storage profile is being removed', 'AbortError'))
  generation++
  controller = null
  operation.value = 'idle'
  disposeAliyunDriveRuntimeProfile(appCredentialServices.manager, profileId)
  await Promise.all([
    appCredentialServices.manager.clear(aliyunDriveAuthorizationCredentialRef(profileId)),
    metadataStore.remove(profileId)
  ])
}

defineExpose({ removeProfile })

watch(activeStorageProfileID, () => {
  generation++
  controller?.abort()
  controller = null
  operation.value = 'idle'
  feedback.value = null
  staleAuthorizationWork.value = []
  void refreshStatus()
})

onMounted(() => {
  mounted = true
  void refreshStatus()
})

onBeforeUnmount(() => {
  mounted = false
  generation++
  controller?.abort()
  controller = null
})
</script>

<template>
  <div class="flex flex-col gap-3" data-test-id="settings-storage-aliyun-drive">
    <div
      class="rounded-lg border border-border bg-panel/50 p-3"
      :data-state="connected ? 'connected' : 'disconnected'"
    >
      <div class="flex items-start gap-3">
        <div
          class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-hover text-muted data-[state=connected]:bg-success/15 data-[state=connected]:text-success"
          :data-state="connected ? 'connected' : 'disconnected'"
        >
          <icon-lucide-cloud class="size-4" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2">
            <p class="truncate text-[11px] font-medium text-surface">{{ statusTitle }}</p>
            <span
              v-if="connected"
              class="rounded-full bg-success/15 px-1.5 py-0.5 text-[9px] font-medium text-success"
            >
              {{ message('storageConnected', 'Connected') }}
            </span>
          </div>
          <p class="mt-1 text-[10px] leading-4 text-muted">{{ statusDetail }}</p>
          <p v-if="modeDescription" class="mt-1 text-[9px] leading-4 text-muted">
            {{ modeDescription }}
          </p>
        </div>
      </div>

      <div class="mt-3 flex flex-wrap gap-2">
        <template v-if="authorized">
          <button
            type="button"
            class="rounded bg-hover px-3 py-1.5 text-[10px] font-medium text-surface hover:bg-active disabled:opacity-50"
            :disabled="busy"
            data-test-id="settings-storage-aliyun-drive-check"
            @click="checkConnection"
          >
            {{
              operation === 'checking'
                ? message('storageCheckingConnection', 'Checking…')
                : message('storageCheckConnection', 'Check connection')
            }}
          </button>
          <button
            type="button"
            class="rounded px-3 py-1.5 text-[10px] text-muted hover:bg-hover hover:text-surface disabled:opacity-50"
            :disabled="busy"
            data-test-id="settings-storage-aliyun-drive-reconnect"
            @click="
              connectedMode?.startsWith('self-hosted-') ? chooseSelfHostedCredentials() : connect()
            "
          >
            {{ message('storageAliyunDriveReconnect', 'Reconnect') }}
          </button>
          <button
            type="button"
            class="rounded px-3 py-1.5 text-[10px] text-danger hover:bg-danger/10 disabled:opacity-50"
            :disabled="busy"
            data-test-id="settings-storage-aliyun-drive-disconnect"
            @click="disconnect"
          >
            {{ message('storageAliyunDriveRemoveFromDevice', 'Remove from this device') }}
          </button>
        </template>
        <template v-else-if="connectionState.state !== 'unsupported'">
          <button
            v-if="publisherConfig"
            type="button"
            class="rounded bg-accent px-3 py-1.5 text-[11px] font-medium text-white hover:bg-accent/90 disabled:opacity-50"
            :disabled="busy"
            data-test-id="settings-storage-aliyun-drive-connect"
            @click="connect()"
          >
            {{
              operation === 'connecting'
                ? message('storageAliyunDriveWaitingForBrowser', 'Waiting for browser…')
                : message('storageAliyunDriveConnect', 'Connect Aliyun Drive')
            }}
          </button>
          <button
            type="button"
            class="rounded bg-hover px-3 py-1.5 text-[10px] font-medium text-surface hover:bg-active disabled:opacity-50"
            :disabled="busy"
            data-test-id="settings-storage-aliyun-drive-import-credentials"
            @click="chooseSelfHostedCredentials"
          >
            {{ message('storageAliyunDriveImportCredentials', 'Import credentials JSON') }}
          </button>
        </template>
        <button
          v-if="connectionState.state === 'invalid'"
          type="button"
          class="rounded px-3 py-1.5 text-[10px] text-danger hover:bg-danger/10 disabled:opacity-50"
          :disabled="busy"
          data-test-id="settings-storage-aliyun-drive-remove-invalid"
          @click="disconnect"
        >
          {{ message('storageAliyunDriveRemoveFromDevice', 'Remove from this device') }}
        </button>
        <button
          v-if="operation === 'connecting' || operation === 'checking'"
          type="button"
          class="rounded px-3 py-1.5 text-[10px] text-muted hover:bg-hover hover:text-surface"
          @click="cancelOperation"
        >
          {{ message('cancel', 'Cancel') }}
        </button>
      </div>
    </div>

    <div class="rounded border border-border/70 bg-panel/20 p-2.5">
      <div class="flex items-start gap-2">
        <icon-lucide-shield-check class="mt-0.5 size-3.5 shrink-0 text-muted" />
        <div class="min-w-0">
          <p class="text-[10px] font-medium text-surface">
            user:base,file:all:read,file:all:write · application folder
          </p>
          <p class="mt-1 text-[9px] leading-4 text-muted">{{ permissionDisclosure }}</p>
        </div>
      </div>
      <p class="mt-2 text-[9px] leading-4 text-muted">
        {{
          message(
            'storageAliyunDriveCredentialStorage',
            'Self-hosted confidential client credentials and refresh tokens are encrypted together in app-local storage. Public-client mode has no refresh token and must reconnect at expiry.'
          )
        }}
      </p>
      <p v-if="!publisherConfig" class="mt-2 text-[9px] leading-4 text-warning">
        {{
          message(
            'storageAliyunDriveBuildConfigurationMissing',
            'The managed connection is unavailable in this build; self-hosted credentials remain available.'
          )
        }}
      </p>
    </div>

    <div
      v-if="staleAuthorizationWork.length > 0"
      class="rounded border border-warning/30 bg-warning/10 p-2.5 text-[10px] leading-4 text-muted"
      role="status"
      aria-live="polite"
    >
      <p>
        {{
          message(
            'storageAliyunDriveStaleWorkDescription',
            `OpenPencil found ${staleWorkCount} local Aliyun Drive item(s) from an interrupted reconnect. Repair them before opening this workspace.`,
            { count: staleWorkCount }
          )
        }}
      </p>
      <button
        type="button"
        class="mt-2 rounded bg-hover px-2.5 py-1 text-[10px] font-medium text-surface hover:bg-active disabled:opacity-50"
        :disabled="busy"
        data-test-id="settings-storage-aliyun-drive-repair-authorization"
        @click="repairStaleWork"
      >
        {{
          message('storageAliyunDriveRepairAuthorizationWork', `Repair ${staleWorkCount} item(s)`, {
            count: staleWorkCount
          })
        }}
      </button>
    </div>

    <input
      ref="credentialsInput"
      class="hidden"
      type="file"
      accept=".json,application/json"
      data-test-id="settings-storage-aliyun-drive-credentials-input"
      @change="onCredentialsInputChange"
    />

    <p
      v-if="feedback"
      class="rounded border border-border bg-panel px-2 py-1.5 text-[10px] text-muted data-[tone=success]:text-success data-[tone=error]:text-danger"
      :data-tone="feedback.tone"
      role="status"
      aria-live="polite"
    >
      {{ feedback.message }}
    </p>
  </div>
</template>
