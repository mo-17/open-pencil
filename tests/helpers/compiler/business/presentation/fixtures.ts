import type { BackendApplicationSpecV1 } from '@open-pencil/lowcode/backend'

import type { BusinessTemplateId } from '@/app/lowcode/backend/business/model/types'
import type { BusinessTemplateDefinition } from '@/app/lowcode/backend/business/types'

import type { BusinessTestRow } from '#tests/engine/app/lowcode/backend/business/browser/transport/helpers'

const titles = {
  'customer-crm': ['星河设计工作室', '远山品牌事务所'],
  'service-desk': ['企业账号访问权限申请', '会议室设备维护申请'],
  'content-knowledge-base': ['产品交付与验收指南', '设计团队协作手册'],
  'booking-registration': ['产品设计咨询', '品牌诊断工作坊'],
  'project-tasks': ['秋季品牌焕新项目', '客户服务体验升级'],
  'rental-viewing': ['海岸花园 · 南向两居', '林间公寓 · 明亮一居'],
  'video-live': ['城市慢行生活记录', '周末手作课堂'],
  'hospital-registration': ['周三上午专家门诊', '周五下午普通门诊'],
  'personal-blog': ['把日常写成值得珍藏的故事', '在清晨重新发现这座城市'],
  'automotive-news': ['新一代城市电动车体验报告', '周末自驾与沿海公路指南'],
  'procurement-inventory': ['工作室环保手提袋', '品牌资料收纳盒'],
  'enterprise-approvals': ['秋季项目采购申请', '客户调研出差申请'],
  'survey-forms': ['产品使用体验调研', '团队协作满意度调查'],
  'online-courses': ['从零开始学习产品设计', '让工作更高效的表达课'],
  'community-forum': ['分享你的城市生活灵感', '这一周有哪些值得推荐的好书'],
  'asset-management': ['EQ-2026-001', 'EQ-2026-002'],
  'quote-contracts': ['品牌官网设计服务报价', '年度内容制作服务报价'],
  'recruitment-hr': ['产品体验设计师', '客户成功顾问']
} satisfies Record<Exclude<BusinessTemplateId, 'food-ordering'>, readonly [string, string]>

export const presentationKinds = Object.keys(titles) as (keyof typeof titles)[]
export const longTextKinds = [
  'customer-crm',
  'hospital-registration',
  'personal-blog',
  'quote-contracts'
] as const

const common: BusinessTestRow = {
  category: '精选内容',
  category_title: '生活与工作',
  company: '星河创意有限公司',
  email: 'hello@example.test',
  phone: '13800000000',
  description: '把复杂的事情做好，让每一次协作更轻松。这里记录背景、目标与下一步安排。',
  summary: '从真实场景出发，分享清晰、实用且可以付诸行动的经验。',
  body: '每一个好体验，都始于对日常细节的认真观察。\n\n从需求到实践，我们持续记录过程中的发现与思考。',
  city: '厦门',
  district: '思明区',
  room_layout: '2 室 1 厅',
  address: '海岸路 28 号',
  rent_monthly_cents: 450000,
  area_sqm_x100: 8200,
  doctor_title: '林医生',
  department_title: '全科门诊',
  location: '服务中心 2 层',
  capacity: 20,
  reserved: 7,
  warehouse_title: '总部仓库',
  quantity: 120,
  unit: '件',
  lesson_count: 12,
  publication_number: 2,
  department: '产品设计部',
  party_title: '星河创意有限公司',
  party_contact: '项目负责人',
  item_title: '品牌官网设计与交付',
  unit_price_cents: 180000,
  total_cents: 360000,
  amount_cents: 85000
}

const id = (value: number) => '00000000-0000-4000-8000-' + String(value).padStart(12, '0')

/** Read-only browser sample rows; authentication, roles and database behavior are not simulated. */
export function presentationResources(
  application: BackendApplicationSpecV1,
  definition: BusinessTemplateDefinition
) {
  const kind = definition.id
  if (kind === 'food-ordering') throw new Error('Restaurant presentation has its own suite')
  const entry = definition.pages.find((page) => page.id === definition.entryPage)
  if (!entry?.listing) throw new Error('The business entry requires a listing')
  const resources: Record<string, BusinessTestRow[]> = {}
  for (const [resourceIndex, resource] of (application.httpApi?.resources ?? []).entries()) {
    const entity = application.dataModel.entities.find((item) => item.id === resource.entityId)
    if (!entity) throw new Error('Missing sample entity')
    resources[resource.id] = [0, 1].map((index) =>
      Object.fromEntries(
        resource.readFields.map((name, fieldIndex) => {
          const field = entity.fields.find((item) => item.id === name)
          if (!field) throw new Error('Missing sample field')
          let value: BusinessTestRow[string] = common[name] ?? '业务记录'
          if (field.type === 'uuid') value = id(resourceIndex * 100 + fieldIndex * 2 + index + 1)
          else if (field.type === 'datetime') value = '2026-09-16T09:00:00.000Z'
          else if (field.type === 'integer' || field.type === 'number') value = common[name] ?? 1
          else if (field.type === 'boolean') value = true
          else if (field.type === 'enum')
            value =
              application.dataModel.enums.find((item) => item.id === field.enumId)?.values[0] ?? ''
          else if (name.endsWith('_url') || name.endsWith('_uri') || name.endsWith('_json'))
            value = ''
          if (name === 'title') value = titles[kind][index]
          return [name, value]
        })
      )
    )
  }
  const rows = resources[entry.listing.resourceId]
  const primary = entry.listing.columns[0]
  rows.forEach((row, index) => {
    row[primary.field] = titles[kind][index]
  })
  return { resources, entry, listing: entry.listing, rows, primary }
}
