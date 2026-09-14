import type { BusinessTemplateDefinition } from '../types'

/** Only the newly generated module uses remapped projections; existing document bindings stay intact. */
export function bindBusinessDefinitionResources(
  definition: BusinessTemplateDefinition,
  bindings: Readonly<Record<string, string>> = {}
): BusinessTemplateDefinition {
  const resource = (id: string) => bindings[id] ?? id
  return {
    ...definition,
    pages: definition.pages.map((page) => ({
      ...page,
      ...(page.listing
        ? { listing: { ...page.listing, resourceId: resource(page.listing.resourceId) } }
        : {}),
      ...(page.related
        ? {
            related: page.related.map((related) => ({
              ...related,
              resourceId: resource(related.resourceId)
            }))
          }
        : {}),
      actions: page.actions.map((action) => ({
        ...action,
        inputs: action.inputs.map((input) => ({
          ...input,
          ...(input.relation
            ? { relation: { ...input.relation, resourceId: resource(input.relation.resourceId) } }
            : {})
        }))
      }))
    }))
  }
}
