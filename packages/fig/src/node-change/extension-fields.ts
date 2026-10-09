import { figmaSchema } from '@open-pencil/kiwi/fig'

const BUNDLED_NODE_CHANGE_FIELDS: ReadonlySet<string> = new Set(
  figmaSchema.definitions
    .filter((definition) => definition.name === 'NodeChange')
    .flatMap((definition) => definition.fields.map((field) => field.name))
)

/** Fields decoded from a newer embedded schema have no first-party editor mapping. */
export function isFigmaNodeExtensionField(field: string): boolean {
  return !BUNDLED_NODE_CHANGE_FIELDS.has(field)
}

export function figmaNodeExtensionEntries(record: object): Array<[string, unknown]> {
  return Object.entries(record).filter(
    ([field, value]) => value !== undefined && isFigmaNodeExtensionField(field)
  )
}
