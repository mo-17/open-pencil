import { resolve } from 'node:path'

import { resolveWorkspaceRoot } from '@open-pencil/package-artifacts-tools'

const repoRoot = await resolveWorkspaceRoot(import.meta.dir)
const packageRoot = resolve(repoRoot, 'packages/motion-runtime')
const consumerTsconfig = resolve(packageRoot, 'tests/fixtures/consumer-tsconfig.json')
const entrypoint = 'motion-runtime-framework-neutral-consumer.ts'
const consumerSource = `
import {
  createManualMotionClock,
  createMotionRuntime
} from '@open-pencil/motion-runtime'

export function createConsumerRuntime() {
  const clock = createManualMotionClock()
  return createMotionRuntime({ clock })
}
`

function portablePath(path: string): string {
  return path.replaceAll('\\', '/')
}

const build = await Bun.build({
  entrypoints: [entrypoint],
  files: { [entrypoint]: consumerSource },
  root: repoRoot,
  tsconfig: consumerTsconfig,
  target: 'browser',
  format: 'esm',
  conditions: ['import', 'default'],
  minify: true,
  metafile: true
})

if (!build.success) {
  throw new Error(build.logs.map(String).join('\n'))
}

const contributingInputs = Object.values(build.metafile?.outputs ?? {}).flatMap((output) =>
  Object.entries(output.inputs)
    .filter(([, input]) => input.bytesInOutput > 0)
    .map(([path]) => portablePath(path))
)
const javascript = build.outputs.filter(
  (output) => output.kind === 'entry-point' && output.type.startsWith('text/javascript')
)

if (javascript.length !== 1) {
  throw new Error(`Expected one JavaScript output, received ${javascript.length}`)
}

const bundledSource = await javascript[0].text()
process.stdout.write(JSON.stringify({ contributingInputs, bundledSource }))
