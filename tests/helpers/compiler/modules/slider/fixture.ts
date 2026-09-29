import { compile, withDefaults } from '@open-pencil/compiler'
import { SceneGraph } from '@open-pencil/scene-graph'

import { createSliderModuleFrameOverrides, createSliderModuleInstance } from '#core/plugins/slider'

export function sliderFixture(target: 'react' | 'vue', lifecycle = false) {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  for (const [index, config] of [
    { label: '音量', initialValue: 30 },
    {
      label: '价格范围',
      range: true,
      min: -0.3,
      max: 0.65,
      step: 0.1,
      initialValue: 0.1,
      initialEndValue: 0.6
    },
    { label: '只读', readOnly: true, initialValue: 40 },
    { label: '已禁用', disabled: true, range: true, initialValue: 25, initialEndValue: 75 }
  ].entries()) {
    graph.createNode('FRAME', pageId, {
      ...createSliderModuleFrameOverrides(config),
      x: 24,
      y: 24 + index * 132,
      width: 280
    })
  }
  const result = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ target, router: 'none', devMode: false })
  })
  if (lifecycle) addLifecycleFixture(result.files, target)
  return result
}

function addLifecycleFixture(
  files: Map<string, string | Uint8Array>,
  target: 'react' | 'vue'
): void {
  const base = JSON.stringify(
    createSliderModuleInstance({ label: 'Lifecycle range', range: true }).config
  )
  if (target === 'react') {
    files.set(
      'src/App.tsx',
      `import {useState} from 'react'
import Slider, {type OpenPencilSliderConfig} from './__openpencil_slider'
const base: OpenPencilSliderConfig = ${base}
export default function App(){
  const [revision,setRevision]=useState(0),[mounted,setMounted]=useState(true),[replacement,setReplacement]=useState(false)
  const config=replacement?{...base,min:-1,max:1,step:.1,initialValue:-.2,initialEndValue:.6}:{...base}
  return <main><button type="button" onClick={()=>setRevision(revision+1)}>Rerender {revision}</button>
    <button type="button" onClick={()=>setReplacement(!replacement)}>Replace config</button>
    <button type="button" onClick={()=>setMounted(!mounted)}>Toggle mount</button>
    {mounted&&<Slider config={config} style={{width:280,height:116,margin:24}}/>}
  </main>
}`
    )
  } else {
    files.set(
      'src/App.vue',
      `<script setup lang="ts">
import {computed,ref} from 'vue'
import Slider, {type OpenPencilSliderConfig} from './__openpencil_slider.vue'
const base: OpenPencilSliderConfig = ${base}
const revision=ref(0),mounted=ref(true),replacement=ref(false)
const config=computed(()=>({...base,...(replacement.value?{min:-1,max:1,step:.1,initialValue:-.2,initialEndValue:.6}:{}),revision:revision.value}))
</script><template><main><button type="button" @click="revision++">Rerender {{revision}}</button>
<button type="button" @click="replacement=!replacement">Replace config</button>
<button type="button" @click="mounted=!mounted">Toggle mount</button>
<Slider v-if="mounted" :config="config" style="width:280px;height:116px;margin:24px"/>
</main></template>`
    )
  }
}
