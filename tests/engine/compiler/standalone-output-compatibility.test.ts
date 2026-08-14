import { expect, test } from 'bun:test'

import { compile, withDefaults } from '@open-pencil/compiler'
import { SceneGraph } from '@open-pencil/scene-graph'

const REACT_BASELINE = Object.freeze({
  '.gitignore': 'cb4faea300ffb20f4614b6f0c9657ed02a2f1a46849ea4c04489cc99e2e7443e',
  'index.html': '998a91bf23dc81d085ad3967d272822c8b371fb626dbf49150f826737e781962',
  'package.json': 'fcf8967c54737322988141a3779dcc564c3f19a9d578cb2f6175dc4dde46531b',
  'src/App.tsx': 'cfec14ad8b5b11809e1ca808b3e0462c206040d69711a112a0499ab7a3979380',
  'src/index.css': '5747e00d61cb0134710510f24964e0f06d79d083b1ca5578a7c51c26108ec0c0',
  'src/main.tsx': '810fe0e7fde0f123112227f6287a15229c8170ce9f0efe7ee9ee0fbe9a55ea06',
  'tsconfig.json': 'ad928493689902b8de11929bdf3bd35bfde8666957b0da51e49d274395ff42f9',
  'vite.config.ts': '5a0e9556a2530fba6cd30a15a071ba7d69432165dd188a768f355bebf10ab92d'
})

const VUE_BASELINE = Object.freeze({
  '.gitignore': '41e1b782bdf457b98fe9fbb8cba15214d5550481f11cb9c0bdb6f4b3c4af91ba',
  'index.html': '77fadbeb842fabd1c3a226985b6cb1bf1810cdec8fbaf0f2b1351f0c6b403f6c',
  'package.json': '6140aa739e1ac5ae51aec023567a90a6091a44801fe23927616ee6fa3b7de4ce',
  'README.md': 'c15fdc7f3dd1e362bee3d356491f50af996cce65c68cf47f828c60f6cbcedd0b',
  'src/App.vue': '96680651bd6cab5c40b7db9bec4ff4e1c19642cbb46fded14cc281c6c5bac4dd',
  'src/env.d.ts': '65996936fbb042915f7b74a200fcdde7e410f32a669b1ab9597cfaa4b0faddb5',
  'src/index.css': '42070e0b45bb201b2b838a52aaaa6e965f964e0b542d97f1fe517fe59c4b75a8',
  'src/lowcode-state.ts': 'c5268bc8ef7f63a955be9c61a8d0398e12ee4f94c3535bd65e3879e893d5cfa3',
  'src/main.ts': '2ce6690b499ba97d16fdc87c615cb4724e2560610453f6589f0bc05ef865eb27',
  'src/pages/index.vue': '97209a6f0fbc30c5b129f8dc9506415b1f0a508686c2de3c2783d642da84cb23',
  'tsconfig.json': '519a0c93ca719d9fb30d516795fc494c35e6672df97aa7486cafbe79bed03671',
  'vite.config.ts': 'ccafeeae7a09b137cb29bf0f8c1dbeedc87eb0a0bb303a87d4f1e25e551f4c58'
})

async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function outputHashes(target: 'react' | 'vue'): Promise<Record<string, string>> {
  const graph = new SceneGraph()
  const pageId = graph.getPages()[0].id
  const output = compile({
    graph,
    pageIds: [pageId],
    options: withDefaults({
      packageName: 'compat-baseline',
      target,
      router: target === 'react' ? 'react-router-v6' : 'vue-router-v4',
      devMode: false
    })
  })
  return Object.fromEntries(
    await Promise.all(
      [...output.files]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(async ([path, contents]) => [path, await sha256Hex(contents)] as const)
    )
  )
}

test('default React and Vue standalone output remains byte-compatible', async () => {
  expect(await outputHashes('react')).toEqual(REACT_BASELINE)
  expect(await outputHashes('vue')).toEqual(VUE_BASELINE)
})
