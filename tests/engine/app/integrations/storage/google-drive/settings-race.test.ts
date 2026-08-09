import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const componentRoot = resolve(import.meta.dir, '../../../../../../src/components/settings/storage')
const panelSource = readFileSync(resolve(componentRoot, 'StorageSettingsPanel.vue'), 'utf8')
const googleSource = readFileSync(
  resolve(componentRoot, 'GoogleDriveStorageConnection.vue'),
  'utf8'
)
const s3Source = readFileSync(resolve(componentRoot, 'S3CompatibleStorageSettings.vue'), 'utf8')

function functionSource(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex)
  if (startIndex === -1 || endIndex === -1) throw new Error(`Expected ${start} before ${end}`)
  return source.slice(startIndex, endIndex)
}

describe('storage settings async identity guards', () => {
  test('attributes readiness to the emitting provider rather than the active provider', () => {
    expect(panelSource).toContain(
      'function updateReadiness(providerId: StorageProviderID, ready: boolean)'
    )
    expect(panelSource).toContain('readinessKey(providerId, activeStorageProfileID.value)')
    expect(panelSource).toContain('[key]: ready')
    expect(panelSource).toContain("updateReadiness('s3-compatible', ready)")
    expect(googleSource).toContain(
      'ready: [providerId: typeof GOOGLE_DRIVE_STORAGE_PROVIDER_ID, ready: boolean]'
    )
    expect(googleSource).toContain("emit('ready', GOOGLE_DRIVE_STORAGE_PROVIDER_ID, ready)")
  })

  test('keeps a loading provider visible and only falls back after it is disabled', () => {
    expect(panelSource).toContain("storageProviderPluginState(item.id) !== 'disabled'")
    expect(panelSource).toContain('{ immediate: true }')
    expect(panelSource).not.toContain('storageProviderPluginEnabled(item.id)')
  })

  test('invalidates pending status before connect and rejects stale or unmounted results', () => {
    const refresh = functionSource(
      googleSource,
      'async function refreshStatus()',
      'function beginOperation'
    )
    const connect = functionSource(
      googleSource,
      'async function connect()',
      'async function checkConnection()'
    )
    const unmount = functionSource(googleSource, 'onBeforeUnmount', '</script>')

    expect(refresh).toContain('const generation = ++asyncGeneration')
    expect(refresh).toContain('if (!currentGeneration(generation, profileId)) return')
    expect(connect).toContain('persistClientId(activeOperation.profileId)')
    expect(connect).not.toContain('saveClientId()')
    expect(connect).toContain("beginOperation('connecting')")
    expect(
      connect.match(/currentGeneration\(activeOperation\.generation, activeOperation\.profileId\)/g)
        ?.length
    ).toBeGreaterThan(2)
    expect(googleSource).toContain('profileId === activeStorageProfileID.value')
    expect(unmount).toContain('mounted = false')
    expect(unmount).toContain('asyncGeneration++')
    expect(unmount).toContain('controller?.abort()')
    expect(unmount).toContain('controller = null')
  })

  test('captures profile-scoped preferences and removes only the selected credential authority', () => {
    expect(googleSource).toContain(
      'readStoragePreferences(GOOGLE_DRIVE_STORAGE_PROVIDER_ID, profileId)'
    )
    expect(googleSource).toContain('manager.clear(googleDriveRefreshTokenCredentialRef(profileId))')
    expect(googleSource).toContain('metadataStore.remove(profileId)')
    expect(googleSource).not.toContain('resolver.resolve(googleDriveRefreshTokenCredentialRef')
    expect(googleSource).toContain('defineExpose({ removeProfile })')
    expect(googleSource).toContain('clientIdDraft.value = readClientID(profileId)')
    expect(panelSource).toContain('readinessKey(providerId, activeStorageProfileID.value)')
    expect(panelSource).toContain('await handle.removeProfile(profileId)')
    expect(panelSource).toContain('deleteStorageProfile(providerId, profileId)')
    expect(
      panelSource.indexOf('await storageProfileRemovalBlocked(providerId, profileId)')
    ).toBeLessThan(panelSource.indexOf('await handle.removeProfile(profileId)'))
    expect(s3Source).toContain('manager.clear(credentialRef(PROVIDER_ID, field, profileId))')
    expect(s3Source).not.toContain('resolver.resolve(credentialRef(PROVIDER_ID, field, profileId))')
  })

  test('uses the bundled client ID and pre-confirms unfinished work before opening OAuth', () => {
    const readClientID = functionSource(
      googleSource,
      'function readClientID',
      'function authorityFromConnection'
    )
    const connect = functionSource(
      googleSource,
      'async function connect()',
      'async function confirmReconnect()'
    )
    const preflight = functionSource(
      googleSource,
      'async function inspectAuthorizationPreflight(',
      'function persistClientId'
    )
    const confirm = functionSource(
      googleSource,
      'async function confirmReconnect()',
      'async function cancelReconnect()'
    )
    const cancel = functionSource(
      googleSource,
      'async function cancelReconnect()',
      'async function checkConnection()'
    )

    expect(readClientID).toContain('resolveGoogleDriveClientId(')
    expect(readClientID).toContain(
      'readStoragePreferences(GOOGLE_DRIVE_STORAGE_PROVIDER_ID, profileId)'
    )
    expect(preflight).toContain('for (const authority of seeds)')
    expect(preflight).toContain('inspectStorageAuthorizationWork(authorizationScope(')
    expect(preflight).toContain('listStaleStorageAuthorizationWork(authorizationScope(')
    expect(connect.indexOf('inspectAuthorizationPreflight(')).toBeLessThan(
      connect.indexOf('if (preflight.pending) return preflight.pending')
    )
    expect(connect.indexOf('if (preflight.pending) return preflight.pending')).toBeLessThan(
      connect.indexOf('await performConnect(activeOperation, preflight.authorities)')
    )
    expect(confirm).toContain('preflight.snapshotFingerprint !== pending.snapshotFingerprint')
    expect(confirm).toContain('await performConnect(activeOperation, preflight.authorities)')
    expect(cancel).not.toContain('performConnect(')
    expect(cancel).not.toContain('oauth.connect(')
    expect(googleSource).toContain('role="alertdialog"')
    expect(googleSource).toContain('reconnectConfirmButton.value?.focus()')
  })

  test('adopts replacement authority before resume and gates disconnect and removal', () => {
    const perform = functionSource(
      googleSource,
      'async function performConnect(',
      'async function connect()'
    )
    const disconnect = functionSource(
      googleSource,
      'async function disconnect(',
      'async function repairStaleWork()'
    )
    const repair = functionSource(
      googleSource,
      'async function repairStaleWork()',
      'function cancelOperation()'
    )
    const remove = functionSource(
      googleSource,
      'async function removeProfile(',
      'defineExpose({ removeProfile })'
    )

    expect(perform.indexOf('runtime.oauth.connect(signal)')).toBeLessThan(
      perform.indexOf('adoptStorageAuthorizationWork({')
    )
    expect(perform.indexOf('adoptStorageAuthorizationWork({')).toBeLessThan(
      perform.indexOf('await resumeStorageSync()')
    )
    expect(disconnect.indexOf('inspectAuthorizationPreflight(')).toBeLessThan(
      disconnect.indexOf('.oauth.disconnect(')
    )
    expect(disconnect).toContain('inspectAuthorizationPreflight(')
    expect(disconnect).toContain('if (preflight.pending) return null')
    expect(repair.indexOf('listStaleStorageAuthorizationWork(')).toBeLessThan(
      repair.indexOf('adoptStorageAuthorizationWork({')
    )
    expect(repair.indexOf('adoptStorageAuthorizationWork({')).toBeLessThan(
      repair.indexOf('await resumeStorageSync()')
    )
    expect(remove).toContain('manager.clear(googleDriveRefreshTokenCredentialRef(profileId))')
  })

  test('preflights every credential and metadata crash authority before native OAuth', () => {
    const candidates = functionSource(
      googleSource,
      'function authorizationCandidates(',
      'function authorizationScope'
    )
    const preflight = functionSource(
      googleSource,
      'async function inspectAuthorizationPreflight(',
      'function persistClientId'
    )
    const connect = functionSource(
      googleSource,
      'async function connect()',
      'async function confirmReconnect()'
    )

    expect(candidates).toContain('state.repairAuthorities.map(')
    expect(preflight).toContain('for (const authority of seeds)')
    expect(preflight).toContain('inspection.requiresConfirmation')
    expect(connect.indexOf('inspectAuthorizationPreflight(')).toBeLessThan(
      connect.indexOf('await performConnect(')
    )
  })

  test('drains profile persistence and blocks open tabs across authorization lifecycle changes', () => {
    const connect = functionSource(
      googleSource,
      'async function connect()',
      'async function confirmReconnect()'
    )
    const confirm = functionSource(
      googleSource,
      'async function confirmReconnect()',
      'async function cancelReconnect()'
    )
    const disconnect = functionSource(
      googleSource,
      'async function disconnect(',
      'async function repairStaleWork()'
    )
    const repair = functionSource(
      googleSource,
      'async function repairStaleWork()',
      'function cancelOperation()'
    )
    const removeProfile = functionSource(
      panelSource,
      'async function confirmDeleteProfile()',
      'watch([activeStorageProviderID'
    )

    for (const operation of [connect, confirm, disconnect, repair]) {
      expect(operation).toContain('withDurableStorageProfileMutationDrain(')
    }
    expect(connect.indexOf('profileHasOpenTabs(')).toBeLessThan(
      connect.indexOf('await performConnect(')
    )
    expect(confirm.indexOf('profileHasOpenTabs(')).toBeLessThan(
      confirm.indexOf('await performConnect(')
    )
    expect(disconnect.indexOf('profileHasOpenTabs(')).toBeLessThan(
      disconnect.indexOf('.oauth.disconnect(')
    )
    expect(repair.indexOf('profileHasOpenTabs(')).toBeLessThan(
      repair.indexOf('adoptStorageAuthorizationWork({')
    )
    expect(removeProfile.indexOf('withDurableStorageProfileMutationDrain(')).toBeLessThan(
      removeProfile.indexOf('storageProfileHasOpenTabs(')
    )
    expect(removeProfile.indexOf('storageProfileHasOpenTabs(')).toBeLessThan(
      removeProfile.indexOf('prepareS3LegacyMigration({')
    )
    expect(removeProfile.indexOf('prepareS3LegacyMigration({')).toBeLessThan(
      removeProfile.indexOf('await storageProfileRemovalBlocked(')
    )
    expect(removeProfile.indexOf('await storageProfileRemovalBlocked(')).toBeLessThan(
      removeProfile.indexOf('await handle.removeProfile(profileId)')
    )
    expect(s3Source).toContain('await assertCloudStorageDurability()')
    expect(s3Source).toContain('withDurableStorageProfileMutationDrain(')
  })
})
