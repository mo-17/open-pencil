import { join } from 'node:path'

import { readPackageManifest } from '@open-pencil/package-artifacts-tools'

import { DEFAULT_PACKAGES, preparePublishDirectories } from './publish-dirs'

const root = process.cwd()
const corePackageJSON = await readPackageManifest(join(root, 'packages/core/package.json'))

await preparePublishDirectories({
  coreVersion: corePackageJSON.version,
  packages: DEFAULT_PACKAGES,
  root,
  log: (message) => process.stdout.write(`${message}\n`)
})
