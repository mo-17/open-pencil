import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { checkboxTextNode } from '#core/canvas/checkbox/state'
import { textInputDesignContent } from '#core/canvas/control-state'
import { accordionTextNode } from '#core/canvas/modules/accordion/text'
import { alertTextNode } from '#core/canvas/modules/alert/text'
import { avatarTextNode } from '#core/canvas/modules/avatar/text'
import { badgeTextNode } from '#core/canvas/modules/badge/text'
import { breadcrumbTextNode } from '#core/canvas/modules/breadcrumb/text'
import { carouselTextNode } from '#core/canvas/modules/carousel/text'
import { chartTextNode } from '#core/canvas/modules/chart/text'
import { chipTextNode } from '#core/canvas/modules/chip/text'
import { codeBlockTextNode } from '#core/canvas/modules/code-block/text'
import { dataGridTextNode } from '#core/canvas/modules/data-grid/text'
import { dateRangeTextNode } from '#core/canvas/modules/date-range/text'
import { descriptionsTextNode } from '#core/canvas/modules/descriptions/text'
import { emptyStateTextNode } from '#core/canvas/modules/empty-state/text'
import { markdownTextNode } from '#core/canvas/modules/markdown'
import { modalTriggerTextNode } from '#core/canvas/modules/modal/text'
import { orgChartTextNode } from '#core/canvas/modules/org-chart/text'
import { paginationTextNode } from '#core/canvas/modules/pagination/text'
import { popoverTriggerTextNode } from '#core/canvas/modules/popover/text'
import { progressTextNode } from '#core/canvas/modules/progress/text'
import { ratingTextNode } from '#core/canvas/modules/rating/text'
import { skeletonTextNode } from '#core/canvas/modules/skeleton/text'
import { sliderTextNode } from '#core/canvas/modules/slider/text'
import { stepperTextNode } from '#core/canvas/modules/stepper/text'
import { tableTextNode } from '#core/canvas/modules/table/text'
import { tabsTextNode } from '#core/canvas/modules/tabs/text'
import { timelineTextNode } from '#core/canvas/modules/timeline/text'
import { tooltipTextNode } from '#core/canvas/modules/tooltip/text'
import { treeTextNode } from '#core/canvas/modules/tree/text'
import { triggerTextNode } from '#core/canvas/modules/trigger/text'
import { cascaderTextNode } from '#core/canvas/modules/cascader/text'
import { walktourTextNode } from '#core/canvas/modules/walktour/text'
import { selectDesignContent } from '#core/canvas/select-state'
import { DEFAULT_FONT_FAMILY } from '#core/constants'
import { transformTextCase } from '#core/text/case'
import { cjkFallbackScriptForLanguage, type FontFallbackScript } from '#core/text/fallbacks'
import { weightToStyle } from '#core/text/font/style'
import { lowcodeTextNode, selectTextProjection, textInputProjection } from '#core/text/lowcode'

export interface NodeFontFace {
  family: string
  style: string
}

export type NodeFontScope = { kind: 'base' } | { kind: 'style_run'; start: number; end: number }

export interface NodeFontFaceUsage extends NodeFontFace {
  scopes: NodeFontScope[]
}

export function requiredNodeFontFaceUsages(node: SceneNode): NodeFontFaceUsage[] {
  if (node.type !== 'TEXT') return []
  const baseFamily = node.fontFamily || DEFAULT_FONT_FAMILY
  const faces = new Map<string, NodeFontFaceUsage>()
  const add = (family: string, style: string, scope: NodeFontScope) => {
    const key = `${family}\0${style}`
    const existing = faces.get(key)
    if (existing) {
      existing.scopes.push(scope)
    } else {
      faces.set(key, { family, style, scopes: [scope] })
    }
  }

  add(baseFamily, weightToStyle(node.fontWeight || 400, node.italic), { kind: 'base' })
  for (const run of node.styleRuns) {
    const family = run.style.fontFamily ?? baseFamily
    const weight = run.style.fontWeight ?? node.fontWeight
    const italic = run.style.italic ?? node.italic
    add(family, weightToStyle(weight || 400, italic), {
      kind: 'style_run',
      start: run.start,
      end: run.start + run.length
    })
  }
  return [...faces.values()]
}

export function requiredNodeFontFaces(node: SceneNode): NodeFontFace[] {
  return requiredNodeFontFaceUsages(node).map(({ family, style }) => ({ family, style }))
}

export { requiredNodeFontFaces as collectNodeFontFaces }

