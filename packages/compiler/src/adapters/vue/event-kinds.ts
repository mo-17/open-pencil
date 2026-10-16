import type { IREventHandler } from '#compiler/ir/types'

export const SUPPORTED_EVENT_KINDS = new Set<IREventHandler['kind']>([
  'backendAuth',
  'backendRequest',
  'backendCommand',
  'backendCommandRecovery',
  'setState',
  'setVariable',
  'navigate',
  'back',
  'apiCall',
  'condition',
  'delay',
  'stop',
  'toast',
  'confirm',
  'clipboard',
  'supabaseQuery',
  'supabaseMutation',
  'supabaseAuth',
  'invokeServerWorkflow'
])
