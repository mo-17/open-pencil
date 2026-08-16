import { existsSync, lstatSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import { defineCommand } from 'citty'

import {
  buildCompositionShell,
  OPENPENCIL_MICROFRONTEND_LIMITS,
  parseCompositionShellBase,
  parseOpenPencilMicrofrontendCompositionManifestJSON
} from '@open-pencil/compiler/microfrontend'

import { withCompilerBuildRoot } from '#cli/compiler-build-root'
import { bold, kv, ok, printError } from '#cli/format'

interface ComposeArgs {
  manifest?: string
  out: string
  base?: string
  json?: boolean
}

interface PreviewArgs {
  dir?: string
  base: string
  host: string
  port: string
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1'])
const PREVIEW_CONTENT_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
}

function previewHeaders(contentType = 'text/plain; charset=utf-8'): Headers {
  return new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff'
  })
}

export { parseCompositionShellBase as parseMicrofrontendPreviewBase }

function parsePreviewPort(value: string): number {
  const port = Number(value)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new TypeError('Preview port must be an integer from 1 to 65535')
  }
  return port
}

function assertPreviewRoot(directory: string): string {
  const candidate = resolve(directory)
  if (!existsSync(candidate)) throw new Error(`Preview directory not found: ${candidate}`)
  const stat = lstatSync(candidate)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Preview directory must be a real directory: ${candidate}`)
  }
  return realpathSync(candidate)
}

function containedPreviewFile(root: string, path: string): string | null {
  if (!path || path.includes('\\') || path.includes('%')) return null
  const segments = path.split('/')
  if (
    segments.some(
      (segment) => !segment || segment === '.' || segment === '..' || segment.includes('\0')
    )
  ) {
    return null
  }
  let candidate = root
  for (let index = 0; index < segments.length; index += 1) {
    candidate = join(candidate, segments[index])
    if (!existsSync(candidate)) return null
    const stat = lstatSync(candidate)
    if (stat.isSymbolicLink()) throw new Error(`Preview refuses symbolic links: ${path}`)
    if (index < segments.length - 1 && !stat.isDirectory()) return null
    if (index === segments.length - 1 && !stat.isFile()) return null
  }
  const canonical = realpathSync(candidate)
  const contained = relative(root, canonical)
  if (contained === '..' || contained.startsWith(`..${sep}`) || isAbsolute(contained)) {
    throw new Error(`Preview path resolves outside its directory: ${path}`)
  }
  return canonical
}

export interface MicrofrontendPreviewHandlerOptions {
  directory: string
  base?: string
}

/** Prepare a loopback static/SPA preview handler. The composition manifest and
 * index are validated before the caller opens a listening socket. */
export async function createMicrofrontendPreviewHandler(
  options: MicrofrontendPreviewHandlerOptions
): Promise<(request: Request) => Promise<Response>> {
  const root = assertPreviewRoot(options.directory)
  const base = parseCompositionShellBase(options.base ?? '/')
  const compositionPath = containedPreviewFile(root, 'openpencil.composition.json')
  if (!compositionPath) throw new Error('Preview directory is missing openpencil.composition.json')
  parseOpenPencilMicrofrontendCompositionManifestJSON(await readComposition(compositionPath))
  if (!containedPreviewFile(root, 'index.html')) {
    throw new Error('Preview directory is missing index.html')
  }

  return async (request: Request): Promise<Response> => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: previewHeaders()
      })
    }
    const url = new URL(request.url)
    const baseWithoutSlash = base === '/' ? '' : base.slice(0, -1)
    if (base !== '/' && url.pathname === baseWithoutSlash) {
      const headers = previewHeaders()
      headers.set('Location', new URL(base, url.origin).href)
      return new Response(null, { status: 308, headers })
    }
    if (base !== '/' && !url.pathname.startsWith(base)) {
      return new Response('Not Found', { status: 404, headers: previewHeaders() })
    }
    const relativePath = base === '/' ? url.pathname.slice(1) : url.pathname.slice(base.length)
    let file: string | null
    try {
      file = relativePath ? containedPreviewFile(root, relativePath) : null
      if (!file && request.headers.get('accept')?.includes('text/html')) {
        file = containedPreviewFile(root, 'index.html')
      }
    } catch (error) {
      return new Response(error instanceof Error ? error.message : 'Forbidden', {
        status: 403,
        headers: previewHeaders()
      })
    }
    if (!file) return new Response('Not Found', { status: 404, headers: previewHeaders() })
    const body = request.method === 'HEAD' ? null : readFileSync(file)
    return new Response(body, {
      status: 200,
      headers: previewHeaders(PREVIEW_CONTENT_TYPES[extname(file).toLowerCase()])
    })
  }
}

async function readComposition(path: string): Promise<string> {
  const file = Bun.file(path)
  if (!(await file.exists())) throw new Error(`Composition manifest not found: ${path}`)
  if (file.size > OPENPENCIL_MICROFRONTEND_LIMITS.maxCompositionManifestJsonBytes) {
    throw new Error(
      `Composition manifest exceeds ${OPENPENCIL_MICROFRONTEND_LIMITS.maxCompositionManifestJsonBytes} bytes`
    )
  }
  return file.text()
}

export const compose = defineCommand({
  meta: {
    description: 'Build a route-and-slot shell from an OpenPencil microfrontend composition'
  },
  args: {
    manifest: {
      type: 'positional',
      description: 'Path to openpencil.composition.json',
      required: true
    },
    out: {
      type: 'string',
      alias: 'o',
      description: 'Output directory for the static composition shell (default: ./dist)',
      default: 'dist'
    },
    base: {
      type: 'string',
      description: 'Public base path for shell assets (default: /)',
      required: false
    },
    json: { type: 'boolean', description: 'Output a JSON summary' }
  },
  async run({ args }) {
    const options = args as ComposeArgs
    if (!options.manifest) {
      printError('A composition manifest path is required.')
      process.exit(1)
    }
    const manifestPath = resolve(options.manifest)
    const outDir = resolve(options.out)
    try {
      const composition = parseOpenPencilMicrofrontendCompositionManifestJSON(
        await readComposition(manifestPath)
      )
      const result = await withCompilerBuildRoot((fsRoot) =>
        buildCompositionShell({
          composition,
          outDir,
          base: options.base,
          sourceDir: dirname(manifestPath),
          fsRoot
        })
      )
      if (options.json) {
        console.log(
          JSON.stringify(
            {
              composition: composition.composition,
              manifest: manifestPath,
              outDir,
              files: result.files,
              apps: composition.apps.length,
              slots: composition.slots.length
            },
            null,
            2
          )
        )
        return
      }
      console.log('')
      console.log(bold(`  Built microfrontend composition ${composition.composition.name}`))
      console.log(kv('Apps', composition.apps.length))
      console.log(kv('Slots', composition.slots.length))
      console.log(kv('Output', outDir))
      console.log('')
      console.log(
        ok('Done. Deploy the output to a static host with an SPA fallback to index.html.')
      )
    } catch (error) {
      printError(error)
      process.exit(1)
    }
  }
})

export const preview = defineCommand({
  meta: { description: 'Preview a built microfrontend composition on loopback' },
  args: {
    dir: {
      type: 'positional',
      description: 'Built composition shell directory',
      required: true
    },
    base: {
      type: 'string',
      description: 'Deployed base path (default: /)',
      default: '/'
    },
    host: {
      type: 'string',
      description: 'Loopback address (127.0.0.1 or ::1)',
      default: '127.0.0.1'
    },
    port: {
      type: 'string',
      description: 'Preview port (default: 4173)',
      default: '4173'
    }
  },
  async run({ args }) {
    const options = args as PreviewArgs
    try {
      if (!options.dir) throw new Error('A built composition directory is required')
      if (!LOOPBACK_HOSTS.has(options.host)) {
        throw new Error('Microfrontend preview may bind only to 127.0.0.1 or ::1')
      }
      const directory = resolve(options.dir)
      const base = parseCompositionShellBase(options.base)
      const handler = await createMicrofrontendPreviewHandler({ directory, base })
      const server = Bun.serve({
        hostname: options.host,
        port: parsePreviewPort(options.port),
        fetch: handler
      })
      const displayHost = options.host === '::1' ? '[::1]' : options.host
      console.log(ok(`Previewing at http://${displayHost}:${server.port}${base}`))
      console.log('Press Ctrl+C to stop.')
      let closing = false
      const close = (): void => {
        if (closing) return
        closing = true
        void Promise.resolve(server.stop(true)).finally(() => process.exit(0))
      }
      process.once('SIGINT', close)
      process.once('SIGTERM', close)
    } catch (error) {
      printError(error)
      process.exit(1)
    }
  }
})

export default defineCommand({
  meta: { description: 'Build and compose OpenPencil-generated microfrontends' },
  subCommands: { compose, preview }
})
