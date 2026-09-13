import {
  eventUsesRequestDebounce,
  eventUsesRequestGate,
  handlersUseRequestGate,
  requestHandlerBranches
} from '#compiler/adapters/react/request-timing'
import type { IRElement, IREventHandler, IREventName, IRNode } from '#compiler/ir/types'

import {
  scriptJSON,
  templateExpression,
  type VueEmitContext,
  type VueLocalBinding
} from '../shared'

export { eventUsesRequestDebounce, eventUsesRequestGate, handlersUseRequestGate }

export const VUE_REQUEST_THROTTLE_MS = 300
export const VUE_REQUEST_DEBOUNCE_MS = 250

interface VueRequestRuntimeAvailability {
  backend?: boolean
  supabase?: boolean
  serverWorkflow?: boolean
}

function handlerHasExecutableRequest(
  handler: IREventHandler,
  runtime: VueRequestRuntimeAvailability
): boolean {
  if (
    handler.kind === 'backendAuth' ||
    handler.kind === 'backendRequest' ||
    handler.kind === 'backendCommand' ||
    handler.kind === 'backendCommandRecovery'
  )
    return runtime.backend === true
  if (handler.kind === 'apiCall') return true
  if (
    handler.kind === 'supabaseQuery' ||
    handler.kind === 'supabaseMutation' ||
    handler.kind === 'supabaseAuth'
  ) {
    return runtime.supabase === true
  }
  if (handler.kind === 'invokeServerWorkflow') return runtime.serverWorkflow === true
  return requestHandlerBranches(handler).some((item) => handlerHasExecutableRequest(item, runtime))
}

export function handlersHaveVueExecutableRequest(
  handlers: readonly IREventHandler[],
  runtime: VueRequestRuntimeAvailability
): boolean {
  return handlers.some((handler) => handlerHasExecutableRequest(handler, runtime))
}

function treeHasUpload(node: IRNode, runtime: VueRequestRuntimeAvailability): boolean {
  if (node.kind === 'conditional') return treeHasUpload(node.consequent, runtime)
  if (node.kind === 'list') return treeHasUpload(node.template, runtime)
  if (node.kind === 'text' || node.kind === 'expression' || node.kind === 'componentRef') {
    return false
  }
  return (
    (runtime.supabase === true && node.upload !== undefined) ||
    node.children.some((child) => treeHasUpload(child, runtime))
  )
}

function treeHasTimedRequest(
  node: IRNode,
  runtime: VueRequestRuntimeAvailability,
  debounce: boolean
): boolean {
  if (node.kind === 'conditional') return treeHasTimedRequest(node.consequent, runtime, debounce)
  if (node.kind === 'list') return treeHasTimedRequest(node.template, runtime, debounce)
  if (node.kind === 'text' || node.kind === 'expression') return false
  for (const [eventName, handlers] of Object.entries(node.events ?? {}) as [
    IREventName,
    IREventHandler[]
  ][]) {
    const timing = debounce
      ? eventUsesRequestDebounce(eventName, handlers)
      : eventUsesRequestGate(eventName, handlers)
    if (timing && handlers.some((handler) => handlerHasExecutableRequest(handler, runtime))) {
      return true
    }
  }
  return (
    node.kind === 'element' &&
    node.children.some((child) => treeHasTimedRequest(child, runtime, debounce))
  )
}

export function nodesUseVueRequestGate(
  nodes: readonly IRNode[],
  runtime: VueRequestRuntimeAvailability = {}
): boolean {
  return (
    nodes.some((node) => treeHasTimedRequest(node, runtime, false)) ||
    nodes.some((node) => treeHasTimedRequest(node, runtime, true)) ||
    nodes.some((node) => treeHasUpload(node, runtime))
  )
}

export function nodesUseVueRequestDebounce(
  nodes: readonly IRNode[],
  runtime: VueRequestRuntimeAvailability = {}
): boolean {
  return nodes.some((node) => treeHasTimedRequest(node, runtime, true))
}

export function vueRequestKey(sourceId: string, eventName: IREventName | 'upload'): string {
  return `${sourceId}:${eventName}`
}

function requestKeys(node: IRElement, context: VueEmitContext): string[] {
  const keys: string[] = []
  for (const [eventName, handlers] of Object.entries(node.events ?? {}) as [
    IREventName,
    IREventHandler[]
  ][]) {
    const timed =
      eventUsesRequestGate(eventName, handlers) || eventUsesRequestDebounce(eventName, handlers)
    if (
      timed &&
      handlers.some((handler) =>
        handlerHasExecutableRequest(handler, {
          backend: context.backendAvailable,
          supabase: context.supabaseAvailable,
          serverWorkflow: context.serverWorkflowAvailable
        })
      )
    ) {
      keys.push(vueRequestKey(node.sourceId, eventName))
    }
  }
  if (node.upload && context.supabaseAvailable) {
    keys.push(vueRequestKey(node.sourceId, 'upload'))
  }
  return keys
}

const DISABLEABLE_TAGS = new Set([
  'button',
  'fieldset',
  'input',
  'optgroup',
  'option',
  'select',
  'textarea'
])

function authoredBoolean(
  value: IRElement['attrs'][string] | undefined,
  context: VueEmitContext,
  locals: readonly VueLocalBinding[],
  aria: boolean
): string {
  if (value === undefined) return 'false'
  if (typeof value === 'boolean') return String(value)
  if (typeof value === 'number') return String(value !== 0)
  if (typeof value === 'string') return String(aria ? value.toLowerCase() === 'true' : value !== '')
  if (value.kind === 'exprAttr') {
    return `Boolean(${templateExpression(value.ast, context.identAliases, locals)})`
  }
  if (value.kind === 'intlMessage') return String(value.defaultMessage !== '')
  return 'true'
}

