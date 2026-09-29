import { compile, withDefaults } from '@open-pencil/compiler'
import {
  createRatingModuleFrameOverrides,
  createRatingModuleInstance
} from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

export function ratingFixture(target: 'react' | 'vue', lifecycle = false) {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const base = { label: '服务评分', clearLabel: '清空评分' }
  const configs = [
    base,
    { ...base, label: '半星评分', allowHalf: true, initialValue: 2.5 },
    { ...base, label: '只读评分', readOnly: true, initialValue: 4 },
    { ...base, label: '禁用评分', disabled: true, initialValue: 2 },
    { ...base, label: '<b>纯文本</b>', max: 10, initialValue: 7, starSize: 48 }
  ]
  for (const [index, config] of configs.entries()) {
    graph.createNode('FRAME', pageId, {
      ...createRatingModuleFrameOverrides(config),
      x: 24 + (index % 2) * 320,
      y: 24 + Math.floor(index / 2) * 170,
      width: index === 4 ? 120 : 280,
      height: 144
    })
  }
  const result = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ target, router: 'none', devMode: false })
  })
  if (lifecycle) addLifecycle(result.files, target, base)
  return result
}

function addLifecycle(
  files: Map<string, string | Uint8Array>,
  target: 'react' | 'vue',
  config: unknown
) {
  const base = JSON.stringify(createRatingModuleInstance(config).config).replaceAll('<', '\\u003c')
  if (target === 'react') {
    files.set(
      'src/App.tsx',
      `import {useState} from 'react'
import Rating, {type OpenPencilRatingConfig} from './__openpencil_rating'
const base: OpenPencilRatingConfig = ${base}
export default function App(){
 const [revision,setRevision]=useState(0),[mounted,setMounted]=useState(true),[initial,setInitial]=useState(3)
 return <main><button type="button" onClick={()=>setRevision(revision+1)}>Rerender {revision}</button>
 <button type="button" onClick={()=>setInitial(1)}>Change initial</button>
 <button type="button" onClick={()=>setMounted(!mounted)}>Toggle mount</button>
 {mounted&&<Rating config={{...base,initialValue:initial}} style={{width:280,height:144}}/>}</main>
}`
    )
  } else {
    files.set(
      'src/App.vue',
      `<script setup lang="ts">
import {computed,ref} from 'vue'
import Rating, {type OpenPencilRatingConfig} from './__openpencil_rating.vue'
const base: OpenPencilRatingConfig = ${base}
const revision=ref(0),mounted=ref(true),initial=ref(3)
const config=computed(()=>({...base,initialValue:initial.value,revision:revision.value}))
</script><template><main><button type="button" @click="revision++">Rerender {{revision}}</button>
<button type="button" @click="initial=1">Change initial</button>
<button type="button" @click="mounted=!mounted">Toggle mount</button>
<Rating v-if="mounted" :config="config" style="width:280px;height:144px"/>
</main></template>`
    )
  }
}
