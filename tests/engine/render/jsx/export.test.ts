/* eslint-disable max-lines -- JSX export round-trip coverage stays grouped by public format */
import { describe, expect, test } from 'bun:test'

import { SceneGraph, renderJSX, sceneNodeToJSX, selectionToJSX } from '@open-pencil/core'

function makeGraph() {
  const graph = new SceneGraph()
  graph.createNode('CANVAS', graph.rootId, { name: 'Page 1' })
  return graph
}

function pageId(graph: SceneGraph) {
  return graph.getPages()[0].id
}

describe('sceneNodeToJSX', () => {
  test('basic rectangle', () => {
    const graph = makeGraph()
    const node = graph.createNode('RECTANGLE', pageId(graph), {
      name: 'Box',
      width: 100,
      height: 50
    })
    const jsx = sceneNodeToJSX(node.id, graph)
    expect(jsx).toBe('<Rectangle name="Box" w={100} h={50} />')
  })

  test('rectangle with fill and rounded corners', () => {
    const graph = makeGraph()
    const node = graph.createNode('RECTANGLE', pageId(graph), {
      name: 'Card',
      width: 320,
      height: 200,
      fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, opacity: 1, visible: true }],
      cornerRadius: 16
    })
    const jsx = sceneNodeToJSX(node.id, graph)
    expect(jsx).toContain('w={320}')
    expect(jsx).toContain('h={200}')
    expect(jsx).toContain('bg="#FFFFFF"')
    expect(jsx).toContain('rounded={16}')
    expect(jsx).toContain('<Rectangle')
    expect(jsx).toContain('/>')
  })

  test('text node', () => {
    const graph = makeGraph()
    const node = graph.createNode('TEXT', pageId(graph), {
      name: 'Title',
      width: 200,
      height: 24,
      text: 'Hello World',
      fontSize: 18,
      fontWeight: 700,
      fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }]
    })
    const jsx = sceneNodeToJSX(node.id, graph)
    expect(jsx).toContain('<Text')
    expect(jsx).toContain('size={18}')
    expect(jsx).toContain('weight="bold"')
    expect(jsx).toContain('color="#000000"')
    expect(jsx).toContain('>Hello World</Text>')
  })

  test('button node uses interactive text so code panel is not empty', () => {
    const graph = makeGraph()
    const node = graph.createNode('BUTTON', pageId(graph), {
      name: 'Primary CTA',
      width: 120,
      height: 40,
      interactiveProps: { text: 'Submit' }
    })

    const jsx = sceneNodeToJSX(node.id, graph)
    expect(jsx).toContain('<Button')
    expect(jsx).toContain('name="Primary CTA"')
    expect(jsx).toContain('w={120}')
    expect(jsx).toContain('h={40}')
    expect(jsx).toContain('>Submit</Button>')
    expect(selectionToJSX([node.id], graph)).toContain('<Button')
  })

  test('button node emits html button in tailwind format', () => {
    const graph = makeGraph()
    const node = graph.createNode('BUTTON', pageId(graph), {
      width: 120,
      height: 40,
      interactiveProps: { text: 'Save' }
    })

    const jsx = sceneNodeToJSX(node.id, graph, 'tailwind')
    expect(jsx).toContain('<button')
    expect(jsx).toContain('>Save</button>')
  })

  test('input node exposes placeholder in OpenPencil and tailwind formats', () => {
    const graph = makeGraph()
    const node = graph.createNode('INPUT', pageId(graph), {
      name: 'Email Field',
      width: 240,
      height: 36,
      interactiveProps: { placeholder: 'Email address', value: 'hello@example.com' }
    })

    const openpencil = sceneNodeToJSX(node.id, graph)
    expect(openpencil).toContain('<Input')
    expect(openpencil).toContain('name="Email Field"')
    expect(openpencil).toContain('placeholder="Email address"')
    expect(openpencil).toContain('value="hello@example.com"')
    expect(selectionToJSX([node.id], graph)).toContain('<Input')

    const tailwind = sceneNodeToJSX(node.id, graph, 'tailwind')
    expect(tailwind).toContain('<input')
    expect(tailwind).toContain('placeholder="Email address"')
    expect(tailwind).toContain('defaultValue="hello@example.com"')
  })

  test('select node exposes options in OpenPencil and tailwind formats', () => {
    const graph = makeGraph()
    const node = graph.createNode('SELECT', pageId(graph), {
      name: 'Country Select',
      width: 220,
      height: 36,
      interactiveProps: { options: ['US', 'JP'], value: 'JP' }
    })

    const openpencil = sceneNodeToJSX(node.id, graph)
    expect(openpencil).toContain('<Select')
    expect(openpencil).toContain('name="Country Select"')
    expect(openpencil).toContain('options={["US","JP"]}')
    expect(openpencil).toContain('value="JP"')
    expect(selectionToJSX([node.id], graph)).toContain('<Select')

    const tailwind = sceneNodeToJSX(node.id, graph, 'tailwind')
    expect(tailwind).toContain('<select')
    expect(tailwind).toContain('defaultValue="JP"')
    expect(tailwind).toContain('<option value="US">US</option>')
    expect(tailwind).toContain('<option value="JP">JP</option>')
  })

  test('all lowcode node types preserve direct props and advanced interactiveProps', () => {
    const graph = makeGraph()
    const parent = pageId(graph)
    const nodes = {
      button: graph.createNode('BUTTON', parent, {
        interactiveProps: { text: 'Launch', uiKit: { variant: 'primary' } }
      }),
      input: graph.createNode('INPUT', parent, {
        interactiveProps: {
          placeholder: 'Email',
          value: 'ada@example.com',
          validation: { required: true }
        }
      }),
      select: graph.createNode('SELECT', parent, {
        interactiveProps: {
          options: ['Draft', 'Published'],
          value: 'Published',
          optionsSource: { kind: 'docStateRef', docStateName: 'statuses' }
        }
      }),
      checkbox: graph.createNode('CHECKBOX', parent, {
        interactiveProps: { checked: true, uiKit: { primitive: 'checkbox' } }
      }),
      form: graph.createNode('FORM', parent, {
        interactiveProps: { validationSummary: { enabled: true, title: 'Fix fields' } }
      }),
      list: graph.createNode('LIST', parent, {
        interactiveProps: {
          dataSourceRef: { kind: 'stateRef', stateId: 'items' },
          itemName: 'entry',
          indexName: 'entryIndex'
        }
      }),
      radio: graph.createNode('RADIO', parent, {
        interactiveProps: {
          options: ['Yes', 'No'],
          value: 'Yes',
          groupName: 'answer',
          analytics: { field: 'answer' }
        }
      }),
      textarea: graph.createNode('TEXTAREA', parent, {
        interactiveProps: {
          placeholder: 'Notes',
          value: 'Draft',
          validation: { maxLength: 500 }
        }
      }),
      datepicker: graph.createNode('DATEPICKER', parent, {
        interactiveProps: {
          value: '2026-07-27',
          min: '2026-01-01',
          max: '2026-12-31',
          validation: { required: true }
        }
      }),
      switchNode: graph.createNode('SWITCH', parent, {
        interactiveProps: { checked: true, featureFlag: 'new-navigation' }
      })
    }

    const button = sceneNodeToJSX(nodes.button.id, graph)
    expect(button).toContain('<Button')
    expect(button).toContain('interactiveProps={{"uiKit":{"variant":"primary"}}}')
    expect(button).toContain('>Launch</Button>')

    const input = sceneNodeToJSX(nodes.input.id, graph)
    expect(input).toContain('<Input')
    expect(input).toContain('placeholder="Email"')
    expect(input).toContain('value="ada@example.com"')
    expect(input).toContain('interactiveProps={{"validation":{"required":true}}}')

    const select = sceneNodeToJSX(nodes.select.id, graph)
    expect(select).toContain('<Select')
    expect(select).toContain('options={["Draft","Published"]}')
    expect(select).toContain('value="Published"')
    expect(select).toContain(
      'interactiveProps={{"optionsSource":{"kind":"docStateRef","docStateName":"statuses"}}}'
    )

    expect(sceneNodeToJSX(nodes.checkbox.id, graph)).toContain('<Checkbox')
    expect(sceneNodeToJSX(nodes.checkbox.id, graph)).toContain('checked')
    expect(sceneNodeToJSX(nodes.form.id, graph)).toContain('<Form')
    expect(sceneNodeToJSX(nodes.form.id, graph)).toContain(
      'interactiveProps={{"validationSummary":{"enabled":true,"title":"Fix fields"}}}'
    )
    expect(sceneNodeToJSX(nodes.list.id, graph)).toContain('<List')
    expect(sceneNodeToJSX(nodes.list.id, graph)).toContain(
      'interactiveProps={{"dataSourceRef":{"kind":"stateRef","stateId":"items"},"itemName":"entry","indexName":"entryIndex"}}'
    )

    const radio = sceneNodeToJSX(nodes.radio.id, graph)
    expect(radio).toContain('<Radio')
    expect(radio).toContain('options={["Yes","No"]}')
    expect(radio).toContain('value="Yes"')
    expect(radio).toContain('groupName="answer"')
    expect(radio).toContain('interactiveProps={{"analytics":{"field":"answer"}}}')

    const textarea = sceneNodeToJSX(nodes.textarea.id, graph)
    expect(textarea).toContain('<Textarea')
    expect(textarea).toContain('placeholder="Notes"')
    expect(textarea).toContain('value="Draft"')
    expect(textarea).toContain('interactiveProps={{"validation":{"maxLength":500}}}')

    const datepicker = sceneNodeToJSX(nodes.datepicker.id, graph)
    expect(datepicker).toContain('<DatePicker')
    expect(datepicker).toContain('value="2026-07-27"')
    expect(datepicker).toContain('min="2026-01-01"')
    expect(datepicker).toContain('max="2026-12-31"')
    expect(datepicker).toContain('interactiveProps={{"validation":{"required":true}}}')

    const switchNode = sceneNodeToJSX(nodes.switchNode.id, graph)
    expect(switchNode).toContain('<Switch')
    expect(switchNode).toContain('checked')
    expect(switchNode).toContain('interactiveProps={{"featureFlag":"new-navigation"}}')
  })

  test('all lowcode node types survive an OpenPencil JSX round trip', async () => {
    const source = makeGraph()
    const root = source.createNode('FRAME', pageId(source), { name: 'Round-trip controls' })
    source.createNode('BUTTON', root.id, {
      name: 'Submit',
      interactiveProps: { text: 'Save' }
    })
    source.createNode('INPUT', root.id, {
      name: 'Email',
      interactiveProps: {
        placeholder: 'Email address',
        value: 'ada@example.com',
        validation: { required: true }
      }
    })
    source.createNode('SELECT', root.id, {
      name: 'Role',
      interactiveProps: { options: ['Admin', 'Editor'], value: 'Editor' }
    })
    source.createNode('CHECKBOX', root.id, {
      name: 'Topics',
      interactiveProps: { options: ['News', 'Events'], checked: true }
    })
    source.createNode('FORM', root.id, {
      name: 'Profile form',
      interactiveProps: { validationSummary: { enabled: true, title: 'Fix fields' } }
    })
    source.createNode('LIST', root.id, {
      name: 'Results',
      interactiveProps: {
        dataSourceRef: { kind: 'stateRef', stateId: 'items' },
        itemName: 'entry',
        indexName: 'entryIndex'
      }
    })
    source.createNode('RADIO', root.id, {
      name: 'Plan',
      interactiveProps: { options: ['Free', 'Pro'], value: 'Pro', groupName: 'plans' }
    })
    source.createNode('TEXTAREA', root.id, {
      name: 'Bio',
      interactiveProps: { placeholder: 'About you', value: 'Hello' }
    })
    source.createNode('DATEPICKER', root.id, {
      name: 'Birthday',
      interactiveProps: { value: '2026-07-27', min: '2020-01-01', max: '2030-01-01' }
    })
    source.createNode('SWITCH', root.id, {
      name: 'Alerts',
      interactiveProps: { checked: true }
    })

    const target = makeGraph()
    const [rendered] = await renderJSX(target, sceneNodeToJSX(root.id, source))
    const renderedRoot = target.getNode(rendered.id)
    expect(renderedRoot).toBeDefined()

    const children = (renderedRoot?.childIds ?? []).map((id) => target.getNode(id))
    expect(children.map((node) => node?.type)).toEqual([
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

    expect(children[0]?.interactiveProps).toMatchObject({ text: 'Save' })
    expect(children[1]?.interactiveProps).toMatchObject({
      placeholder: 'Email address',
      value: 'ada@example.com',
      validation: { required: true }
    })
    expect(children[2]?.interactiveProps).toMatchObject({
      options: ['Admin', 'Editor'],
      value: 'Editor'
    })
    expect(children[3]?.interactiveProps).toMatchObject({
      options: ['News', 'Events'],
      checked: true
    })
    expect(children[4]?.interactiveProps).toMatchObject({
      validationSummary: { enabled: true, title: 'Fix fields' }
    })
    expect(children[5]?.interactiveProps).toMatchObject({
      dataSourceRef: { kind: 'stateRef', stateId: 'items' },
      itemName: 'entry',
      indexName: 'entryIndex'
    })
    expect(children[6]?.interactiveProps).toMatchObject({
      options: ['Free', 'Pro'],
      value: 'Pro',
      groupName: 'plans'
    })
    expect(children[7]?.interactiveProps).toMatchObject({
      placeholder: 'About you',
      value: 'Hello'
    })
    expect(children[8]?.interactiveProps).toMatchObject({
      value: '2026-07-27',
      min: '2020-01-01',
      max: '2030-01-01'
    })
    expect(children[9]?.interactiveProps).toMatchObject({ checked: true })
  })

  test('escaped string props and select options survive export and render', async () => {
    const source = makeGraph()
    const root = source.createNode('FRAME', pageId(source), { name: 'Escaped values' })
    const fieldValue = 'Say "hello" from C:\\temp\nnext line'
    const optionValue = 'Choice "A" at C:\\tmp\nsecond line'
    source.createNode('INPUT', root.id, {
      name: 'Escaped input',
      interactiveProps: { placeholder: fieldValue, value: fieldValue }
    })
    const select = source.createNode('SELECT', root.id, {
      name: 'Escaped select',
      interactiveProps: { options: [optionValue, 'Plain'], value: optionValue }
    })

    const jsx = sceneNodeToJSX(root.id, source)
    expect(jsx).toContain(`placeholder={${JSON.stringify(fieldValue)}}`)
    expect(jsx).toContain(`value={${JSON.stringify(optionValue)}}`)

    const target = makeGraph()
    const [rendered] = await renderJSX(target, jsx)
    const children = target.getChildren(rendered.id)
    expect(children[0]?.interactiveProps).toMatchObject({
      placeholder: fieldValue,
      value: fieldValue
    })
    expect(children[1]?.interactiveProps).toMatchObject({
      options: [optionValue, 'Plain'],
      value: optionValue
    })

    const tailwind = sceneNodeToJSX(select.id, source, 'tailwind')
    expect(tailwind).toContain(`<option value={${JSON.stringify(optionValue)}}>`)
  })

  test('all lowcode node types use semantic HTML tags in tailwind format', () => {
    const graph = makeGraph()
    const parent = pageId(graph)
    const button = graph.createNode('BUTTON', parent, { interactiveProps: { text: 'Save' } })
    const input = graph.createNode('INPUT', parent, {
      interactiveProps: { placeholder: 'Email', value: 'ada@example.com' }
    })
    const select = graph.createNode('SELECT', parent, {
      interactiveProps: { options: ['A', 'B'], value: 'B' }
    })
    const checkbox = graph.createNode('CHECKBOX', parent, {
      interactiveProps: { checked: true }
    })
    const form = graph.createNode('FORM', parent)
    const list = graph.createNode('LIST', parent)
    const radio = graph.createNode('RADIO', parent, {
      interactiveProps: { options: ['Yes', 'No'], value: 'Yes', groupName: 'answer' }
    })
    const textarea = graph.createNode('TEXTAREA', parent, {
      interactiveProps: { placeholder: 'Notes', value: 'Draft' }
    })
    const datepicker = graph.createNode('DATEPICKER', parent, {
      interactiveProps: { value: '2026-07-27', min: '2026-01-01', max: '2026-12-31' }
    })
    const switchNode = graph.createNode('SWITCH', parent, {
      interactiveProps: { checked: true }
    })

    expect(sceneNodeToJSX(button.id, graph, 'tailwind')).toContain('type="button"')
    expect(sceneNodeToJSX(input.id, graph, 'tailwind')).toContain('type="text"')
    expect(sceneNodeToJSX(select.id, graph, 'tailwind')).toContain('<select')
    expect(sceneNodeToJSX(checkbox.id, graph, 'tailwind')).toContain('type="checkbox"')
    expect(sceneNodeToJSX(form.id, graph, 'tailwind')).toContain('<form')
    expect(sceneNodeToJSX(list.id, graph, 'tailwind')).toContain('<div')

    const radioJsx = sceneNodeToJSX(radio.id, graph, 'tailwind')
    expect(radioJsx).toContain('<div')
    expect(radioJsx).toContain('role="radiogroup"')
    expect(radioJsx).toContain('type="radio"')
    expect(radioJsx).toContain('name="answer"')
    expect(radioJsx).toContain('defaultChecked')

    const textareaJsx = sceneNodeToJSX(textarea.id, graph, 'tailwind')
    expect(textareaJsx).toContain('<textarea')
    expect(textareaJsx).toContain('placeholder="Notes"')
    expect(textareaJsx).toContain('defaultValue="Draft"')

    const datepickerJsx = sceneNodeToJSX(datepicker.id, graph, 'tailwind')
    expect(datepickerJsx).toContain('type="date"')
    expect(datepickerJsx).toContain('defaultValue="2026-07-27"')
    expect(datepickerJsx).toContain('min="2026-01-01"')
    expect(datepickerJsx).toContain('max="2026-12-31"')

    const switchJsx = sceneNodeToJSX(switchNode.id, graph, 'tailwind')
    expect(switchJsx).toContain('type="checkbox"')
    expect(switchJsx).toContain('role="switch"')
    expect(switchJsx).toContain('defaultChecked')
  })

  test('rtl text node', () => {
    const graph = makeGraph()
    const node = graph.createNode('TEXT', pageId(graph), {
      name: 'Arabic Title',
      width: 200,
      height: 24,
      text: 'مرحبا',
      textDirection: 'RTL'
    })
    const jsx = sceneNodeToJSX(node.id, graph)
    expect(jsx).toContain('dir="rtl"')
  })

  test('frame with auto-layout', () => {
    const graph = makeGraph()
    const frame = graph.createNode('FRAME', pageId(graph), {
      name: 'Row',
      width: 400,
      height: 100,
      layoutMode: 'HORIZONTAL',
      itemSpacing: 16,
      paddingTop: 12,
      paddingRight: 12,
      paddingBottom: 12,
      paddingLeft: 12,
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'HUG'
    })
    const jsx = sceneNodeToJSX(frame.id, graph)
    expect(jsx).toContain('flex="row"')
    expect(jsx).toContain('gap={16}')
    expect(jsx).toContain('p={12}')
    expect(jsx).toContain('w={400}')
  })

  test('frame with rtl auto-layout', () => {
    const graph = makeGraph()
    const frame = graph.createNode('FRAME', pageId(graph), {
      name: 'Row RTL',
      width: 400,
      height: 100,
      layoutMode: 'HORIZONTAL',
      layoutDirection: 'RTL'
    })
    const jsx = sceneNodeToJSX(frame.id, graph)
    expect(jsx).toContain('dir="rtl"')
  })

  test('frame with children', () => {
    const graph = makeGraph()
    const frame = graph.createNode('FRAME', pageId(graph), {
      name: 'Card',
      width: 320,
      height: 200,
      layoutMode: 'VERTICAL',
      itemSpacing: 8,
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'FIXED'
    })
    graph.createNode('RECTANGLE', frame.id, {
      name: 'Image',
      width: 320,
      height: 120
    })
    graph.createNode('TEXT', frame.id, {
      name: 'Title',
      width: 200,
      height: 20,
      text: 'Card Title',
      fontSize: 16,
      fontWeight: 700,
      fills: [{ type: 'SOLID', color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true }]
    })

    const jsx = sceneNodeToJSX(frame.id, graph)
    expect(jsx).toContain('<Frame')
    expect(jsx).toContain('flex="col"')
    expect(jsx).toContain('gap={8}')
    expect(jsx).toContain('  <Rectangle')
    expect(jsx).toContain('  <Text')
    expect(jsx).toContain('>Card Title</Text>')
    expect(jsx).toContain('</Frame>')
  })

  test('asymmetric padding', () => {
    const graph = makeGraph()
    const frame = graph.createNode('FRAME', pageId(graph), {
      name: 'Box',
      width: 100,
      height: 100,
      layoutMode: 'HORIZONTAL',
      paddingTop: 8,
      paddingRight: 16,
      paddingBottom: 8,
      paddingLeft: 16,
      primaryAxisSizing: 'FIXED',
      counterAxisSizing: 'FIXED'
    })
    const jsx = sceneNodeToJSX(frame.id, graph)
    expect(jsx).toContain('py={8}')
    expect(jsx).toContain('px={16}')
    expect(jsx).not.toContain('pt=')
    expect(jsx).not.toContain('pb=')
  })

  test('independent corners', () => {
    const graph = makeGraph()
    const node = graph.createNode('RECTANGLE', pageId(graph), {
      name: 'Pill',
      width: 100,
      height: 40,
      cornerRadius: 20,
      independentCorners: true,
      topLeftRadius: 20,
      topRightRadius: 0,
      bottomRightRadius: 0,
      bottomLeftRadius: 20
    })
    const jsx = sceneNodeToJSX(node.id, graph)
    expect(jsx).toContain('roundedTL={20}')
    expect(jsx).toContain('roundedBL={20}')
    expect(jsx).not.toContain('roundedTR=')
    expect(jsx).not.toContain('roundedBR=')
  })

  test('opacity and rotation', () => {
    const graph = makeGraph()
    const node = graph.createNode('RECTANGLE', pageId(graph), {
      width: 50,
      height: 50,
      opacity: 0.5,
      rotation: 45
    })
    const jsx = sceneNodeToJSX(node.id, graph)
    expect(jsx).toContain('opacity={0.5}')
    expect(jsx).toContain('rotate={45}')
  })

  test('stroke', () => {
    const graph = makeGraph()
    const node = graph.createNode('RECTANGLE', pageId(graph), {
      width: 100,
      height: 100,
      strokes: [
        {
          color: { r: 1, g: 0, b: 0, a: 1 },
          weight: 2,
          opacity: 1,
          visible: true,
          align: 'INSIDE' as const
        }
      ]
    })
    const jsx = sceneNodeToJSX(node.id, graph)
    expect(jsx).toContain('stroke="#FF0000"')
    expect(jsx).toContain('strokeWidth={2}')
  })

  test('hidden children are excluded', () => {
    const graph = makeGraph()
    const frame = graph.createNode('FRAME', pageId(graph), {
      name: 'Parent',
      width: 100,
      height: 100
    })
    graph.createNode('RECTANGLE', frame.id, {
      name: 'Visible',
      width: 50,
      height: 50
    })
    graph.createNode('RECTANGLE', frame.id, {
      name: 'Hidden',
      width: 50,
      height: 50,
      visible: false
    })
    const jsx = sceneNodeToJSX(frame.id, graph)
    expect(jsx).toContain('Visible')
    expect(jsx).not.toContain('Hidden')
  })

  test('empty text node renders self-closing', () => {
    const graph = makeGraph()
    const node = graph.createNode('TEXT', pageId(graph), {
      name: 'Empty',
      width: 100,
      height: 20,
      text: ''
    })
    const jsx = sceneNodeToJSX(node.id, graph)
    expect(jsx).toContain('/>')
    expect(jsx).not.toContain('</Text>')
  })

  test('omits default values', () => {
    const graph = makeGraph()
    const node = graph.createNode('RECTANGLE', pageId(graph), {
      width: 100,
      height: 100,
      opacity: 1,
      rotation: 0,
      cornerRadius: 0
    })
    const jsx = sceneNodeToJSX(node.id, graph)
    expect(jsx).not.toContain('opacity')
    expect(jsx).not.toContain('rotate')
    expect(jsx).not.toContain('rounded')
  })

  test('effects: shadow and blur', () => {
    const graph = makeGraph()
    const node = graph.createNode('RECTANGLE', pageId(graph), {
      width: 100,
      height: 100,
      effects: [
        {
          type: 'DROP_SHADOW',
          color: { r: 0, g: 0, b: 0, a: 0.25 },
          offset: { x: 0, y: 4 },
          radius: 8,
          spread: 0,
          visible: true
        },
        {
          type: 'LAYER_BLUR',
          color: { r: 0, g: 0, b: 0, a: 0 },
          offset: { x: 0, y: 0 },
          radius: 4,
          spread: 0,
          visible: true
        }
      ]
    })
    const jsx = sceneNodeToJSX(node.id, graph)
    expect(jsx).toContain('shadow="0 4 8')
    expect(jsx).toContain('blur={4}')
  })

  test('grid layout frame', () => {
    const graph = makeGraph()
    const frame = graph.createNode('FRAME', pageId(graph), {
      name: 'Grid',
      width: 400,
      height: 300,
      layoutMode: 'GRID',
      gridTemplateColumns: [
        { sizing: 'FR', value: 1 },
        { sizing: 'FR', value: 1 },
        { sizing: 'FR', value: 1 }
      ],
      gridTemplateRows: [
        { sizing: 'FR', value: 1 },
        { sizing: 'FR', value: 1 }
      ],
      gridColumnGap: 16,
      gridRowGap: 8,
      paddingTop: 12,
      paddingRight: 12,
      paddingBottom: 12,
      paddingLeft: 12
    })
    const jsx = sceneNodeToJSX(frame.id, graph)
    expect(jsx).toContain('grid')
    expect(jsx).toContain('columns="1fr 1fr 1fr"')
    expect(jsx).toContain('rows="1fr 1fr"')
    expect(jsx).toContain('columnGap={16}')
    expect(jsx).toContain('rowGap={8}')
    expect(jsx).toContain('p={12}')
    expect(jsx).toContain('w={400}')
    expect(jsx).not.toContain('flex')
  })

  test('grid with mixed track sizes', () => {
    const graph = makeGraph()
    const frame = graph.createNode('FRAME', pageId(graph), {
      width: 600,
      height: 400,
      layoutMode: 'GRID',
      gridTemplateColumns: [
        { sizing: 'FIXED', value: 200 },
        { sizing: 'FR', value: 1 },
        { sizing: 'AUTO', value: 0 }
      ],
      gridTemplateRows: [],
      gridColumnGap: 0,
      gridRowGap: 0
    })
    const jsx = sceneNodeToJSX(frame.id, graph)
    expect(jsx).toContain('columns="200px 1fr auto"')
    expect(jsx).not.toContain('rows=')
    expect(jsx).not.toContain('columnGap')
  })

  test('child grid position', () => {
    const graph = makeGraph()
    const frame = graph.createNode('FRAME', pageId(graph), {
      width: 400,
      height: 300,
      layoutMode: 'GRID',
      gridTemplateColumns: [
        { sizing: 'FR', value: 1 },
        { sizing: 'FR', value: 1 }
      ],
      gridTemplateRows: [
        { sizing: 'FR', value: 1 },
        { sizing: 'FR', value: 1 }
      ],
      gridColumnGap: 0,
      gridRowGap: 0
    })
    const child = graph.createNode('RECTANGLE', frame.id, {
      name: 'Span',
      width: 100,
      height: 50,
      gridPosition: { column: 1, row: 2, columnSpan: 2, rowSpan: 1 }
    })
    const jsx = sceneNodeToJSX(child.id, graph)
    expect(jsx).toContain('colStart={1}')
    expect(jsx).toContain('rowStart={2}')
    expect(jsx).toContain('colSpan={2}')
    expect(jsx).not.toContain('rowSpan')
  })
})

describe('selectionToJSX', () => {
  test('multiple nodes separated by blank lines', () => {
    const graph = makeGraph()
    const a = graph.createNode('RECTANGLE', pageId(graph), {
      name: 'A',
      width: 10,
      height: 10
    })
    const b = graph.createNode('ELLIPSE', pageId(graph), {
      name: 'B',
      width: 20,
      height: 20
    })
    const jsx = selectionToJSX([a.id, b.id], graph)
    expect(jsx).toContain('<Rectangle')
    expect(jsx).toContain('<Ellipse')
    expect(jsx).toContain('\n\n')
  })
})
