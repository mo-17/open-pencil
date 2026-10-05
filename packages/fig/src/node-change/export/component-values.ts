import type { SceneNode } from '@open-pencil/scene-graph'

import {
  getOrCreateNodeGuid,
  getOrCreatePropertyGuid,
  parseGuidOrNull,
  type SceneNodeToKiwiContext
} from './context'
import { slotContentAssignment } from './slots'

export function componentPropertyValue(
  type: string,
  value: string,
  context: SceneNodeToKiwiContext,
  localIdCounter: { value: number }
) {
  if (type === 'BOOLEAN') return { boolValue: value === 'true' }
  if (type === 'INSTANCE_SWAP') {
    const target = context.graph.getNode(value)
    const guid = target
      ? getOrCreateNodeGuid(context, target.id, localIdCounter)
      : parseGuidOrNull(value)
    return guid ? { guidValue: guid } : { textValue: { characters: value } }
  }
  return { textValue: { characters: value } }
}

export function componentPropertyVariableValue(
  type: string,
  value: string,
  context: SceneNodeToKiwiContext,
  localIdCounter: { value: number }
) {
  const legacy = componentPropertyValue(type, value, context, localIdCounter)
  if (type === 'BOOLEAN')
    return {
      value: { boolValue: value === 'true' },
      dataType: 'BOOLEAN',
      resolvedDataType: 'BOOLEAN'
    }
  if (type === 'INSTANCE_SWAP' && 'guidValue' in legacy) {
    return {
      value: { symbolIdValue: { guid: legacy.guidValue } },
      dataType: 'SYMBOL_ID',
      resolvedDataType: 'SYMBOL_ID'
    }
  }
  return { value: { textValue: value }, dataType: 'STRING', resolvedDataType: 'STRING' }
}

export function serializeComponentPropertyAssignments(
  context: SceneNodeToKiwiContext,
  node: SceneNode,
  localIdCounter: { value: number }
) {
  return Object.entries(node.componentPropertyAssignments)
    .map(([propertyId, value]) => {
      const definition = context.componentPropertyDefinitionsById.get(propertyId)
      if (!definition) return null
      if (definition.type === 'SLOT')
        return slotContentAssignment(
          context,
          node,
          propertyId,
          getOrCreatePropertyGuid(context, propertyId, localIdCounter),
          localIdCounter
        )
      return {
        defID: getOrCreatePropertyGuid(context, propertyId, localIdCounter),
        value: componentPropertyValue(definition.type, value, context, localIdCounter),
        varValue: componentPropertyVariableValue(definition.type, value, context, localIdCounter)
      }
    })
    .filter((assignment): assignment is NonNullable<typeof assignment> => assignment !== null)
}
