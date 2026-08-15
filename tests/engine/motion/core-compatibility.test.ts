import { describe, expect, test } from 'bun:test'

import * as CoreRoot from '@open-pencil/core'
import * as CoreMotion from '@open-pencil/core/motion'
import * as Motion from '@open-pencil/motion'

type Same<Left, Right> = [Left] extends [Right] ? ([Right] extends [Left] ? true : false) : false

type SameAcrossEntrypoints<Owner, MotionCompat, RootCompat> =
  Same<Owner, MotionCompat> extends true ? Same<Owner, RootCompat> : false

const TYPE_COMPATIBILITY: readonly [
  SameAcrossEntrypoints<
    Motion.MotionVisualState,
    CoreMotion.MotionVisualState,
    CoreRoot.MotionVisualState
  >,
  SameAcrossEntrypoints<
    Motion.PreparedMotionSamplingPlan,
    CoreMotion.PreparedMotionSamplingPlan,
    CoreRoot.PreparedMotionSamplingPlan
  >,
  SameAcrossEntrypoints<
    Motion.MotionScenePlanIssue,
    CoreMotion.MotionScenePlanIssue,
    CoreRoot.MotionScenePlanIssue
  >,
  SameAcrossEntrypoints<
    Motion.MotionInputBatch,
    CoreMotion.MotionInputBatch,
    CoreRoot.MotionInputBatch
  >
] = [true, true, true, true]

describe('core Motion compatibility exports', () => {
  test('preserves every owner runtime export through the subpath and core root', () => {
    const ownerKeys = Object.keys(Motion)
    expect(ownerKeys.filter((key) => !Reflect.has(CoreMotion, key))).toEqual([])
    expect(ownerKeys.filter((key) => !Reflect.has(CoreRoot, key))).toEqual([])
    for (const key of ownerKeys) {
      expect(Reflect.get(CoreMotion, key)).toBe(Reflect.get(Motion, key))
      expect(Reflect.get(CoreRoot, key)).toBe(Reflect.get(Motion, key))
    }
  })

  test('keeps representative public types identical', () => {
    expect(TYPE_COMPATIBILITY).toEqual([true, true, true, true])
  })
})
