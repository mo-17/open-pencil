import * as v from 'valibot'

import { parseStableSemver, validateModuleIdentity } from '@open-pencil/scene-graph'

const MAX_REQUEST_BYTES = 32768
function withoutControlCharacters(value: string): boolean {
  for (const character of value) if (character.charCodeAt(0) < 32) return false
  return true
}
const TEXT = v.pipe(
  v.string(),
  v.minLength(1),
  v.maxLength(4096),
  v.check(withoutControlCharacters)
)
const PATH = v.pipe(
  TEXT,
  v.check((value) => !value.startsWith('-'))
)
const ACTION = v.picklist(['build', 'deploy'])
const ARGS = v.pipe(v.array(TEXT), v.maxLength(80))
const IDENTITY = v.pipe(
  TEXT,
  v.check((value) => validateModuleIdentity(value) === null)
)
const SEMVER = v.pipe(
  TEXT,
  v.check((value) => {
    try {
      parseStableSemver(value)
      return true
    } catch {
      return false
    }
  })
)
const PACKAGE_NAME = v.pipe(
  TEXT,
  v.maxLength(214),
  v.regex(/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u)
)
const BUILD = [
  PATH,
  v.literal('-o'),
  PATH,
  v.literal('--target'),
  v.picklist(['react', 'vue']),
  v.literal('--packaging'),
  v.literal('microfrontend'),
  v.literal('--app-id'),
  IDENTITY,
  v.literal('--app-version'),
  SEMVER,
  v.literal('--package-name'),
  PACKAGE_NAME,
  v.literal('--base'),
  v.literal('./'),
  v.literal('--json')
] as const
const BUILD_ARGS = v.union([
  v.strictTuple(BUILD),
  v.strictTuple([...BUILD, v.literal('--ui-kit'), v.literal('shadcn')])
])
const DEPLOY = [
  PATH,
  v.literal('--provider'),
  v.picklist(['netlify', 'vercel', 'cloudflare']),
  v.literal('--environment'),
  v.picklist(['preview', 'staging', 'production']),
  v.literal('--json')
] as const
const LOCALE = v.pipe(TEXT, v.maxLength(128), v.regex(/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/u))

export interface NativeLowcodeRequest {
  action: v.InferOutput<typeof ACTION>
  args: string[]
}

function deployArgs(input: string[]): string[] {
  // Keep the host's reviewed argument order. Unknown flags, duplicates and incomplete values
  // cannot turn this entrypoint into the general CLI.
  const head = v.parse(v.strictTuple(DEPLOY), input.slice(0, DEPLOY.length))
  const args: string[] = [...head]
  let cursor = DEPLOY.length
  if (input[cursor] === '--site') {
    args.push('--site', v.parse(PATH, input[cursor + 1]))
    cursor += 2
  }
  if (input[cursor] === '--ui-kit') {
    args.push('--ui-kit', v.parse(v.literal('shadcn'), input[cursor + 1]))
    cursor += 2
  }
  if (input[cursor] === '--i18n') {
    args.push('--i18n')
    cursor++
    let locales = 0
    while (input[cursor] === '--locale') {
      if (++locales > 32) throw new Error('Too many deployment locales.')
      args.push('--locale', v.parse(LOCALE, input[cursor + 1]))
      cursor += 2
    }
  }
  if (input[cursor] === '--backend-provider-stdin') {
    args.push('--backend-provider-stdin')
    cursor++
  }
  if (cursor !== input.length) throw new Error('Unreviewed deployment arguments.')
  return args
}

export function parseNativeLowcodeRequest(argv: unknown): NativeLowcodeRequest {
  const [action, raw] = v.parse(
    v.strictTuple([ACTION, v.pipe(v.string(), v.maxLength(MAX_REQUEST_BYTES))]),
    argv
  )
  if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) {
    throw new Error('Native lowcode request is too large.')
  }
  const input = v.parse(ARGS, JSON.parse(raw))
  const args = action === 'build' ? [...v.parse(BUILD_ARGS, input)] : deployArgs(input)
  if (action === 'build' && args[4] === 'vue' && args.length !== BUILD.length) {
    throw new Error('The Vue microfrontend does not use the React UI kit.')
  }
  return { action, args }
}

export interface NativeLowcodeDependencies {
  env: Record<string, string | undefined>
  run(request: NativeLowcodeRequest): Promise<void>
}

/** Invoke the existing CLI in this process. Stdin and process signals remain owned by that
 * command, including the Backend Provider preparation/authorization handshake. */
export async function runNativeLowcodeCLI(
  argv: unknown,
  dependencies: NativeLowcodeDependencies
): Promise<void> {
  const request = parseNativeLowcodeRequest(argv)
  if (request.action !== 'deploy') {
    delete dependencies.env.NETLIFY_AUTH_TOKEN
    delete dependencies.env.VERCEL_TOKEN
    delete dependencies.env.CLOUDFLARE_API_TOKEN
  }
  await dependencies.run(request)
}
