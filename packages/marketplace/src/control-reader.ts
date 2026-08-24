import {
  MARKETPLACE_CONTROL_SCHEMA_VERSION,
  MARKETPLACE_OPERATOR_KEY_EXPIRY_WINDOW_MS,
  MARKETPLACE_OPERATOR_RECENT_LIMIT,
  MarketplaceControlStaleCursorError,
  toMarketplaceControlAuditEvent,
  toMarketplaceControlPublisherKey,
  toMarketplaceControlRelease,
  toMarketplaceControlSubmission,
  toMarketplaceControlSubmissionSummary,
  type MarketplaceControlAuditEventV1,
  type MarketplaceControlOwnershipV1,
  type MarketplaceControlPublicationV1,
  type MarketplaceControlPublisherKeyV1,
  type MarketplaceControlPublisherV1,
  type MarketplaceControlReleaseV1,
  type MarketplaceControlSubmissionDetailV1,
  type MarketplaceControlSubmissionSummaryV1,
  type MarketplaceControlSummaryV1,
  type MarketplaceOperatorAuditAccess,
  type MarketplaceOperatorOverviewV1
} from './control-contract'
import type { MarketplaceRepository } from './repository'
import { marketplaceReleaseCoordinateKey } from './types'
import type {
  MarketplaceAuditAction,
  MarketplaceAuditEventV1,
  MarketplaceOwnershipStatus,
  MarketplacePublisherKeyStatus,
  MarketplacePublisherStatus,
  MarketplaceReleaseChannel,
  MarketplaceReleaseCoordinateV1,
  MarketplaceStateV1,
  MarketplaceSubmissionStatus
} from './types'

export interface MarketplaceControlSlice<Item> {
  readonly items: readonly Item[]
  readonly nextAfter: string | null
  readonly stateToken: string
}

export interface MarketplaceControlReadPage {
  readonly limit: number
  readonly after?: string
  readonly expectedStateToken?: string
}

export interface MarketplaceControlReader {
  stateToken(): Promise<string>
  publisher(publisherId: string): Promise<MarketplaceControlPublisherV1 | null>
  publisherKey(keyId: string): Promise<MarketplaceControlPublisherKeyV1 | null>
  ownership(pluginId: string): Promise<MarketplaceControlOwnershipV1 | null>
  submission(
    submissionId: string,
    publisherId?: string
  ): Promise<MarketplaceControlSubmissionDetailV1 | null>
  release(coordinate: MarketplaceReleaseCoordinateV1): Promise<MarketplaceControlReleaseV1 | null>
  publication(sequence: number): Promise<MarketplaceControlPublicationV1 | null>
  auditEvent(sequence: number): Promise<MarketplaceControlAuditEventV1 | null>
  publishers(
    query: MarketplaceControlReadPage & { status?: MarketplacePublisherStatus }
  ): Promise<MarketplaceControlSlice<MarketplaceControlPublisherV1>>
  publisherKeys(
    query: MarketplaceControlReadPage & {
      publisherId?: string
      status?: MarketplacePublisherKeyStatus
    }
  ): Promise<MarketplaceControlSlice<MarketplaceControlPublisherKeyV1>>
  ownerships(
    query: MarketplaceControlReadPage & {
      publisherId?: string
      status?: MarketplaceOwnershipStatus
    }
  ): Promise<MarketplaceControlSlice<MarketplaceControlOwnershipV1>>
  submissions(
    query: MarketplaceControlReadPage & {
      publisherId?: string
      status?: MarketplaceSubmissionStatus
      channel?: MarketplaceReleaseChannel
      pluginId?: string
    }
  ): Promise<MarketplaceControlSlice<MarketplaceControlSubmissionSummaryV1>>
  releases(
    query: MarketplaceControlReadPage & {
      publisherId?: string
      channel?: MarketplaceReleaseChannel
      pluginId?: string
    }
  ): Promise<MarketplaceControlSlice<MarketplaceControlReleaseV1>>
  publications(
    query: MarketplaceControlReadPage
  ): Promise<MarketplaceControlSlice<MarketplaceControlPublicationV1>>
  audit(
    query: MarketplaceControlReadPage & { action?: MarketplaceAuditAction; actor?: string }
  ): Promise<MarketplaceControlSlice<MarketplaceControlAuditEventV1>>
  publisherAudit(
    publisherId: string,
    query: MarketplaceControlReadPage & { action?: MarketplaceAuditAction }
  ): Promise<MarketplaceControlSlice<MarketplaceAuditEventV1>>
  summary(): Promise<MarketplaceControlSummaryV1>
  overview(auditAccess: MarketplaceOperatorAuditAccess): Promise<MarketplaceOperatorOverviewV1>
}

