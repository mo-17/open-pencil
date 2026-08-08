import {
  cloneGeneratedEffectSpec,
  cloneMotionSpec,
  type SceneGraph,
  type SceneNode
} from '@open-pencil/scene-graph'

import { presets } from './presets'
import { allRules } from './rules'
import type {
  LinterOptions,
  LintLimits,
  LintMessage,
  LintNode,
  LintResult,
  Rule,
  RuleContext,
  Severity
} from './types'
import { getNodePath } from './utils'

export class Linter {
  private rules = new Map<string, Rule>()
  private ruleConfigs = new Map<string, { severity: Severity; options?: Record<string, unknown> }>()
  private messages: LintMessage[] = []
  private nodes = new Map<string, LintNode>()
  private traversalOrder: string[] = []
  private truncated = false
  private capturedStyleEntries = 0
  private capturedTextCodePoints = 0
  private capturedBoundVariables = 0
  private capturedStructuredPayloadNodes = 0
  private readonly limits: LintLimits

  constructor(options: LinterOptions = {}) {
    this.limits = normalizeLimits(options.limits)
    let baseConfig: Record<
      string,
      Severity | { severity: Severity; options?: Record<string, unknown> }
    > = {}
    if (options.preset) baseConfig = { ...presets[options.preset].rules }
    if (options.config?.extends) {
      const ids = Array.isArray(options.config.extends)
        ? options.config.extends
        : [options.config.extends]
      for (const id of ids) baseConfig = { ...baseConfig, ...presets[id].rules }
    }
    if (options.config?.rules) baseConfig = { ...baseConfig, ...options.config.rules }
    const rulesToLoad = options.rules ?? Object.keys(baseConfig)
    for (const ruleId of rulesToLoad) {
      const rule = allRules[ruleId]
      const config = baseConfig[ruleId]
      if (config === 'off') continue
      this.rules.set(ruleId, rule)
      if (typeof config === 'string') this.ruleConfigs.set(ruleId, { severity: config })
      else this.ruleConfigs.set(ruleId, config)
    }
  }

  lintGraph(graph: SceneGraph, rootIds?: string[]): LintResult {
    this.messages = []
    this.nodes.clear()
    this.traversalOrder = []
    this.truncated = false
    this.capturedStyleEntries = 0
    this.capturedTextCodePoints = 0
    this.capturedBoundVariables = 0
    this.capturedStructuredPayloadNodes = 0
    const roots = rootIds && rootIds.length > 0 ? rootIds : graph.getPages().map((p) => p.id)
    this.capture(graph, roots)
    this.lintNodes()
    return {
      messages: this.messages,
      errorCount: this.messages.filter((m) => m.severity === 'error').length,
      warningCount: this.messages.filter((m) => m.severity === 'warning').length,
      infoCount: this.messages.filter((m) => m.severity === 'info').length,
      truncated: this.truncated,
      visitedNodeCount: this.nodes.size
    }
  }

  private capture(graph: SceneGraph, roots: readonly string[]): void {
    const stack: Array<{ id: string; parent?: LintNode; depth: number }> = []
    for (let index = roots.length - 1; index >= 0; index--) {
      stack.push({ id: roots[index], depth: 0 })
    }

    while (stack.length > 0) {
      const current = stack.pop()
      if (!current || this.nodes.has(current.id)) continue
      if (current.depth > this.limits.maxDepth || this.nodes.size >= this.limits.maxNodes) {
        this.truncated = true
        continue
      }
      const raw = graph.getNode(current.id)
      if (!raw) continue
      const node = this.toLintNode(raw)
      node.parent = current.parent
      this.nodes.set(current.id, node)
      this.traversalOrder.push(current.id)
      if (raw.childIds.length > this.limits.maxChildrenPerNode) this.truncated = true
      const childCount = Math.min(raw.childIds.length, this.limits.maxChildrenPerNode)
      for (let index = childCount - 1; index >= 0; index--) {
        stack.push({ id: raw.childIds[index], parent: node, depth: current.depth + 1 })
      }
    }
  }

