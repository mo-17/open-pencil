import { expect, test } from 'bun:test'

import { parseVRTourPanoramaURL } from '@open-pencil/core/plugins'

test('the generated URL guard agrees with the strict authoring URL contract', async () => {
  const { VR_TOUR_RUNTIME_SOURCE } = await import('#compiler/adapters/vr-tour/source')
  const start = VR_TOUR_RUNTIME_SOURCE.indexOf('export function safePanoramaURL')
  const end = VR_TOUR_RUNTIME_SOURCE.indexOf('const MAX_IMAGE_BYTES')
  const source = new Bun.Transpiler({ loader: 'ts' }).transformSync(
    VR_TOUR_RUNTIME_SOURCE.slice(start, end)
  )
  const { safePanoramaURL } = await import(
    'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
  )
  for (const value of [
    '',
    '/assets/vr-tour/room.png',
    'https://assets.example.com/room.jpg',
    undefined,
    3,
    {},
    'https://example.com/a.png?',
    'https://example.com/a.png#',
    'https://127.0.0.1/a.jpg',
    'https://example.local/a.png',
    'https://example.com/a.svg',
    'https://example.com/a.png?q=1',
    'https://x:y@example.com/a.jpg',
    '/assets/vr-tour/../a.jpg',
    'data:image/png;base64,AA'
  ]) {
    let expected: string | null
    try {
      expected = parseVRTourPanoramaURL(value)
    } catch {
      expected = null
    }
    expect(safePanoramaURL(value)).toBe(expected)
  }
})
