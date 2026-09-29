import { compile, withDefaults } from '@open-pencil/compiler'
import { createTreeModuleFrameOverrides, createTreeModuleInstance } from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'
export function treeFixture(target: 'react' | 'vue') {
  const config = createTreeModuleInstance({
    label: '项目目录',
    placeholder: '请选择节点',
    items: [
      { id: 'project', label: '项目', parentId: '', disabled: false },
      {
        id: 'design',
        label: '中文设计规范与非常长的混合文字 Long label',
        parentId: 'project',
        disabled: false
      },
      { id: 'development', label: '开发', parentId: 'project', disabled: false },
      { id: 'hidden', label: '禁用目录', parentId: '', disabled: true },
      { id: 'child', label: '禁用子节点', parentId: 'hidden', disabled: false }
    ],
    initialExpandedIds: ['project', 'hidden']
  }).config
  const graph = new SceneGraph(),
    pageId = graph.getPages()[0].id
  graph.createNode('FRAME', pageId, createTreeModuleFrameOverrides(config))
  const result = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ target, router: 'none', devMode: false })
  })
  const initial = JSON.stringify(config)
  result.files.set(
    target === 'react' ? 'src/App.tsx' : 'src/App.vue',
    target === 'react'
      ? `import {useState} from 'react'
import Tree,{type OpenPencilTreeConfig} from './__openpencil_tree'
const initial:OpenPencilTreeConfig=${initial}
export default function App(){const [config,setConfig]=useState(initial),[show,setShow]=useState(true),[language,setLanguage]=useState('zh-CN'),[business,setBusiness]=useState('')
return <main style={{padding:12}}><button onClick={()=>setConfig({...config,selectionMode:config.selectionMode==='single'?'multiple':'single',initialSelectedIds:[]})}>Mode</button><button onClick={()=>setConfig({...config,presentation:config.presentation==='tree'?'select':'tree'})}>Presentation</button><button onClick={()=>setConfig({...config,disabled:!config.disabled})}>Disabled</button><button onClick={()=>setLanguage(language==='zh-CN'?'en':'zh-CN')}>Language</button><button onClick={()=>setShow(!show)}>Mount</button><button onClick={()=>setConfig({...config,accentColor:config.accentColor==='#2563EB'?'#16A34A':'#2563EB'})}>Style</button><input aria-label="Business input" value={business} onChange={event=>setBusiness(event.target.value)}/><section aria-label="Current tree">{show&&<Tree config={{...config}} lang={language} style={{width:240,height:440,maxWidth:'100%'}}/>}</section><section aria-label="Other tree"><Tree config={initial} lang="en" style={{width:240,height:440,maxWidth:'100%'}}/></section></main>}`
      : `<script setup lang="ts">
import {ref} from 'vue'
import Tree,{type OpenPencilTreeConfig} from './__openpencil_tree.vue'
const initial:OpenPencilTreeConfig=${initial},config=ref({...initial}),show=ref(true),language=ref('zh-CN'),business=ref('')
</script><template><main style="padding:12px"><button @click="config={...config,selectionMode:config.selectionMode==='single'?'multiple':'single',initialSelectedIds:[]}">Mode</button><button @click="config={...config,presentation:config.presentation==='tree'?'select':'tree'}">Presentation</button><button @click="config={...config,disabled:!config.disabled}">Disabled</button><button @click="language=language==='zh-CN'?'en':'zh-CN'">Language</button><button @click="show=!show">Mount</button><button @click="config={...config,accentColor:config.accentColor==='#2563EB'?'#16A34A':'#2563EB'}">Style</button><input aria-label="Business input" v-model="business"/><section aria-label="Current tree"><Tree v-if="show" :config="{...config}" :lang="language" style="width:240px;height:440px;max-width:100%"/></section><section aria-label="Other tree"><Tree :config="initial" lang="en" style="width:240px;height:440px;max-width:100%"/></section></main></template>`
  )
  return result
}
