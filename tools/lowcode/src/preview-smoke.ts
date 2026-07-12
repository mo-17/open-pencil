import { compile, withDefaults } from '@open-pencil/compiler'
import { createPreviewServer } from '@open-pencil/compiler/dev-server'
import { SceneGraph } from '@open-pencil/scene-graph'

const graph = new SceneGraph()
graph.addPage('Demo')
const pageId = graph.getPages()[0].id
graph.createNode('TEXT', pageId, { text: 'Hello preview' })
graph.createNode('BUTTON', pageId, { interactiveProps: { text: 'Click me' } })

const out = compile({ graph, pageIds: [pageId], options: withDefaults({ packageName: 'smoke' }) })
const srv = await createPreviewServer({ initialFiles: out.files, fsRoot: process.cwd() })
console.log('READY', srv.url)

const html = await fetch(srv.url).then((r) => r.text())
console.log('--- / (first 200) ---')
console.log(html.slice(0, 200))
console.log('--- /src/main.tsx (first 400) ---')
const main = await fetch(srv.url + 'src/main.tsx').then((r) => r.text())
console.log(main.slice(0, 400))
console.log('--- /src/App.tsx (first 400) ---')
const app = await fetch(srv.url + 'src/App.tsx').then((r) => r.text())
console.log(app.slice(0, 400))

console.log('--- /src/index.css (first 400) ---')
const css = await fetch(srv.url + 'src/index.css').then((r) => r.text())
console.log(css.slice(0, 400))

await srv.close()
process.exit(0)
