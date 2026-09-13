import { describe, expect, test } from 'bun:test'

import { SceneGraph, type ComponentPropertyDefinition } from '@open-pencil/scene-graph'

import { expectDefined } from '#tests/helpers/assert'

import {
  buildComponentPropertyDefinitionIndex,
  buildNodePathIndex,
  SCENE_VERIFIERS,
  type VerifierContext
} from './helpers'

const AVATAR_KEY = 'test-component-avatar'
const ICON_KEY = 'test-component-icon'

function definition(
  overrides: Partial<ComponentPropertyDefinition> = {}
): ComponentPropertyDefinition {
  return {
    id: '65182:1',
    name: 'Avatar',
    type: 'INSTANCE_SWAP',
    defaultValue: '1:2145',
    ...overrides
  }
}

function context(
  a: unknown,
  b: unknown,
  overrides: Partial<VerifierContext> = {}
): VerifierContext {
  return {
    a,
    b,
    key: 'componentPropertyDefinitions',
    path: '1/112',
    aNodes: new Map(),
    bNodes: new Map(),
    aGraph: new SceneGraph(),
    bGraph: new SceneGraph(),
    aNodePaths: new Map([['1:2145', '1/7']]),
    bNodePaths: new Map([['1:2145', '1/7']]),
    aComponentPropertyDefinitions: new Map(),
    bComponentPropertyDefinitions: new Map(),
    errors: [],
    fixture: {
      file: 'component-properties',
      fileSize: 0,
      nodeCount: 0,
      nodeTypes: {},
      schemaSize: 0,
      thumbnailSize: 0,
      thumbnailWidth: 0,
      thumbnailHeight: 0,
      imageCount: 0,
      figKiwiVersion: 0,
      g1ExportSize: 0,
      g2ExportSize: 0
    },
    label: 'component properties',
    generation: 0,
    ...overrides
  }
}

function verify(a: unknown, b: unknown, overrides: Partial<VerifierContext> = {}): boolean {
  return expectDefined(SCENE_VERIFIERS.get('componentPropertyDefinitions'))(
    context(a, b, overrides)
  )
}

function verifyAssignments(
  a: unknown,
  b: unknown,
  overrides: Partial<VerifierContext> = {}
): boolean {
  const property = definition()
  return expectDefined(SCENE_VERIFIERS.get('componentPropertyAssignments'))(
    context(a, b, {
      key: 'componentPropertyAssignments',
      aComponentPropertyDefinitions: new Map([[property.id, property]]),
      bComponentPropertyDefinitions: new Map([[property.id, property]]),
      ...overrides
    })
  )
}

