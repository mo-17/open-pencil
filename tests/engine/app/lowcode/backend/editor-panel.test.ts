import { describe, expect, test } from 'bun:test'

import { BACKEND_LIMITS } from '@open-pencil/lowcode/backend'

import { createEmptyBackendApplication } from '@/app/lowcode/backend/document'
import {
  addBackendEntity,
  addBackendWorkflow,
  addBackendWorkflowStep
} from '@/app/lowcode/backend/draft'
import { useBackendWorkflowSteps } from '@/app/lowcode/backend/use-backend-workflow-steps'

import { createTestRenderer, hostNode } from '#tests/helpers/vue/renderer'

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
        'BackendWorkflowStepsEditor.vue',
        'BackendMigrationDiff.vue'
      ].map((name) => Bun.file(`src/app/lowcode/backend/components/${name}`).text())
    )
    const stepController = await Bun.file(
      'src/app/lowcode/backend/use-backend-workflow-steps.ts'
    ).text()
    const combined = [source, ...componentSources, stepController].join('\n')

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

  test('edits bounded filters and branches, preserves unsupported headers, and hides credentials', () => {
    let nextId = 0
    const createId = (prefix: string) => `${prefix}:panel-${++nextId}`
    const application = createEmptyBackendApplication('workflow-panel')
    const entity = addBackendEntity(application, createId)
    const workflow = addBackendWorkflow(application, createId)
    addBackendWorkflow(application, createId)
    const branch = addBackendWorkflowStep(application, workflow, 'branch', createId)
    if (branch.kind !== 'branch') throw new Error('Expected a branch')
    const http = addBackendWorkflowStep(
      application,
      workflow,
      'http.request',
      createId,
      branch.consequent
    )
    const read = addBackendWorkflowStep(
      application,
      workflow,
      'data.read',
      createId,
      branch.alternate
    )
    if (http.kind !== 'http.request' || read.kind !== 'data.read') {
      throw new Error('Expected editable HTTP and data steps')
    }
    http.headers = [
      { name: 'X-Region', value: { kind: 'environment', name: 'API_ORIGIN' } },
      { name: 'Accept-Language', value: { kind: 'expression', expression: '"en-US"' } }
    ]
    const preservedHeaders = structuredClone(http.headers)
    application.secrets = [
      { kind: 'environment', name: 'API_ORIGIN', exposure: 'server', required: true },
      { kind: 'environment', name: 'PUBLIC_ORIGIN', exposure: 'client-public', required: true },
      { kind: 'environment', name: 'OPTIONAL_ORIGIN', exposure: 'server', required: false },
      {
        kind: 'credential',
        name: 'PLUGIN_CONFIG_CREDENTIAL',
        credentialRef: 'credential.123e4567-e89b-42d3-a456-426614174000',
        exposure: 'host',
        required: true
      },
      {
        kind: 'credential',
        name: 'SERVER_CREDENTIAL',
        credentialRef: 'credential.123e4567-e89b-42d3-a456-426614174001',
        exposure: 'server',
        required: true
      }
    ]
    const controllers: ReturnType<typeof useBackendWorkflowSteps>[] = []
    const app = createTestRenderer().createApp({
      setup() {
        for (const [steps, depth] of [
          [workflow.steps, 0],
          [branch.consequent, 1],
          [branch.alternate, 1]
        ] as const) {
          controllers.push(useBackendWorkflowSteps({ application, workflow, steps, depth }))
        }
        return () => null
      }
    })
    app.mount(hostNode())
    try {
      const [root, consequent, alternate] = controllers
      if (!root || !consequent || !alternate) throw new Error('Workflow editors did not mount')
      expect(root.environmentNames.value).toEqual(['API_ORIGIN'])
      for (const kind of [
        'data.read',
        'data.mutate',
        'http.request',
        'branch',
        'call',
        'respond'
      ] as const) {
        expect(root.canAddStep(workflow, kind)).toBe(true)
        const previousIds = new Set(workflow.steps.map((step) => step.id))
        root.addStep(workflow, kind)
        expect(workflow.steps.filter((step) => !previousIds.has(step.id))).toMatchObject([{ kind }])
      }

      const originalAlternate = structuredClone(branch.alternate)
      consequent.addStep(workflow, 'data.read')
      expect(branch.consequent.at(-2)?.kind).toBe('data.read')
      expect(branch.alternate).toEqual(originalAlternate)
      const originalConsequent = structuredClone(branch.consequent)
      alternate.addStep(workflow, 'data.mutate')
      expect(branch.alternate.at(-2)?.kind).toBe('data.mutate')
      expect(branch.consequent).toEqual(originalConsequent)

      alternate.addFilter(read)
      expect(read.filters).toEqual([
        {
          field: entity.fields[0]?.id,
          operator: 'eq',
          value: { kind: 'expression', expression: '$currentUser.id' }
        }
      ])
      const filter = read.filters?.[0]
      if (!filter) throw new Error('Filter was not added')
      alternate.setFilterValueKind(filter, 'environment')
      expect(filter.value).toEqual({ kind: 'environment', name: 'API_ORIGIN' })
      alternate.setFilterValueKind(filter, 'expression')
      expect(filter.value).toEqual({ kind: 'expression', expression: '$currentUser.id' })
      alternate.removeFilter(read, 0)
      expect(read.filters).toBeUndefined()
      read.filters = Array.from({ length: BACKEND_LIMITS.maxFieldsPerEntity }, () =>
        structuredClone(filter)
      )
      const fullRead = structuredClone(read)
      alternate.addFilter(read)
      expect(read).toEqual(fullRead)
      expect(alternate.operationError.value).not.toBe('')
      alternate.removeFilter(read, 0)
      alternate.addFilter(read)
      expect(read.filters).toHaveLength(BACKEND_LIMITS.maxFieldsPerEntity)
      expect(alternate.operationError.value).toBe('')

      consequent.setHttpURLKind(http, 'environment')
      expect(http.url).toEqual({ kind: 'environment', name: 'API_ORIGIN' })
      consequent.toggleHttpBody(http, true)
      consequent.setHttpBodyKind(http, 'environment')
      expect(http.body).toEqual({ kind: 'environment', name: 'API_ORIGIN' })
      consequent.toggleHttpBody(http, false)
      expect(http.body).toBeUndefined()
      expect(http.headers).toEqual(preservedHeaders)
      expect(root.environmentNames.value).not.toContain('PLUGIN_CONFIG_CREDENTIAL')
      expect(root.environmentNames.value).not.toContain('SERVER_CREDENTIAL')
      expect(root.environmentNames.value).not.toContain('PUBLIC_ORIGIN')
      expect(root.environmentNames.value).not.toContain('OPTIONAL_ORIGIN')
    } finally {
      app.unmount()
    }
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
