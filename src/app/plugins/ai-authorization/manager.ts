import { ConnectorSnapshotListenerRegistry } from '../connectors/listener-registry'
import {
  DEFAULT_THIRD_PARTY_PLUGIN_AI_HOST_POLICY,
  listThirdPartyPluginAIContributionReviews,
  reviewThirdPartyPluginAIContribution
} from './eligibility'
import type {
  CreateThirdPartyPluginAIGrantManagerOptions,
  ThirdPartyPluginAIContributionGrant,
  ThirdPartyPluginAIContributionRequest,
  ThirdPartyPluginAIContributionReview,
  ThirdPartyPluginAIGrantListener
} from './types'

export const THIRD_PARTY_PLUGIN_AI_GRANT_LIMITS = Object.freeze({
  maxGrants: 1_024,
  maxIssuedGrantIds: 16_384,
  maxGrantIdLength: 128,
  maxListeners: 64
})

function contributionKey(value: ThirdPartyPluginAIContributionRequest): string {
  return `${value.pluginId}\0${value.kind}\0${value.contributionId}`
}

function sameReview(
  left: ThirdPartyPluginAIContributionReview,
  right: ThirdPartyPluginAIContributionReview
): boolean {
  return (
    left.pluginId === right.pluginId &&
    left.kind === right.kind &&
    left.contributionId === right.contributionId &&
    left.adapterId === right.adapterId &&
    left.packageDigest === right.packageDigest &&
    left.pluginVersion === right.pluginVersion &&
    left.publisherId === right.publisherId &&
    left.publisherKeyId === right.publisherKeyId &&
    (left.kind !== 'connector' ||
      (right.kind === 'connector' &&
        left.connectorId === right.connectorId &&
        left.operationId === right.operationId))
  )
}

function cloneReview(
  review: ThirdPartyPluginAIContributionReview
): ThirdPartyPluginAIContributionReview {
  return review.kind === 'connector'
    ? Object.freeze({ ...review, kind: 'connector' as const })
    : Object.freeze({ ...review, kind: 'command' as const })
}

function cloneGrant(
  grant: ThirdPartyPluginAIContributionGrant
): ThirdPartyPluginAIContributionGrant {
  return Object.freeze({
    ...cloneReview(grant),
    grantId: grant.grantId,
    grantedAt: grant.grantedAt
  })
}

function defaultGrantId(): string {
  if (typeof crypto.randomUUID !== 'function') {
    throw new TypeError('Secure random plugin AI grant IDs are unavailable')
  }
  return crypto.randomUUID()
}

function validGrantId(value: string): boolean {
  if (value.length === 0 || value.length > THIRD_PARTY_PLUGIN_AI_GRANT_LIMITS.maxGrantIdLength) {
    return false
  }
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint <= 31 || codePoint === 127) return false
  }
  return true
}

/**
 * Process-local, contribution-scoped third-party AI authorization.
 *
 * Installation and enablement never imply AI authority. Callers review live state, obtain explicit
 * user consent outside this manager, then pass that exact review to grant(). A restart intentionally
 * drops every grant until a durable policy and UI are reviewed separately.
 */
