import { describe, expect, test } from 'bun:test'

describe('Backend Storage visual editor boundary', () => {
  test('is a first-class tab with bounded bucket and path-policy controls', async () => {
    const panel = await Bun.file('src/components/properties/Lowcode/BackendEditorPanel.vue').text()
    const source = await Bun.file(
      'src/app/lowcode/backend/components/BackendStorageEditor.vue'
    ).text()

    expect(panel).toContain('import BackendStorageEditor from')
    expect(panel).toContain("'storage'")
    expect(panel).toContain("activeTab === 'storage'")
    for (const testId of [
      'lowcode-backend-storage',
      'lowcode-backend-storage-add-bucket',
      'lowcode-backend-storage-bucket-name',
      'lowcode-backend-storage-bucket-id',
      'lowcode-backend-storage-access',
      'lowcode-backend-storage-max-bytes',
      'lowcode-backend-storage-mime-types',
      'lowcode-backend-storage-add-rule',
      'lowcode-backend-storage-prefix',
      'lowcode-backend-storage-principal',
      'lowcode-backend-storage-tenant'
    ]) {
      expect(source).toContain(testId)
    }
    expect(source).toContain('addBackendStorageBucket')
    expect(source).toContain('addBackendStoragePathRule')
    expect(source).toContain('setBackendStoragePathRulePrincipal')
    expect(source).toContain('BACKEND_LIMITS.maxStorageBuckets')
    expect(source).toContain('BACKEND_LIMITS.maxStoragePathRules')
    expect(source).toContain('BACKEND_LIMITS.maxStorageMimeTypes')
  })

  test('keeps credentials out, arms destructive edits, and relies on canonical validation', async () => {
    const source = await Bun.file(
      'src/app/lowcode/backend/components/BackendStorageEditor.vue'
    ).text()
    const documentAdapter = await Bun.file('src/app/lowcode/backend/document.ts').text()

    expect(source).toContain('armedRemoval')
    expect(source).toContain('This Storage path prefix already exists.')
    expect(source).toContain("if (operation === 'upsert')")
    expect(source).toContain('lowcodeBackendStorageConfirmRemove')
    expect(source).not.toContain('CredentialManager')
    expect(source).not.toContain('credentialRef')
    expect(source).not.toContain('service_role')
    expect(source).not.toContain('endpoint')
    expect(documentAdapter).toContain(
      'parseBackendApplicationSpecV1(prepareBackendApplicationDraft(application))'
    )
  })

  test('configures complete tenant membership without stale field bindings', async () => {
    const source = await Bun.file(
      'src/app/lowcode/backend/components/BackendSecurityEditor.vue'
    ).text()

    for (const testId of [
      'lowcode-backend-tenant-entity',
      'lowcode-backend-tenant-field',
      'lowcode-backend-membership-entity',
      'lowcode-backend-membership-identity-field',
      'lowcode-backend-membership-tenant-field'
    ]) {
      expect(source).toContain(testId)
    }
    expect(source).toContain('setBackendTenantEntity')
    expect(source).toContain('setBackendTenantField')
    expect(source).toContain('setBackendTenantMembershipEntity')
    expect(source).toContain('setBackendTenantMembershipField')
    expect(source).not.toContain('v-model="rule.tenantFieldId"')
    expect(source).not.toContain('v-model="rule.membershipEntityId"')
  })
})
