import type { ArgsDef } from 'citty'

import type { CompilerMicrofrontendPackaging } from '@open-pencil/compiler'

export const microfrontendPackagingArgs: ArgsDef = {
  packaging: {
    type: 'string',
    description: 'Output packaging: standalone (default) or microfrontend.',
    required: false
  },
  'app-id': {
    type: 'string',
    description: 'Stable microfrontend app identity (required with --packaging microfrontend).',
    required: false
  },
  'app-version': {
    type: 'string',
    description: 'Stable SemVer release surfaced in the microfrontend manifest.',
    required: false
  }
}

export interface RawMicrofrontendPackagingArgs {
  packaging?: string
  'app-id'?: string
  'app-version'?: string
}

export function resolveMicrofrontendPackaging(
  args: RawMicrofrontendPackagingArgs
): CompilerMicrofrontendPackaging | undefined {
  const kind = args.packaging?.trim().toLowerCase()
  const appId = args['app-id']?.trim()
  const version = args['app-version']?.trim()
  if (!kind || kind === 'standalone') {
    if (appId || version) {
      throw new Error('--app-id and --app-version require --packaging microfrontend.')
    }
    return undefined
  }
  if (kind !== 'microfrontend') {
    throw new Error(`Unknown --packaging "${kind}". Supported: standalone, microfrontend.`)
  }
  if (!appId) throw new Error('--app-id is required with --packaging microfrontend.')
  return { kind: 'microfrontend', appId, ...(version ? { version } : {}) }
}
