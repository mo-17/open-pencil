import { compile, withDefaults } from '@open-pencil/compiler'
import {
  createUploadButtonModuleFrameOverrides,
  UPLOAD_BUTTON_MODULE_DEFAULT_CONFIG
} from '@open-pencil/core/plugins'
import { SceneGraph } from '@open-pencil/scene-graph'

export type UploadScenario =
  | 'single'
  | 'multiple'
  | 'hidden'
  | 'disabled'
  | 'non-boolean-disabled'
  | 'document-disabled'
  | 'static-disabled'

export function localUploadFixture(target: 'react' | 'vue', scenario: UploadScenario) {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const config = {
    ...UPLOAD_BUTTON_MODULE_DEFAULT_CONFIG,
    triggerLabel: 'Choose local files',
    accept: ['.txt'],
    maxFileBytes: 8,
    multiple: scenario !== 'single',
    maxFiles: scenario === 'single' ? 1 : 3,
    showFileList: scenario !== 'hidden'
  }
  const frame = graph.createNode('FRAME', pageId, {
    ...createUploadButtonModuleFrameOverrides(config),
    width: 280,
    x: 24,
    y: 80
  })
  if (scenario === 'disabled' || scenario === 'document-disabled') {
    const state = [
      { id: 'upload-lock', name: 'locked', type: 'boolean' as const, defaultValue: false }
    ]
    if (scenario === 'document-disabled')
      graph.updateNode(graph.rootId, { lowcodeDocumentState: state })
    else graph.updateNode(pageId, { state })
    graph.updateNode(frame.id, { bindings: { disabled: { kind: 'expr', expr: 'locked' } } })
    for (const [index, locked] of [true, false].entries()) {
      graph.createNode('BUTTON', pageId, {
        x: 600,
        y: 80 + index * 60,
        width: 200,
        height: 44,
        interactiveProps: { text: locked ? 'Disable selection' : 'Enable selection' },
        events: {
          onClick: [
            {
              id: `upload-toggle-${index}`,
              ...(scenario === 'document-disabled'
                ? { kind: 'setVariable' as const, targetName: 'locked' }
                : { kind: 'setState' as const, targetStateId: 'upload-lock' }),
              valueExpr: locked ? '!!1' : '!1'
            }
          ]
        }
      })
    }
  } else if (scenario === 'non-boolean-disabled') {
    graph.updateNode(frame.id, { bindings: { disabled: { kind: 'expr', expr: '"false"' } } })
  } else if (scenario === 'static-disabled') {
    graph.updateNode(frame.id, { interactiveProps: { ...frame.interactiveProps, disabled: true } })
  }
  return compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ target, packageName: 'local-upload-regression', devMode: false })
  })
}
