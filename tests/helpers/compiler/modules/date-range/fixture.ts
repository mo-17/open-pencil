import { compile, withDefaults } from '@open-pencil/compiler'
import {
  createDateRangeModuleFrameOverrides,
  createDateRangeModuleInstance
} from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

export function dateRangeFixture(target: 'react' | 'vue', lifecycle = false) {
  const graph = new SceneGraph(),
    page = graph.getPages()[0]
  const nodes = [
    {
      label: '出行日期',
      initialStart: '2026-09-01',
      initialEnd: '2026-09-05',
      min: '2026-01-01',
      max: '2026-12-31'
    },
    { label: '禁用范围', disabled: true, initialStart: '2026-09-01' },
    {
      label: '很长的日期范围标题和 English title',
      startLabel: '很长的开始日期说明',
      endLabel: '很长的结束日期说明'
    },
    { label: '<b>Plain range</b>', allowClear: false }
  ]
  nodes.forEach((config, index) => {
    const frame = createDateRangeModuleFrameOverrides(config)
    graph.createNode('FRAME', page.id, {
      ...frame,
      x: 16,
      y: 16 + index * 290,
      width: index === 2 ? 220 : 340,
      height: index === 2 ? 280 : 188,
      interactiveProps: { ...frame.interactiveProps, lang: index < 3 ? 'zh-CN' : 'en' }
    })
  })
  const result = compile({
    graph,
    pageIds: [page.id],
    options: withDefaults({ target, router: 'none', devMode: false })
  })
  if (lifecycle) addLifecycle(result.files, target)
  return result
}
function addLifecycle(files: Map<string, string | Uint8Array>, target: 'react' | 'vue') {
  const base = JSON.stringify(
    createDateRangeModuleInstance({ label: 'Local range', min: '2026-01-01', max: '2026-12-31' })
      .config
  )
  if (target === 'react')
    files.set(
      'src/App.tsx',
      `import {useState} from 'react'
import DateRange,{type OpenPencilDateRangeConfig} from './__openpencil_date_range'
const base:OpenPencilDateRangeConfig=${base}
export default function App(){const [config,setConfig]=useState(base),[mounted,setMounted]=useState(true),[submits,setSubmits]=useState(0)
return <form onSubmit={event=>{event.preventDefault();setSubmits(submits+1)}}>
<button type="button" onClick={()=>setConfig({...config})}>Equal config</button><button type="button" onClick={()=>setConfig({...base,initialStart:'2026-10-01',initialEnd:'2026-10-02'})}>Replace config</button><button type="button" onClick={()=>setMounted(!mounted)}>Toggle mount</button>
{mounted&&<DateRange config={config} lang="en" style={{width:340,height:188}}/>}<DateRange config={base} lang="zh-CN" style={{width:340,height:188}}/>
<button type="submit">Submit outer form</button><output>{submits}</output></form>}`
    )
  else
    files.set(
      'src/App.vue',
      `<script setup lang="ts">
import {ref} from 'vue'
import DateRange,{type OpenPencilDateRangeConfig} from './__openpencil_date_range.vue'
const base:OpenPencilDateRangeConfig=${base},config=ref(base),mounted=ref(true),submits=ref(0)
</script><template><form @submit.prevent="submits++">
<button type="button" @click="config={...config}">Equal config</button><button type="button" @click="config={...base,initialStart:'2026-10-01',initialEnd:'2026-10-02'}">Replace config</button><button type="button" @click="mounted=!mounted">Toggle mount</button>
<DateRange v-if="mounted" :config="config" lang="en" style="width:340px;height:188px"/><DateRange :config="base" lang="zh-CN" style="width:340px;height:188px"/>
<button type="submit">Submit outer form</button><output>{{submits}}</output></form></template>`
    )
}
