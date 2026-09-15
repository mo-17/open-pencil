import type { BusinessTemplateId } from '../business/model/types'
import { businessLabel, businessText as t, type BusinessText } from '../business/types'
import { businessTemplateBoundaries } from '../library/business-boundaries'

const boundaries: Partial<Record<BusinessTemplateId, BusinessText>> = {
  'customer-crm': t(
    'Customer ownership, assignment and follow-up stay within CRM permissions. Contacts do not automatically create contract counterparties or synchronize with an external CRM.',
    '客户归属、分配和跟进受 CRM 自身权限约束，不会自动创建合同交易对方，也不自动同步外部 CRM。'
  ),
  'service-desk': t(
    'Ticket processing and approval follow the supplied state transitions. External email, notifications and service-level automation require further integration.',
    '工单处理和审批采用模板内的状态流转；外部邮件、通知和服务时限自动化需要后续接入。'
  ),
  'content-knowledge-base': t(
    'Public and internal publication use separate read permissions. This template provides the reviewed publication flow, not a general publishing workflow designer.',
    '公开和内部发布使用不同读取权限；模板提供固定审核发布流程，不包含通用发布流程设计器。'
  ),
  'booking-registration': t(
    'Reservations use the configured slot capacity and owner permissions. Payment, calendar synchronization and reminders require further integration.',
    '预约受号源容量和本人权限约束；支付、日历同步和提醒需要后续接入。'
  ),
  'project-tasks': t(
    'Project membership controls task access. Projects do not automatically create HR employees, approval requests or external notifications.',
    '项目成员关系决定任务访问范围，不会自动创建 HR 员工、审批申请或发送外部通知。'
  ),
  'rental-viewing': t(
    'Property publication and viewing reservations are separate from rental contracts or payments. Panorama playback requires the VR plugin and a supported preview or export target.',
    '房源发布和看房预约不等于租约或付款；全景播放需要 VR 插件及支持的预览或导出目标。'
  ),
  'video-live': t(
    'The player consumes configured public media URLs. Live-state records do not start a broadcast, ingest a stream, transcode video or provide a CDN.',
    '播放器使用已配置的公开媒体地址；直播状态登记不会启动推流、接收直播流、转码视频或提供 CDN。'
  ),
  'food-ordering': t(
    'Single-restaurant cart and kitchen operations record orders without real payment, delivery, printing or stock quantities. Availability is the sold-out switch.',
    '单餐厅购物车和后厨流程只处理订单记录，不执行真实支付、配送、打印或库存数量扣减；售罄由可售开关控制。'
  ),
  'hospital-registration': t(
    'Single-hospital scheduling and private patient profiles support appointment handling. Fees are recorded in CNY cents; real charging, medical records and hospital-system integration remain separate.',
    '支持单医院排班、私有就诊人和挂号处理，费用以人民币分记录；真实收费、病历及医院系统对接需要另行实现。'
  ),
  'personal-blog': t(
    'Text articles and private bookmarks use the current publication permissions. Withdrawing an article removes public reading; media uploads and external distribution require further development.',
    '文字文章及私人收藏受当前发布权限约束；撤回后停止公开阅读，媒体上传和外部分发需要后续开发。'
  ),
  'automotive-news': t(
    'Editors manage drafts and the vehicle catalog; publishers control publication. Content is entered manually: the template does not scrape news or synchronize vehicle data.',
    '编辑管理草稿及车型目录，发布者控制发布。内容由人工录入，模板不会抓取新闻或同步车辆数据。'
  )
}

export function gettingStartedModuleBoundaries(kind: BusinessTemplateId, locale: string): string[] {
  const established = boundaries[kind]
  return established
    ? [businessLabel(established, locale)]
    : businessTemplateBoundaries(kind, locale)
}