describe('component property roundtrip comparison', () => {
  test.each([0, 1])(
    'accepts unchanged opaque preferred component keys in generation %i',
    (generation) => {
      const definitions = [definition({ preferredValues: [AVATAR_KEY, ICON_KEY] })]

      expect(verify(definitions, structuredClone(definitions), { generation })).toBe(true)
    }
  )

  test('does not treat different component keys as equivalent node paths', () => {
    const a = [definition({ preferredValues: [AVATAR_KEY] })]
    const b = [definition({ preferredValues: [ICON_KEY] })]

    expect(
      verify(a, b, {
        aNodePaths: new Map([
          ['1:2145', '1/7'],
          [AVATAR_KEY, '1/9']
        ]),
        bNodePaths: new Map([
          ['1:2145', '1/7'],
          [ICON_KEY, '1/9']
        ])
      })
    ).toBe(false)
  })

  test('preserves preferred component key order and presence', () => {
    const original = [definition({ preferredValues: [AVATAR_KEY, ICON_KEY] })]

    expect(verify(original, [definition({ preferredValues: [ICON_KEY, AVATAR_KEY] })])).toBe(false)
    expect(verify(original, [definition({ preferredValues: [AVATAR_KEY] })])).toBe(false)
    expect(verify(original, [definition()])).toBe(false)
    expect(verify([definition({ preferredValues: [] })], [definition()])).toBe(false)
  })

  test.each([0, 1])(
    'accepts remapped default node IDs only at the same structural path in generation %i',
    (generation) => {
      const a = [definition()]
      const b = [definition({ defaultValue: '9:42' })]

      expect(verify(a, b, { generation, bNodePaths: new Map([['9:42', '1/7']]) })).toBe(true)
      expect(verify(a, b, { generation, bNodePaths: new Map([['9:42', '1/8']]) })).toBe(false)
    }
  )

  test('accepts an unchanged unresolved default without accepting a changed one', () => {
    const a = [definition({ defaultValue: 'external-component' })]

    expect(verify(a, structuredClone(a))).toBe(true)
    expect(verify(a, [definition({ defaultValue: 'another-component' })])).toBe(false)
  })

  test('rejects a removed or displaced resolved default even when the ID stays equal', () => {
    const a = [definition()]

    expect(verify(a, structuredClone(a), { bNodePaths: new Map() })).toBe(false)
    expect(verify(a, structuredClone(a), { bNodePaths: new Map([['1:2145', '1/8']]) })).toBe(false)
  })

  test('rejects missing or changed component definitions', () => {
    const a = [definition()]

    expect(verify(a, [])).toBe(false)
    expect(verify(a, undefined)).toBe(false)
    expect(verify(a, [definition({ id: '65182:2' })])).toBe(false)
    expect(verify(a, [definition({ name: 'Different property' })])).toBe(false)
    expect(verify(a, [definition({ type: 'TEXT' })])).toBe(false)
    expect(verify(a, [{ id: '65182:1', name: 'Avatar', type: 'INSTANCE_SWAP' }])).toBe(false)
  })

  test('keeps non-reference defaults and variant options strict', () => {
    const a = [
      definition({ type: 'VARIANT', defaultValue: 'Small', variantOptions: ['Small', 'Large'] })
    ]

    expect(verify(a, structuredClone(a))).toBe(true)
    expect(
      verify(a, [
        definition({ type: 'VARIANT', defaultValue: 'Large', variantOptions: ['Small', 'Large'] })
      ])
    ).toBe(false)
    expect(verify(a, [definition({ type: 'VARIANT', defaultValue: 'Small' })])).toBe(false)
  })

  test('preserves the existing VARIANT to TEXT normalization without changing other fields', () => {
    const a = [definition({ type: 'VARIANT', defaultValue: 'Small' })]

    expect(verify(a, [definition({ type: 'TEXT', defaultValue: 'Small' })])).toBe(true)
    expect(verify(a, [definition({ type: 'TEXT', defaultValue: 'Large' })])).toBe(false)
    expect(verify(a, [definition({ type: 'BOOLEAN', defaultValue: 'Small' })])).toBe(false)
  })

  test('does not drop preferred values from a non-reference property', () => {
    const a = [definition({ type: 'TEXT', preferredValues: [AVATAR_KEY] })]

    expect(verify(a, structuredClone(a))).toBe(true)
    expect(verify(a, [definition({ type: 'TEXT', preferredValues: [ICON_KEY] })])).toBe(false)
    expect(verify(a, [definition({ type: 'TEXT' })])).toBe(false)
  })
})

