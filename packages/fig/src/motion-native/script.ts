import {
  createFigmaNativeMotionApplyRequest,
  getFigmaNativeMotionTransactionSource,
  type FigmaNativeMotionApplyOptions
} from './applicator'
import type { FigmaNativeMotionPlan } from './index'

export interface FigmaNativeMotionScriptOptions extends FigmaNativeMotionApplyOptions {
  /** Stable Figma node id. Omit it to require exactly one selected node. */
  nodeId?: string
}

/**
 * Generate a copyable Figma Plugin API script around the shared native transaction.
 * The wrapper only resolves the target and passes a strictly validated, data-only request.
 */
export function buildFigmaMotionPluginScript(
  plan: FigmaNativeMotionPlan,
  options: FigmaNativeMotionScriptOptions = {}
): string {
  assertSafeScriptOptions(options)
  const request = createFigmaNativeMotionApplyRequest(plan, {
    ...(options.conflictPolicy === undefined ? {} : { conflictPolicy: options.conflictPolicy }),
    ...(options.allowTimelineGrowth === undefined
      ? {}
      : { allowTimelineGrowth: options.allowTimelineGrowth })
  })
  const transactionSource = getFigmaNativeMotionTransactionSource()
  const targetLookup = options.nodeId
    ? `let node = null
  try {
    node = await figma.getNodeByIdAsync(${JSON.stringify(options.nodeId)})
  } catch (error) {
    const result = apply(figma, null, request)
    return {
      ...result,
      code: 'node-lookup-failed',
      message: 'Could not look up the target node: ' +
        (error instanceof Error ? error.message : String(error))
    }
  }`
    : `let selection
  try {
    selection = figma.currentPage.selection
  } catch (error) {
    const result = apply(figma, null, request)
    return {
      ...result,
      code: 'selection',
      message: 'Could not inspect the current selection: ' +
        (error instanceof Error ? error.message : String(error))
    }
  }
  if (selection.length !== 1) {
    const result = apply(figma, null, request)
    return {
      ...result,
      code: 'selection',
      message: 'Select exactly one target node before applying Motion'
    }
  }
  const node = selection[0]`

  return `;(async () => {
  const request = ${indent(JSON.stringify(request, null, 2), 2).trimStart()}
  const apply = ${transactionSource}
  ${targetLookup}
  return apply(figma, node, request)
})()
`
}

function assertSafeScriptOptions(value: unknown): asserts value is FigmaNativeMotionScriptOptions {
  if (!isPlainRecord(value)) {
    throw new TypeError('Figma Motion script options must be an object')
  }
  const unknownKeys = Object.keys(value).filter(
    (key) => !['allowTimelineGrowth', 'conflictPolicy', 'nodeId'].includes(key)
  )
  if (unknownKeys.length > 0) {
    throw new TypeError(`Unknown Figma Motion script option: ${unknownKeys.join(', ')}`)
  }
  if (value.nodeId !== undefined && (typeof value.nodeId !== 'string' || value.nodeId === '')) {
    throw new TypeError('Figma Motion target nodeId must be a non-empty string')
  }
}

function indent(value: string, spaces: number): string {
  const prefix = ' '.repeat(spaces)
  return value
    .split('\n')
    .map((line) => `${prefix}${line}`)
    .join('\n')
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
