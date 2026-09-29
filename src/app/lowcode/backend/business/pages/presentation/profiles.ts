import type { BusinessTemplateId } from '@/app/lowcode/backend/business/model/types'
import { businessText as t, type BusinessText } from '@/app/lowcode/backend/business/types'

export interface BusinessPresentationColors {
  readonly background: string
  readonly surface: string
  readonly text: string
  readonly muted: string
  readonly primary: string
  readonly border: string
  readonly tint: string
}

export interface BusinessNavigationGroup {
  readonly title: BusinessText
  readonly pageIds: readonly string[]
}

export interface BusinessPresentation {
  readonly colors: BusinessPresentationColors
  readonly mode: 'workbench' | 'editorial' | 'catalog' | 'appointments'
  readonly mark: string
  readonly eyebrow: BusinessText
  readonly welcome: BusinessText
  readonly introduction: BusinessText
  readonly groups: readonly BusinessNavigationGroup[]
}

const palettes = {
  blue: {
    background: '#F4F7FB',
    surface: '#FFFFFF',
    text: '#172B45',
    muted: '#61738B',
    primary: '#315EAF',
    border: '#DBE4EF',
    tint: '#EAF0FC'
  },
  teal: {
    background: '#F3F8F7',
    surface: '#FFFFFF',
    text: '#173B36',
    muted: '#5D7670',
    primary: '#24756B',
    border: '#D9E8E3',
    tint: '#E6F3EF'
  },
  violet: {
    background: '#F7F5FA',
    surface: '#FFFFFF',
    text: '#302844',
    muted: '#716980',
    primary: '#6F4DA3',
    border: '#E5DFEF',
    tint: '#F0EAF8'
  },
  ink: {
    background: '#F5F6F8',
    surface: '#FFFFFF',
    text: '#242F40',
    muted: '#667385',
    primary: '#3C526F',
    border: '#DEE3EA',
    tint: '#EAF0F6'
  },
  terracotta: {
    background: '#FBF8F4',
    surface: '#FFFFFF',
    text: '#392F29',
    muted: '#7D6E64',
    primary: '#A34B35',
    border: '#E9DFD6',
    tint: '#F7ECE4'
  }
} satisfies Record<string, BusinessPresentationColors>

const group = (en: string, zh: string, ...pageIds: string[]): BusinessNavigationGroup => ({
  title: t(en, zh),
  pageIds
})

