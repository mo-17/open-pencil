import {
  cloneGeneratedEffectSpec,
  parseGeneratedEffectSpec,
  type GeneratedEffectSpecV1,
  type SceneNode
} from '@open-pencil/scene-graph'

import type { FigmaAPI } from '#core/figma-api'
import { generatedEffectNodeChanges } from '#core/motion'
import { defineTool, type ToolCtx } from '#core/tools/schema'

type ModifyResult<T> = { ok: true; data: T } | { ok: false; error: string }

const MAX_GENERATED_EFFECT_JSON_BYTES = 64 * 1024
const GENERATED_EFFECT_CLEAR_PARAMS = {
  nodeId: { type: 'string', description: 'Scene node id', required: true }
} as const

function fail<T = never>(error: string): ModifyResult<T> {
  return { ok: false, error }
}

function parseSpecJson(specJson: string): ModifyResult<GeneratedEffectSpecV1> {
  if (typeof specJson !== 'string') return fail('specJson must be a JSON string')
  if (new TextEncoder().encode(specJson).byteLength > MAX_GENERATED_EFFECT_JSON_BYTES) {
    return fail(`specJson exceeds ${MAX_GENERATED_EFFECT_JSON_BYTES} bytes`)
  }
  let value: unknown
  try {
    value = JSON.parse(specJson)
  } catch (error) {
    return fail(
      `specJson is not valid JSON: ${error instanceof Error ? error.message : String(error)}`
    )
  }
  try {
    return { ok: true, data: parseGeneratedEffectSpec(value) }
  } catch (error) {
    return fail(
      `Invalid generated-effect spec: ${error instanceof Error ? error.message : String(error)}`
    )
  }
}

function applyGeneratedEffect(
  figma: FigmaAPI,
  node: SceneNode,
  spec: GeneratedEffectSpecV1 | undefined,
  label: string,
  ctx?: ToolCtx
): void {
  const changes = generatedEffectNodeChanges(node, spec)
  if (ctx?.editor) {
    ctx.editor.updateNodeWithUndo(node.id, changes, label)
    return
  }
  if (!spec) {
    if (node.type === 'INSTANCE') figma.graph.updateNode(node.id, { overrides: changes.overrides })
    figma.graph.clearNodeFields(node.id, ['generatedEffect'])
  } else {
    figma.graph.updateNode(node.id, changes)
  }
}

function generatedEffectClearState(node: SceneNode | undefined): 'missing' | 'cleared' | 'set' {
  if (!node) return 'missing'
  if (node.generatedEffect) return 'set'
  if (node.type !== 'INSTANCE') return 'cleared'
  return !Object.hasOwn(node.overrides, 'generatedEffect') ||
    node.overrides.generatedEffect === null
    ? 'cleared'
    : 'set'
}

export const updateGeneratedEffect = defineTool({
  name: 'update_generated_effect',
  mutates: true,
  description:
    'Attach or replace one strict generated-effect v1 layer. specJson must use an allowlisted built-in preset and bounded data only; shader source, arbitrary code, URLs, unknown fields, future versions, oversized resource budgets, and excessive update frequency are rejected.',
  params: {
    nodeId: { type: 'string', description: 'Scene node id', required: true },
    specJson: {
      type: 'string',
      description: 'Strict JSON-encoded GeneratedEffectSpec v1 object',
      required: true
    }
  },
  execute: (
    figma,
    { nodeId, specJson },
    ctx
  ): ModifyResult<{
    nodeId: string
    preset: GeneratedEffectSpecV1['params']['preset']
    maxPrimitives: number
    maxRasterPixels: number
  }> => {
    const node = figma.graph.getNode(nodeId)
    if (!node) return fail(`Scene node not found: ${nodeId}`)
    const parsed = parseSpecJson(specJson)
    if (!parsed.ok) return parsed
    const spec = cloneGeneratedEffectSpec(parsed.data)
    applyGeneratedEffect(figma, node, spec, 'AI: update_generated_effect', ctx)
    return {
      ok: true,
      data: {
        nodeId,
        preset: spec.params.preset,
        maxPrimitives: spec.budget.maxPrimitives,
        maxRasterPixels: spec.budget.maxRasterPixels
      }
    }
  }
})

export const clearGeneratedEffect = defineTool({
  name: 'clear_generated_effect',
  mutates: true,
  description:
    "Remove one node's generated-effect layer and preserve an explicit instance override.",
  params: GENERATED_EFFECT_CLEAR_PARAMS,
  execute: (figma, { nodeId }, ctx): ModifyResult<{ nodeId: string; cleared: boolean }> => {
    const node = figma.graph.getNode(nodeId)
    const state = generatedEffectClearState(node)
    if (state === 'missing') return fail(`Scene node not found: ${nodeId}`)
    if (state === 'cleared') return { ok: true, data: { nodeId, cleared: false } }
    applyGeneratedEffect(figma, node as SceneNode, undefined, 'AI: clear_generated_effect', ctx)
    return { ok: true, data: { nodeId, cleared: true } }
  }
})
