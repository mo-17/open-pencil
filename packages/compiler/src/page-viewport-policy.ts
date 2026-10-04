import type { IRTree } from './ir/types'
import type { CompileWarning, CompilerTarget } from './types'

const UNSUPPORTED_TARGETS: ReadonlySet<CompilerTarget> = new Set([
  'expo',
  'wechat-miniprogram',
  'taro',
  'uni-app',
  'mpx'
])

/** Keep unsupported native sizing explicit without changing their generated source. */
export function pageViewportTargetWarnings(
  irs: readonly IRTree[],
  target: CompilerTarget
): CompileWarning[] {
  if (!UNSUPPORTED_TARGETS.has(target)) return []
  return irs.flatMap((ir) => {
    const policy = ir.pageViewport
    if (!policy || policy.mode === 'fixed') return []
    return [
      {
        code: 'page-viewport-target-unsupported',
        nodeId: ir.pageId,
        message: `${target} retained original page sizing because ${policy.mode} page viewport adaptation is currently supported only by React, Vue and Flutter.`
      }
    ]
  })
}
