import { compile, withDefaults } from '@open-pencil/compiler'
import {
  createDescriptionsModuleFrameOverrides,
  createDescriptionsModuleInstance
} from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

export function descriptionsFixture(target: 'react' | 'vue', replacement = false) {
  const graph = new SceneGraph(),
    page = graph.getPages()[0]
  graph.createNode('FRAME', page.id, {
    ...createDescriptionsModuleFrameOverrides({
      label: '项目详情',
      items: [
        { id: 'name', label: '名称', value: '示例项目' },
        { id: 'notes', label: '说明', value: '中文 English 详情\n继续阅读' }
      ]
    }),
    x: 20,
    y: 20,
    width: 480,
    height: 240
  })
  const result = compile({
    graph,
    pageIds: [page.id],
    options: withDefaults({ target, router: 'none', devMode: false })
  })
  if (replacement) replaceApplication(result.files, target)
  return result
}
function replaceApplication(files: Map<string, string | Uint8Array>, target: 'react' | 'vue') {
  const base = JSON.stringify(createDescriptionsModuleInstance({ label: '项目详情' }).config)
  const update = JSON.stringify({
    columns: 3,
    layout: 'vertical',
    density: 'compact',
    bordered: false,
    items: [
      { id: 'a', label: '<b>标签</b>', value: 'LongUnbrokenValue'.repeat(40) },
      { id: 'b', label: '新项目', value: '中文\nEnglish' }
    ]
  })
  const emptyItems = JSON.stringify([
    { id: 'a', label: '项目', value: '' },
    { id: 'b', label: '后续', value: '第二项' }
  ])
  if (target === 'react')
    files.set(
      'src/App.tsx',
      `import {useState} from 'react'
import Descriptions,{type OpenPencilDescriptionsConfig} from './__openpencil_descriptions'
const base:OpenPencilDescriptionsConfig=${base}
export default function App(){const [config,setConfig]=useState(base);return <><button type="button" onClick={()=>setConfig({...base,${update.slice(1, -1)}})}>Replace content</button><button type="button" onClick={()=>setConfig(base)}>Restore</button><button type="button" onClick={()=>setConfig({...base,layout:'vertical',columns:1,items:${emptyItems}})}>Empty value</button><button type="button" onClick={()=>setConfig(previous=>({...previous,items:previous.items.map((item,index)=>index===0?{...item,value:'One line'}:item)}))}>Fill value</button><Descriptions config={config} style={{width:'min(680px,calc(100vw - 40px))',height:240,margin:20}}/><Descriptions config={base} style={{width:320,height:240,margin:20}}/></>}`
    )
  else
    files.set(
      'src/App.vue',
      `<script setup lang="ts">
import {ref} from 'vue'
import Descriptions,{type OpenPencilDescriptionsConfig} from './__openpencil_descriptions.vue'
const base:OpenPencilDescriptionsConfig=${base};const config=ref(base)
function replace(){config.value={...base,${update.slice(1, -1)}}}
</script><template><button type="button" @click="replace">Replace content</button><button type="button" @click="config=base">Restore</button><button type="button" @click="config={...base,layout:'vertical',columns:1,items:${emptyItems.replaceAll('"', '&quot;')}}">Empty value</button><button type="button" @click="config={...config,items:config.items.map((item,index)=>index===0?{...item,value:'One line'}:item)}">Fill value</button><Descriptions :config="config" style="width:min(680px,calc(100vw - 40px));height:240px;margin:20px"/><Descriptions :config="base" style="width:320px;height:240px;margin:20px"/></template>`
    )
}
