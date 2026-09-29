import { compile, withDefaults } from '@open-pencil/compiler'
import {
  createModalModuleFrameOverrides,
  createTabsModuleFrameOverrides
} from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

export function moduleFormFixture(
  target: 'react' | 'vue',
  remote = false,
  kit = false,
  radixSelect = false
) {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const textNames = ['first', 'second', 'discarded', 'portal', 'nested', 'normal']
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [
      ...textNames.map((name) => ({ id: name, name, type: 'string' as const, defaultValue: '' })),
      ...(kit
        ? [{ id: 'choices', name: 'choices', type: 'array' as const, defaultValue: [] }]
        : []),
      ...['outerCount', 'nestedCount', 'normalCount'].map((name) => ({
        id: name,
        name,
        type: 'number' as const,
        defaultValue: 0
      }))
    ]
  })
  const form = (parent: string, name: string, counter: string) =>
    graph.createNode('FORM', parent, {
      name,
      width: 560,
      height: 480,
      layoutMode: 'VERTICAL',
      itemSpacing: 12,
      events: {
        onSubmit: [
          {
            id: name + '-submit',
            kind: 'setVariable',
            targetName: counter,
            valueExpr: '$prev + 1'
          }
        ]
      }
    })
  const kitFieldTypes: Record<string, 'SELECT' | 'RADIO'> = { first: 'SELECT', second: 'RADIO' }
  const field = (parent: string, name: string) =>
    graph.createNode(kit ? (kitFieldTypes[name] ?? 'INPUT') : 'INPUT', parent, {
      name,
      width: 420,
      height: 44,
      bindings: { value: { kind: 'docState', docStateName: name } },
      interactiveProps: {
        ...(kit && radixSelect && name === 'first' ? {} : { placeholder: name + ' field' }),
        ...(kit ? { options: ['One', 'Two'] } : {}),
        validation: {
          required: true,
          messages: { required: name + ' required' },
          ...(remote && name === 'first'
            ? {
                async: {
                  url: 'https://validation.example.test/check',
                  method: 'GET',
                  message: 'remote rejected'
                }
              }
            : {})
        }
      }
    })
  const submit = (parent: string, label: string) =>
    graph.createNode('BUTTON', parent, {
      width: 180,
      height: 44,
      interactiveProps: { text: label, type: 'submit' }
    })
  const outer = form(pageId, 'Outer form', 'outerCount')
  graph.updateNode(outer.id, {
    x: 20,
    y: 20,
    height: 460,
    interactiveProps: { validationSummary: { enabled: true, title: 'Current fields' } }
  })
  const tabs = graph.createNode('FRAME', outer.id, {
    ...createTabsModuleFrameOverrides({
      tabs: [
        { id: 'first', label: 'First panel', content: '', contentChildName: 'First content' },
        { id: 'second', label: 'Second panel', content: '', contentChildName: 'Second content' }
      ],
      initialTabId: 'first'
    }),
    width: 540,
    height: 230
  })
  for (const [name, label] of [
    ['first', 'First content'],
    ['second', 'Second content']
  ] as const) {
    const content = graph.createNode('FRAME', tabs.id, {
      name: label,
      width: 450,
      height: 100,
      layoutMode: 'VERTICAL'
    })
    field(content.id, name)
    if (kit && name === 'first') {
      graph.updateNode(content.id, { height: 180 })
      graph.createNode('CHECKBOX', content.id, {
        name: 'Required choices',
        width: 420,
        height: 60,
        bindings: { value: { kind: 'docState', docStateName: 'choices' } },
        interactiveProps: {
          options: ['Accept'],
          validation: { required: true, messages: { required: 'choices required' } }
        }
      })
    }
  }
  const discarded = graph.createNode('FRAME', tabs.id, {
    name: 'Unassigned content',
    width: 450,
    height: 100
  })
  field(discarded.id, 'discarded')
  const modal = graph.createNode('FRAME', outer.id, {
    ...createModalModuleFrameOverrides({
      triggerLabel: 'Open nested form',
      title: 'Nested dialog',
      contentChildName: 'Dialog content'
    }),
    width: 220,
    height: 44
  })
  const body = graph.createNode('FRAME', modal.id, {
    name: 'Dialog content',
    width: 450,
    height: 300,
    layoutMode: 'VERTICAL',
    itemSpacing: 12
  })
  field(body.id, 'portal')
  const nested = form(body.id, 'Nested form', 'nestedCount')
  graph.updateNode(nested.id, { width: 450, height: 150 })
  field(nested.id, 'nested')
  submit(nested.id, 'Submit nested')
  submit(outer.id, 'Submit outer')
  const normal = form(pageId, 'Normal form', 'normalCount')
  graph.updateNode(normal.id, { x: 620, y: 20, width: 460, height: 180 })
  field(normal.id, 'normal')
  submit(normal.id, 'Submit normal')
  graph.createNode('TEXT', pageId, {
    x: 20,
    y: 520,
    width: 800,
    height: 36,
    text: `Outer \${outerCount}; Nested \${nestedCount}; Normal \${normalCount}`
  })
  const output = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({
      target,
      ...(kit ? { uiKit: 'shadcn' as const } : {}),
      router: 'none',
      packageName: 'module-form-validation',
      devMode: false
    })
  })
  return { ...output, graph, pageId, outer, normal }
}
