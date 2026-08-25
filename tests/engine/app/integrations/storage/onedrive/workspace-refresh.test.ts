import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(
  resolve(import.meta.dir, '../../../../../../src/views/StorageView.vue'),
  'utf8'
)

function functionSource(start: string, end: string): string {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex)
  if (startIndex === -1 || endIndex === -1) throw new Error(`Expected ${start} before ${end}`)
  return source.slice(startIndex, endIndex)
}

describe('OneDrive workspace refresh policy', () => {
  test('uses one bounded full refresh policy for providers without a change cursor', () => {
    expect(source).toContain('const WHOLE_DOCUMENT_REFRESH_INTERVAL_MS = 5 * 60_000')
    expect(source).toContain('const WHOLE_DOCUMENT_WAKE_REFRESH_COOLDOWN_MS = 30_000')
    expect(source).toContain('ONEDRIVE_STORAGE_PROVIDER_ID,')
    expect(source).toContain('ALIYUN_DRIVE_STORAGE_PROVIDER_ID,')
    expect(source).toContain('BAIDU_NETDISK_STORAGE_PROVIDER_ID')

    const remoteCheck = functionSource(
      'async function checkForRemoteChanges(',
      'async function openDocument('
    )
    const wholeDocumentBranch = remoteCheck.indexOf(
      'WHOLE_DOCUMENT_REFRESH_PROVIDERS.has(activeStorageProviderID.value)'
    )
    const googleDriveGate = remoteCheck.indexOf(
      'activeStorageProviderID.value !== GOOGLE_DRIVE_PROVIDER_ID'
    )
    expect(wholeDocumentBranch).toBeGreaterThan(-1)
    expect(googleDriveGate).toBeGreaterThan(wholeDocumentBranch)
    expect(remoteCheck).toContain(
      'await checkForWholeDocumentRemoteChanges(forceWholeDocumentRefresh)'
    )
  })

  test('forces a cooldown-bounded refresh after reconnecting or returning to the app', () => {
    const visibility = functionSource(
      'function onVisibilityChange()',
      'async function repaintCurrentLocalDocuments()'
    )
    expect(visibility).toContain('checkForRemoteChanges(true)')
    expect(source).toContain(
      "useEventListener(window, 'online', () => void checkForRemoteChanges(true))"
    )
    expect(source).toContain(
      'useIntervalFn(() => void checkForRemoteChanges(), CHANGE_POLL_INTERVAL_MS)'
    )
  })

  test('maps Aliyun and Baidu authorization, permission, network, and quota failures', () => {
    expect(source).toContain('function friendlyAliyunDriveOAuthError(')
    expect(source).toContain('function friendlyBaiduNetdiskOAuthError(')
    expect(source).toContain("reason.code === 'oauth-broker-unavailable'")
    expect(source).toContain('storageProviderPermissionDenied')
    expect(source).toContain('storageProviderQuotaExceeded')
    expect(source).toContain("friendlyWholeDocumentProviderError(reason, 'Aliyun Drive')")
    expect(source).toContain("friendlyWholeDocumentProviderError(reason, 'Baidu Netdisk')")
  })
})
