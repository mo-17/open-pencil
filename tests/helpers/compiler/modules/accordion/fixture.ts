import { compile, withDefaults } from '@open-pencil/compiler'
import {
  createAccordionModuleFrameOverrides,
  createAccordionModuleInstance
} from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

export function accordionFixture(target: 'react' | 'vue', lifecycle = false) {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const config = {
    label: '常见问题',
    items: [
      { id: 'first', title: '如何开始？', content: '第一行说明。\n第二行保留换行。' },
      {
        id: 'second',
        title: '可以独立编辑吗？',
        content: '<img src=x onerror=alert(1)> 作为纯文本显示。'
      },
      {
        id: 'third',
        title: '较长的标题与连续文字应该换行显示',
        content: 'long-unbroken-content-'.repeat(20)
      }
    ],
    initialOpenIds: ['first']
  }
  for (const [index, allowMultiple] of [false, true].entries()) {
    graph.createNode('FRAME', pageId, {
      ...createAccordionModuleFrameOverrides({ ...config, allowMultiple }),
      x: 24 + index * 400,
      y: 24,
      width: 360,
      height: 460
    })
  }
  const result = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ target, router: 'none', devMode: false })
  })
  if (lifecycle) addLifecycleFixture(result.files, target, config)
  return result
}

function addLifecycleFixture(
  files: Map<string, string | Uint8Array>,
  target: 'react' | 'vue',
  config: unknown
): void {
  const base = JSON.stringify(createAccordionModuleInstance(config).config).replaceAll(
    '<',
    '\\u003c'
  )
  if (target === 'react') {
    files.set(
      'src/App.tsx',
      `import {useState} from 'react'
import Accordion, {type OpenPencilAccordionConfig} from './__openpencil_accordion'
const base: OpenPencilAccordionConfig = ${base}
export default function App(){
  const [revision,setRevision]=useState(0),[mounted,setMounted]=useState(true),[multiple,setMultiple]=useState(false),[replacement,setReplacement]=useState(false)
  const config={...base,allowMultiple:multiple,items:replacement?base.items.slice(1):base.items.map(item=>({...item})),initialOpenIds:replacement?['second']:base.initialOpenIds.slice()}
  return <main><button type="button" onClick={()=>setRevision(revision+1)}>Rerender {revision}</button>
    <button type="button" onClick={()=>setMultiple(!multiple)}>Toggle multiple</button>
    <button type="button" onClick={()=>setReplacement(!replacement)}>Replace items</button>
    <button type="button" onClick={()=>setMounted(!mounted)}>Toggle mount</button>
    {mounted&&<Accordion config={config} style={{width:320,height:440,margin:24}}/>}
  </main>
}`
    )
  } else {
    files.set(
      'src/App.vue',
      `<script setup lang="ts">
import {computed,ref} from 'vue'
import Accordion, {type OpenPencilAccordionConfig} from './__openpencil_accordion.vue'
const base: OpenPencilAccordionConfig = ${base}
const revision=ref(0),mounted=ref(true),multiple=ref(false),replacement=ref(false)
const config=computed(()=>({...base,allowMultiple:multiple.value,items:replacement.value?base.items.slice(1):base.items.map(item=>({...item})),initialOpenIds:replacement.value?['second']:base.initialOpenIds.slice(),revision:revision.value}))
</script><template><main><button type="button" @click="revision++">Rerender {{revision}}</button>
<button type="button" @click="multiple=!multiple">Toggle multiple</button>
<button type="button" @click="replacement=!replacement">Replace items</button>
<button type="button" @click="mounted=!mounted">Toggle mount</button>
<Accordion v-if="mounted" :config="config" style="width:320px;height:440px;margin:24px"/>
</main></template>`
    )
  }
}
