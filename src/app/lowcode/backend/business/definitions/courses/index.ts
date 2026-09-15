import { COURSE_ROLE } from '@/app/lowcode/backend/business/model/courses/schema'
import {
  businessText as t,
  type BusinessTemplateDefinition
} from '@/app/lowcode/backend/business/types'

import { accountSetupPage, formAction, selectedParameter, textInput } from '../shared'
import {
  COURSE_COLUMNS,
  ENROLLMENT_COLUMNS,
  LESSON_COLUMNS,
  PROGRESS_COLUMNS,
  courseColumn as col,
  courseRelation
} from './fields'

export function onlineCoursesDefinition(): BusinessTemplateDefinition {
  const courseInputs = () => [
    textInput('title', 'Course title', '课程标题', 200),
    textInput('description', 'Introduction', '课程简介', 2000)
  ]
  const lessonInputs = () => [
    textInput('title', 'Lesson title', '章节标题', 200),
    textInput('body', 'Lesson body', '章节正文', 8192),
    textInput('question', 'Written exercise', '文字练习题', 2000),
    {
      key: 'position',
      kind: 'number' as const,
      label: t('Position', '章节序号'),
      min: 1,
      max: 1000,
      initial: 1
    }
  ]
  return {
    id: 'online-courses',
    title: t('Online courses and training', '在线课程与培训'),
    description: t(
      'Text lessons, enrollment, completion records and instructor grading. Published lessons are frozen; media, payments and automatic exams can be added after export.',
      '文字章节、报名、学习记录与教师评分。发布后章节冻结；视频、付费及自动考试可在导出后扩展。'
    ),
    entryPage: 'courses',
    roles: [COURSE_ROLE, 'course-student'],
    pages: [
      accountSetupPage([COURSE_ROLE, 'course-student']),
      {
        id: 'courses',
        path: '/courses',
        title: t('Course catalog', '课程目录'),
        public: true,
        description: t(
          'Browse published courses. Sign in with the course-student role before enrolling once per course.',
          '浏览已发布课程，具有 course-student 角色的账号登录后报名；每个账号每门课程只能报名一次。'
        ),
        listing: { resourceId: 'courses', columns: COURSE_COLUMNS, search: true },
        details: [col('description', 'Introduction', '课程简介', true)],
        actions: [
          formAction({
            id: 'enroll-course',
            en: 'Enroll',
            zh: '报名课程',
            inputs: [textInput('studentName', 'Student name', '学员姓名', 100)],
            parameters: { courseId: selectedParameter() }
          })
        ]
      },
      {
        id: 'course-management',
        path: '/courses/manage',
        title: t('Manage my courses', '管理我的课程'),
        description: t(
          'Create a course and lessons before publishing. Closing stops new enrollment; existing students retain access.',
          '先创建课程及章节，再发布。关闭后停止新报名，已报名学员仍可学习。'
        ),
        listing: { resourceId: 'course-management', columns: COURSE_COLUMNS, search: true },
        details: [col('description', 'Introduction', '课程简介', true)],
        related: [
          {
            title: t('Chapters', '章节'),
            resourceId: 'course-lessons',
            foreignKey: 'course_id',
            columns: LESSON_COLUMNS
          }
        ],
        actions: [
          formAction({
            id: 'create-course',
            en: 'Create course',
            zh: '创建课程',
            inputs: courseInputs()
          }),
          formAction({
            id: 'update-course',
            en: 'Edit draft',
            zh: '编辑草稿',
            inputs: courseInputs().map((input) => ({ ...input, fromSelection: input.key })),
            parameters: {
              courseId: selectedParameter(),
              expectedVersion: selectedParameter('version')
            },
            when: { field: 'status', values: ['draft'] }
          }),
          ...(
            [
              ['publish-course', 'Publish course', '发布课程', 'draft'],
              ['close-course', 'Close enrollment', '关闭报名', 'published']
            ] as const
          ).map(([id, en, zh, status]) =>
            formAction({
              id,
              en,
              zh,
              inputs: [],
              parameters: {
                courseId: selectedParameter(),
                expectedVersion: selectedParameter('version')
              },
              when: { field: 'status', values: [status] }
            })
          )
        ]
      },
      {
        id: 'course-lessons',
        path: '/courses/lessons',
        title: t('Lessons', '课程章节'),
        description: t(
          'Enrolled students read lessons here. Instructors can add or edit lessons only while their course is a draft.',
          '已报名学员在此阅读章节；教师只能在课程草稿期间新增或修改章节。'
        ),
        listing: { resourceId: 'course-lessons', columns: LESSON_COLUMNS, search: true },
        details: [
          col('course_id', 'Course ID', '课程编号'),
          col('body', 'Body', '正文', true),
          col('question', 'Exercise', '练习题', true)
        ],
        actions: [
          formAction({
            id: 'create-course-lesson',
            en: 'Add lesson',
            zh: '新增章节',
            inputs: [
              courseRelation('courseId', 'My course', '我的课程', 'course-management'),
              ...lessonInputs()
            ]
          }),
          formAction({
            id: 'update-course-lesson',
            en: 'Edit lesson',
            zh: '编辑章节',
            inputs: lessonInputs().map((input) => ({ ...input, fromSelection: input.key })),
            parameters: {
              courseId: selectedParameter('course_id'),
              lessonId: selectedParameter(),
              expectedVersion: selectedParameter('version')
            }
          }),
          formAction({
            id: 'submit-course-lesson',
            en: 'Complete and submit',
            zh: '完成学习并交卷',
            inputs: [
              {
                ...courseRelation(
                  'enrollmentId',
                  'My enrollment',
                  '我的报名记录',
                  'course-enrollments'
                ),
                relation: {
                  resourceId: 'course-enrollments',
                  labelField: 'title',
                  filters: {
                    course_id: selectedParameter('course_id'),
                    active: { kind: 'literal', value: true }
                  }
                }
              },
              textInput('answer', 'Answer or learning notes', '答案或学习笔记', 4000)
            ],
            parameters: { courseId: selectedParameter('course_id'), lessonId: selectedParameter() }
          })
        ]
      },
      {
        id: 'course-enrollments',
        path: '/courses/enrollments',
        title: t('My enrollments', '我的报名'),
        description: t(
          'Select an enrollment to review completed lessons. Each lesson accepts one immutable submission.',
          '选择报名记录查看已完成章节；每章只接受一次不可改写的提交。'
        ),
        listing: { resourceId: 'course-enrollments', columns: ENROLLMENT_COLUMNS, search: true },
        details: [col('course_id', 'Course ID', '课程编号')],
        related: [
          {
            title: t('Completed lessons', '已完成章节'),
            resourceId: 'course-progress',
            foreignKey: 'enrollment_id',
            columns: PROGRESS_COLUMNS
          }
        ],
        actions: []
      },
      {
        id: 'course-progress',
        path: '/courses/progress',
        title: t('My learning records', '我的学习记录'),
        description: t(
          'Read your submissions and instructor feedback. A completion record is not an automatically graded exam.',
          '查看自己的交卷内容与教师反馈，成绩由教师评阅后录入。'
        ),
        listing: { resourceId: 'course-progress', columns: PROGRESS_COLUMNS, search: true },
        details: [
          col('answer', 'Answer', '答案', true),
          col('feedback', 'Feedback', '教师反馈', true)
        ],
        actions: []
      },
      {
        id: 'course-students',
        path: '/courses/students',
        title: t('Course students', '课程学员'),
        description: t(
          'Only the current course owner with the instructor role can manage enrollment.',
          '仅持有教师角色的课程创建者可管理报名。'
        ),
        listing: { resourceId: 'course-students', columns: ENROLLMENT_COLUMNS, search: true },
        details: [
          col('id', 'Enrollment ID', '报名编号'),
          col('course_id', 'Course ID', '课程编号')
        ],
        actions: [
          formAction({
            id: 'revoke-course-enrollment',
            en: 'Revoke enrollment',
            zh: '撤销报名',
            inputs: [],
            parameters: {
              courseId: selectedParameter('course_id'),
              enrollmentId: selectedParameter(),
              expectedVersion: selectedParameter('version')
            },
            when: { field: 'active', values: [true] }
          })
        ]
      },
      {
        id: 'course-submissions',
        path: '/courses/grading',
        title: t('Grade submissions', '评阅作业'),
        description: t(
          'Only the course instructor can grade other students. Grades are final and restricted to 0–100.',
          '课程教师可评阅其他学员作业，不能给自己评分；成绩为0–100分，提交后不再修改。'
        ),
        listing: { resourceId: 'course-submissions', columns: PROGRESS_COLUMNS, search: true },
        details: [col('answer', 'Answer', '答案', true), col('feedback', 'Feedback', '反馈', true)],
        actions: [
          formAction({
            id: 'grade-course-submission',
            en: 'Record grade',
            zh: '登记成绩',
            inputs: [
              {
                key: 'score',
                kind: 'number',
                label: t('Score', '成绩'),
                min: 0,
                max: 100,
                initial: 0
              },
              textInput('feedback', 'Feedback', '评语', 2000)
            ],
            parameters: {
              courseId: selectedParameter('course_id'),
              submissionId: selectedParameter(),
              expectedVersion: selectedParameter('version')
            },
            when: { field: 'status', values: ['submitted'] }
          })
        ]
      }
    ]
  }
}
