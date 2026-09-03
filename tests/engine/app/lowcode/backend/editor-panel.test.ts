import { describe, expect, test } from 'bun:test'

describe('visual Backend editor component boundary', () => {
  test('mounts at the document-level Design panel and uses the atomic document adapter', async () => {
    const source = await Bun.file('src/components/properties/Lowcode/BackendEditorPanel.vue').text()
    const controller = await Bun.file('src/app/lowcode/backend/use-backend-editor.ts').text()
    const designPanel = await Bun.file('src/components/DesignPanel.vue').text()

    expect(designPanel).toContain(
      "import BackendEditorPanel from './properties/Lowcode/BackendEditorPanel.vue'"
    )
    expect(designPanel.indexOf('<BackendEditorPanel />')).toBeLessThan(
      designPanel.indexOf('<SupabaseConfigPanel />')
    )
    expect(controller).toContain('commitBackendProviderDocumentRequest')
    expect(controller).toContain('clearBackendProviderDocumentRequest')
    expect(controller).toContain('if (!canSave.value || busy.value) return')
    expect(controller).toContain('expectedDocumentFingerprint')
    expect(controller).toContain('applicationSnapshot')
    expect(source).toContain('data-test-id="lowcode-backend-save"')
    expect(source).toContain('data-test-id="lowcode-backend-provider-authority"')
    expect(source).toContain(':disabled="busy"')
    expect(source).not.toContain('SupabaseSchemaInspector')
    expect(source).not.toContain('CredentialManager')
  })

  test('exposes every P1 declaration surface and canonical migration risk', async () => {
    const source = await Bun.file('src/components/properties/Lowcode/BackendEditorPanel.vue').text()
    const componentSources = await Promise.all(
      [
        'BackendDataModelEditor.vue',
        'BackendRelationsEditor.vue',
        'BackendSecurityEditor.vue',
        'BackendWorkflowEditor.vue',
        'BackendMigrationDiff.vue'
      ].map((name) => Bun.file(`src/app/lowcode/backend/components/${name}`).text())
    )
    const combined = [source, ...componentSources].join('\n')

    for (const testId of [
      'lowcode-backend-provider',
      'lowcode-backend-model',
      'lowcode-backend-relations',
      'lowcode-backend-security',
      'lowcode-backend-workflows',
      'lowcode-backend-migration',
      'lowcode-backend-diagnostics'
    ]) {
      expect(combined).toContain(testId)
    }
    expect(combined).toContain('planBackendMigration')
    expect(combined).toContain("plan.highestRisk === 'destructive'")
    expect(combined).toContain('addDirectBackendRelation')
    expect(combined).toContain('addManyToManyBackendRelation')
    expect(combined).toContain('replaceBackendRelation')
    expect(combined).toContain('lowcode-backend-edit-relation')
    expect(combined).toContain('addBackendOwnership')
    expect(combined).toContain('addBackendTenant')
    expect(combined).toContain('addBackendRowAccess')
    expect(combined).toContain('addBackendWorkflow')
    expect(combined).toContain('addBackendEnum')
    expect(combined).toContain('addBackendEnumValue')
    expect(combined).toContain('addBackendRole')
    expect(combined).toContain('addBackendWorkflowStep')
    expect(combined).toContain('setBackendRelationOnDelete')
    expect(combined).toContain('lowcode-backend-relation-on-delete')
    expect(combined).toContain('lowcode-backend-workflow-filters')
    expect(combined).toContain("if (operation === 'update') selected.add('select')")
    for (const testId of [
      'lowcode-backend-enums',
      'lowcode-backend-add-enum',
      'lowcode-backend-enum-name',
      'lowcode-backend-enum-value',
      'lowcode-backend-add-enum-value',
      'lowcode-backend-roles',
      'lowcode-backend-add-role',
      'lowcode-backend-role-name',
      'lowcode-backend-workflow-step-builder'
    ]) {
      expect(combined).toContain(testId)
    }
  })

  test('edits bounded filters, preserves unsupported workflow shapes, and hides credentials', async () => {
    const source = await Bun.file(
      'src/app/lowcode/backend/components/BackendWorkflowEditor.vue'
    ).text()

    for (const kind of ['data.read', 'data.mutate', 'http.request', 'branch', 'call', 'respond']) {
      expect(source).toContain(`'${kind}'`)
    }
    expect(source).toContain(':data-test-id="`lowcode-backend-add-step-')
    expect(source).toContain('addFilter(step)')
    expect(source).toContain('filterOperators')
    expect(source).toContain('step.headers?.length')
    expect(source).toContain('step.consequent.map')
    expect(source).toContain('step.alternate.map')
    expect(source).toContain("secret.kind === 'environment'")
    expect(source).toContain("secret.exposure === 'server'")
    expect(source).not.toContain('CredentialManager')
    expect(source).not.toContain('credentialRef')
    expect(source).not.toContain('JSON.parse')
  })

  test('bounds visual inputs and persists only through the atomic editor action', async () => {
    const sources = await Promise.all(
      [
        'BackendDataModelEditor.vue',
        'BackendRelationsEditor.vue',
        'BackendSecurityEditor.vue',
        'BackendStorageEditor.vue',
        'BackendWorkflowEditor.vue'
      ].map((name) => Bun.file(`src/app/lowcode/backend/components/${name}`).text())
    )
    const combined = sources.join('\n')
    const documentAdapter = await Bun.file('src/app/lowcode/backend/document.ts').text()

    expect(combined).toContain('BACKEND_LIMITS.maxEntities')
    expect(combined).toContain('BACKEND_LIMITS.maxStorageBuckets')
    expect(combined).toContain('BACKEND_LIMITS.maxWorkflows')
    expect(combined).toContain('maxlength="63"')
    expect(combined).not.toContain('editor.state')
    expect(combined).not.toContain('graph.updateNode')
    expect(documentAdapter).toContain('editor.updateNodeWithUndo')
  })
})
