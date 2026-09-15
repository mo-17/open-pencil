import type { BusinessTemplateId } from '../business/model/types'
import { businessLabel, businessText as t, type BusinessText } from '../business/types'

const preparation = {
  'customer-crm': [
    t(
      'Register the accounts that will appear in customer assignment.',
      '先登记需要参与客户分配的账号资料。'
    ),
    t('Create a customer and assign the responsible account.', '创建客户，分配负责人。'),
    t('Record a follow-up, then advance the customer stage.', '记录跟进，再推进客户阶段。')
  ],
  'service-desk': [
    t(
      'Prepare separate requester, agent and approver accounts as needed.',
      '按分工准备申请人、处理人和审批人账号。'
    ),
    t('Create a ticket, assign an agent and start processing.', '创建工单，分配处理人并开始处理。'),
    t(
      'Submit for approval; resolve a rejection or close an approved ticket.',
      '提交审批；处理退回，或关闭已批准工单。'
    )
  ],
  'content-knowledge-base': [
    t('Prepare author, reviewer and publisher accounts.', '准备作者、审核者和发布者账号。'),
    t('Write a draft and submit it for review.', '编写草稿并提交审核。'),
    t(
      'Approve it, choose public or internal publication, then verify reader access.',
      '审核通过后选择公开或内部发布，再核对读者访问范围。'
    )
  ],
  'booking-registration': [
    t(
      'Create a service and a future slot with capacity.',
      '先创建服务，再创建未来时段并设置容量。'
    ),
    t('Sign in as a customer and reserve a place.', '以用户账号登录并预约。'),
    t(
      'Verify cancellation, rescheduling and the manager completion flow.',
      '核对取消、改期和管理者完成预约的流程。'
    )
  ],
  'project-tasks': [
    t('Create a project and add its members.', '创建项目并添加成员。'),
    t('Create a task and assign an active project member.', '创建任务并分配给有效项目成员。'),
    t(
      'Start and complete the task; inspect the project task list.',
      '开始并完成任务，检查项目任务列表。'
    )
  ],
  'rental-viewing': [
    t(
      'Enable the VR tour plugin if panorama pages are required.',
      '需要全景页面时，先启用 VR 看房插件。'
    ),
    t(
      'Create and publish a property, then add a future viewing slot.',
      '创建并发布房源，再添加未来看房时段。'
    ),
    t(
      'Reserve as a tenant and process the appointment as landlord or administrator.',
      '以租客身份预约，再由房东或管理员处理预约。'
    )
  ],
  'video-live': [
    t(
      'Enable the Video plugin and prepare public HTTPS media URLs.',
      '先启用视频插件，准备公开 HTTPS 媒体地址。'
    ),
    t(
      'Create a video or channel and complete its publication fields.',
      '创建视频或频道，填写发布所需内容。'
    ),
    t(
      'Publish a video or record the live state, then test playback as a reader.',
      '发布视频或登记直播状态，再以读者身份验证播放。'
    )
  ],
  'food-ordering': [
    t(
      'Register the manager profile, then create menu items with prices in CNY cents.',
      '登记管理者资料，再创建菜品；价格单位为人民币分。'
    ),
    t(
      'Add dishes to the cart and place a dine-in or pickup order.',
      '将菜品加入购物车，提交堂食或自取订单。'
    ),
    t(
      'Accept, prepare, mark ready and complete the order in the kitchen.',
      '在后厨依次接单、制作、出餐并完成订单。'
    )
  ],
  'hospital-registration': [
    t('Create a department, doctor and future appointment slot.', '依次创建科室、医生和未来号源。'),
    t(
      'Create a private patient profile and reserve the selected slot.',
      '创建本人私有就诊人资料，再预约所选号源。'
    ),
    t(
      'Verify cancellation or restoration and the staff check-in/completion flow.',
      '核对取消、恢复预约，以及工作人员签到和完成流程。'
    )
  ],
  'personal-blog': [
    t('Create an active article category.', '先创建启用的文章分类。'),
    t('Write a draft and publish it with the author account.', '以作者账号编写草稿并发布。'),
    t(
      'Read and bookmark it; withdraw it and verify public content is hidden.',
      '阅读并收藏文章；撤回后核对公开内容已隐藏。'
    )
  ],
  'automotive-news': [
    t(
      'Create categories, brands and models with the editor account.',
      '以编辑账号创建分类、品牌和车型。'
    ),
    t('Write a draft linked to an active category and model.', '编写草稿，关联有效分类和车型。'),
    t(
      'Use a publisher account to publish or withdraw, then verify public reading.',
      '以发布者账号发布或撤回，再核对公开阅读。'
    )
  ],
  'procurement-inventory': [
    t(
      'Create SKUs, warehouses and suppliers, then establish stock positions.',
      '创建 SKU、仓库和供应商，再建立库存位。'
    ),
    t(
      'Create a purchase and record receipts before dispatching stock.',
      '创建采购并登记收货，再办理出库。'
    ),
    t(
      'Inspect movements and test quantity-limited returns or a version-checked stocktake.',
      '查看流水，验证限额退货或带版本校验的盘点。'
    )
  ],
  'enterprise-approvals': [
    t(
      'Prepare a requester and two different reviewer accounts.',
      '准备申请人及两个不同的审批人账号。'
    ),
    t(
      'Create a leave, expense or purchase draft and submit it.',
      '创建请假、报销或采购草稿并提交。'
    ),
    t(
      'Complete the two review stages or return the request for revision.',
      '依次完成两级审批，或退回申请修改。'
    )
  ],
  'survey-forms': [
    t(
      'Edit the fixed rating, choice and text questions in a draft.',
      '在草稿中编辑固定的评分、单选和文字题。'
    ),
    t(
      'Publish a question version and submit once with a respondent account.',
      '发布题面版本，以答题账号提交一次答卷。'
    ),
    t(
      'Inspect private responses as manager and close the version when finished.',
      '以管理者身份查看私有答卷，结束后关闭版本。'
    )
  ],
  'online-courses': [
    t(
      'Create a course and text chapters with the instructor account.',
      '以教师账号创建课程和文字章节。'
    ),
    t('Publish the course, then enroll with a student account.', '发布课程，再以学员账号报名。'),
    t(
      'Read a chapter, submit the final answer and record an instructor grade.',
      '阅读章节并最终交卷，再由教师登记评分。'
    )
  ],
  'community-forum': [
    t('Post a discussion for moderation with a member account.', '以成员账号发帖并等待审核。'),
    t(
      'Publish the post as moderator, then submit and review a reply.',
      '由版主发布帖子，再提交并审核回复。'
    ),
    t(
      'Try private follows or reports; close discussion to stop new replies.',
      '验证私人关注或举报；关闭讨论后停止新增回复。'
    )
  ],
  'asset-management': [
    t(
      'Register individually tagged assets with the manager account.',
      '以管理者账号登记带独立标签的资产。'
    ),
    t(
      'Request an issue or loan as an employee, then record the handover as manager.',
      '由员工申请领用或借用，再由管理者登记交付。'
    ),
    t('Return the asset before recording repair or retirement.', '先办理归还，再登记维修或报废。')
  ],
  'quote-contracts': [
    t(
      'Create an owned counterparty and a single-line quote draft.',
      '创建本人负责的交易对方和单行报价草稿。'
    ),
    t(
      'Publish an immutable quote version, record confirmation and create the contract.',
      '发布不可改写的报价版本，登记确认并创建合同。'
    ),
    t(
      'Record deliveries and acceptance before closing the contract.',
      '登记分批交付和验收，再完成合同。'
    )
  ],
  'recruitment-hr': [
    t(
      'Create an owned position and candidate, then record interview feedback.',
      '创建本人负责的职位及候选人，再登记面试反馈。'
    ),
    t(
      'Make the hiring decision explicitly and begin onboarding.',
      '明确作出录用决定，再开始入职办理。'
    ),
    t(
      'Complete the required checklist before entry; use a new checklist for departure.',
      '完成必需清单后确认入职；离职使用新的交接清单。'
    )
  ]
} satisfies Record<BusinessTemplateId, readonly BusinessText[]>

export function businessPreparationSteps(kind: BusinessTemplateId, locale: string): string[] {
  return preparation[kind].map((step) => businessLabel(step, locale))
}
