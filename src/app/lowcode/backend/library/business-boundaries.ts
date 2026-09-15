import type { BusinessTemplateId } from '../business/model/types'
import { businessLabel, businessText as t, type BusinessText } from '../business/types'

const boundaries: Partial<Record<BusinessTemplateId, BusinessText>> = {
  'procurement-inventory': t(
    'One organization with one SKU and warehouse per purchase or dispatch. Supports partial receipts, quantity-limited returns and version-checked stocktakes. Prices are CNY cents; multi-line orders, transfers, batches, accounting and payments remain post-export work. Commerce stock is not automatically synchronized.',
    '适用于单组织，每笔采购或出库对应一个 SKU 和仓库，支持分批收货、限额退货及版本校验盘点。金额以人民币分记录；多行整单、调拨、批次、财务记账和付款在导出后扩展，不会自动同步电商库存。'
  ),
  'enterprise-approvals': t(
    'Fixed two-stage leave, expense and purchase approvals. The requester and two reviewers must be different accounts. Expenses are application records, not payments; workflow designers, payroll and notifications remain post-export work.',
    '请假、报销及采购申请采用固定两级审批，申请人与两级审批人必须为不同账号。报销只记录申请，不执行付款；流程设计器、薪资与通知在导出后扩展。'
  ),
  'survey-forms': t(
    'Fixed rating, three-choice and text questions. Published question versions are immutable and each verified account can submit once per version. View individual responses; arbitrary question builders, anonymous answers and aggregate charts remain post-export work.',
    '固定评分、三选一和文字题，已发布题面版本不可改写，每个已验证账号每版本只能提交一次。可查看答卷明细；任意题型设计器、匿名答卷和统计图表在导出后扩展。'
  ),
  'online-courses': t(
    'Text chapters, course-student enrollment and course-instructor grading. Published chapters are frozen; closing enrollment preserves existing student access. Each chapter accepts one final answer with one instructor grade. Video, automatic exams, certificates and paid access remain post-export work.',
    '文字章节、course-student 学员报名和 course-instructor 教师评分。发布后章节冻结，关闭报名保留已有学员访问。每章一次最终交卷及教师评分；视频、自动考试、证书与付费服务在导出后扩展。'
  ),
  'community-forum': t(
    'Moderated text discussions and replies, private thread follows and reports. Closed discussions remain readable and stop accepting replies. Moderation reasons and reports are private; real-time chat, notifications, rich text and cascading deletion remain post-export work.',
    '支持文字帖子及回复审核、私人关注和举报，关闭讨论后仍可阅读并停止新回复。审核理由及举报私有；实时聊天、通知、富文本和级联删除在导出后扩展。'
  ),
  'asset-management': t(
    'Individually tagged assets with employee requests and asset-manager issue, return, repair and retirement records. Requests do not reserve an asset; only one custody can be active. Return an asset before repair or retirement. No automatic inventory synchronization, depreciation, barcode scanning or reminders.',
    '按独立资产标签管理，员工申请后由 asset-manager 办理交付、归还、维修和报废。申请不预留资产，同一资产只能有一笔在用记录；维修或报废前须先归还。不自动同步进销存，不含折旧、扫码或提醒。'
  ),
  'quote-contracts': t(
    'Internal contract-manager workspace with private counterparties, single-line quote versions, recorded confirmation, partial deliveries and recorded acceptance. Published quotes and commercial snapshots are immutable. Confirmation is an internal record, not electronic signing; payments, invoicing and CRM synchronization remain post-export work.',
    'contract-manager 内部工作台，管理本人负责的交易对方、单行报价版本、确认记录、分批交付及验收记录。已发布报价和商务快照不可改写。确认仅为内部登记，不是电子签约；收付款、开票与 CRM 数据联动在导出后接入。'
  ),
  'recruitment-hr': t(
    'Private recruitment-hr workspace for owned positions, candidates, interview feedback, hiring and onboarding/offboarding checklists. Checklist completion records business work and never grants or revokes identity-service access. Employee self-service, resume uploads, payroll and external notifications remain post-export work.',
    'recruitment-hr 私有工作台，管理本人负责的职位、候选人、面试反馈、录用及入离职清单。清单完成只登记业务处理，不授予或回收身份服务权限；员工自助、简历上传、薪资与外部通知在导出后扩展。'
  )
}

export function businessTemplateBoundaries(kind: BusinessTemplateId, locale: string): string[] {
  const text = boundaries[kind]
  return text ? [businessLabel(text, locale)] : []
}
