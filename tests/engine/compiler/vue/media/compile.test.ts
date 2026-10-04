import { expect, test } from 'bun:test'

import { buildOpenPencilVueAudioPlayer } from '#compiler/adapters/vue/modules/audio-player'
import { buildOpenPencilVueLottie } from '#compiler/adapters/vue/modules/lottie'
import { buildOpenPencilVueQrBarcode } from '#compiler/adapters/vue/modules/qr-barcode'

import {
  vueMediaBrowserFixture,
  vueMediaFixture
} from '#tests/helpers/compiler/modules/vue-media/fixture'
import { typeCheckCompilerFiles } from '#tests/helpers/compiler/typecheck'

for (const devMode of [false, true]) {
  test(`Vue media generated SFCs and mutable browser harness typecheck (preview=${devMode})`, () => {
    for (const output of [vueMediaFixture(devMode), vueMediaBrowserFixture(devMode)]) {
      expect(output.warnings).toEqual([])
      const files = new Map<string, string>()
      for (const [path, value] of output.files)
        if (typeof value === 'string') files.set(path, value)
      typeCheckCompilerFiles(files, 'vue')
      for (const name of ['audio_player', 'lottie', 'qr_barcode'])
        expect(files.has('src/__openpencil_' + name + '.vue')).toBe(true)
      const manifest = JSON.parse(files.get('package.json') as string) as {
        dependencies: Record<string, string>
      }
      expect(manifest.dependencies).toMatchObject({
        'lottie-web': '5.13.0',
        qrcode: '1.5.4',
        jsbarcode: '3.12.3'
      })
      expect(files.get('public/media/local-tone.wav')).toStartWith('RIFF')
    }
  }, 65000)
}

test('React media source still passes real TypeScript after shared source extraction', () => {
  const output = vueMediaFixture(false, 'react'),
    files = new Map<string, string>()
  expect(output.warnings).toEqual([])
  for (const [path, value] of output.files) if (typeof value === 'string') files.set(path, value)
  typeCheckCompilerFiles(files, 'react')
}, 35000)

test('Vue media emits local trusted drawing without an authored HTML injection path', () => {
  for (const runtime of [
    buildOpenPencilVueAudioPlayer({ devMode: true }),
    buildOpenPencilVueLottie(),
    buildOpenPencilVueQrBarcode()
  ]) {
    expect(runtime).not.toContain('v-html')
    expect(runtime).not.toContain('innerHTML')
    expect(runtime).not.toContain('new Function')
    expect(runtime).not.toContain('dangerouslySetInnerHTML')
  }
})
