import { describe, expect, test } from 'bun:test'

import {
  parsePenFile,
  REMOTE_PEN_PARSE_LIMITS,
  resolvePenParseLimits,
  type PenParseLimits
} from '@open-pencil/pen'

interface SourceNode {
  id: string
  type: string
  children?: SourceNode[]
  [key: string]: unknown
}

function node(id: string, overrides: Partial<SourceNode> = {}): SourceNode {
  return { id, type: 'frame', ...overrides }
}

function source(children: SourceNode[], extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ version: '2.14', children, ...extra })
}

function expectQuota(input: string, limits: PenParseLimits, resource: string): void {
  expect(() => parsePenFile(input, { limits })).toThrow(resource)
}

describe('untrusted .pen parse limits', () => {
  test('keeps the legacy local parser unlimited unless limits are explicitly supplied', () => {
    const input = source([node('root', { content: 'x'.repeat(9) })])

    expect(parsePenFile(input).getNode('root')).toBeDefined()
    expectQuota(input, { maxStringBytes: 8 }, 'string bytes')
  })

  test('rejects source bytes before parsing JSON', () => {
    const input = source([node('root')])
    expectQuota(input, { maxBytes: new TextEncoder().encode(input).byteLength - 1 }, 'source bytes')
  })

  test('bounds authored node count, node depth, and direct children', () => {
    expectQuota(source([node('a'), node('b'), node('c')]), { maxNodes: 2 }, 'authored nodes')

    const nested = node('one', { children: [node('two', { children: [node('three')] })] })
    expectQuota(source([nested]), { maxDepth: 2 }, 'node depth')

    const wide = node('root', { children: [node('left'), node('right')] })
    expectQuota(source([wide]), { maxChildrenPerNode: 1 }, 'children per node')
    expectQuota(
      source([node('left'), node('right')]),
      { maxChildrenPerNode: 1 },
      'document children'
    )

    const instance = node('instance', {
      type: 'ref',
      ref: 'component',
      descendants: {
        target: { children: [node('replacement-1'), node('replacement-2')] }
      }
    })
    const component = node('component', {
      reusable: true,
      children: [node('target', { children: [instance] })]
    })
    const overrideInput = source([component])
    expectQuota(overrideInput, { maxChildrenPerNode: 1 }, 'children per node')
    expectQuota(overrideInput, { maxNodes: 4 }, 'authored nodes')
  })

  test('bounds component fan-out after instances expand', () => {
    const component = node('component', {
      reusable: true,
      children: [node('child-1'), node('child-2'), node('child-3'), node('child-4')]
    })
    const firstRef = node('instance-1', { type: 'ref', ref: 'component' })
    const secondRef = node('instance-2', { type: 'ref', ref: 'component' })

    expectQuota(
      source([component, firstRef, secondRef]),
      { maxExpandedNodes: 12 },
      'expanded SceneGraph nodes'
    )
  })

  test('bounds graph depth after nested instances expand', () => {
    const leaf = node('leaf-component', { reusable: true, children: [node('leaf-child')] })
    const parent = node('parent-component', {
      reusable: true,
      children: [node('nested-instance', { type: 'ref', ref: 'leaf-component' })]
    })
    const rootInstance = node('root-instance', { type: 'ref', ref: 'parent-component' })

    expectQuota(
      source([leaf, parent, rootInstance]),
      { maxExpandedDepth: 3 },
      'expanded SceneGraph depth'
    )
  })

  test('bounds individual and cumulative UTF-8 strings', () => {
    expectQuota(
      source([node('root', { content: 'é'.repeat(10) })]),
      { maxStringBytes: 16 },
      'string bytes'
    )
    expectQuota(
      source([node('root', { name: 'first-name', content: 'second-content' })]),
      { maxTotalStringBytes: 40 },
      'total string bytes'
    )
  })

  test('bounds generic JSON depth, arrays, objects, and total values', () => {
    expectQuota(
      source([node('root', { metadata: { one: { two: { three: true } } } })]),
      { maxValueDepth: 4 },
      'JSON nesting depth'
    )
    expectQuota(
      source([node('root', { slot: ['one', 'two', 'three'] })]),
      { maxArrayItems: 2 },
      'JSON array items'
    )
    expectQuota(
      source([node('root', { name: 'Root', content: 'Content' })]),
      { maxObjectProperties: 3 },
      'JSON object properties'
    )
    expectQuota(source([node('root')]), { maxTotalValues: 3 }, 'JSON values')
  })

  test('validates custom limits and exposes immutable remote defaults', () => {
    expect(Object.isFrozen(REMOTE_PEN_PARSE_LIMITS)).toBe(true)
    expect(resolvePenParseLimits({ maxNodes: 7 }).maxNodes).toBe(7)
    expect(() => resolvePenParseLimits({ maxNodes: 0 })).toThrow('positive safe integer')
    expect(() => resolvePenParseLimits({ unexpected: 1 } as PenParseLimits)).toThrow(
      'Unknown .pen parse limit'
    )
  })
})
