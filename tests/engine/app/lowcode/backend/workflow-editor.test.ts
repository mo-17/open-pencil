import { describe, expect, test } from 'bun:test'

import {
  BACKEND_LIMITS,
  parseBackendApplicationSpecV1,
  type BackendWorkflowStepIR
} from '@open-pencil/lowcode/backend'

import {
  createEmptyBackendApplication,
  prepareBackendApplicationDraft
} from '@/app/lowcode/backend/document'
import {
  BACKEND_WORKFLOW_EDITOR_MAX_NESTING,
  BackendDraftOperationError,
  addBackendEntity,
  addBackendWorkflow,
  addBackendWorkflowStep,
  canAddBackendWorkflowStep
} from '@/app/lowcode/backend/draft'
import {
  addBackendWorkflowEnvironmentReference,
  backendWorkflowEnvironmentReferences,
  removeBackendWorkflowEnvironmentReference,
  renameBackendWorkflowEnvironmentReference
} from '@/app/lowcode/backend/workflow-environment'

function fixture() {
  let nextId = 0
  const createId = (prefix: string) => `${prefix}:workflow-${++nextId}`
  const application = createEmptyBackendApplication('workflow-editor')
  const entity = addBackendEntity(application, createId)
  const workflow = addBackendWorkflow(application, createId)
  return { application, entity, workflow, createId }
}

describe('bounded recursive workflow authoring', () => {
  test('edits distinct branches and inserts executable steps before their final response', () => {
    const { application, entity, workflow, createId } = fixture()
    const branch = addBackendWorkflowStep(application, workflow, 'branch', createId)
    if (branch.kind !== 'branch') throw new Error('Expected branch')
    branch.condition = 'true'
    const read = addBackendWorkflowStep(
      application,
      workflow,
      'data.read',
      createId,
      branch.consequent
    )
    const nested = addBackendWorkflowStep(
      application,
      workflow,
      'branch',
      createId,
      branch.alternate
    )
    if (nested.kind !== 'branch') throw new Error('Expected nested branch')
    const mutate = addBackendWorkflowStep(
      application,
      workflow,
      'data.mutate',
      createId,
      nested.consequent
    )
    expect(workflow.steps.map((step) => step.kind)).toEqual(['branch', 'respond'])
    expect(branch.consequent.map((step) => step.kind)).toEqual(['data.read', 'respond'])
    expect(nested.consequent.map((step) => step.kind)).toEqual(['data.mutate', 'respond'])
    expect(mutate).toMatchObject({ entityId: entity.id })
    if (read.kind !== 'data.read') throw new Error('Expected read')
    expect(
      addBackendWorkflowStep(application, workflow, 'data.read', createId, nested.alternate)
    ).toMatchObject({ resultName: `${read.resultName}_2` })
    const response = branch.consequent.at(-1)
    if (response?.kind !== 'respond') throw new Error('Expected response')
    response.status = 201
    response.value = 'true'
    expect(parseBackendApplicationSpecV1(prepareBackendApplicationDraft(application)).ok).toBe(true)
  })

  test('reserves Core depth for nested value bindings and rejects the next branch atomically', () => {
    const { application, entity, workflow, createId } = fixture()
    let destination = workflow.steps
    for (let depth = 0; depth < BACKEND_WORKFLOW_EDITOR_MAX_NESTING; depth++) {
      const branch = addBackendWorkflowStep(application, workflow, 'branch', createId, destination)
      if (branch.kind !== 'branch') throw new Error('Expected branch')
      destination = branch.consequent
    }
    const mutate = addBackendWorkflowStep(
      application,
      workflow,
      'data.mutate',
      createId,
      destination
    )
    if (mutate.kind !== 'data.mutate') throw new Error('Expected mutate')
    mutate.filters = [
      {
        field: entity.fields[0].id,
        operator: 'eq',
        value: { kind: 'expression', expression: '$currentUser.id' }
      }
    ]
    expect(parseBackendApplicationSpecV1(prepareBackendApplicationDraft(application)).ok).toBe(true)
    const before = JSON.stringify(application)
    expect(canAddBackendWorkflowStep(application, workflow, 'branch', destination)).toBe(false)
    expect(() =>
      addBackendWorkflowStep(application, workflow, 'branch', createId, destination)
    ).toThrow(BackendDraftOperationError)
    expect(JSON.stringify(application)).toBe(before)
  })

  test('counts both branches across all workflows and rejects stale or foreign destinations', () => {
    const { application, workflow, createId } = fixture()
    const other = addBackendWorkflow(application, createId)
    const branch = addBackendWorkflowStep(application, workflow, 'branch', createId)
    if (branch.kind !== 'branch') throw new Error('Expected branch')
    other.steps = Array.from({ length: BACKEND_LIMITS.maxWorkflowSteps - 5 }, (_, index) => ({
      id: `step:limit-${index}`,
      kind: 'respond',
      status: 200
    }))
    expect(canAddBackendWorkflowStep(application, workflow, 'branch', branch.consequent)).toBe(
      false
    )
    expect(canAddBackendWorkflowStep(application, workflow, 'respond', branch.alternate)).toBe(true)
    addBackendWorkflowStep(application, workflow, 'respond', createId, branch.alternate)
    expect(canAddBackendWorkflowStep(application, workflow, 'respond')).toBe(false)
    const foreign: BackendWorkflowStepIR[] = []
    const before = JSON.stringify(application)
    expect(() =>
      addBackendWorkflowStep(application, workflow, 'respond', createId, foreign)
    ).toThrow(BackendDraftOperationError)
    expect(() =>
      addBackendWorkflowStep(application, workflow, 'respond', createId, other.steps)
    ).toThrow(BackendDraftOperationError)
    expect(JSON.stringify(application)).toBe(before)
    workflow.steps = []
    const detachedBefore = JSON.stringify(branch)
    expect(() =>
      addBackendWorkflowStep(application, workflow, 'respond', createId, branch.consequent)
    ).toThrow(BackendDraftOperationError)
    expect(foreign).toEqual([])
    expect(other.steps.length).toBe(BACKEND_LIMITS.maxWorkflowSteps - 5)
    expect(JSON.stringify(branch)).toBe(detachedBefore)
  })
})

