import { describe, expect, it } from 'bun:test'

import {
  buildComponent,
  createElement,
  isTreeNode,
  renderJSX,
  resolveToTree
} from '@open-pencil/core'

import { makeSceneGraph } from '#tests/helpers/scene'

const SECURITY_PROBE = '__openPencilDesignJSXSecurityProbe'

describe('Design JSX declarative execution boundary', () => {
  it('does not execute assignment or constructor-chain payloads', async () => {
    const globalRecord = globalThis as typeof globalThis & Record<string, unknown>
    Reflect.deleteProperty(globalRecord, SECURITY_PROBE)
    const payloads = [
      `<Frame w={(globalThis.${SECURITY_PROBE} = 1, 100)} />`,
      `<Frame w={({}).constructor.constructor('globalThis.${SECURITY_PROBE} = 2')()} />`
    ]

    for (const payload of payloads) {
      const graph = makeSceneGraph()
      await expect(renderJSX(graph, payload)).rejects.toThrow('Design JSX is unsafe')
      expect(globalRecord[SECURITY_PROBE]).toBeUndefined()
      expect(graph.getPages()[0]?.childIds).toEqual([])
    }
  })

  it('rejects ambient capabilities, executable expressions, spreads, and reserved keys', () => {
    for (const payload of [
      '<Frame w={globalThis.fetch("https://attacker.invalid")} />',
      '<Frame w={process.cwd()} />',
      '<Frame w={Bun.nanoseconds()} />',
      '<Frame w={(() => 100)()} />',
      '<Frame w={(0, 100)} />',
      '<Frame {...{ w: 100 }} />',
      '<Frame style={{ constructor: { prototype: {} } }} />'
    ]) {
      expect(() => buildComponent(payload)).toThrow('Design JSX is unsafe')
    }
  })

  it('preserves fragments, literals, arrays, plain objects, variables, and approved helpers', () => {
    const Component = buildComponent(`
      <>
        <Frame
          name="Effects"
          x={-10}
          style={{ width: 200, backgroundColor: '#112233' }}
          fills={[solid('#112233'), linearGradient([['#fff', 0], ['#0000', 1]])]}
          effects={[dropShadow({ x: 0, y: 8, radius: 16 }), backgroundBlur(12)]}
        />
        <Frame
          name="Variables"
          fill={defineVars({ primary: { name: 'Primary', value: '#ffffff' } }).primary}
          stroke={designVar('stroke', '#000000')}
        />
      </>
    `)
    const tree = resolveToTree(createElement(Component, null))

    expect(isTreeNode(tree)).toBe(true)
    if (!tree) return
    expect(tree.type).toBe('')
    expect(tree.children).toHaveLength(2)
    const effects = tree.children[0]
    const variables = tree.children[1]
    expect(isTreeNode(effects)).toBe(true)
    expect(isTreeNode(variables)).toBe(true)
    if (!isTreeNode(effects) || !isTreeNode(variables)) return
    expect(effects.props.x).toBe(-10)
    expect(effects.props.style).toEqual({ width: 200, backgroundColor: '#112233' })
    expect(effects.props.fills).toHaveLength(2)
    expect(effects.props.effects).toHaveLength(2)
    expect(variables.props.fill).toMatchObject({ name: 'Primary', value: '#ffffff' })
    expect(variables.props.stroke).toMatchObject({ id: 'stroke', value: '#000000' })
  })
})
