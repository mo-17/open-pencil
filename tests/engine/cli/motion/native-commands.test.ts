import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { BUILTIN_IO_FORMATS, IORegistry } from '@open-pencil/core/io'
import {
  createFigmaNativeMotionApplyRequest,
  createFigmaNativeMotionPlan,
  decodeFigmaMotionSharedPayload,
  encodeFigmaMotionSharedEnvelope,
  type FigmaNativeMotionPlan,
  type FigmaNativeMotionSnapshot
} from '@open-pencil/fig'
import { SceneGraph, type MotionSpec } from '@open-pencil/scene-graph'

import { runOpenPencilCLI } from '#tests/helpers/cli'

const io = new IORegistry(BUILTIN_IO_FORMATS)
const motion: MotionSpec = {
  version: 1,
  tracks: [
    {
      id: 'entrance',
      trigger: 'mount',
      keyframes: [
        { offset: 0, opacity: 0, y: 12 },
        { offset: 1, opacity: 1, y: 0 }
      ],
      timing: { durationMs: 300 }
    }
  ],
  reducedMotion: 'reduce'
}

function readbackSnapshot(
  plan: FigmaNativeMotionPlan,
  input: {
    owned?: boolean
    shared?: boolean
  } = {}
): FigmaNativeMotionSnapshot {
  if (!plan.supported || plan.durationSeconds === undefined) throw new Error('unsupported fixture')
  return {
    animationStyles: [],
    manualKeyframeTracks: Object.fromEntries(
      plan.operations.map((operation) => [
        operation.field.name,
        {
          id: 'binding:' + operation.field.name,
          baseValue: structuredClone(operation.track.baseValue),
          keyframes: operation.track.keyframes.map((keyframe, index) => ({
            id: operation.field.name + ':' + String(index),
            timelinePosition: keyframe.timelinePosition,
            value: structuredClone(keyframe.value),
            easing: structuredClone(keyframe.easing ?? { type: 'LINEAR' as const })
          }))
        }
      ])
    ),
    timelines: [{ id: 'timeline:1', duration: plan.durationSeconds }],
    ownershipRaw: input.owned
      ? JSON.stringify(createFigmaNativeMotionApplyRequest(plan).ownership)
      : '',
    sharedMotionRaw: input.shared ? encodeFigmaMotionSharedEnvelope(motion) : ''
  }
}

