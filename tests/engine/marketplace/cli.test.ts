import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { isMarketplaceLoopbackHost, resolveMarketplaceServeMode } from '@open-pencil/marketplace'
import { marketplaceCommand } from '@open-pencil/marketplace/cli'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('marketplace CLI', () => {
  test('declares stable nested command names instead of deriving them from the entrypoint path', () => {
    const commands = marketplaceCommand.subCommands
    if (!commands) throw new Error('Marketplace CLI must declare subcommands')
    const publisher = commands.publisher
    const publication = commands.publication
    if (!publisher.subCommands || !publication.subCommands) {
      throw new Error('Marketplace CLI nested commands are missing')
    }
    expect(publisher.meta?.name).toBe('publisher')
    expect(publisher.subCommands.create.meta?.name).toBe('create')
    expect(commands.serve.args?.['require-admin-assertion']).toMatchObject({
      type: 'boolean',
      default: false
    })
    expect(commands.serve.args?.['require-admin-assertion']?.description).toContain(
      'mutations always require V2 operator assertions'
    )
    expect(publication.meta?.name).toBe('publication')
    expect(Object.keys(publication.subCommands)).toEqual([
      'request',
      'reserve',
      'cancel',
      'inspect',
      'signer-init',
      'sign',
      'import'
    ])
    expect(publication.subCommands.sign.args?.['approve-request-digest']).toMatchObject({
      type: 'string',
      required: true
    })
    expect(publication.subCommands.cancel.args?.['approve-request-digest']).toMatchObject({
      type: 'string',
      required: true
    })
    expect(publication.subCommands.cancel.args?.reason).toMatchObject({
      type: 'string',
      required: true
    })
  })

  test('initializes local state without printing private key material', async () => {
    const directory = join(tmpdir(), `openpencil-marketplace-cli-${randomUUID()}`)
    temporaryDirectories.push(directory)
    const database = join(directory, 'state.sqlite')
    const artifacts = join(directory, 'artifacts')
    const child = Bun.spawn(
      [
        process.execPath,
        'packages/marketplace/src/cli.ts',
        'init',
        '--database',
        database,
        '--artifacts',
        artifacts,
        '--marketplace-id',
        'test-marketplace',
        '--public-base-url',
        'https://plugins.example.com/',
        '--json'
      ],
      { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' }
    )
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text()
    ])

    expect(exitCode).toBe(0)
    expect(stderr).toBe('')
    expect(JSON.parse(stdout)).toMatchObject({
      marketplaceId: 'test-marketplace',
      schemaVersion: 1
    })
    expect(stdout).not.toContain('PRIVATE KEY')
    expect((await stat(database)).isFile()).toBe(true)
  })

  test('recognizes only local loopback hosts for admin HTTP routes', () => {
    expect(isMarketplaceLoopbackHost('127.0.0.1')).toBe(true)
    expect(isMarketplaceLoopbackHost('::1')).toBe(true)
    expect(isMarketplaceLoopbackHost('localhost')).toBe(true)
    expect(isMarketplaceLoopbackHost('0.0.0.0')).toBe(false)
    expect(isMarketplaceLoopbackHost('192.168.1.4')).toBe(false)
  })

  test('validates legacy serve mode inputs before CLI policy is applied', () => {
    expect(resolveMarketplaceServeMode('0.0.0.0', false, false)).toEqual({
      adminEnabled: false,
      onlineSigning: false
    })
    expect(resolveMarketplaceServeMode('127.0.0.1', true, false)).toEqual({
      adminEnabled: true,
      onlineSigning: false
    })
    expect(resolveMarketplaceServeMode('127.0.0.1', true, true)).toEqual({
      adminEnabled: true,
      onlineSigning: true
    })
    expect(() => resolveMarketplaceServeMode('0.0.0.0', true, false)).toThrow(
      'only allowed on an explicit loopback host'
    )
    expect(() => resolveMarketplaceServeMode('127.0.0.1', false, true)).toThrow(
      'requires explicit --enable-admin'
    )
  })

  test('rejects online root signing before loading an admin token or private key', async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        'packages/marketplace/src/cli.ts',
        'serve',
        '--enable-admin',
        '--enable-online-signing'
      ],
      { cwd: process.cwd(), stdout: 'pipe', stderr: 'pipe' }
    )
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text()
    ])

    expect(exitCode).not.toBe(0)
    expect(stdout).toBe('')
    expect(stderr).toContain(
      'Online marketplace signing over HTTP is disabled; use the publication request/sign/import workflow'
    )
  })

  test('fails closed on the legacy direct Root-signing command before reading keys', async () => {
    const child = Bun.spawn([process.execPath, 'packages/marketplace/src/cli.ts', 'publish'], {
      cwd: process.cwd(),
      stdout: 'pipe',
      stderr: 'pipe'
    })
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text()
    ])

    expect(exitCode).not.toBe(0)
    expect(stdout).toBe('')
    expect(stderr).toContain('Direct marketplace publishing is disabled')
    expect(stderr).not.toContain('private key')
  })
})
