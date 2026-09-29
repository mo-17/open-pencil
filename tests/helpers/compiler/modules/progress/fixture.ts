import { compile, withDefaults, type CompilerTarget } from '@open-pencil/compiler'
import { SceneGraph } from '@open-pencil/scene-graph'

import {
  createProgressModuleFrameOverrides,
  createProgressModuleInstance
} from '#core/plugins/progress'

export function progressFixture(target: CompilerTarget, updates = false) {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const samples = [
    { config: { label: '文件进度', value: 37.5 }, y: 24, width: 280, height: 96 },
    {
      config: { label: '圆形进度', variant: 'circular', value: 75 },
      y: 136,
      width: 280,
      height: 200
    },
    {
      config: { label: '正在处理', pendingLabel: '进度未提供', value: 99, indeterminate: true },
      y: 352,
      width: 280,
      height: 96
    },
    {
      config: {
        label: '<b>等待结果</b>',
        pendingLabel: '等待结果',
        indeterminate: true,
        variant: 'circular',
        showLabel: false,
        showValue: false,
        fontSize: 32,
        diameter: 240
      },
      y: 464,
      width: 120,
      height: 200
    },
    {
      config: { label: '大直径', variant: 'circular', diameter: 240, value: 100 },
      y: 680,
      width: 320,
      height: 200
    },
    {
      config: { label: '矮容器', variant: 'circular', diameter: 240, value: 75, fontSize: 32 },
      y: 896,
      width: 180,
      height: 110
    },
    {
      config: {
        label: '零剩余高度',
        variant: 'circular',
        diameter: 240,
        showLabel: false,
        showValue: false
      },
      y: 1022,
      width: 180,
      height: 24
    }
  ]
  for (const sample of samples)
    graph.createNode('FRAME', pageId, {
      ...createProgressModuleFrameOverrides(sample.config),
      x: 24,
      y: sample.y,
      width: sample.width,
      height: sample.height
    })
  const result = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ target, router: 'none', devMode: false })
  })
  if (updates && (target === 'react' || target === 'vue')) addUpdates(result.files, target)
  return result
}

function addUpdates(files: Map<string, string | Uint8Array>, target: 'react' | 'vue'): void {
  const base = JSON.stringify(
    createProgressModuleInstance({
      label: 'Configured progress',
      value: 0,
      pendingLabel: 'Value unavailable'
    }).config
  )
  if (target === 'react')
    files.set(
      'src/App.tsx',
      `import {useState} from 'react'
import Progress,{type OpenPencilProgressConfig} from './__openpencil_progress'
const initial: OpenPencilProgressConfig = ${base}
export default function App(){const [config,setConfig]=useState(initial)
return <main><button onClick={()=>setConfig({...config,value:75,indeterminate:false})}>Set 75</button>
<button onClick={()=>setConfig({...config,indeterminate:true})}>Unknown</button>
<button onClick={()=>setConfig({...config,value:0,indeterminate:false})}>Reset 0</button>
<Progress config={config} style={{width:280,height:120}}/></main>}`
    )
  else
    files.set(
      'src/App.vue',
      `<script setup lang="ts">
import {ref} from 'vue'
import Progress,{type OpenPencilProgressConfig} from './__openpencil_progress.vue'
const config=ref<OpenPencilProgressConfig>(${base})
</script><template><main><button @click="config={...config,value:75,indeterminate:false}">Set 75</button>
<button @click="config={...config,indeterminate:true}">Unknown</button>
<button @click="config={...config,value:0,indeterminate:false}">Reset 0</button>
<Progress :config="config" style="width:280px;height:120px"/></main></template>`
    )
}
