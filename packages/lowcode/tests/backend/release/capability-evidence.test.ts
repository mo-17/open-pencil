import { describe, expect, test } from 'bun:test'

import {
  deriveBackendApplicationCapabilitiesV2,
  lowerBackendApplicationSpecV1ToV2
} from '#lowcode/backend/application-v2'
import type { BackendApplicationSpecV2 } from '#lowcode/backend/application-v2-types'
import {
  BACKEND_RELEASE_CAPABILITY_EVIDENCE_IDS,
  BACKEND_RELEASE_BACKFILL_CURSOR_VERIFIER_CHECK,
  BACKEND_RELEASE_EVIDENCE_CAPABILITIES,
  BACKEND_RELEASE_WEBHOOK_HMAC_PURPOSE_VERIFIER_CHECK,
  backendReleaseEvidenceVerifierChecksForCapability,
  createBackendReleaseEvidenceReceiptCandidate,
  createBackendReleaseEvidenceSubject,
  deriveBackendReleaseEvidenceRequirements,
  digestBackendReleaseEvidenceAssessment,
  digestBackendReleaseEvidenceSubject,
  evaluateBackendReleaseEvidence,
  parseBackendReleaseEvidenceRecords,
  type BackendReleaseEvidenceRecordV1,
  type BackendReleaseEvidenceBlockerCode,
  type BackendReleaseEvidenceSubjectV1,
  type BackendReleaseEvidenceReceiptCandidateV1,
  type BackendReleaseHostAcceptedEvidenceContextV1,
  type CreateBackendReleaseEvidenceSubjectInput
} from '#lowcode/backend/release/capability-evidence'

import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import { backendApplicationFixture } from '../fixture'

const NOW = '2026-09-04T00:00:00Z'
const EXPIRES = '2026-09-05T00:00:00Z'

async function digest(label: string): Promise<string> {
  return digestCanonicalManifest({ label })
}

function applicationFixture(): BackendApplicationSpecV2 {
  const lowered = lowerBackendApplicationSpecV1ToV2(backendApplicationFixture())
  if (!lowered.ok) throw new Error('Backend V1 fixture must lower to V2')
  const application = structuredClone(lowered.value)
  application.capabilities = deriveBackendApplicationCapabilitiesV2(application).map(
    (capability) => ({ capability, required: true })
  )
  return application
}

async function subjectInput(): Promise<CreateBackendReleaseEvidenceSubjectInput> {
  return {
    authorityDigest: await digest('authority'),
    providerId: 'provider.test',
    environment: 'staging',
    planDigest: await digest('plan'),
    artifactManifestDigest: await digest('artifacts'),
    verifierId: 'open-pencil.host-verifier',
    verifierVersion: '1.0.0'
  }
}

interface EvidenceBundle {
  readonly subject: BackendReleaseEvidenceSubjectV1
  readonly receipts: readonly BackendReleaseEvidenceReceiptCandidateV1[]
  readonly records: readonly BackendReleaseEvidenceRecordV1[]
  readonly context: BackendReleaseHostAcceptedEvidenceContextV1
}

async function evidenceBundle(
  application: BackendApplicationSpecV2,
  options: Readonly<{
    checkedAt?: string
    expiresAt?: string
    firstStatus?: 'passed' | 'failed'
  }> = {}
): Promise<EvidenceBundle> {
  const subject = await createBackendReleaseEvidenceSubject(application, await subjectInput())
  const subjectDigest = await digestBackendReleaseEvidenceSubject(subject)
  const evidenceDigest = await digest('evidence')
  const requirements = deriveBackendReleaseEvidenceRequirements(application)
  const receipts = await Promise.all(
    requirements.map((requirement, index) =>
      createBackendReleaseEvidenceReceiptCandidate({
        requirementId: requirement.requirementId,
        subjectDigest,
        status: index === 0 ? (options.firstStatus ?? 'passed') : 'passed',
        checkedAt: options.checkedAt ?? NOW,
        expiresAt: options.expiresAt ?? EXPIRES,
        evidenceDigest
      })
    )
  )
  const records = receipts.map((receipt) => ({
    requirementId: receipt.requirementId,
    status: receipt.status,
    subjectDigest: receipt.subjectDigest,
    trustedReceiptDigest: receipt.receiptDigest,
    checkedAt: receipt.checkedAt,
    expiresAt: receipt.expiresAt,
    evidenceDigest: receipt.evidenceDigest
  }))
  return {
    subject,
    receipts,
    records,
    context: { expectedSubject: subject, trustedReceipts: receipts, evaluatedAt: NOW }
  }
}

