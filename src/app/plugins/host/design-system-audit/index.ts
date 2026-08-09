import type { SceneNode } from '@open-pencil/scene-graph'

import type { EditorStore } from '@/app/editor/active-store'

import { DESIGN_SYSTEM_AUDIT_PLUGIN_ID } from '../ids'
import {
  addDesignSystemAuditIssue as addIssue,
  boundedAuditText as boundedText,
  createDesignSystemAuditState as initialState,
  designSystemAuditCheckpoint as checkpoint,
  designSystemAuditJsonBytes,
  DESIGN_SYSTEM_AUDIT_COMMAND_ID,
  DESIGN_SYSTEM_AUDIT_LIMITS,
  markDesignSystemAuditBudgetExhausted as markBudgetExhausted,
  normalizedAuditKey as normalizedKey,
  throwIfDesignSystemAuditAborted as throwIfAborted,
  type DesignSystemAuditState as AuditState,
  type RunDesignSystemAuditOptions,
  type StaticDesignSystemAuditResult
} from './support'
import {
  inspectDesignSystemCollections as inspectCollections,
  inspectDesignSystemVariables as inspectVariables
} from './tokens'

export { DESIGN_SYSTEM_AUDIT_PLUGIN_ID } from '../ids'
export { DESIGN_SYSTEM_AUDIT_COMMAND_ID, DESIGN_SYSTEM_AUDIT_LIMITS } from './support'
export type {
  DesignSystemAuditCategory,
  DesignSystemAuditIssue,
  DesignSystemAuditSeverity,
  DesignSystemAuditSummary,
  RunDesignSystemAuditOptions,
  StaticDesignSystemAuditResult
} from './support'

interface SpacingObservation {
  value: number
  nodeId: string
  nodeName: string
}

interface TextStyleObservation {
  signature: string
  nodeId: string
  nodeName: string
}

const MAX_NODE_BINDINGS = 512
const MAX_COMPONENT_PROPERTIES_PER_SET = 128
const MAX_COMPONENT_CHILDREN_PER_SET = 2_000
const MAX_VARIANT_OPTIONS = 128
const SPACING_BASE = 4
const SPACING_PROPERTIES = [
  'itemSpacing',
  'counterAxisSpacing',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'gridColumnGap',
  'gridRowGap'
] as const satisfies readonly (keyof SceneNode)[]

function recordSpacing(
  node: SceneNode,
  observations: Map<string, SpacingObservation>,
  state: AuditState
): void {
  for (const property of SPACING_PROPERTIES) {
    const value = node[property]
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) continue
    const key = Object.is(value, -0) ? '0' : String(value)
    if (observations.has(key)) continue
    if (observations.size >= DESIGN_SYSTEM_AUDIT_LIMITS.distinctSpacingValues) {
      markBudgetExhausted(state)
      return
    }
    observations.set(key, { value, nodeId: node.id, nodeName: node.name })
  }
}

function typographySignature(node: SceneNode, family: string): string {
  return [
    family,
    Number.isFinite(node.fontSize) ? node.fontSize : 'invalid',
    Number.isFinite(node.fontWeight) ? node.fontWeight : 'invalid',
    node.italic ? 'italic' : 'normal',
    node.lineHeight ?? 'auto',
    Number.isFinite(node.letterSpacing) ? node.letterSpacing : 'invalid'
  ].join('|')
}