describe('motion native CLI commands', () => {
  const directory = join(tmpdir(), 'openpencil-motion-native-' + randomUUID())
  const designFile = join(directory, 'motion.fig')
  const snapshotFile = join(directory, 'current.json')
  const foreignSnapshotFile = join(directory, 'foreign.json')
  const invalidSnapshotFile = join(directory, 'invalid.json')
  let importedNodeId = ''

  beforeAll(async () => {
    await mkdir(directory, { recursive: true })
    const graph = new SceneGraph()
    const page = graph.getPages()[0]
    const node = graph.createNode('RECTANGLE', page.id, {
      name: 'Native Motion Source',
      opacity: 0.6,
      motion
    })
    const document = await io.writeDocument('fig', graph)
    await Bun.write(designFile, document.data as Uint8Array)
    const found = await runOpenPencilCLI(['find', designFile, '--name', node.name, '--json'])
    importedNodeId = (JSON.parse(found.stdout) as Array<{ id: string }>)[0]?.id ?? ''
    if (!importedNodeId) throw new Error('Motion source node was not imported')

    const plan = createFigmaNativeMotionPlan(motion, { nodeOpacity: 0.6 })
    await Bun.write(
      snapshotFile,
      JSON.stringify(readbackSnapshot(plan, { owned: true, shared: true }))
    )
    await Bun.write(foreignSnapshotFile, JSON.stringify(readbackSnapshot(plan)))
    await Bun.write(
      invalidSnapshotFile,
      JSON.stringify({
        animationStyles: [],
        manualKeyframeTracks: {
          FUTURE_PROPERTY: {
            id: 'binding:future',
            baseValue: { type: 'FLOAT', value: 0 },
            keyframes: []
          }
        },
        timelines: [],
        ownershipRaw: '',
        sharedMotionRaw: ''
      })
    )
  })

  afterAll(async () => {
    await rm(directory, { recursive: true, force: true })
  })

  test('inspect imports an owned authoritative shared mirror as structured JSON', async () => {
    const result = await runOpenPencilCLI(['motion', 'inspect', snapshotFile, '--json'])

    expect(result).toMatchObject({ exitCode: 0, stderr: '' })
    expect(JSON.parse(result.stdout)).toMatchObject({
      version: 1,
      source: { file: resolve(snapshotFile) },
      inspection: {
        supported: true,
        source: 'shared-mirror',
        sharedMirror: 'motion',
        ownership: 'valid',
        fields: ['OPACITY', 'TRANSLATION_Y']
      },
      motion
    })
  })

  test('inspect and compare fail closed for unknown native fields', async () => {
    const inspected = await runOpenPencilCLI(['motion', 'inspect', invalidSnapshotFile, '--json'])
    const applied = await runOpenPencilCLI([
      'motion',
      'apply',
      designFile,
      '--node',
      importedNodeId,
      '--current',
      invalidSnapshotFile,
      '--json'
    ])

    expect(inspected).toMatchObject({ exitCode: 1, stderr: '' })
    expect(
      JSON.parse(inspected.stdout).inspection.diagnostics.map(
        (entry: { code: string }) => entry.code
      )
    ).toContain('unknown-property')
    expect(applied).toMatchObject({ exitCode: 1, stderr: '' })
    expect(JSON.parse(applied.stdout)).toMatchObject({
      mode: 'plan',
      comparison: { compareOnly: true, supported: false },
      artifact: null,
      output: null
    })
  })

  test('apply defaults to a compare-only plan and does not emit an artifact', async () => {
    const result = await runOpenPencilCLI([
      'motion',
      'apply',
      designFile,
      '--node',
      importedNodeId,
      '--current',
      snapshotFile,
      '--json'
    ])

    expect(result).toMatchObject({ exitCode: 0, stderr: '' })
    expect(JSON.parse(result.stdout)).toMatchObject({
      version: 1,
      mode: 'plan',
      safety: {
        generatedOnly: true,
        conflictPolicy: 'replace-owned',
        allowTimelineGrowth: false,
        rawTimelineWrite: false
      },
      plan: { supported: true },
      comparison: {
        compareOnly: true,
        supported: true,
        addFields: [],
        updateFields: [],
        removeFields: [],
        ownershipChange: 'update'
      },
      artifact: null,
      output: null
    })
  })

  test('apply emits a guarded data snapshot without raw timeline state', async () => {
    const output = join(directory, 'apply-snapshot.json')
    const result = await runOpenPencilCLI([
      'motion',
      'apply',
      designFile,
      '--node',
      importedNodeId,
      '--current',
      snapshotFile,
      '--emit',
      'snapshot',
      '--target-node',
      '99:42',
      '-o',
      output,
      '--json'
    ])

    expect(result).toMatchObject({ exitCode: 0, stderr: '' })
    const report = JSON.parse(result.stdout)
    const artifact = JSON.parse(await Bun.file(output).text())
    expect(report.output).toBe(resolve(output))
    expect(artifact).toMatchObject({
      schema: 'openpencil.figma-native-motion-apply',
      version: 1,
      generatedOnly: true,
      target: { mode: 'node-id', nodeId: '99:42' },
      request: {
        conflictPolicy: 'replace-owned',
        allowTimelineGrowth: false
      }
    })
    expect(artifact).not.toHaveProperty('timelines')
    expect(artifact).not.toHaveProperty('manualKeyframeTracks')
  })

  test('apply emits only an official Plugin API script when explicitly requested', async () => {
    const result = await runOpenPencilCLI([
      'motion',
      'apply',
      designFile,
      '--node',
      importedNodeId,
      '--emit',
      'script'
    ])

    expect(result).toMatchObject({ exitCode: 0, stderr: '' })
    expect(result.stdout).toStartWith(';(async () => {')
    expect(result.stdout).toContain('applyManualKeyframeTrack')
    expect(result.stdout).toContain('"conflictPolicy": "replace-owned"')
    expect(result.stdout).not.toContain('Figma Desktop was not contacted')
  })

  test('apply never overwrites an artifact when comparison is unsafe', async () => {
    const output = join(directory, 'blocked-apply.json')
    await Bun.write(output, 'sentinel')
    const result = await runOpenPencilCLI([
      'motion',
      'apply',
      designFile,
      '--node',
      importedNodeId,
      '--current',
      invalidSnapshotFile,
      '--emit',
      'snapshot',
      '-o',
      output,
      '--json'
    ])

    expect(result.exitCode).toBe(1)
    expect(JSON.parse(result.stdout)).toMatchObject({ artifact: null, output: null })
    expect(await Bun.file(output).text()).toBe('sentinel')
  })

  test('clear defaults to compare-only and reports verified owned removals', async () => {
    const result = await runOpenPencilCLI(['motion', 'clear', snapshotFile, '--json'])

    expect(result).toMatchObject({ exitCode: 0, stderr: '' })
    expect(JSON.parse(result.stdout)).toMatchObject({
      version: 1,
      mode: 'plan',
      safety: {
        generatedOnly: true,
        compareOnly: true,
        rawTimelineWrite: false,
        nativeClearRequiresVerifiedOwnership: true
      },
      comparison: {
        compareOnly: true,
        supported: true,
        removeFields: ['OPACITY', 'TRANSLATION_Y'],
        ownershipChange: 'remove'
      },
      artifact: null,
      output: null
    })
  })

  test('clear snapshot tombstones canonical Motion and preserves timelines', async () => {
    const output = join(directory, 'clear-snapshot.json')
    const result = await runOpenPencilCLI([
      'motion',
      'clear',
      snapshotFile,
      '--emit',
      'snapshot',
      '-o',
      output,
      '--json'
    ])

    expect(result).toMatchObject({ exitCode: 0, stderr: '' })
    const artifact = JSON.parse(await Bun.file(output).text())
    expect(artifact).toMatchObject({
      schema: 'openpencil.figma-native-motion-clear',
      version: 1,
      generatedOnly: true,
      compareOnly: true,
      nativeAction: 'remove-verified-owned',
      removeOwnedFields: ['OPACITY', 'TRANSLATION_Y'],
      preserveAnimationStyles: true,
      preserveTimelines: true
    })
    expect(decodeFigmaMotionSharedPayload(artifact.sharedMotionRaw)).toMatchObject({
      ok: true,
      value: { kind: 'cleared' }
    })
  })

  test('clear snapshot preserves unverified foreign native fields', async () => {
    const result = await runOpenPencilCLI([
      'motion',
      'clear',
      foreignSnapshotFile,
      '--emit',
      'snapshot'
    ])

    expect(result).toMatchObject({ exitCode: 0, stderr: '' })
    expect(JSON.parse(result.stdout)).toMatchObject({
      nativeAction: 'preserve-unverified',
      removeOwnedFields: [],
      preserveTimelines: true
    })
  })
})
