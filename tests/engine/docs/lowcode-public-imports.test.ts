import { expect, test } from 'bun:test'
import { join } from 'node:path'

import { repoPath } from '#tests/helpers/paths'

const DOC_ROOTS = ['docs', 'packages/docs']

const REMOVED_SCENE_GRAPH_PATHS = [
  '@open-pencil/core/scene-graph',
  '@open-pencil/core/geometry',
  '@open-pencil/core/types',
  '@open-pencil/core/snap',
  '@open-pencil/core/undo',
  '#core/scene-graph',
  'packages/core/src/scene-graph'
]

test('docs do not recommend removed SceneGraph package or source paths', async () => {
  const deprecatedReferences: string[] = []

  for (const docsRoot of DOC_ROOTS) {
    const absoluteRoot = repoPath(docsRoot)
    for await (const relativePath of new Bun.Glob('**/*.md').scan({ cwd: absoluteRoot })) {
      const lines = (await Bun.file(join(absoluteRoot, relativePath)).text()).split('\n')
      for (const [index, line] of lines.entries()) {
        if (REMOVED_SCENE_GRAPH_PATHS.some((removedPath) => line.includes(removedPath))) {
          deprecatedReferences.push(`${docsRoot}/${relativePath}:${index + 1}`)
        }
      }
    }
  }

  expect(deprecatedReferences).toEqual([])
})