function recordTypography(
  node: SceneNode,
  fontFamilies: Set<string>,
  fontSizes: Set<number>,
  textStyles: Map<string, TextStyleObservation>,
  state: AuditState
): void {
  const family = boundedText(node.fontFamily, 256).trim() || '(unspecified)'
  if (!fontFamilies.has(family)) {
    if (fontFamilies.size >= DESIGN_SYSTEM_AUDIT_LIMITS.distinctFontFamilies) {
      markBudgetExhausted(state)
    } else {
      fontFamilies.add(family)
    }
  }
  if (Number.isFinite(node.fontSize) && node.fontSize > 0 && !fontSizes.has(node.fontSize)) {
    if (fontSizes.size >= DESIGN_SYSTEM_AUDIT_LIMITS.distinctFontSizes) {
      markBudgetExhausted(state)
    } else {
      fontSizes.add(node.fontSize)
    }
  }
  if (!node.textStyleId) return
  const styleId = boundedText(node.textStyleId, 256)
  const signature = typographySignature(node, family)
  const previous = textStyles.get(styleId)
  if (previous && previous.signature !== signature) {
    addIssue(state, {
      category: 'typography',
      code: 'text-style-divergence',
      severity: 'warning',
      message: `Text style ${styleId} resolves to multiple typography signatures (first seen on ${previous.nodeName}).`,
      nodeId: node.id,
      nodeName: node.name
    })
  } else if (!previous) {
    if (textStyles.size >= DESIGN_SYSTEM_AUDIT_LIMITS.textStyles) {
      markBudgetExhausted(state)
    } else {
      textStyles.set(styleId, {
        signature,
        nodeId: boundedText(node.id, 256),
        nodeName: boundedText(node.name, 256)
      })
    }
  }
}

function inspectBoundVariables(node: SceneNode, editor: EditorStore, state: AuditState): void {
  let inspected = 0
  for (const property in node.boundVariables) {
    if (!Object.hasOwn(node.boundVariables, property)) continue
    if (
      inspected >= MAX_NODE_BINDINGS ||
      state.totalBoundVariables >= DESIGN_SYSTEM_AUDIT_LIMITS.boundVariables
    ) {
      markBudgetExhausted(state)
      return
    }
    inspected += 1
    state.totalBoundVariables += 1
    const variableId = node.boundVariables[property]
    if (editor.graph.variables.has(variableId)) continue
    addIssue(state, {
      category: 'tokens',
      code: 'missing-bound-token',
      severity: 'warning',
      message: `Property ${boundedText(property, 256)} references missing token ${boundedText(variableId, 256)}.`,
      nodeId: node.id,
      nodeName: node.name
    })
  }
}

function variantDefinitions(
  node: SceneNode,
  state: AuditState
): { name: string; options: Set<string> }[] {
  const definitions: { name: string; options: Set<string> }[] = []
  const ids = new Set<string>()
  const names = new Set<string>()
  const count = Math.min(node.componentPropertyDefinitions.length, MAX_COMPONENT_PROPERTIES_PER_SET)
  if (node.componentPropertyDefinitions.length > count) markBudgetExhausted(state)
  for (let index = 0; index < count; index += 1) {
    if (state.totalComponentProperties >= DESIGN_SYSTEM_AUDIT_LIMITS.componentProperties) {
      markBudgetExhausted(state)
      break
    }
    state.totalComponentProperties += 1
    const definition = node.componentPropertyDefinitions[index]
    if (ids.has(definition.id)) {
      addIssue(state, {
        category: 'components',
        code: 'duplicate-component-property-id',
        severity: 'warning',
        message: `Component property id ${boundedText(definition.id, 256)} is duplicated.`,
        nodeId: node.id,
        nodeName: node.name
      })
    }
    ids.add(definition.id)
    const name = boundedText(definition.name, 256)
    const nameKey = normalizedKey(name)
    if (nameKey && names.has(nameKey)) {
      addIssue(state, {
        category: 'components',
        code: 'duplicate-component-property-name',
        severity: 'warning',
        message: `Component property name ${name} is duplicated.`,
        nodeId: node.id,
        nodeName: node.name
      })
    }
    if (nameKey) names.add(nameKey)
    if (definition.type !== 'VARIANT') continue
    const options = new Set<string>()
    const sourceOptions = definition.variantOptions ?? []
    const optionCount = Math.min(sourceOptions.length, MAX_VARIANT_OPTIONS)
    if (sourceOptions.length > optionCount) markBudgetExhausted(state)
    for (let optionIndex = 0; optionIndex < optionCount; optionIndex += 1) {
      options.add(boundedText(sourceOptions[optionIndex], 256))
    }
    if (options.size > 0 && !options.has(definition.defaultValue)) {
      addIssue(state, {
        category: 'components',
        code: 'invalid-variant-default',
        severity: 'warning',
        message: `Variant property ${name} has a default outside its declared options.`,
        nodeId: node.id,
        nodeName: node.name
      })
    }
    definitions.push({ name, options })
  }
  return definitions
}