function graphTextNode(graph: SceneGraph, node: SceneNode): SceneNode {
  if (node.type === 'INPUT' || node.type === 'TEXTAREA')
    return textInputProjection(node, textInputDesignContent(graph, node))?.node ?? node
  if (node.type === 'CHECKBOX') return checkboxTextNode(graph, node) ?? node
  if (node.type === 'SELECT')
    return selectTextProjection(node, selectDesignContent(graph, node))?.node ?? node
  return lowcodeTextNode(node) ?? moduleTextNode(node)
}

function moduleTextNode(node: SceneNode): SceneNode {
  return (
    descriptionsTextNode(node) ??
    paginationTextNode(node) ??
    orgChartTextNode(node) ??
    walktourTextNode(node) ??
    cascaderTextNode(node) ??
    codeBlockTextNode(node) ??
    markdownTextNode(node) ??
    feedbackTextNode(node) ??
    sliderTextNode(node) ??
    ratingTextNode(node) ??
    stepperTextNode(node) ??
    breadcrumbTextNode(node) ??
    accordionTextNode(node) ??
    carouselTextNode(node) ??
    dataGridTextNode(node) ??
    modalTriggerTextNode(node) ??
    tabsTextNode(node) ??
    tableTextNode(node) ??
    triggerTextNode(node) ??
    node
  )
}

export function collectGraphFontKeys(
  graph: SceneGraph,
  nodeIds: readonly string[]
): Array<[string, string]> {
  const fontKeys = new Set<string>()
  const collect = (nodeId: string) => {
    const node = graph.getNode(nodeId)
    if (!node) return
    const textNode = graphTextNode(graph, node)
    for (const { family, style } of requiredNodeFontFaces(textNode)) {
      fontKeys.add(`${family}\0${style}`)
    }
    for (const childId of node.childIds) collect(childId)
  }
  for (const nodeId of nodeIds) collect(nodeId)
  return Array.from(fontKeys, (key) => key.split('\0') as [string, string])
}

function fallbackScriptForCharacter(
  character: string,
  language?: string | null
): FontFallbackScript | null {
  if (/\p{Script=Arabic}/u.test(character)) return 'arabic'
  if (/\p{Script=Hangul}/u.test(character)) return 'cjk-kr'
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(character)) return 'cjk-jp'
  if (/\p{Script=Han}/u.test(character)) return cjkFallbackScriptForLanguage(language) ?? 'cjk-sc'
  return null
}

function textLanguageAt(node: SceneNode, index: number): string | null {
  const run = node.styleRuns.find((item) => index >= item.start && index < item.start + item.length)
  return run?.style.textLanguage ?? node.textLanguage
}

function transformedCharactersWithSourceOffsets(
  node: SceneNode
): Array<{ character: string; sourceIndex: number }> {
  const result: Array<{ character: string; sourceIndex: number }> = []
  let sourceIndex = 0
  for (const sourceCharacter of node.text) {
    for (const character of transformTextCase(sourceCharacter, node.textCase)) {
      result.push({ character, sourceIndex })
    }
    sourceIndex += sourceCharacter.length
  }
  return result
}
export interface GraphFontRequirements {
  characters: string
  nodes: SceneNode[]
  scripts: FontFallbackScript[]
}

export function collectGraphFontRequirements(
  graph: SceneGraph,
  nodeIds: readonly string[]
): GraphFontRequirements {
  const characters = new Set<string>()
  const nodes: SceneNode[] = []
  const scripts = new Set<FontFallbackScript>()
  const collect = (nodeId: string) => {
    const node = graph.getNode(nodeId)
    if (!node) return
    const textNode = graphTextNode(graph, node)
    nodes.push(textNode)
    if (textNode.type === 'TEXT') {
      for (const { character, sourceIndex } of transformedCharactersWithSourceOffsets(textNode)) {
        characters.add(character)
        const script = fallbackScriptForCharacter(character, textLanguageAt(textNode, sourceIndex))
        if (script) scripts.add(script)
      }
    }
    for (const childId of node.childIds) collect(childId)
  }
  for (const nodeId of nodeIds) collect(nodeId)
  return { characters: Array.from(characters).join(''), nodes, scripts: Array.from(scripts) }
}

function displayTextNode(node: SceneNode): SceneNode | null {
  return (
    dateRangeTextNode(node) ??
    treeTextNode(node) ??
    popoverTriggerTextNode(node) ??
    avatarTextNode(node) ??
    badgeTextNode(node) ??
    timelineTextNode(node) ??
    tooltipTextNode(node) ??
    skeletonTextNode(node) ??
    emptyStateTextNode(node) ??
    chartTextNode(node)
  )
}

function feedbackTextNode(node: SceneNode): SceneNode | null {
  return (
    alertTextNode(node) ?? progressTextNode(node) ?? chipTextNode(node) ?? displayTextNode(node)
  )
}
