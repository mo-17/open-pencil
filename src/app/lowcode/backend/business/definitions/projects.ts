import {
  businessText as t,
  type BusinessColumn,
  type BusinessInput,
  type BusinessTemplateDefinition
} from '../types'
import { accountSetupPage, formAction, profileInput, selectedParameter, textInput } from './shared'

function memberInput(projectField: string, active = true): BusinessInput {
  return {
    key: 'memberId',
    label: t('Project member', '项目成员'),
    kind: 'relation',
    relation: {
      resourceId: 'project-members',
      labelField: 'title',
      filters: {
        project_id: selectedParameter(projectField),
        active: { kind: 'literal', value: active }
      }
    }
  }
}

export function projectTasksDefinition(): BusinessTemplateDefinition {
  const projectColumns: BusinessColumn[] = [
    { field: 'title', label: t('Project', '项目') },
    { field: 'created_at', label: t('Created at', '创建时间') }
  ]
  const taskColumns: BusinessColumn[] = [
    { field: 'title', label: t('Task', '任务') },
    { field: 'status', label: t('Status', '状态') },
    { field: 'due_at', label: t('Due at', '截止时间') }
  ]
  const taskInputs = [
    textInput('title', 'Task title', '任务标题', 200),
    textInput('description', 'Task description', '任务说明', 500),
    textInput('dueAt', 'Due time (ISO 8601)', '截止时间（ISO 8601）', 40)
  ]
  const note = textInput('note', 'Change note', '变更说明', 500)
  const projectId = { projectId: selectedParameter() }
  const taskId = { projectId: selectedParameter('project_id'), taskId: selectedParameter() }
  const transition = (id: string, en: string, zh: string, values: string[]) =>
    formAction({
      id,
      en,
      zh,
      inputs: [note],
      parameters: taskId,
      when: { field: 'status', values }
    })
  return {
    id: 'project-tasks',
    title: t('Projects and tasks', '项目与任务'),
    description: t(
      'Project membership, assigned tasks, deadlines and activity history.',
      '项目成员、任务分配、截止时间与活动历史。'
    ),
    entryPage: 'projects',
    roles: ['project-manager'],
    pages: [
      accountSetupPage(['project-manager']),
      {
        id: 'projects',
        path: '/projects',
        title: t('Projects', '项目工作台'),
        description: t(
          'A project-manager creates a project using their own registered profile. Managing that project also requires ownership; ordinary members only see joined projects.',
          'project-manager 使用本人已登记资料创建项目，管理项目还需要项目所有权。普通成员只能查看自己加入的项目。'
        ),
        listing: { resourceId: 'projects', columns: projectColumns, search: true },
        details: [
          ...projectColumns,
          { field: 'description', label: t('Description', '项目说明'), multiline: true }
        ],
        related: [
          {
            resourceId: 'project-members',
            foreignKey: 'project_id',
            title: t('Project members', '项目成员'),
            columns: [
              { field: 'title', label: t('Member', '成员') },
              { field: 'active', label: t('Active', '有效') }
            ]
          },
          {
            resourceId: 'tasks',
            foreignKey: 'project_id',
            title: t('Project tasks', '项目任务'),
            columns: taskColumns
          }
        ],
        actions: [
          formAction({
            id: 'create-project',
            en: 'New project',
            zh: '新建项目',
            inputs: [
              profileInput('my-profile'),
              textInput('title', 'Project title', '项目名称', 200),
              textInput('description', 'Project description', '项目说明', 500)
            ]
          }),
          formAction({
            id: 'add-project-member',
            en: 'Add project member',
            zh: '添加项目成员',
            inputs: [profileInput()],
            parameters: projectId
          }),
          formAction({
            id: 'remove-project-member',
            en: 'Remove project member',
            zh: '停用项目成员',
            inputs: [memberInput('id')],
            parameters: projectId
          }),
          formAction({
            id: 'restore-project-member',
            en: 'Restore project member',
            zh: '恢复项目成员',
            inputs: [memberInput('id', false)],
            parameters: projectId
          }),
          formAction({
            id: 'create-task',
            en: 'Create task',
            zh: '创建任务',
            inputs: [memberInput('id'), ...taskInputs],
            parameters: projectId,
            description: t(
              'Choose a current project member. Use an explicit ISO 8601 time zone for the deadline, such as 2030-01-01T17:00:00+08:00.',
              '选择当前项目成员，截止时间使用带时区的 ISO 8601，例如 2030-01-01T17:00:00+08:00。'
            )
          })
        ]
      },
      {
        id: 'tasks',
        path: '/tasks',
        title: t('Tasks', '任务工作台'),
        description: t(
          'Members can read tasks in their projects. The assigned member starts or completes a task; the owning project-manager controls assignment and changes.',
          '成员可查看所属项目任务，由当前受指派成员开始或完成任务。拥有项目的 project-manager 可分配和修改任务。'
        ),
        listing: {
          resourceId: 'tasks',
          columns: taskColumns,
          search: true,
          filter: {
            field: 'status',
            choices: [
              { value: 'todo', label: t('To do', '待开始') },
              { value: 'in_progress', label: t('In progress', '进行中') },
              { value: 'done', label: t('Done', '已完成') },
              { value: 'cancelled', label: t('Cancelled', '已取消') }
            ]
          }
        },
        details: [
          ...taskColumns,
          { field: 'description', label: t('Description', '任务说明'), multiline: true }
        ],
        related: [
          {
            resourceId: 'task-history',
            foreignKey: 'task_id',
            title: t('Task history', '任务历史'),
            columns: [
              { field: 'action', label: t('Action', '操作') },
              { field: 'note', label: t('Note', '说明') }
            ]
          }
        ],
        actions: [
          formAction({
            id: 'assign-task',
            en: 'Assign task',
            zh: '分配任务',
            inputs: [memberInput('project_id'), note],
            parameters: taskId
          }),
          formAction({
            id: 'edit-task',
            en: 'Edit task',
            zh: '编辑任务',
            inputs: [
              ...taskInputs.map((input) => ({
                ...input,
                fromSelection: input.key === 'dueAt' ? 'due_at' : input.key
              })),
              note
            ],
            parameters: taskId
          }),
          transition('start-task', 'Start task', '开始任务', ['todo']),
          transition('complete-task', 'Complete task', '完成任务', ['in_progress']),
          transition('reopen-task', 'Reopen task', '重新打开任务', ['done']),
          transition('cancel-task', 'Cancel task', '取消任务', ['todo'])
        ]
      }
    ]
  }
}
