import type {
  BackendApplicationSpecV1,
  BackendHttpAPIResourceIRV1
} from '@open-pencil/lowcode/backend'

import { BackendDraftOperationError } from '@/app/lowcode/backend/draft'

import type {
  BusinessActionDefinition,
  BusinessListing,
  BusinessPageDefinition,
  BusinessParameterSource,
  BusinessTemplateDefinition
} from '../types'

function requireMetadata(condition: unknown, message: string): asserts condition {
  if (!condition) throw new BackendDraftOperationError('Business template: ' + message)
}

function resource(application: BackendApplicationSpecV1, id: string): BackendHttpAPIResourceIRV1 {
  const found = application.httpApi?.resources.find((entry) => entry.id === id)
  requireMetadata(found, 'unknown resource ' + id)
  requireMetadata(found.operations.includes('list'), 'resource must support lists: ' + id)
  return found
}

function checkListing(
  application: BackendApplicationSpecV1,
  listing: BusinessListing
): BackendHttpAPIResourceIRV1 {
  const found = resource(application, listing.resourceId)
  requireMetadata(listing.columns.length > 0, 'a listing needs visible fields')
  for (const column of listing.columns)
    requireMetadata(
      found.readFields.includes(column.field),
      'unknown visible field ' + column.field
    )
  if (listing.search)
    requireMetadata(found.query?.searchFields.length, 'resource does not expose server search')
  if (listing.filter)
    requireMetadata(
      found.query?.filterFields.includes(listing.filter.field),
      'unknown status filter ' + listing.filter.field
    )
  return found
}

function checkSource(
  source: BusinessParameterSource,
  action: BusinessActionDefinition,
  selected?: BackendHttpAPIResourceIRV1
): void {
  if (source.kind === 'input')
    requireMetadata(
      action.inputs.some((input) => input.key === source.key),
      'unknown form input ' + source.key
    )
  if (source.kind === 'selection')
    requireMetadata(
      selected?.readFields.includes(source.field),
      'unknown selected field ' + source.field
    )
}

function checkAction(
  application: BackendApplicationSpecV1,
  action: BusinessActionDefinition,
  selected?: BackendHttpAPIResourceIRV1
): void {
  const command = application.commands?.commands.find((entry) => entry.id === action.commandId)
  requireMetadata(command, 'unknown command ' + action.commandId)
  requireMetadata(
    new Set(action.inputs.map((input) => input.key)).size === action.inputs.length,
    'duplicate form input'
  )
  const names = command.parameters.map((parameter) => parameter.name)
  requireMetadata(
    names.length === Object.keys(action.parameters).length &&
      names.every((name) => name in action.parameters),
    'command parameters must match exactly: ' + command.id
  )
  for (const source of Object.values(action.parameters)) checkSource(source, action, selected)
  if (action.when) {
    requireMetadata(selected?.readFields.includes(action.when.field), 'unknown transition field')
    requireMetadata(action.when.values.length > 0, 'empty transition condition')
  }
  for (const input of action.inputs) {
    if (input.fromSelection)
      requireMetadata(
        selected?.readFields.includes(input.fromSelection),
        'unknown form initial field'
      )
    if (input.kind === 'select')
      requireMetadata(
        input.choices?.length &&
          new Set(input.choices.map((choice) => choice.value)).size === input.choices.length,
        'invalid choice input'
      )
    if (input.kind !== 'relation') continue
    requireMetadata(input.relation, 'missing relation source')
    const related = resource(application, input.relation.resourceId)
    requireMetadata(
      related.readFields.includes(input.relation.valueField ?? 'id') &&
        related.readFields.includes(input.relation.labelField),
      'unknown relation identity or label'
    )
    for (const column of input.relation.columns ?? [])
      requireMetadata(related.readFields.includes(column.field), 'unknown relation field')
    for (const [key, source] of Object.entries(input.relation.filters ?? {})) {
      requireMetadata(related.query?.filterFields.includes(key), 'unknown relation filter')
      checkSource(source, action, selected)
    }
  }
}

function checkPage(application: BackendApplicationSpecV1, page: BusinessPageDefinition): void {
  const selected = page.listing ? checkListing(application, page.listing) : undefined
  for (const column of page.details ?? [])
    requireMetadata(selected?.readFields.includes(column.field), 'unknown detail field')
  if (selected)
    requireMetadata(
      selected.operations.includes('read') && selected.readFields.includes('id'),
      'primary listing must expose record reads'
    )
  requireMetadata(
    new Set(page.actions.map((action) => action.id)).size === page.actions.length,
    'duplicate action identifier'
  )
  for (const action of page.actions) checkAction(application, action, selected)
  for (const related of page.related ?? []) {
    const found = checkListing(application, related)
    requireMetadata(
      selected && found.query?.filterFields.includes(related.foreignKey),
      'unknown related-record filter'
    )
  }
}

/** Every authored reference is checked before the first graph or Backend mutation. */
export function preflightBusinessPages(
  application: BackendApplicationSpecV1,
  definition: BusinessTemplateDefinition
): void {
  requireMetadata(definition.pages.length > 0, 'no pages')
  requireMetadata(
    new Set(definition.pages.map((page) => page.id)).size === definition.pages.length,
    'duplicate page identifier'
  )
  requireMetadata(
    new Set(definition.pages.map((page) => page.path)).size === definition.pages.length,
    'duplicate page route'
  )
  requireMetadata(
    definition.pages.some((page) => page.id === definition.entryPage),
    'unknown entry page'
  )
  requireMetadata(
    !definition.pages.some((page) => page.id === 'login'),
    'login is a reserved page identifier'
  )
  for (const page of definition.pages) checkPage(application, page)
}
