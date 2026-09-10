import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { TauriCapabilities } from '@wdio/tauri-service'

const root = dirname(fileURLToPath(import.meta.url))
const binaryName = process.platform === 'win32' ? 'OpenPencil.exe' : 'OpenPencil'
const appBinary = join(root, 'desktop', 'target', 'debug', binaryName)

function makePeer(profile: 'alice' | 'bob'): TauriCapabilities {
  const appArgs = [`--e2e-profile=${profile}`]
  return {
    browserName: 'tauri',
    'tauri:options': {
      application: appBinary,
      args: appArgs
    },
    'wdio:tauriServiceOptions': {
      appArgs,
      driverProvider: 'embedded'
    }
  }
}

const namedCapabilities = {
  alice: { capabilities: makePeer('alice') },
  bob: { capabilities: makePeer('bob') }
} satisfies Record<'alice' | 'bob', { capabilities: TauriCapabilities }>

type NamedMultiremoteConfig = Omit<WebdriverIO.Config, 'capabilities'> & {
  capabilities: typeof namedCapabilities
}

export const config: NamedMultiremoteConfig = {
  runner: 'local',
  tsConfigPath: join(root, 'tests', 'e2e', 'native-collab', 'tsconfig.json'),
  specs: [join(root, 'tests', 'e2e', 'native-collab', 'session.spec.ts')],
  maxInstances: 1,
  capabilities: namedCapabilities,
  services: [
    [
      '@wdio/tauri-service',
      {
        appBinaryPath: appBinary,
        driverProvider: 'embedded',
        startTimeout: 120_000
      }
    ]
  ],
  framework: 'mocha',
  reporters: ['spec'],
  logLevel: 'warn',
  waitforTimeout: 20_000,
  connectionRetryTimeout: 120_000,
  connectionRetryCount: 1,
  mochaOpts: { ui: 'bdd', timeout: 180_000 }
}
