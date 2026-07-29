import { describe, expect, test } from 'bun:test'

import { prepareMotionScenePlan, samplePreparedMotionScenePlan } from '@open-pencil/core/motion'
import type { MotionSceneSpec, MotionSpec } from '@open-pencil/scene-graph'

import { expectDefined } from '#tests/helpers/assert'

function motion(): MotionSpec {
  return {
    version: 3,
    reducedMotion: 'allow',
    tracks: [
      {
        id: 'move',
        trigger: 'mount',
        keyframes: [
          { offset: 0, x: 0 },
          { offset: 1, x: 100 }
        ],
        timing: { durationMs: 400, easing: 'linear', fill: 'both' },
        composition: { mode: 'replace', priority: 10 }
      },
      {
        id: 'nudge',
        trigger: 'mount',
        keyframes: [
          { offset: 0, x: 0 },
          { offset: 1, x: 20 }
        ],
        timing: { durationMs: 200, easing: 'linear', fill: 'both' },
        composition: { mode: 'add', priority: 20 }
      }
    ]
  }
}

function scene(cues: MotionSceneSpec['sequences'][number]['cues']): MotionSceneSpec {
  return {
    version: 1,
    id: 'landingScene',
    sequences: [{ id: 'intro', trigger: 'pageEnter', cues }]
  }
}

describe('prepared Motion scene sampling', () => {
  test('folds cue offset and time scale into one reference sampling plan per node', () => {
    const spec = motion()
    const plan = prepareMotionScenePlan(
      scene([
        {
          id: 'moveCue',
          targetNodeId: '0:10',
          trackId: 'move',
          startMs: 100,
          timeScale: 2
        },
        {
          id: 'nudgeCue',
          targetNodeId: '0:10',
          trackId: 'nudge',
          startMs: 100
        }
      ]),
      'intro',
      (targetNodeId) => ({ nodeId: targetNodeId, motion: spec })
    )

    expect(plan.issues).toEqual([])
    expect(plan.durationMs).toBe(300)
    expect(plan.nodes).toHaveLength(1)
    expect(plan.nodes[0]?.trackIds).toEqual(['move', 'nudge'])
    expect(samplePreparedMotionScenePlan(plan, 200).nodes.get('0:10')?.visual.x).toBeCloseTo(60)
    expect(samplePreparedMotionScenePlan(plan, 500).nodes.get('0:10')?.visual.x).toBeCloseTo(120)
  })

  test('keeps source-track priority stable even when cue order differs', () => {
    const spec = motion()
    const plan = prepareMotionScenePlan(
      scene([
        { id: 'secondCue', targetNodeId: 'node', trackId: 'nudge', startMs: 0 },
        { id: 'firstCue', targetNodeId: 'node', trackId: 'move', startMs: 0 }
      ]),
      'intro',
      () => ({ nodeId: 'resolved-node', motion: spec })
    )

    expect(plan.nodes[0]?.cueIds).toEqual(['firstCue', 'secondCue'])
    expect(samplePreparedMotionScenePlan(plan, 200).nodes.get('resolved-node')?.visual.x).toBe(70)
  })

  test('reports missing targets, missing motion, missing tracks, and duplicates inertly', () => {
    const spec = motion()
    const plan = prepareMotionScenePlan(
      scene([
        { id: 'missingTarget', targetNodeId: 'missing', trackId: 'move', startMs: 0 },
        { id: 'missingMotion', targetNodeId: 'empty', trackId: 'move', startMs: 0 },
        { id: 'missingTrack', targetNodeId: 'node', trackId: 'unknown', startMs: 0 },
        { id: 'valid', targetNodeId: 'node', trackId: 'move', startMs: 0 },
        { id: 'duplicate', targetNodeId: 'node', trackId: 'move', startMs: 80 },
        {
          id: 'disabled',
          targetNodeId: 'missing',
          trackId: 'move',
          startMs: 0,
          enabled: false
        }
      ]),
      'intro',
      (targetNodeId) => {
        if (targetNodeId === 'missing') return undefined
        if (targetNodeId === 'empty') return { nodeId: 'empty' }
        return { nodeId: 'node', motion: spec }
      }
    )

    expect(plan.issues.map(({ code }) => code).sort()).toEqual([
      'duplicate-cue-target',
      'motion-missing',
      'target-missing',
      'track-missing'
    ])
    expect(plan.nodes).toHaveLength(1)
    expect(plan.nodes[0]?.trackIds).toEqual(['move'])
  })

  test('treats an infinite track as one cycle for bounded authoring duration', () => {
    const spec = motion()
    expectDefined(spec.tracks[0], 'looping track').timing.iterations = 'infinite'
    const plan = prepareMotionScenePlan(
      scene([{ id: 'loopCue', targetNodeId: 'node', trackId: 'move', startMs: 50 }]),
      'intro',
      () => ({ nodeId: 'node', motion: spec })
    )

    expect(plan.durationMs).toBe(450)
    expect(samplePreparedMotionScenePlan(plan, 450).finished).toBe(false)
  })

  test('rejects an unknown sequence instead of sampling an implicit fallback', () => {
    expect(() =>
      prepareMotionScenePlan(scene([]), 'missing', () => ({ nodeId: 'node', motion: motion() }))
    ).toThrow('Unknown Motion scene sequence')
  })
})
