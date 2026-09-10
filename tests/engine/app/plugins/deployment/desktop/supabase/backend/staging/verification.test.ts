import { describe, expect, test } from 'bun:test'

import { indexedDB as fakeIndexedDB } from 'fake-indexeddb'

import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  createIdbBackendHostReleaseDispatchJournal,
  createMemoryBackendHostReleaseDispatchJournal,
  type BackendHostReleaseDispatchJournal
} from '@/app/plugins/host/deployment/backend/release-journal'
import {
  createDesktopSupabaseBackendStagingVerificationService,
  type DesktopSupabaseStrictStagingVerificationInput
} from '@/app/plugins/host/deployment/desktop/supabase/backend/staging/verification'

import {
  ACCOUNT_ID,
  BUILD,
  GRANT_GENERATION,
  NOW,
  PROJECT_REF,
  PROJECT_URL,
  PUBLISHABLE_KEY,
  READ_PAT,
  VUE_BUILD,
  WRITE_PAT,
  dependencies,
  errorCode,
  mutationProgress,
  previousReview,
  strictResult,
  verificationInput
} from './verification/helpers'

describe('Desktop Supabase staging capability verification authority', () => {
  test.each([
    { field: 'artifact', kind: 'missing' },
    { field: 'artifact', kind: 'null' },
    { field: 'manifest', kind: 'missing' },
    { field: 'manifest', kind: 'null' }
  ] as const)('rejects a $kind review $field before any capability is used', async (item) => {
    const reviewed = structuredClone(await previousReview())
    const container = item.field === 'artifact' ? reviewed : reviewed.artifact
    if (item.kind === 'missing') Reflect.deleteProperty(container, item.field)
    else Reflect.set(container, item.field, null)
    const capabilities: string[] = []
    const journal = createMemoryBackendHostReleaseDispatchJournal()
    const service = createDesktopSupabaseBackendStagingVerificationService(
      dependencies({
        prepareBuild() {
          capabilities.push('build')
          return BUILD
        },
        async resolveGrantGeneration() {
          capabilities.push('grant')
          return GRANT_GENERATION
        },
        async resolveReadCredential() {
          capabilities.push('read-credential')
          return READ_PAT
        },
        async resolveWriteCredential() {
          capabilities.push('write-credential')
          return WRITE_PAT
        },
        async prepareStrictVerification(input) {
          capabilities.push('strict-verification')
          return strictResult(input)
        },
        dispatchJournal: {
          ...journal,
          claim(input) {
            capabilities.push('claim')
            return journal.claim(input)
          }
        }
      })
    )

    expect(await errorCode(service.verify(verificationInput(reviewed)))).toBe('review-stale')
    expect(capabilities).toEqual([])
    expect(await journal.listUnresolved()).toEqual([])
  })

  test.each(['react', 'vue'] as const)(
    'binds %s verification and local revalidation to the snapshotted compiler target',
    async (target) => {
      const build = target === 'vue' ? VUE_BUILD : BUILD
      const reviewed = await previousReview(build)
      const targets: unknown[] = []
      const service = createDesktopSupabaseBackendStagingVerificationService(
        dependencies({
          prepareBuild(_graph, requestedTarget) {
            targets.push(requestedTarget)
            Reflect.set(reviewed.artifact.manifest, 'target', 'flutter')
            return build
          },
          async prepareStrictVerification(input) {
            expect(input.expectedReview.artifact.manifest.target).toBe(target)
            expect(input.build.plan.target).toBe(target)
            expect(input.build.emission.manifest.target).toBe(target)
            await input.revalidateLocalAuthority()
            return strictResult(input)
          }
        })
      )

      await expect(service.verify(verificationInput(reviewed))).resolves.toBeDefined()
      expect(targets).toEqual([target, target])
    }
  )

  test.each([
    { label: 'missing', target: null },
    { label: 'unknown', target: 'flutter' },
    { label: 'cross-target with recomputed digest', target: 'vue' }
  ])('rejects a $label review target before credentials and strict verification', async (item) => {
    const reviewed = await previousReview()
    const manifest = { ...reviewed.artifact.manifest }
    if (item.target === null) Reflect.deleteProperty(manifest, 'target')
    else Reflect.set(manifest, 'target', item.target)
    const changedReview = {
      ...reviewed,
      artifact: {
        ...reviewed.artifact,
        manifest,
        manifestDigest: await digestCanonicalManifest(manifest)
      }
    }
    const capabilities: string[] = []
    const service = createDesktopSupabaseBackendStagingVerificationService(
      dependencies({
        prepareBuild: (_graph, target) => (target === 'vue' ? VUE_BUILD : BUILD),
        async resolveReadCredential() {
          capabilities.push('read-credential')
          return READ_PAT
        },
        async resolveWriteCredential() {
          capabilities.push('write-credential')
          return WRITE_PAT
        },
        async prepareStrictVerification(input) {
          capabilities.push('strict-verification')
          return strictResult(input)
        }
      })
    )

    expect(await errorCode(service.verify(verificationInput(changedReview)))).toBe('review-stale')
    expect(capabilities).toEqual([])
  })

  test.each(['plan', 'emission'] as const)(
    'rejects a mismatched %s target even when its stored digests are unchanged',
    async (part) => {
      const reviewed = await previousReview(VUE_BUILD)
      const build = {
        ...VUE_BUILD,
        ...(part === 'plan'
          ? { plan: { ...VUE_BUILD.plan, target: 'react' as const } }
          : {
              emission: {
                ...VUE_BUILD.emission,
                manifest: { ...VUE_BUILD.emission.manifest, target: 'react' as const }
              }
            })
      }
      const capabilities: string[] = []
      const service = createDesktopSupabaseBackendStagingVerificationService(
        dependencies({
          prepareBuild: () => build,
          async resolveGrantGeneration() {
            capabilities.push('grant')
            return GRANT_GENERATION
          },
          async prepareStrictVerification(input) {
            capabilities.push('strict-verification')
            return strictResult(input)
          }
        })
      )

      expect(await errorCode(service.verify(verificationInput(reviewed)))).toBe('review-stale')
      expect(capabilities).toEqual([])
    }
  )

  test.each(['plan', 'emission'] as const)(
    'rejects %s target drift during revalidation before a mutation claim',
    async (part) => {
      const reviewed = await previousReview(VUE_BUILD)
      const targets: unknown[] = []
      let afterRevalidation = false
      const service = createDesktopSupabaseBackendStagingVerificationService(
        dependencies({
          prepareBuild(_graph, target) {
            targets.push(target)
            if (targets.length === 1) return VUE_BUILD
            return {
              ...VUE_BUILD,
              ...(part === 'plan'
                ? { plan: { ...VUE_BUILD.plan, target: 'react' as const } }
                : {
                    emission: {
                      ...VUE_BUILD.emission,
                      manifest: { ...VUE_BUILD.emission.manifest, target: 'react' as const }
                    }
                  })
            }
          },
          async prepareStrictVerification(input) {
            await input.revalidateLocalAuthority()
            afterRevalidation = true
            return strictResult(input)
          }
        })
      )

      expect(await errorCode(service.verify(verificationInput(reviewed)))).toBe('review-stale')
      expect(targets).toEqual(['vue', 'vue'])
      expect(afterRevalidation).toBe(false)
    }
  )

  test('passes only exact review, staging binding, credentials, and result receipt authority', async () => {
    const reviewed = await previousReview()
    let strictInput: DesktopSupabaseStrictStagingVerificationInput | undefined
    const service = createDesktopSupabaseBackendStagingVerificationService(
      dependencies({
        async prepareStrictVerification(input) {
          strictInput = input
          await input.revalidateLocalAuthority()
          return strictResult(input)
        }
      })
    )

    const result = await service.verify(verificationInput(reviewed))

    expect(result.receipt.verificationId).toBe('verification-1')
    expect(result.receipt.reviewedArtifactDigest).toBe(reviewed.artifact.manifestDigest)
    expect(result.productionReleaseReady).toBe(false)
    expect(strictInput?.publishableKey).toBe(PUBLISHABLE_KEY)
    expect(strictInput?.edgeUserAccessToken).toBe('edge_user_access_token_1234567890')
    expect(strictInput?.storageUserA?.userId).toBe('user-a')
  })

  test('uses native-vault read credential status without resolving the PAT into the renderer', async () => {
    const reviewed = await previousReview()
    let capturedCredential: string | null | undefined
    const service = createDesktopSupabaseBackendStagingVerificationService(
      dependencies({
        resolveReadCredential: undefined,
        resolveReadCredentialStatus: async () => 'configured',
        async prepareStrictVerification(input) {
          capturedCredential = input.readPersonalAccessToken
          return strictResult(input)
        }
      })
    )

    await expect(service.verify(verificationInput(reviewed))).resolves.toBeDefined()
    expect(capturedCredential).toBeNull()
  })

  test('rejects a stale review before resolving credentials or invoking strict verification', async () => {
    const reviewed = await previousReview()
    let credentialReads = 0
    let strictCalls = 0
    const service = createDesktopSupabaseBackendStagingVerificationService(
      dependencies({
        resolveReadCredential: async () => {
          credentialReads += 1
          return READ_PAT
        },
        async prepareStrictVerification(input) {
          strictCalls += 1
          return strictResult(input)
        }
      })
    )
    const stale = {
      ...reviewed,
      artifact: { ...reviewed.artifact, manifestDigest: 'A'.repeat(43) }
    }

    expect(await errorCode(service.verify(verificationInput(stale)))).toBe('review-stale')
    expect(credentialReads).toBe(0)
    expect(strictCalls).toBe(0)
  })

  test('fails closed for target, grant, and independent write-token gates', async () => {
    const reviewed = await previousReview()
    const wrongTarget = createDesktopSupabaseBackendStagingVerificationService(
      dependencies({
        resolveStagingTargetBinding: () => ({
          schemaVersion: 1,
          projectRef: PROJECT_REF,
          accountId: 'another-account',
          boundAt: NOW
        })
      })
    )
    const missingGrant = createDesktopSupabaseBackendStagingVerificationService(
      dependencies({ resolveGrantGeneration: async () => null })
    )
    const reusedToken = createDesktopSupabaseBackendStagingVerificationService(
      dependencies({ resolveWriteCredential: async () => READ_PAT })
    )

    expect(await errorCode(wrongTarget.verify(verificationInput(reviewed)))).toBe(
      'binding-mismatch'
    )
    expect(await errorCode(missingGrant.verify(verificationInput(reviewed)))).toBe(
      'grant-unavailable'
    )
    expect(await errorCode(reusedToken.verify(verificationInput(reviewed)))).toBe(
      'write-credential-not-independent'
    )
  })

  test('rejects concurrent operations and a tampered strict receipt digest', async () => {
    const reviewed = await previousReview()
    let releaseStrict: (() => void) | undefined
    let markStarted: (() => void) | undefined
    const strictGate = new Promise<void>((resolve) => {
      releaseStrict = resolve
    })
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    const service = createDesktopSupabaseBackendStagingVerificationService(
      dependencies({
        async prepareStrictVerification(input) {
          markStarted?.()
          await strictGate
          return strictResult(input)
        }
      })
    )
    const first = service.verify(verificationInput(reviewed))
    await started
    expect(await errorCode(service.verify(verificationInput(reviewed)))).toBe('already-running')
    releaseStrict?.()
    await expect(first).resolves.toBeDefined()

    const tampered = createDesktopSupabaseBackendStagingVerificationService(
      dependencies({
        async prepareStrictVerification(input) {
          return { ...(await strictResult(input)), receiptDigest: 'Z'.repeat(43) }
        }
      })
    )
    expect(await errorCode(tampered.verify(verificationInput(reviewed)))).toBe(
      'verification-failed'
    )
  })

  test('persists a claim before mutation and replays the exact terminal result without redispatch', async () => {
    const reviewed = await previousReview()
    const stored = createMemoryBackendHostReleaseDispatchJournal()
    let claimedKey = ''
    const journal: BackendHostReleaseDispatchJournal = {
      ...stored,
      async claim(input) {
        claimedKey = input.singleFlightKey
        return stored.claim(input)
      }
    }
    let mutationCalls = 0
    const first = createDesktopSupabaseBackendStagingVerificationService(
      dependencies({
        dispatchJournal: journal,
        async prepareStrictVerification(input) {
          await input.claimBeforeMutation(mutationProgress(input, 'edge-pre-dispatch'))
          mutationCalls += 1
          await input.recordMutationProgress(mutationProgress(input, 'edge-deployed'))
          return strictResult(input)
        }
      })
    )
    const firstResult = await first.verify(verificationInput(reviewed))
    const finalEvidence = await journal.readEvidence(claimedKey)

    expect(mutationCalls).toBe(1)
    expect(finalEvidence?.phase).toBe('final')
    const serializedEvidence = finalEvidence?.payload ?? ''
    for (const secret of [
      READ_PAT,
      WRITE_PAT,
      PUBLISHABLE_KEY,
      'edge_user_access_token_1234567890',
      'user_a_access_token_1234567890',
      'user_b_access_token_1234567890'
    ]) {
      expect(serializedEvidence).not.toContain(secret)
    }

    const replay = createDesktopSupabaseBackendStagingVerificationService(
      dependencies({
        dispatchJournal: journal,
        nextId: () => 'verification-2',
        async prepareStrictVerification(input) {
          await input.claimBeforeMutation(mutationProgress(input, 'edge-pre-dispatch'))
          mutationCalls += 1
          return strictResult(input)
        }
      })
    )
    const replayed = await replay.verify(verificationInput(reviewed))
    expect(replayed).toEqual(firstResult)
    expect(replayed.receipt.verificationId).toBe('verification-1')
    expect(mutationCalls).toBe(1)
  })

  test('allows only one concurrent Host instance to cross the mutation boundary', async () => {
    const reviewed = await previousReview()
    const journal = createMemoryBackendHostReleaseDispatchJournal()
    let mutationCalls = 0
    let signalStarted!: () => void
    const started = new Promise<void>((resolve) => {
      signalStarted = resolve
    })
    let finish!: () => void
    const hold = new Promise<void>((resolve) => {
      finish = resolve
    })
    const first = createDesktopSupabaseBackendStagingVerificationService(
      dependencies({
        dispatchJournal: journal,
        nextId: () => 'verification-concurrent-a',
        async prepareStrictVerification(input) {
          await input.claimBeforeMutation(mutationProgress(input, 'edge-pre-dispatch'))
          mutationCalls += 1
          signalStarted()
          await hold
          return strictResult(input)
        }
      })
    )
    const second = createDesktopSupabaseBackendStagingVerificationService(
      dependencies({
        dispatchJournal: journal,
        nextId: () => 'verification-concurrent-b',
        async prepareStrictVerification(input) {
          await input.claimBeforeMutation(mutationProgress(input, 'edge-pre-dispatch'))
          mutationCalls += 1
          return strictResult(input)
        }
      })
    )

    const winner = first.verify(verificationInput(reviewed))
    await started
    expect(await errorCode(second.verify(verificationInput(reviewed)))).toBe(
      'reconciliation-required'
    )
    expect(mutationCalls).toBe(1)
    finish()
    await expect(winner).resolves.toBeDefined()
  })

  test('keeps restart and changed-target retries locked until provider-authoritative reconciliation', async () => {
    const reviewed = await previousReview()
    const databaseName = `supabase-capability-restart-${crypto.randomUUID()}`
    const writer = createIdbBackendHostReleaseDispatchJournal(databaseName, fakeIndexedDB)
    let mutationCalls = 0
    const first = createDesktopSupabaseBackendStagingVerificationService(
      dependencies({
        dispatchJournal: writer,
        nextId: () => 'verification-restart-a',
        async prepareStrictVerification(input) {
          await input.claimBeforeMutation(mutationProgress(input, 'storage-pre-dispatch'))
          mutationCalls += 1
          await input.recordMutationProgress(mutationProgress(input, 'storage-progress'))
          throw new Error('simulated process loss after Storage mutation')
        }
      })
    )
    expect(await errorCode(first.verify(verificationInput(reviewed)))).toBe(
      'reconciliation-required'
    )

    const restartedJournal = createIdbBackendHostReleaseDispatchJournal(databaseName, fakeIndexedDB)
    const restarted = createDesktopSupabaseBackendStagingVerificationService(
      dependencies({
        dispatchJournal: restartedJournal,
        nextId: () => 'verification-restart-b',
        resolveStagingTargetBinding: () => ({
          schemaVersion: 1,
          projectRef: PROJECT_REF,
          accountId: ACCOUNT_ID,
          boundAt: '2026-09-03T03:00:00.000Z'
        }),
        async prepareStrictVerification(input) {
          await input.claimBeforeMutation(mutationProgress(input, 'storage-pre-dispatch'))
          mutationCalls += 1
          return strictResult(input)
        }
      })
    )
    const changedTargetInput = {
      ...verificationInput(reviewed),
      config: { url: PROJECT_URL, anonKey: `${PUBLISHABLE_KEY}-changed` }
    }
    expect(await errorCode(restarted.verify(changedTargetInput))).toBe('reconciliation-required')
    expect(mutationCalls).toBe(1)

    const inspection = await restarted.inspectUnresolved?.(PROJECT_REF)
    expect(inspection).toHaveLength(1)
    expect(inspection?.[0]).toMatchObject({
      outcome: 'outcome-unknown',
      evidenceIntegrity: 'verified',
      automaticRetryAllowed: false,
      providerAuthoritativeReconciliationRequired: true
    })
    expect(JSON.stringify(inspection?.[0]?.evidence)).toContain('users/user-a/probe-1.bin')
    expect(await restarted.inspectUnresolved?.(PROJECT_REF)).toHaveLength(1)
  })

  test('keeps an unknown Vue mutation locked against a React retry in the same project', async () => {
    const journal = createMemoryBackendHostReleaseDispatchJournal()
    let mutations = 0
    const mutate = async (input: DesktopSupabaseStrictStagingVerificationInput) => {
      await input.claimBeforeMutation(mutationProgress(input, 'edge-pre-dispatch'))
      mutations += 1
      throw new Error('Lost response after dispatch')
    }
    const vue = createDesktopSupabaseBackendStagingVerificationService(
      dependencies({
        dispatchJournal: journal,
        prepareBuild: () => VUE_BUILD,
        prepareStrictVerification: mutate
      })
    )
    const react = createDesktopSupabaseBackendStagingVerificationService(
      dependencies({
        dispatchJournal: journal,
        nextId: () => 'verification-react-retry',
        prepareStrictVerification: mutate
      })
    )

    expect(await errorCode(vue.verify(verificationInput(await previousReview(VUE_BUILD))))).toBe(
      'reconciliation-required'
    )
    expect(await errorCode(react.verify(verificationInput(await previousReview())))).toBe(
      'reconciliation-required'
    )
    expect(mutations).toBe(1)
    const unresolved = await journal.listUnresolved()
    expect(unresolved).toHaveLength(1)
    const evidence = await journal.readEvidence(unresolved[0].singleFlightKey)
    expect(JSON.parse(evidence?.payload ?? '{}')).toMatchObject({ target: { target: 'vue' } })
  })
})
