import { compile, withDefaults } from '@open-pencil/compiler'
import {
  createEmptyStateModuleFrameOverrides,
  createEmptyStateModuleInstance
} from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

export function emptyStateFixture(target: 'react' | 'vue', replacement = false) {
  const graph = new SceneGraph(),
    page = graph.getPages()[0]
  graph.createNode('FRAME', page.id, {
    ...createEmptyStateModuleFrameOverrides({
      title: '暂无资料',
      description: '添加资料后，可在这里继续整理。\nEnglish content stays editable.'
    }),
    x: 20,
    y: 20,
    width: 320,
    height: 280
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
  const base = JSON.stringify(
    createEmptyStateModuleInstance({ title: '暂无资料', description: '添加资料后，在这里整理。' })
      .config
  )
  const long = JSON.stringify({
    title: '<b>无结果</b>',
    description: '请调整关键词并重试。LongUnbrokenEnglishWord'.repeat(16),
    illustration: 'search',
    alignment: 'left',
    fontSize: 24,
    padding: 64,
    iconSize: 128
  })
  if (target === 'react')
    files.set(
      'src/App.tsx',
      `import {useState} from 'react'
import EmptyState,{type OpenPencilEmptyStateConfig} from './__openpencil_empty_state'
const base:OpenPencilEmptyStateConfig=${base}
export default function App(){const [config,setConfig]=useState(base)
return <><button type="button" onClick={()=>setConfig({...base,${long.slice(1, -1)}})}>Long search result</button>
<button type="button" onClick={()=>setConfig({...base,illustration:'none',description:''})}>Text only</button>
<button type="button" onClick={()=>setConfig({...base})}>Restore defaults</button>
<EmptyState config={config} style={{width:'min(320px,calc(100vw - 40px))',height:280,margin:20}}/>
<EmptyState config={base} style={{width:280,height:240,margin:20}}/></>}`
    )
  else
    files.set(
      'src/App.vue',
      `<script setup lang="ts">
import {ref} from 'vue'
import EmptyState,{type OpenPencilEmptyStateConfig} from './__openpencil_empty_state.vue'
const base:OpenPencilEmptyStateConfig=${base}
const config=ref(base)
function search(){config.value={...base,${long.slice(1, -1)}}}
</script><template><button type="button" @click="search">Long search result</button>
<button type="button" @click="config={...base,illustration:'none',description:''}">Text only</button>
<button type="button" @click="config={...base}">Restore defaults</button>
<EmptyState :config="config" style="width:min(320px,calc(100vw - 40px));height:280px;margin:20px"/>
<EmptyState :config="base" style="width:280px;height:240px;margin:20px"/></template>`
    )
}
