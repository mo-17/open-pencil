/* eslint-disable max-lines -- Phase 8 recovery trust, tamper, and crash-gap fixtures exercise one boundary. */
import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, test } from 'bun:test'
import { createHash, createHmac, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { link, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

import {
  createFileMarketplaceArtifactStore,
  createMarketplaceBackup,
  createMarketplaceService,
  createSqliteMarketplaceRepository,
  prepareMarketplaceRestore,
  verifyMarketplaceBackup,
  verifyMarketplaceRecoveryState
} from '@open-pencil/marketplace'
import { signPluginManifest } from '@open-pencil/plugin-contracts'
import { canonicalManifestValue, exportEd25519PublicKeyPem } from '@open-pencil/scene-graph'

import { pluginPayload } from '../plugins/helpers'
import { recordTestMarketplacePublication } from './publication/helpers'

const NOW = '2026-08-22T00:00:00.000Z'
const BEFORE = '2026-08-21T23:59:00.000Z'
const INTEGRITY_SECRET = new TextEncoder().encode('phase-8-dedicated-backup-integrity-secret-0001')
const INCOMPLETE_GENERATION_FILE = '.openpencil-marketplace-incomplete'
const directories: string[] = []

function temporaryDirectory(label: string): string {
  const directory = join(tmpdir(), `openpencil-marketplace-${label}-${randomUUID()}`)
  directories.push(directory)
  return directory
}

async function keyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])
}

function integrity(secret: Uint8Array = INTEGRITY_SECRET) {
  return { keyId: 'phase8.backup.integrity', secret }
}

function reservationPath(generation: string): string {
  return join(dirname(generation), `.${basename(generation)}${INCOMPLETE_GENERATION_FILE}`)
}

