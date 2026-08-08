import { defineCommand } from 'citty'

import catalog from './catalog'
import manifest from './manifest'
import runtime from './runtime'
import runtimeIndex from './runtime-index'

export default defineCommand({
  meta: { description: 'Build and verify declarative OpenPencil plugin artifacts' },
  subCommands: { catalog, manifest, runtime, 'runtime-index': runtimeIndex }
})
