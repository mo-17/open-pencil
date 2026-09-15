export const VR_TOUR_HYBRID_OWNERSHIP_FILE = '.openpencil-vr-tour-owned.json'

/** Executed only by the exported project's owner after dependency installation. */
export const VR_TOUR_HYBRID_BUILD = String.raw`
import { build } from 'esbuild'
import { readFile, writeFile, mkdir, lstat, readdir, unlink } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ownershipFile = ${JSON.stringify(VR_TOUR_HYBRID_OWNERSHIP_FILE)}
const ownedName = /^(?:tour-[a-f0-9]{32}\.html|SOURCES\.json)$/
const digest = value => createHash('sha256').update(value).digest('hex')
async function optionalStat(path) {
  try { return await lstat(path) }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error }
}
async function checkedDirectory(project, segments) {
  let directory = project
  for (const segment of segments) {
    directory = resolve(directory, segment)
    const stat = await optionalStat(directory)
    if (stat && (stat.isSymbolicLink() || !stat.isDirectory())) throw new Error('Unsafe VR output directory')
  }
  return directory
}
async function inspectOutputDirectory(project, segments) {
  const directory = await checkedDirectory(project, segments)
  const stat = await optionalStat(directory)
  if (!stat) return { directory, owned: new Map() }
  const names = await readdir(directory)
  if (!names.length) return { directory, owned: new Map() }
  const metadata = resolve(directory, ownershipFile)
  const metadataStat = await optionalStat(metadata)
  if (!metadataStat || metadataStat.isSymbolicLink() || !metadataStat.isFile() || metadataStat.size > 32768) throw new Error('Nonempty VR output directory requires a regular ownership manifest')
  const previous = JSON.parse(await readFile(metadata, 'utf8'))
  if (previous.version !== 1 || !Array.isArray(previous.files) || previous.files.length > 101) throw new Error('Invalid VR output ownership manifest')
  const owned = new Map()
  for (const file of previous.files) {
    if (!file || typeof file.path !== 'string' || !ownedName.test(file.path) || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256) || owned.has(file.path)) throw new Error('Invalid VR output ownership entry')
    owned.set(file.path, file.sha256)
  }
  for (const name of names) {
    if (name === ownershipFile) continue
    if (!owned.has(name)) throw new Error('Unknown file in VR output directory; preserve it outside this generated directory before preparing')
    const path = resolve(directory, name)
    const file = await lstat(path)
    if (file.isSymbolicLink() || !file.isFile()) throw new Error('Unsafe owned VR output file')
    if (digest(await readFile(path)) !== owned.get(name)) throw new Error('Owned VR output was modified; preserve it before preparing')
  }
  return { directory, owned }
}
async function publishOutputs(output, planned) {
  await mkdir(output.directory, { recursive: true })
  for (const [name, contents] of planned) await writeFile(resolve(output.directory, name), contents)
  for (const [name, expected] of output.owned) {
    if (planned.has(name)) continue
    const path = resolve(output.directory, name)
    const file = await optionalStat(path)
    if (!file) continue
    if (file.isSymbolicLink() || !file.isFile() || digest(await readFile(path)) !== expected) throw new Error('Owned VR output changed during preparation')
    await unlink(path)
  }
  const files = [...planned].map(([path, contents]) => ({ path, sha256: digest(contents) })).sort((a, b) => a.path.localeCompare(b.path))
  await writeFile(resolve(output.directory, ownershipFile), JSON.stringify({ version: 1, files }, null, 2) + '\n')
}

async function prepareVRTours() {
const root = dirname(fileURLToPath(import.meta.url))
const project = resolve(root, '..')
const manifest = JSON.parse(await readFile(resolve(root, 'manifest.json'), 'utf8'))
if (manifest.version !== 1 || !['expo', 'flutter', 'taro'].includes(manifest.target) || !Array.isArray(manifest.tours) || manifest.tours.length > 100 || !Array.isArray(manifest.assets)) throw new Error('Invalid VR tour build manifest')
const assets = Object.create(null)
let total = 0
for (const asset of manifest.assets) {
  if (!/^\/assets\/vr-tour\/(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|webp)$/.test(asset.url) || !['image/jpeg', 'image/png', 'image/webp'].includes(asset.mime) || !Array.isArray(asset.chunks) || asset.chunks.length > 24 || !/^[a-f0-9]{64}$/.test(asset.sha256)) throw new Error('Invalid bundled panorama manifest')
  const chunks = []
  let size = 0
  for (const path of asset.chunks) {
    if (!/^assets\/[a-f0-9]{64}-\d+\.bin$/.test(path)) throw new Error('Unsafe panorama chunk path')
    const chunk = await readFile(resolve(root, path))
    size += chunk.byteLength
    if (chunk.byteLength > 1024 * 1024 || size > 24 * 1024 * 1024) throw new Error('Panorama chunk budget exceeded')
    chunks.push(chunk)
  }
  total += size
  const bytes = Buffer.concat(chunks)
  if (total > 48 * 1024 * 1024 || size !== asset.byteLength || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw new Error('Panorama integrity or byte budget failed')
  assets[asset.url] = { mime: asset.mime, base64: bytes.toString('base64') }
}
const bundled = await build({
  absWorkingDir: root, entryPoints: ['entry.ts'], bundle: true, write: false,
  format: 'iife', platform: 'browser', target: ['safari16', 'chrome110'], minify: true,
  outfile: 'player.js', legalComments: 'inline', loader: { '.svg': 'dataurl', '.png': 'dataurl' }
})
const script = bundled.outputFiles.find(file => file.path.endsWith('.js'))?.text
if (!script) throw new Error('VR player bundling produced no JavaScript')
const css = bundled.outputFiles.find(file => file.path.endsWith('.css'))?.text ?? ''
const escapeJSON = value => JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029')
const htmlById = Object.create(null)
const planned = new Map()
let outputBytes = 0
for (const tour of manifest.tours) {
  if (!/^tour-[a-f0-9]{32}$/.test(tour.key) || typeof tour.sourceId !== 'string' || !Array.isArray(tour.config?.scenes)) throw new Error('Invalid tour entry')
  const name = tour.key + '.html'
  if (planned.has(name) || Object.hasOwn(htmlById, tour.sourceId)) throw new Error('Duplicate VR tour output')
  const selectedAssets = Object.create(null)
  for (const scene of tour.config.scenes) if (Object.hasOwn(assets, scene.panoramaUrl)) selectedAssets[scene.panoramaUrl] = assets[scene.panoramaUrl]
  const json = escapeJSON({ config: tour.config, assets: selectedAssets })
  const html = '<!doctype html><html lang="' + (tour.config.locale === 'zh-CN' ? 'zh-CN' : 'en') + '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\'; img-src blob: data:; connect-src https: blob:; font-src data:; base-uri \'none\'; form-action \'none\'"><style>html,body,#tour{margin:0;width:100%;height:100%;overflow:hidden}*{box-sizing:border-box}' + css.replace(/<\/style/gi, '<\\/style') + '</style></head><body><div id="tour"></div><script type="application/json" id="openpencil-tour-data">' + json + '</script><script>' + script.replace(/<\/script/gi, '<\\/script') + '</script></body></html>'
  outputBytes += Buffer.byteLength(html)
  if (outputBytes > 128 * 1024 * 1024) throw new Error('Prepared VR HTML exceeds 128 MiB; reduce duplicated tours or images')
  htmlById[tour.sourceId] = html
  planned.set(name, html)
}
try { planned.set('SOURCES.json', await readFile(resolve(root, 'SOURCES.json'))) } catch (error) { if (error.code !== 'ENOENT') throw error }
const output = await inspectOutputDirectory(project, manifest.target === 'flutter' ? ['assets', 'vr-tour'] : ['vr-tour-web', 'dist'])
if (manifest.target === 'expo') {
  const src = await checkedDirectory(project, ['src'])
  const htmlModule = await optionalStat(resolve(src, 'vr-tour-html.ts'))
  if (htmlModule && (htmlModule.isSymbolicLink() || !htmlModule.isFile())) throw new Error('Unsafe Expo VR HTML module')
}
await publishOutputs(output, planned)
if (manifest.target === 'expo') {
  await mkdir(resolve(project, 'src'), { recursive: true })
  await writeFile(resolve(project, 'src/vr-tour-html.ts'), '// Generated by vr-tour-web/build.mjs.\nexport const vrTourHtmlById: Readonly<Record<string, string>> = ' + JSON.stringify(htmlById) + '\n')
}
console.log('Prepared ' + manifest.tours.length + ' VR tour(s) for ' + manifest.target + '. No deployment was performed.')
}
await prepareVRTours().catch(error => {
  console.error(error instanceof Error ? error.message : 'VR tour preparation failed')
  process.exitCode = 1
})
`
