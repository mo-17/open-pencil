import { compile, withDefaults } from '@open-pencil/compiler'
import {
  createAlertModuleFrameOverrides,
  createAlertModuleInstance
} from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

export function alertFixture(target: 'react' | 'vue', lifecycle = false) {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const base = { title: '保存成功', description: '修改已在本机保存。', closeLabel: '关闭提示' }
  const configs = [
    { ...base, tone: 'success' },
    { ...base, title: '需要注意', tone: 'warning', variant: 'filled', announcement: 'assertive' },
    { ...base, title: '服务暂不可用', tone: 'error', variant: 'outlined', closable: false },
    {
      ...base,
      title: '<b>纯文本</b>',
      description: '<img src=x onerror="alert(1)">',
      showIcon: false,
      announcement: 'off'
    }
  ]
  configs.forEach((config, index) =>
    graph.createNode('FRAME', pageId, {
      ...createAlertModuleFrameOverrides(config),
      x: 24,
      y: 24 + index * 144,
      width: index === 3 ? 160 : 320,
      height: 124
    })
  )
  const result = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ target, router: 'none', devMode: false })
  })
  if (lifecycle) addAlertLifecycle(result.files, target, base)
  return result
}

function addAlertLifecycle(
  files: Map<string, string | Uint8Array>,
  target: 'react' | 'vue',
  config: unknown
) {
  const base = JSON.stringify(createAlertModuleInstance(config).config).replaceAll('<', '\\u003c')
  if (target === 'react') {
    files.set(
      'src/App.tsx',
      `import {useState} from 'react'
import Alert,{type OpenPencilAlertConfig} from './__openpencil_alert'
const base:OpenPencilAlertConfig=${base}
export default function App(){
 const [revision,setRevision]=useState(0),[mounted,setMounted]=useState(true),[title,setTitle]=useState(base.title)
 return <main><button type="button" onClick={()=>setRevision(revision+1)}>Rerender {revision}</button>
 <button type="button" onClick={()=>setTitle(title===base.title?'更新提示':base.title)}>Change message</button>
 <button type="button" onClick={()=>setMounted(!mounted)}>Toggle mount</button>
 <section aria-label="Local alert region"><button type="button">Previous</button>
 {mounted&&<Alert config={{...base,title}} style={{width:320,height:124}}/>}
 <button type="button" disabled>Disabled next</button><a href="#after">Next action</a></section>
 <section aria-label="Other instance"><Alert config={{...base}} style={{width:320,height:124}}/></section>
 <section aria-label="Narrow message"><Alert config={{...base,title:'长标题LongUnbrokenMessage'.repeat(3),description:'较长的中文内容需要自动换行。'.repeat(5)}} style={{width:120,height:160}}/></section>
 </main>
}`
    )
  } else {
    files.set(
      'src/App.vue',
      `<script setup lang="ts">
import {computed,ref} from 'vue'
import Alert,{type OpenPencilAlertConfig} from './__openpencil_alert.vue'
const base:OpenPencilAlertConfig=${base}
const revision=ref(0),mounted=ref(true),title=ref(base.title)
const config=computed(()=>{void revision.value;return {...base,title:title.value}})
</script><template><main><button type="button" @click="revision++">Rerender {{revision}}</button>
<button type="button" @click="title=title===base.title?'更新提示':base.title">Change message</button>
<button type="button" @click="mounted=!mounted">Toggle mount</button>
<section aria-label="Local alert region"><button type="button">Previous</button>
<Alert v-if="mounted" :config="config" style="width:320px;height:124px"/>
<button type="button" disabled>Disabled next</button><a href="#after">Next action</a></section>
<section aria-label="Other instance"><Alert :config="{...base}" style="width:320px;height:124px"/></section>
<section aria-label="Narrow message"><Alert :config="{...base,title:'长标题LongUnbrokenMessage'.repeat(3),description:'较长的中文内容需要自动换行。'.repeat(5)}" style="width:120px;height:160px"/></section>
</main></template>`
    )
  }
}
