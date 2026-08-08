import { expect, spyOn, test } from 'bun:test'

import { createEditor } from '@open-pencil/core/editor'
import { fontManager } from '@open-pencil/core/text'
import { SceneGraph } from '@open-pencil/scene-graph'

import { repoPath } from '#tests/helpers/paths'

test('completion waits for fallback discovered after an authored face loads', async () => {
  const graph = new SceneGraph()
  const page = graph.getPages()[0]
  const family = `Bebas Neue coverage progress ${Date.now()}`
  graph.createNode('TEXT', page.id, {
    text: '惊悚乐园',
    fontFamily: family
  })
  const fontData = await Bun.file(repoPath('public/Inter-Regular.ttf')).arrayBuffer()
  const faceLoad = Promise.withResolvers<ArrayBuffer>()
  const fallbackLoad =
    Promise.withResolvers<Awaited<ReturnType<typeof fontManager.ensureFallbackPack>>>()
  type FallbackScripts = NonNullable<Parameters<typeof fontManager.ensureFallbackPack>[0]>
  const fallbackStarted = Promise.withResolvers<FallbackScripts>()
  const fallbackSpy = spyOn(fontManager, 'ensureFallbackPack').mockImplementation(
    async (scripts) => {
      fallbackStarted.resolve(scripts)
      return fallbackLoad.promise
    }
  )

  try {
    const editor = createEditor({
      graph,
      loadFont: async (requestedFamily) => {
        if (requestedFamily !== family) return null
        const data = await faceLoad.promise
        fontManager.markLoaded(family, 'Regular', data)
        return data
      },
      skipInitialGraphSetup: true
    })
    const started = Promise.withResolvers<undefined>()
    const completed = Promise.withResolvers<undefined>()
    const progress: Array<{ completed: number; total: number; status: string }> = []
    editor.onEditorEvent('font:load-progress', (event) => {
      progress.push(event)
      if (event.completed === 0) started.resolve(undefined)
      if (event.status === 'completed') completed.resolve(undefined)
    })

    await editor.switchPage(page.id)
    await started.promise
    expect(progress.at(-1)).toMatchObject({ completed: 0, total: 2, status: 'loading' })

    faceLoad.resolve(fontData)
    const scripts = await fallbackStarted.promise
    expect(scripts).toEqual(['cjk-sc'])
    expect(progress.at(-1)).toMatchObject({ completed: 1, total: 2, status: 'loading' })

    await Promise.resolve()
    expect(progress.some((event) => event.status === 'completed')).toBe(false)

    fallbackLoad.resolve({ 'cjk-sc': ['Test CJK fallback'] })
    await completed.promise
    expect(progress.at(-1)).toMatchObject({ completed: 2, total: 2, status: 'completed' })
    expect(fallbackSpy).toHaveBeenCalledTimes(1)
  } finally {
    fallbackSpy.mockRestore()
  }
})
