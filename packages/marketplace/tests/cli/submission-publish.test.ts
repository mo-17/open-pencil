import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as v from 'valibot'

import {
  createFileMarketplaceArtifactStore,
  createMarketplaceService,
  createSqliteMarketplaceRepository
} from '@open-pencil/marketplace'
import {
  PLUGIN_MANIFEST_FORMAT,
  PLUGIN_MANIFEST_SCHEMA_VERSION,
  signPluginManifest
} from '@open-pencil/plugin-contracts'
import { exportEd25519PublicKeyPem } from '@open-pencil/scene-graph'

const directories: string[] = []
const CLI = fileURLToPath(import.meta.resolve('@open-pencil/marketplace/cli'))
const NOW = '2026-01-02T00:00:00.000Z'
const SUBMISSION = 'cli-publish-one'

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

async function fixture(approved: boolean) {
  const directory = await mkdtemp(join(tmpdir(), 'openpencil-marketplace-publish-cli-'))
  directories.push(directory)
  const database = join(directory, 'state.sqlite')
  const artifacts = join(directory, 'artifacts')
  const repository = createSqliteMarketplaceRepository({ path: database })
  const publisher = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
  const service = createMarketplaceService({
    repository,
    artifacts: createFileMarketplaceArtifactStore(artifacts),
    marketplaceId: 'cli-marketplace',
    publicBaseUrl: 'https://plugins.example.com/',
    now: () => new Date(NOW)
  })
  try {
    await service.registerPublisher(
      {
        publisher: { id: 'cli-publisher', displayName: 'CLI Publisher' },
        key: {
          keyId: 'cli-publisher.release',
          publisherId: 'cli-publisher',
          publicKeyPem: await exportEd25519PublicKeyPem(publisher.publicKey),
          notBefore: '2020-01-01T00:00:00.000Z',
          notAfter: '2100-01-01T00:00:00.000Z'
        }
      },
      { actor: 'publisher:cli-publisher', time: NOW }
    )
    await service.transitionPublisherKey('cli-publisher.release', 'active', { actor: 'admin:test' })
    await service.transitionPublisher('cli-publisher', 'active', { actor: 'admin:test' })
    await service.requestOwnership('cli-publisher.summary', 'cli-publisher', {
      actor: 'publisher:cli-publisher'
    })
    await service.transitionOwnership('cli-publisher.summary', 'active', { actor: 'admin:test' })
    const manifest = await signPluginManifest(
      {
        format: PLUGIN_MANIFEST_FORMAT,
        schemaVersion: PLUGIN_MANIFEST_SCHEMA_VERSION,
        plugin: { id: 'cli-publisher.summary', name: 'Summary', version: '1.0.0' },
        publisher: { id: 'cli-publisher', name: 'CLI Publisher', keyId: 'cli-publisher.release' },
        engineRange: '>=0.13.0 <1.0.0',
        capabilities: [],
        contributions: {
          modules: [
            {
              moduleType: 'summary',
              name: 'Summary',
              description: 'A declarative module for CLI release verification.',
              adapterId: 'cli-publisher.summary',
              configVersion: 1,
              defaultSize: { width: 100, height: 100 },
              defaultConfig: {},
              fields: []
            }
          ]
        }
      },
      publisher.privateKey
    )
    const submission = await service.submit(
      {
        id: SUBMISSION,
        publisherId: 'cli-publisher',
        channel: 'stable',
        manifest,
        listing: {
          displayName: 'Summary',
          summary: 'Summarizes a document.',
          description: 'A signed declarative package for CLI release verification.',
          categories: ['analysis'],
          iconUrl: null,
          homepageUrl: null
        }
      },
      { actor: 'publisher:cli-publisher' }
    )
    if (approved)
      await service.transitionSubmission(SUBMISSION, 'approved', { actor: 'admin:test' })
    return { database, artifacts, submission }
  } finally {
    await repository.close()
  }
}

async function runCLI(location: Awaited<ReturnType<typeof fixture>>, args: readonly string[]) {
  const child = Bun.spawn(
    [
      process.execPath,
      CLI,
      ...args,
      '--database',
      location.database,
      '--artifacts',
      location.artifacts,
      '--marketplace-id',
      'cli-marketplace',
      '--public-base-url',
      'https://plugins.example.com/',
      '--actor',
      'admin:cli-release',
      '--json'
    ],
    { stdout: 'pipe', stderr: 'pipe' }
  )
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text()
  ])
  return { exitCode, stdout, stderr }
}

async function snapshot(database: string) {
  const repository = createSqliteMarketplaceRepository({ path: database })
  try {
    return await repository.snapshot()
  } finally {
    await repository.close()
  }
}

describe('marketplace submission publish CLI', () => {
  test('publishes an approved signed submission without producing a Root publication', async () => {
    const location = await fixture(true)
    const result = await runCLI(location, ['submission', 'publish', SUBMISSION])
    expect(result.exitCode).toBe(0)
    expect(result.stderr).toBe('')
    const release = v.parse(
      v.pipe(v.string(), v.parseJson(), v.looseObject({ submissionId: v.string() })),
      result.stdout
    )
    expect(release.submissionId).toBe(SUBMISSION)
    const state = await snapshot(location.database)
    expect(state.submissions[0]?.status).toBe('published')
    expect(state.releases).toHaveLength(1)
    expect(state.releases[0]).toMatchObject({
      submissionId: SUBMISSION,
      manifestDigest: location.submission.manifestDigest,
      artifactDigest: location.submission.artifactDigest,
      coordinate: { pluginId: 'cli-publisher.summary', version: '1.0.0', channel: 'stable' }
    })
    expect(state.auditEvents.at(-1)).toMatchObject({
      action: 'release.published',
      actor: 'admin:cli-release'
    })
    expect(state.publications).toEqual([])
  })

  test('rejects a submission that has not been approved without changing state', async () => {
    const location = await fixture(false)
    const before = await snapshot(location.database)
    const result = await runCLI(location, ['submission', 'publish', SUBMISSION])
    expect(result.exitCode).not.toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('cannot transition from awaiting_review to published')
    expect(await snapshot(location.database)).toEqual(before)
  })

  test('keeps generic review unable to publish even an approved submission', async () => {
    const location = await fixture(true)
    const before = await snapshot(location.database)
    const result = await runCLI(location, ['review', SUBMISSION, '--status', 'published'])
    expect(result.exitCode).not.toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toContain('require their dedicated impact operations')
    expect(await snapshot(location.database)).toEqual(before)
  })

  test('revalidates approved package bytes before recording a release', async () => {
    const location = await fixture(true)
    const before = await snapshot(location.database)
    await writeFile(join(location.artifacts, `${location.submission.artifactDigest}.blob`), '{}')
    const result = await runCLI(location, ['submission', 'publish', SUBMISSION])
    expect(result.exitCode).not.toBe(0)
    expect(result.stdout).toBe('')
    expect(await snapshot(location.database)).toEqual(before)
  })
})
