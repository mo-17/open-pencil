import { compile, withDefaults } from '@open-pencil/compiler'
import {
  createTimelineModuleFrameOverrides,
  createTimelineModuleInstance
} from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

export function timelineFixture(target: 'react' | 'vue', lifecycle = false) {
  const graph = new SceneGraph(),
    page = graph.getPages()[0]
  graph.createNode('FRAME', page.id, {
    ...createTimelineModuleFrameOverrides({
      label: '项目时间线',
      layout: 'alternate',
      items: [
        {
          id: 'created',
          title: '已创建',
          description: '示例资料已整理。',
          time: '09:00',
          status: 'completed'
        },
        {
          id: 'review',
          title: '正在审核',
          description:
            '这是一段需要换行的中文与 English description，说明不会与后续事件重叠。'.repeat(3),
          time: '10:30',
          status: 'current'
        },
        {
          id: 'issue',
          title: '需要补充',
          description: '补充资料后继续。',
          time: '',
          status: 'error'
        },
        { id: 'next', title: '<b>下一项</b>', description: '', time: '', status: 'pending' }
      ]
    }),
    x: 20,
    y: 20,
    width: 640,
    height: 640
  })
  const result = compile({
    graph,
    pageIds: [page.id],
    options: withDefaults({ target, router: 'none', devMode: false })
  })
  if (lifecycle) addLifecycle(result.files, target)
  return result
}

function addLifecycle(files: Map<string, string | Uint8Array>, target: 'react' | 'vue') {
  const config = JSON.stringify(
    createTimelineModuleInstance({ label: 'Editable timeline', layout: 'alternate' }).config
  )
  if (target === 'react')
    files.set(
      'src/App.tsx',
      `import {useState} from 'react'
import Timeline,{type OpenPencilTimelineConfig} from './__openpencil_timeline'
const base:OpenPencilTimelineConfig=${config}
export default function App(){const [config,setConfig]=useState(base),[lang,setLang]=useState('en')
return <><button type="button" onClick={()=>setConfig({...config,items:[...config.items].reverse()})}>Reverse events</button>
<button type="button" onClick={()=>setConfig({...base,items:[]})}>Empty events</button>
<button type="button" onClick={()=>setConfig({...base,items:base.items.map(item=>item.id==='created'?{...item,title:'Updated title',status:'error'}:item)})}>Replace config</button>
<button type="button" onClick={()=>setLang('zh-CN')}>Chinese labels</button>
<Timeline lang={lang} config={config} style={{width:'min(640px, calc(100vw - 40px))',height:640,margin:20}}/>
<Timeline config={base} style={{width:280,height:340,margin:20}}/></>}`
    )
  else
    files.set(
      'src/App.vue',
      `<script setup lang="ts">
import {ref} from 'vue'
import Timeline,{type OpenPencilTimelineConfig} from './__openpencil_timeline.vue'
const base:OpenPencilTimelineConfig=${config}
const config=ref(base),lang=ref('en')
function replace(){config.value={...base,items:base.items.map(item=>item.id==='created'?{...item,title:'Updated title',status:'error'}:item)}}
</script><template><button type="button" @click="config={...config,items:[...config.items].reverse()}">Reverse events</button>
<button type="button" @click="config={...base,items:[]}">Empty events</button>
<button type="button" @click="replace">Replace config</button>
<button type="button" @click="lang='zh-CN'">Chinese labels</button>
<Timeline :lang="lang" :config="config" style="width:min(640px, calc(100vw - 40px));height:640px;margin:20px"/>
<Timeline :config="base" style="width:280px;height:340px;margin:20px"/>
</template>`
    )
}
