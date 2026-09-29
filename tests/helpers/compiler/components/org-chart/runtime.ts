import { ORG_CHART_MODULE_DEFAULT_CONFIG } from '@open-pencil/core/plugins'

import { orgChartFixture } from './fixture'

export function orgChartRuntimeFixture(target: 'react' | 'vue') {
  const result = orgChartFixture(target),
    files = new Map(result.files)
  const base = JSON.stringify({
    ...ORG_CHART_MODULE_DEFAULT_CONFIG,
    label: 'Live organization',
    items: [
      { id: 'root', parentId: '', label: 'Head office', description: 'Leadership' },
      { id: 'design', parentId: 'root', label: 'Design team', description: 'Brand and experience' },
      { id: 'designer', parentId: 'design', label: 'Designer', description: '界面与交互设计' },
      { id: 'engineering', parentId: 'root', label: 'Engineering', description: 'Platform' },
      { id: 'developer', parentId: 'engineering', label: 'Developer', description: 'Applications' }
    ]
  })
  const source =
    target === 'react'
      ? `import {useState} from 'react'
import OrgChart,{type OpenPencilOrgChartConfig} from './__openpencil_org_chart'
export default function App(){
 const [config,setConfig]=useState<OpenPencilOrgChartConfig>(${base}),[shown,setShown]=useState(true),[width,setWidth]=useState(340),[lang,setLang]=useState('en'),[submits,setSubmits]=useState(0)
 const style={width:width+'px',height:'400px',maxWidth:'100%'}
 return <main lang={lang} style={{padding:12}}><form onSubmit={event=>{event.preventDefault();setSubmits(value=>value+1)}}>{shown&&<OrgChart config={config} style={style}/>}<OrgChart config={{...(${base}),label:'Other organization'}} style={style}/></form><button type="button" onClick={()=>setConfig(value=>({...value,initialCollapsedIds:['root']}))}>Reset branches</button><button type="button" onClick={()=>setConfig(value=>({...value,direction:value.direction==='vertical'?'horizontal':'vertical'}))}>Direction</button><button type="button" onClick={()=>setConfig(value=>({...value,collapsible:!value.collapsible}))}>Collapsible</button><button type="button" onClick={()=>setConfig(value=>({...value,items:value.items.filter(item=>item.id!=='designer')}))}>Remove designer</button><button type="button" onClick={()=>setWidth(180)}>Narrow</button><button type="button" onClick={()=>setLang(value=>value==='en'?'zh-CN':'en')}>Language</button><button type="button" onClick={()=>setShown(value=>!value)}>Mount</button><output>Submits[{submits}]</output></main>
}`
      : `<script setup lang="ts">
import {ref} from 'vue'
import OrgChart,{type OpenPencilOrgChartConfig} from './__openpencil_org_chart.vue'
const base:OpenPencilOrgChartConfig=${base},config=ref<OpenPencilOrgChartConfig>({...base}),shown=ref(true),width=ref(340),lang=ref('en'),submits=ref(0)
</script><template><main :lang="lang" style="padding:12px"><form @submit.prevent="submits++"><OrgChart v-if="shown" :config="config" :style="{width:width+'px',height:'400px',maxWidth:'100%'}"/><OrgChart :config="{...base,label:'Other organization'}" :style="{width:width+'px',height:'400px',maxWidth:'100%'}"/></form><button type="button" @click="config={...config,initialCollapsedIds:['root']}">Reset branches</button><button type="button" @click="config={...config,direction:config.direction==='vertical'?'horizontal':'vertical'}">Direction</button><button type="button" @click="config={...config,collapsible:!config.collapsible}">Collapsible</button><button type="button" @click="config={...config,items:config.items.filter(item=>item.id!=='designer')}">Remove designer</button><button type="button" @click="width=180">Narrow</button><button type="button" @click="lang=lang==='en'?'zh-CN':'en'">Language</button><button type="button" @click="shown=!shown">Mount</button><output>Submits[{{submits}}]</output></main></template>`
  files.set(target === 'react' ? 'src/App.tsx' : 'src/App.vue', source)
  return { files, warnings: result.warnings }
}
