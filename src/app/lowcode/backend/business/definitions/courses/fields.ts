import {
  businessText as t,
  type BusinessColumn,
  type BusinessInput
} from '@/app/lowcode/backend/business/types'

export const courseColumn = (
  field: string,
  en: string,
  zh: string,
  multiline = false
): BusinessColumn => ({ field, label: t(en, zh), ...(multiline ? { multiline } : {}) })
export const courseRelation = (
  key: string,
  en: string,
  zh: string,
  resourceId: string
): BusinessInput => ({
  key,
  label: t(en, zh),
  kind: 'relation',
  relation: { resourceId, labelField: 'title' }
})
export const COURSE_COLUMNS = [
  courseColumn('title', 'Course', '课程'),
  courseColumn('status', 'Status', '状态'),
  courseColumn('lesson_count', 'Lessons', '章节数')
]
export const LESSON_COLUMNS = [
  courseColumn('position', 'Position', '章节序号'),
  courseColumn('title', 'Lesson', '章节')
]
export const ENROLLMENT_COLUMNS = [
  courseColumn('title', 'Course', '课程'),
  courseColumn('student_name', 'Student', '学员'),
  courseColumn('active', 'Active', '有效')
]
export const PROGRESS_COLUMNS = [
  courseColumn('title', 'Lesson', '章节'),
  courseColumn('student_name', 'Student', '学员'),
  courseColumn('status', 'Status', '状态'),
  courseColumn('score', 'Score', '成绩')
]
