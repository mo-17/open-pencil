import { compile, withDefaults } from '@open-pencil/compiler'
import {
  createPopoverModuleFrameOverrides,
  createPopoverModuleInstance
} from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

export function popoverFixture(target: 'react' | 'vue', dynamic = false) {
  const graph = new SceneGraph(),
    pageId = graph.getPages()[0].id
  const popover = graph.createNode('FRAME', pageId, {
    ...createPopoverModuleFrameOverrides({
      triggerLabel: '编辑说明',
      title: '详细信息',
      content: '备用文字',
      contentChildName: '自定义内容'
    }),
    x: 24,
    y: 24
  })
  const content = graph.createNode('FRAME', popover.id, {
    name: '自定义内容',
    width: 260,
    height: 96,
    layoutMode: 'VERTICAL',
    itemSpacing: 12
  })
  graph.createNode('TEXT', content.id, { text: '这里是可编辑的子图层', width: 250, height: 24 })
  graph.createNode('INPUT', content.id, {
    name: '内容字段',
    width: 250,
    height: 44,
    interactiveProps: { placeholder: '填写备注', value: '' }
  })
  graph.createNode('FRAME', pageId, {
    ...createPopoverModuleFrameOverrides({
      mode: 'confirm',
      triggerLabel: '确认设置',
      title: '应用设置？',
      content: '只显示确认结果，不提交业务。',
      confirmLabel: '确认',
      cancelLabel: '取消'
    }),
    x: 24,
    y: 180,
    interactiveProps: {
      ...createPopoverModuleFrameOverrides({
        mode: 'confirm',
        triggerLabel: '确认设置',
        title: '应用设置？',
        content: '只显示确认结果，不提交业务。',
        confirmLabel: '确认',
        cancelLabel: '取消'
      }).interactiveProps,
      lang: 'zh-CN'
    }
  })
  const result = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ target, router: 'none', devMode: false })
  })
  if (dynamic) addDynamic(result.files, target)
  return result
}

function addDynamic(files: Map<string, string | Uint8Array>, target: 'react' | 'vue') {
  const config = JSON.stringify(
    createPopoverModuleInstance({
      mode: 'confirm',
      triggerLabel: 'Show details',
      title: 'Confirm settings',
      content: '<img src=x onerror=alert(1)>',
      contentChildName: 'Inline',
      confirmLabel: 'Confirm',
      cancelLabel: 'Cancel'
    }).config
  )
  if (target === 'react')
    files.set(
      'src/App.tsx',
      `import {useState} from 'react'
import Popover,{type OpenPencilPopoverConfig} from './__openpencil_popover'
const initial:OpenPencilPopoverConfig=${config}
export default function App(){const [config,setConfig]=useState(initial),[show,setShow]=useState(true),[count,setCount]=useState(0),[lang,setLang]=useState('en'),[value,setValue]=useState('')
return <main style={{padding:16,minHeight:1200}}><button onClick={()=>setConfig({...config,title:'Changed title'})}>Update</button><button onClick={()=>setConfig({...config,disabled:!config.disabled})}>Toggle disabled</button><button onClick={()=>setShow(!show)}>Toggle component</button><button onClick={()=>setLang(lang==='en'?'zh-CN':'en')}>Language</button><button onClick={()=>setCount(count+1)}>Rerender {count}</button><button>Outside</button>
<section aria-label="Current popover" lang={lang} style={{marginTop:120,overflow:'hidden',transform:'translateZ(0)'}}>{show&&<Popover config={{...config}} content={<><span>{config.content}</span><button onClick={()=>setConfig({...config,title:'Changed title'})}>Update inside</button><button onClick={()=>setShow(false)}>Unmount inside</button></>} style={{width:200,height:44}}/>}</section>
<section aria-label="Editable popover" style={{marginTop:180}}><Popover config={{...initial,mode:'popover',triggerLabel:'Edit content',title:'Custom content',contentChildName:'Editor'}} content={<label>Local note<input value={value} onChange={event=>setValue(event.target.value)}/></label>} style={{width:200,height:44}}/></section>
<section aria-label="Other popover" style={{marginTop:180}}><Popover config={{...initial,triggerLabel:'Other details'}} style={{width:200,height:44}}/></section></main>}`
    )
  else
    files.set(
      'src/App.vue',
      `<script setup lang="ts">
import {ref} from 'vue'
import Popover,{type OpenPencilPopoverConfig} from './__openpencil_popover.vue'
const initial:OpenPencilPopoverConfig=${config}
const config=ref({...initial}),show=ref(true),count=ref(0),lang=ref('en'),value=ref('')
</script><template><main style="padding:16px;min-height:1200px"><button @click="config={...config,title:'Changed title'}">Update</button><button @click="config={...config,disabled:!config.disabled}">Toggle disabled</button><button @click="show=!show">Toggle component</button><button @click="lang=lang==='en'?'zh-CN':'en'">Language</button><button @click="count++">Rerender {{count}}</button><button>Outside</button>
<section aria-label="Current popover" :lang="lang" style="margin-top:120px;overflow:hidden;transform:translateZ(0)"><Popover v-if="show" :config="{...config}" style="width:200px;height:44px"><template #content><span>{{config.content}}</span><button @click="config={...config,title:'Changed title'}">Update inside</button><button @click="show=false">Unmount inside</button></template></Popover></section>
<section aria-label="Editable popover" style="margin-top:180px"><Popover :config="{...initial,mode:'popover',triggerLabel:'Edit content',title:'Custom content',contentChildName:'Editor'}" style="width:200px;height:44px"><template #content><label>Local note<input v-model="value"/></label></template></Popover></section>
<section aria-label="Other popover" style="margin-top:180px"><Popover :config="{...initial,triggerLabel:'Other details'}" style="width:200px;height:44px"/></section></main></template>`
    )
}
