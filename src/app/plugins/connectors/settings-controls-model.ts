import {
  parsePluginConnectorContract,
  type PluginConnectorContractV1,
  type PluginConnectorOperationKindV1,
  type PluginConnectorOperationRequestV1,
  type PluginConnectorOperationV1
} from '@open-pencil/core/plugins'
import type { Locale } from '@open-pencil/vue'

import { localizedAppPluginContributionText } from '@/app/plugins/localization'
import { credentialRef } from '@/app/settings/credentials/reference'
import type {
  CredentialManager,
  CredentialRef,
  CredentialStatus
} from '@/app/settings/credentials/types'

import type { InstalledAppPlugin } from '../types'
import type { ConnectorAuthorizationRegistry } from './authorization'
import { connectorOperationHelp, type ConnectorOperationHelp } from './operation/help'

export type PluginConnectorCredentialControl = Readonly<{
  slotId: string
  label: string
  kind: 'api-key' | 'bearer-token' | 'oauth2'
  required: boolean
  reference: CredentialRef
}>

export type PluginConnectorOperationControl = Readonly<{
  contract: PluginConnectorOperationV1
  operationId: string
  name: string
  description: string
  kind: PluginConnectorOperationKindV1
  request: PluginConnectorOperationRequestV1 | null
  credentialSlotIds: readonly string[]
  help: ConnectorOperationHelp
}>

export type PluginConnectorControl = Readonly<{
  contract: PluginConnectorContractV1
  packageDigest: string
  connectorId: string
  adapterId: string
  name: string
  description: string
  origins: readonly string[]
  originTemplates: readonly string[]
  methods: readonly string[]
  credentials: readonly PluginConnectorCredentialControl[]
  operations: readonly PluginConnectorOperationControl[]
  hasMutation: boolean
  authorized: boolean
}>

type AuthorizationReader = Pick<ConnectorAuthorizationRegistry, 'isAuthorized'>

export type PluginConnectorControlsCopy = Readonly<{
  title: string
  description: string
  origin: string
  originTemplate: string
  method: string
  path: string
  query: string
  mutation: string
  assetSearch: string
  assetRead: string
  credential: string
  required: string
  optional: string
  configured: string
  missing: string
  locked: string
  unavailable: string
  save: string
  clear: string
  authorize: string
  revoke: string
  authorized: string
  notAuthorized: string
  sessionAuthorization: string
  mutationWarning: string
  adapterUnavailable: string
  pluginUnavailable: string
  credentialPlaceholder: string
  credentialActionFailed: string
  authorizationActionFailed: string
  requestUnavailable: string
  parametersJson: string
  requiredFields: string
  noRequiredFields: string
  maximumBytes: string
  parameterGuide: string
  constraints: string
  example: string
  fillExample: string
  guideTruncated: string
  runQuery: string
  reviewMutation: string
  confirmMutation: string
  cancel: string
  cancelReview: string
  running: string
  result: string
  reviewTitle: string
  reviewWarning: string
  packageDigest: string
  parameterBytes: string
  parameterFingerprint: string
  mutationAttemptId: string
  invalidParameters: string
  connectorChanged: string
  executionFailed: string
  executionCancelled: string
  executionOutcomeUnknown: string
  stopWaiting: string
  outcomeUnknownNoticesTitle: string
  outcomeUnknownPlugin: string
  outcomeUnknownConnector: string
  outcomeUnknownOperation: string
  dismiss: string
}>

