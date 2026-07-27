import { describe, expect, it } from 'bun:test'

import {
  Button,
  Checkbox,
  DatePicker,
  Form,
  INTRINSIC_ELEMENTS,
  Input,
  List,
  Radio,
  Select,
  Switch,
  Textarea,
  renderJSX
} from '#core/design-jsx'

import { childIdAt, expectDefined, getNodeOrThrow } from '#tests/helpers/assert'
import { makeSceneGraph } from '#tests/helpers/scene'

describe('Design JSX lowcode tags', () => {
  it('exposes builders and intrinsic names for all ten lowcode node types', () => {
    const trees = [
      Button({}),
      Input({}),
      Select({}),
      Checkbox({}),
      Form({}),
      List({}),
      Radio({}),
      Textarea({}),
      DatePicker({}),
      Switch({})
    ]

    expect(trees.map((tree) => tree.type)).toEqual([
      'button',
      'input',
      'select',
      'checkbox',
      'form',
      'list',
      'radio',
      'textarea',
      'datepicker',
      'switch'
    ])
    for (const type of trees.map((tree) => tree.type)) {
      expect(INTRINSIC_ELEMENTS).toContain(type)
    }
    expect(INTRINSIC_ELEMENTS).toContain('date-picker')
  })

  it('renders PascalCase aliases as true lowcode SceneNode types', async () => {
    const graph = makeSceneGraph()
    const [result] = await renderJSX(
      graph,
      `<Frame name="Controls">
        <Button name="Submit">Save</Button>
        <Input name="Email" placeholder="Email" />
        <Select name="Role" options={['Admin', 'Editor']} value="Editor" />
        <Checkbox name="Topics" options={['News', 'Events']} checked={true} />
        <Form name="Profile form"><Input name="Nested input" /></Form>
        <List name="Results"><Text name="Row">Item</Text></List>
        <Radio name="Plan" options={['Free', 'Pro']} value="Pro" groupName="plans" />
        <Textarea name="Bio" placeholder="About you" value="Hello" />
        <DatePicker name="Birthday" value="2026-07-27" min="2020-01-01" max="2030-01-01" />
        <Switch name="Alerts" checked={true} />
      </Frame>`
    )

    const controls = getNodeOrThrow(graph, result.id)
    const children = controls.childIds.map((id) => getNodeOrThrow(graph, id))
    expect(children.map((node) => node.type)).toEqual([
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
    expect(children[1]?.interactiveProps).toMatchObject({ placeholder: 'Email', value: '' })
    expect(children[2]?.interactiveProps).toMatchObject({
      options: ['Admin', 'Editor'],
      value: 'Editor'
    })
    expect(children[3]?.interactiveProps).toMatchObject({
      options: ['News', 'Events'],
      checked: true
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

    const form = children[4]
    const list = children[5]
    expect(form && getNodeOrThrow(graph, childIdAt(form, 0)).type).toBe('INPUT')
    expect(list && getNodeOrThrow(graph, childIdAt(list, 0)).type).toBe('TEXT')
  })

  it('supports lowercase intrinsics and the date-picker alias', async () => {
    const graph = makeSceneGraph()
    const results = await renderJSX(
      graph,
      `<><button>Go</button><input placeholder="Search" /><date-picker value="2026-01-02" /></>`
    )

    expect(results.map((result) => result.type)).toEqual(['BUTTON', 'INPUT', 'DATEPICKER'])
    const buttonResult = expectDefined(results[0], 'lowercase button result')
    expect(getNodeOrThrow(graph, buttonResult.id).interactiveProps?.text).toBe('Go')
  })

  it('merges defaults, interactiveProps, direct props, and button text in precedence order', async () => {
    const graph = makeSceneGraph()
    const [result] = await renderJSX(
      graph,
      `<Frame>
        <Button interactiveProps={{ text: 'object', custom: { source: 'jsx' } }} text="direct">child</Button>
        <Input interactiveProps={{ placeholder: 'object', custom: true }} placeholder="direct" />
      </Frame>`
    )
    const frame = getNodeOrThrow(graph, result.id)
    const button = getNodeOrThrow(graph, childIdAt(frame, 0))
    const input = getNodeOrThrow(graph, childIdAt(frame, 1))

    expect(button.interactiveProps).toEqual({
      text: 'child',
      custom: { source: 'jsx' }
    })
    expect(input.interactiveProps).toEqual({
      placeholder: 'direct',
      value: '',
      custom: true
    })
  })

  it('preflights the whole tree before creating any node', async () => {
    const graph = makeSceneGraph()
    const page = expectDefined(graph.getPages()[0], 'current page')
    const before = [...page.childIds]

    await expect(
      renderJSX(
        graph,
        `<><Button>Valid sibling</Button><Frame><Select options={['ok', 7]} /></Frame></>`
      )
    ).rejects.toThrow('options must be an array of strings')

    expect(page.childIds).toEqual(before)
  })

  it('uses shared validation for advanced interactiveProps', async () => {
    const graph = makeSceneGraph()
    const page = expectDefined(graph.getPages()[0], 'current page')

    await expect(
      renderJSX(
        graph,
        `<Frame><Input interactiveProps={{ validation: { pattern: '[' } }} /></Frame>`
      )
    ).rejects.toThrow('interactiveProps.validation.pattern must compile')
    await expect(renderJSX(graph, `<DatePicker value="2026-02-30" />`)).rejects.toThrow(
      'interactiveProps.value must be a valid YYYY-MM-DD date'
    )
    expect(page.childIds).toEqual([])
  })

  it('returns non-blocking DatePicker range warnings while preserving values', async () => {
    const graph = makeSceneGraph()
    const [result] = await renderJSX(
      graph,
      `<DatePicker value="2026-01-01" min="2026-02-01" max="2026-12-31" />`
    )
    const datePicker = getNodeOrThrow(graph, result.id)

    expect(datePicker.interactiveProps).toMatchObject({
      value: '2026-01-01',
      min: '2026-02-01',
      max: '2026-12-31'
    })
    expect(result.warnings?.join('\n')).toContain('outside the configured min/max range')
  })

  it('rejects invalid convenience prop types before node creation', async () => {
    const graph = makeSceneGraph()
    const page = expectDefined(graph.getPages()[0], 'current page')

    await expect(renderJSX(graph, `<Switch checked="yes" />`)).rejects.toThrow(
      'checked must be a boolean'
    )
    await expect(renderJSX(graph, `<Input value={42} />`)).rejects.toThrow('value must be a string')
    expect(page.childIds).toEqual([])
  })

  it('does not allow JSX props to bypass other lowcode mutation boundaries', async () => {
    const graph = makeSceneGraph()
    const [result] = await renderJSX(
      graph,
      `<Button events={{ click: [] }} renderCondition="enabled">Save</Button>`
    )
    const button = getNodeOrThrow(graph, result.id)

    expect(button.events).toBeUndefined()
    expect(button.renderCondition).toBeUndefined()
    expect(result.warnings?.join('\n')).toContain('Unsupported prop "events"')
    expect(result.warnings?.join('\n')).toContain('Unsupported prop "renderCondition"')
  })
})
