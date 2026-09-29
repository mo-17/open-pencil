import { compile, withDefaults } from '@open-pencil/compiler'
import { createChipModuleFrameOverrides, createChipModuleInstance } from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

export function chipFixture(target: 'react' | 'vue', lifecycle = false) {
  const graph = new SceneGraph(),
    page = graph.getPages()[0]
  const configs = [
    { label: '静态状态' },
    {
      label: '可选择标签',
      selectable: true,
      deletable: true,
      deleteLabel: '移除',
      removedLabel: '已移除'
    },
    { label: '另一标签', selectable: true, deletable: true },
    { label: '禁用标签', selectable: true, deletable: true, disabled: true, initialSelected: true },
    {
      label: '很长的中文和English标签文字'.repeat(3),
      selectable: true,
      deletable: true,
      variant: 'outlined'
    },
    { label: '<b>纯文本</b>', variant: 'filled' }
  ]
  configs.forEach((config, index) =>
    graph.createNode('FRAME', page.id, {
      ...createChipModuleFrameOverrides(config),
      x: 20,
      y: 20 + index * 70,
      width: index === 4 ? 120 : 230,
      height: 44
    })
  )
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
    createChipModuleInstance({ label: 'Lifecycle', selectable: true, deletable: true }).config
  )
  if (target === 'react')
    files.set(
      'src/App.tsx',
      `import {useState} from 'react'
import Chip,{type OpenPencilChipConfig} from './__openpencil_chip'
const base:OpenPencilChipConfig=${base}
export default function App(){
 const [config,setConfig]=useState(base),[mounted,setMounted]=useState(true),[submits,setSubmits]=useState(0)
 return <form onSubmit={event=>{event.preventDefault();setSubmits(submits+1)}}>
 <button type="button" onClick={()=>setConfig({...config})}>Equal config</button>
 <button type="button" onClick={()=>setConfig({...base,label:'Replacement'})}>Replace config</button>
 <button type="button" onClick={()=>setMounted(!mounted)}>Toggle mount</button>
 {mounted&&<Chip config={config} style={{width:180,height:44}}/>}
 <button type="button">Next control</button><output>{submits}</output></form>
}`
    )
  else
    files.set(
      'src/App.vue',
      `<script setup lang="ts">
import {ref} from 'vue'
import Chip,{type OpenPencilChipConfig} from './__openpencil_chip.vue'
const base:OpenPencilChipConfig=${base}
const config=ref(base),mounted=ref(true),submits=ref(0)
</script><template><form @submit.prevent="submits++">
<button type="button" @click="config={...config}">Equal config</button>
<button type="button" @click="config={...base,label:'Replacement'}">Replace config</button>
<button type="button" @click="mounted=!mounted">Toggle mount</button>
<Chip v-if="mounted" :config="config" style="width:180px;height:44px"/>
<button type="button">Next control</button><output>{{submits}}</output>
</form></template>`
    )
}
