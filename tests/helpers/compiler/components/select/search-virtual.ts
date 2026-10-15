import { compile, withDefaults } from '@open-pencil/compiler'
import { SceneGraph } from '@open-pencil/scene-graph'
import type { JSONObject } from '@open-pencil/scene-graph/primitives'

function cityLabel(index: number): string {
  if (index === 42) return '北京 Beijing'
  if (index === 314) return '厦门 Xiamen'
  return `City ${String(index).padStart(5, '0')}`
}

export function selectSearchVirtualGraph() {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const cityOptions = Array.from({ length: 10_000 }, (_, index) => ({
    id: `city-${index}`,
    label: cityLabel(index)
  }))
  graph.updateNode(pageId, {
    state: [
      { id: 'selectedCity', name: 'selectedCity', type: 'string', defaultValue: 'city-8765' },
      { id: 'changes', name: 'changes', type: 'number', defaultValue: 0 },
      { id: 'lastValue', name: 'lastValue', type: 'string', defaultValue: '' },
      { id: 'cityOptions', name: 'cityOptions', type: 'array', defaultValue: cityOptions },
      {
        id: 'replacementOptions',
        name: 'replacementOptions',
        type: 'array',
        defaultValue: [
          { id: 'city-314', label: '厦门 New Xiamen' },
          { id: 'city-9999', label: 'Replacement destination' }
        ]
      },
      { id: 'category', name: 'category', type: 'string', defaultValue: '' },
      { id: 'clearable', name: 'clearable', type: 'string', defaultValue: '' }
    ]
  })
  const form = graph.createNode('FORM', pageId, {
    name: 'Select runtime form',
    width: 480,
    height: 1000,
    layoutMode: 'VERTICAL',
    primaryAxisSizing: 'FIXED',
    counterAxisSizing: 'FIXED',
    paddingTop: 20,
    paddingLeft: 20,
    paddingRight: 20,
    itemSpacing: 12,
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, visible: true, opacity: 1 }]
  })
  const addSelect = (name: string, props: JSONObject) =>
    graph.createNode('SELECT', form.id, {
      name,
      width: 400,
      height: 40,
      interactiveProps: { ariaLabel: name, ...props }
    })
  const cities = addSelect('Searchable cities', {
    showSearch: true,
    virtual: true,
    optionsSource: {
      kind: 'ref',
      stateId: 'cityOptions',
      itemName: 'cityOption',
      valueExpr: 'cityOption.id',
      labelExpr: 'cityOption.label'
    }
  })
  graph.updateNode(cities.id, {
    bindings: {
      value: { kind: 'ref', stateId: 'selectedCity' }
    },
    events: {
      onChange: [
        {
          id: 'fixture-action-1',
          kind: 'setState',
          targetStateId: 'changes',
          valueExpr: '$prev + 1'
        },
        {
          id: 'fixture-action-2',
          kind: 'setState',
          targetStateId: 'lastValue',
          valueExpr: '$value'
        }
      ]
    }
  })
  const category = addSelect('Search without virtualization', {
    showSearch: true,
    virtual: false,
    placeholder: 'Must not replace the business empty label',
    allowClear: true,
    options: [
      { value: '', label: 'All categories' },
      { value: 'a', label: 'Alpha category' },
      { value: 'b', label: 'Beta category' },
      { value: 'blocked', label: 'Unavailable category', disabled: true }
    ]
  })
  graph.updateNode(category.id, { bindings: { value: { kind: 'ref', stateId: 'category' } } })
  const clearable = addSelect('Clearable required choice', {
    showSearch: true,
    virtual: true,
    allowClear: true,
    placeholder: 'Choose or clear',
    options: [
      { value: 'ready', label: 'Ready' },
      { value: 'blocked', label: 'Blocked', disabled: true }
    ],
    validation: { required: true, messages: { required: 'Choose a status' } }
  })
  graph.updateNode(clearable.id, {
    bindings: { value: { kind: 'ref', stateId: 'clearable' } }
  })
  addSelect('Virtual keyboard choices', {
    virtual: true,
    options: Array.from({ length: 100 }, (_, index) => ({
      value: `key-${index}`,
      label: `Keyboard ${String(index).padStart(3, '0')}`,
      disabled: index === 99
    }))
  })
  addSelect('Disabled search choice', {
    showSearch: true,
    virtual: true,
    disabled: true,
    value: 'saved',
    options: [{ value: 'saved', label: 'Saved disabled choice' }]
  })
  for (const [name, targetStateId, valueExpr] of [
    ['Choose Xiamen externally', 'selectedCity', '"city-314"'],
    ['Replace city options', 'cityOptions', 'replacementOptions']
  ]) {
    graph.createNode('BUTTON', form.id, {
      name,
      width: 400,
      height: 36,
      interactiveProps: { text: name },
      events: { onClick: [{ id: 'fixture-action-3', kind: 'setState', targetStateId, valueExpr }] }
    })
  }
  graph.createNode('BUTTON', form.id, {
    name: 'Focus outside selectors',
    width: 400,
    height: 36,
    interactiveProps: { text: 'Focus outside selectors' }
  })
  graph.createNode('TEXT', form.id, {
    name: 'City state feedback',
    width: 440,
    height: 32,
    text: 'City state feedback',
    bindings: {
      text: {
        kind: 'expr',
        expr: '"Selected[" + selectedCity + "] Changes[" + changes + "] Last[" + lastValue + "]"'
      }
    }
  })
  graph.createNode('TEXT', form.id, {
    name: 'Choice state feedback',
    width: 440,
    height: 32,
    text: 'Choice state feedback',
    bindings: {
      text: { kind: 'expr', expr: '"Category[" + category + "] Clearable[" + clearable + "]"' }
    }
  })
  return { graph, pageId, cities, category, clearable }
}