function stateToken(state: MarketplaceStateV1): string {
  return `${state.auditEvents.length}:${state.auditEvents.at(-1)?.eventHash ?? 'empty'}`
}

function assertExpectedState(state: MarketplaceStateV1, expected: string | undefined): string {
  const token = stateToken(state)
  if (expected !== undefined && token !== expected) throw new MarketplaceControlStaleCursorError()
  return token
}

function compareText(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function slice<Item>(
  state: MarketplaceStateV1,
  entries: readonly { key: string; item: Item }[],
  query: MarketplaceControlReadPage
): MarketplaceControlSlice<Item> {
  if (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 100) {
    throw new TypeError('Marketplace control read limit must be between 1 and 100')
  }
  const token = assertExpectedState(state, query.expectedStateToken)
  const candidates = query.after
    ? entries.filter(({ key }) => compareText(key, query.after as string) > 0)
    : entries
  const selected = candidates.slice(0, query.limit)
  return Object.freeze({
    items: Object.freeze(selected.map(({ item }) => item)),
    nextAfter: candidates.length > selected.length ? (selected.at(-1)?.key ?? null) : null,
    stateToken: token
  })
}

function publisherAuditSubjects(
  state: MarketplaceStateV1,
  publisherId: string
): ReadonlySet<string> {
  const subjects = new Set<string>([`publisher:${publisherId}`])
  for (const key of state.publisherKeys) {
    if (key.publisherId === publisherId) subjects.add(`publisher-key:${key.keyId}`)
  }
  for (const ownership of state.ownerships) {
    if (ownership.publisherId === publisherId) subjects.add(`ownership:${ownership.pluginId}`)
  }
  for (const submission of state.submissions) {
    if (submission.publisherId === publisherId) subjects.add(`submission:${submission.id}`)
  }
  for (const release of state.releases) {
    if (release.publisherId === publisherId) {
      subjects.add(`release:${marketplaceReleaseCoordinateKey(release.coordinate)}`)
    }
  }
  return subjects
}

function controlAuditEvent(
  state: MarketplaceStateV1,
  sequence: number
): MarketplaceControlAuditEventV1 | null {
  const event = state.auditEvents.find((candidate) => candidate.sequence === sequence)
  if (!event) return null
  const context = state.auditContexts.find((candidate) => candidate.sequence === sequence) ?? null
  return toMarketplaceControlAuditEvent(event, context)
}

function requiredControlAuditEvent(
  state: MarketplaceStateV1,
  sequence: number
): MarketplaceControlAuditEventV1 {
  const event = controlAuditEvent(state, sequence)
  if (!event) throw new TypeError(`Marketplace audit event ${sequence} is unavailable`)
  return event
}

export function createMarketplaceControlReader(
  repository: MarketplaceRepository,
  now: () => Date = () => new Date()
): MarketplaceControlReader {
  const snapshot = () => repository.snapshot()
  return {
    async stateToken() {
      return stateToken(await snapshot())
    },
    async publisher(publisherId) {
      return (await snapshot()).publishers.find(({ id }) => id === publisherId) ?? null
    },
    async publisherKey(keyId) {
      const key = (await snapshot()).publisherKeys.find((candidate) => candidate.keyId === keyId)
      return key ? toMarketplaceControlPublisherKey(key) : null
    },
    async ownership(pluginId) {
      return (
        (await snapshot()).ownerships.find((candidate) => candidate.pluginId === pluginId) ?? null
      )
    },
    async submission(submissionId, publisherId) {
      const value = (await snapshot()).submissions.find(
        (candidate) =>
          candidate.id === submissionId &&
          (publisherId === undefined || candidate.publisherId === publisherId)
      )
      return value ? toMarketplaceControlSubmission(value) : null
    },
    async release(coordinate) {
      const value = (await snapshot()).releases.find(
        (candidate) =>
          candidate.coordinate.pluginId === coordinate.pluginId &&
          candidate.coordinate.version === coordinate.version &&
          candidate.coordinate.channel === coordinate.channel
      )
      return value ? toMarketplaceControlRelease(value) : null
    },
    async publication(sequence) {
      return (
        (await snapshot()).publications.find((candidate) => candidate.sequence === sequence) ?? null
      )
    },
    async auditEvent(sequence) {
      return controlAuditEvent(await snapshot(), sequence)
    },
    async publishers(query) {
      const state = await snapshot()
      const entries = state.publishers
        .filter(({ status }) => query.status === undefined || status === query.status)
        .map((item) => ({ key: `${item.createdAt}|${item.id}`, item }))
        .sort((left, right) => compareText(left.key, right.key))
      return slice(state, entries, query)
    },
    async publisherKeys(query) {
      const state = await snapshot()
      const entries = state.publisherKeys
        .filter(
          ({ publisherId, status }) =>
            (query.publisherId === undefined || publisherId === query.publisherId) &&
            (query.status === undefined || status === query.status)
        )
        .map((key) => ({
          key: `${key.createdAt}|${key.keyId}`,
          item: toMarketplaceControlPublisherKey(key)
        }))
        .sort((left, right) => compareText(left.key, right.key))
      return slice(state, entries, query)
    },
    async ownerships(query) {
      const state = await snapshot()
      const entries = state.ownerships
        .filter(
          ({ publisherId, status }) =>
            (query.publisherId === undefined || publisherId === query.publisherId) &&
            (query.status === undefined || status === query.status)
        )
        .map((item) => ({ key: `${item.requestedAt}|${item.pluginId}`, item }))
        .sort((left, right) => compareText(left.key, right.key))
      return slice(state, entries, query)
    },
    async submissions(query) {
      const state = await snapshot()
      const entries = state.submissions
        .filter(
          (submission) =>
            (query.publisherId === undefined || submission.publisherId === query.publisherId) &&
            (query.status === undefined || submission.status === query.status) &&
            (query.channel === undefined || submission.coordinate.channel === query.channel) &&
            (query.pluginId === undefined || submission.coordinate.pluginId === query.pluginId)
        )
        .map((submission) => ({
          key: `${submission.submittedAt}|${submission.id}`,
          item: toMarketplaceControlSubmissionSummary(submission)
        }))
        .sort((left, right) => compareText(left.key, right.key))
      return slice(state, entries, query)
    },
    async releases(query) {
      const state = await snapshot()
      const entries = state.releases
        .filter(
          (release) =>
            (query.publisherId === undefined || release.publisherId === query.publisherId) &&
            (query.channel === undefined || release.coordinate.channel === query.channel) &&
            (query.pluginId === undefined || release.coordinate.pluginId === query.pluginId)
        )
        .map((release) => ({
          key: `${release.publishedAt}|${release.coordinate.pluginId}|${release.coordinate.version}|${release.coordinate.channel}`,
          item: toMarketplaceControlRelease(release)
        }))
        .sort((left, right) => compareText(left.key, right.key))
      return slice(state, entries, query)
    },
    async publications(query) {
      const state = await snapshot()
      const entries = state.publications.map((item) => ({
        key: String(item.sequence).padStart(16, '0'),
        item
      }))
      return slice(state, entries, query)
    },
    async audit(query) {
      const state = await snapshot()
      const entries = state.auditEvents
        .filter(
          ({ action, actor }) =>
            (query.action === undefined || action === query.action) &&
            (query.actor === undefined || actor === query.actor)
        )
        .map((event) => ({
          key: String(event.sequence).padStart(16, '0'),
          item: requiredControlAuditEvent(state, event.sequence)
        }))
      return slice(state, entries, query)
    },
    async publisherAudit(publisherId, query) {
      const state = await snapshot()
      if (!state.publishers.some(({ id }) => id === publisherId)) {
        return slice(state, [], query)
      }
      const subjects = publisherAuditSubjects(state, publisherId)
      const entries = state.auditEvents
        .filter(
          (event) =>
            (query.action === undefined || event.action === query.action) &&
            subjects.has(event.subject)
        )
        .map((event) => ({
          key: String(event.sequence).padStart(16, '0'),
          item: event
        }))
      return slice(state, entries, query)
    },
    async summary() {
      const state = await snapshot()
      return Object.freeze({
        schemaVersion: MARKETPLACE_CONTROL_SCHEMA_VERSION,
        publishers: state.publishers.length,
        publisherKeys: state.publisherKeys.length,
        ownerships: state.ownerships.length,
        submissions: state.submissions.length,
        releases: state.releases.length,
        publications: state.publications.length,
        auditEvents: state.auditEvents.length
      })
    },
    async overview(auditAccess) {
      const state = await snapshot()
      const generated = now()
      if (!(generated instanceof Date) || !Number.isFinite(generated.getTime())) {
        throw new TypeError('Marketplace operator overview server time is invalid')
      }
      const generatedAt = generated.toISOString()
      const generatedMilliseconds = generated.getTime()
      const thresholdMilliseconds =
        generatedMilliseconds + MARKETPLACE_OPERATOR_KEY_EXPIRY_WINDOW_MS
      const recentPublications = Object.freeze(
        state.publications.slice(-MARKETPLACE_OPERATOR_RECENT_LIMIT).reverse()
      )
      const recentAudit =
        auditAccess === 'restricted'
          ? Object.freeze([])
          : Object.freeze(
              state.auditEvents
                .slice(-MARKETPLACE_OPERATOR_RECENT_LIMIT)
                .reverse()
                .map((event) => requiredControlAuditEvent(state, event.sequence))
            )
      return Object.freeze({
        schemaVersion: MARKETPLACE_CONTROL_SCHEMA_VERSION,
        source: 'marketplace',
        generatedAt,
        keyExpiryThresholdAt: new Date(thresholdMilliseconds).toISOString(),
        pending: Object.freeze({
          publishers: state.publishers.filter(({ status }) => status === 'pending').length,
          publisherKeys: state.publisherKeys.filter(({ status }) => status === 'pending').length,
          ownerships: state.ownerships.filter(({ status }) => status === 'requested').length,
          submissions: state.submissions.filter(({ status }) => status === 'awaiting_review').length
        }),
        risk: Object.freeze({
          suspendedPublishers: state.publishers.filter(({ status }) => status === 'suspended')
            .length,
          revokedPublisherKeys: state.publisherKeys.filter(({ status }) => status === 'revoked')
            .length,
          expiringPublisherKeys: state.publisherKeys.filter((key) => {
            const notAfter = Date.parse(key.notAfter)
            return (
              key.status === 'active' &&
              notAfter > generatedMilliseconds &&
              notAfter <= thresholdMilliseconds
            )
          }).length,
          yankedReleases: state.releases.filter(({ yankedAt }) => yankedAt !== null).length
        }),
        recentPublications,
        auditAccess,
        recentAudit,
        auditChain: Object.freeze({
          status: 'valid',
          verifiedThroughSequence: state.auditEvents.length,
          head: state.auditEvents.at(-1)?.eventHash ?? null,
          verificationSource: 'marketplace'
        })
      })
    }
  }
}
