import {
  backendModuleReferencedEntities,
  deriveBackendApplicationCapabilities
} from '@open-pencil/lowcode/backend'
import type {
  BackendApplicationSpecV1,
  BackendModuleDefinitionIR
} from '@open-pencil/lowcode/backend'

import { createBusinessApplication } from '../model'
import { BUSINESS_TEMPLATE_IDS, type BusinessTemplateId } from '../model/types'
import {
  BUSINESS_ACCOUNTS_MODULE_ID,
  BUSINESS_ACCOUNT_ENTITY_ID,
  businessModuleSource,
  directoryBinding,
  selectedBusinessKinds
} from './catalog'
import { conflict, normalized } from './compare'
import {
  accountsModuleDefinition,
  addExistingModule,
  businessModuleDefinition,
  verifyBusinessModule
} from './modules'
import { appendBusinessRecords, verifyBusinessRecords } from './records'
import { BusinessCompositionError } from './types'
import type {
  BusinessCompositionOptions,
  BusinessCompositionPreview,
  BusinessCompositionResult
} from './types'

export { BusinessCompositionError } from './types'
export type {
  BusinessCompositionOptions,
  BusinessCompositionPreview,
  BusinessCompositionResult
} from './types'

/** A read-only suggestion. Callers must explicitly pass the result as adoptExisting. */
export function detectStandaloneBusinessKinds(
  base: BackendApplicationSpecV1
): BusinessTemplateId[] {
  const checked = normalized(base)
  if (checked.modules) return []
  const authentication = checked.httpApi?.browserClient?.authentication
  if (!authentication) return []
  const entityIds = new Set(checked.dataModel.entities.map((entity) => entity.id))
  return BUSINESS_TEMPLATE_IDS.filter((kind) => {
    // A cheap negative filter avoids normalizing every unrelated template for every
    // card. A matching ID set still needs the complete schema/authority check below.
    const candidate = createBusinessApplication(checked.applicationId, authentication, kind)
    if (candidate.dataModel.entities.some((entity) => !entityIds.has(entity.id))) return false
    try {
      verifyBusinessRecords(checked, businessModuleSource(checked, kind, 'users'))
      return true
    } catch (error) {
      if (error instanceof BusinessCompositionError) return false
      throw error
    }
  })
}

function completeDependencies(
  application: BackendApplicationSpecV1,
  modules: BackendModuleDefinitionIR[]
): void {
  const owners = new Map(
    modules.flatMap((module) => module.entityIds.map((id) => [id, module.id] as const))
  )
  for (const module of modules) {
    for (const entityId of backendModuleReferencedEntities(module, application)) {
      const owner = owners.get(entityId)
      if (owner && owner !== module.id && !module.dependsOn.includes(owner))
        module.dependsOn.push(owner)
    }
  }
}

function preserveCapabilities(application: BackendApplicationSpecV1): void {
  for (const capability of deriveBackendApplicationCapabilities(application)) {
    const existing = application.capabilities.find((entry) => entry.capability === capability)
    if (existing && !existing.required)
      conflict(
        '$.capabilities',
        'A required business capability conflicts with an existing optional capability.'
      )
    if (!existing) application.capabilities.push({ capability, required: true })
  }
}

function recognizeExisting(
  checked: BackendApplicationSpecV1,
  options: BusinessCompositionOptions,
  modules: BackendModuleDefinitionIR[],
  bindings: BusinessCompositionResult['bindings']
): { installed: BusinessTemplateId[]; adopted: BusinessTemplateId[] } {
  const installed = BUSINESS_TEMPLATE_IDS.filter((kind) =>
    modules.some((module) => module.id === kind)
  )
  for (const kind of installed) {
    const directory = directoryBinding(checked, kind)
    const source = businessModuleSource(checked, kind, directory)
    verifyBusinessRecords(checked, source)
    const module = modules.find((entry) => entry.id === kind)
    if (module) verifyBusinessModule(module, businessModuleDefinition(source, kind))
    bindings[kind] = { users: directory }
  }
  if (installed.length) {
    const accounts = modules.find((entry) => entry.id === BUSINESS_ACCOUNTS_MODULE_ID)
    if (!accounts) conflict('$.modules', 'The shared account module is missing.')
    verifyBusinessModule(accounts, accountsModuleDefinition(checked))
  }
  const adopted = selectedBusinessKinds(options.adoptExisting ?? []).filter(
    (kind) => !installed.includes(kind)
  )
  if (checked.modules && adopted.length)
    conflict(
      '$.modules',
      'Existing module ownership cannot be silently reassigned during adoption.'
    )
  for (const kind of adopted) {
    const source = businessModuleSource(checked, kind, 'users')
    verifyBusinessRecords(checked, source)
    modules.push(businessModuleDefinition(source, kind))
    bindings[kind] = { users: 'users' }
  }
  return { installed, adopted }
}

