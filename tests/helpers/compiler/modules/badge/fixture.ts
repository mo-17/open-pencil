import { compile, withDefaults } from '@open-pencil/compiler'
import {
  createBadgeModuleFrameOverrides,
  createBadgeModuleInstance
} from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

export function badgeFixture(target: 'react' | 'vue', dynamic = false) {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const configs = [
    { hostLabel: '隐藏零值', count: 0 },
    { hostLabel: '显示零值', count: 0, showZero: true, placement: 'top-left' },
    { hostLabel: '消息', label: '消息数', count: 120 },
    {
      hostLabel: '<b>纯文本</b>',
      label: '<i>数量</i>',
      count: 44,
      max: 9,
      size: 'large',
      placement: 'bottom-right',
      hostBackground: '#DBEAFE',
      badgeColor: '#1D4ED8'
    },
    {
      hostLabel: '装饰圆点',
      label: '不可作为状态读出',
      mode: 'dot',
      count: 999_999_999,
      size: 'small',
      placement: 'bottom-left'
    },
    {
      hostLabel: '较窄的容器',
      label: '数量',
      count: 999_999_999,
      max: 999_999,
      size: 'large',
      placement: 'top-left'
    }
  ]
  configs.forEach((config, index) =>
    graph.createNode('FRAME', pageId, {
      ...createBadgeModuleFrameOverrides(config),
      x: 24 + (index % 2) * 200,
      y: 24 + Math.floor(index / 2) * 120,
      width: index === 5 ? 100 : 160,
      height: index === 5 ? 100 : 80
    })
  )
  const result = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ target, router: 'none', devMode: false })
  })
  if (dynamic) addDynamicBadge(result.files, target)
  return result
}

function addDynamicBadge(files: Map<string, string | Uint8Array>, target: 'react' | 'vue') {
  const base = JSON.stringify(
    createBadgeModuleInstance({ hostLabel: '消息', label: '消息数', count: 120 }).config
  )
  if (target === 'react')
    files.set(
      'src/App.tsx',
      `import {useState} from 'react'
import Badge,{type OpenPencilBadgeConfig} from './__openpencil_badge'
const base:OpenPencilBadgeConfig=${base}
export default function App(){const [config,setConfig]=useState(base)
 return <main><button type="button" onClick={()=>setConfig({...config,count:0})}>Zero</button>
 <button type="button" onClick={()=>setConfig({...config,showZero:!config.showZero})}>Show zero</button>
 <button type="button" onClick={()=>setConfig({...config,count:999,max:9})}>Overflow</button>
 <button type="button" onClick={()=>setConfig({...config,mode:config.mode==='count'?'dot':'count'})}>Toggle dot</button>
 <button type="button" onClick={()=>setConfig({...config,placement:'bottom-left',size:'large',badgeColor:'#15803D',hostBackground:'#F0FDF4'})}>Restyle</button>
 <section aria-label="Current badge"><Badge config={config} style={{width:160,height:80}}/></section>
 <section aria-label="Other badge"><Badge config={base} style={{width:160,height:80}}/></section>
 </main>}
`
    )
  else
    files.set(
      'src/App.vue',
      `<script setup lang="ts">
import {ref} from 'vue'
import Badge,{type OpenPencilBadgeConfig} from './__openpencil_badge.vue'
const base:OpenPencilBadgeConfig=${base}
const config=ref({...base})
</script><template><main><button type="button" @click="config.count=0">Zero</button>
<button type="button" @click="config.showZero=!config.showZero">Show zero</button>
<button type="button" @click="config.count=999;config.max=9">Overflow</button>
<button type="button" @click="config.mode=config.mode==='count'?'dot':'count'">Toggle dot</button>
<button type="button" @click="config.placement='bottom-left';config.size='large';config.badgeColor='#15803D';config.hostBackground='#F0FDF4'">Restyle</button>
<section aria-label="Current badge"><Badge :config="config" style="width:160px;height:80px"/></section>
<section aria-label="Other badge"><Badge :config="base" style="width:160px;height:80px"/></section>
</main></template>`
    )
}
