import { describe, expect, test } from 'bun:test'

import {
  PLUGIN_MANIFEST_FORMAT,
  type PluginConnectorContractV1,
  type PluginManifestPayloadV1,
  type PluginManifestPayloadV2
} from '@open-pencil/core/plugins'

import {
  AIRTABLE_RECORDS_CONNECTOR_CONTRACT,
  AIRTABLE_RECORDS_CREDENTIAL_SLOT_ID,
  AIRTABLE_RECORDS_PLUGIN_ID
} from '@/app/plugins/connectors/airtable-records'
import { reconcileConnectorAuthorizations } from '@/app/plugins/connectors/app'
import { ConnectorAuthorizationRegistry } from '@/app/plugins/connectors/authorization'
import { RESEND_EMAIL_CONNECTOR_CONTRACT } from '@/app/plugins/connectors/resend-email'
import {
  connectorCredentialStatus,
  pluginConnectorControls,
  pluginConnectorControlsCopy,
  saveConnectorCredential
} from '@/app/plugins/connectors/settings-controls-model'
import { STRIPE_BILLING_CONNECTOR_CONTRACT } from '@/app/plugins/connectors/stripe-billing'
import {
  SUPABASE_BUSINESS_CONNECTOR_CONTRACT,
  SUPABASE_BUSINESS_ORIGIN_TEMPLATE
} from '@/app/plugins/connectors/supabase-business'
import {
  SUPABASE_SCHEMA_INSPECTOR_CONTRACT,
  SUPABASE_SCHEMA_INSPECTOR_CREDENTIAL_REFS,
  SUPABASE_SCHEMA_INSPECTOR_PAT_SLOT_ID
} from '@/app/plugins/connectors/supabase-schema-inspector'
import type { InstalledAppPlugin } from '@/app/plugins/types'
import { credentialRef } from '@/app/settings/credentials/reference'
import type { CredentialManager, CredentialRef } from '@/app/settings/credentials/types'

function v2Plugin(
  contract: PluginConnectorContractV1,
  digest = 'sha256-current'
): InstalledAppPlugin {
  const manifest: PluginManifestPayloadV2 = {
    format: PLUGIN_MANIFEST_FORMAT,
    schemaVersion: 2,
    plugin: { id: contract.pluginId, name: contract.name, version: '1.0.0' },
    publisher: { id: 'open-pencil', name: 'OpenPencil', keyId: 'open-pencil-key' },
    engineRange: '>=0.0.0',
    capabilities: [],
    contributions: { modules: [], connectors: [contract] }
  }
  return {
    package: { trustSource: 'app-bundle', manifest, digest },
    enabled: true,
    pinnedDigest: null
  }
}

function v1Plugin(): InstalledAppPlugin {
  const manifest: PluginManifestPayloadV1 = {
    format: PLUGIN_MANIFEST_FORMAT,
    schemaVersion: 1,
    plugin: { id: 'open-pencil.legacy', name: 'Legacy', version: '1.0.0' },
    publisher: { id: 'open-pencil', name: 'OpenPencil', keyId: 'open-pencil-key' },
    engineRange: '>=0.0.0',
    capabilities: [],
    contributions: { modules: [] }
  }
  return {
    package: { trustSource: 'app-bundle', manifest, digest: 'sha256-legacy' },
    enabled: true,
    pinnedDigest: null
  }
}

function manager(overrides: Partial<CredentialManager> = {}): CredentialManager {
  return {
    backend: 'memory',
    availability: async () => 'available',
    status: async () => 'missing',
    set: async () => undefined,
    clear: async () => undefined,
    ...overrides
  }
}

