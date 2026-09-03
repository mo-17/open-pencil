import { canonicalBackendValue } from '#compiler/backend/canonical'

import type { BackendApplicationSpecV2 } from '@open-pencil/lowcode/backend'

import {
  resolvedSupabasePrivateRealtimeSubscriptionsV2,
  SUPABASE_PRIVATE_REALTIME_EVENT_V2
} from './realtime'

export function emitSupabasePrivateRealtimeClientV2(application: BackendApplicationSpecV2): string {
  const subscriptions = Object.fromEntries(
    resolvedSupabasePrivateRealtimeSubscriptionsV2(application).map((entry) => [
      entry.id,
      {
        entityId: entry.entityId,
        events: entry.events,
        queryKey: entry.queryKey,
        topicPrefix: entry.topicPrefix
      }
    ])
  )
  const declaration = JSON.stringify(
    canonicalBackendValue(subscriptions, '$.realtimeClient'),
    null,
    2
  )
  return `// Generated OpenPencil Supabase private Realtime client v1. Do not edit by hand.
// Auth sessions, token refresh, and logout remain owned by the host Supabase client.
// This helper never accepts, embeds, or retains credentials.
export const openPencilRealtimeSubscriptions = ${declaration} as const

export interface OpenPencilRealtimeChannel {
  on(
    type: 'broadcast',
    filter: { event: '${SUPABASE_PRIVATE_REALTIME_EVENT_V2}' },
    callback: () => void
  ): OpenPencilRealtimeChannel
  subscribe(
    callback: (
      status: 'SUBSCRIBED' | 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED',
      error?: Error
    ) => void,
    timeout: number
  ): OpenPencilRealtimeChannel
}

export interface OpenPencilSupabaseRealtimeClient {
  realtime: { setAuth(): Promise<unknown> | unknown }
  channel(
    topic: string,
    options: { config: { private: true } }
  ): OpenPencilRealtimeChannel
  removeChannel(channel: OpenPencilRealtimeChannel): Promise<string> | string
}

export interface OpenPencilRealtimeSubscriptionHandle {
  readonly topic: string
  refreshAuth(): Promise<void>
  dispose(): Promise<void>
}

const OPENPENCIL_UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u
const OPENPENCIL_REALTIME_SUBSCRIBE_TIMEOUT_MS = 10_000

interface OpenPencilRealtimeLifecycle {
  active: boolean
  stopped: boolean
  failure?: Error
  cleanupPromise?: Promise<void>
}

function realtimeStatusError(
  status: 'CHANNEL_ERROR' | 'TIMED_OUT' | 'CLOSED',
  error?: Error
): Error {
  return error ?? new Error('Supabase Realtime subscription failed with status ' + status)
}

async function bindOpenPencilInvalidation(
  supabase: OpenPencilSupabaseRealtimeClient,
  channel: OpenPencilRealtimeChannel,
  queryKey: string,
  onInvalidate: (queryKey: string) => void,
  lifecycle: OpenPencilRealtimeLifecycle
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false
    const fail = (failure: Error): void => {
      if (lifecycle.stopped) return
      lifecycle.active = false
      lifecycle.stopped = true
      lifecycle.failure = failure
      if (!settled) {
        settled = true
        globalThis.clearTimeout(timeout)
        reject(failure)
      } else {
        const cleanup = removeOpenPencilRealtimeChannelOnce(lifecycle, supabase, channel)
        void cleanup.catch(() => undefined)
      }
    }
    const timeout = globalThis.setTimeout(() => {
      fail(new Error('Supabase Realtime subscription timed out'))
    }, OPENPENCIL_REALTIME_SUBSCRIBE_TIMEOUT_MS)
    try {
      channel
        .on('broadcast', { event: '${SUPABASE_PRIVATE_REALTIME_EVENT_V2}' }, () => {
          if (lifecycle.active && !lifecycle.stopped) onInvalidate(queryKey)
        })
        .subscribe(
          (status, error) => {
            if (status === 'SUBSCRIBED') {
              if (lifecycle.stopped) return
              lifecycle.active = true
              if (!settled) {
                settled = true
                globalThis.clearTimeout(timeout)
                resolve()
              }
              return
            }
            fail(realtimeStatusError(status, error))
          },
          OPENPENCIL_REALTIME_SUBSCRIBE_TIMEOUT_MS
        )
    } catch (cause) {
      fail(cause instanceof Error ? cause : new Error('Supabase Realtime subscribe failed'))
    }
  })
}

async function removeOpenPencilRealtimeChannel(
  supabase: OpenPencilSupabaseRealtimeClient,
  channel: OpenPencilRealtimeChannel
): Promise<void> {
  const status = await supabase.removeChannel(channel)
  if (status !== 'ok') {
    throw new Error('Supabase Realtime channel removal failed with status ' + String(status))
  }
}

function removeOpenPencilRealtimeChannelOnce(
  lifecycle: OpenPencilRealtimeLifecycle,
  supabase: OpenPencilSupabaseRealtimeClient,
  channel: OpenPencilRealtimeChannel
): Promise<void> {
  lifecycle.cleanupPromise ??= removeOpenPencilRealtimeChannel(supabase, channel)
  return lifecycle.cleanupPromise
}

async function failAfterOpenPencilRealtimeCleanup(
  lifecycle: OpenPencilRealtimeLifecycle,
  supabase: OpenPencilSupabaseRealtimeClient,
  channel: OpenPencilRealtimeChannel,
  failure: unknown
): Promise<never> {
  try {
    await removeOpenPencilRealtimeChannelOnce(lifecycle, supabase, channel)
  } catch (cleanupFailure) {
    throw new AggregateError(
      [failure, cleanupFailure],
      'Supabase Realtime subscription and cleanup both failed'
    )
  }
  throw failure
}

function createOpenPencilRealtimeHandle(
  supabase: OpenPencilSupabaseRealtimeClient,
  channel: OpenPencilRealtimeChannel,
  topic: string,
  lifecycle: OpenPencilRealtimeLifecycle
): OpenPencilRealtimeSubscriptionHandle {
  let disposePromise: Promise<void> | undefined
  return {
    topic,
    async refreshAuth() {
      if (lifecycle.stopped) throw new Error('The Realtime subscription is no longer active')
      await supabase.realtime.setAuth()
    },
    dispose() {
      lifecycle.active = false
      lifecycle.stopped = true
      disposePromise ??= removeOpenPencilRealtimeChannelOnce(lifecycle, supabase, channel)
      return disposePromise
    }
  }
}

export async function subscribeOpenPencilInvalidation(args: {
  supabase: OpenPencilSupabaseRealtimeClient
  userId: string
  subscriptionId: string
  onInvalidate(queryKey: string): void
}): Promise<OpenPencilRealtimeSubscriptionHandle> {
  if (typeof args.userId !== 'string' || !OPENPENCIL_UUID.test(args.userId)) {
    throw new TypeError('A lower-case canonical user id is required')
  }
  if (
    typeof args.subscriptionId !== 'string' ||
    !Object.hasOwn(openPencilRealtimeSubscriptions, args.subscriptionId)
  ) {
    throw new TypeError('A known Realtime subscription id is required')
  }
  if (typeof args.onInvalidate !== 'function') {
    throw new TypeError('An invalidation callback is required')
  }
  const subscription = openPencilRealtimeSubscriptions[
    args.subscriptionId as keyof typeof openPencilRealtimeSubscriptions
  ]
  const supabase = args.supabase
  const userId = args.userId
  const onInvalidate = args.onInvalidate
  // The host owns Auth session refresh/logout; this helper never receives or retains a token.
  await supabase.realtime.setAuth()
  const topic = subscription.topicPrefix + userId
  const channel = supabase.channel(topic, { config: { private: true } })
  const lifecycle: OpenPencilRealtimeLifecycle = { active: false, stopped: false }
  try {
    await bindOpenPencilInvalidation(
      supabase,
      channel,
      subscription.queryKey,
      onInvalidate,
      lifecycle
    )
    if (lifecycle.failure) throw lifecycle.failure
  } catch (failure) {
    lifecycle.active = false
    lifecycle.stopped = true
    return failAfterOpenPencilRealtimeCleanup(lifecycle, supabase, channel, failure)
  }
  return createOpenPencilRealtimeHandle(supabase, channel, topic, lifecycle)
}
`
}
