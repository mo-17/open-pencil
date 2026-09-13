import type { ActionDef, StateDef } from '@open-pencil/scene-graph'

export function commerceState(
  name: string,
  type: StateDef['type'],
  defaultValue: StateDef['defaultValue']
): StateDef {
  return { id: crypto.randomUUID(), name, type, defaultValue }
}

export function setCommerceState(target: StateDef, valueExpr: string): ActionDef {
  return { id: crypto.randomUUID(), kind: 'setState', targetStateId: target.id, valueExpr }
}

export function setCommerceVariable(targetName: string, valueExpr: string): ActionDef {
  return { id: crypto.randomUUID(), kind: 'setVariable', targetName, valueExpr }
}

export type CommerceDocumentStateFactory = (
  base: string,
  type?: 'string' | 'object' | 'number'
) => string
