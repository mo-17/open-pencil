import { beforeAll, describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import {
  CORE_TOOLS,
  exportFigFileWithOptions,
  initCodec,
  parseFigFile,
  type SceneGraph
} from '@open-pencil/core'
import type { NodeType, SceneNode } from '@open-pencil/scene-graph'

import { getTool, setupToolTest } from '#tests/helpers/tools'

const LOWCODE_TYPES = new Set<NodeType>([
  'BUTTON',
  'INPUT',
  'SELECT',
  'CHECKBOX',
  'FORM',
  'LIST',
  'RADIO',
  'TEXTAREA',
  'DATEPICKER',
  'SWITCH'
])

const CONTROL_CASES = [
  {
    type: 'BUTTON',
    name: 'E2E button',
    interactiveProps: { text: 'Save changes' },
    events: {
      onClick: [
        {
          id: 'save-email',
          kind: 'setState',
          targetStateId: 'email-state',
          valueExpr: '"saved@example.com"'
        }
      ]
    },
    renderCondition: 'email !== ""',
    stateOverrides: { hover: { opacity: 0.75 } }
  },
  {
    type: 'INPUT',
    name: 'E2E input',
    interactiveProps: {
      placeholder: 'Email address',
      value: 'ada@example.com',
      validation: { required: true }
    },
    bindings: { value: { kind: 'ref', stateId: 'email-state' } }
  },
  {
    type: 'SELECT',
    name: 'E2E select',
    interactiveProps: { options: ['Draft', 'Published'], value: 'Published' }
  },
  {
    type: 'CHECKBOX',
    name: 'E2E checkbox',
    interactiveProps: { checked: true }
  },
  {
    type: 'FORM',
    name: 'E2E form',
    interactiveProps: {
      validationSummary: { enabled: true, title: 'Fix these fields' }
    }
  },
  {
    type: 'LIST',
    name: 'E2E list',
    interactiveProps: {
      dataSourceRef: { kind: 'stateRef', stateId: 'items-state' },
      itemName: 'entry',
      indexName: 'entryIndex'
    }
  },
  {
    type: 'RADIO',
    name: 'E2E radio',
    interactiveProps: { options: ['Yes', 'No'], value: 'Yes', groupName: 'answer' }
  },
  {
    type: 'TEXTAREA',
    name: 'E2E textarea',
    interactiveProps: { placeholder: 'Notes', value: 'Draft note' }
  },
  {
    type: 'DATEPICKER',
    name: 'E2E date picker',
    interactiveProps: {
      value: '2026-07-27',
      min: '2026-01-01',
      max: '2026-12-31'
    }
  },
  {
    type: 'SWITCH',
    name: 'E2E switch',
    interactiveProps: { checked: true }
  }
] as const satisfies ReadonlyArray<{
  type: NodeType
  name: string
  interactiveProps: Record<string, unknown>
  bindings?: Record<string, unknown>
  events?: Record<string, unknown>
  renderCondition?: string
  stateOverrides?: Record<string, unknown>
}>

const CONTROLS_JSX = `
  <Frame name="E2E lowcode controls" flex="col" gap={8}>
    <Button
      name="E2E button"
      interactiveProps={{ text: 'base label' }}
      text="direct label"
    >Save changes</Button>
    <Select
      name="E2E select"
      options={['Draft', 'Published']}
      value="Published"
    />
    <Checkbox name="E2E checkbox" checked={true} />
    <Form
      name="E2E form"
      interactiveProps={{
        validationSummary: { enabled: true, title: 'Fix these fields' }
      }}
    >
      <Input
        name="E2E input"
        interactiveProps={{
          placeholder: 'base placeholder',
          value: 'base value',
          validation: { required: true }
        }}
        placeholder="Email address"
        value="ada@example.com"
      />
    </Form>
    <List
      name="E2E list"
      interactiveProps={{
        dataSourceRef: { kind: 'stateRef', stateId: 'items-state' },
        itemName: 'entry',
        indexName: 'entryIndex'
      }}
    >
      <Text name="E2E list template">List row</Text>
    </List>
    <Radio
      name="E2E radio"
      options={['Yes', 'No']}
      value="Yes"
      groupName="answer"
    />
    <Textarea name="E2E textarea" placeholder="Notes" value="Draft note" />
    <DatePicker
      name="E2E date picker"
      value="2026-07-27"
      min="2026-01-01"
      max="2026-12-31"
    />
    <Switch name="E2E switch" checked={true} />
  </Frame>
`

interface RenderToolResult {
  id: string
  name: string
  type: string
  children: string[]
  warnings?: string[]
}

interface ReadLowcodeResult {
  ok: boolean
  data?: {
    id: string
    type: string
    name: string
    bindings?: Record<string, unknown>
    events?: Record<string, unknown>
    interactiveProps?: Record<string, unknown>
    renderCondition?: string
    stateOverrides?: Record<string, unknown>
  }
  error?: string
}

async function renderLowcodeDocument() {
  const { graph, figma } = setupToolTest()
  const page = graph.getPages()[0]
  graph.updateNode(page.id, {
    name: 'Home',
    state: [
      {
        id: 'items-state',
        name: 'items',
        type: 'array',
        defaultValue: [{ label: 'First row' }]
      },
      {
        id: 'email-state',
        name: 'email',
        type: 'string',
        defaultValue: 'ada@example.com'
      }
    ]
  })

  expect(CORE_TOOLS.some((tool) => tool.name === 'render')).toBe(true)
  expect(CORE_TOOLS.some((tool) => tool.name === 'get_jsx')).toBe(true)
  expect(CORE_TOOLS.some((tool) => tool.name === 'read_lowcode_node')).toBe(true)
  expect(CORE_TOOLS.some((tool) => tool.name === 'update_lowcode_node')).toBe(true)

  const rendered = (await getTool('render').execute(figma, {
    jsx: CONTROLS_JSX
  })) as RenderToolResult
  expect(rendered).toMatchObject({ name: 'E2E lowcode controls', type: 'FRAME' })
  expect(rendered.warnings ?? []).toEqual([])

  const input = getNodeByName(graph, 'E2E input')
  const inputUpdate = getTool('update_lowcode_node').execute(figma, {
    id: input.id,
    patch_json: JSON.stringify({
      bindings: { value: { kind: 'ref', stateId: 'email-state' } }
    })
  }) as { ok: boolean; error?: string }
  expect(inputUpdate).toMatchObject({ ok: true })

  const button = getNodeByName(graph, 'E2E button')
  const buttonUpdate = getTool('update_lowcode_node').execute(figma, {
    id: button.id,
    patch_json: JSON.stringify({
      events: {
        onClick: [
          {
            id: 'save-email',
            kind: 'setState',
            targetStateId: 'email-state',
            valueExpr: '"saved@example.com"'
          }
        ]
      },
      renderCondition: 'email !== ""',
      stateOverrides: { hover: { opacity: 0.75 } }
    })
  }) as { ok: boolean; error?: string }
  expect(buttonUpdate).toMatchObject({ ok: true })

  return { figma, graph, pageId: page.id }
}

function getNodeByName(graph: SceneGraph, name: string): SceneNode {
  const node = [...graph.getAllNodes()].find((candidate) => candidate.name === name)
  if (!node) throw new Error(`Expected rendered node named "${name}"`)
  return node
}

function figBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

describe('CORE_TOOLS render lowcode → compiler → Figma-compatible .fig', () => {
  beforeAll(async () => {
    await initCodec()
  })

  test('Design JSX creates all 10 real lowcode types and read_lowcode_node sees their semantics', async () => {
    const { figma, graph } = await renderLowcodeDocument()
    const renderedControls = [...graph.getAllNodes()].filter((node) => LOWCODE_TYPES.has(node.type))

    expect(renderedControls).toHaveLength(CONTROL_CASES.length)
    expect(new Set(renderedControls.map((node) => node.type))).toEqual(LOWCODE_TYPES)

    for (const control of CONTROL_CASES) {
      const node = getNodeByName(graph, control.name)
      expect(node.type).toBe(control.type)
      expect(node.interactiveProps).toMatchObject(control.interactiveProps)

      const read = getTool('read_lowcode_node').execute(figma, {
        id: node.id
      }) as ReadLowcodeResult
      expect(read.ok).toBe(true)
      expect(read.data).toMatchObject({
        id: node.id,
        type: control.type,
        name: control.name,
        interactiveProps: control.interactiveProps,
        ...('bindings' in control ? { bindings: control.bindings } : {}),
        ...('events' in control ? { events: control.events } : {}),
        ...('renderCondition' in control ? { renderCondition: control.renderCondition } : {}),
        ...('stateOverrides' in control ? { stateOverrides: control.stateOverrides } : {})
      })
    }

    const button = getNodeByName(graph, 'E2E button')
    const buttonJSX = getTool('get_jsx').execute(figma, { id: button.id }) as { jsx: string }
    expect(buttonJSX.jsx).toContain('<Button')
    expect(buttonJSX.jsx).toContain('>Save changes</Button>')
    expect(buttonJSX.jsx).not.toContain('events=')
    expect(buttonJSX.jsx).not.toContain('renderCondition=')
    expect(buttonJSX.jsx).not.toContain('stateOverrides=')

    const input = getNodeByName(graph, 'E2E input')
    graph.updateNode(input.id, {
      interactiveProps: {
        ...input.interactiveProps,
        textColor: '#F7F4EE',
        placeholderColor: '#8B8B93'
      }
    })
    const inputJSX = getTool('get_jsx').execute(figma, { id: input.id }) as { jsx: string }
    expect(inputJSX.jsx).toContain('textColor="#F7F4EE"')
    expect(inputJSX.jsx).toContain('placeholderColor="#8B8B93"')
    expect(inputJSX.jsx).toContain('interactiveProps={{"validation":{"required":true}}}')
    expect(inputJSX.jsx).not.toContain('bindings=')

    const textarea = getNodeByName(graph, 'E2E textarea')
    graph.updateNode(textarea.id, {
      interactiveProps: {
        ...textarea.interactiveProps,
        textColor: '#111827',
        placeholderColor: '#6B7280'
      }
    })
    const textareaJSX = getTool('get_jsx').execute(figma, { id: textarea.id }) as { jsx: string }
    expect(textareaJSX.jsx).toContain('textColor="#111827"')
    expect(textareaJSX.jsx).toContain('placeholderColor="#6B7280"')

    expect(graph.getChildren(getNodeByName(graph, 'E2E button').id)).toEqual([])
    expect(graph.getChildren(getNodeByName(graph, 'E2E form').id).map((node) => node.name)).toEqual(
      ['E2E input']
    )
    expect(graph.getChildren(getNodeByName(graph, 'E2E list').id).map((node) => node.name)).toEqual(
      ['E2E list template']
    )
  })

  test('the compiler emits native behavior for every rendered lowcode type', async () => {
    const { graph, pageId } = await renderLowcodeDocument()
    const output = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ packageName: 'render-lowcode-fig-e2e' })
    })
    const app = output.files.get('src/App.tsx') as string

    expect(output.warnings).toEqual([])
    expect(app).toContain('<button')
    expect(app).toContain('Save changes')
    expect(app).toContain('setEmail("saved@example.com")')
    expect(app).toContain('{(email !== "") && (')
    expect(app).toContain('hover:opacity-75')
    expect(app).toContain('placeholder="Email address"')
    expect(app).toContain('value={email}')
    expect(app).toContain('<select')
    expect(app).toContain('value="Published">Published</option>')
    expect(app).toContain('type="checkbox"')
    expect(app).toContain('<form')
    expect(app).toContain('Fix these fields')
    expect(app).toContain('(items).map((entry, entryIndex) => (')
    expect(app).toContain('type="radio"')
    expect(app).toContain('name="answer"')
    expect(app).toContain('<textarea')
    expect(app).toContain('defaultValue="Draft note"')
    expect(app).toContain('type="date"')
    expect(app).toContain('min="2026-01-01"')
    expect(app).toContain('max="2026-12-31"')
    expect(app).toContain('role="switch"')
  })

  test('Figma-compatible export parses back to all 10 semantic nodes without projection layers', async () => {
    const { graph } = await renderLowcodeDocument()
    const bytes = await exportFigFileWithOptions(graph, { profile: 'figma-compatible' })
    const imported = await parseFigFile(figBuffer(bytes))

    for (const control of CONTROL_CASES) {
      const node = getNodeByName(imported, control.name)
      expect(node.type).toBe(control.type)
      expect(node.interactiveProps).toMatchObject(control.interactiveProps)
      if ('bindings' in control) expect(node.bindings).toMatchObject(control.bindings)
      if ('events' in control) expect(node.events).toMatchObject(control.events)
      if ('renderCondition' in control) expect(node.renderCondition).toBe(control.renderCondition)
      if ('stateOverrides' in control)
        expect(node.stateOverrides).toMatchObject(control.stateOverrides)
    }

    expect([...imported.getAllNodes()].filter((node) => LOWCODE_TYPES.has(node.type))).toHaveLength(
      CONTROL_CASES.length
    )
    expect([...imported.getAllNodes()].some((node) => node.name.startsWith('[OpenPencil]'))).toBe(
      false
    )
    expect(
      imported.getChildren(getNodeByName(imported, 'E2E form').id).map((node) => node.name)
    ).toEqual(['E2E input'])
    expect(
      imported.getChildren(getNodeByName(imported, 'E2E list').id).map((node) => node.name)
    ).toEqual(['E2E list template'])
  })
})
