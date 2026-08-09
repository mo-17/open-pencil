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

describe('Google Drive workspace async identity guards', () => {
  test('reconciles and seeds only through the captured provider profile and authority', () => {
    const reconcile = functionSource(
      'async function reconcileRemoteDocuments',
      'function configurationReadyFor'
    )
    expect(reconcile).toContain('identity: WorkspaceIdentity')
    expect(reconcile).toContain('requireCurrent(operationIsCurrent)')
    expect(reconcile).toContain('providerId: identity.providerId')
    expect(reconcile).toContain('profileId: identity.profileId')
    expect(reconcile).toContain('authority: identity.authority ?? null')
    expect(reconcile).not.toContain('activeStorageProviderID.value')
    expect(reconcile).not.toContain('activeStorageProfileID.value')
  })

  test('paints the account-scoped local cache before refreshing an access token', () => {
    const refresh = functionSource(
      'async function refresh()',
      'async function checkForRemoteChanges'
    )
    const metadata = refresh.indexOf('readGoogleDriveStoredAuthority(context.profileId)')
    const localPaint = refresh.indexOf('await paintLocalDocuments(identity')
    const remoteAuthority = refresh.indexOf('adapter.getAuthority?.')
    expect(metadata).toBeGreaterThan(-1)
    expect(localPaint).toBeGreaterThan(metadata)
    expect(remoteAuthority).toBeGreaterThan(localPaint)
  })

  test('commits a change cursor only after a successful relevant refresh', () => {
    const changes = functionSource(
      'async function checkForRemoteChanges',
      'async function openDocument'
    )
    const relevantBranch = changes.indexOf('if (relevant)')
    const refresh = changes.indexOf('await refresh()', relevantBranch)
    const write = changes.indexOf('writeGoogleDriveChangeCursor', relevantBranch)
    expect(relevantBranch).toBeGreaterThan(-1)
    expect(refresh).toBeGreaterThan(relevantBranch)
    expect(write).toBeGreaterThan(refresh)
    expect(changes.slice(relevantBranch, write)).toContain('return')
  })

  test('clears an expired Drive cursor before rebuilding it from a full refresh', () => {
    const changes = functionSource(
      'async function checkForRemoteChanges',
      'async function openDocument'
    )
    const expired = changes.indexOf('reason.status === 410')
    const clear = changes.indexOf('clearGoogleDriveChangeCursor(cursorIdentity)', expired)
    const refresh = changes.indexOf('await refresh()', clear)
    expect(expired).toBeGreaterThan(-1)
    expect(clear).toBeGreaterThan(expired)
    expect(refresh).toBeGreaterThan(clear)
  })

  test('freezes open and create bindings before navigation', () => {
    const open = functionSource('async function openDocument', 'async function createDocument')
    const create = functionSource('async function createDocument', 'function onVisibilityChange')
    expect(open.indexOf('const binding = bindingFor(identity, document.id)')).toBeLessThan(
      open.indexOf('await openStorageDocumentInNewTab')
    )
    expect(open.indexOf('await openStorageDocumentInNewTab')).toBeLessThan(
      open.indexOf("await router.push('/')")
    )
    expect(create).toContain('createActiveStorageAdapter(identity.providerId, identity.profileId)')
    expect(create.indexOf('await requireCloudStorageDurability()')).toBeLessThan(
      create.indexOf('await withStorageProfileMutationLease(identity')
    )
    expect(create.indexOf('await withStorageProfileMutationLease(identity')).toBeLessThan(
      create.indexOf('createActiveStorageAdapter(identity.providerId, identity.profileId)')
    )
    expect(create.indexOf('adapter.getAuthority?.')).toBeLessThan(
      create.indexOf('createController === controller')
    )
    expect(create.indexOf('createController === controller')).toBeLessThan(
      create.indexOf('adapter.reserveDocumentId?.')
    )
    expect(create).toContain('store.setStorageDocumentSource(bindingFor(identity, documentId)')
    expect(create).toContain('await store.saveFigFile({ storageMutationLease: lease })')
    expect(create.indexOf('await store.saveFigFile({ storageMutationLease: lease })')).toBeLessThan(
      create.indexOf("await router.push('/')")
    )
  })
})
