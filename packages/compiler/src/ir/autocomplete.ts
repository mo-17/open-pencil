import { validateInteractiveProps } from '@open-pencil/lowcode'
import type { SceneNode } from '@open-pencil/scene-graph'

import type { CompileWarning } from '../types'
import type { IRElement } from './types'

/** Suggestions are local authored strings, never remote requests or executable expressions. */
export function inputSuggestionFeatures(
  node: SceneNode,
  warnings: CompileWarning[]
): Pick<IRElement, 'inputSuggestions'> {
  if (node.type !== 'INPUT' || node.interactiveProps?.suggestions === undefined) return {}
  const props = node.interactiveProps
  const issues = validateInteractiveProps('INPUT', {
    inputType: props.inputType ?? 'text',
    suggestions: props.suggestions
  })
  if (issues.some((issue) => issue.severity === 'error') || props.upload !== undefined) {
    warnings.push({
      code: 'input-suggestions-invalid',
      message:
        'Invalid or incompatible local input suggestions were omitted; the input retains its authored value.',
      nodeId: node.id
    })
    return {}
  }
  const suggestions = props.suggestions
  return Array.isArray(suggestions) && suggestions.length > 0
    ? {
        inputSuggestions: suggestions.filter((value): value is string => typeof value === 'string')
      }
    : {}
}
