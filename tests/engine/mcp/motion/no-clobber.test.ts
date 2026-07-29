import { afterEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { publishDirectoryNoClobber, publishFileNoClobber } from '@open-pencil/mcp/motion-export'

const root = join(tmpdir(), `open-pencil-motion-no-clobber-${randomUUID()}`)

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('Motion export no-clobber publication', () => {
  test('atomically publishes exactly one staged file when writers race', async () => {
    await mkdir(root, { recursive: true })
    const left = join(root, '.left.tmp')
    const right = join(root, '.right.tmp')
    const output = join(root, 'animation.webm')
    await Promise.all([writeFile(left, 'left'), writeFile(right, 'right')])

    const settled = await Promise.allSettled([
      publishFileNoClobber(left, output),
      publishFileNoClobber(right, output)
    ])

    expect(settled.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(settled.filter(({ status }) => status === 'rejected')).toHaveLength(1)
    expect(['left', 'right']).toContain(await readFile(output, 'utf8'))
    expect(String(settled.find(({ status }) => status === 'rejected')?.reason)).toContain(
      'already exists'
    )
  })

  test('claims a sequence directory without replacing a racing destination', async () => {
    await mkdir(root, { recursive: true })
    const left = join(root, '.left.tmp')
    const right = join(root, '.right.tmp')
    const output = join(root, 'frames')
    await Promise.all([mkdir(left), mkdir(right)])
    await Promise.all([
      writeFile(join(left, 'winner.txt'), 'left'),
      writeFile(join(right, 'winner.txt'), 'right')
    ])

    const settled = await Promise.allSettled([
      publishDirectoryNoClobber(left, output),
      publishDirectoryNoClobber(right, output)
    ])

    expect(settled.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(settled.filter(({ status }) => status === 'rejected')).toHaveLength(1)
    expect(['left', 'right']).toContain(await readFile(join(output, 'winner.txt'), 'utf8'))
    expect(await readdir(output)).toEqual(['winner.txt'])
  })

  test('never replaces an empty directory created in the publication race window', async () => {
    await mkdir(root, { recursive: true })
    for (let index = 0; index < 64; index++) {
      const staged = join(root, `.race-${index}.tmp`)
      const output = join(root, `frames-${index}`)
      await mkdir(staged)
      await writeFile(join(staged, 'winner.txt'), 'published')

      const settled = await Promise.allSettled([
        publishDirectoryNoClobber(staged, output),
        mkdir(output)
      ])
      expect(settled.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
      if (settled[0].status === 'fulfilled') {
        expect(await readdir(output)).toEqual(['winner.txt'])
      } else {
        expect(await readdir(output)).toEqual([])
      }
      await Promise.all([
        rm(output, { recursive: true, force: true }),
        rm(staged, { recursive: true, force: true })
      ])
    }
  })

  test('preserves an existing empty sequence directory', async () => {
    await mkdir(root, { recursive: true })
    const staged = join(root, '.staged.tmp')
    const output = join(root, 'frames')
    await Promise.all([mkdir(staged), mkdir(output)])
    await writeFile(join(staged, 'frame-0000.png'), 'frame')

    await expect(publishDirectoryNoClobber(staged, output)).rejects.toThrow('already exists')
    expect(await readdir(output)).toEqual([])
    expect(await readdir(staged)).toEqual(['frame-0000.png'])
  })
})
