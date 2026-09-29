import type { IRElement } from '#compiler/ir/types'
import type { CompileWarning } from '#compiler/types'

type SourceOnlyTarget = 'expo' | 'flutter' | 'taro' | 'wechat-miniprogram' | 'uni-app' | 'mpx'

/** Call before emitting control bindings or children: a scalar picker cannot preserve an array. */
export function omitUnsupportedMultipleSelect(
  node: IRElement,
  target: SourceOnlyTarget,
  warn: (warning: CompileWarning) => void
): boolean {
  if (node.tag === 'input' && node.inputControl) {
    warn({
      code: `${target}-input-${node.inputControl.kind}-affordance-unsupported`,
      message:
        'This source-only target omitted the enhanced input; its authored controls are supported by React and Vue exports only.',
      nodeId: node.sourceId
    })
    return true
  }
  const inputType = node.attrs.type
  const temporalType = inputType === 'time' || inputType === 'datetime-local'
  if (node.tag === 'input' && (temporalType || node.inputSuggestions?.length)) {
    const feature = temporalType ? `input-${inputType}` : 'input-suggestions'
    warn({
      code: `${target}-${feature}-unsupported`,
      message:
        'This source-only target omitted the input; its authored temporal or suggestion behavior is supported by React and Vue exports only.',
      nodeId: node.sourceId
    })
    return true
  }
  if ((node.controlKind !== 'select' && node.tag !== 'select') || node.attrs.multiple !== true) {
    return false
  }
  warn({
    code: `${target}-select-multiple-unsupported`,
    message:
      'This source-only target omitted the multiple SELECT control; array selection is supported by React and Vue exports only.',
    nodeId: node.sourceId
  })
  return true
}
