import type { PluginParameterValue } from '@open-pencil/plugin-contracts'

// Examples and field copy are host-owned so signed third-party schemas cannot inject executable UI.

export type ConnectorOperationFieldText = Readonly<{
  label: string
  description: string
}>

export type ConnectorOperationLocalizedFieldText = Readonly<{
  en: ConnectorOperationFieldText
  zhCN: ConnectorOperationFieldText
}>

export type BundledConnectorOperationHelpDefinition = Readonly<{
  example: Readonly<Record<string, PluginParameterValue>>
  fields: Readonly<Record<string, ConnectorOperationLocalizedFieldText>>
}>

const text = (
  enLabel: string,
  enDescription: string,
  zhLabel: string,
  zhDescription: string
): ConnectorOperationLocalizedFieldText =>
  Object.freeze({
    en: Object.freeze({ label: enLabel, description: enDescription }),
    zhCN: Object.freeze({ label: zhLabel, description: zhDescription })
  })

const operation = (
  example: Readonly<Record<string, PluginParameterValue>>,
  fields: Readonly<Record<string, ConnectorOperationLocalizedFieldText>>
): BundledConnectorOperationHelpDefinition =>
  Object.freeze({ example: Object.freeze(example), fields: Object.freeze(fields) })

const PROJECT_REF = text(
  'Project reference',
  'Lowercase Supabase project reference from the project URL.',
  '项目引用',
  'Supabase 项目 URL 中的小写项目引用。'
)
const DATABASE_SCHEMA = text(
  'Database schema',
  'Database schema to inspect. Omit it to use public.',
  '数据库 schema',
  '要检查的数据库 schema；省略时使用 public。'
)
const TABLE = text(
  'Table',
  'Unquoted table name in the public schema.',
  '数据表',
  'public schema 中不带引号的数据表名称。'
)
const FILTERS = text(
  'Filters',
  'Bounded scalar filters combined with AND.',
  '筛选条件',
  '使用 AND 组合的有界标量筛选条件。'
)
const FILTER_COLUMN = text(
  'Filter column',
  'Column name used by this filter.',
  '筛选字段',
  '当前筛选条件使用的字段名称。'
)
const FILTER_OPERATOR = text(
  'Filter operator',
  'Reviewed PostgREST scalar comparison operator.',
  '筛选运算符',
  '经过审核的 PostgREST 标量比较运算符。'
)
const FILTER_VALUE = text(
  'Filter value JSON',
  'A JSON scalar encoded as text, such as 7, false, or "open".',
  '筛选值 JSON',
  '以文本编码的 JSON 标量，例如 7、false 或 "open"。'
)
const FIELDS = text(
  'Fields',
  'Bounded field names and JSON-encoded values.',
  '字段',
  '有界字段名称与 JSON 编码值。'
)
const FIELD_NAME = text('Field name', 'Unquoted column name.', '字段名称', '不带引号的列名称。')
const FIELD_VALUE = text(
  'Field value JSON',
  'A JSON value encoded as text, such as true, 7, or "Ship".',
  '字段值 JSON',
  '以文本编码的 JSON 值，例如 true、7 或 "Ship"。'
)

const SUPABASE_FILTER_FIELDS = Object.freeze({
  filters: FILTERS,
  'filters[].column': FILTER_COLUMN,
  'filters[].operator': FILTER_OPERATOR,
  'filters[].valueJson': FILTER_VALUE
})

export function bundledConnectorOperationHelpKey(pluginId: string, operationId: string): string {
  return `${pluginId}\0${operationId}`
}

export const BUNDLED_CONNECTOR_OPERATION_HELP: Readonly<
  Partial<Record<string, BundledConnectorOperationHelpDefinition>>
