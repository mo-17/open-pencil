import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

import { DEFAULT_FONT_FAMILY } from '#core/constants'
import { transformTextCase } from '#core/text/case'
import { cjkFallbackScriptForLanguage, type FontFallbackScript } from '#core/text/fallbacks'
import { weightToStyle } from '#core/text/font-style'
import { buttonLabelTextNode } from '#core/text/lowcode'

export function collectGraphFontKeys(
  graph: SceneGraph,
  nodeIds: readonly string[]
): Array<[string, string]> {
  const fontKeys = new Set<string>()
  const collect = (nodeId: string) => {
    const node = graph.getNode(nodeId)
    if (!node) return
    const textNode = buttonLabelTextNode(node) ?? node
    if (textNode.type === 'TEXT') {
      const family = textNode.fontFamily || DEFAULT_FONT_FAMILY
      fontKeys.add(`${family}\0${weightToStyle(textNode.fontWeight || 400, textNode.italic)}`)
      for (const run of textNode.styleRuns) {
        const runFamily = run.style.fontFamily ?? family
        const weight = run.style.fontWeight ?? textNode.fontWeight
        const italic = run.style.italic ?? textNode.italic
        fontKeys.add(`${runFamily}\0${weightToStyle(weight, italic)}`)
      }
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
    const textNode = buttonLabelTextNode(node) ?? node
    nodes.push(textNode)
    if (textNode.type === 'TEXT') {
      let index = 0
      for (const character of transformTextCase(textNode.text, textNode.textCase)) {
        characters.add(character)
        const script = fallbackScriptForCharacter(character, textLanguageAt(textNode, index))
        if (script) scripts.add(script)
        index += character.length
      }
    }
    for (const childId of node.childIds) collect(childId)
  }
  for (const nodeId of nodeIds) collect(nodeId)
  return { characters: Array.from(characters).join(''), nodes, scripts: Array.from(scripts) }
}