function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(canonicalManifestValue(value))}\n`)
}

async function downgradeBackupDatabase(
  backup: string,
  manifest: Awaited<ReturnType<typeof createMarketplaceBackup>>,
  schemaVersion: 3 | 4
): Promise<void> {
  const databasePath = join(backup, 'marketplace.sqlite')
  const database = new Database(databasePath, { strict: true })
  try {
    database.exec('BEGIN IMMEDIATE')
    database.exec('DROP TABLE marketplace_publication_completion_receipts')
    if (schemaVersion === 3) database.exec('DROP TABLE marketplace_publication_reservation')
    database
      .query('UPDATE marketplace_state SET schema_version = ? WHERE id = 1')
      .run(schemaVersion)
    database.exec('COMMIT')
  } catch (error) {
    database.exec('ROLLBACK')
    throw error
  } finally {
    database.close(false)
  }

  const databaseBytes = await readFile(databasePath)
  const { integrity: _previousIntegrity, ...previousUnsigned } = manifest
  const unsigned = {
    ...previousUnsigned,
    database: {
      ...previousUnsigned.database,
      digest: createHash('sha256').update(databaseBytes).digest('base64url'),
      byteLength: databaseBytes.byteLength
    }
  }
  const nextManifest = {
    ...unsigned,
    integrity: {
      algorithm: 'HMAC-SHA256' as const,
      keyId: manifest.integrity.keyId,
      digest: createHmac('sha256', INTEGRITY_SECRET)
        .update(canonicalBytes(unsigned))
        .digest('base64url')
    }
  }
  await writeFile(join(backup, 'manifest.json'), canonicalBytes(nextManifest))
}

async function fixture() {
  const rootDirectory = temporaryDirectory('phase8-source')
  const databasePath = join(rootDirectory, 'marketplace.sqlite')
  const artifactPath = join(rootDirectory, 'artifacts')
  const repository = createSqliteMarketplaceRepository({
    path: databasePath,
    now: () => Date.parse(NOW)
  })
  const artifacts = createFileMarketplaceArtifactStore(artifactPath)
  const root = await keyPair()
  const publisher = await keyPair()
  const service = createMarketplaceService({
    repository,
    artifacts,
    marketplaceId: 'openpencil-marketplace',
    publicBaseUrl: 'https://plugins.example.com/',
    now: () => new Date(NOW),
    root: {
      keyId: 'marketplace-root-2026',
      publicKey: root.publicKey
    }
  })

  await service.registerPublisher(
    {
      publisher: { id: 'acme', displayName: 'Acme Plugins' },
      key: {
        keyId: 'acme.release',
        publisherId: 'acme',
        publicKeyPem: await exportEd25519PublicKeyPem(publisher.publicKey),
        notBefore: '2026-01-01T00:00:00.000Z',
        notAfter: '2027-01-01T00:00:00.000Z'
      }
    },
    { actor: 'publisher:acme', time: BEFORE }
  )
  await service.transitionPublisherKey('acme.release', 'active', {
    actor: 'operator:test',
    time: BEFORE
  })
  await service.transitionPublisher('acme', 'active', {
    actor: 'operator:test',
    time: BEFORE
  })
  await service.requestOwnership('acme.analytics', 'acme', {
    actor: 'publisher:acme',
    time: BEFORE
  })
  await service.transitionOwnership('acme.analytics', 'active', {
    actor: 'operator:test',
    time: NOW
  })
  const manifest = await signPluginManifest(pluginPayload(), publisher.privateKey)
  const submission = await service.submit(
    {
      id: 'submission-phase8',
      publisherId: 'acme',
      channel: 'stable',
      manifest,
      listing: {
        displayName: 'Analytics',
        summary: 'Recovery-verified analytics plugin.',
        description: 'An immutable artifact fixture for backup and restore tests.',
        categories: ['analytics'],
        iconUrl: null,
        homepageUrl: null
      }
    },
    { actor: 'publisher:acme', time: NOW }
  )
  await service.transitionSubmission(submission.id, 'approved', {
    actor: 'operator:test',
    time: NOW
  })
  await service.publishSubmission(submission.id, { actor: 'operator:test', time: NOW })
  await recordTestMarketplacePublication({
    repository,
    artifacts,
    marketplaceId: 'openpencil-marketplace',
    publicBaseUrl: 'https://plugins.example.com/',
    rootKeyId: 'marketplace-root-2026',
    rootPrivateKey: root.privateKey,
    rootPublicKey: root.publicKey,
    generatedAt: NOW,
    actor: 'operator:test'
  })
  expect(
    await repository.nonces.consume(
      'publisher-request-v2',
      'acme',
      'phase8-restored-nonce',
      Date.parse('2026-08-22T00:01:00.000Z')
    )
  ).toBe(true)

  return { artifacts, databasePath, repository, root, service }
}

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .flatMap((directory) => [
        rm(directory, { recursive: true, force: true }),
        rm(reservationPath(directory), { force: true })
      ])
  )
})

describe('Phase 8 Marketplace backup and new-generation restore', () => {
  for (const schemaVersion of [3, 4] as const) {
    test(`verifies and restores a valid schema-v${schemaVersion} backup`, async () => {
      const source = await fixture()
      const backup = temporaryDirectory(`phase8-schema-v${schemaVersion}-backup`)
      const restored = temporaryDirectory(`phase8-schema-v${schemaVersion}-restored`)
      const manifest = await createMarketplaceBackup({
        repository: source.repository,
        artifacts: source.artifacts,
        destination: backup,
        marketplaceId: 'openpencil-marketplace',
        publicBaseUrl: 'https://plugins.example.com/',
        root: { keyId: 'marketplace-root-2026', publicKey: source.root.publicKey },
        integrity: integrity(),
        now: () => new Date(NOW)
      })
      await downgradeBackupDatabase(backup, manifest, schemaVersion)

      const verified = await verifyMarketplaceBackup({
        source: backup,
        marketplaceId: 'openpencil-marketplace',
        publicBaseUrl: 'https://plugins.example.com/',
        root: { keyId: 'marketplace-root-2026', publicKey: source.root.publicKey },
        integrity: integrity(),
        now: () => new Date(NOW)
      })
      expect(verified.state.publications).toHaveLength(1)

      await prepareMarketplaceRestore({
        source: backup,
        destination: restored,
        marketplaceId: 'openpencil-marketplace',
        publicBaseUrl: 'https://plugins.example.com/',
        root: { keyId: 'marketplace-root-2026', publicKey: source.root.publicKey },
        integrity: integrity(),
        now: () => new Date(NOW)
      })
      const repository = createSqliteMarketplaceRepository({
        path: join(restored, 'marketplace.sqlite'),
        now: () => Date.parse(NOW)
      })
      expect((await repository.snapshot()).publications).toHaveLength(1)
      await repository.close()
      await source.repository.close()
    })
  }

  test('backs up exact referenced artifacts, verifies publication anchors, and preserves nonces', async () => {
    const source = await fixture()
    const backup = temporaryDirectory('phase8-backup')
    const restored = temporaryDirectory('phase8-restored')

    const created = await createMarketplaceBackup({
      repository: source.repository,
      artifacts: source.artifacts,
      destination: backup,
      marketplaceId: 'openpencil-marketplace',
      publicBaseUrl: 'https://plugins.example.com/',
      root: { keyId: 'marketplace-root-2026', publicKey: source.root.publicKey },
      integrity: integrity(),
      now: () => new Date(NOW)
    })
    expect(created.artifacts).toHaveLength(4)
    expect(created.checkpoint.latestPublication?.sequence).toBe(1)
    expect((await readdir(join(backup, 'artifacts'))).sort()).toEqual(
      created.artifacts.map(({ digest }) => `${digest}.blob`)
    )

    const verified = await verifyMarketplaceBackup({
      source: backup,
      marketplaceId: 'openpencil-marketplace',
      publicBaseUrl: 'https://plugins.example.com/',
      root: { keyId: 'marketplace-root-2026', publicKey: source.root.publicKey },
      integrity: integrity(),
      now: () => new Date(NOW)
    })
    expect(verified.state.auditEvents.at(-1)?.action).toBe('publication.recorded')
    expect(verified.stale).toBe(false)
    expect(
      (
        await verifyMarketplaceBackup({
          source: backup,
          marketplaceId: 'openpencil-marketplace',
          publicBaseUrl: 'https://plugins.example.com/',
          root: { keyId: 'marketplace-root-2026', publicKey: source.root.publicKey },
          integrity: integrity(),
          now: () => new Date('2030-01-01T00:00:00.000Z')
        })
      ).stale
    ).toBe(true)

    const prepared = await prepareMarketplaceRestore({
      source: backup,
      destination: restored,
      marketplaceId: 'openpencil-marketplace',
      publicBaseUrl: 'https://plugins.example.com/',
      root: { keyId: 'marketplace-root-2026', publicKey: source.root.publicKey },
      integrity: integrity(),
      now: () => new Date(NOW)
    })
    expect(prepared.manifest.integrity.keyId).toBe('phase8.backup.integrity')

    const repository = createSqliteMarketplaceRepository({
      path: join(restored, 'marketplace.sqlite'),
      now: () => Date.parse(NOW)
    })
    expect(
      await repository.nonces.consume(
        'publisher-request-v2',
        'acme',
        'phase8-restored-nonce',
        Date.parse('2026-08-22T00:01:00.000Z')
      )
    ).toBe(false)
    const restoredService = createMarketplaceService({
      repository,
      artifacts: createFileMarketplaceArtifactStore(join(restored, 'artifacts')),
      marketplaceId: 'openpencil-marketplace',
      publicBaseUrl: 'https://plugins.example.com/',
      now: () => new Date(NOW),
      root: { keyId: 'marketplace-root-2026', publicKey: source.root.publicKey }
    })
    expect((await restoredService.latestVerifiedSnapshot())?.snapshot.sequence).toBe(1)
    await repository.close()
    await source.repository.close()
  })

  test('rejects wrong keys plus extra, missing, symlinked, and tampered files', async () => {
    const source = await fixture()
    const backup = temporaryDirectory('phase8-tamper')
    const manifest = await createMarketplaceBackup({
      repository: source.repository,
      artifacts: source.artifacts,
      destination: backup,
      marketplaceId: 'openpencil-marketplace',
      publicBaseUrl: 'https://plugins.example.com/',
      root: { keyId: 'marketplace-root-2026', publicKey: source.root.publicKey },
      integrity: integrity(),
      now: () => new Date(NOW)
    })
    const base = {
      source: backup,
      marketplaceId: 'openpencil-marketplace',
      publicBaseUrl: 'https://plugins.example.com/',
      root: { keyId: 'marketplace-root-2026', publicKey: source.root.publicKey },
      now: () => new Date(NOW)
    }

    await expect(
      verifyMarketplaceBackup({
        ...base,
        integrity: integrity(new TextEncoder().encode('wrong-phase8-integrity-secret-000000000000'))
      })
    ).rejects.toThrow(/integrity/i)

    await writeFile(join(backup, 'unexpected-root-entry'), 'extra')
    await expect(verifyMarketplaceBackup({ ...base, integrity: integrity() })).rejects.toThrow(
      /unexpected root entries/i
    )
    await rm(join(backup, 'unexpected-root-entry'))

    await writeFile(join(backup, 'artifacts', `${'A'.repeat(43)}.blob`), 'extra')
    await expect(verifyMarketplaceBackup({ ...base, integrity: integrity() })).rejects.toThrow(
      /unexpected artifact/i
    )
    await rm(join(backup, 'artifacts', `${'A'.repeat(43)}.blob`))

    const referencedPath = join(backup, 'artifacts', `${manifest.artifacts[0]?.digest}.blob`)
    const referencedBytes = await readFile(referencedPath)
    await rm(referencedPath)
    await expect(verifyMarketplaceBackup({ ...base, integrity: integrity() })).rejects.toThrow(
      /missing an artifact/i
    )
    const linkTargetDirectory = temporaryDirectory('phase8-link-target')
    await mkdir(linkTargetDirectory, { recursive: true })
    const linkTarget = join(linkTargetDirectory, 'artifact.blob')
    await writeFile(linkTarget, referencedBytes)
    await symlink(linkTarget, referencedPath)
    await expect(verifyMarketplaceBackup({ ...base, integrity: integrity() })).rejects.toThrow(
      /unexpected artifact/i
    )
    await rm(referencedPath)
    await link(linkTarget, referencedPath)
    await expect(verifyMarketplaceBackup({ ...base, integrity: integrity() })).rejects.toThrow(
      /single-link|hard link|multiply linked/i
    )
    await rm(referencedPath)
    await writeFile(referencedPath, referencedBytes)

    const snapshotDigest = manifest.checkpoint.latestPublication?.snapshotArtifactDigest
    expect(snapshotDigest).toBeString()
    await writeFile(join(backup, 'artifacts', `${snapshotDigest}.blob`), 'tampered')
    await expect(verifyMarketplaceBackup({ ...base, integrity: integrity() })).rejects.toThrow(
      /digest|length/i
    )
    await source.repository.close()
  })

  test('rejects both in-generation and sibling incomplete markers', async () => {
    const source = await fixture()
    const backup = temporaryDirectory('phase8-incomplete-marker')
    await createMarketplaceBackup({
      repository: source.repository,
      artifacts: source.artifacts,
      destination: backup,
      marketplaceId: 'openpencil-marketplace',
      publicBaseUrl: 'https://plugins.example.com/',
      root: { keyId: 'marketplace-root-2026', publicKey: source.root.publicKey },
      integrity: integrity(),
      now: () => new Date(NOW)
    })
    const options = {
      source: backup,
      marketplaceId: 'openpencil-marketplace',
      publicBaseUrl: 'https://plugins.example.com/',
      root: { keyId: 'marketplace-root-2026', publicKey: source.root.publicKey },
      integrity: integrity(),
      now: () => new Date(NOW)
    }

    await writeFile(join(backup, INCOMPLETE_GENERATION_FILE), 'incomplete\n', { mode: 0o600 })
    await expect(verifyMarketplaceBackup(options)).rejects.toThrow(/incomplete/i)
    await rm(join(backup, INCOMPLETE_GENERATION_FILE))
    await writeFile(reservationPath(backup), 'incomplete\n', { mode: 0o600 })
    await expect(verifyMarketplaceBackup(options)).rejects.toThrow(/incomplete|reservation/i)
    expect(() =>
      createSqliteMarketplaceRepository({ path: join(backup, 'marketplace.sqlite') })
    ).toThrow(/incomplete|reservation/i)
    await source.repository.close()
  })

  test('rejects publication records that do not match the signed snapshot and audit anchor', async () => {
    const source = await fixture()
    const state = structuredClone(await source.service.snapshot())
    const publication = state.publications[0]
    expect(publication).toBeDefined()
    const catalog = publication.catalogs[0]
    expect(catalog).toBeDefined()
    const tampered = {
      ...state,
      publications: [
        {
          ...publication,
          catalogs: [{ ...catalog, catalogDigest: 'A'.repeat(43) }]
        }
      ]
    }

    await expect(
      verifyMarketplaceRecoveryState(tampered, source.artifacts, {
        marketplaceId: 'openpencil-marketplace',
        publicBaseUrl: 'https://plugins.example.com/',
        root: { keyId: 'marketplace-root-2026', publicKey: source.root.publicKey },
        now: () => new Date(NOW)
      })
    ).rejects.toThrow(/catalog set|snapshot anchor|audit event anchor/i)
    await source.repository.close()
  })

  test.each([
    ['table', 'CREATE TABLE phase8_unexpected_table (value TEXT)'],
    [
      'index',
      'CREATE INDEX phase8_unexpected_index ON marketplace_nonces (subject_id, expires_at)'
    ],
    [
      'trigger',
      'CREATE TRIGGER phase8_unexpected_trigger AFTER INSERT ON marketplace_nonces BEGIN DELETE FROM marketplace_nonces WHERE 0; END'
    ],
    ['view', 'CREATE VIEW phase8_unexpected_view AS SELECT subject_id FROM marketplace_nonces']
  ])('rejects an unexpected SQLite user %s from backup verification', async (_kind, sql) => {
    const source = await fixture()
    const backup = temporaryDirectory(`phase8-extra-schema-${_kind}`)
    const database = new Database(source.databasePath, { strict: true })
    try {
      database.exec(sql)
    } finally {
      database.close(false)
    }

    try {
      await expect(
        createMarketplaceBackup({
          repository: source.repository,
          artifacts: source.artifacts,
          destination: backup,
          marketplaceId: 'openpencil-marketplace',
          publicBaseUrl: 'https://plugins.example.com/',
          root: { keyId: 'marketplace-root-2026', publicKey: source.root.publicKey },
          integrity: integrity(),
          now: () => new Date(NOW)
        })
      ).rejects.toThrow(/SQLite.*schema|schema.*SQLite/i)
    } finally {
      await source.repository.close()
    }
  })

  test('rejects a same-name state table that drops the id CHECK and adds a column', async () => {
    const source = await fixture()
    const backup = temporaryDirectory('phase8-altered-schema')
    const database = new Database(source.databasePath, { strict: true })
    try {
      database.exec(`
        ALTER TABLE marketplace_state RENAME TO marketplace_state_previous;
        CREATE TABLE marketplace_state (
          id INTEGER PRIMARY KEY,
          schema_version INTEGER NOT NULL,
          state_json TEXT NOT NULL,
          unexpected TEXT
        );
        INSERT INTO marketplace_state (id, schema_version, state_json)
          SELECT id, schema_version, state_json FROM marketplace_state_previous;
        DROP TABLE marketplace_state_previous;
      `)
    } finally {
      database.close(false)
    }

    try {
      await expect(
        createMarketplaceBackup({
          repository: source.repository,
          artifacts: source.artifacts,
          destination: backup,
          marketplaceId: 'openpencil-marketplace',
          publicBaseUrl: 'https://plugins.example.com/',
          root: { keyId: 'marketplace-root-2026', publicKey: source.root.publicKey },
          integrity: integrity(),
          now: () => new Date(NOW)
        })
      ).rejects.toThrow(/SQLite.*schema|schema.*SQLite/i)
    } finally {
      await source.repository.close()
    }
  })

  test('rejects a same-name expiry index with changed uniqueness and column order', async () => {
    const source = await fixture()
    const backup = temporaryDirectory('phase8-altered-index')
    const database = new Database(source.databasePath, { strict: true })
    try {
      database.exec(`
        DROP INDEX marketplace_nonces_expiry;
        CREATE UNIQUE INDEX marketplace_nonces_expiry
          ON marketplace_nonces (subject_id, expires_at);
      `)
    } finally {
      database.close(false)
    }

    try {
      await expect(
        createMarketplaceBackup({
          repository: source.repository,
          artifacts: source.artifacts,
          destination: backup,
          marketplaceId: 'openpencil-marketplace',
          publicBaseUrl: 'https://plugins.example.com/',
          root: { keyId: 'marketplace-root-2026', publicKey: source.root.publicKey },
          integrity: integrity(),
          now: () => new Date(NOW)
        })
      ).rejects.toThrow(/SQLite.*schema|schema.*SQLite/i)
    } finally {
      await source.repository.close()
    }
  })

  test('never overwrites an existing or in-place restore destination', async () => {
    const source = await fixture()
    const backup = temporaryDirectory('phase8-no-overwrite')
    await createMarketplaceBackup({
      repository: source.repository,
      artifacts: source.artifacts,
      destination: backup,
      marketplaceId: 'openpencil-marketplace',
      publicBaseUrl: 'https://plugins.example.com/',
      root: { keyId: 'marketplace-root-2026', publicKey: source.root.publicKey },
      integrity: integrity(),
      now: () => new Date(NOW)
    })
    const options = {
      source: backup,
      marketplaceId: 'openpencil-marketplace',
      publicBaseUrl: 'https://plugins.example.com/',
      root: { keyId: 'marketplace-root-2026', publicKey: source.root.publicKey },
      integrity: integrity(),
      now: () => new Date(NOW)
    }

    await expect(prepareMarketplaceRestore({ ...options, destination: backup })).rejects.toThrow(
      /overlap|in-place/i
    )
    await expect(
      prepareMarketplaceRestore({ ...options, destination: join(backup, 'nested-generation') })
    ).rejects.toThrow(/overlap|in-place/i)
    const aliasedParent = temporaryDirectory('phase8-aliased-parent')
    await symlink(backup, aliasedParent, 'dir')
    await expect(
      prepareMarketplaceRestore({ ...options, destination: join(aliasedParent, 'generation') })
    ).rejects.toThrow(/overlap|in-place|symbolic link/i)
    const existing = temporaryDirectory('phase8-existing')
    await mkdir(existing, { recursive: true })
    await expect(prepareMarketplaceRestore({ ...options, destination: existing })).rejects.toThrow(
      /already exists/i
    )
    await expect(
      createMarketplaceBackup({
        repository: source.repository,
        artifacts: source.artifacts,
        destination: backup,
        marketplaceId: 'openpencil-marketplace',
        publicBaseUrl: 'https://plugins.example.com/',
        root: { keyId: 'marketplace-root-2026', publicKey: source.root.publicKey },
        integrity: integrity(),
        now: () => new Date(NOW)
      })
    ).rejects.toThrow(/already exists/i)
    await source.repository.close()
  })

  test('does not replace an empty backup destination created after preflight', async () => {
    const source = await fixture()
    const backup = temporaryDirectory('phase8-raced-backup')
    let destinationCreated = false
    const racingArtifacts = {
      put: (bytes: Uint8Array) => source.artifacts.put(bytes),
      async get(digest: string) {
        if (!destinationCreated) {
          await mkdir(backup, { mode: 0o700 })
          destinationCreated = true
        }
        return source.artifacts.get(digest)
      }
    }

    try {
      await expect(
        createMarketplaceBackup({
          repository: source.repository,
          artifacts: racingArtifacts,
          destination: backup,
          marketplaceId: 'openpencil-marketplace',
          publicBaseUrl: 'https://plugins.example.com/',
          root: { keyId: 'marketplace-root-2026', publicKey: source.root.publicKey },
          integrity: integrity(),
          now: () => new Date(NOW)
        })
      ).rejects.toThrow(/already exists|reservation/i)
      expect(await readdir(backup)).toEqual([])
      expect(await readFile(reservationPath(backup), 'utf8')).toBe('incomplete\n')
      expect(() =>
        createSqliteMarketplaceRepository({ path: join(backup, 'marketplace.sqlite') })
      ).toThrow(/incomplete|reservation/i)
    } finally {
      await source.repository.close()
    }
  })

  test('does not replace an empty restore destination created after preflight', async () => {
    const source = await fixture()
    const backup = temporaryDirectory('phase8-raced-restore-source')
    const restored = temporaryDirectory('phase8-raced-restore-target')
    await createMarketplaceBackup({
      repository: source.repository,
      artifacts: source.artifacts,
      destination: backup,
      marketplaceId: 'openpencil-marketplace',
      publicBaseUrl: 'https://plugins.example.com/',
      root: { keyId: 'marketplace-root-2026', publicKey: source.root.publicKey },
      integrity: integrity(),
      now: () => new Date(NOW)
    })
    let destinationCreated = false

    try {
      await expect(
        prepareMarketplaceRestore({
          source: backup,
          destination: restored,
          marketplaceId: 'openpencil-marketplace',
          publicBaseUrl: 'https://plugins.example.com/',
          root: { keyId: 'marketplace-root-2026', publicKey: source.root.publicKey },
          integrity: integrity(),
          now: () => {
            if (!destinationCreated) {
              mkdirSync(restored, { mode: 0o700 })
              destinationCreated = true
            }
            return new Date(NOW)
          }
        })
      ).rejects.toThrow(/already exists|reservation/i)
      expect(await readdir(restored)).toEqual([])
      expect(await readFile(reservationPath(restored), 'utf8')).toBe('incomplete\n')
      expect(() =>
        createSqliteMarketplaceRepository({ path: join(restored, 'marketplace.sqlite') })
      ).toThrow(/incomplete|reservation/i)
    } finally {
      await source.repository.close()
    }
  })
})
