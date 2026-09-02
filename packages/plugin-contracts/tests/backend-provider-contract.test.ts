import { describe, expect, test } from 'bun:test'

import { parsePluginBackendProviderContribution } from '@open-pencil/plugin-contracts'
import { parsePluginBackendProviderConfiguration } from '@open-pencil/plugin-contracts/adapter-helpers'

import { pluginBackendProviderContribution } from './helpers'

function stripeSecretCanary(suffix: string): string {
  return ['sk', 'live', suffix].join('_')
}

function backendProviderError(value: unknown): string {
  try {
    parsePluginBackendProviderContribution(value)
  } catch (cause) {
    if (cause instanceof TypeError) return cause.message
    throw cause
  }
  throw new Error('Expected backend provider contribution parsing to fail')
}

function backendProviderConfigurationError(
  contribution: ReturnType<typeof pluginBackendProviderContribution>,
  value: unknown
): string {
  try {
    parsePluginBackendProviderConfiguration(contribution, value)
  } catch (cause) {
    if (cause instanceof TypeError) return cause.message
    throw cause
  }
  throw new Error('Expected backend provider configuration parsing to fail')
}

function contributionWithSchemaText(
  field: 'title' | 'description',
  value: string
): ReturnType<typeof pluginBackendProviderContribution> {
  const contribution = structuredClone(pluginBackendProviderContribution())
  const region = contribution.configuration.schema.properties.region
  if (!region) throw new Error('Backend provider fixture requires a region schema')
  Reflect.set(region, field, value)
  return contribution
}

function contributionWithStringEnum(
  value: string
): ReturnType<typeof pluginBackendProviderContribution> {
  const contribution = structuredClone(pluginBackendProviderContribution())
  const region = contribution.configuration.schema.properties.region
  if (!region) throw new Error('Backend provider fixture requires a region schema')
  Reflect.set(region, 'enum', [value])
  return contribution
}

function contributionWithNestedStringValues(): ReturnType<
  typeof pluginBackendProviderContribution
> {
  const contribution = structuredClone(pluginBackendProviderContribution())
  const properties = contribution.configuration.schema.properties
  const region = properties.region
  const options = properties.options
  if (!region || !options || options.type !== 'object') {
    throw new Error('Backend provider fixture requires region and options schemas')
  }
  Reflect.deleteProperty(region, 'enum')
  Reflect.set(options.properties, 'label', { type: 'string' })
  Reflect.set(properties, 'tags', { type: 'array', items: { type: 'string' } })
  return contribution
}

