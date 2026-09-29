import { inputControlRuntimeSource } from '#compiler/adapters/input-control/runtime'
import { reactInputControlSource } from '#compiler/adapters/react/input-control/runtime'
import {
  buildVueInputControlComponent,
  VUE_INPUT_CONTROL_COMPONENT_FILE
} from '#compiler/adapters/vue/input-control/component'
import { tailwindClassName } from '#compiler/ir/style'

import { compile, withDefaults } from '@open-pencil/compiler'
import { SceneGraph } from '@open-pencil/scene-graph'

/** Real generated components in an app that can replace props and reset their native form. */
export function inputControlRuntimeFixture(target: 'react' | 'vue') {
  const graph = new SceneGraph(),
    pageId = graph.getPages()[0].id
  const container = graph.createNode('FRAME', pageId, {
    name: 'Input controls',
    width: 340,
    height: 700,
    layoutMode: 'VERTICAL'
  })
  const styled = graph.createNode('INPUT', container.id, {
    width: 320,
    height: 44,
    fontSize: 16,
    paddingLeft: 12,
    paddingRight: 12,
    paddingTop: 8,
    paddingBottom: 8,
    cornerRadius: 8,
    fills: [{ type: 'SOLID', color: { r: 1, g: 1, b: 1, a: 1 }, visible: true, opacity: 1 }],
    interactiveProps: {
      inputType: 'password',
      showPasswordToggle: true,
      placeholderColor: '#123456'
    },
    stateOverrides: {
      focus: {
        fills: [
          { type: 'SOLID', color: { r: 0.2, g: 0.4, b: 0.6, a: 1 }, visible: true, opacity: 1 }
        ]
      },
      disabled: { opacity: 0.35 }
    }
  })
  const styledClasses = tailwindClassName(styled, graph)
  const result = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ target, router: 'none', sourceLocale: 'zh-CN', devMode: false })
  })
  const files = new Map(result.files)
  files.set('src/lib/open-pencil-input-control.ts', inputControlRuntimeSource())
  files.set(
    target === 'react'
      ? 'src/components/_open-pencil-input-control.tsx'
      : VUE_INPUT_CONTROL_COMPONENT_FILE,
    target === 'react' ? reactInputControlSource() : buildVueInputControlComponent()
  )
  files.set(target === 'react' ? 'src/App.tsx' : 'src/App.vue', runtimeApp(target, styledClasses))
  return { files: [...files], warnings: result.warnings }
}

