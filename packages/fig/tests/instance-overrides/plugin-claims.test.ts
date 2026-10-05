import { expect, test } from 'bun:test'

import { guid } from '#fig-tests/helpers/guid'
import { interpretInstance } from '#fig/instance-overrides/interpret'

import { nodeChangeToProps } from '@open-pencil/fig/node-change'
import type { NodeChange } from '@open-pencil/kiwi/fig/codec'

function fixture(claim: Record<string, unknown>): NodeChange[] {
  return [
    { guid: guid(1), type: 'SYMBOL' },
    {
      guid: guid(2),
      type: 'FRAME',
      parentIndex: { guid: guid(1), position: '!' },
      pluginData: [
        {
          pluginID: 'open-pencil',
          key: 'boundVariables',
          value: JSON.stringify({
            'fills/0/color': '1:10',
            'strokes/0/color': '1:11',
            width: '1:12'
          })
        },
        { pluginID: 'open-pencil', key: 'exportSettings', value: '[{"format":"svg","scale":1}]' },
        { pluginID: 'other', key: 'boundVariables', value: 'preserve' }
      ]
    },
    {
      guid: guid(3),
      type: 'INSTANCE',
      symbolData: {
        symbolID: guid(1),
        symbolOverrides: [{ guidPath: { guids: [guid(2)] }, ...claim }]
      }
    }
  ] as NodeChange[]
}

test('explicit fill claims retire inherited plugin aliases only for fills', () => {
  const child = interpretInstance(
    fixture({ fillPaints: [{ type: 'SOLID', color: { r: 1, g: 0, b: 0, a: 1 } }] }),
    '1:3'
  ).children[0]
  expect(nodeChangeToProps(child.properties, []).boundVariables).toEqual({
    'strokes/0/color': '1:11',
    width: '1:12'
  })
  expect(child.properties.pluginData?.find((entry) => entry.pluginID === 'other')?.value).toBe(
    'preserve'
  )
})

test('no native claim keeps legacy plugin bindings and export settings', () => {
  const child = interpretInstance(fixture({ opacity: 0.5 }), '1:3').children[0]
  const props = nodeChangeToProps(child.properties, [])
  expect(props.boundVariables).toEqual({
    'fills/0/color': '1:10',
    'strokes/0/color': '1:11',
    width: '1:12'
  })
  expect(props.exportSettings).toEqual([{ format: 'svg', scale: 1 }])
})

test('an explicit empty export claim prevents inherited plugin settings from resurfacing', () => {
  const child = interpretInstance(fixture({ exportSettings: [] }), '1:3').children[0]
  expect(nodeChangeToProps(child.properties, []).exportSettings).toEqual([])
})

test('plugin data explicitly authored in a claim retains its own paint binding', () => {
  const changes = fixture({
    fillPaints: [],
    pluginData: [
      { pluginID: 'open-pencil', key: 'boundVariables', value: '{"fills/0/color":"1:20"}' }
    ]
  })
  const child = interpretInstance(changes, '1:3').children[0]
  expect(nodeChangeToProps(child.properties, []).boundVariables).toEqual({
    'fills/0/color': '1:20'
  })
})

test('partial plugin claims preserve unrelated keys and distinguish plugin namespaces', () => {
  const changes = fixture({
    pluginData: [{ pluginID: 'other', key: 'boundVariables', value: '' }]
  })
  const before = structuredClone(changes)
  const child = interpretInstance(changes, '1:3').children[0]
  expect(child.properties.pluginData).toEqual([
    ...(changes[1].pluginData ?? []).slice(0, 2),
    { pluginID: 'other', key: 'boundVariables', value: '' }
  ])
  expect(nodeChangeToProps(child.properties, []).boundVariables).toEqual({
    'fills/0/color': '1:10',
    'strokes/0/color': '1:11',
    width: '1:12'
  })
  const entry = child.properties.pluginData?.[0]
  if (!entry) throw new Error('Missing inherited plugin entry')
  entry.value = 'changed occurrence only'
  expect(changes).toEqual(before)
  expect(interpretInstance(changes, '1:3').children[0].properties.pluginData).toEqual([
    ...(changes[1].pluginData ?? []).slice(0, 2),
    { pluginID: 'other', key: 'boundVariables', value: '' }
  ])
})

test('unrelated plugin claims do not retain paint aliases retired by an explicit fill', () => {
  const changes = fixture({
    fillPaints: [],
    pluginData: [{ pluginID: 'other', key: 'note', value: 'keep' }]
  })
  const child = interpretInstance(changes, '1:3').children[0]
  expect(nodeChangeToProps(child.properties, []).boundVariables).toEqual({
    'strokes/0/color': '1:11',
    width: '1:12'
  })
  expect(child.properties.pluginData?.find((entry) => entry.key === 'note')?.value).toBe('keep')
})

test('unrelated plugin claims do not resurrect explicitly cleared export settings', () => {
  const changes = fixture({
    exportSettings: [],
    pluginData: [{ pluginID: 'other', key: 'note', value: 'keep' }]
  })
  const child = interpretInstance(changes, '1:3').children[0]
  expect(nodeChangeToProps(child.properties, []).exportSettings).toEqual([])
  expect(child.properties.pluginData?.find((entry) => entry.key === 'note')?.value).toBe('keep')
})

test('outer partial plugin claims override the same key without erasing nested metadata', () => {
  const changes = fixture({
    pluginData: [{ pluginID: 'other', key: 'note', value: 'inner' }]
  })
  changes[2].parentIndex = { guid: guid(4), position: '!' }
  changes.push(
    { guid: guid(4), type: 'SYMBOL' },
    {
      guid: guid(5),
      type: 'INSTANCE',
      symbolData: {
        symbolID: guid(4),
        symbolOverrides: [
          {
            guidPath: { guids: [guid(3), guid(2)] },
            pluginData: [{ pluginID: 'other', key: 'note', value: 'outer' }]
          }
        ]
      }
    }
  )
  const child = interpretInstance(changes, '1:5').children[0].children[0]
  expect(child.properties.pluginData).toEqual([
    ...(changes[1].pluginData ?? []),
    { pluginID: 'other', key: 'note', value: 'outer' }
  ])
})

test('a later text cache without a box clears a retained derived size', () => {
  const changes: NodeChange[] = [
    { guid: guid(1), type: 'SYMBOL' },
    {
      guid: guid(2),
      type: 'TEXT',
      parentIndex: { guid: guid(1), position: '!' },
      size: { x: 50, y: 20 },
      textData: { characters: 'text' }
    },
    {
      guid: guid(3),
      type: 'INSTANCE',
      symbolData: { symbolID: guid(1) },
      derivedSymbolData: [
        { guidPath: { guids: [guid(2)] }, size: { x: 60, y: 25 } },
        { guidPath: { guids: [guid(2)] }, derivedTextData: { baselines: [] } }
      ]
    }
  ]
  const child = interpretInstance(changes, '1:3', { derivedBounds: true }).children[0]
  expect(child.derivedSize).toBeUndefined()
  expect(nodeChangeToProps(child.properties, []).derivedLayout).toBeNull()
  expect(child.properties.size).toEqual({ x: 60, y: 25 })
})