async function inspectComponentSet(
  node: SceneNode,
  editor: EditorStore,
  state: AuditState,
  signal: AbortSignal | undefined
): Promise<void> {
  state.componentSetCount += 1
  const definitions = variantDefinitions(node, state)
  if (definitions.length === 0) {
    addIssue(state, {
      category: 'components',
      code: 'missing-variant-definition',
      severity: 'warning',
      message: 'Component set has no bounded VARIANT property definition.',
      nodeId: node.id,
      nodeName: node.name
    })
  }
  const childCount = Math.min(node.childIds.length, MAX_COMPONENT_CHILDREN_PER_SET)
  if (node.childIds.length > childCount) markBudgetExhausted(state)
  const combinations = new Set<string>()
  const observedValues = definitions.map(() => new Set<string>())
  let variantCount = 0
  for (let index = 0; index < childCount; index += 1) {
    if (state.totalComponentChildren >= DESIGN_SYSTEM_AUDIT_LIMITS.componentChildren) {
      markBudgetExhausted(state)
      break
    }
    state.totalComponentChildren += 1
    await checkpoint(state, signal)
    const child = editor.graph.getNode(node.childIds[index])
    if (child?.type !== 'COMPONENT') continue
    variantCount += 1
    const combination: string[] = []
    definitions.forEach((definition, definitionIndex) => {
      const value = child.componentPropertyValues[definition.name]
      if (typeof value !== 'string' || value.length === 0) {
        addIssue(state, {
          category: 'components',
          code: 'missing-variant-value',
          severity: 'warning',
          message: `Variant is missing property ${definition.name}.`,
          nodeId: child.id,
          nodeName: child.name
        })
        combination.push('(missing)')
        return
      }
      const boundedValue = boundedText(value, 256)
      combination.push(boundedValue)
      observedValues[definitionIndex].add(boundedValue)
      if (definition.options.size > 0 && !definition.options.has(boundedValue)) {
        addIssue(state, {
          category: 'components',
          code: 'unknown-variant-option',
          severity: 'warning',
          message: `Variant property ${definition.name} uses undeclared option ${boundedValue}.`,
          nodeId: child.id,
          nodeName: child.name
        })
      }
    })
    const combinationKey = combination.join('\0')
    if (definitions.length > 0 && combinations.has(combinationKey)) {
      addIssue(state, {
        category: 'components',
        code: 'duplicate-variant-combination',
        severity: 'warning',
        message: `Variant combination ${combination.join(' / ')} is duplicated.`,
        nodeId: child.id,
        nodeName: child.name
      })
    }
    combinations.add(combinationKey)
  }
  if (variantCount < 2) {
    addIssue(state, {
      category: 'components',
      code: 'insufficient-component-variants',
      severity: 'info',
      message: `Component set exposes ${variantCount} direct component variant(s); at least two are expected for a useful variant set.`,
      nodeId: node.id,
      nodeName: node.name
    })
  }
  definitions.forEach((definition, index) => {
    if (observedValues[index].size >= 2) return
    addIssue(state, {
      category: 'components',
      code: 'insufficient-variant-options',
      severity: 'info',
      message: `Variant property ${definition.name} has fewer than two observed values.`,
      nodeId: node.id,
      nodeName: node.name
    })
  })
}

async function inspectNodes(
  editor: EditorStore,
  state: AuditState,
  signal: AbortSignal | undefined
): Promise<{
  spacing: Map<string, SpacingObservation>
  fontFamilies: Set<string>
  fontSizes: Set<number>
  textStyles: Map<string, TextStyleObservation>
}> {
  const spacing = new Map<string, SpacingObservation>()
  const fontFamilies = new Set<string>()
  const fontSizes = new Set<number>()
  const textStyles = new Map<string, TextStyleObservation>()
  for (const node of editor.graph.getAllNodes()) {
    if (state.visitedNodeCount >= DESIGN_SYSTEM_AUDIT_LIMITS.nodes) {
      markBudgetExhausted(state)
      break
    }
    state.visitedNodeCount += 1
    await checkpoint(state, signal)
    inspectBoundVariables(node, editor, state)
    recordSpacing(node, spacing, state)
    if (node.type === 'TEXT') {
      recordTypography(node, fontFamilies, fontSizes, textStyles, state)
    } else if (node.type === 'COMPONENT_SET') {
      await inspectComponentSet(node, editor, state, signal)
    }
  }
  return { spacing, fontFamilies, fontSizes, textStyles }
}

