import { colorInputFixture } from './fixture'

/** Generated components with real host lifecycle changes; no browser globals during emission. */
export function colorInputRuntimeFixture(target: 'react' | 'vue') {
  const fixture = colorInputFixture(target),
    files = new Map(fixture.files)
  const style =
    "{width:'320px',maxWidth:'100%',height:'44px',padding:'0 12px',border:'1px solid #94a3b8',borderRadius:'8px',background:'#fff',color:'#111827',fontSize:'16px'}"
  const app =
    target === 'react'
      ? `import {useState} from 'react'
import {OpenPencilInputControl as Input} from './components/_open-pencil-input-control'
export default function App(){
const [value,setValue]=useState('#2563eb'),[disabled,setDisabled]=useState(false),[readOnly,setReadOnly]=useState(false),[visible,setVisible]=useState(true),[changes,setChanges]=useState(0),[submits,setSubmits]=useState(0),[lang,setLang]=useState('en')
const style=${style}
return <main lang={lang} style={{padding:12}}><form id="colors" onSubmit={e=>{e.preventDefault();setSubmits(v=>v+1)}} style={{display:'flex',flexDirection:'column',gap:12}}>{visible&&<Input config={{kind:'color',readOnly}} value={value} name="primary" id="primary" aria-label="Primary" required disabled={disabled} style={style} onChange={e=>{setValue(e.currentTarget.value);setChanges(v=>v+1)}}/>}<Input config={{kind:'color',readOnly:false}} defaultValue="#abcdef" name="other" aria-label="Other" style={style}/><Input config={{kind:'color',readOnly:true}} defaultValue="#112233" name="readonly" aria-label="Readonly field" style={style}/><Input config={{kind:'color',readOnly:false}} defaultValue="#998877" name="disabled" aria-label="Disabled field" disabled style={style}/><Input config={{kind:'color',readOnly:false}} name="detached" aria-label="Detached" form="" required style={style}/><button type="reset">Reset</button><button type="submit">Submit</button></form><Input config={{kind:'color',readOnly:false}} name="external" aria-label="External form color" defaultValue="#445566" form="colors" style={style}/><button onClick={()=>setValue('')}>Empty</button><button onClick={()=>setValue('not-a-color')}>Invalid</button><button onClick={()=>setValue('#123456')}>External</button><button onClick={()=>setReadOnly(v=>!v)}>Readonly</button><button onClick={()=>setDisabled(v=>!v)}>Disabled</button><button onClick={()=>setVisible(v=>!v)}>Mount</button><button onClick={()=>setLang(v=>v==='en'?'zh-CN':'en')}>Language</button><output>Value[{value}] Changes[{changes}] Submit[{submits}]</output></main>}
`
      : `<script setup lang="ts">
import {ref} from 'vue'
import Input from './components/open-pencil/OpenPencilInputControl.vue'
const value=ref('#2563eb'),disabled=ref(false),readOnly=ref(false),visible=ref(true),changes=ref(0),submits=ref(0),lang=ref('en'),style=${style}
function change(event:Event){value.value=(event.target as HTMLInputElement).value;changes.value++}
</script><template><main :lang="lang" style="padding:12px"><form id="colors" @submit.prevent="submits++" style="display:flex;flex-direction:column;gap:12px"><Input v-if="visible" :config="{kind:'color',readOnly}" :value="value" name="primary" id="primary" aria-label="Primary" required :disabled="disabled" :style="style" @input="change"/><Input :config="{kind:'color',readOnly:false}" default-value="#abcdef" name="other" aria-label="Other" :style="style"/><Input :config="{kind:'color',readOnly:true}" default-value="#112233" name="readonly" aria-label="Readonly field" :style="style"/><Input :config="{kind:'color',readOnly:false}" default-value="#998877" name="disabled" aria-label="Disabled field" disabled :style="style"/><Input :config="{kind:'color',readOnly:false}" name="detached" aria-label="Detached" form="" required :style="style"/><button type="reset">Reset</button><button type="submit">Submit</button></form><Input :config="{kind:'color',readOnly:false}" name="external" aria-label="External form color" default-value="#445566" form="colors" :style="style"/><button @click="value=''">Empty</button><button @click="value='not-a-color'">Invalid</button><button @click="value='#123456'">External</button><button @click="readOnly=!readOnly">Readonly</button><button @click="disabled=!disabled">Disabled</button><button @click="visible=!visible">Mount</button><button @click="lang=lang==='en'?'zh-CN':'en'">Language</button><output>Value[{{value}}] Changes[{{changes}}] Submit[{{submits}}]</output></main></template>
`
  files.set(target === 'react' ? 'src/App.tsx' : 'src/App.vue', app)
  return { files: [...files] }
}
