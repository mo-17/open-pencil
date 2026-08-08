import { describe, expect, test } from 'bun:test'

import {
  CAROUSEL_REACT_MODULE_ADAPTER,
  buildOpenPencilCarouselComponent
} from '#compiler/adapters/react/modules/carousel'
import { CAROUSEL_COMPILER_MODULE_LOWERER } from '#compiler/modules/carousel'

import { createDefaultNode } from '@open-pencil/scene-graph/node-defaults'

import { createCarouselModuleInstance } from '#core/plugins/carousel'

const CONFIG = {
  label: 'Featured work',
  slides: [
    {
      title: 'First',
      description: '<script>plain text only</script>',
      imageUrl: 'https://media.example.com/first.webp',
      alt: 'First preview',
      href: '/first'
    },
    {
      title: 'Second',
      description: 'Second slide',
      imageUrl: '',
      alt: '',
      href: '#second'
    }
  ],
  initialIndex: 1,
  transition: 'fade',
  autoplay: true,
  intervalMs: 4_000,
  loop: false,
  showArrows: true,
  showDots: true,
  pauseOnHover: true,
  backgroundColor: '#111827',
  textColor: '#FFFFFF',
  accentColor: '#60A5FA'
}

describe('carousel compiler module v1', () => {
  test('lowers a defensive bounded payload and rejects invalid module config', () => {
    const instance = createCarouselModuleInstance(CONFIG)
    const node = createDefaultNode(() => 'carousel-1', 'FRAME')
    const lowered = CAROUSEL_COMPILER_MODULE_LOWERER.lower(instance, node)

    expect(lowered.ok).toBe(true)
    if (!lowered.ok) throw new Error(lowered.reason)
    expect(lowered.payload).toEqual(CONFIG)
    expect(lowered.payload).not.toBe(instance.config)
    expect(lowered.payload.slides).not.toBe(instance.config.slides)

    const invalid = CAROUSEL_COMPILER_MODULE_LOWERER.lower(
      {
        ...instance,
        config: { ...instance.config, intervalMs: 1 }
      },
      node
    )
    expect(invalid.ok).toBe(false)
  })

  test('emits dependency-free accessible runtime with bounded lifecycle cleanup', () => {
    const development = buildOpenPencilCarouselComponent({ devMode: true })
    const production = buildOpenPencilCarouselComponent({ devMode: false })

    expect(() => new Bun.Transpiler({ loader: 'tsx' }).transformSync(development)).not.toThrow()
    expect(development).toContain('aria-roledescription="carousel"')
    expect(development).toContain('aria-live="polite"')
    expect(development).toContain('window.clearInterval(timer)')
    expect(development).toContain("query.removeEventListener('change', sync)")
    expect(development).toContain("document.removeEventListener('visibilitychange', sync)")
    expect(development).toContain('const REMOTE_MEDIA_ENABLED_BY_DEFAULT = false')
    expect(development).toContain('if (event.target !== event.currentTarget) return')
    expect(development).toContain('authorizedRemoteMediaUrls.has(slide.imageUrl)')
    expect(development).toContain('next.add(slide.imageUrl)')
    expect(development).toContain('Load remote slide media')
    expect(development).toContain('<h2>\n                  {slide.href ? (')
    expect(development).not.toContain('{slide.href ? (\n                <a')
    expect(production).toContain('const REMOTE_MEDIA_ENABLED_BY_DEFAULT = true')
    expect(development).not.toContain('dangerouslySetInnerHTML')
    expect(development).not.toContain('__OPENPENCIL_REMOTE_MEDIA_ENABLED__')
  })

  test('declares a collision-safe local React runtime identity without dependencies', () => {
    expect(CAROUSEL_REACT_MODULE_ADAPTER).toMatchObject({
      pluginId: 'open-pencil.carousel',
      moduleType: 'carousel',
      componentName: 'OpenPencilCarousel',
      runtimePath: 'src/__openpencil_carousel.tsx'
    })
    expect(CAROUSEL_REACT_MODULE_ADAPTER.dependencies).toBeUndefined()
  })
})
