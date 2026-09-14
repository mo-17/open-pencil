import { businessText as t, type BusinessColumn, type BusinessTemplateDefinition } from '../types'
import {
  accountSetupPage,
  inputParameter,
  recordAction,
  selectedParameter,
  textInput
} from './shared'

export function contentKnowledgeDefinition(): BusinessTemplateDefinition {
  const roles = ['content-author', 'content-reviewer', 'content-publisher']
  const columns: BusinessColumn[] = [
    { field: 'title', label: t('Title', '标题') },
    { field: 'category', label: t('Category', '分类') }
  ]
  const details = [...columns, { field: 'body', label: t('Article', '正文'), multiline: true }]
  const draftInputs = [
    textInput('title', 'Article title', '文章标题', 200),
    textInput('category', 'Category', '分类', 100),
    textInput('body', 'Article body', '文章正文', 8192)
  ]
  const draftParameters = Object.fromEntries(
    draftInputs.map((input) => [input.key, inputParameter(input.key)])
  )
  const listing = {
    resourceId: 'articles',
    columns: [...columns, { field: 'status', label: t('Status', '状态') }],
    search: true,
    filter: {
      field: 'status',
      choices: [
        { value: 'draft', label: t('Draft', '草稿') },
        { value: 'in_review', label: t('In review', '审核中') },
        { value: 'approved', label: t('Approved', '已批准') },
        { value: 'published', label: t('Published', '已发布') }
      ]
    }
  }
  const related = [
    {
      resourceId: 'article-history',
      foreignKey: 'article_id',
      title: t('Article history', '文章历史'),
      columns: [
        { field: 'event', label: t('Action', '操作') },
        { field: 'note', label: t('Note', '说明') },
        { field: 'created_at', label: t('Recorded at', '记录时间') }
      ]
    }
  ]
  const transition = (
    id: string,
    commandId: string,
    en: string,
    zh: string,
    status: string,
    note = false
  ) =>
    recordAction({
      id,
      commandId,
      en,
      zh,
      parameter: 'articleId',
      inputs: note ? [textInput('note', 'Review note', '审核意见', 1000)] : [],
      when: { field: 'status', values: [status] }
    })
  return {
    id: 'content-knowledge-base',
    title: t('Content and knowledge base', '内容与知识库'),
    description: t(
      'Drafts, independent review, publishing and public or internal reading.',
      '草稿编辑、独立审核、发布及公开或内部阅读。'
    ),
    entryPage: 'articles',
    roles,
    pages: [
      accountSetupPage(roles),
      {
        id: 'articles',
        path: '/articles',
        title: t('Writing desk', '创作工作台'),
        description: t(
          'Requires content-author for writing. Edit drafts, submit for independent review and preserve the publication history. Articles are plain text in this edition.',
          '写作需要 content-author。编辑草稿后提交独立审核，并保留发布历史。此版本正文使用纯文本。'
        ),
        listing,
        details: [...details, { field: 'status', label: t('Status', '状态') }],
        related,
        actions: [
          {
            id: 'create-article',
            commandId: 'create-article',
            label: t('New article', '新建文章'),
            description: t(
              'Write a new draft. Publishing requires a later review and publisher action.',
              '创建新草稿，审核通过后再由发布人员发布。'
            ),
            inputs: draftInputs,
            parameters: draftParameters
          },
          {
            id: 'edit-article',
            commandId: 'edit-article',
            label: t('Edit draft', '编辑草稿'),
            description: t(
              'Only drafts can be edited. Select the current article before opening this form.',
              '仅草稿可编辑，请先选择当前文章再打开表单。'
            ),
            inputs: draftInputs.map((input) => ({ ...input, fromSelection: input.key })),
            parameters: { articleId: selectedParameter(), ...draftParameters },
            when: { field: 'status', values: ['draft'] }
          },
          transition('submit', 'submit-article', 'Submit for review', '提交审核', 'draft')
        ]
      },
      {
        id: 'review',
        path: '/article-review',
        title: t('Review and publish', '审核与发布'),
        description: t(
          'content-reviewer approves another author’s article. content-publisher chooses public or internal publication. Roles are checked independently by the server.',
          'content-reviewer 审核其他作者的文章，content-publisher 选择公开或内部发布，服务器独立校验角色。'
        ),
        listing,
        details: [...details, { field: 'status', label: t('Status', '状态') }],
        related,
        actions: [
          transition(
            'approve',
            'approve-article',
            'Approve article',
            '批准文章',
            'in_review',
            true
          ),
          transition('reject', 'reject-article', 'Return to draft', '退回草稿', 'in_review', true),
          transition(
            'publish-public',
            'publish-public-article',
            'Publish publicly',
            '公开发布',
            'approved'
          ),
          transition(
            'publish-internal',
            'publish-internal-article',
            'Publish internally',
            '内部发布',
            'approved'
          ),
          transition('unpublish', 'unpublish-article', 'Unpublish article', '撤回发布', 'published')
        ]
      },
      {
        id: 'knowledge',
        path: '/knowledge',
        title: t('Public knowledge base', '公开知识库'),
        public: true,
        description: t(
          'Read articles that have passed review and been published publicly.',
          '阅读已通过审核并公开发布的文章。'
        ),
        listing: { resourceId: 'published-articles', columns, search: true },
        details,
        actions: []
      },
      {
        id: 'internal',
        path: '/internal-knowledge',
        title: t('Internal knowledge base', '内部知识库'),
        description: t(
          'Sign in to read articles published for internal access.',
          '登录后阅读内部发布的文章。'
        ),
        listing: { resourceId: 'internal-articles', columns, search: true },
        details,
        actions: []
      }
    ]
  }
}
