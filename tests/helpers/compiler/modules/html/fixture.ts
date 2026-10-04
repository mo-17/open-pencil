import { vueAdapter } from '#compiler/adapters/vue'

import { withDefaults } from '@open-pencil/compiler'
import { collectTree } from '@open-pencil/compiler/ir/collect/tree'
import { createHTMLModuleFrameOverrides } from '@open-pencil/core/plugins'

import { firstPageId, makeSceneGraph } from '#tests/helpers/scene'

export const HTML_SANDBOX_PROBE = `<style>body{margin:0;padding:16px;color:#172554;font:18px system-ui}strong{color:#dc2626}</style>
<main><h1>隔离 HTML</h1><strong>Sandbox content</strong><p>内联样式和语义结构。</p></main>
<script>parent.__htmlEscaped = true;fetch('https://blocked.openpencil.invalid/script');</script>
<img src="https://blocked.openpencil.invalid/image" onerror="parent.__htmlEscaped=true">
<style>body{background-image:url('https://blocked.openpencil.invalid/css')}</style>
<iframe src="https://blocked.openpencil.invalid/frame"></iframe>
<form action="https://blocked.openpencil.invalid/form"><button>Submit</button></form>
<a href="https://blocked.openpencil.invalid/link" target="_top">Navigate</a>
<meta http-equiv="refresh" content="0;url=https://blocked.openpencil.invalid/refresh">
<meta http-equiv="Content-Security-Policy" content="default-src *;script-src 'unsafe-inline'">
<script>parent.__htmlEscaped=true</script>`

export function vueHTMLFixture(html = HTML_SANDBOX_PROBE) {
  const graph = makeSceneGraph('Vue HTML sandbox')
  const pageId = firstPageId(graph)
  const frame = graph.createNode('FRAME', pageId, {
    ...createHTMLModuleFrameOverrides({ html }),
    x: 16,
    y: 16,
    width: 600,
    height: 300
  })
  graph.createNode('TEXT', frame.id, {
    text: 'Host overlay',
    x: 16,
    y: 250,
    width: 300,
    height: 32
  })
  return vueAdapter.emit(
    [collectTree(graph, pageId)],
    withDefaults({ target: 'vue', router: 'none', devMode: false }),
    []
  )
}
