import { describe, expect, test } from 'bun:test'

import { compile, withDefaults } from '#compiler/index'
import { compileScript, compileTemplate, parse } from 'vue/compiler-sfc'

import { SceneGraph } from '@open-pencil/scene-graph'

import { createCarouselModuleFrameOverrides } from '#core/plugins/carousel'

function output(target: 'react' | 'vue', devMode = true) {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  graph.createNode('FRAME', pageId, {
    ...createCarouselModuleFrameOverrides({
      slides: [
        {
          title: 'First',
          description: '<script>text</script>',
          imageUrl: 'https://media.example.com/first.png',
          alt: 'First image',
          href: '/first'
        },
        { title: 'Second', description: 'Details', imageUrl: '', alt: '', href: '#second' }
      ],
      autoplay: true
    }),
    x: 40,
    y: 60,
    width: 420,
    height: 280
  })
  return compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({ target, devMode, router: 'none' })
  })
}

function textFile(files: ReadonlyMap<string, string | Uint8Array>, path: string) {
  const source = files.get(path)
  if (typeof source !== 'string') throw new Error(`Missing generated file: ${path}`)
  return source
}

describe('carousel web target parity', () => {
  test.each(['react', 'vue'] as const)(
    '%s registers a real runtime and gates preview remote media',
    (target) => {
      const result = output(target)
      expect(result.warnings.filter((warning) => warning.code.includes('carousel'))).toEqual([])
      const path = `src/__openpencil_carousel.${target === 'react' ? 'tsx' : 'vue'}`
      const source = textFile(result.files, path)
      expect(source).toContain('const REMOTE_MEDIA_ENABLED_BY_DEFAULT = false')
      expect(source).toContain('Load remote slide media')
      expect(source).toContain('data-openpencil-carousel-arrows')
      expect(source).toContain('data-openpencil-carousel-dots')
      expect(source).not.toContain('dangerouslySetInnerHTML')
      expect(source).not.toContain('v-html')
      const production = textFile(output(target, false).files, path)
      expect(production).toContain('const REMOTE_MEDIA_ENABLED_BY_DEFAULT = true')
      if (target === 'react') {
        expect(() => new Bun.Transpiler({ loader: 'tsx' }).transformSync(source)).not.toThrow()
      } else {
        const parsed = parse(source, { filename: path })
        expect(parsed.errors).toEqual([])
        const script = compileScript(parsed.descriptor, { id: 'carousel' })
        expect(() =>
          new Bun.Transpiler({ loader: 'ts' }).transformSync(script.content)
        ).not.toThrow()
        const template = parsed.descriptor.template
        if (!template) throw new Error('Missing carousel template')
        expect(
          compileTemplate({ id: 'carousel', filename: path, source: template.content }).errors
        ).toEqual([])
      }
    }
  )
})
