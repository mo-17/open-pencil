import type { BackendRealtimeIRV1, BackendRealtimeSubscriptionIR } from './application-v2-types'
import { BACKEND_REALTIME_IR_VERSION } from './application-v2-types'
import {
  parseAuthPrincipalIntentV2,
  principalKey,
  referencedEntity,
  validatePrincipalReference
} from './application-v2-validation-helpers'
import type { AuthPolicyIR, DataModelIR } from './types'
import {
  boundedText,
  id,
  oneOf,
  parseArrayItems,
  record,
  sorted,
  uniqueBy,
  type BackendValidationContext
} from './validation-helpers'

const MAX_REALTIME_SUBSCRIPTIONS = 512
const MAX_REALTIME_EVENTS = 3

function delivery(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendRealtimeSubscriptionIR['delivery'] | undefined {
  const source = record(value, path, context, ['kind', 'queryKey'])
  if (!source) return undefined
  const kind = oneOf(source.kind, `${path}.kind`, context, ['invalidate-query'])
  const queryKey = boundedText(source.queryKey, `${path}.queryKey`, context, 256)
  return kind && queryKey ? { kind, queryKey } : undefined
}

function subscription(
  value: unknown,
  path: string,
  context: BackendValidationContext
): BackendRealtimeSubscriptionIR | undefined {
  const source = record(value, path, context, ['id', 'entityId', 'events', 'principal', 'delivery'])
  if (!source) return undefined
  const subscriptionId = id(source.id, `${path}.id`, context)
  const entityId = id(source.entityId, `${path}.entityId`, context)
  const events = parseArrayItems(
    source.events,
    `${path}.events`,
    context,
    MAX_REALTIME_EVENTS,
    (entry, entryPath, entryContext) =>
      oneOf(entry, entryPath, entryContext, ['insert', 'update', 'delete'])
  )
  if (events) {
    uniqueBy(events, `${path}.events`, context, 'Realtime event')
    if (events.length === 0) {
      context.diagnostics.push({
        code: 'backend-realtime-events-empty',
        severity: 'error',
        path: `${path}.events`,
        message: 'Realtime subscriptions require at least one event.'
      })
    }
  }
  const principal = parseAuthPrincipalIntentV2(source.principal, `${path}.principal`, context)
  const parsedDelivery = delivery(source.delivery, `${path}.delivery`, context)
  return subscriptionId && entityId && events?.length && principal && parsedDelivery
    ? {
        id: subscriptionId,
        entityId,
        events: [...events].sort(),
        principal,
        delivery: parsedDelivery
      }
    : undefined
}

function hasSelectPolicy(subscription: BackendRealtimeSubscriptionIR, auth: AuthPolicyIR): boolean {
  const key = principalKey(subscription.principal)
  return auth.rowAccess.some(
    (policy) =>
      policy.entityId === subscription.entityId &&
      policy.effect === 'allow' &&
      policy.operations.includes('select') &&
      principalKey(policy.principal) === key
  )
}

function validateRealtimeReferences(
  subscriptions: readonly BackendRealtimeSubscriptionIR[],
  model: DataModelIR,
  auth: AuthPolicyIR,
  context: BackendValidationContext
): void {
  for (const [index, entry] of subscriptions.entries()) {
    const path = `$.realtime.subscriptions[${index}]`
    referencedEntity(entry.entityId, `${path}.entityId`, model, context)
    validatePrincipalReference(entry.principal, `${path}.principal`, auth, context)
    if (hasSelectPolicy(entry, auth)) continue
    context.diagnostics.push({
      code: 'backend-realtime-select-policy-missing',
      severity: 'error',
      path: `${path}.principal`,
      message:
        'Realtime subscriptions require a matching allow-select row policy for the same principal.'
    })
  }
}

export function parseBackendRealtimeIRV1(
  value: unknown,
  path: string,
  model: DataModelIR,
  auth: AuthPolicyIR,
  context: BackendValidationContext
): BackendRealtimeIRV1 | undefined {
  const source = record(value, path, context, ['version', 'subscriptions'])
  if (!source) return undefined
  if (source.version !== BACKEND_REALTIME_IR_VERSION) {
    context.diagnostics.push({
      code: 'backend-realtime-version-unsupported',
      severity: 'error',
      path: `${path}.version`,
      message: 'Realtime IR version is not supported.'
    })
  }
  const subscriptions = parseArrayItems(
    source.subscriptions,
    `${path}.subscriptions`,
    context,
    MAX_REALTIME_SUBSCRIPTIONS,
    subscription
  )
  if (!subscriptions) return undefined
  uniqueBy(
    subscriptions.map((entry) => entry.id),
    `${path}.subscriptions`,
    context,
    'Realtime subscription id'
  )
  validateRealtimeReferences(subscriptions, model, auth, context)
  return source.version === BACKEND_REALTIME_IR_VERSION
    ? {
        version: BACKEND_REALTIME_IR_VERSION,
        subscriptions: sorted(subscriptions, (entry) => entry.id)
      }
    : undefined
}
