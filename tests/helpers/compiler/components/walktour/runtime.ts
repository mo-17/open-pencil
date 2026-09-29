import { WALKTOUR_MODULE_DEFAULT_CONFIG } from '@open-pencil/core/plugins'

import { walktourFixture } from './fixture'

export function walktourRuntimeFixture(target: 'react' | 'vue') {
  const result = walktourFixture(target),
    files = new Map(result.files)
  const base = JSON.stringify({
    ...WALKTOUR_MODULE_DEFAULT_CONFIG,
    triggerLabel: 'Start main',
    steps: [
      {
        id: 'alpha',
        title: 'Alpha guide',
        content: 'Helpful local text. <script> remains text.',
        targetChildName: 'Alpha',
        placement: 'right'
      },
      {
        id: 'missing',
        title: 'Unavailable guide',
        content: 'Continue even without a target.',
        targetChildName: 'Missing',
        placement: 'top'
      },
      {
        id: 'overview',
        title: 'Finish guide',
        content: 'No account or business change.',
        targetChildName: '',
        placement: 'bottom'
      }
    ]
  })
  const source =
    target === 'react'
      ? `import {useState} from 'react'
import Walktour,{type OpenPencilWalktourConfig} from './__openpencil_walktour'
export default function App(){
 const [config,setConfig]=useState<OpenPencilWalktourConfig>(${base}),[shown,setShown]=useState(true),[hidden,setHidden]=useState(false),[lang,setLang]=useState('en'),[clicks,setClicks]=useState(0),[submits,setSubmits]=useState(0)
 const style={width:'320px',height:'270px',maxWidth:'100%'}
 function panels(){return {'target-alpha':<><div data-example-target="one" style={{position:'absolute',left:16,top:70,width:220,height:45,display:hidden?'none':undefined}}>Alpha target</div><div data-example-target="two" style={{position:'absolute',left:26,top:125,width:230,height:45,display:hidden?'none':undefined}}>Second root</div></>,'extra-0':<div style={{position:'absolute',left:16,top:190}}>Unmapped example</div>}}
 return <main lang={lang} style={{padding:12}}><div style={{transform:'translateZ(0)',overflow:'hidden',height:290}}><form onClick={()=>setClicks(value=>value+1)} onSubmit={event=>{event.preventDefault();setSubmits(value=>value+1)}}>{shown&&<Walktour config={config} panels={panels()} style={style}/>}</form></div><Walktour config={{...config,triggerLabel:'Start other'}} panels={panels()} style={style}/><button type="button" onClick={()=>setHidden(value=>!value)}>Hide targets</button><button type="button" onClick={()=>setConfig(value=>({...value,panelWidth:value.panelWidth===320?240:320}))}>Reconfigure</button><button type="button" onClick={()=>setConfig(value=>({...value,disabled:!value.disabled}))}>Disable</button><button type="button" onClick={()=>setLang(value=>value==='en'?'zh-CN':'en')}>Language</button><button type="button" onClick={()=>setShown(value=>!value)}>Mount</button><output>Clicks[{clicks}] Submits[{submits}]</output></main>
}`
      : `<script setup lang="ts">
import {ref} from 'vue'
import Walktour,{type OpenPencilWalktourConfig} from './__openpencil_walktour.vue'
const config=ref<OpenPencilWalktourConfig>(${base}),shown=ref(true),hidden=ref(false),lang=ref('en'),clicks=ref(0),submits=ref(0),style={width:'320px',height:'270px',maxWidth:'100%'}
</script><template><main :lang="lang" style="padding:12px"><div style="transform:translateZ(0);overflow:hidden;height:290px"><form @click="clicks++" @submit.prevent="submits++"><Walktour v-if="shown" :config="config" :style="style"><template #target-alpha><div data-example-target="one" :style="{position:'absolute',left:'16px',top:'70px',width:'220px',height:'45px',display:hidden?'none':undefined}">Alpha target</div><div data-example-target="two" :style="{position:'absolute',left:'26px',top:'125px',width:'230px',height:'45px',display:hidden?'none':undefined}">Second root</div></template><template #extra-0><div style="position:absolute;left:16px;top:190px">Unmapped example</div></template></Walktour></form></div><Walktour :config="{...config,triggerLabel:'Start other'}" :style="style"><template #target-alpha><div style="position:absolute;left:16px;top:70px;width:220px;height:100px">Other target</div></template></Walktour><button type="button" @click="hidden=!hidden">Hide targets</button><button type="button" @click="config={...config,panelWidth:config.panelWidth===320?240:320}">Reconfigure</button><button type="button" @click="config={...config,disabled:!config.disabled}">Disable</button><button type="button" @click="lang=lang==='en'?'zh-CN':'en'">Language</button><button type="button" @click="shown=!shown">Mount</button><output>Clicks[{{clicks}}] Submits[{{submits}}]</output></main></template>`
  files.set(target === 'react' ? 'src/App.tsx' : 'src/App.vue', source)
  return { files, warnings: result.warnings }
}
