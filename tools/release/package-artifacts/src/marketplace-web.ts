import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { resolveWorkspaceRoot } from './workspace/root'

const root = await resolveWorkspaceRoot(process.cwd())
const source = join(root, 'packages/marketplace/web')
const output = join(source, 'dist')
const assets = join(output, 'assets')

await mkdir(assets, { recursive: true })
const result = await Bun.build({
  entrypoints: [join(source, 'main.ts')],
  outdir: assets,
  target: 'browser',
  format: 'esm',
  minify: true,
  naming: 'main.js'
})
if (!result.success) throw new AggregateError(result.logs, 'Marketplace website build failed')

await Promise.all([
  copyFile(join(source, 'index.html'), join(output, 'index.html')),
  copyFile(join(source, 'styles.css'), join(assets, 'main.css')),
  copyFile(join(root, 'assets/brand/mark.svg'), join(assets, 'mark.svg'))
])
const html = await readFile(join(output, 'index.html'), 'utf8')
if (!html.includes('./assets/main.js') || !html.includes('./assets/main.css')) {
  throw new Error('Marketplace HTML must reference the built relative assets')
}
await writeFile(join(output, 'robots.txt'), 'User-agent: *\nAllow: /marketplace/\n')
console.log(`Marketplace website built: ${output}`)
