import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parsePenFile, writePenFile } from '@open-pencil/pen'

import { advancedMotionSpec } from '#tests/helpers/motion-v3-advanced'
import { repoPath } from '#tests/helpers/paths'

test('an actual PEN fixture writes Motion to a unique copy and rejects geometry before creating output', () => {
  const inputPath = repoPath('tests/fixtures/pencil_simple.pen')
  const input = readFileSync(inputPath)
  const inputSha256 = createHash('sha256').update(input).digest('hex')
  const directory = mkdtempSync(join(tmpdir(), 'open-pencil-pen-motion-copy-'))
  const graph = parsePenFile(input.toString('utf8'))
  const node = graph.getChildren(graph.getPages()[0].id)[0]
  if (!node) throw new Error('Missing actual PEN fixture node')
  const motion = advancedMotionSpec()
  graph.updateNode(node.id, { motion })
  const copyPath = join(directory, 'motion.pen')
  writeFileSync(copyPath, writePenFile(graph))
  const reopened = parsePenFile(readFileSync(copyPath, 'utf8'))
  const restored = reopened.getNode(node.id)
  expect(restored?.motion).toEqual(motion)
  expect(restored?.name).toBe(node.name)
  expect(restored?.childIds.length).toBe(node.childIds.length)

  graph.updateNode(node.id, { x: node.x + 1 })
  const rejectedPath = join(directory, 'rejected-geometry.pen')
  expect(() => writeFileSync(rejectedPath, writePenFile(graph))).toThrow()
  expect(existsSync(rejectedPath)).toBe(false)
  expect(createHash('sha256').update(readFileSync(inputPath)).digest('hex')).toBe(inputSha256)
  console.info(JSON.stringify({ inputSha256, copyPath, rejectedPath, rejectedOutputExists: false }))
})
