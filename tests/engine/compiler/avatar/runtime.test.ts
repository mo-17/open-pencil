import { expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'

import {
  avatarFixture,
  avatarGraph,
  AVATAR_PNG
} from '#tests/helpers/compiler/modules/avatar/fixture'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

for (const target of ['react', 'vue'] as const)
  test(`${target} Avatar exports the same local bytes and type-correct accessible runtime`, () => {
    const result = avatarFixture(target)
    expect(result.warnings).toEqual([])
    const file = 'src/assets/openpencil-image-avatar-fixture.png'
    expect(result.files.get(file)).toEqual(AVATAR_PNG)
    const runtime = result.files.get(
      `src/__openpencil_avatar.${target === 'react' ? 'tsx' : 'vue'}`
    )
    expect(typeof runtime).toBe('string')
    expect(runtime).toContain('./assets/openpencil-image-avatar-fixture.png')
    const files = new Map<string, string>()
    for (const [path, content] of result.files)
      if (typeof content === 'string') files.set(path, content)
    expect(() => typeCheckCompilerFiles(files, target)).not.toThrow()
  }, 35000)
test('missing and unsupported avatar assets fall back with specific diagnostics and no URL import', () => {
  for (const kind of ['missing', 'svg'] as const) {
    const { graph, pageId } = avatarGraph()
    if (kind === 'missing') graph.images.delete('avatar-fixture')
    else
      graph.images.set(
        'avatar-fixture',
        new TextEncoder().encode('<svg><image href="https://example.com/no"/></svg>')
      )
    const result = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ target: 'react', router: 'none' })
    })
    expect(
      result.warnings.some(
        (w) =>
          w.code ===
          (kind === 'missing' ? 'image-fill-missing-asset' : 'avatar-image-format-unsupported')
      )
    ).toBe(true)
    expect(result.files.get('src/__openpencil_avatar.tsx')).not.toContain('.svg')
  }
})
test.each(['expo', 'flutter', 'wechat-miniprogram'] as const)(
  '%s Avatar does not claim a native image runtime',
  (target) => {
    const result = avatarFixture(target)
    expect(result.warnings.some((w) => w.code.includes('unsupported'))).toBe(true)
    expect([...result.files.keys()].some((path) => path.includes('__openpencil_avatar'))).toBe(
      false
    )
  }
)

test.each(['react', 'vue'] as const)(
  '%s Avatar ignores generic remote image props while ordinary image nodes keep their existing behavior',
  (target) => {
    const { graph, pageId } = avatarGraph()
    const avatar = graph.getChildren(pageId)[0]
    graph.updateNode(avatar.id, {
      interactiveProps: {
        ...avatar.interactiveProps,
        image: { src: 'https://example.com/unexpected-avatar.png', alt: 'Remote override' }
      }
    })
    graph.createNode('FRAME', pageId, {
      name: 'Ordinary image',
      width: 40,
      height: 40,
      interactiveProps: {
        image: { src: 'https://example.com/ordinary.png', alt: 'Ordinary image' }
      }
    })
    const result = compile({
      graph,
      pageIds: [pageId],
      options: withDefaults({ target, router: 'none' })
    })
    expect(result.warnings.filter((w) => w.code === 'avatar-generic-image-ignored')).toHaveLength(1)
    expect(result.files.has(`src/__openpencil_avatar.${target === 'react' ? 'tsx' : 'vue'}`)).toBe(
      true
    )
    const source = [...result.files.values()]
      .filter((value) => typeof value === 'string')
      .join('\n')
    expect(source).not.toContain('https://example.com/unexpected-avatar.png')
    expect(source).toContain('https://example.com/ordinary.png')
  }
)

test.each(['react', 'vue'] as const)(
  '%s Avatar changing source/name fixture remains type-correct',
  (target) => {
    const result = avatarFixture(target, true)
    const files = new Map<string, string>()
    for (const [path, content] of result.files)
      if (typeof content === 'string') files.set(path, content)
    expect(() => typeCheckCompilerFiles(files, target)).not.toThrow()
  },
  35000
)
