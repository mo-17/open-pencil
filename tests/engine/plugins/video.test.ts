import { describe, expect, test } from 'bun:test'

import {
  BUILTIN_PLUGIN_REGISTRY,
  VIDEO_MODULE_DEFAULT_SIZE,
  createVideoModuleInstance,
  isCanonicalPublicHttpsURL,
  resolveVideoModule
} from '@open-pencil/core/plugins'

describe('built-in video plugin', () => {
  test('registers a bounded default video module', () => {
    const definition = BUILTIN_PLUGIN_REGISTRY.getModule('open-pencil.video', 'video')
    const instance = createVideoModuleInstance()
    const resolved = resolveVideoModule(instance)

    expect(definition?.name).toBe('Video')
    expect(definition?.defaultSize).toEqual(VIDEO_MODULE_DEFAULT_SIZE)
    const fieldPaths = definition?.fields.map((field) => field.path.join('.')) ?? []
    expect(fieldPaths.indexOf('muted')).toBeLessThan(fieldPaths.indexOf('autoplay'))
    expect(resolved?.ok).toBe(true)
    if (!resolved?.ok) throw new Error('expected video module to resolve')
    expect(resolved.config).toEqual({
      src: '',
      poster: '',
      controls: true,
      autoplay: false,
      muted: false,
      loop: false,
      fit: 'contain'
    })
  })

  test('accepts canonical public HTTPS media without resolving or fetching it', () => {
    const src = 'https://media.example.com/videos/intro.mp4?version=1'
    const poster = 'https://cdn.example.com/posters/intro.webp'
    const instance = createVideoModuleInstance({
      src,
      poster,
      controls: false,
      autoplay: true,
      muted: true,
      loop: true,
      fit: 'cover'
    })
    const resolved = resolveVideoModule(instance)

    expect(isCanonicalPublicHttpsURL(src)).toBe(true)
    expect(resolved?.ok).toBe(true)
    if (!resolved?.ok) throw new Error('expected video module to resolve')
    expect(resolved.config.src).toBe(src)
    expect(resolved.config.poster).toBe(poster)
  })

  test('rejects non-public, non-canonical, and unsafe media URLs', () => {
    for (const src of [
      'http://media.example.com/video.mp4',
      'https://localhost/video.mp4',
      'https://localhost./video.mp4',
      'https://preview.localhost./video.mp4',
      'https://host.local./video.mp4',
      'https://localhost.localdomain/video.mp4',
      'https://service.localdomain/video.mp4',
      'https://home.arpa/video.mp4',
      'https://media.home.arpa/video.mp4',
      'https://127.0.0.1/video.mp4',
      'https://user:secret@media.example.com/video.mp4',
      'https://media.example.com/video.mp4#start',
      'https://media.example.com:443/video.mp4'
    ]) {
      expect(() => createVideoModuleInstance({ src })).toThrow('canonical public HTTPS URL')
      expect(isCanonicalPublicHttpsURL(src)).toBe(false)
    }
  })

  test('enforces autoplay, exact keys, booleans, and fit', () => {
    expect(() => createVideoModuleInstance({ autoplay: true, muted: false })).toThrow(
      'autoplay requires muted'
    )
    expect(() => createVideoModuleInstance({ controls: 'yes' })).toThrow(
      'controls must be a boolean'
    )
    expect(() => createVideoModuleInstance({ fit: 'scale-down' })).toThrow(
      'contain, cover, or fill'
    )
    expect(() =>
      createVideoModuleInstance({
        src: '',
        poster: '',
        controls: true,
        autoplay: false,
        muted: false,
        loop: false,
        fit: 'contain',
        onPlay: 'execute()'
      })
    ).toThrow('contain exactly')
  })
})
