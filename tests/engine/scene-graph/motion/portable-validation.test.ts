import { describe, expect, test } from 'bun:test'

import {
  MOTION_PORTABLE_VALUE_LIMITS,
  parseGeneratedEffectSpec,
  parseMotionDriverSpec,
  parseMotionRecipe,
  parseMotionSceneSpec,
  parsePrototypeSpec,
  parseSharedMotionPresetLibraryState,
  parseSharedMotionPresetManifest,
  parseTeamMotionLibraryManifest,
  parseUserMotionPresetLibrary
} from '@open-pencil/scene-graph'

type PortableParser = (value: unknown) => unknown

const schemas: ReadonlyArray<{
  name: string
  errorName: string
  parse: PortableParser
}> = [
  { name: 'scene', errorName: 'MotionSceneValidationError', parse: parseMotionSceneSpec },
  { name: 'drivers', errorName: 'MotionDriverValidationError', parse: parseMotionDriverSpec },
  { name: 'prototype', errorName: 'PrototypeValidationError', parse: parsePrototypeSpec },
  { name: 'recipe', errorName: 'MotionRecipeValidationError', parse: parseMotionRecipe },
  {
    name: 'user preset library',
    errorName: 'UserMotionPresetValidationError',
    parse: parseUserMotionPresetLibrary
  },
  {
    name: 'shared preset manifest',
    errorName: 'SharedMotionPresetValidationError',
    parse: parseSharedMotionPresetManifest
  },
  {
    name: 'shared preset state',
    errorName: 'SharedMotionPresetValidationError',
    parse: parseSharedMotionPresetLibraryState
  },
  {
    name: 'team library manifest',
    errorName: 'TeamMotionLibraryValidationError',
    parse: parseTeamMotionLibraryManifest
  },
  {
    name: 'generated effect',
    errorName: 'GeneratedEffectValidationError',
    parse: parseGeneratedEffectSpec
  }
]

function deeplyNestedValue(): unknown {
  let value: unknown = 'leaf'
  for (let depth = 0; depth <= MOTION_PORTABLE_VALUE_LIMITS.maxDepth; depth++) {
    value = { value }
  }
  return value
}

const tooManyEntries = Object.fromEntries(
  Array.from({ length: MOTION_PORTABLE_VALUE_LIMITS.maxEntries + 1 }, (_, index) => [
    `entry${index}`,
    index
  ])
)
const tooLongString = 'x'.repeat(MOTION_PORTABLE_VALUE_LIMITS.maxStringLength + 1)

function expectBoundedFailure(parse: PortableParser, value: unknown, errorName: string): void {
  try {
    parse(value)
    throw new Error('Expected schema validation to fail')
  } catch (error) {
    expect(error).not.toBeInstanceOf(RangeError)
    expect(error).toBeInstanceOf(Error)
    const validationError = error as Error & {
      issues?: ReadonlyArray<{ code?: string }>
    }
    expect(validationError.name).toBe(errorName)
    expect(validationError.issues?.[0]?.code).toBe('limit_exceeded')
  }
}

describe('portable Motion schema resource budgets', () => {
  for (const schema of schemas) {
    test(`${schema.name} rejects depth, entry, and string limit overflows without native errors`, () => {
      expectBoundedFailure(schema.parse, deeplyNestedValue(), schema.errorName)
      expectBoundedFailure(schema.parse, tooManyEntries, schema.errorName)
      expectBoundedFailure(schema.parse, tooLongString, schema.errorName)
    })
  }
})
