import { autocompleteFixture, INPUT_SUGGESTIONS } from './model'

/** Exercise the generated input contract with runtime prop changes as a real application can. */
export function autocompleteRuntimeFixture(target: 'react' | 'vue') {
  const result = autocompleteFixture(target),
    files = new Map(result.files),
    suggestions = JSON.stringify(INPUT_SUGGESTIONS).replaceAll('<', '\\u003c')
  files.set(
    target === 'react' ? 'src/App.tsx' : 'src/App.vue',
    target === 'react'
      ? `import {useState} from 'react'
import {OpenPencilAutocomplete as Input} from './components/_open-pencil-autocomplete'
const initial=${suggestions}
export default function App(){
const [value,setValue]=useState(''),[disabled,setDisabled]=useState(false),[readOnly,setReadOnly]=useState(false),[show,setShow]=useState(true),[suggestions,setSuggestions]=useState(initial),[changes,setChanges]=useState(0),[submits,setSubmits]=useState(0),[language,setLanguage]=useState('zh-CN')
return <main lang={language} style={{padding:12}}><div style={{height:55,overflow:'hidden'}}><form onSubmit={e=>{e.preventDefault();setSubmits(n=>n+1)}}>{show&&<Input suggestions={suggestions} type="search" name="city" aria-label="Runtime city" value={value} onChange={e=>{setValue(e.currentTarget.value);setChanges(n=>n+1)}} disabled={disabled} readOnly={readOnly} style={{width:300,maxWidth:'100%',height:44,padding:'0 12px'}}/>}<button type="reset">Reset</button></form></div><form aria-label="Uncontrolled"><Input suggestions={initial} name="free" defaultValue="自由初值" aria-label="Free city" style={{width:300,maxWidth:'100%',height:44}}/><button type="reset">Reset free</button></form><button onClick={()=>setValue('外部值')}>External</button><button onClick={()=>setDisabled(v=>!v)}>Disabled</button><button onClick={()=>setReadOnly(v=>!v)}>Readonly</button><button onClick={()=>setShow(v=>!v)}>Mount</button><button onClick={()=>setSuggestions(['全新建议'])}>Replace</button><button onClick={()=>setLanguage(v=>v==='zh-CN'?'en':'zh-CN')}>Language</button><output>Value[{value}] Changes[{changes}] Submit[{submits}]</output></main>}
`
      : `<script setup lang="ts">
import {ref} from 'vue'
import Input from './components/open-pencil/OpenPencilAutocomplete.vue'
const initial=${suggestions},value=ref(''),disabled=ref(false),readOnly=ref(false),show=ref(true),suggestions=ref(initial),changes=ref(0),submits=ref(0),language=ref('zh-CN')
function change(event:Event){value.value=(event.target as HTMLInputElement).value;changes.value++}
</script><template><main :lang="language" style="padding:12px"><div style="height:55px;overflow:hidden"><form @submit.prevent="submits++"><Input v-if="show" :suggestions="suggestions" type="search" name="city" aria-label="Runtime city" :value="value" @input="change" :disabled="disabled" :readonly="readOnly" style="width:300px;max-width:100%;height:44px;padding:0 12px"/><button type="reset">Reset</button></form></div><form aria-label="Uncontrolled"><Input :suggestions="initial" name="free" default-value="自由初值" aria-label="Free city" style="width:300px;max-width:100%;height:44px"/><button type="reset">Reset free</button></form><button @click="value='外部值'">External</button><button @click="disabled=!disabled">Disabled</button><button @click="readOnly=!readOnly">Readonly</button><button @click="show=!show">Mount</button><button @click="suggestions=['全新建议']">Replace</button><button @click="language=language==='zh-CN'?'en':'zh-CN'">Language</button><output>Value[{{value}}] Changes[{{changes}}] Submit[{{submits}}]</output></main></template>
`
  )
  return { ...result, files: [...files] }
}
