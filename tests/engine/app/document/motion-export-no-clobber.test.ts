import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { writeTauriMotionFileNoClobber } from '@/app/document/export/motion/use-motion-animation-export'

const root = join(tmpdir(), `open-pencil-tauri-motion-no-clobber-${randomUUID()}`)

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('Tauri Motion export no-clobber writer', () => {
  test('uses the scoped native atomic persist command', async () => {
    await mkdir(root, { recursive: true })
    const output = join(root, 'animation.webm')
    const bytes = new TextEncoder().encode('animation')

    await writeTauriMotionFileNoClobber(output, bytes, async (command, args) => {
      expect(command).toBe('write_motion_export_noclobber')
      await writeFile(args.path, new Uint8Array(args.data), { flag: 'wx' })
    })

    expect(await readFile(output, 'utf8')).toBe('animation')
  })

  test('does not overwrite a target that appears immediately before the exclusive create', async () => {
    await mkdir(root, { recursive: true })
    const output = join(root, 'animation.webm')
    const racer = new TextEncoder().encode('racer')

    await expect(
      writeTauriMotionFileNoClobber(
        output,
        new TextEncoder().encode('export'),
        async (_command, args) => {
          await writeFile(args.path, racer, { flag: 'wx' })
          await writeFile(args.path, new Uint8Array(args.data), { flag: 'wx' })
        }
      )
    ).rejects.toThrow('without replacing')

    expect(await readFile(output, 'utf8')).toBe('racer')
  })

  test('surfaces a native staging failure without creating the final path', async () => {
    await mkdir(root, { recursive: true })
    const output = join(root, 'animation.webm')

    await expect(
      writeTauriMotionFileNoClobber(output, new TextEncoder().encode('export'), async () => {
        throw new Error('injected native staging failure')
      })
    ).rejects.toThrow('without replacing')

    await expect(readFile(output)).rejects.toThrow()
  })
})
