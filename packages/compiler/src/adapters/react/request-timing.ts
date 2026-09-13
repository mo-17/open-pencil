import type { IREventHandler, IREventName, IRNode, IRTree } from '#compiler/ir/types'

/** Network-bearing actions that must be single-flight at the originating UI
 * event. A fixed time debounce is unsafe for mutations: it can delay the first
 * intentional request or replay a trailing INSERT/DELETE. */
const REQUEST_GATE_KINDS: ReadonlySet<IREventHandler['kind']> = new Set([
  'backendAuth',
  'backendRequest',
  'backendCommand',
  'backendCommandRecovery',
  'apiCall',
  'invokeServerWorkflow',
  'stripeCheckout',
  'stripeCustomerPortal',
  'supabaseQuery',
  'supabaseMutation',
  'supabaseAuth'
])

/** Whether a handler chain contains a network-bearing action, including
 * condition/confirm and success/error branches. */
export function handlersUseRequestGate(handlers: readonly IREventHandler[]): boolean {
  return handlers.some((handler) =>
    handlerTreeMatches(handler, (nested) => REQUEST_GATE_KINDS.has(nested.kind))
  )
}

/** Activation and submit start immediately. Their request runner also applies
 * a short leading-edge throttle, while the single-flight lock covers the full
 * unsettled promise lifetime. */
export function eventUsesRequestGate(
  eventName: IREventName,
  handlers: readonly IREventHandler[]
): boolean {
  return (eventName === 'onClick' || eventName === 'onSubmit') && handlersUseRequestGate(handlers)
}

/** High-frequency input requests use a trailing, latest-wins debounce. The
 * generated controlled-value writer stays outside the timer so typing remains
 * immediate; only the authored remote-bearing action chain is deferred. */
export function eventUsesRequestDebounce(
  eventName: IREventName,
  handlers: readonly IREventHandler[]
): boolean {
  return (
    eventName === 'onChange' &&
    handlersUseSafeChangeDebounce(handlers) &&
    !handlersReferenceIdentifier(handlers, '$event')
  )
}

/** Only read-like requests may be coalesced. Delaying or dropping an authored
 * mutation/auth/checkout/workflow action would change business semantics. */
function handlersUseSafeChangeDebounce(handlers: readonly IREventHandler[]): boolean {
  const hasRead = handlers.some((handler) => handlerTreeMatches(handler, isSafeChangeRead))
  const hasUnsafeRemote = handlers.some((handler) =>
    handlerTreeMatches(handler, isUnsafeChangeRemote)
  )
  return hasRead && !hasUnsafeRemote
}

function isSafeChangeRead(handler: IREventHandler): boolean {
  return (
    (handler.kind === 'backendRequest' &&
      (handler.operation === 'list' || handler.operation === 'read')) ||
    handler.kind === 'supabaseQuery' ||
    (handler.kind === 'apiCall' && handler.method === 'GET')
  )
}

function isUnsafeChangeRemote(handler: IREventHandler): boolean {
  return REQUEST_GATE_KINDS.has(handler.kind) && !isSafeChangeRead(handler)
}

/** React clears SyntheticEvent.currentTarget after dispatch. `$value` is
 * snapshotted before scheduling, but an arbitrary delayed `$event` expression
 * would observe unstable event state, so such chains remain immediate. */
function handlersReferenceIdentifier(
  handlers: readonly IREventHandler[],
  identifier: string
): boolean {
  return handlers.some((handler) => valueReferencesIdentifier(handler, identifier))
}

function valueReferencesIdentifier(value: unknown, identifier: string): boolean {
  if (Array.isArray(value))
    return value.some((entry) => valueReferencesIdentifier(entry, identifier))
  if (value === null || typeof value !== 'object') return false
  const expression = value as { kind?: unknown; name?: unknown }
  if (expression.kind === 'ident' && expression.name === identifier) return true
  for (const [key, nested] of Object.entries(value)) {
    if (key === 'references' && Array.isArray(nested) && nested.includes(identifier)) return true
    if (valueReferencesIdentifier(nested, identifier)) return true
  }
  return false
}

export function requestHandlerBranches(handler: IREventHandler): readonly IREventHandler[] {
  if (handler.kind === 'condition' || handler.kind === 'confirm') {
    return [...handler.consequent, ...(handler.alternate ?? [])]
  }
  if (
    handler.kind === 'backendCommand' ||
    handler.kind === 'backendCommandRecovery' ||
    handler.kind === 'backendRequest' ||
    handler.kind === 'apiCall' ||
    handler.kind === 'supabaseQuery' ||
    handler.kind === 'supabaseMutation' ||
    handler.kind === 'invokeServerWorkflow'
  ) {
    return [...(handler.onSuccess ?? []), ...(handler.onError ?? [])]
  }
  return []
}

function handlerTreeMatches(
  handler: IREventHandler,
  predicate: (handler: IREventHandler) => boolean
): boolean {
  if (predicate(handler)) return true
  return requestHandlerBranches(handler).some((branch) => handlerTreeMatches(branch, predicate))
}

function treeMatchesEvent(
  node: IRNode,
  predicate: (eventName: IREventName, handlers: IREventHandler[]) => boolean
): boolean {
  if (node.kind === 'conditional') return treeMatchesEvent(node.consequent, predicate)
  if (node.kind === 'list') return treeMatchesEvent(node.template, predicate)
  if (node.kind !== 'element' && node.kind !== 'componentRef') return false
  if (node.events) {
    for (const [eventName, handlers] of Object.entries(node.events) as [
      IREventName,
      IREventHandler[]
    ][]) {
      if (predicate(eventName, handlers)) return true
    }
  }
  return (
    node.kind === 'element' && node.children.some((child) => treeMatchesEvent(child, predicate))
  )
}

/** Whether any activation or debounced change in a page/component body needs
 * the generated request-timing hooks. */
export function nodesUseRequestGate(nodes: readonly IRNode[]): boolean {
  return nodes.some((node) =>
    treeMatchesEvent(
      node,
      (eventName, handlers) =>
        eventUsesRequestGate(eventName, handlers) || eventUsesRequestDebounce(eventName, handlers)
    )
  )
}

export function pageUsesRequestGate(ir: IRTree): boolean {
  return nodesUseRequestGate(ir.children)
}

export function nodesUseRequestDebounce(nodes: readonly IRNode[]): boolean {
  return nodes.some((node) => treeMatchesEvent(node, eventUsesRequestDebounce))
}

export function pageUsesRequestDebounce(ir: IRTree): boolean {
  return nodesUseRequestDebounce(ir.children)
}
