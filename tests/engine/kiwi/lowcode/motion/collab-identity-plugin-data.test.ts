import { beforeAll, describe, expect, test } from 'bun:test'

import { initCodec } from '@open-pencil/core'
import { OPEN_PENCIL_PLUGIN_ID } from '@open-pencil/fig/node-change'
import type { NodeChange } from '@open-pencil/kiwi/fig/codec'
import type { MotionSpec, PluginDataEntry, SceneNode } from '@open-pencil/scene-graph'

import {
  extractLowcodeAndPluginData,
  LOWCODE_MOTION_KEY,
  serializeLowcodeFields
} from '#core/kiwi/fig/node-change/lowcode-plugin-data'

describe('Motion collaborative identity .fig plugin data', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('round-trips MotionSpec v3 keyframe ids without affecting the visual node', () => {
    const motion: MotionSpec = {
      version: 3,
      tracks: [
        {
          id: 'collabEnter',
          trigger: 'mount',
          keyframes: [
            { id: 'kf_start', offset: 0, opacity: 0 },
            { id: 'kf_end', offset: 1, opacity: 1 }
          ],
          timing: { durationMs: 320 }
        }
      ]
    }
    const node = { type: 'RECTANGLE', pluginData: [] as PluginDataEntry[], motion } as SceneNode
    const canonical = serializeLowcodeFields(node).find(({ key }) => key === LOWCODE_MOTION_KEY)
    if (!canonical) throw new Error('Expected canonical Motion plugin data')

    const extracted = extractLowcodeAndPluginData({
      pluginData: [
        {
          pluginID: OPEN_PENCIL_PLUGIN_ID,
          key: LOWCODE_MOTION_KEY,
          value: canonical.value
        }
      ]
    } as Pick<NodeChange, 'pluginData'>)

    expect(extracted.motion).toEqual(motion)
    expect(extracted.motion?.tracks[0].keyframes.map(({ id }) => id)).toEqual([
      'kf_start',
      'kf_end'
    ])
  })
})