/** Pure additive preparation. It does not edit documents, migrate data, or grant identities. */
export function composeBusinessModules(
  base: BackendApplicationSpecV1,
  kinds: readonly BusinessTemplateId[],
  options: BusinessCompositionOptions = {}
): BusinessCompositionResult {
  const checked = normalized(base)
  const application = structuredClone(base)
  const selected = selectedBusinessKinds(kinds)
  const modules = application.modules?.modules ?? []
  const bindings: BusinessCompositionResult['bindings'] = {}
  const { installed, adopted } = recognizeExisting(checked, options, modules, bindings)
  const sharedAccountWasPresent = installed.length + adopted.length > 0
  const addedKinds = selected.filter((kind) => !installed.includes(kind) && !adopted.includes(kind))
  verifySharedAccountProjections(checked, sharedAccountWasPresent)
  let sharedAccount = sharedAccountWasPresent
  for (const kind of addedKinds) {
    const directory = kind + '-users'
    const source = businessModuleSource(checked, kind, directory)
    appendBusinessRecords(application, checked, source, sharedAccount)
    modules.push(businessModuleDefinition(source, kind))
    bindings[kind] = { users: directory }
    sharedAccount = true
  }
  if (!sharedAccount)
    conflict('$.modules', 'Select a business module to install or explicitly adopt.')
  const accounts = modules.find((entry) => entry.id === BUSINESS_ACCOUNTS_MODULE_ID)
  const expectedAccounts = accountsModuleDefinition(application)
  if (accounts) {
    for (const id of expectedAccounts.resourceIds)
      if (!accounts.resourceIds.includes(id)) accounts.resourceIds.push(id)
  } else modules.unshift(expectedAccounts)
  addExistingModule(application, modules)
  completeDependencies(application, modules)
  application.modules = { version: 1, modules }
  preserveCapabilities(application)
  normalized(application)
  const oldEntities = new Set(base.dataModel.entities.map((entry) => entry.id))
  return {
    application,
    installedKinds: selectedBusinessKinds([...installed, ...adopted, ...addedKinds]),
    addedKinds,
    adoptedKinds: adopted,
    addedEntities: application.dataModel.entities
      .filter((entry) => !oldEntities.has(entry.id))
      .map((entry) => entry.id),
    sharedAccountWasPresent: sharedAccountWasPresent && oldEntities.has(BUSINESS_ACCOUNT_ENTITY_ID),
    bindings,
    diagnostics: []
  }
}

export function previewComposeBusinessModules(
  base: BackendApplicationSpecV1,
  kinds: readonly BusinessTemplateId[],
  options: BusinessCompositionOptions = {}
): BusinessCompositionPreview {
  try {
    return { ok: true, ...composeBusinessModules(base, kinds, options) }
  } catch (error) {
    if (error instanceof BusinessCompositionError)
      return { ok: false, diagnostics: error.diagnostics }
    throw error
  }
}

function verifySharedAccountProjections(
  application: BackendApplicationSpecV1,
  shared: boolean
): void {
  if (!shared) return
  for (const resource of application.httpApi?.resources ?? [])
    if (resource.entityId === BUSINESS_ACCOUNT_ENTITY_ID && !resource.readPolicyIds?.length)
      conflict(
        '$.httpApi.resources.' + resource.id,
        'Existing account projections must explicitly select read policies before adding directory roles.'
      )
}
