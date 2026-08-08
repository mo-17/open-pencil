export const storageArgs = {
  database: {
    type: 'string',
    default: '.openpencil-marketplace/marketplace.sqlite',
    description: 'Marketplace SQLite state path'
  },
  artifacts: {
    type: 'string',
    default: '.openpencil-marketplace/artifacts',
    description: 'Marketplace immutable artifact directory'
  },
  'marketplace-id': {
    type: 'string',
    default: 'openpencil-marketplace',
    description: 'Stable marketplace identity'
  },
  'public-base-url': {
    type: 'string',
    default: 'https://plugins.example.com/',
    description: 'Canonical public HTTPS marketplace origin'
  },
  json: {
    type: 'boolean',
    default: false,
    description: 'Output structured JSON'
  }
} as const

export const privateKeyArgs = {
  'private-key': {
    type: 'string',
    description: 'Root Ed25519 PKCS8 PEM private key file'
  },
  'private-key-env': {
    type: 'string',
    description: 'Environment variable containing the root private key'
  }
} as const

export const publicKeyArgs = {
  'public-key': {
    type: 'string',
    description: 'Root Ed25519 SPKI PEM public key file'
  },
  'public-key-env': {
    type: 'string',
    description: 'Environment variable containing the root public key'
  }
} as const

export const publisherSigningKeyArgs = {
  'key-id': { type: 'string', required: true },
  'public-key': { type: 'string', required: true }
} as const

export const publisherKeyValidityArgs = {
  'not-before': { type: 'string', required: true },
  'not-after': { type: 'string', required: true }
} as const

const statusTransitionArgs = {
  status: { type: 'string', required: true },
  reason: { type: 'string' },
  actor: { type: 'string' }
} as const

export const idStatusTransitionArgs = {
  ...storageArgs,
  id: { type: 'positional', required: true },
  ...statusTransitionArgs
} as const

export const pluginStatusTransitionArgs = {
  ...storageArgs,
  plugin: { type: 'positional', required: true },
  ...statusTransitionArgs
} as const

export interface StorageArguments {
  database: string
  artifacts: string
  'marketplace-id': string
  'public-base-url': string
  json: boolean
}

export interface PrivateKeyArguments {
  'private-key'?: string
  'private-key-env'?: string
}

export interface PublicKeyArguments {
  'public-key'?: string
  'public-key-env'?: string
}

export interface PublisherKeyArguments {
  'key-id': string
  'public-key': string
  'not-before': string
  'not-after': string
}

export interface PublisherKeyMutationArguments extends StorageArguments, PublisherKeyArguments {
  actor?: string
}

export interface StatusTransitionArguments extends StorageArguments {
  status: string
  reason?: string
  actor?: string
}