describe('capability-driven Backend release evidence', () => {
  test('maps every V2 capability and derives requirements from actual IR only', () => {
    expect(Object.keys(BACKEND_RELEASE_CAPABILITY_EVIDENCE_IDS).sort()).toEqual([
      ...BACKEND_RELEASE_EVIDENCE_CAPABILITIES
    ])

    const application = applicationFixture()
    application.capabilities.push({ capability: 'jobs.schedule', required: true })
    const requirements = deriveBackendReleaseEvidenceRequirements(application)
    for (const capability of deriveBackendApplicationCapabilitiesV2(application)) {
      const requirementId = BACKEND_RELEASE_CAPABILITY_EVIDENCE_IDS[capability]
      expect(requirements).toContainEqual({
        requirementId,
        source: 'capability',
        capability,
        verifierChecks: [
          requirementId,
          ...(capability === 'webhooks.receive' || capability === 'webhooks.deliver'
            ? [BACKEND_RELEASE_WEBHOOK_HMAC_PURPOSE_VERIFIER_CHECK]
            : []),
          ...(capability === 'migrations.backfill'
            ? [BACKEND_RELEASE_BACKFILL_CURSOR_VERIFIER_CHECK]
            : [])
        ]
      })
    }
    expect(requirements.some((entry) => entry.capability === 'jobs.schedule')).toBe(false)
  })

  test('fails closed when actual IR use is underdeclared or marked optional', () => {
    const missing = applicationFixture()
    missing.realtime.subscriptions.push({
      id: 'notes-live',
      entityId: 'notes',
      events: ['insert'],
      principal: { kind: 'owner', ownershipId: 'note-owner' },
      delivery: { kind: 'invalidate-query', queryKey: 'notes' }
    })
    expect(() => deriveBackendReleaseEvidenceRequirements(missing)).toThrow(
      'backend-capability-use-undeclared'
    )

    const optional = structuredClone(missing)
    optional.capabilities.push({ capability: 'realtime.subscribe', required: false })
    expect(() => deriveBackendReleaseEvidenceRequirements(optional)).toThrow(
      'backend-capability-use-not-required'
    )
  })

  test('derives data-change event evidence and explicit webhook HMAC-purpose checks', () => {
    const application = applicationFixture()
    application.automations.queues.push({
      id: 'events',
      name: 'Events',
      visibility: 'private',
      delivery: 'at-least-once',
      maxPayloadBytes: 65_536,
      visibilityTimeoutSeconds: 60,
      retentionSeconds: 86_400
    })
    application.automations.automations.push({
      id: 'note-change',
      name: 'Note change',
      subject: 'system',
      trigger: { kind: 'data-change', entityId: 'notes', events: ['insert'] },
      action: { kind: 'queue.publish', queueId: 'events', payloadExpression: 'input' },
      retry: {
        maxAttempts: 1,
        initialDelayMs: 1_000,
        maxDelayMs: 1_000,
        backoff: 'fixed',
        jitter: 'none'
      },
      idempotency: {
        kind: 'data-field',
        entityId: 'notes',
        fieldId: 'id',
        retentionHours: 24
      },
      causation: { kind: 'required', idField: 'causationId', maxHop: 8 }
    })
    application.capabilities = deriveBackendApplicationCapabilitiesV2(application).map(
      (capability) => ({ capability, required: true })
    )

    expect(deriveBackendReleaseEvidenceRequirements(application)).toContainEqual({
      requirementId: 'data-change-events-verified',
      source: 'capability',
      capability: 'events.data-change',
      verifierChecks: ['data-change-events-verified']
    })
    for (const capability of ['webhooks.receive', 'webhooks.deliver'] as const) {
      expect(backendReleaseEvidenceVerifierChecksForCapability(capability)).toEqual([
        BACKEND_RELEASE_CAPABILITY_EVIDENCE_IDS[capability],
        BACKEND_RELEASE_WEBHOOK_HMAC_PURPOSE_VERIFIER_CHECK
      ])
    }
    expect(backendReleaseEvidenceVerifierChecksForCapability('migrations.backfill')).toEqual([
      'data-backfill-verified',
      BACKEND_RELEASE_BACKFILL_CURSOR_VERIFIER_CHECK
    ])
  })

  test('requires exact structured Host receipts before releaseReady', async () => {
    const application = applicationFixture()
    const bundle = await evidenceBundle(application)
    const assessment = await evaluateBackendReleaseEvidence(
      application,
      bundle.records,
      bundle.context
    )

    expect(assessment).toMatchObject({
      format: 'openpencil.backend-release-evidence',
      version: 1,
      expectedSubject: bundle.subject,
      evaluatedAt: NOW,
      releaseReady: true,
      blockers: []
    })
    expect(
      await digestBackendReleaseEvidenceAssessment(application, bundle.records, bundle.context)
    ).toMatch(/^[A-Za-z0-9_-]{43}$/u)
  })

  test('blocks one trusted receipt replayed across every requirement', async () => {
    const application = applicationFixture()
    const bundle = await evidenceBundle(application)
    const firstReceipt = bundle.receipts[0]
    if (!firstReceipt) throw new Error('Receipt fixture is required')
    const replayed = bundle.records.map((record) => ({
      ...record,
      trustedReceiptDigest: firstReceipt.receiptDigest
    }))

    const assessment = await evaluateBackendReleaseEvidence(application, replayed, bundle.context)
    expect(assessment.releaseReady).toBe(false)
    expect(assessment.blockers.map((entry) => entry.code)).toContain(
      'release-evidence-receipt-mismatch'
    )
  })

  test('blocks caller-only receipt digests and any record claim not bound by its receipt', async () => {
    const application = applicationFixture()
    const bundle = await evidenceBundle(application)
    const arbitraryDigest = await digest('attacker-controlled')
    const attacks: Array<{
      patch: Partial<BackendReleaseEvidenceRecordV1>
      code: BackendReleaseEvidenceBlockerCode
    }> = [
      {
        patch: { trustedReceiptDigest: arbitraryDigest },
        code: 'release-evidence-receipt-untrusted'
      },
      {
        patch: { evidenceDigest: arbitraryDigest },
        code: 'release-evidence-receipt-mismatch'
      },
      {
        patch: { status: 'failed' },
        code: 'release-evidence-receipt-mismatch'
      }
    ]
    for (const attack of attacks) {
      const forged = bundle.records.map((record, index) =>
        index === 0 ? { ...record, ...attack.patch } : record
      )
      const assessment = await evaluateBackendReleaseEvidence(application, forged, bundle.context)
      expect(assessment.releaseReady).toBe(false)
      expect(assessment.blockers.map((entry) => entry.code)).toContain(attack.code)
    }
  })

  test('blocks future, expired, and exactly-expired trusted receipts using Host time', async () => {
    const application = applicationFixture()
    for (const options of [
      { checkedAt: '2026-09-04T00:00:00.000000001Z', expiresAt: EXPIRES },
      { checkedAt: '2026-09-04T00:00:01Z', expiresAt: EXPIRES },
      { checkedAt: '2026-09-02T00:00:00Z', expiresAt: '2026-09-03T00:00:00Z' },
      { checkedAt: '2026-09-03T00:00:00Z', expiresAt: NOW }
    ]) {
      const bundle = await evidenceBundle(application, options)
      const assessment = await evaluateBackendReleaseEvidence(
        application,
        bundle.records,
        bundle.context
      )
      expect(assessment.releaseReady).toBe(false)
    }
  })

  test('changing any structured subject dimension rejects prior receipts', async () => {
    const application = applicationFixture()
    const bundle = await evidenceBundle(application)
    const changes: Partial<BackendReleaseEvidenceSubjectV1>[] = [
      { applicationDigest: await digest('other-application') },
      { authorityDigest: await digest('other-authority') },
      { providerId: 'provider.other' },
      { environment: 'production' },
      { planDigest: await digest('other-plan') },
      { artifactManifestDigest: await digest('other-artifacts') },
      { verifierId: 'other.verifier' },
      { verifierVersion: '2.0.0' }
    ]
    for (const change of changes) {
      const changedContext = {
        ...bundle.context,
        expectedSubject: { ...bundle.subject, ...change }
      }
      await expect(
        evaluateBackendReleaseEvidence(application, bundle.records, changedContext)
      ).rejects.toThrow('receipt for a different release subject')
    }
  })

  test('missing and authentically failed evidence remain blocked', async () => {
    const application = applicationFixture()
    const bundle = await evidenceBundle(application, { firstStatus: 'failed' })
    const missingAssessment = await evaluateBackendReleaseEvidence(
      application,
      bundle.records.slice(1),
      bundle.context
    )
    expect(missingAssessment.releaseReady).toBe(false)
    expect(missingAssessment.blockers.map((entry) => entry.code)).toContain(
      'release-evidence-missing'
    )

    const failedAssessment = await evaluateBackendReleaseEvidence(
      application,
      bundle.records,
      bundle.context
    )
    expect(failedAssessment.releaseReady).toBe(false)
    expect(failedAssessment.blockers.map((entry) => entry.code)).toContain(
      'release-evidence-failed'
    )
  })

  test('rejects receipts beyond the bounded 24-hour evidence lifetime', async () => {
    const application = applicationFixture()
    const subject = await createBackendReleaseEvidenceSubject(application, await subjectInput())
    await expect(
      createBackendReleaseEvidenceReceiptCandidate({
        requirementId: 'provider-authority-valid',
        subjectDigest: await digestBackendReleaseEvidenceSubject(subject),
        status: 'passed',
        checkedAt: NOW,
        expiresAt: '2026-09-05T00:00:00.001Z',
        evidenceDigest: await digest('evidence')
      })
    ).rejects.toThrow('maximum evidence TTL')
  })

  test('rejects Host receipt context outside the exact actual-IR evidence surface', async () => {
    const application = applicationFixture()
    const bundle = await evidenceBundle(application)
    const requiredIds = new Set(bundle.records.map((entry) => entry.requirementId))
    const extraRequirementId = Object.values(BACKEND_RELEASE_CAPABILITY_EVIDENCE_IDS).find(
      (requirementId) => !requiredIds.has(requirementId)
    )
    if (!extraRequirementId) throw new Error('Fixture must leave one capability unused')
    const extraReceipt = await createBackendReleaseEvidenceReceiptCandidate({
      requirementId: extraRequirementId,
      subjectDigest: await digestBackendReleaseEvidenceSubject(bundle.subject),
      status: 'passed',
      checkedAt: NOW,
      expiresAt: EXPIRES,
      evidenceDigest: await digest('extra-evidence')
    })

    await expect(
      evaluateBackendReleaseEvidence(application, bundle.records, {
        ...bundle.context,
        trustedReceipts: [...bundle.receipts, extraReceipt]
      })
    ).rejects.toThrow('outside actual Backend IR requirements')
  })

  test('rejects a trusted receipt for another subject even without a supplied record', async () => {
    const application = applicationFixture()
    const bundle = await evidenceBundle(application)
    const firstReceipt = bundle.receipts[0]
    if (!firstReceipt) throw new Error('Receipt fixture is required')
    const changedSubject = {
      ...bundle.subject,
      planDigest: await digest('other-plan')
    }
    const mismatchedReceipt = await createBackendReleaseEvidenceReceiptCandidate({
      requirementId: firstReceipt.requirementId,
      subjectDigest: await digestBackendReleaseEvidenceSubject(changedSubject),
      status: firstReceipt.status,
      checkedAt: firstReceipt.checkedAt,
      expiresAt: firstReceipt.expiresAt,
      evidenceDigest: firstReceipt.evidenceDigest
    })

    await expect(
      evaluateBackendReleaseEvidence(application, [], {
        ...bundle.context,
        trustedReceipts: [mismatchedReceipt, ...bundle.receipts.slice(1)]
      })
    ).rejects.toThrow('receipt for a different release subject')
  })

  test('strictly rejects payload fields and tampered trusted receipt digests', async () => {
    const application = applicationFixture()
    const bundle = await evidenceBundle(application)
    const first = bundle.records[0]
    const firstReceipt = bundle.receipts[0]
    if (!first || !firstReceipt) throw new Error('Evidence fixture is required')

    expect(() => parseBackendReleaseEvidenceRecords([{ ...first, payload: { rows: [] } }])).toThrow(
      'unsupported fields'
    )
    await expect(
      evaluateBackendReleaseEvidence(application, bundle.records, {
        ...bundle.context,
        trustedReceipts: [{ ...firstReceipt, status: 'failed' }]
      })
    ).rejects.toThrow('does not bind the receipt claims')
  })

  test('rejects accessor-backed trusted context without invoking accessors', async () => {
    const application = applicationFixture()
    const bundle = await evidenceBundle(application)
    let getterCalls = 0
    const trustedContext: BackendReleaseHostAcceptedEvidenceContextV1 = { ...bundle.context }
    Object.defineProperty(trustedContext, 'expectedSubject', {
      enumerable: true,
      get() {
        getterCalls += 1
        return bundle.subject
      }
    })
    await expect(
      evaluateBackendReleaseEvidence(application, bundle.records, trustedContext)
    ).rejects.toThrow('enumerable data property values only')
    expect(getterCalls).toBe(0)
  })
})
