/* oxlint-disable eslint(max-lines) -- Credential lease lifecycle and adversarial same-realm timing cases stay together for security review. */
import { describe, expect, test } from 'bun:test'

import { digestCanonicalManifest } from '@open-pencil/scene-graph'

import {
  SUPABASE_MANAGEMENT_DATABASE_WRITE_CREDENTIAL_INCARNATION_CREDENTIAL,
  SUPABASE_MANAGEMENT_DATABASE_WRITE_PAT_CREDENTIAL,
  SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL,
  resolveSupabaseManagementDatabaseWriteCredentialIncarnation,
  resolveSupabaseManagementGrantGeneration,
  setSupabaseManagementDatabaseWritePat,
  setSupabaseManagementPat
} from '@/app/lowcode/supabase/credentials'
import {
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_CREDENTIAL_LEASE_PURPOSE,
  SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MARKER_PREFIX,
  SupabaseManagementDatabaseWriteCredentialLeaseError,
  appSupabaseManagementDatabaseWriteCredentialLeaseIssuerV1,
  consumeSupabaseManagementDatabaseWriteCredentialLeaseV1,
  createSupabaseManagementDatabaseWriteCredentialLeaseIssuerForTestingV1,
  disposeSupabaseManagementDatabaseWriteCredentialLeaseV1,
  isAppVaultSupabaseManagementDatabaseWriteCredentialLeaseIssuerV1,
  issueSupabaseManagementDatabaseWriteCredentialLeaseV1,
  runSupabaseManagementDatabaseWriteCredentialLeaseWithCurrentPATV1,
  trustedSupabaseManagementDatabaseWriteCredentialLeaseMetadataV1,
  type SupabaseManagementDatabaseWriteCredentialLeaseBindingV1
} from '@/app/lowcode/supabase/management-database-write-credential-lease'
import { MemoryCredentialStore } from '@/app/settings/credentials/memory'
import type { CredentialServices } from '@/app/settings/credentials/services'
import { createCredentialServices } from '@/app/settings/credentials/services'
import type { CredentialRef } from '@/app/settings/credentials/types'

const PROJECT_REF = 'abcdefghijklmnopqrst'
const ACCOUNT_ID = 'account.test'
const PERSONAL_ACCESS_TOKEN = 'sbp_write_token_canary_000001'
const digest = (character: string) => character.repeat(43)
const MARKER_BINDING_DIGEST = digest('F')

function binding(
  expectedSharedGrantGeneration: string,
  overrides: Partial<SupabaseManagementDatabaseWriteCredentialLeaseBindingV1> = {}
): SupabaseManagementDatabaseWriteCredentialLeaseBindingV1 {
  return {
    purpose: SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_CREDENTIAL_LEASE_PURPOSE,
    projectRef: PROJECT_REF,
    accountId: ACCOUNT_ID,
    installReviewDigest: digest('A'),
    sourceReviewDigest: digest('B'),
    verificationDigest: digest('C'),
    ledgerShapeDigest: digest('D'),
    baseSqlDigest: digest('E'),
    marker: `${SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MARKER_PREFIX}${MARKER_BINDING_DIGEST}`,
    markerBindingDigest: MARKER_BINDING_DIGEST,
    installSqlDigest: digest('G'),
    verificationQueryDigest: digest('H'),
    expectedSharedGrantGeneration,
    ...overrides
  }
}

async function errorCode(operation: Promise<unknown>): Promise<string | undefined> {
  try {
    await operation
    return undefined
  } catch (cause) {
    return cause instanceof SupabaseManagementDatabaseWriteCredentialLeaseError
      ? cause.code
      : undefined
  }
}

async function caughtError(operation: Promise<unknown>): Promise<unknown> {
  try {
    await operation
    return undefined
  } catch (cause) {
    return cause
  }
}

function syncErrorCode(operation: () => unknown): string | undefined {
  try {
    operation()
    return undefined
  } catch (cause) {
    return cause instanceof SupabaseManagementDatabaseWriteCredentialLeaseError
      ? cause.code
      : undefined
  }
}

