import {
  BACKEND_LIMITS,
  parseBackendApplicationSpecV1,
  type BackendApplicationSpecV1,
  type BackendSecretRef,
  type BackendValueSource,
  type BackendWorkflowStepIR
} from '@open-pencil/lowcode/backend'

import { createEmptyBackendApplication } from './document'
import { BackendDraftOperationError } from './draft'

type EnvironmentReference = Extract<BackendSecretRef, { kind: 'environment' }>

export function backendWorkflowEnvironmentReferences(
  application: BackendApplicationSpecV1
): EnvironmentReference[] {
  return application.secrets.filter(
    (entry): entry is EnvironmentReference =>
      entry.kind === 'environment' && entry.exposure === 'server' && entry.required
  )
}

function referenceByName(
  application: BackendApplicationSpecV1,
  name: string
): EnvironmentReference {
  const reference = backendWorkflowEnvironmentReferences(application).find(
    (entry) => entry.name === name
  )
  if (!reference)
    throw new BackendDraftOperationError('Select an existing server environment reference.')
  return reference
}

function newReference(application: BackendApplicationSpecV1, name: string): EnvironmentReference {
  const reference: EnvironmentReference = {
    kind: 'environment',
    name,
    exposure: 'server',
    required: true
  }
  // Use the Core boundary even while unrelated portions of the visual draft are incomplete.
  const candidate = createEmptyBackendApplication('environment-reference-validation')
  candidate.secrets = [reference]
  if (!parseBackendApplicationSpecV1(candidate).ok) {
    throw new BackendDraftOperationError('Enter a valid environment variable name, not a value.')
  }
  if (application.secrets.some((entry) => entry.name === name)) {
    throw new BackendDraftOperationError('This environment reference name is already declared.')
  }
  return reference
}

function stepSources(step: BackendWorkflowStepIR): BackendValueSource[] {
  if (step.kind === 'data.read') return (step.filters ?? []).map((entry) => entry.value)
  if (step.kind === 'data.mutate') {
    return [...(step.values ?? []), ...(step.filters ?? [])].map((entry) => entry.value)
  }
  if (step.kind === 'http.request') {
    return [
      step.url,
      ...(step.headers ?? []).map((entry) => entry.value),
      ...(step.body ? [step.body] : [])
    ]
  }
  if (step.kind === 'branch') return [...step.consequent, ...step.alternate].flatMap(stepSources)
  return []
}

function namedSources(application: BackendApplicationSpecV1, name: string) {
  return application.workflows.workflows
    .flatMap((workflow) => workflow.steps.flatMap(stepSources))
    .filter(
      (source): source is Extract<BackendValueSource, { kind: 'environment' }> =>
        source.kind === 'environment' && source.name === name
    )
}

export function addBackendWorkflowEnvironmentReference(
  application: BackendApplicationSpecV1,
  name: string
): void {
  if (application.secrets.length >= BACKEND_LIMITS.maxSecretRefs) {
    throw new BackendDraftOperationError(
      `Environment references are limited to ${BACKEND_LIMITS.maxSecretRefs} items.`
    )
  }
  const reference = newReference(application, name)
  application.secrets.push(reference)
}

export function renameBackendWorkflowEnvironmentReference(
  application: BackendApplicationSpecV1,
  previousName: string,
  name: string
): void {
  const reference = referenceByName(application, previousName)
  if (previousName === name) return
  newReference(application, name)
  const sources = namedSources(application, previousName)
  reference.name = name
  for (const source of sources) source.name = name
}

export function removeBackendWorkflowEnvironmentReference(
  application: BackendApplicationSpecV1,
  name: string
): void {
  const reference = referenceByName(application, name)
  if (namedSources(application, name).length > 0) {
    throw new BackendDraftOperationError(
      'Remove or replace workflow uses before deleting this environment reference.'
    )
  }
  application.secrets.splice(application.secrets.indexOf(reference), 1)
}
