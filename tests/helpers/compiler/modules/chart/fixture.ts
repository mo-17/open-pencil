import { CHART_COMPILER_MODULE_LOWERER } from '#compiler/modules/chart'

import { compile, withDefaults, type CompilerTarget } from '@open-pencil/compiler'
import { createChartModuleFrameOverrides } from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

export function chartFixture(target: CompilerTarget, updates = false) {
  const graph = new SceneGraph(),
    pageId = graph.getPages()[0].id
  const points = Array.from({ length: 64 }, (_, index) => (index % 2 ? index : -index))
  const samples = [
    ...(['bar', 'line', 'area', 'pie', 'donut'] as const).map((chartType, index) => ({
      config: {
        chartType,
        values: chartType === 'pie' || chartType === 'donut' ? [35, 45, 20] : [32, -12, 46],
        labels: ['设计', '开发', '评审'],
        showValues: true
      },
      width: 320,
      height: 200,
      y: index * 220
    })),
    {
      config: {
        chartType: 'donut',
        values: [0, 0],
        labels: ['尚无甲', '尚无乙'],
        showValues: true
      },
      width: 320,
      height: 160,
      y: 1100
    },
    {
      config: {
        chartType: 'bar',
        values: points,
        labels: points.map((_, index) => '完整类别' + (index + 1)),
        showValues: true
      },
      width: 160,
      height: 160,
      y: 1280
    },
    {
      config: { chartType: 'line', values: [42], labels: ['<b>唯一项</b>'], showValues: true },
      width: 320,
      height: 180,
      y: 1460
    },
    {
      config: { chartType: 'pie', values: [100], labels: ['全部'], showValues: true },
      width: 240,
      height: 80,
      y: 1660
    },
    {
      config: { chartType: 'area', values: [1, 2], labels: ['甲', '乙'] },
      width: 30,
      height: 24,
      y: 1760
    }
  ]
  const payloads = []
  for (const sample of samples) {
    const node = graph.createNode('FRAME', pageId, {
      ...createChartModuleFrameOverrides(sample.config),
      x: 20,
      y: sample.y,
      width: sample.width,
      height: sample.height
    })
    const result = CHART_COMPILER_MODULE_LOWERER.lower(node.interactiveProps?.module, node)
    if (!result.ok) throw new Error(result.reason)
    payloads.push(result.payload)
  }
  const result = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ target, router: 'none', devMode: false })
  })
  const html = result.files.get('index.html')
  if (typeof html === 'string')
    result.files.set('index.html', html.replace(/<html[^>]*>/, '<html lang="zh-CN">'))
  if (updates && (target === 'react' || target === 'vue'))
    addChartUpdates(result.files, target, payloads[0], payloads[4])
  return result
}
function addChartUpdates(
  files: Map<string, string | Uint8Array>,
  target: 'react' | 'vue',
  first: unknown,
  second: unknown
) {
  const one = JSON.stringify(first),
    two = JSON.stringify(second)
  if (target === 'react')
    files.set(
      'src/App.tsx',
      `import {useState} from 'react'
import Chart,{type OpenPencilChartConfig} from './__openpencil_chart'
export default function App(){const [config,setConfig]=useState<OpenPencilChartConfig>(${one}),[language,setLanguage]=useState('zh-CN'),[show,setShow]=useState(true)
return <main lang={language}><button onClick={()=>setConfig(${two})}>Donut</button><button onClick={()=>setLanguage(language==='zh-CN'?'en':'zh-CN')}>Language</button><button onClick={()=>setShow(!show)}>Toggle chart</button>{show&&<Chart config={config} style={{width:320,height:200}}/>}<Chart config={${one}} style={{width:320,height:200}}/></main>}`
    )
  else
    files.set(
      'src/App.vue',
      `<script setup lang="ts">
import {ref} from 'vue'
import Chart,{type OpenPencilChartConfig} from './__openpencil_chart.vue'
const config=ref<OpenPencilChartConfig>(${one}),language=ref('zh-CN'),show=ref(true),unchanged:OpenPencilChartConfig=${one},alternate:OpenPencilChartConfig=${two}
</script><template><main :lang="language"><button @click="config=alternate">Donut</button><button @click="language=language==='zh-CN'?'en':'zh-CN'">Language</button><button @click="show=!show">Toggle chart</button><Chart v-if="show" :config="config" style="width:320px;height:200px"/><Chart :config="unchanged" style="width:320px;height:200px"/></main></template>`
    )
}