describe('backend provider declaration contract', () => {
  test('normalizes a bounded data-only declaration and validates adapter configuration', () => {
    const contribution = pluginBackendProviderContribution()
    expect(parsePluginBackendProviderContribution(contribution)).toEqual(contribution)

    const value = {
      options: { enabled: true },
      projectRef: 'project-1',
      region: 'us-east-1'
    }
    const parsed = parsePluginBackendProviderConfiguration(contribution, value)
    expect(parsed).toEqual(value)
    expect(parsed).not.toBe(value)
    expect(Object.isFrozen(parsed)).toBe(true)
    expect(Object.isFrozen(parsed.options)).toBe(true)
    expect(Reflect.set(parsed, 'region', 'ap-southeast-1')).toBe(false)
    expect(value.region).toBe('us-east-1')
    expect(() =>
      parsePluginBackendProviderConfiguration(contribution, {
        ...value,
        accessToken: 'must-not-enter-provider-configuration'
      })
    ).toThrow('not supported')
  })

  test('rejects future versions, unknown authority, and executable fields', () => {
    const futureContract = structuredClone(pluginBackendProviderContribution())
    Reflect.set(futureContract, 'contractVersion', 2)
    expect(() => parsePluginBackendProviderContribution(futureContract)).toThrow('contractVersion')

    const futureModel = structuredClone(pluginBackendProviderContribution())
    Reflect.set(futureModel, 'supportedModelVersions', [2])
    expect(() => parsePluginBackendProviderContribution(futureModel)).toThrow(
      'supported backend model version'
    )

    const invalidAdapter = structuredClone(pluginBackendProviderContribution())
    Reflect.set(invalidAdapter, 'adapterId', 'Hostile/Adapter')
    expect(() => parsePluginBackendProviderContribution(invalidAdapter)).toThrow(
      'stable lowercase identifier'
    )

    for (const field of ['providerId', 'contributionId', 'adapterId'] as const) {
      const secretIdentifier = stripeSecretCanary('abcdefghijklmnopqrstuv')
      const contribution = structuredClone(pluginBackendProviderContribution())
      Reflect.set(contribution, field, secretIdentifier)
      const message = backendProviderError(contribution)
      expect(message).toContain('small inert symbolic value')
      expect(message).not.toContain(secretIdentifier)
    }

    const unknownCapability = structuredClone(pluginBackendProviderContribution())
    Reflect.set(unknownCapability, 'capabilities', ['network.fetch'])
    expect(() => parsePluginBackendProviderContribution(unknownCapability)).toThrow(
      'backend capability'
    )

    const unknownOutput = structuredClone(pluginBackendProviderContribution())
    Reflect.set(unknownOutput, 'outputKinds', ['shell-script'])
    expect(() => parsePluginBackendProviderContribution(unknownOutput)).toThrow(
      'backend output kind'
    )

    const permission = structuredClone(pluginBackendProviderContribution())
    Reflect.set(permission, 'permissions', ['network'])
    expect(() => parsePluginBackendProviderContribution(permission)).toThrow('more than 0 entries')

    for (const field of [
      'executor',
      'code',
      'sql',
      'url',
      'endpoint',
      'token',
      'secret',
      'command',
      'network'
    ]) {
      const executable = structuredClone(pluginBackendProviderContribution())
      Reflect.set(executable, field, 'hostile value')
      expect(() => parsePluginBackendProviderContribution(executable)).toThrow('unsupported fields')
    }
  })

  test('requires closed data-only configuration schemas', () => {
    for (const propertyName of [
      'endpoint',
      'projectUrl',
      'accessToken',
      'clientSecret',
      'password',
      'privateKey',
      'serviceRoleKey',
      'adminKey',
      'rootDbKey',
      'serviceKey',
      'roleKey',
      'clientsecret',
      'accesstoken',
      'databaseurl',
      'servicerolekey',
      'authorizationHeader',
      'bearer',
      'connectionString',
      'dsn',
      'databaseHost',
      'apiOrigin',
      'rootAccess',
      'oauthClient',
      'certificatePem',
      'passphrase',
      'migrationSql',
      'deployCommand',
      'executorScript',
      'network',
      'customCode',
      'javascriptModule',
      'shellCommand',
      'nativeDriver',
      'filesystemPath',
      'processId'
    ]) {
      const contribution = structuredClone(pluginBackendProviderContribution())
      Reflect.set(contribution.configuration.schema.properties, propertyName, {
        type: 'string'
      })
      expect(() => parsePluginBackendProviderContribution(contribution)).toThrow(
        'must not request endpoint, credential, code, or command authority'
      )
    }

    const open = structuredClone(pluginBackendProviderContribution())
    Reflect.set(open.configuration.schema, 'additionalProperties', true)
    expect(() => parsePluginBackendProviderContribution(open)).toThrow('must be false')

    const defaultValue = structuredClone(pluginBackendProviderContribution())
    Reflect.set(defaultValue.configuration.schema.properties.projectRef ?? {}, 'default', 'secret')
    expect(() => parsePluginBackendProviderContribution(defaultValue)).toThrow('is not supported')

    const unsafeEnum = structuredClone(pluginBackendProviderContribution())
    Reflect.set(unsafeEnum.configuration.schema.properties.region ?? {}, 'enum', [
      'https://hostile.example'
    ])
    expect(() => parsePluginBackendProviderContribution(unsafeEnum)).toThrow(
      'small inert symbolic value'
    )

    const oversizedConfiguration = structuredClone(pluginBackendProviderContribution())
    Reflect.set(oversizedConfiguration.configuration, 'maxBytes', 64 * 1024 + 1)
    expect(() => parsePluginBackendProviderContribution(oversizedConfiguration)).toThrow(
      'maxBytes must be between'
    )
  })

  test('rejects URL, secret, SQL, JavaScript, shell, and deployment material without echo', () => {
    const unsafeDescriptions = [
      'Read configuration from https://hostile.example/provider',
      'Read provider details from evil.ai/path',
      'Read provider details from backend.tech/setup',
      'Read provider details from xn--bcher-kva.example/path',
      'Read provider details from [2001:db8::1]/setup',
      'Read provider details from 192.0.2.1/setup',
      `Use ${stripeSecretCanary('ExampleSecret1234567890')} for access`,
      'Run DROP TABLE customer_records before generation',
      'Run javascript eval(payload) in the adapter',
      'Run bun deploy from a shell command'
    ]
    for (const unsafeValue of unsafeDescriptions) {
      const contribution = structuredClone(pluginBackendProviderContribution())
      Reflect.set(contribution, 'description', unsafeValue)
      const message = backendProviderError(contribution)
      expect(message).toContain('inert data text')
      expect(message).not.toContain(unsafeValue)
    }

    const unsafeName = 'Backend at https://hostile.example'
    const named = structuredClone(pluginBackendProviderContribution())
    Reflect.set(named, 'name', unsafeName)
    expect(backendProviderError(named)).not.toContain(unsafeName)

    for (const [field, unsafeValue] of [
      ['title', 'Open https://hostile.example/settings'],
      ['description', `Paste ${stripeSecretCanary('ExampleSecret1234567890')} here`],
      ['title', 'run shell javascript eval'],
      ['description', 'DROP_TABLE then deploy-command']
    ] as const) {
      const message = backendProviderError(contributionWithSchemaText(field, unsafeValue))
      expect(message).toContain('inert data text')
      expect(message).not.toContain(unsafeValue)
    }

    for (const unsafeValue of [
      'https://hostile.example',
      'evil.ai',
      'backend.tech',
      'xn--bcher-kva.example',
      '192.0.2.1',
      '2001:db8::1',
      'sk\u200b_live_ExampleSecret1234567890',
      stripeSecretCanary('ExampleSecret1234567890'),
      'DROP_TABLE',
      'javascript',
      'eval',
      'run-shell',
      'deploy-production',
      'A7fK2mP9qR4sT8vW3xY6zB1cD5eF0gH'
    ]) {
      const message = backendProviderError(contributionWithStringEnum(unsafeValue))
      expect(message).toContain('small inert symbolic value')
      expect(message).not.toContain(unsafeValue)
    }

    const secretPropertyName = stripeSecretCanary('ExampleSecret1234567890')
    const secretProperty = structuredClone(pluginBackendProviderContribution())
    Reflect.set(secretProperty.configuration.schema.properties, secretPropertyName, {
      type: 'string'
    })
    expect(backendProviderError(secretProperty)).not.toContain(secretPropertyName)
  })

  test('rejects authority material in every nested configuration string without echo', () => {
    const contribution = contributionWithNestedStringValues()
    const shellExpansionCommand = ['touch$', '{IFS}/tmp/pwned'].join('')
    const safeValue = {
      options: { enabled: true, label: 'reviewed-artifact' },
      projectRef: 'project-abcdefghijklmnopqrst',
      region: 'us-east-1',
      tags: ['preview', 'release-v2']
    }
    const parsed = parsePluginBackendProviderConfiguration(contribution, safeValue)
    expect(parsed).toEqual(safeValue)
    expect(Object.isFrozen(parsed.tags)).toBe(true)

    const opaqueProjectRef = 'PrjA7fK2mP9qR4sT8vW3xY6zB1cD5eF0gH'
    expect(
      parsePluginBackendProviderConfiguration(contribution, {
        ...safeValue,
        projectRef: opaqueProjectRef
      }).projectRef
    ).toBe(opaqueProjectRef)

    for (const label of ['id', 'open-pencil reviewed adapter', 'cat photo']) {
      expect(
        parsePluginBackendProviderConfiguration(contribution, {
          ...safeValue,
          options: { enabled: true, label }
        }).options
      ).toEqual({ enabled: true, label })
    }

    const unsafeCases = [
      {
        value: {
          ...safeValue,
          projectRef: stripeSecretCanary('configurationcanary1234567890')
        },
        sensitive: stripeSecretCanary('configurationcanary1234567890')
      },
      {
        value: { ...safeValue, projectRef: 'https://evil.ai/project' },
        sensitive: 'https://evil.ai/project'
      },
      {
        value: { ...safeValue, region: 'backend.tech/region' },
        sensitive: 'backend.tech/region'
      },
      {
        value: {
          ...safeValue,
          tags: ['preview', 'DROP TABLE customer_records']
        },
        sensitive: 'DROP TABLE customer_records'
      },
      {
        value: { ...safeValue, tags: ['preview', 'javascript eval(payload)'] },
        sensitive: 'javascript eval(payload)'
      },
      {
        value: {
          ...safeValue,
          tags: ['preview', 'A7fK2mP9qR4sT8vW3xY6zB1cD5eF0gH']
        },
        sensitive: 'A7fK2mP9qR4sT8vW3xY6zB1cD5eF0gH'
      },
      {
        value: {
          ...safeValue,
          options: { enabled: true, label: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' }
        },
        sensitive: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
      },
      {
        value: {
          ...safeValue,
          options: { enabled: true, label: 'run shell deploy command' }
        },
        sensitive: 'run shell deploy command'
      },
      {
        value: { ...safeValue, options: { enabled: true, label: '$(whoami)' } },
        sensitive: '$(whoami)'
      },
      {
        value: { ...safeValue, options: { enabled: true, label: '`whoami`' } },
        sensitive: '`whoami`'
      },
      {
        value: {
          ...safeValue,
          options: { enabled: true, label: '; touch /tmp/pwned' }
        },
        sensitive: '; touch /tmp/pwned'
      },
      {
        value: { ...safeValue, options: { enabled: true, label: 'whoami' } },
        sensitive: 'whoami'
      },
      {
        value: {
          ...safeValue,
          options: { enabled: true, label: 'sh -c whoami' }
        },
        sensitive: 'sh -c whoami'
      },
      {
        value: {
          ...safeValue,
          options: { enabled: true, label: '/bin/sh -c touch /tmp/pwned' }
        },
        sensitive: '/bin/sh -c touch /tmp/pwned'
      },
      {
        value: {
          ...safeValue,
          options: { enabled: true, label: 'python -c print(1)' }
        },
        sensitive: 'python -c print(1)'
      },
      {
        value: {
          ...safeValue,
          options: { enabled: true, label: 'touch /tmp/pwned' }
        },
        sensitive: 'touch /tmp/pwned'
      },
      {
        value: {
          ...safeValue,
          options: { enabled: true, label: 'cat /etc/passwd' }
        },
        sensitive: 'cat /etc/passwd'
      },
      {
        value: {
          ...safeValue,
          options: { enabled: true, label: 'open /tmp/pwned' }
        },
        sensitive: 'open /tmp/pwned'
      },
      {
        value: {
          ...safeValue,
          options: { enabled: true, label: shellExpansionCommand }
        },
        sensitive: shellExpansionCommand
      }
    ]
    for (const { value, sensitive } of unsafeCases) {
      const message = backendProviderConfigurationError(contribution, value)
      expect(message).toContain('inert data text')
      expect(message).not.toContain(sensitive)
    }
  })

  test('accepts bounded inert prose and small symbolic configuration vocabularies', () => {
    const contribution = structuredClone(pluginBackendProviderContribution())
    Reflect.set(
      contribution,
      'description',
      'Emits reviewed relational backend artifacts through a trusted compiler adapter.'
    )
    Reflect.set(contribution.configuration.schema, 'title', 'Reviewed backend settings')
    Reflect.set(
      contribution.configuration.schema,
      'description',
      'Choose reviewed settings for deterministic generated artifacts.'
    )
    const region = contribution.configuration.schema.properties.region
    if (!region) throw new Error('Backend provider fixture requires a region schema')
    Reflect.set(region, 'title', 'Deployment region')
    Reflect.set(region, 'description', 'Choose one reviewed symbolic region identifier.')
    Reflect.set(region, 'enum', ['ap-southeast-1', 'read-only', 'strict_v2', 'v2'])
    Reflect.set(contribution.configuration.schema.properties, 'version', {
      type: 'integer',
      enum: [1, 2]
    })

    const parsed = parsePluginBackendProviderContribution(contribution)
    expect(parsed.description).toBe(contribution.description)
    expect(parsed.configuration.schema.title).toBe('Reviewed backend settings')
    expect(parsed.configuration.schema.properties.region?.enum).toEqual([
      'ap-southeast-1',
      'read-only',
      'strict_v2',
      'v2'
    ])
    expect(parsed.configuration.schema.properties.version?.enum).toEqual([1, 2])

    const tooManySymbols = structuredClone(pluginBackendProviderContribution())
    const symbolSchema = tooManySymbols.configuration.schema.properties.region
    if (!symbolSchema) throw new Error('Backend provider fixture requires a region schema')
    Reflect.set(
      symbolSchema,
      'enum',
      Array.from({ length: 33 }, (_, index) => `region-${String(index)}`)
    )
    expect(() => parsePluginBackendProviderContribution(tooManySymbols)).toThrow(
      'at most 32 symbolic values'
    )
  })

  test('enforces identifier, text, and non-empty declaration bounds', () => {
    const oversizedId = structuredClone(pluginBackendProviderContribution())
    Reflect.set(oversizedId, 'providerId', 'a'.repeat(65))
    expect(() => parsePluginBackendProviderContribution(oversizedId)).toThrow(
      'stable lowercase identifier'
    )

    const emptyName = structuredClone(pluginBackendProviderContribution())
    Reflect.set(emptyName, 'name', '   ')
    expect(() => parsePluginBackendProviderContribution(emptyName)).toThrow('1 to 128 characters')

    const oversizedName = structuredClone(pluginBackendProviderContribution())
    Reflect.set(oversizedName, 'name', 'n'.repeat(129))
    expect(() => parsePluginBackendProviderContribution(oversizedName)).toThrow(
      'at most 128 characters'
    )

    const oversizedDescription = structuredClone(pluginBackendProviderContribution())
    Reflect.set(oversizedDescription, 'description', 'd'.repeat(1_001))
    expect(() => parsePluginBackendProviderContribution(oversizedDescription)).toThrow(
      'at most 1000 characters'
    )

    const emptyCapabilities = structuredClone(pluginBackendProviderContribution())
    Reflect.set(emptyCapabilities, 'capabilities', [])
    expect(() => parsePluginBackendProviderContribution(emptyCapabilities)).toThrow(
      'capabilities must not be empty'
    )

    const emptyOutputKinds = structuredClone(pluginBackendProviderContribution())
    Reflect.set(emptyOutputKinds, 'outputKinds', [])
    expect(() => parsePluginBackendProviderContribution(emptyOutputKinds)).toThrow(
      'outputKinds must not be empty'
    )

    const undersizedConfiguration = structuredClone(pluginBackendProviderContribution())
    Reflect.set(undersizedConfiguration.configuration, 'maxBytes', 1)
    expect(() => parsePluginBackendProviderContribution(undersizedConfiguration)).toThrow(
      'maxBytes must be between'
    )
  })

  test('requires unique canonical arrays and inert plain data input', () => {
    const duplicateCapability = structuredClone(pluginBackendProviderContribution())
    Reflect.set(duplicateCapability, 'capabilities', ['data.read', 'data.read'])
    expect(() => parsePluginBackendProviderContribution(duplicateCapability)).toThrow(
      'duplicate backend capability'
    )

    const unsortedCapabilities = structuredClone(pluginBackendProviderContribution())
    Reflect.set(unsortedCapabilities, 'capabilities', ['data.write', 'data.read'])
    expect(() => parsePluginBackendProviderContribution(unsortedCapabilities)).toThrow(
      'sorted in ascending order'
    )

    const duplicateOutput = structuredClone(pluginBackendProviderContribution())
    Reflect.set(duplicateOutput, 'outputKinds', ['database-schema', 'database-schema'])
    expect(() => parsePluginBackendProviderContribution(duplicateOutput)).toThrow(
      'duplicate backend output kind'
    )

    let getterCalls = 0
    const accessor = { ...pluginBackendProviderContribution() }
    Object.defineProperty(accessor, 'adapterId', {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'hostile.adapter'
      }
    })
    expect(() => parsePluginBackendProviderContribution(accessor)).toThrow(
      'enumerable data property'
    )

    const schemaCanary = stripeSecretCanary('schemaaccessorkeycanary0123456789')
    const schemaAccessor = structuredClone(pluginBackendProviderContribution())
    Object.defineProperty(schemaAccessor.configuration.schema, schemaCanary, {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'untrusted'
      }
    })
    const schemaMessage = backendProviderError(schemaAccessor)
    expect(schemaMessage).toContain('enumerable data property')
    expect(schemaMessage).not.toContain(schemaCanary)

    const highEntropyKey = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY'
    const highEntropyKeyContribution = structuredClone(pluginBackendProviderContribution())
    Reflect.set(highEntropyKeyContribution.configuration.schema, highEntropyKey, 'untrusted')
    const highEntropyKeyMessage = backendProviderError(highEntropyKeyContribution)
    expect(highEntropyKeyMessage).toContain('enumerable data property')
    expect(highEntropyKeyMessage).not.toContain(highEntropyKey)
    expect(getterCalls).toBe(0)
  })

  test('rejects untrusted configuration objects without invoking accessors', () => {
    const contribution = pluginBackendProviderContribution()
    let getterCalls = 0
    const accessorCanary = stripeSecretCanary('configurationaccessorkeycanary0123456789')
    const accessor = { options: { enabled: true }, region: 'us-east-1' }
    Object.defineProperty(accessor, accessorCanary, {
      enumerable: true,
      get() {
        getterCalls += 1
        return 'untrusted'
      }
    })
    const accessorMessage = backendProviderConfigurationError(contribution, accessor)
    expect(accessorMessage).toContain('JSON data properties')
    expect(accessorMessage).not.toContain(accessorCanary)
    expect(getterCalls).toBe(0)

    const symbolValue = {
      options: { enabled: true },
      projectRef: 'project-1',
      region: 'us-east-1',
      [Symbol('secret')]: 'hidden'
    }
    expect(() => parsePluginBackendProviderConfiguration(contribution, symbolValue)).toThrow(
      'symbol properties'
    )

    const customPrototype = Object.assign(Object.create({ inherited: true }), {
      options: { enabled: true },
      projectRef: 'project-1',
      region: 'us-east-1'
    })
    expect(() => parsePluginBackendProviderConfiguration(contribution, customPrototype)).toThrow(
      'plain object'
    )

    const cyclic: Record<string, unknown> = {
      projectRef: 'project-1',
      region: 'us-east-1'
    }
    cyclic.options = cyclic
    expect(() => parsePluginBackendProviderConfiguration(contribution, cyclic)).toThrow(
      'circular values'
    )

    const withArray = structuredClone(contribution)
    Reflect.set(withArray.configuration.schema.properties, 'tags', {
      type: 'array',
      items: { type: 'string' }
    })
    const sparse: string[] = []
    sparse.length = 2
    sparse[0] = 'one'
    expect(() =>
      parsePluginBackendProviderConfiguration(withArray, {
        options: { enabled: true },
        projectRef: 'project-1',
        region: 'us-east-1',
        tags: sparse
      })
    ).toThrow('array holes')
  })
})
