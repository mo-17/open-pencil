import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

import { compile, withDefaults } from '@open-pencil/compiler'
import { exportFigFile, parseFigFile } from '@open-pencil/core/io/formats/fig'
import { initCodec } from '@open-pencil/core/kiwi'
import {
  createVRTourModuleFrameOverrides,
  createVRTourSampleScenes,
  resolveVRTourModule,
  VR_TOUR_SAMPLE_ASSETS
} from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

import { expectDefined } from '#tests/helpers/assert'

test('real VR samples survive FIG save/reopen and remain in React and Vue exports', async () => {
  await initCodec()
  const graph = new SceneGraph()
  const scenes = createVRTourSampleScenes('zh-CN')
  graph.createNode(
    'FRAME',
    graph.getPages()[0].id,
    createVRTourModuleFrameOverrides({ locale: 'zh-CN', scenes })
  )
  const samples = VR_TOUR_SAMPLE_ASSETS.map((sample) => ({
    ...sample,
    bytes: new Uint8Array(
      readFileSync(
        new URL(`../../../../packages/demos/vr-tour/${sample.fileName}`, import.meta.url)
      )
    )
  }))
  for (const sample of samples) graph.images.set(sample.graphImageHash, sample.bytes)

  const file = await exportFigFile(graph)
  const reopened = await parseFigFile(file.buffer as ArrayBuffer)
  const tour = expectDefined(
    reopened.getAllNodes().find((node) => resolveVRTourModule(node.interactiveProps?.module)?.ok),
    'reopened VR tour'
  )
  const resolved = resolveVRTourModule(tour.interactiveProps?.module)
  expect(resolved?.ok).toBe(true)
  if (!resolved?.ok) throw new Error('Expected a valid reopened VR module')
  expect(resolved.config.locale).toBe('zh-CN')
  expect(resolved.config.scenes).toEqual(scenes)
  for (const sample of samples) {
    expect(reopened.images.get(sample.graphImageHash)).toEqual(sample.bytes)
  }

  for (const target of ['react', 'vue'] as const) {
    const output = compile({
      graph: reopened,
      pageIds: [reopened.getPages()[0].id],
      options: withDefaults({ target })
    })
    expect(output.warnings.filter((warning) => warning.code.startsWith('vr-tour-'))).toEqual([])
    for (const sample of samples) {
      expect(output.files.get('public' + sample.panoramaUrl)).toEqual(sample.bytes)
    }
  }
})