export function selectSearchVirtualFixture(target: 'react' | 'vue', shadcn = false) {
  const { graph, pageId } = selectSearchVirtualGraph()
  const output = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({
      target,
      ...(shadcn ? { uiKit: 'shadcn' } : {}),
      devMode: false,
      router: 'none'
    })
  })
  const unexpected = output.warnings.filter(({ code }) => code !== 'ui-kit-native-control-fallback')
  if (unexpected.length) throw new Error(JSON.stringify(unexpected))
  return { files: [...output.files], warnings: output.warnings }
}

/** Standard generated-component prop coverage, not editor disabled-binding support. */
export function selectRuntimePropsFixture(target: 'react' | 'vue') {
  const fixture = selectSearchVirtualFixture(target)
  const files = new Map(fixture.files)
  const options = JSON.stringify([
    { value: 'saved', label: 'Saved destination' },
    { value: 'other', label: 'Other destination' }
  ])
  if (target === 'react') {
    files.set(
      'src/App.tsx',
      `import { useState } from 'react'
import { OpenPencilSelect } from './components/_open-pencil-select'
const options = ${options}
export default function App() {
  const [locked, setLocked] = useState(false)
  const [selected, setSelected] = useState('saved')
  const [changes, setChanges] = useState(0)
  const [focuses, setFocuses] = useState(0)
  const [blurs, setBlurs] = useState(0)
  return <main style={{ padding: 24 }}>
    <form>
      <OpenPencilSelect options={options} showSearch virtual value={selected} disabled={locked}
        name="destination" aria-label="Runtime destination" style={{ width: 300, height: 40 }}
        onFocus={() => setFocuses(count => count + 1)} onBlur={() => setBlurs(count => count + 1)}
        onChange={event => { setSelected(event.currentTarget.value); setChanges(count => count + 1) }} />
    </form>
    <button type="button" onClick={() => setLocked(true)}>Disable runtime control</button>
    <button type="button" onClick={() => setLocked(false)}>Enable runtime control</button>
    <output>Runtime[{selected}] Changes[{changes}]</output>
    <output>Focus[{focuses}] Blur[{blurs}]</output>
  </main>
}
`
    )
  } else {
    files.set(
      'src/pages/index.vue',
      `<script setup lang="ts">
import { ref } from 'vue'
import OpenPencilSelect from '../components/open-pencil/OpenPencilSelect.vue'
const options = ${options}
const locked = ref(false)
const selected = ref('saved')
const changes = ref(0)
const focuses = ref(0)
const blurs = ref(0)
function change(event: Event) {
  selected.value = (event.target as HTMLSelectElement).value
  changes.value += 1
}
</script>
<template>
  <main style="padding:24px">
    <form>
      <OpenPencilSelect :options="options" :show-search="true" :virtual="true" :value="selected"
        :disabled="locked" name="destination" aria-label="Runtime destination"
        style="width:300px;height:40px" @change="change" @focus="focuses += 1" @blur="blurs += 1" />
    </form>
    <button type="button" @click="locked = true">Disable runtime control</button>
    <button type="button" @click="locked = false">Enable runtime control</button>
    <output>Runtime[{{ selected }}] Changes[{{ changes }}]</output>
    <output>Focus[{{ focuses }}] Blur[{{ blurs }}]</output>
  </main>
</template>
`
    )
  }
  return { files: [...files], warnings: fixture.warnings }
}
