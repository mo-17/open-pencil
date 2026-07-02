import { colorToHex } from '@open-pencil/core/color'
import type {
  SceneGraph,
  Variable,
  VariableCollection,
  VariableValue
} from '@open-pencil/core/scene-graph'
import type { Color } from '@open-pencil/core/types'

type ThemeModeLines = Map<string, { name: string; lines: string[] }>

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

function hasVariableObjectKey(value: VariableValue, key: string): boolean {
  return typeof value === 'object' && Object.hasOwn(value, key)
}

function isCssColorValue(value: VariableValue): value is Color {
  return (
    hasVariableObjectKey(value, 'r') &&
    hasVariableObjectKey(value, 'g') &&
    hasVariableObjectKey(value, 'b')
  )
}

function isVariableAliasValue(value: VariableValue): value is { aliasId: string } {
  return hasVariableObjectKey(value, 'aliasId')
}

function resolveValue(
  value: VariableValue,
  graph: SceneGraph,
  modeId: string,
  modeName: string,
  visited = new Set<string>()
): VariableValue {
  let current = value
  while (isVariableAliasValue(current) && !visited.has(current.aliasId)) {
    visited.add(current.aliasId)
    const target = graph.variables.get(current.aliasId)
    if (!target) break
    const valuesByMode: Partial<Record<string, VariableValue>> = target.valuesByMode
    const targetModeId = aliasTargetModeId(graph, target, modeId, modeName)
    current =
      valuesByMode[targetModeId] ??
      valuesByMode[Object.keys(target.valuesByMode)[0] ?? ''] ??
      current
  }
  return current
}

function aliasTargetModeId(
  graph: SceneGraph,
  target: Variable,
  sourceModeId: string,
  sourceModeName: string
): string {
  const targetCollection = graph.variableCollections.get(target.collectionId)
  const sameId = targetCollection?.modes.find((mode) => mode.modeId === sourceModeId)
  if (sameId) return sameId.modeId
  const sameName = targetCollection?.modes.find((mode) => mode.name === sourceModeName)
  if (sameName) return sameName.modeId
  return targetCollection?.defaultModeId || targetCollection?.modes[0]?.modeId || sourceModeId
}

function formatCssValue(
  value: VariableValue,
  graph: SceneGraph,
  modeId: string,
  modeName: string
): string | null {
  const resolved = resolveValue(value, graph, modeId, modeName)
  if (isCssColorValue(resolved)) return colorToHex(resolved)
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

function normalizedVariableName(variable: Variable): string {
  return variable.name.toLowerCase().replace(/\s+/g, '/')
}

function findRuntimeColorToken(variables: readonly Variable[], graph: SceneGraph): string | null {
  const colorVariables = variables.filter((variable) =>
    Object.values(variable.valuesByMode).some((value) =>
      isCssColorValue(resolveValue(value, graph, '', ''))
    )
  )
  if (colorVariables.length === 0) return null
  const preferred =
    colorVariables.find((variable) => normalizedVariableName(variable).includes('color/primary')) ??
    colorVariables.find((variable) => normalizedVariableName(variable).includes('primary')) ??
    colorVariables.find((variable) => normalizedVariableName(variable).includes('accent')) ??
    colorVariables[0]
  return designTokenCssVariableName(graph, preferred.id)
}

function findRuntimeRadiusToken(variables: readonly Variable[], graph: SceneGraph): string | null {
  const preferred = variables.find((variable) => {
    const name = normalizedVariableName(variable)
    return name.includes('radius') || name.includes('corner')
  })
  return preferred ? designTokenCssVariableName(graph, preferred.id) : null
}

function lowcodeRuntimeThemeAliases(variables: readonly Variable[], graph: SceneGraph): string[] {
  const lines: string[] = []
  const accent = findRuntimeColorToken(variables, graph)
  if (accent) {
    lines.push(`  --op-lowcode-theme-accent: var(${accent});`)
    lines.push(`  --op-lowcode-theme-surface: color-mix(in srgb, var(${accent}) 8%, Canvas);`)
    lines.push('  --op-lowcode-theme-on-accent: Canvas;')
  }
  const radius = findRuntimeRadiusToken(variables, graph)
  if (radius) lines.push(`  --op-lowcode-theme-radius: calc(var(${radius}) * 1px);`)
  return lines
}

export function designTokenCssVariableName(graph: SceneGraph, variableId: string): string | null {
  const variable = graph.variables.get(variableId)
  if (!variable) return null
  const collection = graph.variableCollections.get(variable.collectionId)
  if (!collection) return null
  return `--op-${slugify(collection.name)}-${slugify(variable.name)}`
}

function defaultModeName(collection: VariableCollection, defaultModeId: string): string {
  return collection.modes.find((mode) => mode.modeId === defaultModeId)?.name ?? defaultModeId
}

function appendModeLine(
  modeLines: ThemeModeLines,
  modeId: string,
  modeName: string,
  line: string
): void {
  const entry = modeLines.get(modeId) ?? { name: modeName, lines: [] }
  entry.lines.push(line)
  modeLines.set(modeId, entry)
}

function appendVariableThemeLines(
  graph: SceneGraph,
  collection: VariableCollection,
  variable: Variable,
  defaultModeId: string,
  rootLines: string[],
  modeLines: ThemeModeLines
): void {
  const cssVar = designTokenCssVariableName(graph, variable.id)
  if (!cssVar) return
  const valuesByMode: Partial<Record<string, VariableValue>> = variable.valuesByMode
  const defaultValue = valuesByMode[defaultModeId]
  if (defaultValue !== undefined) {
    const formatted = formatCssValue(
      defaultValue,
      graph,
      defaultModeId,
      defaultModeName(collection, defaultModeId)
    )
    if (formatted !== null) rootLines.push(`  ${cssVar}: ${formatted};`)
  }

  for (const mode of collection.modes) {
    if (mode.modeId === defaultModeId) continue
    const value = valuesByMode[mode.modeId]
    if (value === undefined) continue
    const formatted = formatCssValue(value, graph, mode.modeId, mode.name)
    if (formatted !== null) {
      appendModeLine(modeLines, mode.modeId, mode.name, `  ${cssVar}: ${formatted};`)
    }
  }
}

function appendCollectionThemeLines(
  graph: SceneGraph,
  collection: VariableCollection,
  vars: readonly Variable[],
  rootLines: string[],
  modeLines: ThemeModeLines
): void {
  const defaultModeId = collection.defaultModeId || collection.modes[0]?.modeId
  if (!defaultModeId) return
  for (const variable of vars) {
    appendVariableThemeLines(graph, collection, variable, defaultModeId, rootLines, modeLines)
  }
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
  const runtimeAliasVariables: Variable[] = []

  for (const collection of collections) {
    const vars = sortedVariables(collection, variables)
    if (vars.length === 0) continue
    runtimeAliasVariables.push(...vars)
    appendCollectionThemeLines(graph, collection, vars, rootLines, modeLines)
  }

  if (rootLines.length > 0) {
    blocks.push('/* OpenPencil design tokens */')
    blocks.push(':root {')
    blocks.push(...rootLines)
    blocks.push(...lowcodeRuntimeThemeAliases(runtimeAliasVariables, graph))
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
