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
    const publisher = marketplaceCommand.subCommands?.publisher
    expect(publisher?.meta?.name).toBe('publisher')
    expect(publisher?.subCommands?.create.meta?.name).toBe('create')
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

  test('keeps admin HTTP and online signing independently opt-in', () => {
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
})
