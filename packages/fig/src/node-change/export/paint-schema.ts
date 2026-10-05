import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import type { Schema } from '@open-pencil/kiwi/schema-runtime'

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Encode aliases in the paint dialect actually present in the archive's embedded schema. */
export function adaptPaintBindingsToSchema(changes: readonly NodeChange[], schema: Schema): void {
  const definitions = new Map(schema.definitions.map((definition) => [definition.name, definition]))
  const paint = definitions.get('Paint')
  if (!paint || paint.fields.some((field) => field.name === 'colorVar')) return
  if (!paint.fields.some((field) => field.name === 'colorVariableBinding')) return

  const visit = (value: unknown, type: string): void => {
    if (!record(value)) return
    const definition = definitions.get(type)
    if (!definition || definition.kind === 'ENUM') return
    if (type === 'Paint') {
      // Exported aliases are authoritative. In particular, an unbound paint must not revive
      // a preserved legacy alias after the modern field has been removed.
      const colorVar = value.colorVar
      const variableValue = record(colorVar) ? colorVar.value : undefined
      const alias = record(variableValue) ? variableValue.alias : undefined
      const guid = record(alias) ? alias.guid : undefined
      delete value.colorVar
      delete value.colorVariableBinding
      if (record(guid)) value.colorVariableBinding = { variableID: guid }
    }
    for (const field of definition.fields) {
      if (!field.type || field.isDeprecated) continue
      const child = value[field.name]
      if (field.isArray && Array.isArray(child)) {
        for (const item of child) visit(item, field.type)
      } else visit(child, field.type)
    }
  }
  for (const change of changes) visit(change, 'NodeChange')
}