/** Local presentation choices apply only to newly generated, fully editable business pages. */
const profiles: Record<BusinessTemplateId, BusinessPresentation> = {
  'customer-crm': {
    colors: palettes.blue,
    mode: 'workbench',
    mark: 'CRM',
    eyebrow: t('CUSTOMER RELATIONSHIPS', '客户关系'),
    welcome: t('Make every relationship count.', '认真维护，\n每一份客户关系。'),
    introduction: t(
      'Keep customer details and follow-up work together in your workspace.',
      '将客户资料与跟进工作放在一起，让下一次沟通更有准备。'
    ),
    groups: [group('CUSTOMER WORKSPACE', '客户工作', 'customers')]
  },
  'service-desk': {
    colors: palettes.blue,
    mode: 'workbench',
    mark: 'SD',
    eyebrow: t('SERVICE & SUPPORT', '服务与支持'),
    welcome: t('Good service starts with listening.', '每一个问题，\n都值得被认真回应。'),
    introduction: t(
      'Review service requests, coordinate responses and keep approvals in view.',
      '查看服务请求，协调处理进度，在同一个工作台完成工单审批。'
    ),
    groups: [
      group('SERVICE WORKSPACE', '服务工作', 'tickets'),
      group('REVIEW', '审核处理', 'approvals')
    ]
  },
  'content-knowledge-base': {
    colors: palettes.ink,
    mode: 'editorial',
    mark: 'KB',
    eyebrow: t('KNOWLEDGE & PUBLISHING', '知识与内容'),
    welcome: t('Turn useful ideas into shared knowledge.', '让有价值的知识，\n被看见、被使用。'),
    introduction: t(
      'Find published knowledge or continue writing and reviewing your next article.',
      '查阅知识内容，继续文章创作，完成审核与发布。'
    ),
    groups: [
      group('KNOWLEDGE', '知识阅读', 'knowledge', 'internal'),
      group('EDITORIAL', '内容工作', 'articles', 'review')
    ]
  },
  'booking-registration': {
    colors: palettes.teal,
    mode: 'appointments',
    mark: 'BK',
    eyebrow: t('SERVICES & APPOINTMENTS', '服务与预约'),
    welcome: t('Make time for what matters.', '为重要的事，\n留好时间。'),
    introduction: t(
      'Explore available services, choose a time and keep track of your bookings.',
      '选择需要的服务与可约时段，随时查看自己的预约。'
    ),
    groups: [
      group('BOOKING', '预约服务', 'services', 'bookings'),
      group('OPERATIONS', '预约管理', 'slots')
    ]
  },
  'project-tasks': {
    colors: palettes.violet,
    mode: 'workbench',
    mark: 'PM',
    eyebrow: t('PROJECTS & TASKS', '项目与任务'),
    welcome: t('Bring the next step into focus.', '理清下一步，\n一起推进项目。'),
    introduction: t(
      'Keep your projects and the work behind them in one clear workspace.',
      '集中查看项目与任务，让计划和实际工作保持连贯。'
    ),
    groups: [group('PROJECT WORKSPACE', '项目工作', 'projects', 'tasks')]
  },
  'rental-viewing': {
    colors: palettes.teal,
    mode: 'catalog',
    mark: 'HOME',
    eyebrow: t('HOMES & VIEWINGS', '租房与看房'),
    welcome: t('Find a place that feels like home.', '认真挑选，\n下一处理想居所。'),
    introduction: t(
      'Explore available homes and panoramas, then arrange a viewing.',
      '浏览在租房源与全景，选择合适的时间预约实地看房。'
    ),
    groups: [
      group('FIND A HOME', '找房与预约', 'rental-properties', 'rental-viewings'),
      group(
        'PROPERTY WORKSPACE',
        '房源管理',
        'rental-management-properties',
        'rental-management-slots'
      )
    ]
  },
  'video-live': {
    colors: palettes.violet,
    mode: 'catalog',
    mark: 'PLAY',
    eyebrow: t('VIDEO & LIVE CHANNELS', '视频与直播'),
    welcome: t('Discover something worth watching.', '发现内容，\n收藏你的喜欢。'),
    introduction: t(
      'Browse videos and channels, save favorites or manage your own content.',
      '浏览视频与频道，收藏感兴趣的内容，也可以管理自己的创作。'
    ),
    groups: [
      group('DISCOVER', '发现内容', 'media-videos', 'media-channels', 'media-favorites'),
      group(
        'CREATOR WORKSPACE',
        '创作者工作',
        'media-management-videos',
        'media-management-channels'
      )
    ]
  },
  'food-ordering': {
    colors: palettes.terracotta,
    mode: 'catalog',
    mark: 'FOOD',
    eyebrow: t('RESTAURANT', '餐厅点餐'),
    welcome: t('A good meal starts here.', '一餐好饭，从这里开始。'),
    introduction: t('Choose dishes and follow your order.', '选择菜品，查看订单进度。'),
    groups: []
  },
  'hospital-registration': {
    colors: palettes.teal,
    mode: 'appointments',
    mark: 'CARE',
    eyebrow: t('HOSPITAL APPOINTMENTS', '医院预约挂号'),
    welcome: t('Plan your visit with a little more clarity.', '提前安排，\n让就诊更从容。'),
    introduction: t(
      'Find departments and doctors, review available sessions and manage your registrations.',
      '查找科室与医生，查看可约排班，管理就诊人与挂号记录。'
    ),
    groups: [
      group(
        'YOUR VISIT',
        '就诊服务',
        'hospital-departments',
        'hospital-doctors',
        'hospital-slots',
        'hospital-patients',
        'hospital-appointments'
      ),
      group(
        'HOSPITAL WORKSPACE',
        '院方管理',
        'hospital-management-departments',
        'hospital-management-doctors',
        'hospital-management-slots',
        'hospital-management-appointments'
      )
    ]
  },
  'personal-blog': {
    colors: palettes.terracotta,
    mode: 'editorial',
    mark: 'JOURNAL',
    eyebrow: t('WRITING & IDEAS', '文字与想法'),
    welcome: t('A place for ideas worth keeping.', '把值得记录的事，\n慢慢写下来。'),
    introduction: t(
      'Read published stories, save favorites and return to your own writing.',
      '阅读公开文章，收藏喜欢的篇章，继续自己的写作。'
    ),
    groups: [
      group('READ', '阅读与收藏', 'blog-articles', 'blog-categories', 'blog-bookmarks'),
      group('WRITE', '写作与管理', 'blog-management-articles', 'blog-management-categories')
    ]
  },
  'automotive-news': {
    colors: palettes.ink,
    mode: 'editorial',
    mark: 'AUTO',
    eyebrow: t('AUTOMOTIVE JOURNAL', '汽车资讯'),
    welcome: t('Follow the stories that move you.', '读懂汽车，\n发现出行新视角。'),
    introduction: t(
      'Read automotive stories, browse brands and models or continue editorial work.',
      '阅读汽车资讯，浏览品牌与车型，继续内容编辑与发布。'
    ),
    groups: [
      group(
        'EXPLORE',
        '资讯与车型',
        'auto-articles',
        'auto-categories',
        'auto-brands',
        'auto-models',
        'auto-bookmarks'
      ),
      group(
        'EDITORIAL',
        '内容管理',
        'auto-management-articles',
        'auto-publication',
        'auto-management-categories',
        'auto-management-brands',
        'auto-management-models'
      )
    ]
  },
  'procurement-inventory': {
    colors: palettes.ink,
    mode: 'workbench',
    mark: 'STOCK',
    eyebrow: t('PROCUREMENT & INVENTORY', '采购与库存'),
    welcome: t('Keep every stock movement in view.', '每一次出入库，\n都有迹可循。'),
    introduction: t(
      'Work through purchases, stock movements and the records that support them.',
      '处理采购收货与出库，查看库存余额和变动台账。'
    ),
    groups: [
      group(
        'OPERATIONS',
        '库存业务',
        'inventory-balances',
        'inventory-purchases',
        'inventory-dispatches',
        'inventory-movements'
      ),
      group(
        'DIRECTORY',
        '基础档案',
        'inventory-skus',
        'inventory-warehouses',
        'inventory-suppliers'
      )
    ]
  },
  'enterprise-approvals': {
    colors: palettes.blue,
    mode: 'workbench',
    mark: 'OA',
    eyebrow: t('REQUESTS & APPROVALS', '申请与审批'),
    welcome: t('Make the next decision a clear one.', '申请有进度，\n审批有依据。'),
    introduction: t(
      'Submit workplace requests and review the decisions waiting for you.',
      '提交日常工作申请，查看处理进度，完成自己的审批待办。'
    ),
    groups: [
      group(
        'MY REQUESTS',
        '我的申请',
        'oa-requests',
        'oa-leave-requests',
        'oa-expense-requests',
        'oa-purchase-requests'
      ),
      group('REVIEW QUEUES', '审批待办', 'oa-first-queue', 'oa-second-queue')
    ]
  },
  'survey-forms': {
    colors: palettes.violet,
    mode: 'workbench',
    mark: 'FORM',
    eyebrow: t('SURVEYS & RESPONSES', '问卷与反馈'),
    welcome: t('Create space for useful feedback.', '认真提问，\n听见真实想法。'),
    introduction: t(
      'Answer published surveys or prepare and review your own questionnaires.',
      '填写已发布的问卷，准备调查内容，查看收到的答卷。'
    ),
    groups: [
      group('PARTICIPATE', '填写与记录', 'survey-versions', 'survey-answer', 'survey-my-responses'),
      group('SURVEY WORKSPACE', '问卷管理', 'survey-drafts', 'survey-management')
    ]
  },
  'online-courses': {
    colors: palettes.teal,
    mode: 'catalog',
    mark: 'LEARN',
    eyebrow: t('COURSES & LEARNING', '课程与学习'),
    welcome: t('A new chapter starts with curiosity.', '保持好奇，\n开始新的学习。'),
    introduction: t(
      'Find a course, continue lessons and keep your learning records together.',
      '发现适合自己的课程，继续章节学习，保留学习与作业记录。'
    ),
    groups: [
      group(
        'MY LEARNING',
        '学习空间',
        'courses',
        'course-enrollments',
        'course-lessons',
        'course-progress'
      ),
      group('TEACHING', '教学管理', 'course-management', 'course-students', 'course-submissions')
    ]
  },
  'community-forum': {
    colors: palettes.terracotta,
    mode: 'editorial',
    mark: 'TALK',
    eyebrow: t('COMMUNITY & DISCUSSION', '社区与讨论'),
    welcome: t('Good conversations bring people together.', '分享见闻，\n遇见新的想法。'),
    introduction: t(
      'Explore discussions, share a post and return to the conversations you follow.',
      '浏览社区讨论，分享自己的帖子，继续关注的话题。'
    ),
    groups: [
      group(
        'COMMUNITY',
        '参与社区',
        'community-posts',
        'community-participate',
        'community-my-posts',
        'community-my-replies',
        'community-follows',
        'community-my-reports'
      ),
      group(
        'MODERATION',
        '社区管理',
        'community-management-posts',
        'community-management-replies',
        'community-management-reports'
      )
    ]
  },
  'asset-management': {
    colors: palettes.teal,
    mode: 'workbench',
    mark: 'ASSET',
    eyebrow: t('ASSETS & RESPONSIBILITY', '资产与领用'),
    welcome: t('Put the right tools in the right hands.', '让每一份资产，\n都有清楚的去向。'),
    introduction: t(
      'Find available assets, follow requests and review handover records.',
      '查找可用资产，跟进领用申请，查看交付与归还记录。'
    ),
    groups: [
      group('MY ASSETS', '资产服务', 'assets', 'asset-requests'),
      group(
        'ASSET WORKSPACE',
        '资产管理',
        'asset-management',
        'asset-management-requests',
        'asset-history'
      )
    ]
  },
  'quote-contracts': {
    colors: palettes.ink,
    mode: 'workbench',
    mark: 'AGREE',
    eyebrow: t('QUOTES & CONTRACTS', '报价与合同'),
    welcome: t('Keep commitments clear from the start.', '从一份报价，\n到一次认真履约。'),
    introduction: t(
      'Prepare quotes, review versions and keep contract delivery records together.',
      '准备报价，核对版本，集中跟进合同履约与交付记录。'
    ),
    groups: [
      group(
        'COMMERCIAL WORKSPACE',
        '商务工作',
        'quote-drafts',
        'quote-versions',
        'contracts',
        'contract-deliveries'
      ),
      group('DIRECTORY', '往来资料', 'contract-parties')
    ]
  },
  'recruitment-hr': {
    colors: palettes.violet,
    mode: 'workbench',
    mark: 'PEOPLE',
    eyebrow: t('RECRUITMENT & PEOPLE', '招聘与人事'),
    welcome: t('Make room for the next chapter.', '认真迎接，\n每一位新伙伴。'),
    introduction: t(
      'Review positions and candidates, then follow onboarding and employee records.',
      '跟进招聘职位与候选人，办理入职事项，记录员工变动。'
    ),
    groups: [
      group('RECRUITMENT', '招聘工作', 'hr-positions', 'hr-candidates'),
      group('PEOPLE OPERATIONS', '人事工作', 'hr-employees', 'hr-checklist', 'hr-history')
    ]
  }
}

export function businessPresentation(kind: BusinessTemplateId): BusinessPresentation {
  return profiles[kind]
}