const ENGLISH_COPY: PluginConnectorControlsCopy = Object.freeze({
  title: 'Connector access',
  description: 'Review fixed network authority, credentials, and operations before use.',
  origin: 'Fixed origin',
  originTemplate: 'Template origin',
  method: 'Fixed method',
  path: 'Fixed path',
  query: 'Query',
  mutation: 'Mutation',
  assetSearch: 'Asset search',
  assetRead: 'Asset read',
  credential: 'Credential',
  required: 'Required',
  optional: 'Optional',
  configured: 'Configured',
  missing: 'Not configured',
  locked: 'Credential store locked',
  unavailable: 'Credential store unavailable',
  save: 'Save credential',
  clear: 'Clear',
  authorize: 'Authorize',
  revoke: 'Revoke',
  authorized: 'Authorized',
  notAuthorized: 'Not authorized',
  sessionAuthorization:
    'Authorization applies to this app session. Eligible read-only GET queries also become available to connected MCP/AI clients using the saved credential.',
  mutationWarning:
    'Mutation operations can change remote data and require confirmation on every run.',
  adapterUnavailable: 'The reviewed host adapter is unavailable.',
  pluginUnavailable: 'Enable and unblock this plugin before authorizing its connector.',
  credentialPlaceholder: 'Paste token or API key',
  credentialActionFailed: 'Credential operation failed.',
  authorizationActionFailed: 'Connector authorization failed.',
  requestUnavailable: 'No executable request authority is declared.',
  parametersJson: 'Parameters (JSON)',
  requiredFields: 'Required fields',
  noRequiredFields: 'None',
  maximumBytes: 'Maximum bytes',
  parameterGuide: 'Parameter guide',
  constraints: 'Constraints',
  example: 'Example',
  fillExample: 'Fill example',
  guideTruncated: 'Additional fields are omitted from this bounded guide.',
  runQuery: 'Run query',
  reviewMutation: 'Review mutation',
  confirmMutation: 'Confirm and run',
  cancel: 'Cancel run',
  cancelReview: 'Cancel review',
  running: 'Running…',
  result: 'Result',
  reviewTitle: 'Mutation review',
  reviewWarning: 'Verify this fixed authority and operation before the second confirmation.',
  packageDigest: 'Package digest',
  parameterBytes: 'Parameter bytes',
  parameterFingerprint: 'Parameter fingerprint',
  mutationAttemptId: 'Mutation attempt ID',
  invalidParameters: 'Enter valid JSON that matches the declared parameter schema.',
  connectorChanged: 'The connector or parameters changed. Review the mutation again.',
  executionFailed: 'Connector execution failed.',
  executionCancelled: 'Connector execution was cancelled.',
  executionOutcomeUnknown:
    'The mutation request was sent, but its remote outcome is unknown. Verify it in the service before retrying.',
  stopWaiting: 'Stop waiting',
  outcomeUnknownNoticesTitle: 'Remote outcomes need verification',
  outcomeUnknownPlugin: 'Plugin',
  outcomeUnknownConnector: 'Connector',
  outcomeUnknownOperation: 'Operation',
  dismiss: 'Dismiss'
})

const SIMPLIFIED_CHINESE_COPY: PluginConnectorControlsCopy = Object.freeze({
  title: '连接器访问权限',
  description: '使用前请检查固定网络权限、凭据和操作类型。',
  origin: '固定来源',
  originTemplate: '模板来源',
  method: '固定方法',
  path: '固定路径',
  query: '查询',
  mutation: '变更',
  assetSearch: '资源搜索',
  assetRead: '资源读取',
  credential: '凭据',
  required: '必填',
  optional: '可选',
  configured: '已配置',
  missing: '未配置',
  locked: '凭据存储已锁定',
  unavailable: '凭据存储不可用',
  save: '保存凭据',
  clear: '清除',
  authorize: '授权',
  revoke: '撤销',
  authorized: '已授权',
  notAuthorized: '未授权',
  sessionAuthorization:
    '授权仅在本次应用会话中有效。符合条件的只读 GET 查询也会使用已保存的凭据向已连接的 MCP/AI 客户端开放。',
  mutationWarning: '变更操作可以修改远程数据，并且每次运行都需要再次确认。',
  adapterUnavailable: '经过审核的宿主适配器不可用。',
  pluginUnavailable: '请先启用并解除此插件的阻止状态，再授权连接器。',
  credentialPlaceholder: '粘贴令牌或 API 密钥',
  credentialActionFailed: '凭据操作失败。',
  authorizationActionFailed: '连接器授权失败。',
  requestUnavailable: '未声明可执行的请求权限。',
  parametersJson: '参数（JSON）',
  requiredFields: '必填字段',
  noRequiredFields: '无',
  maximumBytes: '最大字节数',
  parameterGuide: '参数指南',
  constraints: '约束',
  example: '示例',
  fillExample: '填入示例',
  guideTruncated: '其余字段已从这份有界指南中省略。',
  runQuery: '运行查询',
  reviewMutation: '审核变更',
  confirmMutation: '确认并运行',
  cancel: '取消运行',
  cancelReview: '取消审核',
  running: '运行中…',
  result: '结果',
  reviewTitle: '变更操作审核',
  reviewWarning: '第二次确认前，请核对固定来源和操作信息。',
  packageDigest: '插件包摘要',
  parameterBytes: '参数字节数',
  parameterFingerprint: '参数指纹',
  mutationAttemptId: '变更操作标识',
  invalidParameters: '请输入符合已声明参数结构的有效 JSON。',
  connectorChanged: '连接器或参数已变化，请重新审核变更操作。',
  executionFailed: '连接器执行失败。',
  executionCancelled: '连接器执行已取消。',
  executionOutcomeUnknown: '变更请求已发出，但远端结果未知。重试前请先到对应服务中核验。',
  stopWaiting: '停止等待',
  outcomeUnknownNoticesTitle: '远端结果需要核验',
  outcomeUnknownPlugin: '插件',
  outcomeUnknownConnector: '连接器',
  outcomeUnknownOperation: '操作',
  dismiss: '关闭'
})

