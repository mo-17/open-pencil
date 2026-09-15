import { businessTemplateDefinition } from '../business/definitions'
import type { BusinessTemplateId } from '../business/model/types'
import { businessLabel } from '../business/types'
import { businessTemplateBoundaries } from './business-boundaries'

export function businessTemplateCopy(kind: BusinessTemplateId, locale: string) {
  const definition = businessTemplateDefinition(kind)
  const chinese = locale.toLowerCase().startsWith('zh')
  const label = (value: Parameters<typeof businessLabel>[0]) => businessLabel(value, locale)
  return {
    name: label(definition.title),
    description: label(definition.description),
    mode: chinese ? '可编辑业务后台' : 'Editable business application',
    tags: [
      label(definition.title),
      'NestJS',
      'OIDC',
      chinese ? '表单与流程' : 'Forms and workflows'
    ],
    roles: [...definition.roles],
    pages: [
      chinese ? '业务系统登录' : 'Business sign in',
      ...definition.pages.map((page) => label(page.title))
    ],
    features: chinese
      ? [
          '可分页列表、服务器搜索、详情及关联记录选择',
          '真实表单、服务端权限及状态校验、记录追踪',
          '已保存请求检查、重试与结果核对',
          '可导出 React 或 Vue 页面及 NestJS 后端'
        ]
      : [
          'Paged lists, server search, details and related-record pickers',
          'Working forms, server permissions, transition checks and record tracking',
          'Saved request inspection, retry and result acknowledgement',
          'Editable React or Vue pages with a NestJS backend'
        ],
    requirements: chinese
      ? [
          ...businessTemplateBoundaries(kind, locale),
          ...(kind === 'personal-blog'
            ? [
                '个人博客由 blog-author 管理；先撤回文章再修改正文。正文按纯文本显示，评论、订阅、RSS 和搜索引擎预渲染在导出后扩展。'
              ]
            : []),
          ...(kind === 'automotive-news'
            ? [
                '汽车编辑需 auto-editor，发布需 auto-publisher；车型与资讯由编辑维护，不提供实时车价、自动抓取、经销商或交易服务。'
              ]
            : []),
          ...(kind === 'hospital-registration'
            ? [
                '适用于单医院挂号；院方需 hospital-admin 或 hospital-staff 角色。挂号费以人民币分记录，仅作预约快照。真实支付、实名核验、HIS、医保和通知在导出后接入。'
              ]
            : []),
          ...(kind === 'food-ordering'
            ? [
                '适用于单门店堂食及自取，金额以人民币分记录；商家需 food-manager 角色，厨房订单可手动刷新。收款、打印机和配送服务在导出后接入。'
              ]
            : []),
          ...(kind === 'rental-viewing' ? ['安装并启用 VR 看房插件；全景图片需单独准备。'] : []),
          ...(kind === 'video-live'
            ? [
                '安装并启用视频插件；准备公开 HTTPS 视频或 HLS 播放地址。直播状态由运营人员维护，真实推流、转码、CDN 和付费服务在导出后接入。'
              ]
            : []),
          '启用 NestJS Provider，并配置 PostgreSQL 和 OIDC。',
          '创建新应用，或作为模块添加到兼容的应用；登录及账号设置会共享，所需角色仍由身份服务授予。',
          '此模板不会授予角色、启动服务、应用迁移或替换已有应用。',
          '附件、邮件短信、支付和第三方服务在导出后另行接入。'
        ]
      : [
          ...businessTemplateBoundaries(kind, locale),
          ...(kind === 'personal-blog'
            ? [
                'Grant blog-author to the blog owner. Withdraw articles before editing. Body content is plain text; add comments, subscriptions, RSS and search-engine prerendering after export.'
              ]
            : []),
          ...(kind === 'automotive-news'
            ? [
                'Grant auto-editor for writing and auto-publisher for publishing. Editors maintain vehicle data and news; no live prices, scraping, dealer or trading service is connected.'
              ]
            : []),
          ...(kind === 'hospital-registration'
            ? [
                'Single-hospital registration. Staff require hospital-admin or hospital-staff. Fees are CNY-cent appointment snapshots; integrate payments, identity verification, HIS, insurance and notifications after export.'
              ]
            : []),
          ...(kind === 'food-ordering'
            ? [
                'Single-restaurant dine-in and pickup, with prices in CNY cents. Grant food-manager to restaurant staff; refresh kitchen orders manually. Connect payments, printers and delivery after export.'
              ]
            : []),
          ...(kind === 'rental-viewing'
            ? ['Install and enable VR Tour; provide your own panorama images.']
            : []),
          ...(kind === 'video-live'
            ? [
                'Install and enable Video; provide public HTTPS video or HLS playback URLs. Operators manage channel status; connect real ingest, transcoding, CDN and paid access after export.'
              ]
            : []),
          'Enable the NestJS provider and configure PostgreSQL and OIDC.',
          'Create a new application or add this module to a compatible application. Sign-in and account setup are shared; grant required roles through your identity service.',
          'Creation does not grant roles, start services, apply migrations or replace an existing application.',
          'Connect attachments, email/SMS, payments and third-party services after export.'
        ]
  }
}

export function businessTemplateCopies(locale: string) {
  return {
    'customer-crm': businessTemplateCopy('customer-crm', locale),
    'service-desk': businessTemplateCopy('service-desk', locale),
    'content-knowledge-base': businessTemplateCopy('content-knowledge-base', locale),
    'booking-registration': businessTemplateCopy('booking-registration', locale),
    'project-tasks': businessTemplateCopy('project-tasks', locale),
    'rental-viewing': businessTemplateCopy('rental-viewing', locale),
    'video-live': businessTemplateCopy('video-live', locale),
    'food-ordering': businessTemplateCopy('food-ordering', locale),
    'hospital-registration': businessTemplateCopy('hospital-registration', locale),
    'personal-blog': businessTemplateCopy('personal-blog', locale),
    'automotive-news': businessTemplateCopy('automotive-news', locale),
    'procurement-inventory': businessTemplateCopy('procurement-inventory', locale),
    'enterprise-approvals': businessTemplateCopy('enterprise-approvals', locale),
    'survey-forms': businessTemplateCopy('survey-forms', locale),
    'online-courses': businessTemplateCopy('online-courses', locale),
    'community-forum': businessTemplateCopy('community-forum', locale),
    'asset-management': businessTemplateCopy('asset-management', locale),
    'quote-contracts': businessTemplateCopy('quote-contracts', locale),
    'recruitment-hr': businessTemplateCopy('recruitment-hr', locale)
  }
}