export function createThirdPartyPluginAIGrantManager(
  options: CreateThirdPartyPluginAIGrantManagerOptions
) {
  const policy = options.hostPolicy ?? DEFAULT_THIRD_PARTY_PLUGIN_AI_HOST_POLICY
  const createGrantId = options.createGrantId ?? defaultGrantId
  const now = options.now ?? Date.now
  const maximum = options.maxGrants ?? THIRD_PARTY_PLUGIN_AI_GRANT_LIMITS.maxGrants
  if (
    !Number.isSafeInteger(maximum) ||
    maximum < 1 ||
    maximum > THIRD_PARTY_PLUGIN_AI_GRANT_LIMITS.maxGrants
  ) {
    throw new TypeError(
      `Third-party plugin AI grant limit must be between 1 and ${THIRD_PARTY_PLUGIN_AI_GRANT_LIMITS.maxGrants}`
    )
  }
  const grants = new Map<string, ThirdPartyPluginAIContributionGrant>()
  // Keep process-lifetime tombstones so revoke, clear, and re-grant can never revive an old ticket.
  const issuedGrantIds = new Set<string>()
  const listeners = new ConnectorSnapshotListenerRegistry<
    readonly ThirdPartyPluginAIContributionGrant[]
  >(
    THIRD_PARTY_PLUGIN_AI_GRANT_LIMITS.maxListeners,
    'Third-party plugin AI grant listener limit reached'
  )

  function review(
    request: ThirdPartyPluginAIContributionRequest
  ): ThirdPartyPluginAIContributionReview {
    return reviewThirdPartyPluginAIContribution(
      options.resolveInstalledPlugin(request.pluginId),
      request,
      policy
    )
  }

  function listReviews(pluginId: string): readonly ThirdPartyPluginAIContributionReview[] {
    return listThirdPartyPluginAIContributionReviews(
      options.resolveInstalledPlugin(pluginId),
      policy
    )
  }

  function grant(
    expectedReview: ThirdPartyPluginAIContributionReview
  ): ThirdPartyPluginAIContributionGrant {
    const current = review(expectedReview)
    if (!sameReview(current, expectedReview)) {
      throw new Error('Third-party plugin AI contribution changed after review; review it again')
    }
    const key = contributionKey(current)
    if (!grants.has(key) && grants.size >= maximum) {
      throw new Error(`Third-party plugin AI grant limit reached: ${maximum}`)
    }
    if (issuedGrantIds.size >= THIRD_PARTY_PLUGIN_AI_GRANT_LIMITS.maxIssuedGrantIds) {
      throw new Error('Third-party plugin AI grant ID history limit reached')
    }
    const grantId = createGrantId()
    if (typeof grantId !== 'string' || !validGrantId(grantId)) {
      throw new TypeError('Third-party plugin AI grant ID is invalid')
    }
    if (issuedGrantIds.has(grantId)) {
      throw new Error('Third-party plugin AI grant ID collision')
    }
    const grantedAt = now()
    if (!Number.isFinite(grantedAt) || grantedAt < 0) {
      throw new TypeError('Third-party plugin AI grant time is invalid')
    }
    const next = Object.freeze({ ...cloneReview(current), grantId, grantedAt })
    issuedGrantIds.add(grantId)
    grants.set(key, next)
    listeners.emit(snapshot())
    return cloneGrant(next)
  }

  function requireGrant(
    expectedReview: ThirdPartyPluginAIContributionReview,
    grantId: string
  ): ThirdPartyPluginAIContributionGrant {
    const key = contributionKey(expectedReview)
    let current: ThirdPartyPluginAIContributionReview
    try {
      current = review(expectedReview)
    } catch (cause) {
      if (grants.delete(key)) listeners.emit(snapshot())
      throw cause
    }
    const existing = grants.get(key)
    if (!sameReview(current, expectedReview) || !existing || !sameReview(existing, current)) {
      if (grants.delete(key)) listeners.emit(snapshot())
      throw new Error('Third-party plugin AI grant authority changed; review and grant it again')
    }
    if (existing.grantId !== grantId) {
      throw new Error('Third-party plugin AI grant is unavailable')
    }
    return cloneGrant(existing)
  }

  function revoke(request: ThirdPartyPluginAIContributionRequest): boolean {
    const deleted = grants.delete(contributionKey(request))
    if (deleted) listeners.emit(snapshot())
    return deleted
  }

  function revokePlugin(pluginId: string): readonly string[] {
    const revoked: string[] = []
    for (const [key, value] of grants) {
      if (value.pluginId !== pluginId) continue
      grants.delete(key)
      revoked.push(value.grantId)
    }
    if (revoked.length > 0) listeners.emit(snapshot())
    return Object.freeze(revoked)
  }

  function reconcile(): readonly string[] {
    const revoked: string[] = []
    for (const [key, existing] of grants) {
      try {
        const current = review(existing)
        if (sameReview(current, existing)) continue
      } catch (cause) {
        // Any unavailable, disabled, blocked, changed, or no-longer-reviewed contribution fails closed.
        void cause
      }
      grants.delete(key)
      revoked.push(existing.grantId)
    }
    if (revoked.length > 0) listeners.emit(snapshot())
    return Object.freeze(revoked)
  }

  function snapshot(): readonly ThirdPartyPluginAIContributionGrant[] {
    return Object.freeze(
      [...grants.values()]
        .sort((left, right) => contributionKey(left).localeCompare(contributionKey(right)))
        .map(cloneGrant)
    )
  }

  function subscribe(listener: ThirdPartyPluginAIGrantListener): () => void {
    return listeners.subscribe(listener)
  }

  function clear(): void {
    if (grants.size === 0) return
    grants.clear()
    listeners.emit(snapshot())
  }

  return {
    review,
    listReviews,
    grant,
    requireGrant,
    revoke,
    revokePlugin,
    reconcile,
    snapshot,
    subscribe,
    clear
  }
}
