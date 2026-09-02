import type { ActionDef, ServerActionDef } from '@open-pencil/scene-graph'

type RlsSqlCommand = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE'

export function commandsForSupabaseAction(action: ActionDef | ServerActionDef): RlsSqlCommand[] {
  if (action.kind === 'supabaseQuery') return ['SELECT']
  if (action.kind !== 'supabaseMutation') return []
  if (action.operation === 'insert') return ['INSERT']
  if (action.operation === 'update') return ['SELECT', 'UPDATE']
  if (action.operation === 'delete') return ['SELECT', 'DELETE']
  return ['SELECT', 'INSERT', 'UPDATE']
}