describe('component property assignment roundtrip comparison', () => {
  test.each([0, 1])(
    'accepts remapped instance targets at the same path in generation %i',
    (generation) => {
      const a = { '65182:1': '1:2145' }
      const b = { '65182:1': '9:42' }

      expect(verifyAssignments(a, b, { generation, bNodePaths: new Map([['9:42', '1/7']]) })).toBe(
        true
      )
      expect(verifyAssignments(a, b, { generation, bNodePaths: new Map([['9:42', '1/8']]) })).toBe(
        false
      )
      expect(verifyAssignments(a, b, { generation, bNodePaths: new Map() })).toBe(false)
    }
  )

  test('rejects a removed or displaced assignment target even when its ID stays equal', () => {
    const a = { '65182:1': '1:2145' }

    expect(verifyAssignments(a, structuredClone(a))).toBe(true)
    expect(verifyAssignments(a, structuredClone(a), { bNodePaths: new Map() })).toBe(false)
    expect(
      verifyAssignments(a, structuredClone(a), { bNodePaths: new Map([['1:2145', '1/8']]) })
    ).toBe(false)
  })

  test('requires an instance-swap definition on both sides before remapping', () => {
    const a = { '65182:1': '1:2145' }
    const b = { '65182:1': '9:42' }
    const bNodePaths = new Map([['9:42', '1/7']])

    expect(verifyAssignments(a, b, { bNodePaths, bComponentPropertyDefinitions: new Map() })).toBe(
      false
    )
    expect(verifyAssignments(a, b, { bNodePaths, aComponentPropertyDefinitions: new Map() })).toBe(
      false
    )
    expect(
      verifyAssignments(a, b, {
        bNodePaths,
        bComponentPropertyDefinitions: new Map([['65182:1', definition({ type: 'TEXT' })]])
      })
    ).toBe(false)
    expect(
      verifyAssignments(a, structuredClone(a), { bComponentPropertyDefinitions: new Map() })
    ).toBe(false)
  })

  test('accepts an unchanged unresolved assignment but rejects a changed one', () => {
    const a = { '65182:1': 'external-component' }

    expect(verifyAssignments(a, structuredClone(a))).toBe(true)
    expect(verifyAssignments(a, { '65182:1': 'another-component' })).toBe(false)
  })

  test('rejects added, removed, renamed, or malformed assignments', () => {
    const a = { '65182:1': '1:2145' }

    expect(verifyAssignments(a, {})).toBe(false)
    expect(verifyAssignments({}, a)).toBe(false)
    expect(verifyAssignments(a, { '65182:2': '1:2145' })).toBe(false)
    expect(verifyAssignments(a, { '65182:1': undefined })).toBe(false)
    expect(verifyAssignments(a, undefined)).toBe(false)
    expect(verifyAssignments(a, ['1:2145'])).toBe(false)
  })

  test.each(['TEXT', 'BOOLEAN'] as const)('compares %s assignment values literally', (type) => {
    const property = definition({ type })
    const definitions = new Map([[property.id, property]])
    const a = { '65182:1': '1:2145' }
    const overrides = {
      aComponentPropertyDefinitions: definitions,
      bComponentPropertyDefinitions: definitions,
      bNodePaths: new Map([['9:42', '1/7']])
    }

    expect(verifyAssignments(a, structuredClone(a), overrides)).toBe(true)
    expect(verifyAssignments(a, { '65182:1': '9:42' }, overrides)).toBe(false)
  })

  test('uses indices built from the compared graphs', () => {
    const aGraph = new SceneGraph()
    const bGraph = new SceneGraph()
    const aPage = expectDefined(aGraph.getPages()[0])
    const bPage = expectDefined(bGraph.getPages()[0])
    const aTarget = aGraph.createNode('COMPONENT', aPage.id, { id: '1:2145' })
    const bTarget = bGraph.createNode('COMPONENT', bPage.id, { id: '9:42' })
    aGraph.createNode('COMPONENT', aPage.id, { componentPropertyDefinitions: [definition()] })
    bGraph.createNode('COMPONENT', bPage.id, {
      componentPropertyDefinitions: [definition({ defaultValue: bTarget.id })]
    })

    expect(
      verifyAssignments(
        { '65182:1': aTarget.id },
        { '65182:1': bTarget.id },
        {
          aNodePaths: buildNodePathIndex(new Map([['1/7', aTarget]])),
          bNodePaths: buildNodePathIndex(new Map([['1/7', bTarget]])),
          aComponentPropertyDefinitions: buildComponentPropertyDefinitionIndex(aGraph),
          bComponentPropertyDefinitions: buildComponentPropertyDefinitionIndex(bGraph)
        }
      )
    ).toBe(true)
  })
})
