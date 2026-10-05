import { toUint8Array } from 'js-base64'

import { createCodePenStaticShowcase } from '@open-pencil/compiler/codepen/static'
import { serializeHTML } from '@open-pencil/dom-css/export'
import { sceneGraphToDesignDocument } from '@open-pencil/dom-css/static-export'
import { SceneGraph } from '@open-pencil/scene-graph'

/** One authored button through the two public browser export boundaries. */
export function staticButtonExports(disabled: boolean, imageScaleMode?: 'FIT' | 'FILL') {
  const graph = new SceneGraph(),
    page = graph.getPages()[0],
    label = 'Continue <review> & save'
  if (imageScaleMode)
    graph.images.set(
      'button-image',
      toUint8Array(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
      )
    )
  graph.createNode('BUTTON', page.id, {
    width: 140,
    height: 40,
    interactiveProps: { text: label, disabled },
    ...(imageScaleMode
      ? {
          fills: [
            {
              type: 'IMAGE' as const,
              imageHash: 'button-image',
              imageScaleMode,
              color: { r: 0, g: 0, b: 0, a: 1 },
              opacity: 1,
              visible: true
            }
          ]
        }
      : {}),
    events: { onClick: [{ id: 'next', kind: 'navigate', to: '/saved' }] }
  })
  const nativeHTML = serializeHTML(sceneGraphToDesignDocument(graph, { rootId: page.id })),
    staticResult = createCodePenStaticShowcase({ graph, pageId: page.id })
  return {
    nativeHTML,
    staticHTML: staticResult.html,
    css: staticResult.css,
    js: staticResult.js,
    compatible: staticResult.compatible,
    label
  }
}
