import type { SceneGraph, SceneNode } from '@open-pencil/scene-graph'

const TEXT_TOKEN = /\[\[OPENPENCIL_CODEPEN_TEXT_\d{4}\]\]/g
const TEXT_TOKEN_PREFIX = '[[OPENPENCIL_CODEPEN_TEXT_'
const INTERACTIVE_TEXT_FIELDS = Object.freeze(['label', 'placeholder', 'text', 'title', 'value'])

export type CodePenTextTokenResolver = (token: string) => string | undefined

export function assertKnownCodePenTextTokens(
  jsx: string,
  resolveTextToken: CodePenTextTokenResolver
): void {
  for (const match of jsx.matchAll(TEXT_TOKEN)) {
    if (resolveTextToken(match[0]) === undefined) {
      throw new TypeError('Shadow draft JSX contains a text token outside the bound evidence')
    }
  }
  if (jsx.replace(TEXT_TOKEN, '').includes(TEXT_TOKEN_PREFIX)) {
    throw new TypeError('Shadow draft JSX contains a malformed CodePen text token')
  }
}

function substituteTextTokens(value: string, resolveTextToken: CodePenTextTokenResolver): string {
  return value.replace(TEXT_TOKEN, (token) => resolveTextToken(token) ?? token)
}

function substitutedInteractiveProps(
  props: Readonly<Record<string, unknown>> | undefined,
  resolveTextToken: CodePenTextTokenResolver
): Readonly<Record<string, unknown>> | undefined {
  if (!props) return undefined
  let changed = false
  const next = { ...props }
  for (const field of INTERACTIVE_TEXT_FIELDS) {
    const value = next[field]
    if (typeof value !== 'string' || !value.includes(TEXT_TOKEN_PREFIX)) continue
    const replacement = substituteTextTokens(value, resolveTextToken)
    if (replacement === value) continue
    next[field] = replacement
    changed = true
  }
  return changed ? next : undefined
}

function substituteNodeText(
  graph: SceneGraph,
  node: SceneNode,
  resolveTextToken: CodePenTextTokenResolver
): void {
  const text = node.text.includes(TEXT_TOKEN_PREFIX)
    ? substituteTextTokens(node.text, resolveTextToken)
    : node.text
  const name = node.name.includes(TEXT_TOKEN_PREFIX)
    ? substituteTextTokens(node.name, resolveTextToken)
    : node.name
  const interactiveProps = substitutedInteractiveProps(node.interactiveProps, resolveTextToken)
  if (text === node.text && name === node.name && !interactiveProps) return
  graph.updateNode(node.id, {
    ...(text !== node.text ? { text } : {}),
    ...(name !== node.name ? { name } : {}),
    ...(interactiveProps ? { interactiveProps } : {})
  })
}

export function substituteCodePenEvidenceText(
  graph: SceneGraph,
  rootId: string,
  resolveTextToken: CodePenTextTokenResolver
): void {
  const pending = [rootId]
  while (pending.length > 0) {
    const id = pending.pop()
    if (!id) continue
    const node = graph.getNode(id)
    if (!node) continue
    substituteNodeText(graph, node, resolveTextToken)
    pending.push(...node.childIds)
  }
}
