import { compile, withDefaults } from '@open-pencil/compiler'
import { createVRTourModuleInstance } from '@open-pencil/core/plugins'
import type { BindingExpr, ModuleInstanceV1 } from '@open-pencil/scene-graph'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

export function tourFixture(binding?: BindingExpr) {
  const graph = makeSceneGraph('Tour')
  const pageId = firstPageId(graph)
  graph.updateNode(graph.rootId, {
    lowcodeDocumentState: [
      {
        id: 'selected-property',
        name: 'selectedProperty',
        type: 'object',
        defaultValue: { panorama_url: '/assets/vr-tour/room.png' }
      }
    ]
  })
  const instance = createVRTourModuleInstance()
  const config = instance.config
  const scenes = config.scenes as Array<Record<string, unknown>>
  const module: ModuleInstanceV1 = {
    ...instance,
    config: {
      ...config,
      scenes: scenes.map((scene) => ({
        ...scene,
        panoramaUrl: '/assets/vr-tour/' + String(scene.id) + '.png'
      }))
    }
  }
  const node = graph.createNode('FRAME', pageId, {
    width: 720,
    height: 480,
    interactiveProps: { module },
    ...(binding ? { bindings: { panoramaUrl: binding } } : {})
  })
  return { graph, pageId, node, module }
}

export function compileTour(target: 'react' | 'vue', binding?: BindingExpr, devMode = false) {
  const { graph, pageId } = tourFixture(binding)
  return compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ target, packageName: 'vr-tour-proof', devMode })
  })
}

export function runtimeFiles(target: 'react' | 'vue', realHouse = false, locale = 'en') {
  const files = compileTour(target).files
  const config = structuredClone(tourFixture().module.config)
  config.locale = locale
  if (realHouse) {
    config.label = 'Independent residential samples · Poly Haven / Greg Zaal / CC0'
    const scenes = config.scenes as Array<Record<string, unknown>>
    for (const scene of scenes) {
      const first = scene.id === 'living-room'
      scene.title = first ? 'Cayley Interior (sample A)' : 'Lebombo (sample B)'
      scene.panoramaUrl = '/assets/vr-tour/' + (first ? 'cayley_interior' : 'lebombo') + '.jpg'
      for (const hotspot of scene.hotspots as Array<Record<string, unknown>>) {
        hotspot.label = first ? 'Sample B' : 'Sample A'
      }
    }
  }
  const boundURL = realHouse ? '/assets/vr-tour/cayley_interior.jpg' : '/assets/vr-tour/bound.png'
  const alternateURL = realHouse ? '/assets/vr-tour/lebombo.jpg' : '/assets/vr-tour/alternate.png'
  const root = `<div style="width:720px;height:480px" id="tour"></div>`
  files.set(
    'index.html',
    `<!doctype html><html><body>${root}<script type="module" src="/src/main.${target === 'react' ? 'tsx' : 'ts'}"></script></body></html>`
  )
  if (target === 'react')
    files.set(
      'src/main.tsx',
      `
import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import Tour from './__openpencil_vr_tour'
import './index.css'
function App() {
  const [shown, setShown] = useState(true)
  const [bound, setBound] = useState(false)
  const [url, setURL] = useState<unknown>(${JSON.stringify(boundURL)})
  return <><button onClick={() => setShown(!shown)}>Toggle tour</button><button onClick={() => setBound(true)}>Bind listing</button><button onClick={() => setURL('javascript:alert(1)')}>Invalid listing</button><button onClick={() => setURL(undefined)}>Missing listing</button><button onClick={() => setURL(${JSON.stringify(alternateURL)})}>Alternate listing</button>{shown && <Tour style={{width:720,height:480}} config={${JSON.stringify(config)}} panoramaBound={bound} panoramaUrl={url}/>}</>
}
createRoot(document.getElementById('tour')!).render(<App />)
`
    )
  else
    files.set(
      'src/main.ts',
      `
import { createApp, h, ref } from 'vue'
import Tour from './__openpencil_vr_tour.vue'
import './index.css'
createApp({ setup() {
  const shown = ref(true)
  const bound = ref(false)
  const url = ref<unknown>(${JSON.stringify(boundURL)})
  return () => h('div', [
    h('button', { onClick: () => shown.value = !shown.value }, 'Toggle tour'),
    h('button', { onClick: () => bound.value = true }, 'Bind listing'),
    h('button', { onClick: () => url.value = 'javascript:alert(1)' }, 'Invalid listing'),
    h('button', { onClick: () => url.value = undefined }, 'Missing listing'),
    h('button', { onClick: () => url.value = ${JSON.stringify(alternateURL)} }, 'Alternate listing'),
    shown.value ? h(Tour, { style: { width: '720px', height: '480px' }, config: ${JSON.stringify(config)}, panoramaBound: bound.value, panoramaUrl: url.value }) : null
  ])
}}).mount('#tour')
`
    )
  return files
}