describe('server environment reference authoring', () => {
  test('starts from an empty declaration and stores only fixed server reference metadata', () => {
    const { application } = fixture()
    addBackendWorkflowEnvironmentReference(application, 'API_ORIGIN')
    expect(backendWorkflowEnvironmentReferences(application)).toEqual([
      { kind: 'environment', name: 'API_ORIGIN', exposure: 'server', required: true }
    ])
    expect(parseBackendApplicationSpecV1(prepareBackendApplicationDraft(application)).ok).toBe(true)
    removeBackendWorkflowEnvironmentReference(application, 'API_ORIGIN')
    expect(application.secrets).toEqual([])
  })

  test('renames every nested structured use and refuses deletion until all uses are removed', () => {
    const { application, workflow, entity, createId } = fixture()
    addBackendWorkflowEnvironmentReference(application, 'API_ORIGIN')
    const source = () => ({ kind: 'environment' as const, name: 'API_ORIGIN' })
    const branch = addBackendWorkflowStep(application, workflow, 'branch', createId)
    if (branch.kind !== 'branch') throw new Error('Expected branch')
    const http = addBackendWorkflowStep(
      application,
      workflow,
      'http.request',
      createId,
      branch.consequent
    )
    const mutate = addBackendWorkflowStep(
      application,
      workflow,
      'data.mutate',
      createId,
      branch.alternate
    )
    const read = addBackendWorkflowStep(
      application,
      workflow,
      'data.read',
      createId,
      branch.consequent
    )
    if (http.kind !== 'http.request' || mutate.kind !== 'data.mutate' || read.kind !== 'data.read')
      throw new Error('Expected editable steps')
    http.url = source()
    http.body = source()
    http.headers = [{ name: 'X-Region', value: source() }]
    mutate.values = [{ field: entity.fields[0].id, value: source() }]
    mutate.filters = [{ field: entity.fields[0].id, operator: 'eq', value: source() }]
    read.filters = [{ field: entity.fields[0].id, operator: 'eq', value: source() }]
    renameBackendWorkflowEnvironmentReference(application, 'API_ORIGIN', 'SERVICE_ORIGIN')
    expect(JSON.stringify(application)).not.toContain('API_ORIGIN')
    for (const value of [
      http.url,
      http.body,
      http.headers[0].value,
      mutate.values[0].value,
      mutate.filters[0].value,
      read.filters[0].value
    ]) {
      expect(value).toEqual({ kind: 'environment', name: 'SERVICE_ORIGIN' })
    }
    const before = JSON.stringify(application)
    expect(() => removeBackendWorkflowEnvironmentReference(application, 'SERVICE_ORIGIN')).toThrow(
      BackendDraftOperationError
    )
    expect(JSON.stringify(application)).toBe(before)
    workflow.steps = []
    removeBackendWorkflowEnvironmentReference(application, 'SERVICE_ORIGIN')
    expect(application.secrets).toEqual([])
  })

  test('rejects invalid, secret-bearing, colliding and over-capacity names before any mutation', () => {
    const { application } = fixture()
    addBackendWorkflowEnvironmentReference(application, 'API_ORIGIN')
    addBackendWorkflowEnvironmentReference(application, 'OTHER_ORIGIN')
    for (const name of [
      '',
      'api_origin',
      'API=not-a-name',
      'API ORIGIN',
      'A'.repeat(129),
      'sk_live_backend_canary'
    ]) {
      const before = JSON.stringify(application)
      expect(() => addBackendWorkflowEnvironmentReference(application, name)).toThrow(
        BackendDraftOperationError
      )
      expect(() =>
        renameBackendWorkflowEnvironmentReference(application, 'API_ORIGIN', name)
      ).toThrow(BackendDraftOperationError)
      expect(JSON.stringify(application)).toBe(before)
    }
    expect(() => addBackendWorkflowEnvironmentReference(application, 'API_ORIGIN')).toThrow(
      BackendDraftOperationError
    )
    expect(() =>
      renameBackendWorkflowEnvironmentReference(application, 'API_ORIGIN', 'OTHER_ORIGIN')
    ).toThrow(BackendDraftOperationError)
    application.secrets.push({
      kind: 'environment',
      name: 'PUBLIC_NAME',
      exposure: 'client-public',
      required: true
    })
    expect(() =>
      renameBackendWorkflowEnvironmentReference(application, 'PUBLIC_NAME', 'PRIVATE_NAME')
    ).toThrow(BackendDraftOperationError)
    expect(() => removeBackendWorkflowEnvironmentReference(application, 'PUBLIC_NAME')).toThrow(
      BackendDraftOperationError
    )
    application.secrets = Array.from({ length: BACKEND_LIMITS.maxSecretRefs }, (_, index) => ({
      kind: 'environment',
      name: `REFERENCE_${index}`,
      exposure: 'server',
      required: true
    }))
    expect(() => addBackendWorkflowEnvironmentReference(application, 'NEW_REFERENCE')).toThrow(
      BackendDraftOperationError
    )
    expect(application.secrets).toHaveLength(BACKEND_LIMITS.maxSecretRefs)
  })
})
