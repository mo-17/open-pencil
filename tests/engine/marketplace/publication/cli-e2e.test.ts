/* eslint-disable max-lines-per-function -- One subprocess test intentionally exercises the complete operator ceremony. */
import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createSqliteMarketplaceRepository } from '@open-pencil/marketplace'
import { exportEd25519PublicKeyPem } from '@open-pencil/scene-graph'

import type { CLICommandResult } from '#tests/helpers/cli'

setDefaultTimeout(30_000)

const temporaryDirectories: string[] = []
const CLI = join(process.cwd(), 'packages/marketplace/src/cli.ts')

function privateKeyPem(bytes: ArrayBuffer): string {
  const encoded = Buffer.from(bytes).toString('base64')
  const body = encoded.match(/.{1,64}/gu)?.join('\n') ?? encoded
  return `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n`
}

async function runCLI(
  args: readonly string[],
  environment: Record<string, string>
): Promise<CLICommandResult> {
  const child = Bun.spawn([process.execPath, CLI, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, ...environment },
    stdout: 'pipe',
    stderr: 'pipe'
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text()
  ])
  return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() }
}

function successfulJSON<Value>(result: CLICommandResult): Value {
  if (result.exitCode !== 0) {
    throw new Error(`Marketplace CLI failed: ${result.stderr || '(no stderr)'}`)
  }
  expect(result.exitCode).toBe(0)
  expect(result.stderr).toBe('')
  return JSON.parse(result.stdout) as Value
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('offline publication CLI ceremony', () => {
  test('requests, signs, imports, exactly replays, and explicitly cancels a later reservation', async () => {
    const root = join(tmpdir(), `openpencil-marketplace-publication-cli-${randomUUID()}`)
    temporaryDirectories.push(root)
    await mkdir(root, { recursive: true, mode: 0o700 })
    const database = join(root, 'marketplace.sqlite')
    const onlineArtifacts = join(root, 'online-artifacts')
    const offlineArtifacts = join(root, 'offline-artifacts')
    const firstHandoff = join(root, 'publication-1.handoff.json')
    const secondHandoff = join(root, 'publication-2.handoff.json')
    const policy = join(root, 'root-signer-policy.json')
    const signedBundle = join(root, 'publication-1.signed.json')
    const publicKeyFile = join(root, 'root-public.pem')
    const keyPair = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
    const publicPem = await exportEd25519PublicKeyPem(keyPair.publicKey)
    const privatePem = privateKeyPem(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey))
    const environment = {
      OPENPENCIL_TEST_ROOT_PRIVATE_KEY: privatePem,
      OPENPENCIL_TEST_ROOT_PUBLIC_KEY: publicPem
    }
    await writeFile(publicKeyFile, publicPem)
    const storage = [
      '--database',
      database,
      '--artifacts',
      onlineArtifacts,
      '--marketplace-id',
      'cli-e2e-marketplace',
      '--public-base-url',
      'https://plugins.example.com/'
    ]

    successfulJSON(await runCLI(['init', ...storage, '--json'], environment))
    successfulJSON(
      await runCLI(
        [
          'publisher',
          'create',
          ...storage,
          '--id',
          'bootstrap-publisher',
          '--name',
          'Bootstrap Publisher',
          '--key-id',
          'bootstrap-key-2026',
          '--public-key',
          publicKeyFile,
          '--not-before',
          '2026-01-01T00:00:00.000Z',
          '--not-after',
          '2027-01-01T00:00:00.000Z',
          '--json'
        ],
        environment
      )
    )
    const requested = successfulJSON<{ requestDigest: string; stateDigest: string }>(
      await runCLI(
        [
          'publication',
          'request',
          ...storage,
          '--public-key-env',
          'OPENPENCIL_TEST_ROOT_PUBLIC_KEY',
          '--root-key-id',
          'cli-e2e-root-2026',
          '--output',
          firstHandoff,
          '--json'
        ],
        environment
      )
    )
    const inspected = successfulJSON<{ requestDigest: string; stateDigest: string }>(
      await runCLI(['publication', 'inspect', '--handoff', firstHandoff, '--json'], environment)
    )
    expect(inspected.requestDigest).toBe(requested.requestDigest)
    expect(inspected.stateDigest).toBe(requested.stateDigest)

    successfulJSON(
      await runCLI(
        [
          'publication',
          'signer-init',
          '--handoff',
          firstHandoff,
          '--policy',
          policy,
          '--approve-state-digest',
          inspected.stateDigest,
          '--public-key-env',
          'OPENPENCIL_TEST_ROOT_PUBLIC_KEY',
          '--json'
        ],
        environment
      )
    )
    successfulJSON(
      await runCLI(
        [
          'publication',
          'sign',
          '--handoff',
          firstHandoff,
          '--artifacts',
          offlineArtifacts,
          '--policy',
          policy,
          '--approve-request-digest',
          inspected.requestDigest,
          '--private-key-env',
          'OPENPENCIL_TEST_ROOT_PRIVATE_KEY',
          '--public-key-env',
          'OPENPENCIL_TEST_ROOT_PUBLIC_KEY',
          '--output',
          signedBundle,
          '--json'
        ],
        environment
      )
    )

    const firstImport = successfulJSON<{ sequence: number }>(
      await runCLI(
        [
          'publication',
          'import',
          ...storage,
          '--bundle',
          signedBundle,
          '--public-key-env',
          'OPENPENCIL_TEST_ROOT_PUBLIC_KEY',
          '--json'
        ],
        environment
      )
    )
    const exactReplay = successfulJSON<{ sequence: number }>(
      await runCLI(
        [
          'publication',
          'import',
          ...storage,
          '--bundle',
          signedBundle,
          '--public-key-env',
          'OPENPENCIL_TEST_ROOT_PUBLIC_KEY',
          '--json'
        ],
        environment
      )
    )
    expect(firstImport.sequence).toBe(1)
    expect(exactReplay).toEqual(firstImport)

    const secondRequest = successfulJSON<{ requestDigest: string }>(
      await runCLI(
        [
          'publication',
          'request',
          ...storage,
          '--public-key-env',
          'OPENPENCIL_TEST_ROOT_PUBLIC_KEY',
          '--root-key-id',
          'cli-e2e-root-2026',
          '--output',
          secondHandoff,
          '--json'
        ],
        environment
      )
    )
    const wrongCancellation = await runCLI(
      [
        'publication',
        'cancel',
        ...storage,
        '--approve-request-digest',
        'A'.repeat(43),
        '--reason',
        'Deliberate mismatch test',
        '--json'
      ],
      environment
    )
    expect(wrongCancellation.exitCode).not.toBe(0)
    expect(wrongCancellation.stdout).toBe('')

    const cancellation = successfulJSON<{ cancelled: boolean; requestDigest: string }>(
      await runCLI(
        [
          'publication',
          'cancel',
          ...storage,
          '--approve-request-digest',
          secondRequest.requestDigest,
          '--reason',
          'Offline signer media was irrecoverably lost',
          '--json'
        ],
        environment
      )
    )
    expect(cancellation).toMatchObject({
      cancelled: true,
      requestDigest: secondRequest.requestDigest
    })

    successfulJSON(
      await runCLI(
        [
          'publisher',
          'create',
          ...storage,
          '--id',
          'post-cancel-publisher',
          '--name',
          'Post Cancel Publisher',
          '--key-id',
          'post-cancel-key-2026',
          '--public-key',
          publicKeyFile,
          '--not-before',
          '2026-01-01T00:00:00.000Z',
          '--not-after',
          '2027-01-01T00:00:00.000Z',
          '--json'
        ],
        environment
      )
    )

    const repository = createSqliteMarketplaceRepository({ path: database })
    const state = await repository.snapshot()
    expect(state.publications).toHaveLength(1)
    expect(state.publishers.map(({ id }) => id)).toContain('post-cancel-publisher')
    expect(
      state.auditEvents.filter(({ action }) => action === 'publication.recorded')
    ).toHaveLength(1)
    expect(
      state.auditEvents.filter(({ action }) => action === 'publication.reservation_cancelled')
    ).toHaveLength(1)
    await repository.close()
  })
})
