import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MotionExportCancelledError } from '@open-pencil/core/io/motion-export'

import { writeToolOutput } from '#mcp/tool/output'

const root = join(tmpdir(), `open-pencil-motion-output-${randomUUID()}`)
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

function result(base64 = png.toString('base64')) {
  return {
    format: 'png-sequence',
    manifest: { version: 1, format: 'png-sequence', frameCount: 1 },
    frames: [{ file: 'frame-0000.png', base64, byteLength: png.length }]
  }
}

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('MCP Motion output adapter', () => {
  test('atomically writes a PNG sequence and manifest inside the configured root', async () => {
    await mkdir(root, { recursive: true })
    const output = await writeToolOutput('export_motion_animation', result(), 'walk-cycle', root)

    expect(output?.isError).toBeUndefined()
    expect(await readFile(join(root, 'walk-cycle', 'frame-0000.png'))).toEqual(png)
    expect(JSON.parse(await readFile(join(root, 'walk-cycle', 'manifest.json'), 'utf8'))).toEqual(
      result().manifest
    )
    expect((await readdir(root)).filter((name) => name.includes('.tmp-'))).toEqual([])
  })

  test('preserves an existing destination and cleans temporary output on failure', async () => {
    const destination = join(root, 'walk-cycle')
    await mkdir(destination, { recursive: true })
    await writeFile(join(destination, 'keep.txt'), 'keep', 'utf8')

    await expect(
      writeToolOutput('export_motion_animation', result(), destination, root)
    ).rejects.toThrow('already exists')
    expect(await readFile(join(destination, 'keep.txt'), 'utf8')).toBe('keep')

    await rm(destination, { recursive: true, force: true })
    const invalid = Buffer.from('not png').toString('base64')
    await expect(
      writeToolOutput('export_motion_animation', result(invalid), destination, root)
    ).rejects.toThrow('not valid PNG')
    expect(await readdir(root)).toEqual([])
  })

  test('rejects malformed PNG sequence results without falling through to a raw write', async () => {
    await mkdir(root, { recursive: true })

    await expect(
      writeToolOutput(
        'export_motion_animation',
        { format: 'png-sequence', manifest: { version: 1 }, frames: [] },
        'empty-sequence',
        root
      )
    ).rejects.toThrow('malformed')
    expect(await readdir(root)).toEqual([])
  })

  test('atomically writes a capability-provided encoded animation', async () => {
    await mkdir(root, { recursive: true })
    const gif = Buffer.from('GIF89a-real-encoder-bytes', 'ascii')
    const output = await writeToolOutput(
      'export_motion_animation',
      {
        format: 'gif',
        base64: gif.toString('base64'),
        encoder: 'test GIF encoder'
      },
      'animation.gif',
      root
    )

    expect(output?.isError).toBeUndefined()
    expect(await readFile(join(root, 'animation.gif'))).toEqual(gif)
    expect((await readdir(root)).filter((name) => name.includes('.tmp-'))).toEqual([])
  })

  test('never overwrites an encoded animation when MCP writers race', async () => {
    await mkdir(root, { recursive: true })
    const left = Buffer.from('GIF89a-left', 'ascii')
    const right = Buffer.from('GIF89a-right', 'ascii')
    const write = (bytes: Buffer) =>
      writeToolOutput(
        'export_motion_animation',
        { format: 'gif', base64: bytes.toString('base64'), encoder: 'race encoder' },
        'animation.gif',
        root
      )

    const settled = await Promise.allSettled([write(left), write(right)])

    expect(settled.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(settled.filter(({ status }) => status === 'rejected')).toHaveLength(1)
    expect([left.toString('ascii'), right.toString('ascii')]).toContain(
      (await readFile(join(root, 'animation.gif'))).toString('ascii')
    )
    expect((await readdir(root)).filter((name) => name.includes('.tmp-'))).toEqual([])
  })

  test('cleans temporary sequence output when cancellation arrives during writing', async () => {
    await mkdir(root, { recursive: true })
    const controller = new AbortController()
    const frameCount = 2_000
    const manyFrames = {
      format: 'png-sequence',
      manifest: { version: 1, format: 'png-sequence', frameCount },
      frames: Array.from({ length: frameCount }, (_, index) => ({
        file: `frame-${String(index).padStart(4, '0')}.png`,
        base64: png.toString('base64'),
        byteLength: png.length
      }))
    }
    const writing = writeToolOutput(
      'export_motion_animation',
      manyFrames,
      'cancelled-sequence',
      root,
      controller.signal
    )
    let sawTemporary = false
    for (let attempt = 0; attempt < 100; attempt++) {
      if ((await readdir(root)).some((name) => name.includes('.tmp-'))) {
        sawTemporary = true
        break
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 1)
      })
    }
    expect(sawTemporary).toBe(true)
    controller.abort()

    await expect(writing).rejects.toBeInstanceOf(MotionExportCancelledError)
    expect(await readdir(root)).toEqual([])
  })
})
