import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { SceneGraph, type SceneNode } from '@open-pencil/scene-graph'

function switchProject(
  target: 'react' | 'vue',
  shadcn = false,
  overrides: Partial<SceneNode> = {}
) {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  graph.updateNode(pageId, {
    state: [{ id: 'enabled', name: 'enabled', type: 'boolean', defaultValue: false }]
  })
  const node = graph.createNode('SWITCH', pageId, {
    name: 'Switch parity',
    x: 30,
    y: 40,
    width: 84,
    height: 44,
    cornerRadius: 8,
    paddingLeft: 6,
    paddingRight: 8,
    paddingTop: 4,
    paddingBottom: 2,
    interactiveProps: { ariaLabel: 'Switch parity', disabled: true },
    bindings: { value: { kind: 'ref', stateId: 'enabled' } },
    stateOverrides: { hover: { opacity: 0.8 } },
    ...overrides
  })
  const output = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ target, ...(shadcn ? { uiKit: 'shadcn' } : {}), devMode: false })
  })
  const source = [...output.files]
    .filter(([path]) => path === 'src/App.tsx' || path.startsWith('src/pages/'))
    .map(([, value]) => value)
    .join('\n')
  return { graph, pageId, node, output, source }
}

describe('SWITCH appearance across compiler targets', () => {
  for (const target of ['react', 'vue'] as const) {
    test(`${target} owns one capsule and thumb without losing authored bounds or positioning`, () => {
      const { output, source } = switchProject(target)
      const classes = source.match(/<input class(?:Name)?="([^"]+)"/)?.[1]
      expect(output.warnings).toEqual([])
      expect(source).toContain('w-21 h-11')
      expect(source).toContain('absolute')
      expect(classes).toBeDefined()
      expect(classes?.split(' ')).not.toContain('relative')
      expect(source).not.toContain('rounded-lg')
      expect(source).toContain('rounded-full')
      expect(source).toContain('bg-[#cbd5e1]')
      expect(source).toContain('checked:bg-[#2563eb]')
      expect(source).toContain('before:bg-[#ffffff]')
      expect(source).not.toContain('bg-secondary')
      expect(source).not.toContain('bg-primary')
      expect(source).toContain('before:h-[min(80cqh,50cqw)]')
      expect(classes?.split(' ')).toEqual(
        expect.arrayContaining(['pl-[6px]', 'pr-2', 'pt-1', 'pb-[2px]'])
      )
      expect(source).toContain('hover:opacity-80')
      expect(source).toContain('disabled:opacity-[0.45]')
      expect(source).toContain('motion-reduce:before:transition-none')
      expect(source).toContain('focus-visible:ring-2')
      expect(source).toContain('role="switch"')
    })
  }

  test('shadcn uses the same pseudo-thumb once and maps Radix checked state', () => {
    const { source, output } = switchProject('react', true)
    const component = output.files.get('src/components/ui/switch.tsx') as string
    expect(output.warnings).toEqual([])
    expect(source).toContain('<Switch')
    expect(source).toContain('w-21 h-11')
    expect(source).toContain('onCheckedChange=')
    expect(source).toContain('data-[state=checked]:bg-[#2563eb]')
    expect(source).toContain('data-[state=checked]:before:translate-x-')
    expect(component).not.toContain('<SwitchPrimitives.Thumb')
    expect(component).toContain('before:h-[min(80cqh,50cqw)]')
    expect(component).not.toContain('data-[state=checked]:translate-x-4')
  })

  test('authored disabled opacity and responsive padding remain authoritative', () => {
    const { source } = switchProject('react', false, {
      stateOverrides: { disabled: { opacity: 0.2 }, focus: { cornerRadius: 4 } },
      responsiveOverrides: {
        md: { width: 100, paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0 }
      }
    })
    expect(source).toContain('disabled:opacity-20')
    expect(source).not.toContain('disabled:opacity-[0.45]')
    expect(source).toContain('focus:rounded')
    expect(source).toContain('md:w-25')
    expect(source).toContain('md:p-0')
  })

  test('disabled fallback composes authored opacity once in native and Radix output', () => {
    for (const shadcn of [false, true]) {
      const { source } = switchProject('react', shadcn, { opacity: 0.6 })
      expect(source).toContain('opacity-60')
      expect(source).toContain('disabled:opacity-[0.27]')
      expect(source).not.toContain('disabled:opacity-[0.45]')
    }
  })
})