async function fixture(services = createCredentialServices(new MemoryCredentialStore())) {
  await setSupabaseManagementDatabaseWritePat(PERSONAL_ACCESS_TOKEN, services)
  const sharedGrantGeneration = await resolveSupabaseManagementGrantGeneration(services)
  const writeCredentialIncarnation =
    await resolveSupabaseManagementDatabaseWriteCredentialIncarnation(services)
  if (!sharedGrantGeneration || !writeCredentialIncarnation) throw new Error('fixture failed')
  const issuer = createSupabaseManagementDatabaseWriteCredentialLeaseIssuerForTestingV1(services)
  const expectedBinding = binding(sharedGrantGeneration)
  const lease = await issueSupabaseManagementDatabaseWriteCredentialLeaseV1({
    issuer,
    binding: expectedBinding
  })
  return {
    services,
    issuer,
    expectedBinding,
    lease,
    sharedGrantGeneration,
    writeCredentialIncarnation
  }
}

function consume(current: Awaited<ReturnType<typeof fixture>>) {
  return consumeSupabaseManagementDatabaseWriteCredentialLeaseV1({
    issuer: current.issuer,
    lease: current.lease,
    expectedBinding: current.expectedBinding
  })
}

describe('Supabase Management database-write credential lease', () => {
  test('issues only secret-free operation metadata and never resolves the PAT', async () => {
    const base = createCredentialServices(new MemoryCredentialStore())
    await setSupabaseManagementDatabaseWritePat(PERSONAL_ACCESS_TOKEN, base)
    const sharedGrantGeneration = await resolveSupabaseManagementGrantGeneration(base)
    const writeCredentialIncarnation =
      await resolveSupabaseManagementDatabaseWriteCredentialIncarnation(base)
    if (!sharedGrantGeneration || !writeCredentialIncarnation) throw new Error('fixture failed')
    const reads: CredentialRef[] = []
    const services: CredentialServices = {
      manager: base.manager,
      resolver: {
        async resolve(reference) {
          reads.push(reference)
          return base.resolver.resolve(reference)
        }
      }
    }
    const issuer = createSupabaseManagementDatabaseWriteCredentialLeaseIssuerForTestingV1(services)
    const expectedBinding = binding(sharedGrantGeneration)
    const first = await issueSupabaseManagementDatabaseWriteCredentialLeaseV1({
      issuer,
      binding: expectedBinding
    })
    const second = await issueSupabaseManagementDatabaseWriteCredentialLeaseV1({
      issuer,
      binding: expectedBinding
    })

    expect(reads).not.toContainEqual(SUPABASE_MANAGEMENT_DATABASE_WRITE_PAT_CREDENTIAL)
    expect(first).toMatchObject({
      format: 'openpencil.supabase-management-database-write-credential-lease.v1',
      version: 1,
      providerId: 'supabase',
      scope: 'database:write',
      permission: 'database_migrations_write',
      lifetime: 'single-operation',
      ...expectedBinding,
      writeCredentialIncarnation
    })
    expect(first.bindingDigest).toBe(await digestCanonicalManifest(expectedBinding))
    expect(first.operationLeaseGeneration).toMatch(/^[0-9a-f-]{36}$/)
    expect(second.operationLeaseGeneration).not.toBe(first.operationLeaseGeneration)
    expect(Object.isFrozen(first)).toBe(true)
    expect(JSON.stringify(first)).not.toContain(PERSONAL_ACCESS_TOKEN)
    expect(JSON.stringify(first)).not.toContain('canary')
  })

  test('inspects only the exact unconsumed lease identity without resolving a PAT', async () => {
    const current = await fixture()
    const expected = {
      bindingDigest: current.lease.bindingDigest,
      writeCredentialIncarnation: current.lease.writeCredentialIncarnation,
      operationLeaseGeneration: current.lease.operationLeaseGeneration
    }

    expect(
      trustedSupabaseManagementDatabaseWriteCredentialLeaseMetadataV1({
        issuer: current.issuer,
        lease: current.lease,
        expectedBinding: current.expectedBinding
      })
    ).toEqual(expected)
    expect(
      trustedSupabaseManagementDatabaseWriteCredentialLeaseMetadataV1({
        issuer: current.issuer,
        lease: structuredClone(current.lease),
        expectedBinding: current.expectedBinding
      })
    ).toBeNull()

    consume(current)
    expect(
      trustedSupabaseManagementDatabaseWriteCredentialLeaseMetadataV1({
        issuer: current.issuer,
        lease: current.lease,
        expectedBinding: current.expectedBinding
      })
    ).toBeNull()
  })

  test('starts one request inside the final credential window and cannot replay it', async () => {
    const base = createCredentialServices(new MemoryCredentialStore())
    const events: string[] = []
    const services: CredentialServices = {
      manager: base.manager,
      resolver: {
        async resolve(reference) {
          events.push(reference.field)
          return base.resolver.resolve(reference)
        }
      }
    }
    const current = await fixture(services)
    events.length = 0
    const consumedLease = consume(current)
    expect(JSON.stringify(consumedLease)).toBe('{}')
    expect(Reflect.ownKeys(consumedLease)).toEqual([])

    const result = await runSupabaseManagementDatabaseWriteCredentialLeaseWithCurrentPATV1({
      issuer: current.issuer,
      consumedLease,
      startRequest(personalAccessToken) {
        events.push('request-started')
        expect(personalAccessToken).toBe(PERSONAL_ACCESS_TOKEN)
        return 'started' as const
      }
    })
    expect(result).toBe('started')
    expect(events).toEqual([
      'grant-generation',
      'database-write-credential-incarnation',
      'database-write-personal-access-token',
      'database-write-credential-incarnation',
      'grant-generation',
      'request-started'
    ])
    expect(
      await errorCode(
        runSupabaseManagementDatabaseWriteCredentialLeaseWithCurrentPATV1({
          issuer: current.issuer,
          consumedLease,
          startRequest: () => 'replayed'
        })
      )
    ).toBe('supabase-management-database-write-credential-lease-invalid')
    expect(
      syncErrorCode(() =>
        consumeSupabaseManagementDatabaseWriteCredentialLeaseV1({
          issuer: current.issuer,
          lease: current.lease,
          expectedBinding: current.expectedBinding
        })
      )
    ).toBe('supabase-management-database-write-credential-lease-invalid')
  })

  test('allows one concurrent runner and maps synchronous starter failure statically', async () => {
    const base = createCredentialServices(new MemoryCredentialStore())
    let holdNextRead = false
    let markReadStarted: () => void = () => undefined
    let releaseRead: () => void = () => undefined
    const readStarted = new Promise<void>((resolve) => {
      markReadStarted = resolve
    })
    const readGate = new Promise<void>((resolve) => {
      releaseRead = resolve
    })
    const services: CredentialServices = {
      manager: base.manager,
      resolver: {
        async resolve(reference) {
          if (holdNextRead) {
            holdNextRead = false
            markReadStarted()
            await readGate
          }
          return base.resolver.resolve(reference)
        }
      }
    }
    const current = await fixture(services)
    const consumedLease = consume(current)
    let starts = 0
    holdNextRead = true
    const winner = runSupabaseManagementDatabaseWriteCredentialLeaseWithCurrentPATV1({
      issuer: current.issuer,
      consumedLease,
      startRequest() {
        starts += 1
        return 'winner'
      }
    })
    await readStarted
    expect(
      await errorCode(
        runSupabaseManagementDatabaseWriteCredentialLeaseWithCurrentPATV1({
          issuer: current.issuer,
          consumedLease,
          startRequest() {
            starts += 1
            return 'loser'
          }
        })
      )
    ).toBe('supabase-management-database-write-credential-lease-invalid')
    releaseRead()
    await expect(winner).resolves.toBe('winner')
    expect(starts).toBe(1)

    const throwing = await fixture()
    const throwingConsumed = consume(throwing)
    expect(
      await errorCode(
        runSupabaseManagementDatabaseWriteCredentialLeaseWithCurrentPATV1({
          issuer: throwing.issuer,
          consumedLease: throwingConsumed,
          startRequest() {
            throw new Error(`must not escape ${PERSONAL_ACCESS_TOKEN}`)
          }
        })
      )
    ).toBe('supabase-management-database-write-credential-lease-request-start-failed')
  })

  test('linearizes request start before queued rotation without holding the gate for network completion', async () => {
    const base = createCredentialServices(new MemoryCredentialStore())
    let pauseFinalSharedRead = false
    let sharedReads = 0
    let markFinalSharedReadCaptured: () => void = () => undefined
    let releaseFinalSharedRead: () => void = () => undefined
    let resolveNetwork: (value: string) => void = () => undefined
    const finalSharedReadCaptured = new Promise<void>((resolve) => {
      markFinalSharedReadCaptured = resolve
    })
    const finalSharedReadGate = new Promise<void>((resolve) => {
      releaseFinalSharedRead = resolve
    })
    const networkResult = new Promise<string>((resolve) => {
      resolveNetwork = resolve
    })
    const events: string[] = []
    const services: CredentialServices = {
      manager: base.manager,
      resolver: {
        async resolve(reference) {
          const value = await base.resolver.resolve(reference)
          if (
            pauseFinalSharedRead &&
            reference === SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL &&
            ++sharedReads === 2
          ) {
            events.push('final-shared-captured')
            markFinalSharedReadCaptured()
            await finalSharedReadGate
          }
          return value
        }
      }
    }
    const current = await fixture(services)
    const consumedLease = consume(current)
    pauseFinalSharedRead = true
    const run = runSupabaseManagementDatabaseWriteCredentialLeaseWithCurrentPATV1({
      issuer: current.issuer,
      consumedLease,
      startRequest(personalAccessToken) {
        expect(personalAccessToken).toBe(PERSONAL_ACCESS_TOKEN)
        events.push('request-started')
        return networkResult
      }
    })
    await finalSharedReadCaptured

    let rotationSettled = false
    const rotation = (async () => {
      await setSupabaseManagementDatabaseWritePat('sbp_rotated_token_canary_0004', services)
      rotationSettled = true
      events.push('rotation-complete')
    })()
    await Promise.resolve()
    await Promise.resolve()
    expect(rotationSettled).toBe(false)
    expect(events).toEqual(['final-shared-captured'])

    let runSettled = false
    void (async () => {
      await run
      runSettled = true
    })()
    releaseFinalSharedRead()
    await rotation
    expect(events).toEqual(['final-shared-captured', 'request-started', 'rotation-complete'])
    expect(runSettled).toBe(false)

    resolveNetwork('network-complete')
    await expect(run).resolves.toBe('network-complete')
  })

  test('maps rejected Promise and rejecting thenable failures without leaking the PAT', async () => {
    const rejectedPromise = await fixture()
    const rejectedPromiseError = await caughtError(
      runSupabaseManagementDatabaseWriteCredentialLeaseWithCurrentPATV1({
        issuer: rejectedPromise.issuer,
        consumedLease: consume(rejectedPromise),
        startRequest() {
          return Promise.reject(new Error(`remote rejected ${PERSONAL_ACCESS_TOKEN}`))
        }
      })
    )
    expect(rejectedPromiseError).toBeInstanceOf(SupabaseManagementDatabaseWriteCredentialLeaseError)
    expect((rejectedPromiseError as SupabaseManagementDatabaseWriteCredentialLeaseError).code).toBe(
      'supabase-management-database-write-credential-lease-request-start-failed'
    )
    expect((rejectedPromiseError as Error).message).not.toContain(PERSONAL_ACCESS_TOKEN)

    const rejectedThenable = await fixture()
    const rejectedThenableError = await caughtError(
      runSupabaseManagementDatabaseWriteCredentialLeaseWithCurrentPATV1({
        issuer: rejectedThenable.issuer,
        consumedLease: consume(rejectedThenable),
        startRequest() {
          return {
            // oxlint-disable-next-line unicorn/no-thenable -- Intentional hostile thenable verifies rejection assimilation outside the credential gate.
            then(_resolve: (value: string) => void, reject: (reason: unknown) => void) {
              reject(new Error(`thenable rejected ${PERSONAL_ACCESS_TOKEN}`))
            }
          }
        }
      })
    )
    expect(rejectedThenableError).toBeInstanceOf(
      SupabaseManagementDatabaseWriteCredentialLeaseError
    )
    expect(
      (rejectedThenableError as SupabaseManagementDatabaseWriteCredentialLeaseError).code
    ).toBe('supabase-management-database-write-credential-lease-request-start-failed')
    expect((rejectedThenableError as Error).message).not.toContain(PERSONAL_ACCESS_TOKEN)
  })

  test('fails before request start for pending, missing, or rotated credentials', async () => {
    const pendingServices = createCredentialServices(new MemoryCredentialStore())
    await setSupabaseManagementDatabaseWritePat(PERSONAL_ACCESS_TOKEN, pendingServices)
    const pendingExpected = await resolveSupabaseManagementGrantGeneration(pendingServices)
    if (!pendingExpected) throw new Error('fixture failed')
    await pendingServices.manager.set(
      SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL,
      `pending:${crypto.randomUUID()}`
    )
    const pendingIssuer =
      createSupabaseManagementDatabaseWriteCredentialLeaseIssuerForTestingV1(pendingServices)
    expect(
      await errorCode(
        issueSupabaseManagementDatabaseWriteCredentialLeaseV1({
          issuer: pendingIssuer,
          binding: binding(pendingExpected)
        })
      )
    ).toBe('supabase-management-database-write-credential-lease-credential-not-current')

    const missingServices = createCredentialServices(new MemoryCredentialStore())
    const missingGeneration = crypto.randomUUID()
    const missingIncarnation = crypto.randomUUID()
    await missingServices.manager.set(
      SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL,
      missingGeneration
    )
    await missingServices.manager.set(
      SUPABASE_MANAGEMENT_DATABASE_WRITE_CREDENTIAL_INCARNATION_CREDENTIAL,
      missingIncarnation
    )
    const missingIssuer =
      createSupabaseManagementDatabaseWriteCredentialLeaseIssuerForTestingV1(missingServices)
    const missingBinding = binding(missingGeneration)
    const missingLease = await issueSupabaseManagementDatabaseWriteCredentialLeaseV1({
      issuer: missingIssuer,
      binding: missingBinding
    })
    const missingConsumed = consumeSupabaseManagementDatabaseWriteCredentialLeaseV1({
      issuer: missingIssuer,
      lease: missingLease,
      expectedBinding: missingBinding
    })
    let starts = 0
    expect(
      await errorCode(
        runSupabaseManagementDatabaseWriteCredentialLeaseWithCurrentPATV1({
          issuer: missingIssuer,
          consumedLease: missingConsumed,
          startRequest() {
            starts += 1
          }
        })
      )
    ).toBe('supabase-management-database-write-credential-lease-credential-not-current')

    const rotated = await fixture()
    const rotatedConsumed = consume(rotated)
    await setSupabaseManagementDatabaseWritePat('sbp_rotated_token_canary_0002', rotated.services)
    expect(
      await errorCode(
        runSupabaseManagementDatabaseWriteCredentialLeaseWithCurrentPATV1({
          issuer: rotated.issuer,
          consumedLease: rotatedConsumed,
          startRequest() {
            starts += 1
          }
        })
      )
    ).toBe('supabase-management-database-write-credential-lease-credential-not-current')
    expect(starts).toBe(0)
  })

  test('detects rotation during the final PAT window and starts no request', async () => {
    const base = createCredentialServices(new MemoryCredentialStore())
    let rotateOnPATRead = false
    const services: CredentialServices = {
      manager: base.manager,
      resolver: {
        async resolve(reference) {
          const value = await base.resolver.resolve(reference)
          if (rotateOnPATRead && reference === SUPABASE_MANAGEMENT_DATABASE_WRITE_PAT_CREDENTIAL) {
            rotateOnPATRead = false
            const nextSharedGrantGeneration = crypto.randomUUID()
            const nextWriteCredentialIncarnation = crypto.randomUUID()
            await base.manager.set(
              SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL,
              `pending:${nextSharedGrantGeneration}`
            )
            await base.manager.set(
              SUPABASE_MANAGEMENT_DATABASE_WRITE_CREDENTIAL_INCARNATION_CREDENTIAL,
              `pending:${nextWriteCredentialIncarnation}`
            )
            await base.manager.set(
              SUPABASE_MANAGEMENT_DATABASE_WRITE_PAT_CREDENTIAL,
              'sbp_rotated_token_canary_0003'
            )
            await base.manager.set(
              SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL,
              nextSharedGrantGeneration
            )
            await base.manager.set(
              SUPABASE_MANAGEMENT_DATABASE_WRITE_CREDENTIAL_INCARNATION_CREDENTIAL,
              nextWriteCredentialIncarnation
            )
          }
          return value
        }
      }
    }
    const current = await fixture(services)
    const consumedLease = consume(current)
    rotateOnPATRead = true
    let starts = 0
    expect(
      await errorCode(
        runSupabaseManagementDatabaseWriteCredentialLeaseWithCurrentPATV1({
          issuer: current.issuer,
          consumedLease,
          startRequest() {
            starts += 1
          }
        })
      )
    ).toBe('supabase-management-database-write-credential-lease-credential-not-current')
    expect(starts).toBe(0)
  })

  test('keeps write authority dead after shared publication fails and a read rotation succeeds', async () => {
    const base = createCredentialServices(new MemoryCredentialStore())
    let rejectSharedCommit = true
    const failingServices: CredentialServices = {
      resolver: base.resolver,
      manager: {
        ...base.manager,
        async set(reference, value) {
          if (
            rejectSharedCommit &&
            reference === SUPABASE_MANAGEMENT_GRANT_GENERATION_CREDENTIAL &&
            !value.startsWith('pending:')
          ) {
            rejectSharedCommit = false
            throw new Error('simulated shared generation commit failure')
          }
          await base.manager.set(reference, value)
        }
      }
    }
    await expect(
      setSupabaseManagementDatabaseWritePat(PERSONAL_ACCESS_TOKEN, failingServices)
    ).rejects.toThrow('simulated shared generation commit failure')
    await expect(
      resolveSupabaseManagementDatabaseWriteCredentialIncarnation(base)
    ).resolves.toBeNull()

    await setSupabaseManagementPat('sbp_read_recovery_token_0001', base)
    const recoveredSharedGeneration = await resolveSupabaseManagementGrantGeneration(base)
    if (!recoveredSharedGeneration) throw new Error('fixture failed')
    await expect(
      resolveSupabaseManagementDatabaseWriteCredentialIncarnation(base)
    ).resolves.toBeNull()
    const issuer = createSupabaseManagementDatabaseWriteCredentialLeaseIssuerForTestingV1(base)
    expect(
      await errorCode(
        issueSupabaseManagementDatabaseWriteCredentialLeaseV1({
          issuer,
          binding: binding(recoveredSharedGeneration)
        })
      )
    ).toBe('supabase-management-database-write-credential-lease-credential-not-current')
  })

  test('binds every CAS digest and enforces the exact operation marker', async () => {
    const current = await fixture()
    let getterCalls = 0
    const accessorBinding = { ...current.expectedBinding }
    Object.defineProperty(accessorBinding, 'installSqlDigest', {
      enumerable: true,
      get() {
        getterCalls += 1
        return digest('G')
      }
    })
    expect(
      await errorCode(
        issueSupabaseManagementDatabaseWriteCredentialLeaseV1({
          issuer: current.issuer,
          binding: accessorBinding
        })
      )
    ).toBe('supabase-management-database-write-credential-lease-binding-invalid')
    expect(getterCalls).toBe(0)

    expect(
      await errorCode(
        issueSupabaseManagementDatabaseWriteCredentialLeaseV1({
          issuer: current.issuer,
          binding: {
            ...current.expectedBinding,
            marker: `${SUPABASE_BACKFILL_DATABASE_CAS_LEDGER_INSTALL_MARKER_PREFIX}${digest('Z')}`
          }
        })
      )
    ).toBe('supabase-management-database-write-credential-lease-binding-invalid')

    expect(
      syncErrorCode(() =>
        consumeSupabaseManagementDatabaseWriteCredentialLeaseV1({
          issuer: current.issuer,
          lease: current.lease,
          expectedBinding: {
            ...current.expectedBinding,
            baseSqlDigest: digest('Z')
          }
        })
      )
    ).toBe('supabase-management-database-write-credential-lease-binding-mismatch')
  })

  test('rejects forged identities and exposes an exact app-vault singleton predicate', async () => {
    const current = await fixture()
    expect(isAppVaultSupabaseManagementDatabaseWriteCredentialLeaseIssuerV1(current.issuer)).toBe(
      false
    )
    expect(
      isAppVaultSupabaseManagementDatabaseWriteCredentialLeaseIssuerV1(
        appSupabaseManagementDatabaseWriteCredentialLeaseIssuerV1
      )
    ).toBe(true)
    expect(
      isAppVaultSupabaseManagementDatabaseWriteCredentialLeaseIssuerV1({
        ...appSupabaseManagementDatabaseWriteCredentialLeaseIssuerV1
      })
    ).toBe(false)

    const forgedIssuer = { ...current.issuer }
    expect(
      await errorCode(
        issueSupabaseManagementDatabaseWriteCredentialLeaseV1({
          issuer: forgedIssuer as never,
          binding: current.expectedBinding
        })
      )
    ).toBe('supabase-management-database-write-credential-lease-issuer-invalid')
    for (const lease of [structuredClone(current.lease), { ...current.lease }]) {
      expect(
        syncErrorCode(() =>
          consumeSupabaseManagementDatabaseWriteCredentialLeaseV1({
            issuer: current.issuer,
            lease,
            expectedBinding: current.expectedBinding
          })
        )
      ).toBe('supabase-management-database-write-credential-lease-invalid')
    }
  })

  test('disposes an unused consumed lease without resolving a PAT', async () => {
    const current = await fixture()
    const consumedLease = consume(current)
    expect(
      disposeSupabaseManagementDatabaseWriteCredentialLeaseV1({
        issuer: current.issuer,
        consumedLease
      })
    ).toBe(true)
    expect(
      disposeSupabaseManagementDatabaseWriteCredentialLeaseV1({
        issuer: current.issuer,
        consumedLease
      })
    ).toBe(false)
  })
})
