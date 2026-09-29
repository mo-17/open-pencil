import { compile, withDefaults, type CompilerTarget } from '@open-pencil/compiler'
import { SceneGraph } from '@open-pencil/scene-graph'

import {
  createSkeletonModuleFrameOverrides,
  createSkeletonModuleInstance
} from '#core/plugins/skeleton'

export function skeletonFixture(target: CompilerTarget, updates = false) {
  const graph = new SceneGraph(),
    pageId = graph.getPages()[0].id
  const samples = [
    { config: { label: '正在加载内容' }, width: 320, height: 128, y: 20 },
    {
      config: { variant: 'rectangle', label: '图片占位', showLabel: true, animation: 'none' },
      width: 280,
      height: 128,
      y: 164
    },
    {
      config: { variant: 'circle', label: '头像占位', animation: 'none' },
      width: 100,
      height: 80,
      y: 308
    },
    {
      config: { label: '窄容器', rows: 12, lineHeight: 48, gap: 32 },
      width: 40,
      height: 24,
      y: 404
    },
    {
      config: { label: '<b>等待详情</b>', showLabel: true, fontSize: 32, variant: 'circle' },
      width: 180,
      height: 24,
      y: 444
    }
  ]
  for (const sample of samples)
    graph.createNode('FRAME', pageId, {
      ...createSkeletonModuleFrameOverrides(sample.config),
      x: 20,
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
  const config = JSON.stringify(createSkeletonModuleInstance({ label: 'Loading profile' }).config)
  if (target === 'react')
    files.set(
      'src/App.tsx',
      `import {useState} from 'react'
import Skeleton,{type OpenPencilSkeletonConfig} from './__openpencil_skeleton'
export default function App(){const [visible,setVisible]=useState(true),[config,setConfig]=useState<OpenPencilSkeletonConfig>(${config})
return <main><button onClick={()=>setVisible(!visible)}>Toggle loading</button>
<button onClick={()=>setConfig({...config,variant:'circle',animation:'none',showLabel:true})}>Circle</button>
{visible ? <Skeleton config={config} style={{width:240,height:128}}/> : <p>Profile ready</p>}</main>}`
    )
  else
    files.set(
      'src/App.vue',
      `<script setup lang="ts">
import {ref} from 'vue'
import Skeleton,{type OpenPencilSkeletonConfig} from './__openpencil_skeleton.vue'
const visible=ref(true),config=ref<OpenPencilSkeletonConfig>(${config})
</script><template><main><button @click="visible=!visible">Toggle loading</button>
<button @click="config={...config,variant:'circle',animation:'none',showLabel:true}">Circle</button>
<Skeleton v-if="visible" :config="config" style="width:240px;height:128px"/><p v-else>Profile ready</p></main></template>`
    )
}
