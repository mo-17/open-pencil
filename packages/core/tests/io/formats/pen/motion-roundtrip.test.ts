import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { advancedMotionSpec } from '#core-tests/helpers/motion-v3-advanced'
import * as v from 'valibot'

import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import { parsePenFile, writePenFile } from '@open-pencil/pen'
import { componentSubtreeVersion } from '@open-pencil/scene-graph'

const source =
  JSON.stringify(
    {
      version: '2.14',
      futureDocumentSetting: { version: 8, opaque: ['do', 'retain'] },
      children: [
        {
          id: 'button',
          type: 'frame',
          name: 'Button',
          reusable: true,
          width: 120,
          height: 40,
          futureNodeSetting: { version: 9, enabled: true },
          children: [{ id: 'label', type: 'text', content: 'Go' }]
        }
      ]
    },
    null,
    2
  ) + '\n'
const SourceMetadata = v.looseObject({
  futureDocumentSetting: v.object({ version: v.number(), opaque: v.array(v.string()) }),
  children: v.array(
    v.looseObject({
      id: v.string(),
      futureNodeSetting: v.object({ version: v.number(), enabled: v.boolean() })
    })
  )
})

test('ordinary .pen IO derives geometry while preserving Motion-only source writes', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pen-io-motion-roundtrip-'))
  try {
    const originalPath = join(directory, 'original.pen')
    const copyPath = join(directory, 'motion-copy.pen')
    const rejectedPath = join(directory, 'rejected-geometry.pen')
    writeFileSync(originalPath, source)
    const io = new IORegistry(BUILTIN_IO_FORMATS)
    const input = { name: 'original.pen', data: new Uint8Array(readFileSync(originalPath)) }
    const { graph } = await io.readDocumentAs('pen', input)
    const root = graph.getNode('button')
    const label = graph.getNode('label')
    if (!root || !label) throw new Error('Expected source component and text')
    expect(label.width).toBeGreaterThan(0)
    expect(label.source.editedFields).toEqual([])
    const motion = advancedMotionSpec()
    graph.updateNode(root.id, { motion })
    writeFileSync(copyPath, writePenFile(graph))

    const copied = readFileSync(copyPath, 'utf8')
    const metadata = v.parse(v.pipe(v.string(), v.parseJson(), SourceMetadata), copied)
    expect(metadata.futureDocumentSetting).toEqual({ version: 8, opaque: ['do', 'retain'] })
    expect(metadata.children[0].futureNodeSetting).toEqual({ version: 9, enabled: true })
    const reopened = await io.readDocumentAs('pen', {
      name: 'motion-copy.pen',
      data: new TextEncoder().encode(copied)
    })
    expect(reopened.graph.getNode(root.id)?.motion).toEqual(motion)
    expect(reopened.graph.getNode('label')?.width).toBeGreaterThan(0)

    graph.updateNode(root.id, { x: root.x + 1 })
    expect(() => writeFileSync(rejectedPath, writePenFile(graph))).toThrow('unsupported edits')
    expect(existsSync(rejectedPath)).toBe(false)
    expect(readFileSync(originalPath, 'utf8')).toBe(source)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('source-integrity inspection retains the parser geometry and component version', async () => {
  const parsed = parsePenFile(source)
  const io = new IORegistry(BUILTIN_IO_FORMATS)
  const inspected = await io.readDocumentAs(
    'pen',
    {
      name: 'source.pen',
      data: new TextEncoder().encode(source)
    },
    { deriveLayout: false }
  )
  expect(inspected.graph.getNode('label')?.width).toBe(parsed.getNode('label')?.width ?? -1)
  expect(componentSubtreeVersion(inspected.graph, 'button')).toBe(
    componentSubtreeVersion(parsed, 'button')
  )
})
