import type { ActionDef, StateDef } from '@open-pencil/scene-graph'

export function businessSet(target: StateDef, valueExpr: string): ActionDef {
  return { id: crypto.randomUUID(), kind: 'setState', targetStateId: target.id, valueExpr }
}

export function businessVariable(targetName: string, valueExpr: string): ActionDef {
  return { id: crypto.randomUUID(), kind: 'setVariable', targetName, valueExpr }
}

export function businessLiteral(value: unknown): string {
  if (typeof value === 'boolean') return value ? '!0' : '!1'
  return JSON.stringify(value)
}
