import { copyFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { resolveWorkspaceRoot } from './workspace/root'

const root = await resolveWorkspaceRoot(process.cwd())
const source = join(root, 'packages/marketplace/web/portal')
const output = join(source, 'dist')
const html = await readFile(join(source, 'index.html'), 'utf8')
for (const href of ['/marketplace/', '/chat-deep/', '/login', '/portal-assets/main.css']) {
  if (!html.includes(`href="${href}"`)) throw new Error(`Missing portal route: ${href}`)
}

await mkdir(join(output, 'portal-assets'), { recursive: true })
await Promise.all([
  copyFile(join(source, 'index.html'), join(output, 'index.html')),
  copyFile(join(source, 'styles.css'), join(output, 'portal-assets/main.css'))
])
console.log(`Kushui product portal built: ${output}`)