  private toLintNode(raw: SceneNode): LintNode {
    return {
      id: raw.id,
      name: raw.name,
      type: raw.type,
      width: raw.width,
      height: raw.height,
      x: raw.x,
      y: raw.y,
      rotation: raw.rotation,
      visible: raw.visible,
      locked: raw.locked,
      layoutMode: raw.layoutMode,
      itemSpacing: raw.itemSpacing,
      paddingTop: raw.paddingTop,
      paddingRight: raw.paddingRight,
      paddingBottom: raw.paddingBottom,
      paddingLeft: raw.paddingLeft,
      cornerRadius: raw.cornerRadius,
      childIds: raw.childIds.slice(0, this.limits.maxChildrenPerNode),
      fillGeometryCount: raw.fillGeometry.length,
      componentId: raw.componentId || undefined,
      text: this.boundedText(raw.text),
      fontSize: raw.fontSize,
      styleRunCount: raw.styleRuns.length,
      boundVariables: this.boundedVariables(raw.boundVariables),
      motion: this.boundedMotion(raw.motion),
      generatedEffect: this.boundedGeneratedEffect(raw.generatedEffect),
      fills: this.boundedStyleEntries(raw.fills, (f) => ({
        type: f.type,
        visible: f.visible,
        opacity: f.opacity,
        color: f.type === 'SOLID' ? f.color : undefined
      })),
      strokes: this.boundedStyleEntries(raw.strokes, (stroke) => ({
        visible: stroke.visible,
        opacity: stroke.opacity,
        color: stroke.color
      })),
      effects: this.boundedStyleEntries(raw.effects, (effect) => ({
        type: effect.type,
        visible: effect.visible,
        radius: effect.radius
      }))
    }
  }

  private boundedStyleEntries<T, TResult>(
    entries: readonly T[],
    project: (entry: T) => TResult
  ): TResult[] {
    const remaining = Math.max(0, this.limits.maxTotalStyleEntries - this.capturedStyleEntries)
    const count = Math.min(entries.length, this.limits.maxStyleEntriesPerNode, remaining)
    if (count < entries.length) this.truncated = true
    this.capturedStyleEntries += count
    const result: TResult[] = []
    for (let index = 0; index < count; index++) result.push(project(entries[index]))
    return result
  }

  private boundedText(value: string): string {
    const remaining = Math.max(0, this.limits.maxTotalTextCodePoints - this.capturedTextCodePoints)
    const bounded = boundedCodePoints(value, Math.min(this.limits.maxTextCodePoints, remaining))
    this.capturedTextCodePoints += bounded.count
    if (bounded.truncated) this.truncated = true
    return bounded.value
  }

  private boundedVariables(value: Record<string, string>): Record<string, string> {
    const result = Object.create(null) as Record<string, string>
    const remaining = Math.max(0, this.limits.maxTotalBoundVariables - this.capturedBoundVariables)
    const maximum = Math.min(this.limits.maxBoundVariablesPerNode, remaining)
    let inspected = 0
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue
      if (inspected >= maximum) {
        this.truncated = true
        break
      }
      inspected += 1
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (
        !descriptor ||
        !Object.hasOwn(descriptor, 'value') ||
        typeof descriptor.value !== 'string'
      ) {
        this.truncated = true
        continue
      }
      Object.defineProperty(result, key, {
        value: descriptor.value,
        enumerable: true,
        configurable: true,
        writable: true
      })
    }
    this.capturedBoundVariables += inspected
    return result
  }

  private boundedMotion(value: SceneNode['motion']): LintNode['motion'] {
    if (!value) return undefined
    if (!this.reserveStructuredPayload(value)) {
      this.truncated = true
      return undefined
    }
    try {
      return cloneMotionSpec(value)
    } catch {
      this.truncated = true
      return undefined
    }
  }

  private boundedGeneratedEffect(value: SceneNode['generatedEffect']): LintNode['generatedEffect'] {
    if (!value) return undefined
    if (!this.reserveStructuredPayload(value)) {
      this.truncated = true
      return undefined
    }
    try {
      return cloneGeneratedEffectSpec(value)
    } catch {
      this.truncated = true
      return undefined
    }
  }

  private reserveStructuredPayload(root: unknown): boolean {
    const remaining = Math.max(
      0,
      this.limits.maxTotalStructuredPayloadNodes - this.capturedStructuredPayloadNodes
    )
    const inspected = inspectStructuredPayload(
      root,
      Math.min(this.limits.maxStructuredPayloadNodes, remaining),
      this.limits.maxStructuredMembersPerContainer,
      this.limits.maxTextCodePoints
    )
    this.capturedStructuredPayloadNodes += inspected.nodes
    return inspected.bounded
  }

  private lintNodes(): void {
    for (const id of this.traversalOrder) {
      if (this.messages.length >= this.limits.maxMessages) {
        this.truncated = true
        break
      }
      const node = this.nodes.get(id)
      if (!node) continue
      for (const [ruleId, rule] of this.rules) {
        if (rule.match && !rule.match.includes(node.type)) continue
        const config = this.ruleConfigs.get(ruleId)
        if (!config || config.severity === 'off') continue
        const context: RuleContext = {
          report: ({ node, message, suggest }) => {
            if (this.messages.length >= this.limits.maxMessages) {
              this.truncated = true
              return
            }
            this.messages.push({
              ruleId,
              severity: config.severity as Exclude<Severity, 'off'>,
              message,
              nodeId: node.id,
              nodeName: node.name,
              nodePath: getNodePath(this.nodes.get(node.id) ?? node),
              suggest
            })
          },
          getConfig: () => config.options,
          getParent: (node) => this.nodes.get(node.id)?.parent ?? null,
          getChildren: (node) =>
            node.childIds
              .map((childId) => this.nodes.get(childId))
              .filter((child): child is LintNode => !!child)
        }
        rule.check(node, context)
      }
    }
  }
}

