import { compile, withDefaults } from '@open-pencil/compiler'
import { createTreeModuleFrameOverrides, createTreeModuleInstance } from '@open-pencil/core/plugins'
import { SceneGraph, type BindingExpr, type SceneNode } from '@open-pencil/scene-graph'

export type TreeBindingVariant = 'base' | 'invalid' | 'flags' | 'multi-select' | 'state-flags'

export function treeBindingGraph(variant: TreeBindingVariant = 'base') {
  const graph = new SceneGraph(),
    page = graph.getPages()[0]
  graph.updateNode(page.id, {
    state: [
      {
        id: 'manyPage',
        name: 'manyPage',
        type: 'array',
        defaultValue: variant === 'invalid' ? ['missing'] : ['design']
      },
      { id: 'onePage', name: 'onePage', type: 'string', defaultValue: 'design' },
      { id: 'submittedA', name: 'submittedA', type: 'number', defaultValue: 0 },
      { id: 'submittedB', name: 'submittedB', type: 'number', defaultValue: 0 }
    ]
  })
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [
      {
        id: 'oneDoc',
        name: 'oneDoc',
        type: 'string',
        defaultValue: variant === 'invalid' ? 'missing' : 'project'
      },
      { id: 'manyDoc', name: 'manyDoc', type: 'array', defaultValue: ['project'] }
    ]
  })
  function form(name: string, submitted: 'submittedA' | 'submittedB', x: number) {
    return graph.createNode('FORM', page.id, {
      name,
      x,
      y: 20,
      width: 360,
      height: 920,
      layoutMode: 'VERTICAL',
      itemSpacing: 12,
      events: {
        onSubmit: [
          {
            id: name + '-submit',
            kind: 'setState',
            targetStateId: submitted,
            valueExpr: submitted + ' + 1'
          }
        ]
      }
    })
  }
  const first = form('First tree form', 'submittedA', 20),
    second = form('Second tree form', 'submittedB', 420)
  function tree(
    owner: SceneNode,
    label: string,
    selectionMode: 'single' | 'multiple',
    presentation: 'tree' | 'select',
    binding: BindingExpr,
    interactiveProps: Record<string, unknown> = {}
  ) {
    const frame = createTreeModuleFrameOverrides({
      label,
      selectionMode,
      presentation,
      initialSelectedIds: ['development']
    })
    return graph.createNode('FRAME', owner.id, {
      ...frame,
      name: label,
      bindings: { value: binding },
      interactiveProps: { ...frame.interactiveProps, lang: 'en', ...interactiveProps }
    })
  }
  const manyPage = tree(
      first,
      'Page tree',
      'multiple',
      'tree',
      { kind: 'ref', stateId: 'manyPage' },
      { validation: { required: true }, moduleFieldNames: { value: 'categories' } }
    ),
    oneDoc = tree(
      first,
      'Document tree select',
      'single',
      'select',
      { kind: 'docState', docStateName: 'oneDoc' },
      { validation: { required: true } }
    ),
    onePage = tree(
      second,
      'Page tree select',
      'single',
      'select',
      {
        kind: 'ref',
        stateId: 'onePage'
      },
      variant === 'flags' ? { readOnly: true } : {}
    ),
    manyDoc = tree(
      second,
      'Document tree',
      'multiple',
      variant === 'multi-select' ? 'select' : 'tree',
      {
        kind: 'docState',
        docStateName: 'manyDoc'
      },
      variant === 'flags' ? { disabled: true } : {}
    )
  for (const [owner, label] of [
    [first, 'Submit first'],
    [second, 'Submit second']
  ] as const)
    graph.createNode('BUTTON', owner.id, {
      width: 300,
      height: 44,
      interactiveProps: { text: label }
    })
  for (const [owner, label, expression] of [
    [first, 'First status', '"First:" + oneDoc + "/" + submittedA'],
    [second, 'Second status', '"Second:" + onePage + "/" + submittedB']
  ] as const)
    graph.createNode('TEXT', owner.id, {
      name: label,
      text: label,
      width: 300,
      height: 30,
      bindings: { text: { kind: 'expr', expr: expression } }
    })
  graph.createNode('BUTTON', page.id, {
    x: 820,
    y: 20,
    width: 300,
    height: 44,
    interactiveProps: { text: 'External page value' },
    events: {
      onClick: [
        {
          id: 'external-page',
          kind: 'setState',
          targetStateId: 'onePage',
          valueExpr: "'development'"
        }
      ]
    }
  })
  return { graph, page, first, second, manyPage, oneDoc, onePage, manyDoc }
}

export function treeBindingFixture(target: 'react' | 'vue', variant: TreeBindingVariant = 'base') {
  const { graph, page } = treeBindingGraph(variant)
  const result = compile({
    graph,
    pageIds: [page.id],
    options: withDefaults({ target, router: 'none', devMode: false })
  })
  if (variant === 'state-flags') {
    const config = JSON.stringify(
      createTreeModuleInstance({ label: 'Flag tree', initialSelectedIds: ['design'] }).config
    )
    result.files.set(
      target === 'react' ? 'src/App.tsx' : 'src/App.vue',
      target === 'react'
        ? `import {useState} from 'react'
import Tree,{type OpenPencilTreeConfig} from './__openpencil_tree'
const initial:OpenPencilTreeConfig=${config}
export default function App(){const [config,setConfig]=useState(initial),[disabled,setDisabled]=useState(false),[readOnly,setReadOnly]=useState(false),[value,setValue]=useState('design')
return <main style={{padding:12}}><button onMouseDown={event=>event.preventDefault()} onClick={()=>setDisabled(!disabled)}>Outer disabled</button><button onClick={()=>setReadOnly(!readOnly)}>Outer readonly</button><button onClick={()=>setConfig({...config,presentation:config.presentation==='tree'?'select':'tree'})}>Presentation</button><form aria-label="Flag form"><Tree config={config} disabled={disabled} readOnly={readOnly} valueBound value={value} onValueChange={next=>{if(typeof next==='string')setValue(next)}} field={{name:'category'}} lang="en" style={{width:320,height:440}}/><output aria-label="Business selection">{value}</output></form></main>}`
        : `<script setup lang="ts">
import {ref} from 'vue'
import Tree,{type OpenPencilTreeConfig} from './__openpencil_tree.vue'
const config=ref<OpenPencilTreeConfig>(${config}),disabled=ref(false),readOnly=ref(false),value=ref('design')
function change(next:string|string[]){if(typeof next==='string')value.value=next}
</script><template><main style="padding:12px"><button @mousedown.prevent @click="disabled=!disabled">Outer disabled</button><button @click="readOnly=!readOnly">Outer readonly</button><button @click="config={...config,presentation:config.presentation==='tree'?'select':'tree'}">Presentation</button><form aria-label="Flag form"><Tree :config="config" :disabled="disabled" :read-only="readOnly" value-bound :value="value" :on-value-change="change" :field="{name:'category'}" lang="en" style="width:320px;height:440px"/><output aria-label="Business selection">{{value}}</output></form></main></template>`
    )
  }
  return result
}