export function buildVueRequestStateAttributes(
  node: IRElement,
  context: VueEmitContext,
  locals: readonly VueLocalBinding[]
): { attrs: string[]; overridden: ReadonlySet<string> } {
  const keys = requestKeys(node, context)
  if (keys.length === 0) return { attrs: [], overridden: new Set() }
  const pending = keys
    .map((key) => `__opPendingRequests.value.has(${scriptJSON(key)})`)
    .join(' || ')
  context.expressionIndex += 1
  const pendingBinding = `__opRequestPending_${context.expressionIndex}`
  context.templateBindings.push(`const ${pendingBinding} = __vueComputed(() => ${pending})`)
  const attrs = [
    `:data-op-request-pending="${pendingBinding} || undefined"`,
    `:aria-busy="${pendingBinding} || ${authoredBoolean(node.attrs['aria-busy'], context, locals, true)}"`
  ]
  const overridden = new Set(['data-op-request-pending', 'aria-busy'])
  if (DISABLEABLE_TAGS.has(node.tag)) {
    overridden.add('disabled')
    attrs.push(
      `:disabled="${pendingBinding} || ${authoredBoolean(node.attrs.disabled, context, locals, false)}"`
    )
  } else {
    overridden.add('aria-disabled')
    attrs.push(
      `:aria-disabled="(${pendingBinding} || ${authoredBoolean(node.attrs['aria-disabled'], context, locals, true)}) || undefined"`
    )
  }
  return { attrs, overridden }
}

/** Per-page/component single-flight + leading throttle and safe read debounce. */
export function buildVueRequestGateRuntime(debounce: boolean): string[] {
  const lines = [
    'const __opRequestsInFlight = new Set<string>()',
    'const __opRequestThrottleUntil = new Map<string, number>()',
    'const __opPendingRequests = __vueRef<ReadonlySet<string>>(new Set())',
    `function __opSetRequestPending(key: string, pending: boolean): void {
  const next = new Set(__opPendingRequests.value)
  if (pending) next.add(key)
  else next.delete(key)
  __opPendingRequests.value = next
}`,
    `async function __opRunRequest(key: string, operation: () => Promise<void>): Promise<void> {
  const now = Date.now()
  if (__opRequestsInFlight.has(key) || now < (__opRequestThrottleUntil.get(key) ?? 0)) return
  __opRequestsInFlight.add(key)
  __opRequestThrottleUntil.set(key, now + ${VUE_REQUEST_THROTTLE_MS})
  __opSetRequestPending(key, true)
  try {
    await operation()
  } finally {
    __opRequestsInFlight.delete(key)
    if (Date.now() >= (__opRequestThrottleUntil.get(key) ?? 0)) {
      __opRequestThrottleUntil.delete(key)
    }
    __opSetRequestPending(key, false)
  }
}`
  ]
  if (debounce) lines.push(buildVueDebounceRuntime())
  return lines
}

function buildVueDebounceRuntime(): string {
  return `type __OpDebouncedChange = {
  generation: number
  key: string
  operation: () => Promise<void>
}
const __opChangeDebounceTimers = new Map<EventTarget, ReturnType<typeof setTimeout>>()
const __opChangeDebounceGenerations = new Map<EventTarget, number>()
const __opChangesInFlight = new Set<EventTarget>()
const __opQueuedChanges = new Map<EventTarget, __OpDebouncedChange>()
let __opChangeDebounceMounted = true

async function __opRunDebouncedChange(
  target: EventTarget,
  change: __OpDebouncedChange
): Promise<void> {
  if (!__opChangeDebounceMounted || __opChangeDebounceGenerations.get(target) !== change.generation) return
  if (__opChangesInFlight.has(target)) {
    __opQueuedChanges.set(target, change)
    return
  }
  __opChangesInFlight.add(target)
  __opSetRequestPending(change.key, true)
  try {
    await change.operation()
  } catch (error) {
    console.error('Debounced change request failed:', error)
  } finally {
    __opChangesInFlight.delete(target)
    __opSetRequestPending(change.key, false)
    if (!__opChangeDebounceMounted) return
    const next = __opQueuedChanges.get(target)
    __opQueuedChanges.delete(target)
    if (next && __opChangeDebounceGenerations.get(target) === next.generation) {
      void __opRunDebouncedChange(target, next)
    } else if (!__opChangeDebounceTimers.has(target)) {
      __opChangeDebounceGenerations.delete(target)
    }
  }
}

function __opDebounceChange(
  target: EventTarget | null,
  key: string,
  operation: () => Promise<void>
): void {
  if (!target) return
  const generation = (__opChangeDebounceGenerations.get(target) ?? 0) + 1
  __opChangeDebounceGenerations.set(target, generation)
  __opQueuedChanges.delete(target)
  const previous = __opChangeDebounceTimers.get(target)
  if (previous !== undefined) clearTimeout(previous)
  const timer = setTimeout(() => {
    __opChangeDebounceTimers.delete(target)
    void __opRunDebouncedChange(target, { generation, key, operation })
  }, ${VUE_REQUEST_DEBOUNCE_MS})
  __opChangeDebounceTimers.set(target, timer)
}

__vueOnBeforeUnmount(() => {
  __opChangeDebounceMounted = false
  for (const timer of __opChangeDebounceTimers.values()) clearTimeout(timer)
  __opChangeDebounceTimers.clear()
  __opChangeDebounceGenerations.clear()
  __opQueuedChanges.clear()
})`
}
