import { colorToHex } from '@open-pencil/core/color'
import type {
  SceneGraph,
  Variable,
  VariableCollection,
  VariableValue
} from '@open-pencil/core/scene-graph'
import type { Color } from '@open-pencil/core/types'

function slugify(name: string): string {
  const slug = name
    .replace(/\//g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
  return slug || 'token'
}

function isColor(value: VariableValue): value is Color {
  return typeof value === 'object' && value !== null && 'r' in value && 'g' in value && 'b' in value
}

function isAlias(value: VariableValue): value is { aliasId: string } {
  return typeof value === 'object' && value !== null && 'aliasId' in value
}

function resolveValue(
  value: VariableValue,
  variables: Map<string, Variable>,
  modeId: string,
  visited = new Set<string>()
): VariableValue {
  if (!isAlias(value)) return value
  if (visited.has(value.aliasId)) return value
  visited.add(value.aliasId)
  const target = variables.get(value.aliasId)
  if (!target) return value
  const targetValue =
    target.valuesByMode[modeId] ??
    target.valuesByMode[Object.keys(target.valuesByMode)[0] ?? ''] ??
    value
  return resolveValue(targetValue, variables, modeId, visited)
}

function formatCssValue(
  value: VariableValue,
  variables: Map<string, Variable>,
  modeId: string
): string | null {
  const resolved = resolveValue(value, variables, modeId)
  if (isColor(resolved)) return colorToHex(resolved)
  if (typeof resolved === 'number') return String(resolved)
  if (typeof resolved === 'string') return resolved
  if (typeof resolved === 'boolean') return resolved ? '1' : '0'
  return null
}

function modeSelector(modeName: string): string {
  const slug = slugify(modeName)
  if (slug === 'dark') return ':root[data-theme="dark"], .dark'
  return `:root[data-theme="${slug}"], .theme-${slug}`
}

function sortedVariables(
  collection: VariableCollection,
  variables: Map<string, Variable>
): Variable[] | [] {
  return collection.variableIds
    .map((id) => variables.get(id))
    .filter((variable): variable is Variable => !!variable)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}

export function buildDesignTokenThemeCss(graph: SceneGraph): string {
  const collections = [...graph.variableCollections.values()]
    .filter((collection) => collection.variableIds.length > 0)
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  if (collections.length === 0) return ''

  const blocks: string[] = []
  const variables = graph.variables
  const rootLines: string[] = []
  const modeLines = new Map<string, { name: string; lines: string[] }>()

  for (const collection of collections) {
    const vars = sortedVariables(collection, variables)
    if (vars.length === 0) continue
    const defaultModeId = collection.defaultModeId || collection.modes[0]?.modeId
    if (!defaultModeId) continue
    const collectionSlug = slugify(collection.name)

    for (const variable of vars) {
      const cssVar = `--op-${collectionSlug}-${slugify(variable.name)}`
      const defaultValue = variable.valuesByMode[defaultModeId]
      if (defaultValue !== undefined) {
        const formatted = formatCssValue(defaultValue, variables, defaultModeId)
        if (formatted !== null) rootLines.push(`  ${cssVar}: ${formatted};`)
      }

      for (const mode of collection.modes) {
        if (mode.modeId === defaultModeId) continue
        const value = variable.valuesByMode[mode.modeId]
        if (value === undefined) continue
        const formatted = formatCssValue(value, variables, mode.modeId)
        if (formatted === null) continue
        const entry = modeLines.get(mode.modeId) ?? { name: mode.name, lines: [] }
        entry.lines.push(`  ${cssVar}: ${formatted};`)
        modeLines.set(mode.modeId, entry)
      }
    }
  }

  if (rootLines.length > 0) {
    blocks.push('/* OpenPencil design tokens */')
    blocks.push(':root {')
    blocks.push(...rootLines)
    blocks.push('}')
  }

  for (const [, entry] of [...modeLines.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (entry.lines.length === 0) continue
    blocks.push('')
    blocks.push(`${modeSelector(entry.name)} {`)
    blocks.push(...entry.lines)
    blocks.push('}')
  }

  return blocks.length > 0 ? `${blocks.join('\n')}\n` : ''
}
