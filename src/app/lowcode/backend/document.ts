import {
  NESTJS_BACKEND_PROVIDER_BUNDLE,
  NESTJS_PRISMA_CRM_BACKEND_PROVIDER_BUNDLE
} from '@open-pencil/compiler/backend'
import {
  deriveBackendApplicationCapabilities,
  parseBackendApplicationSpecV1,
  validateBackendCapabilityDeclarations,
  type BackendApplicationSpecV1,
  type BackendCapabilityRequirement,
  type BackendDiagnostic,
  type DataModelIR
} from '@open-pencil/lowcode/backend'
import type { PluginDataEntry, SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import {
  APP_BACKEND_PROVIDER_DOCUMENT_KEY,
  APP_BACKEND_PROVIDER_DOCUMENT_PLUGIN_ID,
  APP_BACKEND_PROVIDER_REQUEST_FORMAT,
  AppBackendProviderBuildError,
  appBackendProviderDocumentValue,
  parseAppBackendProviderBuildRequest,
  readAppBackendProviderDocumentRequest,
  type AppBackendProviderBuildRequest,
  type AppBackendProviderDescriptor
} from '@/app/plugins/host/backend-provider'

export const EMPTY_BACKEND_DATA_MODEL: DataModelIR = {
  version: 1,
  entities: [],
  enums: [],
  relations: []
}

export interface BackendDocumentEditor {
  readonly graph: SceneGraph
  updateNodeWithUndo(id: string, changes: Partial<SceneNode>, label?: string): void
}

export interface BackendDraftValidation {
  readonly ok: boolean
  readonly application?: BackendApplicationSpecV1
  readonly diagnostics: readonly BackendDiagnostic[]
}

export class BackendDocumentValidationError extends Error {
  constructor(readonly diagnostics: readonly BackendDiagnostic[]) {
    super(
      diagnostics.length > 0
        ? `Backend draft is invalid: ${diagnostics.map((entry) => entry.code).join(', ')}`
        : 'Backend draft is invalid.'
    )
    this.name = 'BackendDocumentValidationError'
  }
}

function clonePluginData(entries: readonly PluginDataEntry[]): PluginDataEntry[] {
  return entries.map((entry) => ({ ...entry }))
}

function isBackendDocumentEntry(entry: Readonly<PluginDataEntry>): boolean {
  return (
    entry.pluginId === APP_BACKEND_PROVIDER_DOCUMENT_PLUGIN_ID &&
    entry.key === APP_BACKEND_PROVIDER_DOCUMENT_KEY
  )
}

function normalizedCapabilities(
  application: BackendApplicationSpecV1
): BackendCapabilityRequirement[] {
  const derived = new Set(deriveBackendApplicationCapabilities(application))
  const declarations = new Map(
    application.capabilities.map((requirement) => [requirement.capability, { ...requirement }])
  )
  for (const capability of derived) {
    const current = declarations.get(capability)
    declarations.set(capability, {
      capability,
      required: true,
      ...(current?.reason ? { reason: current.reason } : {})
    })
  }
  return [...declarations.values()].sort((left, right) =>
    left.capability.localeCompare(right.capability, 'en')
  )
}

export function createEmptyBackendApplication(applicationId: string): BackendApplicationSpecV1 {
  return {
    format: 'openpencil.backend-application',
    version: 1,
    applicationId,
    dataModel: { version: 1, entities: [], enums: [], relations: [] },
    auth: {
      version: 1,
      identities: [],
      roles: [],
      ownership: [],
      tenants: [],
      rowAccess: []
    },
    workflows: { version: 1, workflows: [] },
    capabilities: [],
    secrets: []
  }
}

export function prepareBackendApplicationDraft(
  application: BackendApplicationSpecV1
): BackendApplicationSpecV1 {
  const detached = structuredClone(application)
  detached.capabilities = normalizedCapabilities(detached)
  return detached
}

export function validateBackendApplicationDraft(
  application: BackendApplicationSpecV1,
  descriptor?: AppBackendProviderDescriptor | null
): BackendDraftValidation {
  const parsed = parseBackendApplicationSpecV1(prepareBackendApplicationDraft(application))
  if (!parsed.ok) return { ok: false, diagnostics: parsed.diagnostics }

  const diagnostics = [...validateBackendCapabilityDeclarations(parsed.value)]
  if (descriptor) {
    const providerCapabilities = new Set<string>(descriptor.capabilities)
    for (const requirement of parsed.value.capabilities) {
      if (!requirement.required || providerCapabilities.has(requirement.capability)) continue
      diagnostics.push({
        code: 'backend-provider-capability-unsupported',
        severity: 'error',
        path: `$.capabilities.${requirement.capability}`,
        message: `The selected Backend Provider does not support ${requirement.capability}.`
      })
    }
  }

  const providerBundle = [
    NESTJS_BACKEND_PROVIDER_BUNDLE,
    NESTJS_PRISMA_CRM_BACKEND_PROVIDER_BUNDLE
  ].find((bundle) => bundle.descriptor.providerId === descriptor?.providerId)
  if (descriptor && providerBundle) {
    diagnostics.push(
      ...providerBundle.validate({
        application: parsed.value,
        selection: {
          descriptor: { ...descriptor, outputs: descriptor.outputKinds },
          packageDigest: descriptor.packageAuthority.packageDigest,
          enabled: true
        },
        target: 'react',
        mode: 'production',
        capabilities: []
      })
    )
  }

  return diagnostics.some((entry) => entry.severity === 'error')
    ? { ok: false, diagnostics }
    : { ok: true, application: parsed.value, diagnostics }
}

export function createBackendProviderDocumentRequest(
  descriptor: AppBackendProviderDescriptor,
  application: BackendApplicationSpecV1
): AppBackendProviderBuildRequest {
  const validation = validateBackendApplicationDraft(application, descriptor)
  if (!validation.ok || !validation.application) {
    throw new BackendDocumentValidationError(validation.diagnostics)
  }
  return parseAppBackendProviderBuildRequest({
    format: APP_BACKEND_PROVIDER_REQUEST_FORMAT,
    selection: descriptor,
    application: validation.application
  })
}

export function readBackendProviderDocumentRequest(
  graph: SceneGraph
): AppBackendProviderBuildRequest | null {
  const request = readAppBackendProviderDocumentRequest(graph)
  return request ? structuredClone(request) : null
}

export function upsertBackendProviderPluginData(
  pluginData: readonly PluginDataEntry[],
  request: AppBackendProviderBuildRequest
): PluginDataEntry[] {
  // Validate and serialize before constructing the replacement. A malformed or secret-bearing
  // request therefore cannot partially mutate the document array.
  const value = appBackendProviderDocumentValue(request)
  const replacement: PluginDataEntry = {
    pluginId: APP_BACKEND_PROVIDER_DOCUMENT_PLUGIN_ID,
    key: APP_BACKEND_PROVIDER_DOCUMENT_KEY,
    value
  }
  const next: PluginDataEntry[] = []
  let inserted = false
  for (const entry of pluginData) {
    if (!isBackendDocumentEntry(entry)) {
      next.push({ ...entry })
      continue
    }
    if (!inserted) {
      next.push(replacement)
      inserted = true
    }
  }
  if (!inserted) next.push(replacement)
  return next
}

export function removeBackendProviderPluginData(
  pluginData: readonly PluginDataEntry[]
): PluginDataEntry[] {
  return clonePluginData(pluginData.filter((entry) => !isBackendDocumentEntry(entry)))
}

function pluginDataEqual(
  left: readonly PluginDataEntry[],
  right: readonly PluginDataEntry[]
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (entry, index) =>
        entry.pluginId === right[index]?.pluginId &&
        entry.key === right[index]?.key &&
        entry.value === right[index]?.value
    )
  )
}

export function commitBackendProviderDocumentRequest(
  editor: BackendDocumentEditor,
  descriptor: AppBackendProviderDescriptor,
  application: BackendApplicationSpecV1,
  label = 'Update Backend model'
): AppBackendProviderBuildRequest {
  const request = createBackendProviderDocumentRequest(descriptor, application)
  const root = editor.graph.getNode(editor.graph.rootId)
  if (!root) {
    throw new AppBackendProviderBuildError('request-invalid', 'Backend document root is missing.')
  }
  const next = upsertBackendProviderPluginData(root.pluginData, request)
  if (!pluginDataEqual(root.pluginData, next)) {
    editor.updateNodeWithUndo(editor.graph.rootId, { pluginData: next }, label)
  }
  return request
}

export function clearBackendProviderDocumentRequest(
  editor: BackendDocumentEditor,
  label = 'Clear Backend model'
): boolean {
  const root = editor.graph.getNode(editor.graph.rootId)
  if (!root) return false
  const next = removeBackendProviderPluginData(root.pluginData)
  if (pluginDataEqual(root.pluginData, next)) return false
  editor.updateNodeWithUndo(editor.graph.rootId, { pluginData: next }, label)
  return true
}