export function pluginConnectorControlsCopy(locale: Locale): PluginConnectorControlsCopy {
  return locale === 'zh-CN' ? SIMPLIFIED_CHINESE_COPY : ENGLISH_COPY
}

export function connectorOperationKindLabel(
  kind: PluginConnectorOperationKindV1,
  copy: PluginConnectorControlsCopy
): string {
  if (kind === 'query') return copy.query
  if (kind === 'mutation') return copy.mutation
  if (kind === 'asset-search') return copy.assetSearch
  return copy.assetRead
}

export function connectorCredentialStatusLabel(
  status: CredentialStatus,
  copy: PluginConnectorControlsCopy
): string {
  if (status === 'configured') return copy.configured
  if (status === 'missing') return copy.missing
  if (status === 'locked') return copy.locked
  return copy.unavailable
}

export function connectorCredentialControlKey(connectorId: string, slotId: string): string {
  return `${connectorId}\0${slotId}`
}

function operationControl(
  pluginId: string,
  operation: PluginConnectorContractV1['operations'][number],
  locale: Locale
): PluginConnectorOperationControl {
  const localized = localizedAppPluginContributionText(pluginId, operation.operationId, locale)
  return Object.freeze({
    contract: operation,
    operationId: operation.operationId,
    name: localized?.name ?? operation.name,
    description: localized?.description ?? operation.description,
    kind: operation.kind,
    request: operation.request ?? null,
    credentialSlotIds: Object.freeze([...operation.credentialSlots]),
    help: connectorOperationHelp(pluginId, operation, locale)
  })
}

export function pluginConnectorControls(
  plugin: InstalledAppPlugin,
  authorization: AuthorizationReader,
  locale: Locale
): readonly PluginConnectorControl[] {
  const manifest = plugin.package.manifest
  if (manifest.schemaVersion !== 2 || !manifest.contributions.connectors?.length) {
    return Object.freeze([])
  }
  return Object.freeze(
    manifest.contributions.connectors.map((candidate) => {
      const contract = parsePluginConnectorContract(candidate)
      if (contract.pluginId !== manifest.plugin.id) {
        throw new TypeError('Connector plugin identity does not match the installed manifest')
      }
      const credentials = contract.credentialSlots.map((slot) =>
        Object.freeze({
          slotId: slot.slotId,
          label:
            localizedAppPluginContributionText(contract.pluginId, slot.slotId, locale)?.name ??
            slot.label,
          kind: slot.kind,
          required: slot.required,
          reference: credentialRef(contract.pluginId, slot.slotId)
        })
      )
      const localized = localizedAppPluginContributionText(
        contract.pluginId,
        contract.connectorId,
        locale
      )
      const operations = contract.operations.map((operation) =>
        operationControl(contract.pluginId, operation, locale)
      )
      return Object.freeze({
        contract,
        packageDigest: plugin.package.digest,
        connectorId: contract.connectorId,
        adapterId: contract.adapterId,
        name: localized?.name ?? contract.name,
        description: localized?.description ?? contract.description,
        origins: Object.freeze([...contract.network.origins]),
        originTemplates: Object.freeze([...(contract.network.originTemplates ?? [])]),
        methods: Object.freeze([...contract.network.methods]),
        credentials: Object.freeze(credentials),
        operations: Object.freeze(operations),
        hasMutation: operations.some((operation) => operation.kind === 'mutation'),
        authorized: authorization.isAuthorized(contract, plugin.package.digest)
      })
    })
  )
}

export async function connectorCredentialStatus(
  manager: CredentialManager,
  reference: CredentialRef
): Promise<CredentialStatus> {
  try {
    return await manager.status(reference)
  } catch {
    return 'unavailable'
  }
}

export type EphemeralCredentialInput = { value: string }

/** Consume and clear the DOM-owned secret before the first asynchronous credential-store call. */
export async function saveConnectorCredential(
  manager: CredentialManager,
  reference: CredentialRef,
  input: EphemeralCredentialInput
): Promise<void> {
  const value = input.value
  input.value = ''
  if (!value) throw new TypeError('Connector credential is required')
  await manager.set(reference, value)
}

export async function clearConnectorCredential(
  manager: CredentialManager,
  reference: CredentialRef
): Promise<void> {
  await manager.clear(reference)
}
