import { compile, withDefaults } from '@open-pencil/compiler'
import {
  createMapModuleFrameOverrides,
  createMapModuleInstance,
  createPDFViewerModuleFrameOverrides,
  createPDFViewerModuleInstance
} from '@open-pencil/core/plugins'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

export type MapPDFFixtureKind = 'map' | 'pdf'

export function mapPDFFixture(kind: MapPDFFixtureKind, devMode = false, lifecycle = false) {
  const graph = makeSceneGraph()
  const pageId = firstPageId(graph)
  const config =
    kind === 'map'
      ? createMapModuleInstance({
          center: [121.47, 31.23],
          zoom: 6,
          markers: [{ id: 'venue', lng: 121.47, lat: 31.23, label: '<b>Plain venue</b>' }]
        }).config
      : createPDFViewerModuleInstance({
          sourceUrl: '/fixtures/initial.pdf',
          title: '<b>Plain document</b>',
          initialPage: 2,
          pageCountHint: 4,
          allowDownload: true
        }).config
  const frame = graph.createNode('FRAME', pageId, {
    ...(kind === 'map'
      ? createMapModuleFrameOverrides(config)
      : createPDFViewerModuleFrameOverrides(config)),
    width: 520,
    height: 360
  })
  graph.createNode('TEXT', frame.id, { text: 'Authored overlay', x: 16, y: 16 })
  const output = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ target: 'vue', devMode, router: 'none', packageName: 'map-pdf-vue' })
  })
  if (lifecycle) {
    const component = kind === 'map' ? 'Map' : 'PDF'
    const filename = kind === 'map' ? '__openpencil_map' : '__openpencil_pdf_viewer'
    const configType = kind === 'map' ? 'OpenPencilMapConfig' : 'OpenPencilPdfViewerConfig'
    const replacement =
      kind === 'map'
        ? "{...base,style:'dark',interactive:false,markers:[{id:'replacement',lng:0,lat:0,label:'Replacement venue'}]}"
        : "{...base,sourceUrl:'/fixtures/alternate.pdf',fit:'page',showToolbar:false}"
    output.files.set(
      'src/App.vue',
      `<script setup lang="ts">
import {ref} from 'vue'
import ${component},{type ${configType}} from './${filename}.vue'
const base:${configType}=${JSON.stringify(config)}
const config=ref(base), mounted=ref(true), revision=ref(0)
</script><template>
<button type="button" @click="config={...base}">Equal config</button>
<button type="button" @click="config=${replacement}">Replace config</button>
<button type="button" @click="config={...base}">Restore config</button>
<button type="button" @click="mounted=!mounted">Toggle module</button>
<button type="button" @click="revision++">Rerender host</button>
<p>Host revision: {{revision}}</p>
<${component} v-if="mounted" :config="config" style="height:360px;width:min(520px,100vw)"><span style="position:relative">Authored overlay</span></${component}>
</template>`
    )
  }
  return output
}