describe('plugin connector settings controls model', () => {
  test('shows only v2 connector manifests with fixed reviewed authority', () => {
    const authorization = new ConnectorAuthorizationRegistry()
    expect(pluginConnectorControls(v1Plugin(), authorization, 'en-US')).toEqual([])

    const [control] = pluginConnectorControls(
      v2Plugin(SUPABASE_SCHEMA_INSPECTOR_CONTRACT),
      authorization,
      'en-US'
    )
    expect(control?.connectorId).toBe('supabase.schema-inspector')
    expect(control?.adapterId).toBe('open-pencil.connector.supabase-schema-inspector')
    expect(control?.origins).toEqual(['https://api.supabase.com'])
    expect(control?.methods).toEqual(['GET'])
    expect(control?.operations.map(({ kind, request }) => [kind, request?.method])).toEqual([
      ['query', 'GET']
    ])
    expect(control?.hasMutation).toBe(false)
  })

  test('shows exact origins and reviewed origin templates without collapsing either authority', () => {
    const [control] = pluginConnectorControls(
      v2Plugin(SUPABASE_BUSINESS_CONNECTOR_CONTRACT),
      new ConnectorAuthorizationRegistry(),
      'zh-CN'
    )
    expect(control?.origins).toEqual([])
    expect(control?.originTemplates).toEqual([SUPABASE_BUSINESS_ORIGIN_TEMPLATE])
    expect(control?.operations.every(({ request }) => request?.origin === undefined)).toBe(true)
    expect(
      control?.operations.every(
        ({ request }) => request?.originTemplate === SUPABASE_BUSINESS_ORIGIN_TEMPLATE
      )
    ).toBe(true)
  })

  test('localizes bundled connector and operation copy in Simplified Chinese', () => {
    const authorization = new ConnectorAuthorizationRegistry()
    const [supabase] = pluginConnectorControls(
      v2Plugin(SUPABASE_BUSINESS_CONNECTOR_CONTRACT),
      authorization,
      'zh-CN'
    )
    expect(supabase?.name).toBe('Supabase 数据表')
    const supabaseQuery = supabase?.operations.find(
      ({ operationId }) => operationId === 'query-rows'
    )
    expect(supabaseQuery).toMatchObject({
      name: '查询数据行',
      description: expect.stringContaining('有界列'),
      help: {
        exampleJson: expect.stringContaining('project-ref')
      }
    })
    expect(supabaseQuery?.help.fields.find(({ path }) => path === 'projectRef')).toMatchObject({
      label: '项目引用',
      description: expect.stringContaining('Supabase 项目 URL')
    })
    expect(
      supabaseQuery?.help.fields.find(({ path }) => path === 'filters[].operator')
    ).toMatchObject({
      label: '筛选运算符',
      enumValues: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is']
    })

    const [stripe] = pluginConnectorControls(
      v2Plugin(STRIPE_BILLING_CONNECTOR_CONTRACT),
      authorization,
      'zh-CN'
    )
    expect(stripe?.name).toBe('Stripe 结账与计费')
    expect(
      stripe?.operations.find(({ operationId }) => operationId === 'create-checkout-session')
        ?.description
    ).toContain('每次执行')

    const [resend] = pluginConnectorControls(
      v2Plugin(RESEND_EMAIL_CONNECTOR_CONTRACT),
      authorization,
      'zh-CN'
    )
    expect(resend?.name).toBe('Resend 邮件')
    expect(
      resend?.operations.find(({ operationId }) => operationId === 'send-email')
    ).toMatchObject({
      name: '发送邮件',
      description: expect.stringContaining('附件')
    })
    expect(supabase?.credentials.map(({ label }) => label)).toEqual([
      'Supabase 可发布密钥',
      'Supabase 访问令牌'
    ])
    expect(stripe?.credentials[0]?.label).toBe('Stripe 密钥')
    expect(stripe?.credentials[0]?.description).toContain('凭据存储')
    expect(resend?.credentials[0]?.label).toBe('Resend API 密钥')
  })

  test('falls back to the signed manifest copy outside Simplified Chinese', () => {
    const [control] = pluginConnectorControls(
      v2Plugin(RESEND_EMAIL_CONNECTOR_CONTRACT),
      new ConnectorAuthorizationRegistry(),
      'en-US'
    )
    expect(control?.name).toBe(RESEND_EMAIL_CONNECTOR_CONTRACT.name)
    expect(control?.description).toBe(RESEND_EMAIL_CONNECTOR_CONTRACT.description)
    expect(control?.operations[0]?.name).toBe(RESEND_EMAIL_CONNECTOR_CONTRACT.operations[0]?.name)
    expect(control?.operations[0]?.help.fields[0]).toMatchObject({
      path: 'emailId',
      label: 'Email ID',
      description: expect.stringContaining('Resend ID')
    })
  })

  test('uses connector-scoped Supabase and Airtable credential references', () => {
    const authorization = new ConnectorAuthorizationRegistry()
    const [supabase] = pluginConnectorControls(
      v2Plugin(SUPABASE_SCHEMA_INSPECTOR_CONTRACT),
      authorization,
      'en-US'
    )
    expect(supabase?.credentials[0]?.reference).toEqual(
      SUPABASE_SCHEMA_INSPECTOR_CREDENTIAL_REFS[SUPABASE_SCHEMA_INSPECTOR_PAT_SLOT_ID]
    )

    const [airtable] = pluginConnectorControls(
      v2Plugin(AIRTABLE_RECORDS_CONNECTOR_CONTRACT),
      authorization,
      'en-US'
    )
    expect(airtable?.credentials[0]?.reference).toEqual(
      credentialRef(AIRTABLE_RECORDS_PLUGIN_ID, AIRTABLE_RECORDS_CREDENTIAL_SLOT_ID)
    )
  })

  test('binds authorization to the exact adapter contract and package digest', () => {
    const authorization = new ConnectorAuthorizationRegistry()
    const plugin = v2Plugin(AIRTABLE_RECORDS_CONNECTOR_CONTRACT, 'sha256-a')
    expect(pluginConnectorControls(plugin, authorization, 'en-US')[0]?.authorized).toBe(false)

    authorization.authorize(AIRTABLE_RECORDS_CONNECTOR_CONTRACT, 'sha256-a', 1)
    expect(pluginConnectorControls(plugin, authorization, 'en-US')[0]?.authorized).toBe(true)
    expect(
      pluginConnectorControls(
        v2Plugin(AIRTABLE_RECORDS_CONNECTOR_CONTRACT, 'sha256-b'),
        authorization,
        'en-US'
      )[0]?.authorized
    ).toBe(false)

    authorization.revoke(
      AIRTABLE_RECORDS_PLUGIN_ID,
      AIRTABLE_RECORDS_CONNECTOR_CONTRACT.connectorId
    )
    expect(pluginConnectorControls(plugin, authorization, 'en-US')[0]?.authorized).toBe(false)
  })

  test('revokes session authorization when a plugin is disabled, blocked, removed, or replaced', () => {
    const authorization = new ConnectorAuthorizationRegistry()
    const plugin = v2Plugin(AIRTABLE_RECORDS_CONNECTOR_CONTRACT, 'sha256-a')
    const authorize = () =>
      authorization.authorize(AIRTABLE_RECORDS_CONNECTOR_CONTRACT, 'sha256-a', 1)

    authorize()
    reconcileConnectorAuthorizations([plugin], authorization)
    expect(authorization.snapshot()).toHaveLength(1)

    reconcileConnectorAuthorizations([{ ...plugin, enabled: false }], authorization)
    expect(authorization.snapshot()).toEqual([])

    authorize()
    reconcileConnectorAuthorizations([{ ...plugin, blockedReason: 'blocked' }], authorization)
    expect(authorization.snapshot()).toEqual([])

    authorize()
    reconcileConnectorAuthorizations([], authorization)
    expect(authorization.snapshot()).toEqual([])

    authorize()
    reconcileConnectorAuthorizations(
      [v2Plugin(AIRTABLE_RECORDS_CONNECTOR_CONTRACT, 'sha256-b')],
      authorization
    )
    expect(authorization.snapshot()).toEqual([])
  })

  test('marks mutation connectors for a prominent per-session warning', () => {
    const operation = AIRTABLE_RECORDS_CONNECTOR_CONTRACT.operations[0]
    if (!operation?.request) throw new Error('Airtable reviewed request is unavailable')
    const mutationContract: PluginConnectorContractV1 = {
      ...AIRTABLE_RECORDS_CONNECTOR_CONTRACT,
      connectorId: 'airtable.records-writer',
      adapterId: 'open-pencil.connector.airtable-writer',
      network: { ...AIRTABLE_RECORDS_CONNECTOR_CONTRACT.network, methods: ['POST'] },
      operations: [
        {
          ...operation,
          operationId: 'create-record',
          kind: 'mutation',
          request: { ...operation.request, method: 'POST' }
        }
      ]
    }
    const [control] = pluginConnectorControls(
      v2Plugin(mutationContract),
      new ConnectorAuthorizationRegistry(),
      'en-US'
    )
    expect(control?.hasMutation).toBe(true)
    expect(control?.operations[0]?.kind).toBe('mutation')
  })

  test('clears the DOM-owned credential before calling set and never needs a resolver', async () => {
    const reference = credentialRef('open-pencil.airtable', 'access-token')
    const input = { value: 'test-token-value' }
    const calls: CredentialRef[] = []
    await saveConnectorCredential(
      manager({
        set: async (candidate) => {
          expect(input.value).toBe('')
          calls.push(candidate)
        }
      }),
      reference,
      input
    )
    expect(input.value).toBe('')
    expect(calls).toEqual([reference])

    const rejectedInput = { value: 'test-token-value' }
    await expect(
      saveConnectorCredential(
        manager({
          set: async () => {
            throw new Error('store unavailable')
          }
        }),
        reference,
        rejectedInput
      )
    ).rejects.toThrow('store unavailable')
    expect(rejectedInput.value).toBe('')
  })

  test('maps status failures to unavailable without reading a saved secret', async () => {
    const reference = credentialRef('open-pencil.airtable', 'access-token')
    expect(await connectorCredentialStatus(manager(), reference)).toBe('missing')
    expect(
      await connectorCredentialStatus(
        manager({
          status: async () => {
            throw new Error('locked')
          }
        }),
        reference
      )
    ).toBe('unavailable')
  })

  test('provides real English and Simplified Chinese session and mutation warnings', () => {
    const english = pluginConnectorControlsCopy('en-US')
    const chinese = pluginConnectorControlsCopy('zh-CN')
    expect(english.sessionAuthorization).toContain('this app session')
    expect(english.sessionAuthorization).toContain('connected MCP/AI clients')
    expect(english.sessionAuthorization).toContain('saved credential')
    expect(english.mutationWarning).toContain('change remote data')
    expect(english.executionOutcomeUnknown).toContain('Verify it in the service')
    expect(english.stopWaiting).toBe('Stop waiting')
    expect(english.mutationAttemptId).toBe('Mutation attempt ID')
    expect(english.originTemplate).toBe('Template origin')
    expect(english.configureRequiredCredentials).toContain('required credential')
    expect(chinese.sessionAuthorization).toContain('本次应用会话')
    expect(chinese.sessionAuthorization).toContain('已连接的 MCP/AI 客户端')
    expect(chinese.sessionAuthorization).toContain('已保存的凭据')
    expect(chinese.mutationWarning).toContain('修改远程数据')
    expect(chinese.executionOutcomeUnknown).toContain('远端结果未知')
    expect(chinese.executionOutcomeUnknown).toContain('服务中核验')
    expect(chinese.stopWaiting).toBe('停止等待')
    expect(chinese.mutationAttemptId).toBe('变更操作标识')
    expect(chinese.originTemplate).toBe('模板来源')
    expect(chinese.configureRequiredCredentials).toContain('必填凭据')
    expect(chinese.save).toBe('保存凭据')
  })

  test('keeps secrets out of Vue reactive state and does not access the resolver', async () => {
    const source = await Bun.file(
      'src/components/settings/plugins/PluginConnectorControls.vue'
    ).text()
    expect(source).toContain('type="password"')
    expect(source).not.toContain('v-model')
    expect(source).not.toContain('appCredentialServices.resolver')
    expect(source).not.toContain('.read(')
    expect(source).toContain('appCredentialServices.manager')
    expect(source).toContain('v-if="connector.hasMutation"')
    expect(source).toContain('connector.originTemplates')
    expect(source).toContain('operation.request.originTemplate')
    expect(source).toContain('PluginConnectorOperationRunner')
    expect(source).toContain(
      'appConnectorAuthorization.revoke(connector.contract.pluginId, connector.connectorId)'
    )
    const saveBlock = source.slice(
      source.indexOf('async function saveCredential'),
      source.indexOf('async function clearCredential')
    )
    expect(saveBlock).toContain('await saveConnectorCredential')
    expect(saveBlock).toContain(
      'appConnectorAuthorization.revoke(connector.contract.pluginId, connector.connectorId)'
    )
    expect(source).toContain(':disabled="!requiredCredentialsConfigured(connector)"')
    expect(source).toContain(':aria-describedby=')
    expect(source).toContain('authorizationHelpId(connector)')
    expect(source).toContain('{{ copy.configureRequiredCredentials }}')
    expect(source).toContain('if (!requiredCredentialsConfigured(connector))')
    expect(source).toContain('role="alert"')
  })
})