> = Object.freeze({
  [bundledConnectorOperationHelpKey('open-pencil.supabase-schema-inspector', 'inspect-schema')]:
    operation(
      { projectRef: 'project-ref', schema: 'public' },
      { projectRef: PROJECT_REF, schema: DATABASE_SCHEMA }
    ),
  [bundledConnectorOperationHelpKey('open-pencil.airtable', 'list-records')]: operation(
    { baseId: 'appBase123', tableId: 'tblTable123', pageSize: 25 },
    {
      baseId: text(
        'Base ID',
        'Stable Airtable base ID beginning with app.',
        'Base ID',
        '以 app 开头的稳定 Airtable Base ID。'
      ),
      tableId: text(
        'Table ID',
        'Stable Airtable table ID beginning with tbl.',
        'Table ID',
        '以 tbl 开头的稳定 Airtable Table ID。'
      ),
      pageSize: text(
        'Page size',
        'Maximum records requested for this page.',
        '每页数量',
        '本页最多请求的记录数量。'
      ),
      offset: text(
        'Pagination offset',
        'Opaque offset returned by the preceding Airtable response.',
        '分页游标',
        '上一次 Airtable 响应返回的不透明分页游标。'
      )
    }
  ),
  [bundledConnectorOperationHelpKey('open-pencil.supabase-business', 'query-rows')]: operation(
    {
      projectRef: 'project-ref',
      table: 'tasks',
      columns: ['id', 'title'],
      filters: [{ column: 'status', operator: 'eq', valueJson: '"open"' }],
      limit: 10
    },
    {
      projectRef: PROJECT_REF,
      table: TABLE,
      columns: text(
        'Columns',
        'Columns to return. Omit to return all columns allowed by RLS.',
        '返回字段',
        '要返回的字段；省略时返回 RLS 允许的全部字段。'
      ),
      ...SUPABASE_FILTER_FIELDS,
      limit: text(
        'Row limit',
        'Maximum number of rows to return.',
        '行数上限',
        '本次最多返回的数据行数。'
      )
    }
  ),
  [bundledConnectorOperationHelpKey('open-pencil.supabase-business', 'insert-rows')]: operation(
    {
      projectRef: 'project-ref',
      table: 'tasks',
      records: [
        {
          fields: [
            { name: 'title', valueJson: '"Ship"' },
            { name: 'done', valueJson: 'false' }
          ]
        }
      ]
    },
    {
      projectRef: PROJECT_REF,
      table: TABLE,
      records: text(
        'Records',
        'Bounded records to insert after confirmation.',
        '新增记录',
        '人工确认后要新增的有界记录。'
      ),
      'records[].fields': FIELDS,
      'records[].fields[].name': FIELD_NAME,
      'records[].fields[].valueJson': FIELD_VALUE
    }
  ),
  [bundledConnectorOperationHelpKey('open-pencil.supabase-business', 'update-rows')]: operation(
    {
      projectRef: 'project-ref',
      table: 'tasks',
      fields: [{ name: 'done', valueJson: 'true' }],
      filters: [{ column: 'id', operator: 'eq', valueJson: '7' }]
    },
    {
      projectRef: PROJECT_REF,
      table: TABLE,
      fields: FIELDS,
      'fields[].name': FIELD_NAME,
      'fields[].valueJson': FIELD_VALUE,
      ...SUPABASE_FILTER_FIELDS
    }
  ),
  [bundledConnectorOperationHelpKey('open-pencil.supabase-business', 'delete-rows')]: operation(
    {
      projectRef: 'project-ref',
      table: 'tasks',
      filters: [{ column: 'done', operator: 'is', valueJson: 'false' }]
    },
    { projectRef: PROJECT_REF, table: TABLE, ...SUPABASE_FILTER_FIELDS }
  ),
  [bundledConnectorOperationHelpKey('open-pencil.stripe', 'get-product')]: operation(
    { productId: 'prod_Product123' },
    {
      productId: text(
        'Product ID',
        'Canonical Stripe product ID beginning with prod_.',
        '商品 ID',
        '以 prod_ 开头的标准 Stripe 商品 ID。'
      )
    }
  ),
  [bundledConnectorOperationHelpKey('open-pencil.stripe', 'get-price')]: operation(
    { priceId: 'price_Price123' },
    {
      priceId: text(
        'Price ID',
        'Canonical Stripe price ID beginning with price_.',
        '价格 ID',
        '以 price_ 开头的标准 Stripe 价格 ID。'
      )
    }
  ),
  [bundledConnectorOperationHelpKey('open-pencil.stripe', 'create-checkout-session')]: operation(
    {
      priceId: 'price_Price123',
      quantity: 2,
      mode: 'subscription',
      successUrl: 'https://shop.acme.com/checkout/success?session_id={CHECKOUT_SESSION_ID}',
      cancelUrl: 'https://shop.acme.com/checkout/cancel'
    },
    {
      priceId: text(
        'Price ID',
        'Stripe price to add to the Checkout Session.',
        '价格 ID',
        '要加入 Checkout Session 的 Stripe 价格。'
      ),
      quantity: text(
        'Quantity',
        'Number of units for this Checkout line item.',
        '数量',
        '本次 Checkout 行项目的购买数量。'
      ),
      mode: text(
        'Checkout mode',
        'Use payment for one-time payment or subscription for recurring billing.',
        '结账模式',
        '一次性付款使用 payment，周期计费使用 subscription。'
      ),
      successUrl: text(
        'Success URL',
        'Public HTTPS destination after successful Checkout.',
        '成功跳转 URL',
        '结账成功后跳转的公共 HTTPS 地址。'
      ),
      cancelUrl: text(
        'Cancel URL',
        'Public HTTPS destination when the customer cancels Checkout.',
        '取消跳转 URL',
        '客户取消结账后跳转的公共 HTTPS 地址。'
      )
    }
  ),
  [bundledConnectorOperationHelpKey('open-pencil.resend-email', 'get-email')]: operation(
    { emailId: '4ef9a417-02e9-4d39-ad75-9611e0fcc33c' },
    {
      emailId: text(
        'Email ID',
        'Resend ID of a previously submitted email.',
        '邮件 ID',
        '已经提交到 Resend 的邮件 ID。'
      )
    }
  ),
  [bundledConnectorOperationHelpKey('open-pencil.resend-email', 'send-email')]: operation(
    {
      from: 'OpenPencil <sender@example.com>',
      to: ['reader@example.com'],
      subject: 'Connector review',
      text: 'The reviewed connector is ready.'
    },
    {
      from: text(
        'Sender',
        'Verified sender address, optionally with a display name.',
        '发件人',
        '已验证的发件地址，可包含显示名称。'
      ),
      to: text('Recipients', 'Primary recipient addresses.', '收件人', '主要收件人地址。'),
      cc: text('CC recipients', 'Optional carbon-copy addresses.', '抄送', '可选的抄送地址。'),
      bcc: text(
        'BCC recipients',
        'Optional blind-carbon-copy addresses.',
        '密送',
        '可选的密送地址。'
      ),
      subject: text('Subject', 'Email subject line.', '主题', '邮件主题。'),
      text: text(
        'Plain-text body',
        'Plain-text message body. Supply text or HTML content.',
        '纯文本正文',
        '纯文本邮件正文；请提供 text 或 HTML 内容。'
      ),
      html: text(
        'HTML body',
        'HTML message body. Supply HTML or plain-text content.',
        'HTML 正文',
        'HTML 邮件正文；请提供 HTML 或纯文本内容。'
      )
    }
  )
})
