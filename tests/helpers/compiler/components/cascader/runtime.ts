import { compile, withDefaults } from '@open-pencil/compiler'
import {
  CASCADER_MODULE_DEFAULT_CONFIG,
  createCascaderModuleFrameOverrides
} from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

export function cascaderRuntimeFixture(target: 'react' | 'vue') {
  const graph = new SceneGraph(),
    page = graph.getPages()[0]
  graph.createNode('FRAME', page.id, createCascaderModuleFrameOverrides())
  const result = compile({
    graph,
    pageIds: [page.id],
    options: withDefaults({ target, router: 'none', devMode: false })
  })
  const files = new Map(result.files)
  const base = JSON.stringify({
    ...CASCADER_MODULE_DEFAULT_CONFIG,
    label: 'Destination',
    initialPath: ['europe', 'france']
  })
  const source =
    target === 'react'
      ? `import {useState} from 'react'
import Cascader,{type OpenPencilCascaderConfig} from './__openpencil_cascader'
export default function App(){
 const [config,setConfig]=useState<OpenPencilCascaderConfig>(${base}),[value,setValue]=useState<unknown>([]),[writes,setWrites]=useState(0),[submits,setSubmits]=useState(0),[readonly,setReadonly]=useState(false),[disabled,setDisabled]=useState(false),[mounted,setMounted]=useState(true),[cancel,setCancel]=useState(false)
 const style={width:320,height:44,maxWidth:'100%'}
 return <main lang="en" style={{padding:12}}><form id="destination-form" onSubmit={event=>{event.preventDefault();setSubmits(value=>value+1)}} onReset={event=>{if(cancel)event.preventDefault()}}>
 {mounted&&<Cascader config={config} style={style} valueBound value={value} onValueChange={next=>{setValue(next);setWrites(count=>count+1)}} readOnly={readonly} disabled={disabled} field={{name:'location',required:true,onReset:()=>setValue([])}}/>}
 <button type="submit" style={{marginTop:360}}>Submit destination</button><button type="reset">Reset destination</button></form>
 <Cascader config={{...config,label:'Local destination',initialPath:[]}} style={style}/>
 <button type="button" onClick={()=>setValue(['invalid'])}>Malformed value</button><button type="button" onClick={()=>setReadonly(value=>!value)}>Toggle readonly</button><button type="button" onClick={()=>setDisabled(value=>!value)}>Toggle disabled</button><button type="button" onClick={()=>setMounted(value=>!value)}>Toggle mount</button><button type="button" onClick={()=>setCancel(value=>!value)}>Toggle cancel reset</button><button type="button" onClick={()=>setConfig(value=>({...value,items:[{id:'newRoot',parentId:'',label:'New destination',disabled:false}],initialPath:[]}))}>Replace options</button>
 <output data-cascader-state="" style={{display:'block',overflowWrap:'anywhere'}}>{JSON.stringify({value,writes,submits})}</output></main>
}`
      : `<script setup lang="ts">
import {ref} from 'vue'
import Cascader,{type OpenPencilCascaderConfig} from './__openpencil_cascader.vue'
const config=ref<OpenPencilCascaderConfig>(${base}),value=ref<unknown>([]),writes=ref(0),submits=ref(0),readonly=ref(false),disabled=ref(false),mounted=ref(true),cancel=ref(false),style={width:'320px',height:'44px',maxWidth:'100%'}
function change(next:string[]){value.value=next;writes.value++}
</script><template><main lang="en" style="padding:12px"><form id="destination-form" @submit.prevent="submits++" @reset="event=>{if(cancel)event.preventDefault()}">
<Cascader v-if="mounted" :config="config" :style="style" :value-bound="true" :value="value" :on-value-change="change" :read-only="readonly" :disabled="disabled" :field="{name:'location',required:true,onReset:()=>{value=[]}}"/>
<button type="submit" style="margin-top:360px">Submit destination</button><button type="reset">Reset destination</button></form>
<Cascader :config="{...config,label:'Local destination',initialPath:[]}" :style="style"/>
<button type="button" @click="value=['invalid']">Malformed value</button><button type="button" @click="readonly=!readonly">Toggle readonly</button><button type="button" @click="disabled=!disabled">Toggle disabled</button><button type="button" @click="mounted=!mounted">Toggle mount</button><button type="button" @click="cancel=!cancel">Toggle cancel reset</button><button type="button" @click="config={...config,items:[{id:'newRoot',parentId:'',label:'New destination',disabled:false}],initialPath:[]}">Replace options</button>
<output data-cascader-state="" style="display:block;overflow-wrap:anywhere">{{JSON.stringify({value,writes,submits})}}</output></main></template>`
  files.set(target === 'react' ? 'src/App.tsx' : 'src/App.vue', source)
  return { files, warnings: result.warnings }
}
