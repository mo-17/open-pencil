import type { ExprAst } from '@open-pencil/lowcode'
import type { SceneNode } from '@open-pencil/scene-graph'

import type { IRAttrValue, IRModule, IRWarning } from '../types'

function expressionSource(binding: unknown): string | undefined {
  if (!binding || typeof binding !== 'object') return undefined
  const kind = Object.getOwnPropertyDescriptor(binding, 'kind')?.value
  const source: unknown = Object.getOwnPropertyDescriptor(binding, 'expr')?.value
  return kind === 'expr' && typeof source === 'string' ? source : undefined
}

/** A native button's read-only disabled expression never removes an authored static lock. */
export function collectNativeButtonDisabledBinding(
  node: SceneNode,
  module: IRModule | null,
  attrs: Record<string, IRAttrValue>,
  warnings: IRWarning[],
  resolve: (source: string) => ExprAst | undefined
): void {
  if (node.type !== 'BUTTON' || module) return
  if (!node.bindings || !Object.hasOwn(node.bindings, 'disabled')) return
  attrs.disabled = true
  const binding: unknown = Object.getOwnPropertyDescriptor(node.bindings, 'disabled')?.value
  const source = expressionSource(binding)
  if (source === undefined) {
    warnings.push({
      code: 'button-disabled-binding-invalid',
      message: 'BUTTON disabled requires a read expression binding; the button remains disabled.',
      nodeId: node.id
    })
    return
  }
  const ast = resolve(source)
  if (ast && node.interactiveProps?.disabled !== true)
    attrs.disabled = {
      kind: 'exprAttr',
      ast: { kind: 'unary', op: '!', arg: { kind: 'unary', op: '!', arg: ast } }
    }
}
