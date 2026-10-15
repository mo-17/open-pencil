/** Minimal native process contract shared by reviewed preview companions. */
export interface PreviewNativeChild {
  write(data: string): Promise<void>
  kill(): Promise<void>
}

interface PreviewNativeOutput {
  on(event: 'data', listener: (data: string) => void): void
}

export interface PreviewNativeCommand {
  readonly stdout: PreviewNativeOutput
  readonly stderr: PreviewNativeOutput
  on(event: 'close', listener: (data: { code: number | null }) => void): void
  on(event: 'error', listener: (error: string) => void): void
  spawn(): Promise<PreviewNativeChild>
}

export type CreatePreviewNativeCommand = (
  program: string,
  args: string[],
  options: { cwd: string }
) => PreviewNativeCommand | Promise<PreviewNativeCommand>

export const createPreviewNativeCommand: CreatePreviewNativeCommand = async (
  program,
  args,
  options
) => {
  const resolved = resolvePreviewNativeCommand(program, args)
  const { Command } = await import('@tauri-apps/plugin-shell')
  return Command.create(resolved.command, resolved.args, {
    ...options,
    env: LOCAL_PROCESS_CREDENTIAL_ENV
  })
}

const LOWCODE_CLI_ENTRY = 'tools/dev/lowcode/src/native-cli.ts'

/** Local preview/build processes cannot inherit provider authorization from the GUI's PATH shell. */
export const LOCAL_PROCESS_CREDENTIAL_ENV: Record<string, string> = Object.freeze({
  NETLIFY_AUTH_TOKEN: '',
  VERCEL_TOKEN: '',
  CLOUDFLARE_API_TOKEN: ''
})

/** Select a unique, fixed shell scope. The existing caller interface describes the operation,
 * while Bun can only launch the reviewed script from that scope. */
export function resolvePreviewNativeCommand(
  program: string,
  args: string[]
): { command: string; args: string[] } {
  const entry = args[0]
  if (
    program === 'flutter-preview' &&
    args.length === 1 &&
    entry === 'tools/dev/flutter-preview/src/index.ts'
  ) {
    return { command: program, args }
  }
  if (program !== 'lowcode-preview') throw new Error('Unknown native preview command.')
  if (entry === 'packages/compiler/src/dev-server.ts') {
    if (
      (args.length !== 5 && args.length !== 7) ||
      args[1] !== '--root' ||
      args[3] !== '--target' ||
      (args.length === 7 && args[5] !== '--local-backend')
    ) {
      throw new Error('Invalid native preview arguments.')
    }
    return {
      command: args.length === 7 ? 'lowcode-preview-local-backend' : 'lowcode-preview',
      args
    }
  }
  if (
    entry === 'packages/compiler/src/managed-preview/cli.ts' &&
    args.length === 3 &&
    args[1] === '--session'
  ) {
    return { command: 'lowcode-managed-preview', args }
  }
  if (entry === 'packages/cli/src/index.ts') {
    const action = args[1]
    if (action !== 'build' && action !== 'deploy')
      throw new Error('Unknown native lowcode CLI action.')
    return {
      command: action === 'build' ? 'lowcode-microfrontend' : 'lowcode-deploy',
      args: [LOWCODE_CLI_ENTRY, action, JSON.stringify(args.slice(2))]
    }
  }
  throw new Error('Unreviewed native preview entrypoint.')
}
