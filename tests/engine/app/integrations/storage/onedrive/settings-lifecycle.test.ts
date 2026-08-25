import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(
  resolve(
    import.meta.dir,
    '../../../../../../src/components/settings/storage/OneDriveStorageConnection.vue'
  ),
  'utf8'
)

function functionSource(start: string, end: string): string {
  const startIndex = source.indexOf(start)
  const endIndex = source.indexOf(end, startIndex)
  if (startIndex === -1 || endIndex === -1) throw new Error(`Expected ${start} before ${end}`)
  return source.slice(startIndex, endIndex)
}

describe('OneDrive storage connection lifecycle', () => {
  test('discloses the app-folder permission instead of broad file access', () => {
    expect(source).toContain('Files.ReadWrite.AppFolder')
    expect(source).not.toContain('requests Files.ReadWrite to read and write OneDrive files')
    expect(source).not.toContain('>Files.ReadWrite</p>')
  })

  test('verifies real Drive access and resumes adopted work after connect', () => {
    const connect = functionSource('async function connect()', 'async function checkConnection()')
    const adoption = connect.indexOf('await adoptStorageAuthorizationWork({')
    const verification = connect.indexOf('await runtime.adapter.testConnection({')
    const resume = connect.indexOf('await resumeStorageSync()')

    expect(adoption).toBeGreaterThan(-1)
    expect(verification).toBeGreaterThan(adoption)
    expect(resume).toBeGreaterThan(verification)
    expect(connect).toContain('setReady(verification.ok && stale.length === 0)')
    expect(connect).toContain("tone: verification.ok ? 'success' : 'error'")
    expect(connect).toContain("'storageOneDriveVerificationFailed'")
  })

  test('checks the OneDrive namespace rather than only refreshing OAuth', () => {
    const check = functionSource('async function checkConnection()', 'async function disconnect()')

    expect(check).toContain('.adapter.testConnection({')
    expect(check).not.toContain('.oauth.refresh(')
    expect(check).toContain('setReady(result.ok && staleAuthorizationWork.value.length === 0)')
    expect(check).toContain("tone: result.ok ? 'success' : 'error'")
  })

  test('discovers crash-gap work on mount and repairs only the connected account', () => {
    const refresh = functionSource('async function refreshStatus()', 'function beginOperation')
    const repair = functionSource('async function repairStaleWork()', 'function cancelOperation()')
    const mount = functionSource('onMounted(', 'onBeforeUnmount(')

    expect(refresh).toContain('refreshStaleAuthorizationWork(')
    expect(refresh).toContain('status.authority')
    expect(refresh).toContain('setReady(stale.length === 0)')
    expect(mount).toContain('void refreshStatus()')

    const list = repair.indexOf('await listStaleStorageAuthorizationWork(')
    const accountGuard = repair.indexOf(
      'inspection.scope.authority.accountId !== status.authority.accountId'
    )
    const adopt = repair.indexOf('await adoptStorageAuthorizationWork({')
    const resume = repair.indexOf('await resumeStorageSync()')
    expect(repair).toContain('withDurableStorageProfileMutationDrain(')
    expect(repair).toContain('if (profileHasOpenTabs(active.profileId))')
    expect(list).toBeGreaterThan(-1)
    expect(accountGuard).toBeGreaterThan(list)
    expect(adopt).toBeGreaterThan(accountGuard)
    expect(resume).toBeGreaterThan(adopt)
    expect(source).toContain('data-test-id="settings-storage-onedrive-repair-authorization"')
  })

  test('does not cancel the authorization commit or a partial durable repair', () => {
    const cancel = functionSource('function cancelOperation()', 'async function removeProfile(')
    expect(cancel).toContain(
      "if (operation.value === 'committing' || operation.value === 'repairing') return"
    )
  })
})