interface StructuredPayloadInspection {
  bounded: boolean
  nodes: number
}

interface StructuredPayloadWalkState {
  nodes: number
  readonly stack: unknown[]
}

function queueStructuredPayloadMember(
  container: object,
  key: PropertyKey,
  maxNodes: number,
  state: StructuredPayloadWalkState
): boolean {
  const descriptor = Object.getOwnPropertyDescriptor(container, key)
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || state.nodes >= maxNodes) return false
  state.nodes += 1
  state.stack.push(descriptor.value)
  return true
}

function inspectStructuredPayload(
  root: unknown,
  maxNodes: number,
  maxMembersPerContainer: number,
  maxStringLength: number
): StructuredPayloadInspection {
  if (maxNodes < 1) return { bounded: false, nodes: 0 }
  const state: StructuredPayloadWalkState = { nodes: 1, stack: [root] }
  const seen = new WeakSet<object>()
  while (state.stack.length > 0) {
    const value = state.stack.pop()
    if (typeof value === 'string' && value.length > maxStringLength) {
      return { bounded: false, nodes: state.nodes }
    }
    if (value === null || typeof value !== 'object') continue
    if (seen.has(value)) return { bounded: false, nodes: state.nodes }
    seen.add(value)
    if (Array.isArray(value)) {
      if (value.length > maxMembersPerContainer) return { bounded: false, nodes: state.nodes }
      for (let index = 0; index < value.length; index++) {
        if (!queueStructuredPayloadMember(value, String(index), maxNodes, state)) {
          return { bounded: false, nodes: state.nodes }
        }
      }
      continue
    }
    let members = 0
    for (const key in value) {
      if (!Object.hasOwn(value, key)) continue
      members += 1
      if (members > maxMembersPerContainer) return { bounded: false, nodes: state.nodes }
      if (!queueStructuredPayloadMember(value, key, maxNodes, state)) {
        return { bounded: false, nodes: state.nodes }
      }
    }
  }
  return { bounded: true, nodes: state.nodes }
}

function positiveLimit(value: number | undefined): number {
  if (value === undefined) return Number.MAX_SAFE_INTEGER
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error('Lint limits must be positive integers')
  return value
}

function normalizeLimits(limits: Partial<LintLimits> | undefined): LintLimits {
  return {
    maxNodes: positiveLimit(limits?.maxNodes),
    maxMessages: positiveLimit(limits?.maxMessages),
    maxDepth: positiveLimit(limits?.maxDepth),
    maxChildrenPerNode: positiveLimit(limits?.maxChildrenPerNode),
    maxStyleEntriesPerNode: positiveLimit(limits?.maxStyleEntriesPerNode),
    maxTotalStyleEntries: positiveLimit(limits?.maxTotalStyleEntries),
    maxTextCodePoints: positiveLimit(limits?.maxTextCodePoints),
    maxTotalTextCodePoints: positiveLimit(limits?.maxTotalTextCodePoints),
    maxBoundVariablesPerNode: positiveLimit(limits?.maxBoundVariablesPerNode),
    maxTotalBoundVariables: positiveLimit(limits?.maxTotalBoundVariables),
    maxStructuredPayloadNodes: positiveLimit(limits?.maxStructuredPayloadNodes),
    maxTotalStructuredPayloadNodes: positiveLimit(limits?.maxTotalStructuredPayloadNodes),
    maxStructuredMembersPerContainer: positiveLimit(limits?.maxStructuredMembersPerContainer)
  }
}

function boundedCodePoints(
  value: string,
  maximum: number
): { value: string; count: number; truncated: boolean } {
  // UTF-16 length is an upper bound on code-point count. The common case can
  // therefore avoid a second full scan while conservatively charging the
  // aggregate budget for astral characters.
  if (value.length <= maximum) return { value, count: value.length, truncated: false }
  let count = 0
  let end = 0
  for (const codePoint of value) {
    if (count >= maximum) {
      return { value: value.slice(0, end), count, truncated: true }
    }
    count += 1
    end += codePoint.length
  }
  return { value, count, truncated: false }
}

export function createLinter(options?: LinterOptions) {
  return new Linter(options)
}
