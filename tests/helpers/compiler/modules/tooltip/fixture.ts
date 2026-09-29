import { compile, withDefaults } from '@open-pencil/compiler'
import {
  createTooltipModuleFrameOverrides,
  createTooltipModuleInstance
} from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

export function tooltipFixture(target: 'react' | 'vue', dynamic = false) {
  const graph = new SceneGraph(),
    pageId = graph.getPages()[0].id
  for (const [index, placement] of ['top', 'right', 'bottom', 'left'].entries())
    graph.createNode('FRAME', pageId, {
      ...createTooltipModuleFrameOverrides({
        triggerLabel: placement + ' 说明',
        content: '<b>此处是纯文本说明</b>',
        placement,
        openDelay: 100,
        closeDelay: 120
      }),
      x: 24 + (index % 2) * 230,
      y: 24 + Math.floor(index / 2) * 160
    })
  const result = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ target, router: 'none', devMode: false })
  })
  if (dynamic) addDynamicFixture(result.files, target)
  return result
}
function addDynamicFixture(files: Map<string, string | Uint8Array>, target: 'react' | 'vue') {
  const config = JSON.stringify(
    createTooltipModuleInstance({
      triggerLabel: 'Help',
      content: 'First help',
      openDelay: 200,
      closeDelay: 100,
      maxWidth: 160
    }).config
  )
  if (target === 'react')
    files.set(
      'src/App.tsx',
      `import {useState} from 'react'
import Tooltip,{type OpenPencilTooltipConfig} from './__openpencil_tooltip'
const initial:OpenPencilTooltipConfig=${config}
export default function App(){const [config,setConfig]=useState(initial),[show,setShow]=useState(true),[value,setValue]=useState('')
return <main style={{padding:16,minHeight:1200}}><button onClick={()=>setConfig({...config,content:'Updated help',placement:'bottom'})}>Update</button><button onClick={()=>setShow(!show)}>Toggle component</button><button>Outside</button><button onClick={()=>setConfig({...config,openDelay:1000})}>Slow hover</button><input aria-label="Business input" value={value} onChange={event=>setValue(event.target.value)}/><input aria-label="Help content" value={config.content} onChange={event=>setConfig({...config,content:event.target.value})}/>
<section aria-label="Current tooltip" style={{marginTop:100,overflow:'hidden',transform:'translateZ(0)'}}>{show&&<Tooltip config={{...config}} style={{width:180,height:44}}/>}</section>
<section aria-label="Other tooltip" style={{marginTop:100}}><Tooltip config={{...initial,triggerLabel:'Other help'}} style={{width:180,height:44}}/></section></main>}
`
    )
  else
    files.set(
      'src/App.vue',
      `<script setup lang="ts">
import {ref} from 'vue'
import Tooltip,{type OpenPencilTooltipConfig} from './__openpencil_tooltip.vue'
const initial:OpenPencilTooltipConfig=${config}
const config=ref({...initial}),show=ref(true),value=ref('')
</script><template><main style="padding:16px;min-height:1200px"><button @click="config={...config,content:'Updated help',placement:'bottom'}">Update</button><button @click="show=!show">Toggle component</button><button>Outside</button><button @click="config={...config,openDelay:1000}">Slow hover</button><input aria-label="Business input" v-model="value"/><input aria-label="Help content" v-model="config.content"/>
<section aria-label="Current tooltip" style="margin-top:100px;overflow:hidden;transform:translateZ(0)"><Tooltip v-if="show" :config="{...config}" style="width:180px;height:44px"/></section>
<section aria-label="Other tooltip" style="margin-top:100px"><Tooltip :config="{...initial,triggerLabel:'Other help'}" style="width:180px;height:44px"/></section></main></template>`
    )
}