function addAggregateIssues(
  state: AuditState,
  observations: Awaited<ReturnType<typeof inspectNodes>>
): void {
  for (const entry of [...observations.spacing.values()].sort(
    (left, right) => left.value - right.value
  )) {
    if (Math.abs(entry.value / SPACING_BASE - Math.round(entry.value / SPACING_BASE)) < 1e-9) {
      continue
    }
    addIssue(state, {
      category: 'spacing',
      code: 'off-base-spacing-value',
      severity: 'info',
      message: `Spacing value ${entry.value} does not align to the advisory ${SPACING_BASE}px base scale.`,
      nodeId: entry.nodeId,
      nodeName: entry.nodeName
    })
  }
  if (observations.spacing.size > 12) {
    addIssue(state, {
      category: 'spacing',
      code: 'broad-spacing-scale',
      severity: 'info',
      message: `The document uses ${observations.spacing.size} distinct positive spacing values; consider a smaller tokenized scale.`
    })
  }
  if (observations.fontFamilies.size > 4) {
    addIssue(state, {
      category: 'typography',
      code: 'broad-font-family-scale',
      severity: 'info',
      message: `The document uses ${observations.fontFamilies.size} font families; verify that each is intentional.`
    })
  }
  if (observations.fontSizes.size > 12) {
    addIssue(state, {
      category: 'typography',
      code: 'broad-font-size-scale',
      severity: 'info',
      message: `The document uses ${observations.fontSizes.size} font sizes; consider a smaller type scale.`
    })
  }
}

export async function runStaticDesignSystemAudit(
  editor: EditorStore,
  options: RunDesignSystemAuditOptions = {}
): Promise<StaticDesignSystemAuditResult> {
  throwIfAborted(options.signal)
  const state = initialState()
  await checkpoint(state, options.signal, true)
  const collections = await inspectCollections(editor, state, options.signal)
  await inspectVariables(editor, collections, state, options.signal)
  const observations = await inspectNodes(editor, state, options.signal)
  throwIfAborted(options.signal)
  addAggregateIssues(state, observations)
  throwIfAborted(options.signal)

  const notEvaluated = [
    'runtime theme switching and resolved token values after application state changes',
    'semantic token naming, ownership, governance, and subjective brand compliance',
    'visual correctness of component interaction states and nested instance overrides',
    'font licensing, installed-font availability, glyph coverage, and final rendering',
    'text style runs, responsive overrides, and generated target-specific typography',
    'this static report is not a complete design-system certification',
    ...(state.truncated ? ['content beyond the static audit resource limits'] : [])
  ]
  const result: StaticDesignSystemAuditResult = {
    kind: 'static-design-system-audit',
    scope: 'document',
    pluginId: DESIGN_SYSTEM_AUDIT_PLUGIN_ID,
    commandId: DESIGN_SYSTEM_AUDIT_COMMAND_ID,
    warningCount: state.warningCount,
    infoCount: state.infoCount,
    issueCount: state.issueCount,
    truncated: state.truncated,
    summary: {
      visitedNodeCount: state.visitedNodeCount,
      variableCount: state.variableCount,
      collectionCount: state.collectionCount,
      componentSetCount: state.componentSetCount,
      spacingValueCount: observations.spacing.size,
      fontFamilyCount: observations.fontFamilies.size,
      fontSizeCount: observations.fontSizes.size,
      textStyleCount: observations.textStyles.size
    },
    issues: state.issues,
    notEvaluated
  }
  if (designSystemAuditJsonBytes(result) > DESIGN_SYSTEM_AUDIT_LIMITS.reportBytes) {
    result.truncated = true
    result.issues = []
    result.notEvaluated = [
      ...notEvaluated,
      'issue details removed to enforce the report byte limit'
    ]
  }
  return result
}
