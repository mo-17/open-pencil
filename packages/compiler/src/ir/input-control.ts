import { inputControlConfig, validateInputAffordances } from '@open-pencil/lowcode'
import type { SceneNode } from '@open-pencil/scene-graph'

import type { CompileWarning } from '../types'
import type { IRElement } from './types'

export function inputControlFeatures(
  node: SceneNode,
  warnings: CompileWarning[]
): Pick<IRElement, 'inputControl'> {
  if (node.type !== 'INPUT') return {}
  const props = node.interactiveProps ?? {}
  const issues = validateInputAffordances(props)
  if (issues.length > 0) {
    for (const issue of issues)
      warnings.push({ code: issue.code, message: issue.reason, nodeId: node.id })
    // Color's safe business-value wrapper remains active for malformed imported data.
    if (props.inputType !== 'color') return {}
  }
  const config = inputControlConfig(props)
  if (!config) return {}
  if (props.upload !== undefined) {
    warnings.push({
      code: 'input-affordance-incompatible',
      message: 'Enhanced input controls cannot be applied to file upload inputs.',
      nodeId: node.id
    })
    return {}
  }
  return { inputControl: config }
}