function runtimeApp(target: 'react' | 'vue', styledClasses: string): string {
  const style = `{width:'320px',maxWidth:'100%',height:'44px',padding:'0 12px',border:'1px solid #94a3b8',borderRadius:'8px',color:'#1f2937',background:'#fff',fontSize:'16px'}`
  if (target === 'react')
    return `import {useState} from 'react'
import {OpenPencilInputControl as Input} from './components/_open-pencil-input-control'
export default function App(){
const [value,setValue]=useState('0.2'),[password,setPassword]=useState('初始密码'),[placement,setPlacement]=useState<'end'|'sides'>('end'),[visible,setVisible]=useState(true),[show,setShow]=useState(true),[disabled,setDisabled]=useState(false),[readOnly,setReadOnly]=useState(false),[changes,setChanges]=useState(0),[passChanges,setPassChanges]=useState(0),[submits,setSubmits]=useState(0),[lang,setLang]=useState('zh-CN'),[authoredType,setAuthoredType]=useState('password'),[step,setStep]=useState<string|number>(0.1)
const style=${style}
return <main lang={lang} style={{padding:12}}><form id="main-form" onSubmit={e=>{e.preventDefault();setSubmits(n=>n+1)}} style={{display:'flex',flexDirection:'column',gap:12}}>{show&&<><label htmlFor="quantity">Quantity</label><Input config={{kind:'number',showStepper:visible,placement}} type="number" id="quantity" data-node-id="quantity-node" name="quantity" aria-label="Quantity" value={value} min={0.1} max={0.4} step={step} required disabled={disabled} readOnly={readOnly} style={style} onChange={e=>{setValue(e.currentTarget.value);setChanges(n=>n+1)}}/><Input config={{kind:'password'}} type={authoredType} name="password" aria-label="Password" value={password} disabled={disabled} readOnly={readOnly} style={style} onChange={e=>{setPassword(e.currentTarget.value);setPassChanges(n=>n+1)}}/></>}<Input config={{kind:'number',showStepper:true,placement:'sides'}} name="free" aria-label="Free number" defaultValue="1.5" min="0" max="3" step="0.5" style={style}/><Input config={{kind:'password'}} name="other" aria-label="Other password" defaultValue="second" style={style}/><button type="reset">Reset</button><button type="submit">Submit</button></form><button onClick={()=>setValue('0.1')}>External</button><button onClick={()=>setDisabled(v=>!v)}>Disabled</button><button onClick={()=>setReadOnly(v=>!v)}>Readonly</button><button onClick={()=>setPlacement(v=>v==='end'?'sides':'end')}>Placement</button><button onClick={()=>setVisible(v=>!v)}>Controls</button><button onClick={()=>setShow(v=>!v)}>Mount</button><button onClick={()=>setLang(v=>v==='zh-CN'?'en':'zh-CN')}>Language</button><button onClick={()=>setAuthoredType(v=>v==='password'?'text':'password')}>Type</button><button onClick={()=>setStep(v=>v==='any'?0.1:'any')}>Step any</button><Input config={{kind:'password'}} aria-label="Styled password" placeholder="占位文字" className={${JSON.stringify(styledClasses)}} disabled={disabled}/><output>Value[{value}] Changes[{changes}] Password changes[{passChanges}] Submit[{submits}]</output></main>}
`
  return `<script setup lang="ts">
import {ref} from 'vue'
import Input from './components/open-pencil/OpenPencilInputControl.vue'
const value=ref('0.2'),password=ref('初始密码'),placement=ref<'end'|'sides'>('end'),visible=ref(true),show=ref(true),disabled=ref(false),readOnly=ref(false),changes=ref(0),passChanges=ref(0),submits=ref(0),lang=ref('zh-CN'),authoredType=ref('password'),step=ref<string|number>(0.1),style=${style}
function change(event:Event){value.value=(event.target as HTMLInputElement).value;changes.value++}
function passwordChange(event:Event){password.value=(event.target as HTMLInputElement).value;passChanges.value++}
</script><template><main :lang="lang" style="padding:12px"><form id="main-form" @submit.prevent="submits++" style="display:flex;flex-direction:column;gap:12px"><template v-if="show"><label for="quantity">Quantity</label><Input :config="{kind:'number',showStepper:visible,placement}" type="number" id="quantity" data-node-id="quantity-node" name="quantity" aria-label="Quantity" :value="value" :min="0.1" :max="0.4" :step="step" required :disabled="disabled" :readonly="readOnly" :style="style" @input="change"/><Input :config="{kind:'password'}" :type="authoredType" name="password" aria-label="Password" :value="password" :disabled="disabled" :readonly="readOnly" :style="style" @input="passwordChange"/></template><Input :config="{kind:'number',showStepper:true,placement:'sides'}" name="free" aria-label="Free number" default-value="1.5" min="0" max="3" step="0.5" :style="style"/><Input :config="{kind:'password'}" name="other" aria-label="Other password" default-value="second" :style="style"/><button type="reset">Reset</button><button type="submit">Submit</button></form><button @click="value='0.1'">External</button><button @click="disabled=!disabled">Disabled</button><button @click="readOnly=!readOnly">Readonly</button><button @click="placement=placement==='end'?'sides':'end'">Placement</button><button @click="visible=!visible">Controls</button><button @click="show=!show">Mount</button><button @click="lang=lang==='zh-CN'?'en':'zh-CN'">Language</button><button @click="authoredType=authoredType==='password'?'text':'password'">Type</button><button @click="step=step==='any'?0.1:'any'">Step any</button><Input :config="{kind:'password'}" aria-label="Styled password" placeholder="占位文字" class="${styledClasses}" :disabled="disabled"/><output>Value[{{value}}] Changes[{{changes}}] Password changes[{{passChanges}}] Submit[{{submits}}]</output></main></template>
`
}
